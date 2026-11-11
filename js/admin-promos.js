/* ============================================================
   ASUNTA - js/admin-promos.js
   Gestión de promociones (ofertas de producto) y combos
   (paquetes de productos a precio especial) con vigencia por
   fechas. Tabla promotions + promotion_items en Supabase.
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.adminPromos = (function () {
  'use strict';

  const sb = ASUNTA.sb;
  let promos = [];
  let products = [];
  let comboRows = [];       // [{product_id, quantity}]
  let pendingImageFile = null;
  let removeImageFlag = false;
  let inited = false;

  async function init() {
    if (inited) { await refresh(); return; }
    inited = true;
    document.getElementById('promo-new').addEventListener('click', () => openModal(null));
    document.getElementById('promo-refresh').addEventListener('click', refresh);
    document.getElementById('promo-form').addEventListener('submit', save);
    document.getElementById('pm-type').addEventListener('change', toggleTypeFields);
    document.getElementById('pm-discount-mode').addEventListener('change', toggleDiscountMode);
    document.getElementById('pm-product').addEventListener('change', updateOldPriceHint);
    document.getElementById('pm-price').addEventListener('input', updateOldPriceHint);
    document.getElementById('pm-add-item').addEventListener('click', () => { comboRows.push({ product_id: '', quantity: 1 }); renderComboRows(); });
    document.getElementById('pm-image').addEventListener('change', onImageChosen);
    document.getElementById('pm-img-clear').addEventListener('click', () => {
      pendingImageFile = null; removeImageFlag = true;
      document.getElementById('pm-img-preview').classList.add('hidden');
      document.getElementById('pm-image').value = '';
      document.getElementById('pm-img-clear').classList.add('hidden');
    });
    await refresh();
  }

  async function refresh() {
    const box = document.getElementById('promo-list');
    box.innerHTML = '<div class="skeleton h-40"></div>';
    try {
      const [pRes, prRes] = await Promise.all([
        sb.from('products').select('id, name, price, stock, active').order('name'),
        sb.from('promotions')
          .select('*, promotion_items(*, products(id, name, price, stock, active))')
          .order('created_at', { ascending: false })
      ]);
      [pRes, prRes].forEach(r => { if (r.error) throw r.error; });
      products = pRes.data || [];
      promos = prRes.data || [];
      renderList();
    } catch (e) {
      box.innerHTML = '<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">' + ASUNTA.esc(ASUNTA.dbErrorMessage(e)) + '</div>';
    }
  }

  function renderList() {
    const box = document.getElementById('promo-list');
    if (!promos.length) {
      box.innerHTML = '<div class="text-slate-400 text-sm p-6">No hay promociones registradas. Crea la primera con el botón "Nueva promoción".</div>';
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    box.innerHTML = promos.map(p => {
      const live = p.is_active && (!p.start_date || p.start_date <= today) && (!p.end_date || p.end_date >= today);
      const stateBadge = !p.is_active
        ? '<span class="status-badge status-cancelled">Inactiva</span>'
        : (live ? '<span class="status-badge status-delivered">Vigente</span>'
                : '<span class="status-badge status-pending">Fuera de vigencia</span>');
      const parts = (p.promotion_items || []).map(pi =>
        '<li class="text-xs text-slate-500">' + ASUNTA.esc(pi.products ? pi.products.name : '?') + ' x' + Number(pi.quantity) + '</li>'
      ).join('');
      const stockNote = p.type === 'combo'
        ? (p.promotion_items || []).every(pi => pi.products && Number(pi.products.stock) >= Number(pi.quantity))
          ? '<span class="text-[10px] font-bold text-asunta-600">Componentes con stock</span>'
          : '<span class="text-[10px] font-bold text-red-500">¡Falta stock de componentes!</span>'
        : '';
      const product = p.product_id ? products.find(x => x.id === p.product_id) : null;
      return (
        '<div class="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">' +
          '<div class="h-28 bg-asunta-700 relative">' +
            (p.image_url ? '<img src="' + ASUNTA.esc(p.image_url) + '" class="w-full h-full object-cover" alt="" onerror="this.style.display=\'none\'">' : '') +
            '<span class="absolute top-2 right-2 bg-asunta-yellow-400 text-slate-900 text-[10px] font-bold px-2 py-1 rounded-full">' + ASUNTA.esc(p.badge || '') + '</span>' +
          '</div>' +
          '<div class="p-4 flex-1 space-y-2">' +
            '<div class="flex items-center justify-between gap-2">' +
              '<h3 class="font-bold text-slate-800 leading-tight">' + ASUNTA.esc(p.title) + '</h3>' + stateBadge +
            '</div>' +
            '<p class="text-xs text-slate-500">' + ASUNTA.esc(p.description || '') + '</p>' +
            (p.type === 'combo' ? '<ul class="border-t border-slate-100 pt-2">' + parts + '</ul>' : '') +
            (p.type === 'oferta' && product ? '<p class="text-xs text-slate-500"><i class="fa-solid fa-tag mr-1"></i>Aplica a: ' + ASUNTA.esc(product.name) + '</p>' : '') +
            '<div class="flex items-center justify-between pt-1">' +
              '<div><span class="text-[10px] text-slate-400 block">Precio promo</span>' +
              '<span class="font-black text-asunta-700">' + ASUNTA.fmt(p.promo_price != null ? p.promo_price : (p.discount_percentage + '%')) + '</span></div>' + stockNote +
            '</div>' +
            '<p class="text-[10px] text-slate-400">Vigencia: ' + (p.start_date || 'hoy') + ' → ' + (p.end_date || 'sin fin') + '</p>' +
          '</div>' +
          '<div class="p-3 border-t border-slate-100 flex gap-2">' +
            '<button data-edit="' + p.id + '" class="btn-ghost text-xs flex-1"><i class="fa-solid fa-pen mr-1"></i>Editar</button>' +
            '<button data-toggle="' + p.id + '" class="btn-ghost text-xs">' + (p.is_active ? 'Desactivar' : 'Activar') + '</button>' +
            '<button data-del="' + p.id + '" class="btn-danger text-xs"><i class="fa-solid fa-trash"></i></button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openModal(promos.find(x => x.id === b.getAttribute('data-edit')))));
    box.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleActive(promos.find(x => x.id === b.getAttribute('data-toggle')))));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => remove(promos.find(x => x.id === b.getAttribute('data-del')))));
  }

  /* ---------- Modal ---------- */
  function openModal(p) {
    document.getElementById('promo-modal-title').textContent = p ? 'Editar: ' + p.title : 'Nueva promoción';
    document.getElementById('pm-id').value = p ? p.id : '';
    document.getElementById('pm-type').value = p ? p.type : 'combo';
    document.getElementById('pm-badge').value = p ? (p.badge || '') : '';
    document.getElementById('pm-title').value = p ? p.title : '';
    document.getElementById('pm-desc').value = p ? (p.description || '') : '';
    document.getElementById('pm-product').innerHTML = products
      .map(x => '<option value="' + x.id + '">' + ASUNTA.esc(x.name) + ' (' + ASUNTA.fmt(x.price) + ')</option>').join('');
    document.getElementById('pm-product').value = p && p.product_id ? p.product_id : (products[0] ? products[0].id : '');
    document.getElementById('pm-discount-mode').value = (p && p.discount_percentage != null) ? 'percent' : 'price';
    document.getElementById('pm-price').value = p && p.promo_price != null ? p.promo_price : '';
    document.getElementById('pm-percent').value = p && p.discount_percentage != null ? p.discount_percentage : '';
    document.getElementById('pm-start').value = p ? (p.start_date || '') : '';
    document.getElementById('pm-end').value = p ? (p.end_date || '') : '';
    document.getElementById('pm-active').checked = p ? p.is_active : true;

    pendingImageFile = null; removeImageFlag = false;
    const preview = document.getElementById('pm-img-preview');
    if (p && p.image_url) { preview.src = p.image_url; preview.classList.remove('hidden'); document.getElementById('pm-img-clear').classList.remove('hidden'); }
    else { preview.classList.add('hidden'); document.getElementById('pm-img-clear').classList.add('hidden'); }
    document.getElementById('pm-image').value = '';

    comboRows = p && p.promotion_items
      ? p.promotion_items.map(pi => ({ product_id: pi.product_id, quantity: Number(pi.quantity) }))
      : [{ product_id: products[0] ? products[0].id : '', quantity: 1 }];

    toggleTypeFields();
    renderComboRows();
    updateOldPriceHint();
    document.getElementById('promo-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('promo-modal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function toggleTypeFields() {
    const isCombo = document.getElementById('pm-type').value === 'combo';
    document.getElementById('pm-combo-box').classList.toggle('hidden', !isCombo);
    document.getElementById('pm-oferta-box').classList.toggle('hidden', isCombo);
    document.getElementById('pm-oferta-price-box').classList.toggle('hidden', isCombo);
    document.getElementById('pm-price-label').textContent = isCombo ? 'Precio del combo (S/) *' : 'Precio promocional (S/) *';
    toggleDiscountMode();
  }

  function toggleDiscountMode() {
    const isCombo = document.getElementById('pm-type').value === 'combo';
    const isPercent = document.getElementById('pm-discount-mode').value === 'percent';
    document.getElementById('pm-percent-box').classList.toggle('hidden', isCombo || !isPercent);
    document.getElementById('pm-price').parentElement.classList.toggle('hidden', !isCombo && isPercent);
    updateOldPriceHint();
  }

  function updateOldPriceHint() {
    const isCombo = document.getElementById('pm-type').value === 'combo';
    const hint = document.getElementById('pm-old-price-hint');
    if (isCombo) {
      const sum = comboRows.reduce((s, r) => {
        const p = products.find(x => x.id === r.product_id);
        return s + (p ? Number(p.price) * Number(r.quantity || 0) : 0);
      }, 0);
      hint.textContent = 'Suma de productos del combo: ' + ASUNTA.fmt(sum) +
        (sum > 0 ? ' → el combo conviene si el precio es menor.' : '');
    } else {
      const p = products.find(x => x.id === document.getElementById('pm-product').value);
      hint.textContent = p ? 'Precio de lista actual: ' + ASUNTA.fmt(p.price) + ' → el precio promocional debe ser menor.' : '';
    }
  }

  function renderComboRows() {
    document.getElementById('pm-items').innerHTML = comboRows.map((r, i) => (
      '<div class="flex gap-2 items-center">' +
        '<select data-row-product="' + i + '" class="input-base flex-1">' +
          products.map(x => '<option value="' + x.id + '"' + (x.id === r.product_id ? ' selected' : '') + '>' + ASUNTA.esc(x.name) + ' (' + ASUNTA.fmt(x.price) + ')</option>').join('') +
        '</select>' +
        '<input data-row-qty="' + i + '" type="number" min="1" step="1" value="' + Number(r.quantity || 1) + '" class="input-base w-24" title="Cantidad">' +
        '<button type="button" data-row-remove="' + i + '" class="w-9 h-9 rounded-xl bg-red-50 text-red-500 hover:bg-red-100" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>'
    )).join('') || '<p class="text-xs text-slate-400">Agrega al menos un producto al combo.</p>';

    document.querySelectorAll('[data-row-product]').forEach(sel => sel.addEventListener('change', function () {
      comboRows[Number(this.getAttribute('data-row-product'))].product_id = this.value;
      updateOldPriceHint();
    }));
    document.querySelectorAll('[data-row-qty]').forEach(inp => inp.addEventListener('input', function () {
      comboRows[Number(this.getAttribute('data-row-qty'))].quantity = Number(this.value || 1);
      updateOldPriceHint();
    }));
    document.querySelectorAll('[data-row-remove]').forEach(btn => btn.addEventListener('click', function () {
      comboRows.splice(Number(this.getAttribute('data-row-remove')), 1);
      renderComboRows();
      updateOldPriceHint();
    }));
    updateOldPriceHint();
  }

  /* ---------- Imagen ---------- */
  function onImageChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { ASUNTA.toast('Formato no permitido.', 'error'); e.target.value = ''; return; }
    if (file.size > 2 * 1024 * 1024) { ASUNTA.toast('La imagen supera 2 MB.', 'error'); e.target.value = ''; return; }
    pendingImageFile = file; removeImageFlag = false;
    const preview = document.getElementById('pm-img-preview');
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
    document.getElementById('pm-img-clear').classList.remove('hidden');
  }

  async function uploadImage(promoId) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[pendingImageFile.type] || 'jpg';
    const path = 'promotions/' + promoId + '-' + Date.now() + '.' + ext;
    const prog = document.getElementById('pm-img-progress');
    prog.classList.remove('hidden');
    prog.textContent = 'Subiendo imagen…';
    const { error } = await sb.storage.from('product-images').upload(path, pendingImageFile, { contentType: pendingImageFile.type });
    if (error) { prog.classList.add('hidden'); throw new Error('No se pudo subir la imagen: ' + error.message); }
    const { data } = sb.storage.from('product-images').getPublicUrl(path);
    prog.classList.add('hidden');
    return data.publicUrl;
  }

  function imagePathFromUrl(url) {
    try {
      const marker = '/product-images/';
      const i = url.indexOf(marker);
      return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
    } catch (_) { return null; }
  }

  /* ---------- Guardar ---------- */
  async function save(e) {
    e.preventDefault();
    const id = document.getElementById('pm-id').value;
    const isNew = !id;
    const type = document.getElementById('pm-type').value;
    const title = document.getElementById('pm-title').value.trim();
    const isPercentMode = !isComboType() && document.getElementById('pm-discount-mode').value === 'percent';

    if (title.length < 3) { ASUNTA.toast('El título es obligatorio.', 'error'); return; }
    if (type === 'oferta' && !document.getElementById('pm-product').value) {
      ASUNTA.toast('Selecciona el producto en oferta.', 'error'); return;
    }
    if (type === 'combo') {
      const valid = comboRows.filter(r => r.product_id && r.quantity > 0);
      if (!valid.length) { ASUNTA.toast('El combo necesita al menos un producto con cantidad.', 'error'); return; }
      const ids = valid.map(r => r.product_id);
      if (new Set(ids).size !== ids.length) { ASUNTA.toast('No repitas el mismo producto en el combo.', 'error'); return; }
    }

    const payload = {
      title: title,
      description: document.getElementById('pm-desc').value.trim() || null,
      type: type,
      badge: document.getElementById('pm-badge').value.trim() || null,
      start_date: document.getElementById('pm-start').value || null,
      end_date: document.getElementById('pm-end').value || null,
      is_active: document.getElementById('pm-active').checked
    };
    if (type === 'oferta') {
      payload.product_id = document.getElementById('pm-product').value;
      payload.promo_price = isPercentMode ? null : (Number(document.getElementById('pm-price').value) || null);
      payload.discount_percentage = isPercentMode ? (Number(document.getElementById('pm-percent').value) || null) : null;
      if (!payload.promo_price && !payload.discount_percentage) {
        ASUNTA.toast('Define el precio promocional o el porcentaje de descuento.', 'error'); return;
      }
    } else {
      payload.product_id = null;
      const price = Number(document.getElementById('pm-price').value);
      if (!(price > 0)) { ASUNTA.toast('Ingresa el precio del combo.', 'error'); return; }
      payload.promo_price = price;
      payload.discount_percentage = null;
    }

    const btn = document.querySelector('#promo-form button[type="submit"]');
    btn.disabled = true;
    try {
      let promoId = id;
      if (isNew) {
        const { data, error } = await sb.from('promotions').insert(payload).select('id').single();
        if (error) throw error;
        promoId = data.id;
      } else {
        const { error } = await sb.from('promotions').update(payload).eq('id', id);
        if (error) throw error;
        const { error: e2 } = await sb.from('promotion_items').delete().eq('promotion_id', id);
        if (e2) throw e2;
      }
      if (type === 'combo') {
        const rows = comboRows.filter(r => r.product_id && r.quantity > 0);
        const { error: e3 } = await sb.from('promotion_items').insert(
          rows.map(r => ({ promotion_id: promoId, product_id: r.product_id, quantity: r.quantity }))
        );
        if (e3) throw e3;
      }
      if (pendingImageFile) {
        const url = await uploadImage(promoId);
        const { error: e4 } = await sb.from('promotions').update({ image_url: url }).eq('id', promoId);
        if (e4) throw e4;
      } else if (removeImageFlag) {
        const old = promos.find(x => x.id === promoId);
        const { error: e5 } = await sb.from('promotions').update({ image_url: null }).eq('id', promoId);
        if (e5) throw e5;
        if (old && old.image_url) {
          const p = imagePathFromUrl(old.image_url);
          if (p) { try { await sb.storage.from('product-images').remove([p]); } catch (_) {} }
        }
      }
      ASUNTA.admin.logActivity(isNew ? 'promo.create' : 'promo.update', { id: promoId, title: title });
      ASUNTA.toast(isNew ? 'Promoción creada.' : 'Promoción actualizada.');
      closeModal();
      await refresh();
    } catch (err) {
      ASUNTA.toast(ASUNTA.dbErrorMessage(err), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function isComboType() {
    return document.getElementById('pm-type').value === 'combo';
  }

  async function toggleActive(p) {
    const { error } = await sb.from('promotions').update({ is_active: !p.is_active }).eq('id', p.id);
    if (error) { ASUNTA.toast(ASUNTA.dbErrorMessage(error), 'error'); return; }
    ASUNTA.admin.logActivity(p.is_active ? 'promo.deactivate' : 'promo.activate', { title: p.title });
    await refresh();
  }

  async function remove(p) {
    if (!confirm('¿Eliminar la promoción "' + p.title + '"?')) return;
    const { error } = await sb.from('promotions').delete().eq('id', p.id);
    if (error) { ASUNTA.toast(ASUNTA.dbErrorMessage(error), 'error'); return; }
    ASUNTA.admin.logActivity('promo.delete', { title: p.title });
    ASUNTA.toast('Promoción eliminada.');
    await refresh();
  }

  return { init: init, refresh: refresh, closeModal: closeModal };
})();
