/* ============================================================
   ASUNTA - js/admin-products.js
   CRUD completo de productos + gestión de imágenes con
   Supabase Storage (bucket público product-images).

   Reglas:
     * El stock de productos EXISTENTES se modifica solo desde el
       módulo Inventario (para mantener el historial de movimientos).
     * No se permite eliminar un producto con historial de ventas;
       en ese caso se ofrece la desactivación lógica.
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.adminProducts = (function () {
  'use strict';

  const sb = ASUNTA.sb;
  const BUCKET = 'product-images';
  let products = [];
  let categories = [];
  let salesCount = {};   // product_id -> número de líneas vendidas
  let pendingImageFile = null;
  let removeImageFlag = false;
  let inited = false;

  async function init() {
    if (inited) { await refresh(); return; }
    inited = true;
    document.getElementById('prod-new').addEventListener('click', () => openModal(null));
    document.getElementById('prod-refresh').addEventListener('click', refresh);
    document.getElementById('prod-search').addEventListener('input', renderTable);
    document.getElementById('prod-cat-filter').addEventListener('change', renderTable);
    document.getElementById('product-form').addEventListener('submit', save);
    document.getElementById('pf-image').addEventListener('change', onImageChosen);
    document.getElementById('pf-img-clear').addEventListener('click', () => {
      pendingImageFile = null; removeImageFlag = true;
      document.getElementById('pf-img-preview').classList.add('hidden');
      document.getElementById('pf-image').value = '';
      document.getElementById('pf-img-clear').classList.add('hidden');
    });
    await refresh();
  }

  async function refresh() {
    const tbody = document.getElementById('prod-tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 py-8">Cargando…</td></tr>';
    try {
      const [pRes, cRes, sRes] = await Promise.all([
        sb.from('products').select('*, categories(id, name)').order('created_at', { ascending: false }),
        sb.from('categories').select('id, name, active').order('name'),
        sb.from('order_items').select('product_id')
      ]);
      [pRes, cRes, sRes].forEach(r => { if (r.error) throw r.error; });
      products = pRes.data || [];
      categories = cRes.data || [];
      salesCount = {};
      (sRes.data || []).forEach(it => {
        if (it.product_id) salesCount[it.product_id] = (salesCount[it.product_id] || 0) + 1;
      });
      fillCategoryOptions();
      renderTable();
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-red-600 py-8">' + ASUNTA.esc(ASUNTA.dbErrorMessage(e)) + '</td></tr>';
    }
  }

  function fillCategoryOptions() {
    const sel = document.getElementById('pf-category');
    const filter = document.getElementById('prod-cat-filter');
    sel.innerHTML = categories.map(c => '<option value="' + c.id + '">' + ASUNTA.esc(c.name) + '</option>').join('');
    const current = filter.value;
    filter.innerHTML = '<option value="">Todas las categorías</option>' +
      categories.map(c => '<option value="' + c.id + '">' + ASUNTA.esc(c.name) + '</option>').join('');
    filter.value = current;
  }

  function renderTable() {
    const tbody = document.getElementById('prod-tbody');
    const q = document.getElementById('prod-search').value.trim().toLowerCase();
    const cat = document.getElementById('prod-cat-filter').value;
    const list = products.filter(p => {
      const okQ = !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q);
      const okC = !cat || p.category_id === cat;
      return okQ && okC;
    });
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 py-8">No hay productos que coincidan.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(p => {
      const hasSales = (salesCount[p.id] || 0) > 0;
      const stock = Number(p.stock);
      const stockCls = stock <= 0 ? 'status-cancelled' : (stock <= 10 ? 'status-pending' : 'status-delivered');
      const stockTxt = stock <= 0 ? 'AGOTADO' : ('Stock: ' + stock);
      const catName = p.categories ? p.categories.name : '-';
      const img = p.image_url
        ? '<img src="' + ASUNTA.esc(p.image_url) + '" class="w-10 h-10 rounded-lg object-cover img-thumb" alt="">'
        : '<div class="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300"><i class="fa-solid fa-image"></i></div>';
      return '<tr>' +
        '<td><div class="flex items-center gap-3">' + img +
          '<div><div class="font-semibold text-slate-800">' + ASUNTA.esc(p.name) + '</div>' +
          '<div class="text-xs text-slate-400">' + ASUNTA.esc(p.sku || '') + '</div></div></div></td>' +
        '<td>' + ASUNTA.esc(catName) + '</td>' +
        '<td class="font-semibold">' + ASUNTA.fmt(p.price) + '</td>' +
        '<td>' + (p.cost_price ? ASUNTA.fmt(p.cost_price) : '-') + '</td>' +
        '<td><span class="status-badge ' + stockCls + '">' + stockTxt + '</span></td>' +
        '<td>' + (p.active
          ? '<span class="status-badge status-delivered">Activo</span>'
          : '<span class="status-badge status-cancelled">Inactivo</span>') + '</td>' +
        '<td><div class="flex items-center gap-1 justify-end">' +
          '<button data-edit="' + p.id + '" class="w-8 h-8 rounded-lg bg-slate-100 hover:bg-asunta-100 text-slate-600 hover:text-asunta-700" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
          '<button data-toggle="' + p.id + '" class="w-8 h-8 rounded-lg bg-slate-100 hover:bg-amber-100 text-slate-600 hover:text-amber-700" title="' + (p.active ? 'Desactivar' : 'Activar') + '"><i class="fa-solid fa-power-off"></i></button>' +
          (hasSales
            ? '<button disabled class="w-8 h-8 rounded-lg bg-slate-100 text-slate-300 cursor-not-allowed" title="Tiene historial de ventas: usa Desactivar"><i class="fa-solid fa-trash"></i></button>'
            : '<button data-del="' + p.id + '" class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-500" title="Eliminar"><i class="fa-solid fa-trash"></i></button>') +
        '</div></td></tr>';
    }).join('');

    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openModal(products.find(x => x.id === b.getAttribute('data-edit')))));
    tbody.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleActive(products.find(x => x.id === b.getAttribute('data-toggle')))));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => remove(products.find(x => x.id === b.getAttribute('data-del')))));
  }

  /* ---------- Modal ---------- */
  function openModal(p) {
    const isNew = !p;
    document.getElementById('product-modal-title').textContent = isNew ? 'Nuevo producto' : 'Editar: ' + p.name;
    document.getElementById('pf-id').value = isNew ? '' : p.id;
    document.getElementById('pf-name').value = isNew ? '' : p.name;
    document.getElementById('pf-desc').value = isNew ? '' : (p.description || '');
    document.getElementById('pf-category').value = isNew ? (categories[0] ? categories[0].id : '') : (p.category_id || '');
    document.getElementById('pf-sku').value = isNew ? '' : (p.sku || '');
    document.getElementById('pf-price').value = isNew ? '' : p.price;
    document.getElementById('pf-cost').value = isNew ? '' : (p.cost_price || '');
    document.getElementById('pf-unit').value = isNew ? 'unidad' : (p.unit || 'unidad');
    const stockInput = document.getElementById('pf-stock');
    stockInput.value = isNew ? '' : Number(p.stock);
    stockInput.disabled = !isNew;
    document.getElementById('pf-stock-hint').classList.toggle('hidden', isNew);
    document.getElementById('pf-active').checked = isNew ? true : p.active;
    document.getElementById('pf-featured').checked = isNew ? false : p.featured;

    pendingImageFile = null;
    removeImageFlag = false;
    const preview = document.getElementById('pf-img-preview');
    if (p && p.image_url) { preview.src = p.image_url; preview.classList.remove('hidden'); document.getElementById('pf-img-clear').classList.remove('hidden'); }
    else { preview.classList.add('hidden'); document.getElementById('pf-img-clear').classList.add('hidden'); }
    document.getElementById('pf-image').value = '';
    document.getElementById('pf-img-progress').classList.add('hidden');

    document.getElementById('product-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('product-modal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  /* ---------- Imágenes (Supabase Storage) ---------- */
  function onImageChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      ASUNTA.toast('Formato no permitido. Usa JPG, PNG o WEBP.', 'error');
      e.target.value = ''; return;
    }
    if (file.size > 2 * 1024 * 1024) {
      ASUNTA.toast('La imagen supera 2 MB.', 'error');
      e.target.value = ''; return;
    }
    pendingImageFile = file;
    removeImageFlag = false;
    const preview = document.getElementById('pf-img-preview');
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
    document.getElementById('pf-img-clear').classList.remove('hidden');
  }

  function imagePathFromUrl(url) {
    try {
      const marker = '/' + BUCKET + '/';
      const i = url.indexOf(marker);
      return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
    } catch (_) { return null; }
  }

  async function uploadImage(productId) {
    const file = pendingImageFile;
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type] || 'jpg';
    const path = 'products/' + productId + '-' + Date.now() + '.' + ext;
    const prog = document.getElementById('pf-img-progress');
    prog.classList.remove('hidden');
    prog.textContent = 'Subiendo fotografía…';
    const { error } = await sb.storage.from(BUCKET).upload(path, file, {
      contentType: file.type, upsert: false
    });
    if (error) { prog.classList.add('hidden'); throw new Error('No se pudo subir la imagen: ' + error.message); }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    prog.classList.add('hidden');
    return data.publicUrl;
  }

  async function deleteImageByUrl(url) {
    const path = imagePathFromUrl(url);
    if (!path) return;
    try { await sb.storage.from(BUCKET).remove([path]); } catch (_) { /* no crítico */ }
  }

  /* ---------- Guardar (CREATE / UPDATE) ---------- */
  async function save(e) {
    e.preventDefault();
    const btn = document.getElementById('pf-save');
    const id = document.getElementById('pf-id').value;
    const name = document.getElementById('pf-name').value.trim();
    const price = Number(document.getElementById('pf-price').value);
    const categoryId = document.getElementById('pf-category').value || null;
    const stock = Number(document.getElementById('pf-stock').value || 0);
    const isNew = !id;

    if (name.length < 2) { ASUNTA.toast('El nombre del producto es obligatorio.', 'error'); return; }
    if (!(price > 0)) { ASUNTA.toast('Ingresa un precio válido.', 'error'); return; }
    if (isNew && !(stock >= 0)) { ASUNTA.toast('Ingresa un stock inicial válido.', 'error'); return; }

    const payload = {
      name: name,
      description: document.getElementById('pf-desc').value.trim() || null,
      category_id: categoryId,
      sku: document.getElementById('pf-sku').value.trim() || null,
      price: price,
      cost_price: Number(document.getElementById('pf-cost').value || 0),
      unit: document.getElementById('pf-unit').value,
      active: document.getElementById('pf-active').checked,
      featured: document.getElementById('pf-featured').checked,
      updated_at: new Date().toISOString()
    };

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Guardando…';
    try {
      let productId = id;
      if (isNew) {
        const { data, error } = await sb.from('products').insert(payload).select('id').single();
        if (error) throw error;
        productId = data.id;
        if (stock > 0) {
          // Stock inicial con movimiento trazable
          const { error: e2 } = await sb.rpc('adjust_stock', {
            p_product_id: productId, p_movement_type: 'ajuste',
            p_quantity: null, p_new_stock: stock,
            p_notes: 'Stock inicial al registrar el producto'
          });
          if (e2) throw e2;
        }
      } else {
        const { error } = await sb.from('products').update(payload).eq('id', id);
        if (error) throw error;
      }

      // Imagen: subir / reemplazar / quitar
      if (pendingImageFile) {
        const oldUrl = (products.find(x => x.id === productId) || {}).image_url;
        const url = await uploadImage(productId);
        const { error: e3 } = await sb.from('products').update({ image_url: url }).eq('id', productId);
        if (e3) throw e3;
        if (oldUrl) await deleteImageByUrl(oldUrl);
      } else if (removeImageFlag) {
        const oldUrl = (products.find(x => x.id === productId) || {}).image_url;
        const { error: e4 } = await sb.from('products').update({ image_url: null }).eq('id', productId);
        if (e4) throw e4;
        if (oldUrl) await deleteImageByUrl(oldUrl);
      }

      ASUNTA.admin.logActivity(isNew ? 'product.create' : 'product.update', { id: productId, name: name });
      ASUNTA.toast(isNew ? 'Producto registrado.' : 'Producto actualizado.');
      closeModal();
      await refresh();
    } catch (err) {
      ASUNTA.toast(ASUNTA.dbErrorMessage(err), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1"></i> Guardar producto';
    }
  }

  /* ---------- Activar / desactivar / eliminar ---------- */
  async function toggleActive(p) {
    const { error } = await sb.from('products').update({ active: !p.active, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) { ASUNTA.toast(ASUNTA.dbErrorMessage(error), 'error'); return; }
    ASUNTA.admin.logActivity(p.active ? 'product.deactivate' : 'product.activate', { id: p.id, name: p.name });
    ASUNTA.toast(p.active ? 'Producto desactivado (oculto de la tienda).' : 'Producto activado.');
    await refresh();
  }

  async function remove(p) {
    if ((salesCount[p.id] || 0) > 0) {
      ASUNTA.toast('Este producto tiene historial de ventas. Desactívalo para retirarlo de la tienda sin perder el historial.', 'warn');
      return;
    }
    if (!confirm('¿Eliminar definitivamente "' + p.name + '"? Esta acción no se puede deshacer.')) return;
    try {
      /*
       * NOTA: los movimientos de inventario NO se eliminan (el historial es
       * inmutable y la RLS no permite borrarlos). Al borrar el producto, la
       * clave foránea (ON DELETE SET NULL) deja los movimientos con
       * product_id NULL y se muestran como "(producto eliminado)".
       */
      if (p.image_url) await deleteImageByUrl(p.image_url);
      const { error } = await sb.from('products').delete().eq('id', p.id);
      if (error) throw error;
      ASUNTA.admin.logActivity('product.delete', { id: p.id, name: p.name });
      ASUNTA.toast('Producto eliminado.');
      await refresh();
    } catch (e) {
      ASUNTA.toast(ASUNTA.dbErrorMessage(e), 'error');
    }
  }

  return { init: init, refresh: refresh, closeModal: closeModal };
})();
