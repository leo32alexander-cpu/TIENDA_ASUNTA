
/* =====================================================
   ASUNTA - js/productos-admin.js
   Administración de productos e imágenes
   Supabase + Storage product-images
   ===================================================== */

(function () {
  'use strict';

  const sb = window.ASUNTA.sb;
  const ASUNTA = window.ASUNTA;

  const BUCKET = 'product-images';
  const MAX_SIZE = 2 * 1024 * 1024;

  const $ = id => document.getElementById(id);

  let products = [];
  let categories = [];
  let currentUser = null;

  // =========================================
  // NOTIFICACIONES
  // =========================================

  function notify(message, type = 'success') {
    ASUNTA.toast(message, type);
  }

  function handleError(error) {
    console.error('[ASUNTA PRODUCTOS]', error);
    notify(ASUNTA.dbErrorMessage(error), 'error');
  }

  // =========================================
  // AUTENTICACIÓN
  // =========================================

  async function checkAdmin() {
    const { data, error } = await sb.auth.getSession();

    if (error) {
      handleError(error);
      return;
    }

    if (!data.session) {
      showLogin();
      return;
    }

    currentUser = data.session.user;
    await verifyAdmin();
  }

  async function verifyAdmin() {
    const { data, error } = await sb
      .from('admin_users')
      .select('user_id')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (error || !data) {
      await sb.auth.signOut();
      currentUser = null;
      showLogin();

      notify(
        'No tienes permisos para administrar productos.',
        'error'
      );
      return;
    }

    $('loginSection').hidden = true;
    $('adminPanel').hidden = false;

    await loadCategories();
    await loadProducts();
  }

  function showLogin() {
    $('loginSection').hidden = false;
    $('adminPanel').hidden = true;
  }

  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();

    const { data, error } = await sb.auth.signInWithPassword({
      email: $('email').value.trim(),
      password: $('password').value
    });

    if (error) {
      handleError(error);
      return;
    }

    currentUser = data.user;
    await verifyAdmin();
  });

  $('logoutButton').addEventListener('click', async () => {
    const { error } = await sb.auth.signOut();

    if (error) {
      handleError(error);
      return;
    }

    currentUser = null;
    showLogin();
    notify('Sesión cerrada correctamente.');
  });

  // =========================================
  // CATEGORÍAS
  // =========================================

  async function loadCategories() {
    const { data, error } = await sb
      .from('categories')
      .select('id,name')
      .eq('active', true)
      .order('name');

    if (error) {
      handleError(error);
      return;
    }

    categories = data || [];

    const select = $('category');
    select.replaceChildren();

    const optionDefault = document.createElement('option');
    optionDefault.value = '';
    optionDefault.textContent = 'Sin categoría';

    select.appendChild(optionDefault);

    categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      select.appendChild(option);
    });
  }

  // =========================================
  // CARGAR PRODUCTOS
  // =========================================

  async function loadProducts() {
    const { data, error } = await sb
      .from('products')
      .select('*, categories(name)')
      .order('created_at', { ascending: false });

    if (error) {
      handleError(error);
      return;
    }

    products = data || [];
    renderProducts();
  }

  // =========================================
  // LISTADO
  // =========================================

  function renderProducts() {
    const tbody = $('productList');
    tbody.replaceChildren();

    const search = $('adminSearch').value
      .trim()
      .toLowerCase();

    const filtered = products.filter(product =>
      product.name.toLowerCase().includes(search) ||
      (product.sku || '').toLowerCase().includes(search)
    );

    if (!filtered.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');

      td.colSpan = 6;
      td.textContent = 'No se encontraron productos.';

      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    filtered.forEach(product => {
      const tr = document.createElement('tr');

      const imageCell = document.createElement('td');

      if (product.image_url) {
        const img = document.createElement('img');

        img.src = product.image_url;
        img.alt = product.name;
        img.className = 'table-image';

        imageCell.appendChild(img);
      } else {
        imageCell.textContent = 'Sin imagen';
      }

      const nameCell = document.createElement('td');
      nameCell.textContent = product.name;

      const priceCell = document.createElement('td');
      priceCell.textContent = ASUNTA.fmt(product.price);

      const stockCell = document.createElement('td');
      stockCell.textContent =
        `${product.stock} ${product.unit}`;

      const statusCell = document.createElement('td');
      statusCell.textContent =
        product.active ? 'Activo' : 'Inactivo';

      const actionsCell = document.createElement('td');

      const editButton = document.createElement('button');
      editButton.textContent = 'Editar';
      editButton.onclick = () => editProduct(product.id);

      const toggleButton = document.createElement('button');
      toggleButton.textContent =
        product.active ? 'Desactivar' : 'Activar';

      toggleButton.onclick = () => toggleProduct(product.id);

      actionsCell.append(editButton, toggleButton);

      tr.append(
        imageCell,
        nameCell,
        priceCell,
        stockCell,
        statusCell,
        actionsCell
      );

      tbody.appendChild(tr);
    });
  }

  $('adminSearch').addEventListener(
    'input',
    renderProducts
  );

  // =========================================
  // VALIDAR IMAGEN
  // =========================================

  function validateImage(file) {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (!allowedTypes.includes(file.type)) {
      throw new Error(
        'Solo se permiten imágenes JPG, PNG y WEBP.'
      );
    }

    if (file.size > MAX_SIZE) {
      throw new Error(
        'La imagen no puede superar los 2 MB.'
      );
    }
  }

  // =========================================
  // VISTA PREVIA
  // =========================================

  let previewUrl = null;

  $('image').addEventListener('change', () => {
    const file = $('image').files[0];

    if (!file) return;

    try {
      validateImage(file);

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      previewUrl = URL.createObjectURL(file);

      $('preview').src = previewUrl;
      $('preview').hidden = false;

    } catch (error) {
      $('image').value = '';
      notify(error.message, 'error');
    }
  });

  // =========================================
  // SUBIR IMAGEN
  // =========================================

  async function uploadImage(file, productId) {
    validateImage(file);

    const extensionMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp'
    };

    const extension = extensionMap[file.type];

    const path =
      `${productId}/${crypto.randomUUID()}.${extension}`;

    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, file, {
        contentType: file.type,
        upsert: false
      });

    if (error) throw error;

    const { data } = sb.storage
      .from(BUCKET)
      .getPublicUrl(path);

    return data.publicUrl;
  }

  // =========================================
  // GUARDAR PRODUCTO
  // =========================================

  $('productForm').addEventListener('submit', async event => {
    event.preventDefault();

    const button = $('saveButton');
    button.disabled = true;

    try {
      const id =
        $('productId').value || crypto.randomUUID();

      const existing = products.find(p => p.id === id);
      const file = $('image').files[0];

      let imageUrl = existing?.image_url || null;

      if (file) {
        imageUrl = await uploadImage(file, id);
      }

      const name = $('name').value.trim();
      const price = Number($('price').value);
      const cost = Number($('cost_price').value || 0);
      const stock = Number($('stock').value);

      if (!name) {
        throw new Error('Ingresa el nombre del producto.');
      }

      if (
        !Number.isFinite(price) ||
        !Number.isFinite(cost) ||
        !Number.isFinite(stock) ||
        price < 0 ||
        cost < 0 ||
        stock < 0
      ) {
        throw new Error('Verifica los precios y el stock.');
      }

      const payload = {
        id,
        name,
        description: $('description').value.trim(),
        category_id: $('category').value || null,
        sku: $('sku').value.trim() || null,
        price,
        cost_price: cost,
        stock,
        unit: $('unit').value,
        image_url: imageUrl,
        active: $('active').checked,
        featured: $('featured').checked,
        updated_at: new Date().toISOString()
      };

      const { error } = await sb
        .from('products')
        .upsert(payload);

      if (error) throw error;

      notify('Producto guardado correctamente.');

      resetForm();
      await loadProducts();

    } catch (error) {
      handleError(error);
    } finally {
      button.disabled = false;
    }
  });

  // =========================================
  // EDITAR PRODUCTO
  // =========================================

  function editProduct(id) {
    const product = products.find(p => p.id === id);

    if (!product) return;

    $('productId').value = product.id;
    $('name').value = product.name;
    $('description').value = product.description || '';
    $('category').value = product.category_id || '';
    $('sku').value = product.sku || '';
    $('price').value = product.price;
    $('cost_price').value = product.cost_price || 0;
    $('stock').value = product.stock;
    $('unit').value = product.unit;

    $('active').checked = product.active;
    $('featured').checked = product.featured;

    $('preview').src =
      product.image_url || ASUNTA.placeholderImg(product.name);

    $('preview').hidden = false;

    $('formTitle').textContent = 'Editar producto';
    $('saveButton').textContent = 'Actualizar producto';

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }

  // =========================================
  // ACTIVAR / DESACTIVAR
  // =========================================

  async function toggleProduct(id) {
    const product = products.find(p => p.id === id);

    if (!product) return;

    const { error } = await sb
      .from('products')
      .update({
        active: !product.active,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      handleError(error);
      return;
    }

    notify(
      product.active
        ? 'Producto desactivado.'
        : 'Producto activado.'
    );

    await loadProducts();
  }

  // =========================================
  // LIMPIAR FORMULARIO
  // =========================================

  function resetForm() {
    $('productForm').reset();

    $('productId').value = '';

    $('formTitle').textContent = 'Registrar producto';
    $('saveButton').textContent = 'Guardar producto';

    $('active').checked = true;
    $('featured').checked = false;

    $('preview').hidden = true;
    $('preview').removeAttribute('src');

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }

  $('cancelButton').addEventListener('click', resetForm);

  // =========================================
  // INICIAR
  // =========================================

  checkAdmin();

})();
