/* ============================================================
   ASUNTA - js/checkout.js
   Proceso real de compra: el pedido se registra en Supabase
   mediante la función segura create_order (sql/02).

   Flujo:
     1. El cliente llena el formulario de entrega.
     2. Se valida todo en el cliente (experiencia de uso).
     3. Se llama a create_order con los ids y cantidades del carrito
        (NUNCA con precios: el servidor recalcula todo).
     4. El servidor valida stock, aplica promociones vigentes,
        calcula el delivery, registra el pedido, descuenta el
        inventario y devuelve el código del pedido (ASU-XXXXXX).
     5. Se muestra la confirmación con el botón de WhatsApp como
        canal adicional de comunicación.
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.checkout = (function () {
  'use strict';

  let lastResult = null;

  /* ---------- Apertura del modal ---------- */
  async function open() {
    const items = ASUNTA.cart.getItems();
    if (!items.length) { ASUNTA.toast('Tu carrito está vacío.', 'warn'); return; }

    const settings = ASUNTA.cart.getSettings();
    const modal = document.getElementById('checkout-modal');
    const payBox = document.getElementById('pay-methods');
    payBox.innerHTML = (settings.payment_methods || ['Efectivo contra entrega']).map((m, i) => (
      '<label class="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 cursor-pointer hover:border-asunta-500 text-sm has-[:checked]:border-asunta-600 has-[:checked]:bg-asunta-50">' +
        '<input type="radio" name="pay-method" value="' + ASUNTA.esc(m) + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<span class="font-medium text-slate-700">' + ASUNTA.esc(m) + '</span>' +
      '</label>'
    )).join('');

    // Si el cliente está logueado, precargamos sus datos guardados
    await prefillFromCustomer();

    renderSummary();
    modal.classList.remove('hidden');
    showStep('form');
    document.body.style.overflow = 'hidden';
  }

  /* ---------- Precarga datos del cliente logueado ---------- */
  async function prefillFromCustomer() {
    if (!window.ASUNTA.customerAuth) return;
    try {
      const session = await ASUNTA.customerAuth.getSession();
      if (!session) return;
      const profile = await ASUNTA.customerAuth.loadProfile();
      const u = session.user;
      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el && val) el.value = val;
      };
      // Datos del perfil (si ya los llenó en "Mi cuenta")
      if (profile) {
        set('ck-name', profile.full_name || '');
        set('ck-phone', profile.phone || '');
        set('ck-address', profile.default_address || '');
        set('ck-district', profile.default_district || '');
        set('ck-ref', profile.default_reference || '');
      }
      // Email siempre del auth (más confiable)
      set('ck-email', u.email || '');
    } catch (_) { /* no crítico: el cliente llena a mano */ }
  }

  function close() {
    document.getElementById('checkout-modal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function showStep(step) {
    ['checkout-step-form', 'checkout-step-loading', 'checkout-step-confirm'].forEach(id => {
      document.getElementById(id).classList.toggle('hidden', !id.endsWith(step));
    });
  }

  /* ---------- Resumen en vivo ---------- */
  function renderSummary() {
    const items = ASUNTA.cart.getItems();
    const t = ASUNTA.cart.computeTotals();
    document.getElementById('checkout-items').innerHTML = items.map(it => (
      '<div class="flex justify-between text-sm">' +
        '<span class="text-slate-600">' + ASUNTA.esc(it.name) + ' <b class="text-slate-800">x' + it.qty + '</b></span>' +
        '<span class="font-semibold text-slate-800">' + ASUNTA.fmt(it.price * it.qty) + '</span>' +
      '</div>'
    )).join('');
    document.getElementById('ck-subtotal').textContent = ASUNTA.fmt(t.subtotal);
    document.getElementById('ck-delivery').textContent = t.delivery === 0 ? 'GRATIS' : ASUNTA.fmt(t.delivery);
    document.getElementById('ck-total').textContent = ASUNTA.fmt(t.total);
  }

  /* ---------- Validación del formulario ---------- */
  function validateForm() {
    const get = id => document.getElementById(id);
    const name = get('ck-name').value.trim();
    const phone = get('ck-phone').value.trim();
    const address = get('ck-address').value.trim();
    const ref = get('ck-ref').value.trim();
    const district = get('ck-district').value.trim();
    const notes = get('ck-notes').value.trim();
    const email = get('ck-email').value.trim();
    const payRadio = document.querySelector('input[name="pay-method"]:checked');
    let ok = true;
    const setErr = (id, msg) => {
      const el = get(id + '-error');
      if (el) { el.textContent = msg || ''; el.classList.toggle('hidden', !msg); }
      if (msg) ok = false;
    };
    setErr('ck-name', name.length >= 3 ? '' : 'Ingresa tu nombre completo.');
    setErr('ck-phone', /^[0-9+\-\s()]{6,17}$/.test(phone) ? '' : 'Ingresa un teléfono válido (ej. 987 654 321).');
    setErr('ck-address', address.length >= 5 ? '' : 'Ingresa la dirección exacta de entrega.');
    setErr('ck-district', district.length >= 3 ? '' : 'Ingresa el distrito de entrega.');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) setErr('ck-email', 'El correo no es válido.');
    else setErr('ck-email', '');
    return ok ? {
      customer_name: name, customer_phone: phone, customer_email: email,
      delivery_address: address, address_reference: ref,
      district: district, notes: notes,
      payment_method: payRadio ? payRadio.value : 'Efectivo contra entrega'
    } : null;
  }

  /* ---------- Envío del pedido ---------- */
  async function submit() {
    const data = validateForm();
    if (!data) { ASUNTA.toast('Revisa los campos marcados.', 'warn'); return; }

    const items = ASUNTA.cart.toOrderItems();
    if (!items.length) { ASUNTA.toast('Tu carrito está vacío.', 'warn'); return; }

    showStep('loading');
    const btn = document.getElementById('ck-submit-btn');
    btn.disabled = true;

    try {
      const { data: result, error } = await ASUNTA.sb.rpc('create_order', {
        p_customer_name: data.customer_name,
        p_customer_phone: data.customer_phone,
        p_customer_email: data.customer_email || null,
        p_delivery_address: data.delivery_address,
        p_district: data.district,
        p_items: items,
        p_address_reference: data.address_reference || null,
        p_notes: data.notes || null,
        p_payment_method: data.payment_method,
        p_idempotency_key: ASUNTA.cart.getIdemKey()
      });
      if (error) throw error;

      lastResult = result;
      // Guarda una copia de los ítems para el mensaje de WhatsApp
      // (se hace ANTES de vaciar el carrito)
      lastResult._items = ASUNTA.cart.getItems();
      showConfirmation(result, data);
      ASUNTA.cart.clear();
      ASUNTA.cart.clearIdemKey();
      rememberOrder(result);
      // Refresca el catálogo (el stock cambió en el servidor)
      ASUNTA.store.boot();
    } catch (e) {
      showStep('form');
      const msg = ASUNTA.dbErrorMessage(e);
      ASUNTA.toast(msg, 'error');
      // Si el fallo fue de stock, refrescamos catálogo y carrito
      if (/stock|disponible|combo/i.test(msg)) {
        await ASUNTA.store.loadCatalog();
        ASUNTA.store.renderOffers();
        ASUNTA.store.renderProducts();
      }
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- Confirmación ---------- */
  function showConfirmation(r, data) {
    const t = ASUNTA.cart.computeTotals();
    const sub = (r && r.subtotal != null) ? r.subtotal : t.subtotal;
    const del = (r && r.delivery_cost != null) ? r.delivery_cost : t.delivery;
    const tot = (r && r.total != null) ? r.total : t.total;
    const code = (r && r.order_code) || 'ASU-??????';

    document.getElementById('confirm-code').textContent = code;
    document.getElementById('confirm-summary').innerHTML =
      '<div class="flex justify-between text-sm"><span class="text-slate-500">Subtotal</span><span class="font-semibold">' + ASUNTA.fmt(sub) + '</span></div>' +
      '<div class="flex justify-between text-sm"><span class="text-slate-500">Delivery</span><span class="font-semibold">' + (Number(del) === 0 ? 'GRATIS' : ASUNTA.fmt(del)) + '</span></div>' +
      '<div class="flex justify-between text-sm font-bold border-t border-slate-200 pt-2"><span>Total a pagar</span><span class="text-asunta-700">' + ASUNTA.fmt(tot) + '</span></div>' +
      '<div class="flex justify-between text-sm"><span class="text-slate-500">Método de pago</span><span class="font-semibold">' + ASUNTA.esc(r.payment_method || data.payment_method) + '</span></div>' +
      '<div class="flex justify-between text-sm"><span class="text-slate-500">Entrega en</span><span class="font-semibold text-right">' + ASUNTA.esc(data.delivery_address) + ', ' + ASUNTA.esc(data.district) + '</span></div>';
    showStep('confirm');
  }

  /* ---------- WhatsApp (canal adicional) ---------- */
  function sendWhatsApp() {
    if (!lastResult) return;
    const settings = ASUNTA.cart.getSettings();
    const items = lastResult._items || [];
    let text = 'PEDIDO REGISTRADO - ASUNTA\n';
    text += 'Código: ' + lastResult.order_code + '\n';
    text += 'Cliente: ' + lastResult.customer_name + '\n';
    text += 'Teléfono: ' + lastResult.customer_phone + '\n';
    text += 'Dirección: ' + lastResult.delivery_address + ' (' + lastResult.district + ')\n';
    if (lastResult.address_reference) text += 'Referencia: ' + lastResult.address_reference + '\n';
    text += 'Pago: ' + lastResult.payment_method + '\n';
    text += '----------------------\n';
    if (Array.isArray(items) && items.length) {
      items.forEach(it => {
        text += '- ' + it.name + ' x' + it.qty + ' (' + ASUNTA.fmt(it.price * it.qty) + ')\n';
      });
    }
    text += '----------------------\n';
    text += 'Subtotal: ' + ASUNTA.fmt(lastResult.subtotal) + '\n';
    text += 'Delivery: ' + (Number(lastResult.delivery_cost) === 0 ? 'GRATIS' : ASUNTA.fmt(lastResult.delivery_cost)) + '\n';
    text += 'TOTAL: ' + ASUNTA.fmt(lastResult.total) + '\n';
    text += '----------------------\n';
    text += 'Mi pedido ya está registrado en el sistema con el código ' + lastResult.order_code + '.';
    const url = 'https://wa.me/' + String(settings.whatsapp_number).replace(/\D/g, '') +
      '?text=' + encodeURIComponent(text);
    window.open(url, '_blank');
  }

  /* ---------- Recordatorio local de pedidos (solo en este dispositivo) ---------- */
  function rememberOrder(r) {
    try {
      const list = JSON.parse(localStorage.getItem('asunta_my_orders') || '[]');
      list.unshift({
        code: r.order_code,
        phone: r.customer_phone,
        total: r.total,
        date: new Date().toISOString()
      });
      localStorage.setItem('asunta_my_orders', JSON.stringify(list.slice(0, 20)));
    } catch (_) { /* no crítico */ }
  }

  return { open: open, close: close, submit: submit, sendWhatsApp: sendWhatsApp };
})();
