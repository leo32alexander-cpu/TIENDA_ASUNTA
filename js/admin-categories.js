/* ============================================================
   ASUNTA - js/admin-categories.js
   CRUD de categorías. Las categorías del catálogo público se
   obtienen SIEMPRE de Supabase (nunca escritas en el HTML).
   No se puede eliminar una categoría con productos asociados.
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.adminCategories = (function () {
  'use strict';

  const sb = ASUNTA.sb;
  let categories = [];
  let productCounts = {};
  let inited = false;

  async function init() {
    if (inited) { await refresh(); return; }
    inited = true;
    document.getElementById('cat-new').addEventListener('click', () => openModal(null));
    document.getElementById('cat-refresh').addEventListener('click', refresh);
    document.getElementById('category-form').addEventListener('submit', save);
    await refresh();
  }

  async function refresh() {
    const tbody = document.getElementById('cat-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-slate-400 py-8">Cargando…</td></tr>';
    try {
      const [cRes, pRes] = await Promise.all([
        sb.from('categories').select('*').order('name'),
        sb.from('products').select('category_id')
      ]);
      [cRes, pRes].forEach(r => { if (r.error) throw r.error; });
      categories = cRes.data || [];
      productCounts = {};
      (pRes.data || []).forEach(p => {
        productCounts[p.category_id] = (productCounts[p.category_id] || 0) + 1;
      });
      renderTable();
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-red-600 py-8">' + ASUNTA.esc(ASUNTA.dbErrorMessage(e)) + '</td></tr>';
    }
  }

  function renderTable() {
    const tbody = document.getElementById('cat-tbody');
    if (!categories.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-slate-400 py-8">No hay categorías registradas.</td></tr>';
      return;
    }
    tbody.innerHTML = categories.map(c => {
      const n = productCounts[c.id] || 0;
      return '<tr>' +
        '<td class="font-semibold text-slate-800">' + ASUNTA.esc(c.name) + '</td>' +
        '<td class="text-slate-500 text-sm">' + ASUNTA.esc(c.description || '-') + '</td>' +
        '<td>' + n + (n === 1 ? ' producto' : ' productos') + '</td>' +
        '<td>' + (c.active ? '<span class="status-badge status-delivered">Activa</span>' : '<span class="status-badge status-cancelled">Inactiva</span>') + '</td>' +
        '<td><div class="flex items-center gap-1 justify-end">' +
          '<button data-edit="' + c.id + '" class="w-8 h-8 rounded-lg bg-slate-100 hover:bg-asunta-100 text-slate-600 hover:text-asunta-700" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
          '<button data-toggle="' + c.id + '" class="w-8 h-8 rounded-lg bg-slate-100 hover:bg-amber-100 text-slate-600 hover:text-amber-700" title="' + (c.active ? 'Desactivar' : 'Activar') + '"><i class="fa-solid fa-power-off"></i></button>' +
          (n > 0
            ? '<button disabled class="w-8 h-8 rounded-lg bg-slate-100 text-slate-300 cursor-not-allowed" title="Tiene productos asociados"><i class="fa-solid fa-trash"></i></button>'
            : '<button data-del="' + c.id + '" class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-500" title="Eliminar"><i class="fa-solid fa-trash"></i></button>') +
        '</div></td></tr>';
    }).join('');

    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openModal(categories.find(x => x.id === b.getAttribute('data-edit')))));
    tbody.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleActive(categories.find(x => x.id === b.getAttribute('data-toggle')))));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => remove(categories.find(x => x.id === b.getAttribute('data-del')))));
  }

  function openModal(c) {
    document.getElementById('category-modal-title').textContent = c ? 'Editar: ' + c.name : 'Nueva categoría';
    document.getElementById('cf-id').value = c ? c.id : '';
    document.getElementById('cf-name').value = c ? c.name : '';
    document.getElementById('cf-desc').value = c ? (c.description || '') : '';
    document.getElementById('cf-active').checked = c ? c.active : true;
    document.getElementById('category-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('category-modal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  async function save(e) {
    e.preventDefault();
    const id = document.getElementById('cf-id').value;
    const name = document.getElementById('cf-name').value.trim();
    if (name.length < 2) { ASUNTA.toast('El nombre de la categoría es obligatorio.', 'error'); return; }
    const payload = {
      name: name,
      description: document.getElementById('cf-desc').value.trim() || null,
      active: document.getElementById('cf-active').checked
    };
    const isNew = !id;
    const { error } = isNew
      ? await sb.from('categories').insert(payload)
      : await sb.from('categories').update(payload).eq('id', id);
    if (error) { ASUNTA.toast(ASUNTA.dbErrorMessage(error), 'error'); return; }
    ASUNTA.admin.logActivity(isNew ? 'category.create' : 'category.update', { name: name });
    ASUNTA.toast(isNew ? 'Categoría registrada.' : 'Categoría actualizada.');
    closeModal();
    await refresh();
  }

  async function toggleActive(c) {
    const { error } = await sb.from('categories').update({ active: !c.active }).eq('id', c.id);
    if (error) { ASUNTA.toast(ASUNTA.dbErrorMessage(error), 'error'); return; }
    ASUNTA.admin.logActivity(c.active ? 'category.deactivate' : 'category.activate', { name: c.name });
    await refresh();
  }

  async function remove(c) {
    if ((productCounts[c.id] || 0) > 0) {
      ASUNTA.toast('No se puede eliminar: tiene productos asociados. Desactiva la categoría o reubica sus productos.', 'warn');
      return;
    }
    if (!confirm('¿Eliminar la categoría "' + c.name + '"?')) return;
    const { error } = await sb.from('categories').delete().eq('id', c.id);
    if (error) { ASUNTA.toast(ASUNTA.dbErrorMessage(error), 'error'); return; }
    ASUNTA.admin.logActivity('category.delete', { name: c.name });
    ASUNTA.toast('Categoría eliminada.');
    await refresh();
  }

  return { init: init, refresh: refresh, closeModal: closeModal };
})();
