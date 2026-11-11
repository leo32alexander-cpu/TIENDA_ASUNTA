/* ============================================================
   ASUNTA - js/orders.js
   Consulta de pedidos para clientes (mecanismo seguro para
   compras de invitado): el pedido se muestra SOLO si coinciden
   el código del pedido Y el teléfono usado en la compra.

   La decisión la toma el servidor (función lookup_order en
   sql/02_funciones_seguras.sql); este archivo solo envía los
   dos datos y muestra el resultado.
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.orders = (function () {
  'use strict';

  /* ---------- Modal de consulta ---------- */
  async function openLookup() {
    renderSaved();
    const modal = document.getElementById('orders-modal');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Si el cliente está logueado, mostramos automáticamente todos sus pedidos
    await renderMyOrdersIfLoggedIn();
  }

  /* ---------- Si hay sesión, pinta el historial completo ---------- */
  async function renderMyOrdersIfLoggedIn() {
    const box = document.getElementById('my-orders-auto');
    if (!box) return;
    if (!window.ASUNTA.customerAuth) { box.classList.add('hidden'); return; }
    try {
      const session = await ASUNTA.customerAuth.getSession();
      if (!session) { box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      const list = await ASUNTA.customerAuth.loadMyOrders();
      const inner = document.getElementById('my-orders-auto-list');
      if (!list.length) {
        inner.innerHTML =
          '<p class="text-xs text-slate-400">Aún no tienes pedidos asociados a tu cuenta.</p>';
        return;
      }
      inner.innerHTML = list.map(o => (
        '<button class="saved-order w-full flex items-center justify-between border border-slate-200 rounded-xl px-3 py-2 text-sm hover:border-asunta-500" ' +
          'data-code="' + ASUNTA.esc(o.order_code) + '" data-phone="' + ASUNTA.esc(o.customer_phone || '') + '">' +
          '<span class="font-bold text-slate-700">' + ASUNTA.esc(o.order_code) + '</span>' +
          '<span class="text-slate-400">' + ASUNTA.fmtDate(o.created_at) + '</span>' +
        '</button>'
      )).join('');
      inner.querySelectorAll('.saved-order').forEach(btn => {
        btn.addEventListener('click', function () {
          document.getElementById('lookup-code').value = this.getAttribute('data-code');
          document.getElementById('lookup-phone').value = this.getAttribute('data-phone');
          doLookup();
        });
      });
    } catch (_) { box.classList.add('hidden'); }
  }

  function closeLookup() {
    document.getElementById('orders-modal').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('order-result').innerHTML = '';
  }

  /* Pedidos recordados en este dispositivo (localStorage) */
  function renderSaved() {
    const box = document.getElementById('saved-orders');
    if (!box) return;
    let list = [];
    try { list = JSON.parse(localStorage.getItem('asunta_my_orders') || '[]'); } catch (_) {}
    if (!list.length) {
      box.innerHTML = '<p class="text-xs text-slate-400">Aún no hay pedidos registrados en este dispositivo.</p>';
      return;
    }
    box.innerHTML =
      '<p class="text-xs font-bold text-slate-500 mb-2">Pedidos hechos en este dispositivo:</p>' +
      '<div class="space-y-2">' + list.slice(0, 5).map(o => (
        '<button class="saved-order w-full flex items-center justify-between border border-slate-200 rounded-xl px-3 py-2 text-sm hover:border-asunta-500" ' +
          'data-code="' + ASUNTA.esc(o.code) + '" data-phone="' + ASUNTA.esc(o.phone || '') + '">' +
          '<span class="font-bold text-slate-700">' + ASUNTA.esc(o.code) + '</span>' +
          '<span class="text-slate-400">' + ASUNTA.fmtDate(o.date) + '</span>' +
        '</button>'
      )).join('') + '</div>';
    box.querySelectorAll('.saved-order').forEach(btn => {
      btn.addEventListener('click', function () {
        document.getElementById('lookup-code').value = this.getAttribute('data-code');
        document.getElementById('lookup-phone').value = this.getAttribute('data-phone');
        doLookup();
      });
    });
  }

  /* ---------- Consulta al servidor ---------- */
  async function doLookup() {
    const code = document.getElementById('lookup-code').value.trim();
    const phone = document.getElementById('lookup-phone').value.trim();
    const resultBox = document.getElementById('order-result');
    if (!code || !phone) {
      ASUNTA.toast('Ingresa el código del pedido y el teléfono usado en la compra.', 'warn');
      return;
    }
    resultBox.innerHTML =
      '<div class="py-8 flex justify-center"><i class="fa-solid fa-spinner fa-spin text-2xl text-asunta-600"></i></div>';
    try {
      const { data, error } = await ASUNTA.sb.rpc('lookup_order', {
        p_order_code: code, p_phone: phone
      });
      if (error) throw error;
      renderOrder(data);
    } catch (e) {
      resultBox.innerHTML =
        '<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">' +
          '<i class="fa-solid fa-circle-exclamation mr-2"></i>' + ASUNTA.esc(ASUNTA.dbErrorMessage(e)) +
        '</div>';
    }
  }

  function renderOrder(o) {
    const steps = ['pending', 'confirmed', 'preparing', 'shipped', 'delivered'];
    const idx = steps.indexOf(o.status);
    const timeline = o.status === 'cancelled' ? '' : (
      '<div class="flex items-center justify-between my-4">' + steps.map((s, i) => {
        const done = i <= idx;
        return '<div class="flex flex-col items-center gap-1 flex-1">' +
          '<div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ' +
            (done ? 'bg-asunta-600 text-white' : 'bg-slate-200 text-slate-500') + '">' +
            '<i class="fa-solid fa-' + ['clock','file-circle-check','blender','truck','house-circle-check'][i] + '"></i></div>' +
          '<span class="text-[10px] font-semibold ' + (done ? 'text-asunta-700' : 'text-slate-400') + '">' +
            ASUNTA.ORDER_STATUS[s].label + '</span>' +
        '</div>';
      }).join('') + '</div>'
    );
    const itemsHtml = (o.items || []).map(it => (
      '<div class="flex justify-between text-sm py-1">' +
        '<span class="text-slate-600">' + ASUNTA.esc(it.product_name) + ' <b>x' + Number(it.quantity) + '</b></span>' +
        '<span class="font-semibold text-slate-800">' + ASUNTA.fmt(it.subtotal) + '</span>' +
      '</div>'
    )).join('');

    document.getElementById('order-result').innerHTML =
      '<div class="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">' +
        '<div class="flex items-center justify-between">' +
          '<span class="font-black text-lg text-asunta-700">' + ASUNTA.esc(o.order_code) + '</span>' +
          ASUNTA.statusBadge(o.status) +
        '</div>' +
        '<p class="text-xs text-slate-400">Registrado: ' + ASUNTA.fmtDate(o.created_at) + '</p>' +
        timeline +
        '<div class="border-t border-slate-200 pt-2">' + itemsHtml + '</div>' +
        '<div class="border-t border-slate-200 pt-2 space-y-1">' +
          '<div class="flex justify-between text-sm"><span class="text-slate-500">Subtotal</span><span>' + ASUNTA.fmt(o.subtotal) + '</span></div>' +
          '<div class="flex justify-between text-sm"><span class="text-slate-500">Delivery</span><span>' + (Number(o.delivery_cost) === 0 ? 'GRATIS' : ASUNTA.fmt(o.delivery_cost)) + '</span></div>' +
          '<div class="flex justify-between text-sm font-bold"><span>Total</span><span class="text-asunta-700">' + ASUNTA.fmt(o.total) + '</span></div>' +
          '<div class="flex justify-between text-sm"><span class="text-slate-500">Pago</span><span>' + ASUNTA.esc(o.payment_method || '-') + ' (' + ASUNTA.esc(o.payment_status) + ')</span></div>' +
          '<div class="flex justify-between text-sm"><span class="text-slate-500">Entrega</span><span class="text-right">' + ASUNTA.esc(o.delivery_address) + ', ' + ASUNTA.esc(o.district || '-') + '</span></div>' +
        '</div>' +
        '<button onclick="ASUNTA.orders.openWhatsAppContact()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-sm">' +
          '<i class="fa-brands fa-whatsapp mr-2"></i>Consultar por WhatsApp</button>' +
      '</div>';
  }

  /* ---------- Contacto directo por WhatsApp ---------- */
  async function openWhatsAppContact(numberOverride) {
    const s = await ASUNTA.getSettings();
    const number = String(numberOverride || s.whatsapp_number).replace(/\D/g, '');
    // Mensaje más completo y amigable: saludo + intención de pedido
    const hora = new Date().getHours();
    let saludo = 'Hola';
    if (hora < 12) saludo = 'Buenos días';
    else if (hora < 19) saludo = 'Buenas tardes';
    else saludo = 'Buenas noches';
    const text = encodeURIComponent(
      saludo + ', ASUNTA!\n' +
      'Quiero hacer un pedido de abarrotes. ¿Me ayudas con la disponibilidad y el delivery, por favor?'
    );
    window.open('https://wa.me/' + number + '?text=' + text, '_blank');
  }

  return {
    openLookup: openLookup,
    closeLookup: closeLookup,
    doLookup: doLookup,
    openWhatsAppContact: openWhatsAppContact
  };
})();
