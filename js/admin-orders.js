/* ============================================================
   ASUNTA - js/admin-orders.js
   Panel de pedidos: listado con búsqueda, filtro por estado y
   rango de fechas; detalle completo; cambio de estado; cancelación
   con devolución automática de existencias (trigger en la BD).
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.adminOrders = (function () {
  'use strict';

  const sb = ASUNTA.sb;
  const PAGE_SIZE = 25;
  let page = 1;
  let total = 0;
  let currentOrder = null;
  let inited = false;

  async function init() {
    if (inited) { await refresh(); return; }
    inited = true;
    document.getElementById('ord-refresh').addEventListener('click', () => { page = 1; refresh(); });
    document.getElementById('ord-search').addEventListener('input', () => { page = 1; renderTable(); });
    document.getElementById('ord-status-filter').addEventListener('change', () => { page = 1; renderTable(); });
    document.getElementById('ord-date-from').addEventListener('change', () => { page = 1; renderTable(); });
    document.getElementById('ord-date-to').addEventListener('change', () => { page = 1; renderTable(); });
    document.getElementById('om-save-status').addEventListener('click', saveStatus);
    document.getElementById('om-cancel').addEventListener('click', cancelOrder);
    await refresh();
  }

  async function fetchOrders() {
    const q = document.getElementById('ord-search').value.trim().toLowerCase();
    const status = document.getElementById('ord-status-filter').value;
    const from = document.getElementById('ord-date-from').value;
    const to = document.getElementById('ord-date-to').value;

    let query = sb.from('orders')
      .select('id, order_code, customer_name, customer_phone, delivery_address, district, payment_method, payment_status, status, subtotal, delivery_cost, total, created_at, updated_at',
              { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (from) query = query.gte('created_at', from + 'T00:00:00');
    if (to) query = query.lte('created_at', to + 'T23:59:59');
    if (q) query = query.or('order_code.ilike.%' + q + '%,customer_name.ilike.%' + q + '%,customer_phone.ilike.%' + q + '%');

    const { data, error, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (error) throw error;
    total = count || 0;
    return data || [];
  }

  async function refresh() {
    const tbody = document.getElementById('ord-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 py-8">Cargando…</td></tr>';
    try {
      const orders = await fetchOrders();
      renderTable(orders);
      renderPager();
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-red-600 py-8">' + ASUNTA.esc(ASUNTA.dbErrorMessage(e)) + '</td></tr>';
    }
  }

  function renderTable(orders) {
    const tbody = document.getElementById('ord-tbody');
    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 py-8">No hay pedidos que coincidan con los filtros.</td></tr>';
      return;
    }
    tbody.innerHTML = orders.map(o => '<tr>' +
      '<td class="font-bold text-asunta-700">' + ASUNTA.esc(o.order_code || '-') + '</td>' +
      '<td class="text-xs text-slate-500">' + ASUNTA.fmtDate(o.created_at) + '</td>' +
      '<td><div class="font-semibold text-slate-800">' + ASUNTA.esc(o.customer_name) + '</div>' +
        '<div class="text-xs text-slate-400">' + ASUNTA.esc(o.customer_phone) + '</div></td>' +
      '<td class="font-semibold">' + ASUNTA.fmt(o.total) + '</td>' +
      '<td><span class="text-xs font-semibold ' + (o.payment_status === 'paid' ? 'text-asunta-700' : 'text-slate-500') + '">' + ASUNTA.esc(o.payment_status) + '</span></td>' +
      '<td>' + ASUNTA.statusBadge(o.status) + '</td>' +
      '<td class="text-right"><button data-view="' + o.id + '" class="btn-ghost text-xs"><i class="fa-solid fa-eye mr-1"></i>Ver</button></td>' +
    '</tr>').join('');

    tbody.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => openDetail(b.getAttribute('data-view'))));
  }

  function renderPager() {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    document.getElementById('ord-pager').innerHTML = pages > 1
      ? '<button id="ord-prev" class="btn-ghost text-sm ' + (page === 1 ? 'opacity-40 pointer-events-none' : '') + '">« Anterior</button>' +
        '<span class="mx-3 text-sm text-slate-500 font-semibold">Página ' + page + ' de ' + pages + ' (' + total + ' pedidos)</span>' +
        '<button id="ord-next" class="btn-ghost text-sm ' + (page === pages ? 'opacity-40 pointer-events-none' : '') + '">Siguiente »</button>'
      : (total ? '<span class="text-sm text-slate-400">' + total + ' pedido(s)</span>' : '');
    const prev = document.getElementById('ord-prev');
    const next = document.getElementById('ord-next');
    if (prev) prev.addEventListener('click', () => { page--; refresh(); });
    if (next) next.addEventListener('click', () => { page++; refresh(); });
  }

  /* ---------- Detalle ---------- */
  async function openDetail(orderId) {
    try {
      const [oRes, iRes] = await Promise.all([
        sb.from('orders').select('*').eq('id', orderId).single(),
        sb.from('order_items').select('*').eq('order_id', orderId).order('created_at')
      ]);
      if (oRes.error) throw oRes.error;
      if (iRes.error) throw iRes.error;
      currentOrder = oRes.data;
      const o = currentOrder;

      document.getElementById('om-code').textContent = o.order_code || '(sin código)';
      document.getElementById('om-date').textContent = 'Registrado: ' + ASUNTA.fmtDate(o.created_at);
      document.getElementById('om-status-badge').innerHTML = ASUNTA.statusBadge(o.status);
      document.getElementById('om-name').textContent = o.customer_name;
      const phoneEl = document.getElementById('om-phone');
      phoneEl.textContent = o.customer_phone;
      phoneEl.href = 'https://wa.me/' + String(o.customer_phone).replace(/\D/g, '');
      document.getElementById('om-email').textContent = o.customer_email || '-';
      document.getElementById('om-address').textContent = o.delivery_address;
      document.getElementById('om-ref').textContent = o.address_reference || '-';
      document.getElementById('om-district').textContent = o.district || '-';
      document.getElementById('om-notes').textContent = o.notes || '-';
      document.getElementById('om-status').value = o.status;
      document.getElementById('om-payment-status').value = o.payment_status || 'pending';
      document.getElementById('om-subtotal').textContent = ASUNTA.fmt(o.subtotal);
      document.getElementById('om-delivery').textContent = Number(o.delivery_cost) === 0 ? 'GRATIS' : ASUNTA.fmt(o.delivery_cost);
      document.getElementById('om-total').textContent = ASUNTA.fmt(o.total);
      document.getElementById('om-payment').textContent = o.payment_method || '-';

      document.getElementById('om-items').innerHTML = (iRes.data || []).map(it =>
        '<tr><td>' + ASUNTA.esc(it.product_name) + (it.product_id ? '' : ' <span class="status-badge status-preparing">combo</span>') + '</td>' +
        '<td>' + Number(it.quantity) + ' ' + ASUNTA.esc(it.unit) + '</td>' +
        '<td>' + ASUNTA.fmt(it.unit_price) + '</td>' +
        '<td class="font-semibold">' + ASUNTA.fmt(it.subtotal) + '</td></tr>'
      ).join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-4">Sin ítems registrados.</td></tr>';

      document.getElementById('order-modal').classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    } catch (e) {
      ASUNTA.toast(ASUNTA.dbErrorMessage(e), 'error');
    }
  }

  function closeModal() {
    document.getElementById('order-modal').classList.add('hidden');
    document.body.style.overflow = '';
    currentOrder = null;
  }

  /* ---------- Cambio de estado / pago ---------- */
  async function saveStatus() {
    if (!currentOrder) return;
    const newStatus = document.getElementById('om-status').value;
    const newPay = document.getElementById('om-payment-status').value;
    try {
      const { error } = await sb.from('orders').update({
        status: newStatus,
        payment_status: newPay,
        updated_at: new Date().toISOString()
      }).eq('id', currentOrder.id);
      if (error) throw error;
      ASUNTA.admin.logActivity('order.status_change', { order_code: currentOrder.order_code, status: newStatus });
      ASUNTA.toast('Pedido actualizado.' + (newStatus === 'cancelled' ? ' Existencias devueltas automáticamente.' : ''));
      closeModal();
      await refresh();
    } catch (e) {
      ASUNTA.toast(ASUNTA.dbErrorMessage(e), 'error');
    }
  }

  async function cancelOrder() {
    if (!currentOrder) return;
    if (currentOrder.status === 'cancelled') {
      ASUNTA.toast('El pedido ya está cancelado.', 'warn');
      return;
    }
    if (!confirm('¿Cancelar el pedido ' + (currentOrder.order_code || '') + '?\nLas existencias se devolverán automáticamente y el pedido quedará cerrado.')) return;
    try {
      const { error } = await sb.from('orders').update({
        status: 'cancelled',
        updated_at: new Date().toISOString()
      }).eq('id', currentOrder.id);
      if (error) throw error;
      ASUNTA.admin.logActivity('order.cancel', { order_code: currentOrder.order_code });
      ASUNTA.toast('Pedido cancelado. Existencias devueltas.');
      closeModal();
      await refresh();
    } catch (e) {
      ASUNTA.toast(ASUNTA.dbErrorMessage(e), 'error');
    }
  }

  return { init: init, refresh: refresh, closeModal: closeModal };
})();
