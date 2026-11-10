/* ============================================================
   ASUNTA - js/inventory.js
   Control de inventario:
     * Stock actual por producto con alertas de stock bajo/agotado.
     * Registro de ENTRADAS de mercadería y ajustes justificados
       mediante la función segura adjust_stock (solo administrador).
     * Las ventas descontaron existencias automáticamente (create_order)
       y quedaron en el historial de movimientos.
     * No se permite stock negativo (validado en la base de datos).
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.inventory = (function () {
  'use strict';

  const sb = ASUNTA.sb;
  let products = [];
  let movements = [];
  let lowThreshold = 10;
  let inited = false;

  async function init() {
    if (inited) { await refresh(); return; }
    inited = true;
    document.getElementById('inv-refresh').addEventListener('click', refresh);
    document.getElementById('inv-search').addEventListener('input', renderTable);
    document.getElementById('inv-filter').addEventListener('change', renderTable);
    document.getElementById('inv-mv-filter').addEventListener('change', renderMovements);
    document.getElementById('inv-form').addEventListener('submit', submitMovement);
    await refresh();
  }

  async function refresh() {
    document.getElementById('inv-tbody').innerHTML =
      '<tr><td colspan="4" class="text-center text-slate-400 py-8">Cargando…</td></tr>';
    try {
      const settingsRow = await ASUNTA.getSettings();
      lowThreshold = Number(settingsRow.low_stock_threshold) || 10;
      const [pRes, mRes] = await Promise.all([
        sb.from('products').select('id, name, stock, unit, active').order('name'),
        sb.from('inventory_movements')
          .select('*, products(name)')
          .order('created_at', { ascending: false })
          .limit(150)
      ]);
      [pRes, mRes].forEach(r => { if (r.error) throw r.error; });
      products = pRes.data || [];
      movements = mRes.data || [];
      renderSummary();
      renderTable();
      renderMovements();
    } catch (e) {
      document.getElementById('inv-tbody').innerHTML =
        '<tr><td colspan="4" class="text-center text-red-600 py-8">' + ASUNTA.esc(ASUNTA.dbErrorMessage(e)) + '</td></tr>';
    }
  }

  function renderSummary() {
    const out = products.filter(p => Number(p.stock) <= 0).length;
    const low = products.filter(p => Number(p.stock) > 0 && Number(p.stock) <= lowThreshold).length;
    const totalUnits = products.reduce((s, p) => s + Number(p.stock), 0);
    const box = (icon, color, value, label) =>
      '<div class="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">' +
        '<div class="w-11 h-11 rounded-xl flex items-center justify-center text-lg ' + color + '">' +
          '<i class="fa-solid ' + icon + '"></i></div>' +
        '<div><div class="text-xl font-black text-slate-900 leading-none">' + value + '</div>' +
        '<div class="text-xs text-slate-500 mt-1 font-medium">' + label + '</div></div>' +
      '</div>';
    document.getElementById('inv-summary').innerHTML =
      box('fa-circle-check', 'bg-asunta-100 text-asunta-700', totalUnits, 'Unidades totales en stock') +
      box('fa-triangle-exclamation', 'bg-amber-100 text-amber-700', low, 'Productos con stock bajo') +
      box('fa-circle-xmark', 'bg-red-100 text-red-600', out, 'Productos agotados');
  }

  function renderTable() {
    const tbody = document.getElementById('inv-tbody');
    const q = document.getElementById('inv-search').value.trim().toLowerCase();
    const filter = document.getElementById('inv-filter').value;
    const list = products.filter(p => {
      const okQ = !q || p.name.toLowerCase().includes(q);
      const st = Number(p.stock);
      const okF = !filter || (filter === 'low' && st > 0 && st <= lowThreshold) || (filter === 'out' && st <= 0);
      return okQ && okF;
    });
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-slate-400 py-8">Sin productos que coincidan.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(p => {
      const st = Number(p.stock);
      const cls = st <= 0 ? 'status-cancelled' : (st <= lowThreshold ? 'status-pending' : 'status-delivered');
      const txt = st <= 0 ? 'AGOTADO' : (st <= lowThreshold ? 'STOCK BAJO' : 'DISPONIBLE');
      return '<tr>' +
        '<td><div class="font-semibold text-slate-800">' + ASUNTA.esc(p.name) + '</div>' +
          '<div class="text-xs text-slate-400">' + ASUNTA.esc(p.unit) + (p.active ? '' : ' • inactivo') + '</div></td>' +
        '<td class="font-black ' + (st <= 0 ? 'text-red-600' : st <= lowThreshold ? 'text-amber-600' : 'text-asunta-700') + '">' + st + '</td>' +
        '<td><span class="status-badge ' + cls + '">' + txt + '</span></td>' +
        '<td><div class="flex gap-1 justify-end">' +
          '<button data-mv="entrada" data-id="' + p.id + '" class="btn-ghost text-xs"><i class="fa-solid fa-arrow-down text-asunta-600 mr-1"></i>Entrada</button>' +
          '<button data-mv="salida" data-id="' + p.id + '" class="btn-ghost text-xs"><i class="fa-solid fa-arrow-up text-amber-600 mr-1"></i>Salida</button>' +
          '<button data-mv="ajuste" data-id="' + p.id + '" class="btn-ghost text-xs"><i class="fa-solid fa-scale-balanced text-slate-500 mr-1"></i>Ajuste</button>' +
        '</div></td></tr>';
    }).join('');

    tbody.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', () => openModal(
      b.getAttribute('data-mv'),
      products.find(x => x.id === b.getAttribute('data-id'))
    )));
  }

  function renderMovements() {
    const tbody = document.getElementById('mv-tbody');
    const filter = document.getElementById('inv-mv-filter').value;
    const list = movements.filter(m => !filter || m.movement_type === filter);
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 py-8">Aún no hay movimientos registrados.</td></tr>';
      return;
    }
    const typeBadge = t => t === 'entrada'
      ? '<span class="status-badge status-delivered">Entrada</span>'
      : t === 'salida' ? '<span class="status-badge status-preparing">Salida</span>'
                       : '<span class="status-badge status-confirmed">Ajuste</span>';
    tbody.innerHTML = list.map(m => '<tr>' +
      '<td class="text-xs text-slate-500">' + ASUNTA.fmtDate(m.created_at) + '</td>' +
      '<td class="font-semibold text-slate-700">' + ASUNTA.esc(m.products ? m.products.name : '(producto eliminado)') + '</td>' +
      '<td>' + typeBadge(m.movement_type) + '</td>' +
      '<td>' + Number(m.quantity) + '</td>' +
      '<td>' + Number(m.previous_stock) + '</td>' +
      '<td class="font-semibold">' + Number(m.new_stock) + '</td>' +
      '<td class="text-xs text-slate-500">' + ASUNTA.esc(m.reference ? (m.reference + ' — ') : '') + ASUNTA.esc(m.notes || '') + '</td>' +
    '</tr>').join('');
  }

  /* ---------- Modal de movimiento ---------- */
  function openModal(type, p) {
    if (!p) return;
    document.getElementById('im-type').value = type;
    document.getElementById('im-product-id').value = p.id;
    document.getElementById('im-product-name').textContent = p.name;
    document.getElementById('im-current').textContent = Number(p.stock) + ' ' + p.unit;

    const qtyBox = document.getElementById('im-qty-box');
    const adjustBox = document.getElementById('im-adjust-box');
    const qtyInput = document.getElementById('im-qty');
    const notesLabel = document.getElementById('im-notes-label');
    const notesHint = document.getElementById('im-notes-hint');
    const titles = {
      entrada: 'Registrar entrada de mercadería',
      salida: 'Registrar salida de stock',
      ajuste: 'Ajuste de inventario'
    };
    document.getElementById('inv-modal-title').textContent = titles[type];
    qtyBox.classList.toggle('hidden', type === 'ajuste');
    adjustBox.classList.toggle('hidden', type !== 'ajuste');
    qtyInput.value = '';
    document.getElementById('im-adjust').value = Number(p.stock);
    document.getElementById('im-notes').value = '';
    notesLabel.textContent = type === 'entrada' ? 'Nota (opcional)' : 'Justificación (obligatoria)';
    notesHint.textContent = type === 'ajuste'
      ? 'El stock quedará fijado al valor que indiques; se registra la diferencia como ajuste.'
      : 'Las salidas y los ajustes requieren una justificación para mantener el historial claro.';

    document.getElementById('inv-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('inv-modal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  async function submitMovement(e) {
    e.preventDefault();
    const type = document.getElementById('im-type').value;
    const productId = document.getElementById('im-product-id').value;
    const notes = document.getElementById('im-notes').value.trim();
    const qty = Number(document.getElementById('im-qty').value);
    const newStock = Number(document.getElementById('im-adjust').value);

    if (type !== 'ajuste' && !(qty > 0)) { ASUNTA.toast('Ingresa una cantidad mayor a cero.', 'error'); return; }
    if ((type === 'salida' || type === 'ajuste') && notes.length < 3) {
      ASUNTA.toast('La salida o el ajuste requiere una justificación.', 'error'); return;
    }

    try {
      const { data, error } = await sb.rpc('adjust_stock', {
        p_product_id: productId,
        p_movement_type: type,
        p_quantity: type === 'ajuste' ? null : qty,
        p_new_stock: type === 'ajuste' ? newStock : null,
        p_notes: notes || null
      });
      if (error) throw error;
      ASUNTA.admin.logActivity('inventory.' + type, { product_id: productId, result: data });
      ASUNTA.toast('Movimiento registrado: stock ' + Number(data.previous_stock) + ' → ' + Number(data.new_stock) + '.');
      closeModal();
      await refresh();
    } catch (err) {
      ASUNTA.toast(ASUNTA.dbErrorMessage(err), 'error');
    }
  }

  return { init: init, refresh: refresh, closeModal: closeModal };
})();
