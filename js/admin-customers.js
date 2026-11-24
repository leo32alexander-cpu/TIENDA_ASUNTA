/* ============================================================
   ASUNTA - js/admin-customers.js
   Módulo del panel admin: gestión de clientes registrados.

   Permite:
     * Ver el listado completo de clientes (con # pedidos y total comprado)
     * Buscar por nombre o teléfono
     * Ver el detalle de un cliente (datos + historial de pedidos)

   Los datos se obtienen de la función SQL pública list_customers()
   (definida en sql/06_clientes.sql, security definer, solo admin).
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.adminCustomers = (function () {
  'use strict';

  const sb = ASUNTA.sb;
  let customers = [];
  let inited = false;

  async function init() {
    if (inited) { await refresh(); return; }
    inited = true;
    document.getElementById('cust-refresh').addEventListener('click', refresh);
    document.getElementById('cust-search').addEventListener('input', renderTable);
    await refresh();
  }

  async function refresh() {
    const tbody = document.getElementById('cust-tbody');
    tbody.innerHTML =
      '<tr><td colspan="6" class="text-center text-slate-400 py-8">Cargando clientes…</td></tr>';
    try {
      const { data, error } = await sb.rpc('list_customers');
      if (error) throw error;
      customers = data || [];
      renderTable();
    } catch (e) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="text-center text-red-600 py-8">' +
          ASUNTA.esc(ASUNTA.dbErrorMessage(e)) +
        '</td></tr>';
    }
  }

  function renderTable() {
    const tbody = document.getElementById('cust-tbody');
    const q = (document.getElementById('cust-search').value || '').trim().toLowerCase();
    const list = customers.filter(c => {
      if (!q) return true;
      const name = (c.full_name || '').toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      const district = (c.default_district || '').toLowerCase();
      return name.indexOf(q) !== -1 || phone.indexOf(q) !== -1 || district.indexOf(q) !== -1;
    });

    if (!list.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="text-center text-slate-400 py-8">' +
          (customers.length ? 'No hay clientes que coincidan con la búsqueda.' : 'Aún no hay clientes registrados. Cuando alguien cree una cuenta desde cuenta.html aparecerá aquí.') +
        '</td></tr>';
      // Contador
      const counter = document.getElementById('cust-count');
      if (counter) counter.textContent = customers.length + ' cliente(s)';
      return;
    }

    tbody.innerHTML = list.map(c => {
      const orders = Number(c.orders_count || 0);
      const spent = Number(c.total_spent || 0);
      const name = c.full_name || '(sin nombre)';
      const initials = (name.trim().charAt(0) || '?').toUpperCase();
      const phone = c.phone || '-';
      const district = c.default_district || '-';
      const address = c.default_address || '-';
      return '<tr>' +
        '<td><div class="flex items-center gap-3">' +
          '<div class="w-9 h-9 rounded-full bg-asunta-100 text-asunta-700 font-black flex items-center justify-center text-sm">' + ASUNTA.esc(initials) + '</div>' +
          '<div><div class="font-semibold text-slate-800">' + ASUNTA.esc(name) + '</div>' +
          '<div class="text-xs text-slate-400">Desde ' + ASUNTA.fmtDate(c.created_at) + '</div></div></div></td>' +
        '<td class="font-semibold text-slate-700">' + ASUNTA.esc(phone) + '</td>' +
        '<td class="text-xs text-slate-500"><div>' + ASUNTA.esc(address) + '</div>' +
          '<div class="text-slate-400">' + ASUNTA.esc(district) + '</div></td>' +
        '<td class="text-center font-bold ' + (orders > 0 ? 'text-asunta-700' : 'text-slate-400') + '">' + orders + '</td>' +
        '<td class="font-semibold ' + (spent > 0 ? 'text-asunta-700' : 'text-slate-400') + '">' + ASUNTA.fmt(spent) + '</td>' +
        '<td class="text-right"><button data-view="' + ASUNTA.esc(c.id) + '" class="btn-ghost text-xs" title="Ver detalle"><i class="fa-solid fa-eye mr-1"></i>Ver</button></td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-view]').forEach(b => {
      b.addEventListener('click', () => openDetail(b.getAttribute('data-view')));
    });

    const counter = document.getElementById('cust-count');
    if (counter) counter.textContent = customers.length + ' cliente(s)';
  }

  /* ---------- Detalle ---------- */
  async function openDetail(customerId) {
    const c = customers.find(x => String(x.id) === String(customerId));
    if (!c) return;
    const modal = document.getElementById('customer-modal');
    if (!modal) return;

    // Cabecera
    document.getElementById('cm-name').textContent = c.full_name || '(sin nombre)';
    document.getElementById('cm-phone').textContent = c.phone || '-';
    document.getElementById('cm-address').textContent = c.default_address || '-';
    document.getElementById('cm-district').textContent = c.default_district || '-';
    document.getElementById('cm-created').textContent = ASUNTA.fmtDate(c.created_at);
    document.getElementById('cm-orders-count').textContent = String(c.orders_count || 0);
    document.getElementById('cm-total-spent').textContent = ASUNTA.fmt(c.total_spent || 0);

    // Historial de pedidos: los pedidos donde user_id = c.id
    const listEl = document.getElementById('cm-orders-list');
    listEl.innerHTML =
      '<div class="py-4 flex justify-center"><i class="fa-solid fa-spinner fa-spin text-asunta-600"></i></div>';
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    try {
      const { data, error } = await sb
        .from('orders')
        .select('id, order_code, status, total, created_at, payment_method, payment_status')
        .eq('user_id', customerId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const orders = data || [];
      if (!orders.length) {
        listEl.innerHTML = '<p class="text-xs text-slate-400 py-3">Este cliente aún no tiene pedidos.</p>';
        return;
      }
      listEl.innerHTML = orders.map(o => (
        '<div class="flex items-center justify-between border border-slate-200 rounded-xl px-3 py-2 text-sm">' +
          '<div class="flex items-center gap-3">' +
            '<span class="font-bold text-asunta-700">' + ASUNTA.esc(o.order_code) + '</span>' +
            ASUNTA.statusBadge(o.status) +
          '</div>' +
          '<div class="flex items-center gap-3">' +
            '<span class="text-xs text-slate-400">' + ASUNTA.fmtDate(o.created_at) + '</span>' +
            '<span class="font-semibold text-slate-700">' + ASUNTA.fmt(o.total) + '</span>' +
          '</div>' +
        '</div>'
      )).join('');
    } catch (e) {
      listEl.innerHTML =
        '<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs">' +
          ASUNTA.esc(ASUNTA.dbErrorMessage(e)) +
        '</div>';
    }
  }

  function closeDetail() {
    const modal = document.getElementById('customer-modal');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  return {
    init: init,
    refresh: refresh,
    closeDetail: closeDetail
  };
})();
