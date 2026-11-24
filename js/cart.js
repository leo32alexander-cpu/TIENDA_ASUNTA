/* ============================================================
   ASUNTA - js/cart.js
   Carrito de compras persistente (localStorage) con control de
   stock y cálculo de importes en soles (PEN).

   Estructura de un ítem del carrito:
     {
       key: 'product:<uuid>' | 'combo:<uuid>',
       type: 'product' | 'combo',
       id: '<uuid>',            // id de producto o de promoción (combo)
       name, unitLabel,         // datos para mostrar
       price, compareAt,        // precio vigente y precio de lista (tachado)
       img,                     // URL de imagen para el carrito
       qty,                     // cantidad (> 0)
       maxQty                   // límite por stock (999 en combos)
     }

   Los precios que viajan al servidor NO se toman del carrito:
   el servidor recalcula todo con sql/02_funciones_seguras.sql.
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.cart = (function () {
  'use strict';

  const CART_KEY = 'asunta_cart_v2';
  const IDEM_KEY = 'asunta_idem_key';
  let items = [];
  let settings = ASUNTA.DEFAULT_SETTINGS;

  /* ---------- Persistencia ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(items)) items = [];
    } catch (_) { items = []; }
    items = items.filter(it => it && it.id && it.qty > 0);
  }

  function save() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch (e) { console.warn('No se pudo guardar el carrito', e); }
    render();
  }

  /* Clave de idempotencia: una sola por proceso de compra.
     Evita pedidos duplicados si el navegador reintenta la petición. */
  function getIdemKey() {
    let k = localStorage.getItem(IDEM_KEY);
    if (!k) {
      k = (crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'idem-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      localStorage.setItem(IDEM_KEY, k);
    }
    return k;
  }
  function clearIdemKey() { localStorage.removeItem(IDEM_KEY); }

  /* ---------- Configuración de delivery ---------- */
  async function init() {
    load();
    settings = await ASUNTA.getSettings();
    render();
  }

  function computeTotals() {
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const threshold = Number(settings.free_delivery_threshold);
    const fee = Number(settings.delivery_fee);
    const delivery = (threshold > 0 && subtotal >= threshold) ? 0 : fee;
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      delivery: delivery,
      total: Math.round((subtotal + delivery) * 100) / 100
    };
  }

  /* ---------- Operaciones ---------- */
  function findKey(key) { return items.findIndex(it => it.key === key); }

  function addProduct(p, qty) {
    const q = Math.max(1, parseInt(qty || 1, 10));
    const max = Math.max(0, Math.floor(Number(p.stock) || 0));
    if (max <= 0) {
      ASUNTA.toast('"' + p.name + '" está agotado.', 'warn');
      return false;
    }
    const key = 'product:' + p.id;
    const i = findKey(key);
    let current = i > -1 ? items[i].qty : 0;
    if (current + q > max) {
      q === 1 && current > 0
        ? ASUNTA.toast('Stock disponible de "' + p.name + '": ' + max, 'warn')
        : ASUNTA.toast('Solo hay ' + max + ' unidades de "' + p.name + '".', 'warn');
      if (current >= max) return false;
      if (i > -1) { items[i].qty = max; }
      else { items.push(buildProductItem(p, max)); }
      save();
      return false;
    }
    if (i > -1) items[i].qty += q;
    else items.push(buildProductItem(p, q));
    save();
    return true;
  }

  function buildProductItem(p, qty) {
    const promo = ASUNTA.store && ASUNTA.store.bestOfferFor(p);
    const price = promo ? promo.price : Number(p.price);
    return {
      key: 'product:' + p.id,
      type: 'product',
      id: p.id,
      name: p.name,
      unitLabel: p.unit || 'unidad',
      price: price,
      compareAt: promo ? Number(p.price) : null,
      img: p.image_url || null,
      qty: qty,
      maxQty: Math.floor(Number(p.stock) || 0)
    };
  }

  function addCombo(c, qty) {
    const q = Math.max(1, parseInt(qty || 1, 10));
    const key = 'combo:' + c.id;
    const i = findKey(key);
    if (i > -1) items[i].qty += q;
    else items.push({
      key: key,
      type: 'combo',
      id: c.id,
      name: c.title,
      unitLabel: 'paquete',
      price: Number(c.promo_price),
      compareAt: c.compareAt || null,
      img: c.image_url || null,
      qty: q,
      maxQty: Math.min(c.maxQty || 999, 999)
    });
    save();
    return true;
  }

  function setQty(key, qty) {
    const i = findKey(key);
    if (i === -1) return;
    const q = parseInt(qty, 10);
    if (isNaN(q) || q <= 0) { items.splice(i, 1); }
    else {
      const max = items[i].maxQty || 999;
      items[i].qty = Math.min(q, max);
      if (items[i].qty !== q) {
        ASUNTA.toast('Stock disponible: ' + max, 'warn');
      }
    }
    save();
  }

  function changeQty(key, delta) {
    const i = findKey(key);
    if (i === -1) return;
    setQty(key, items[i].qty + delta);
  }

  function removeItem(key) {
    const i = findKey(key);
    if (i > -1) { items.splice(i, 1); save(); }
  }

  function clear() { items = []; save(); }

  function count() { return items.reduce((s, it) => s + it.qty, 0); }

  /* Payload para la función segura create_order (SIN precios) */
  function toOrderItems() {
    return items.map(it => ({
      type: it.type,
      id: it.id,
      quantity: Math.max(1, Math.floor(it.qty))
    }));
  }

  /* Re-sincroniza el carrito con el catálogo real:
     actualiza precios, elimina productos inexistentes/inactivos y
     limita cantidades al stock disponible. */
  function syncWithCatalog() {
    let changed = false;
    const removed = [];
    items = items.filter(it => {
      if (it.type === 'product') {
        const p = ASUNTA.store && ASUNTA.store.productById(it.id);
        if (!p || !p.active || Number(p.stock) <= 0) {
          removed.push(it.name); changed = true; return false;
        }
        const promo = ASUNTA.store.bestOfferFor(p);
        it.price = promo ? promo.price : Number(p.price);
        it.compareAt = promo ? Number(p.price) : null;
        it.maxQty = Math.floor(Number(p.stock));
        it.unitLabel = p.unit || 'unidad';
        it.img = p.image_url || it.img;
        if (it.qty > it.maxQty) { it.qty = it.maxQty; changed = true; }
        return true;
      }
      // combo
      const c = ASUNTA.store && ASUNTA.store.comboById(it.id);
      if (!c || !c.available) {
        removed.push(it.name); changed = true; return false;
      }
      it.price = Number(c.promo_price);
      it.compareAt = c.compareAt || null;
      it.maxQty = Math.min(c.maxQty || 999, 999);
      if (it.qty > it.maxQty) { it.qty = it.maxQty; changed = true; }
      return true;
    });
    if (removed.length) {
      ASUNTA.toast('Se retiró del carrito: ' + removed.join(', ') + ' (ya no disponible).', 'warn');
    }
    if (changed || removed.length) save(); else render();
  }

  /* ---------- Render del panel lateral ---------- */
  function render() {
    const badge = document.getElementById('cart-badge');
    const label = document.getElementById('cart-item-count-label');
    const list = document.getElementById('cart-items');
    const subEl = document.getElementById('cart-subtotal');
    const delEl = document.getElementById('cart-delivery');
    const totEl = document.getElementById('cart-total');
    const checkoutBtn = document.getElementById('checkout-btn');
    const n = count();
    const totals = computeTotals();

    if (badge) {
      badge.textContent = n;
      badge.classList.toggle('hidden', n === 0);
    }
    if (label) label.textContent = n + (n === 1 ? ' artículo' : ' artículos');
    if (checkoutBtn) checkoutBtn.disabled = n === 0;

    if (!list) return;

    if (items.length === 0) {
      list.innerHTML =
        '<div class="text-center py-16 space-y-3">' +
          '<div class="w-16 h-16 bg-slate-100 text-slate-300 rounded-full flex items-center justify-center mx-auto text-2xl">' +
            '<i class="fa-solid fa-basket-shopping"></i></div>' +
          '<p class="text-slate-500 font-medium">Tu carrito está vacío</p>' +
          '<p class="text-xs text-slate-400">Agrega abarrotes o combos para armar tu pedido.</p>' +
        '</div>';
    } else {
      list.innerHTML = items.map(it => {
        const isCombo = it.type === 'combo';
        const tag = isCombo
          ? '<span class="inline-block text-[10px] bg-asunta-yellow-100 text-amber-800 font-bold px-1.5 py-0.5 rounded mr-1">COMBO</span>'
          : '';
        const offer = it.compareAt && it.compareAt > it.price
          ? ' <span class="text-[10px] text-slate-400 line-through">' + ASUNTA.fmt(it.compareAt) + '</span>'
          : '';
        const maxTxt = it.maxQty ? ('máx. ' + it.maxQty) : '';
        return (
          '<div class="py-4 flex items-center justify-between gap-4">' +
            '<div class="flex-1 min-w-0">' +
              '<h4 class="font-bold text-slate-800 text-sm truncate">' + tag + ASUNTA.esc(it.name) + '</h4>' +
              '<span class="text-xs text-slate-500">' + ASUNTA.esc(it.unitLabel) + ' • ' +
                ASUNTA.fmt(it.price) + ' c/u' + offer + (maxTxt ? ' • ' + maxTxt : '') + '</span>' +
            '</div>' +
            '<div class="flex items-center gap-2 shrink-0">' +
              '<button onclick="ASUNTA.cart.changeQty(\'' + it.key + '\',-1)" aria-label="Quitar uno" ' +
                'class="w-7 h-7 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center justify-center text-slate-700 font-bold text-sm">-</button>' +
              '<span class="text-sm font-bold w-7 text-center">' + it.qty + '</span>' +
              '<button onclick="ASUNTA.cart.changeQty(\'' + it.key + '\',1)" aria-label="Agregar uno" ' +
                'class="w-7 h-7 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center justify-center text-slate-700 font-bold text-sm">+</button>' +
            '</div>' +
            '<div class="text-right shrink-0">' +
              '<span class="text-sm font-bold text-slate-900">' + ASUNTA.fmt(it.price * it.qty) + '</span>' +
              '<button onclick="ASUNTA.cart.removeItem(\'' + it.key + '\')" ' +
                'class="block text-red-500 hover:text-red-700 text-xs mt-1" aria-label="Eliminar">' +
                '<i class="fa-solid fa-trash"></i></button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    if (subEl) subEl.textContent = ASUNTA.fmt(totals.subtotal);
    if (delEl) {
      delEl.textContent = items.length === 0
        ? ASUNTA.fmt(0)
        : (totals.delivery === 0 ? '¡GRATIS! (compra desde ' + ASUNTA.fmt(settings.free_delivery_threshold) + ')'
                                 : ASUNTA.fmt(totals.delivery));
    }
    if (totEl) totEl.textContent = ASUNTA.fmt(totals.total);
  }

  /* ---------- Panel lateral ---------- */
  function toggleDrawer(open) {
    const d = document.getElementById('cart-drawer');
    if (!d) return;
    const willOpen = typeof open === 'boolean' ? open : d.classList.contains('hidden');
    const backdrop = d.querySelector('.absolute.inset-0');
    const panel = d.querySelector('.drawer-panel');
    if (willOpen) {
      d.classList.remove('hidden');
      if (panel) { panel.classList.add('drawer-closed'); requestAnimationFrame(() => {
        panel.classList.remove('drawer-closed'); panel.classList.add('drawer-open');
      }); }
      document.body.style.overflow = 'hidden';
    } else {
      if (panel) { panel.classList.remove('drawer-open'); panel.classList.add('drawer-closed'); }
      setTimeout(() => d.classList.add('hidden'), 220);
      document.body.style.overflow = '';
    }
  }

  function refreshSettings(newSettings) {
    settings = newSettings || settings;
    render();
  }

  return {
    init: init,
    addProduct: addProduct,
    addCombo: addCombo,
    setQty: setQty,
    changeQty: changeQty,
    removeItem: removeItem,
    clear: clear,
    count: count,
    computeTotals: computeTotals,
    toOrderItems: toOrderItems,
    syncWithCatalog: syncWithCatalog,
    toggleDrawer: toggleDrawer,
    refreshSettings: refreshSettings,
    getIdemKey: getIdemKey,
    clearIdemKey: clearIdemKey,
    getItems: function () { return items.slice(); },
    getSettings: function () { return settings; }
  };
})();
