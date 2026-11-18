
/* =====================================================
   ASUNTA - js/productos-catalogo.js
   Catálogo público de productos
   ===================================================== */

(function () {
  'use strict';

  const sb = window.ASUNTA.sb;
  const ASUNTA = window.ASUNTA;

  let products = [];
  let selectedCategory = '';

  const $ = id => document.getElementById(id);

  // =====================================
  // CARGAR PRODUCTOS
  // =====================================

  async function loadProducts() {
    const { data, error } = await sb
      .from('products')
      .select(`
        id,
        name,
        description,
        price,
        stock,
        unit,
        image_url,
        category_id,
        featured,
        categories(name)
      `)
      .eq('active', true)
      .order('name');

    if (error) {
      console.error(error);
      ASUNTA.showConnBanner(
        'No se pudieron cargar los productos.'
      );
      return;
    }

    ASUNTA.hideConnBanner();

    products = data || [];

    renderCategories();
    renderFeatured();
    renderProducts();
  }

  // =====================================
  // CATEGORIAS
  // =====================================

  function renderCategories() {
    const container = $('categories');
    if (!container) return;

    container.replaceChildren();

    const all = document.createElement('button');
    all.textContent = 'Todos';
    all.className = 'category-button';

    if (!selectedCategory) {
      all.classList.add('selected');
    }

    all.onclick = () => {
      selectedCategory = '';
      renderCategories();
      renderProducts();
    };

    container.appendChild(all);

    const unique = new Map();

    products.forEach(product => {
      if (product.category_id) {
        unique.set(
          product.category_id,
          product.categories?.name || 'General'
        );
      }
    });

    unique.forEach((name, id) => {
      const button = document.createElement('button');

      button.textContent = name;
      button.className = 'category-button';

      if (selectedCategory === id) {
        button.classList.add('selected');
      }

      button.onclick = () => {
        selectedCategory = id;
        renderCategories();
        renderProducts();
      };

      container.appendChild(button);
    });
  }

  // =====================================
  // TARJETA DE PRODUCTO
  // =====================================

  function createCard(product) {
    const card = document.createElement('article');
    card.className = 'product-card';

    const imageBox = document.createElement('div');
    imageBox.className = 'product-image-box';

    const img = document.createElement('img');

    img.src = product.image_url ||
      ASUNTA.placeholderImg(product.name);

    img.alt = product.name;
    img.loading = 'lazy';
    img.className = 'product-image';

    img.onerror = () => {
      img.src = ASUNTA.placeholderImg(product.name);
    };

    imageBox.appendChild(img);

    const category = document.createElement('small');
    category.textContent =
      product.categories?.name || 'General';

    const name = document.createElement('h3');
    name.textContent = product.name;

    const description = document.createElement('p');
    description.textContent = product.description || '';

    const price = document.createElement('strong');
    price.className = 'product-price';
    price.textContent = ASUNTA.fmt(product.price);

    const unit = document.createElement('small');
    unit.textContent = 'Por ' + product.unit;

    const stock = document.createElement('span');

    if (Number(product.stock) > 0) {
      stock.textContent = 'Disponible';
      stock.className = 'stock-available';
    } else {
      stock.textContent = 'Agotado';
      stock.className = 'stock-unavailable';
    }

    card.append(
      imageBox,
      category,
      name,
      description,
      price,
      unit,
      stock
    );

    return card;
  }

  // =====================================
  // DESTACADOS
  // =====================================

  function renderFeatured() {
    const section = $('featuredSection');
    const container = $('featuredProducts');

    if (!section || !container) return;

    container.replaceChildren();

    const featured = products.filter(p => p.featured);

    section.hidden = featured.length === 0;

    featured.forEach(product => {
      container.appendChild(createCard(product));
    });
  }

  // =====================================
  // LISTADO GENERAL
  // =====================================

  function renderProducts() {
    const container = $('catalog');
    if (!container) return;

    const term = $('search')
      ? $('search').value.trim().toLowerCase()
      : '';

    const filtered = products.filter(product => {
      const matchesName =
        product.name.toLowerCase().includes(term);

      const matchesDescription =
        (product.description || '')
          .toLowerCase().includes(term);

      const matchesCategory =
        !selectedCategory ||
        product.category_id === selectedCategory;

      return (
        (matchesName || matchesDescription) &&
        matchesCategory
      );
    });

    container.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No encontramos productos.';
      container.appendChild(empty);
      return;
    }

    filtered.forEach(product => {
      container.appendChild(createCard(product));
    });
  }

  // =====================================
  // BUSCADOR
  // =====================================

  if ($('search')) {
    $('search').addEventListener(
      'input',
      renderProducts
    );
  }

  // =====================================
  // INICIAR
  // =====================================

  loadProducts();

})();
