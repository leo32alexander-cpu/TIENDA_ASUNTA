
/* ============================================================
   ASUNTA - js/store.js
   Catálogo público conectado a Supabase.
   Adaptado a la estructura real de la base de datos.
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.store = (function () {
  'use strict';

  const sb = ASUNTA.sb;
  const PAGE_SIZE = 12;

  const state = {
    products: [],
    categories: [],
    offers: [],
    combos: [],
    loaded: false,
    currentCategory: 'todos',
    search: '',
    sort: 'new',
    page: 1
  };

  /* ---------- Vigencia de promociones ---------- */

  function offerIsLive(promo) {
    if (promo.is_active !== true) return false;

    const now = Date.now();

    if (promo.start_date) {
      const start = new Date(promo.start_date).getTime();

      if (!Number.isFinite(start) || start > now) {
        return false;
      }
    }

    if (promo.end_date) {
      const end = new Date(promo.end_date).getTime();

      if (!Number.isFinite(end) || end < now) {
        return false;
      }
    }

    return true;
  }

  /* ---------- Cálculo de precios ---------- */

  function calculateDiscountPrice(originalPrice, percentage) {
    const price = Number(originalPrice);
    const discount = Number(percentage || 0);

    if (
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isFinite(discount) ||
      discount < 0 ||
      discount > 100
    ) {
      return null;
    }

    return Math.round(
      price * (1 - discount / 100) * 100
    ) / 100;
  }

  /* ---------- Carga de datos desde Supabase ---------- */

  async function loadCatalog() {
    if (!sb) {
      throw new Error('No se ha inicializado la conexión con Supabase.');
    }

    /*
     * Productos y categorías son esenciales.
     * Las promociones son opcionales: si fallan,
     * el catálogo seguirá funcionando.
     */

    const results = await Promise.all([
      sb.from('products')
        .select(`
          id,
          name,
          description,
          price,
          stock,
          unit,
          image_url,
          active,
          sku,
          category_id,
          created_at
        `)
        .eq('active', true)
        .order('created_at', { ascending: false }),

      sb.from('categories')
        .select('id, name, description')
        .eq('active', true)
        .order('name', { ascending: true }),

      sb.from('promotions')
        .select(`
          id,
          name,
          title,
          description,
          type,
          product_id,
          discount_percentage,
          image_url,
          start_date,
          end_date,
          is_active,
          promotion_items(
            product_id,
            quantity,
            products(
              id,
              name,
              price,
              stock,
              active,
              image_url,
              unit
            )
          )
        `)
        .eq('is_active', true)
    ]);

    const productsResult = results[0];
    const categoriesResult = results[1];
    const promotionsResult = results[2];

    // Los errores de productos o categorías sí impiden cargar el catálogo.
    if (productsResult.error) {
      throw new Error(
        ASUNTA.dbErrorMessage(productsResult.error)
      );
    }

    if (categoriesResult.error) {
      throw new Error(
        ASUNTA.dbErrorMessage(categoriesResult.error)
      );
    }

    state.products = productsResult.data || [];
    state.categories = categoriesResult.data || [];

    // Las promociones no deben bloquear el catálogo.
    if (promotionsResult.error) {
      console.warn(
        '[ASUNTA] No se pudieron cargar las promociones:',
        promotionsResult.error
      );

      state.offers = [];
      state.combos = [];
    } else {
      const promos = (promotionsResult.data || [])
        .filter(offerIsLive);

      state.offers = promos.filter(p =>
        p.type === 'oferta' &&
        p.product_id
      );

      state.combos = promos
        .filter(p => p.type === 'combo')
        .map(buildCombo)
        .filter(Boolean);
    }

    state.loaded = true;

    if (ASUNTA.cart) {
      ASUNTA.cart.syncWithCatalog();
    }
  }

  /* ---------- Normalización de combos ---------- */

  function buildCombo(p) {
    const parts = (p.promotion_items || []).map(pi => ({
      product: pi.products,
      qty: Math.max(1, Math.floor(Number(pi.quantity) || 1))
    }));

    const validParts = parts.filter(x =>
      x.product &&
      x.product.active !== false
    );

    const compareAt = Math.round(
      validParts.reduce((sum, x) => {
        return sum + Number(x.product.price || 0) * x.qty;
      }, 0) * 100
    ) / 100;

    /*
     * Precio del combo (misma regla que el servidor):
     * 1. Si tiene precio fijo (promo_price), gana ese.
     * 2. Si no, se aplica el porcentaje (discount_percentage)
     *    sobre la suma de los componentes.
     */
    const fixedPrice = p.promo_price != null
      ? Number(p.promo_price)
      : null;
    const discount = Number(p.discount_percentage || 0);

    const promoPrice =
      fixedPrice !== null && Number.isFinite(fixedPrice) && fixedPrice > 0
        ? Math.round(fixedPrice * 100) / 100
        : calculateDiscountPrice(compareAt, discount);

    let maxQty = Infinity;
    let available = parts.length > 0 &&
      validParts.length === parts.length &&
      compareAt > 0 &&
      promoPrice !== null;

    parts.forEach(x => {
      if (
        !x.product ||
        x.product.active === false
      ) {
        available = false;
        maxQty = 0;
        return;
      }

      const stock = Math.floor(
        Number(x.product.stock) || 0
      );

      const reachable = Math.floor(stock / x.qty);

      if (reachable < 1) {
        available = false;
      }

      maxQty = Math.min(maxQty, reachable);
    });

    if (!Number.isFinite(maxQty)) {
      maxQty = 0;
    }

    return {
      id: p.id,
      title: p.title || p.name || 'Combo',
      description: p.description || '',
      promo_price: promoPrice,
      compareAt: compareAt,
      image_url: p.image_url,
      badge: 'COMBO',
      parts: parts,
      available: available && maxQty > 0 && promoPrice !== null && promoPrice > 0,
      maxQty: Math.max(0, maxQty)
    };
  }

  /* ---------- Consultas del catálogo ---------- */

  function productById(id) {
    return state.products.find(p => p.id === id) || null;
  }

  function comboById(id) {
    return state.combos.find(c => c.id === id) || null;
  }

  /* ---------- Mejor oferta de un producto ---------- */

  function bestOfferFor(product) {
    let best = null;
    let bestPrice = Number(product.price);

    state.offers.forEach(o => {
      if (o.product_id !== product.id) return;

      /*
       * Misma regla que el servidor (create_order):
       * primero precio fijo (promo_price); si no hay,
       * porcentaje (discount_percentage) sobre el precio de lista.
       */
      const fixed = o.promo_price != null
        ? Number(o.promo_price)
        : null;

      let price = null;

      if (fixed !== null && Number.isFinite(fixed) && fixed > 0) {
        price = Math.round(fixed * 100) / 100;
      } else {
        const discount = Number(
          o.discount_percentage || 0
        );

        if (
          !Number.isFinite(discount) ||
          discount <= 0 ||
          discount > 100
        ) {
          return;
        }

        price = calculateDiscountPrice(
          product.price,
          discount
        );
      }

      if (
        price !== null &&
        price >= 0 &&
        price < bestPrice
      ) {
        bestPrice = price;
        best = {
          price: price,
          promo: o
        };
      }
    });

    return best;
  }

  /* ---------- Filtros ---------- */

  function filteredProducts() {
    const q = state.search.trim().toLowerCase();

    let list = state.products.filter(p => {
      const okCat =
        state.currentCategory === 'todos' ||
        p.category_id === state.currentCategory;

      const okSearch =
        !q ||
        String(p.name || '').toLowerCase().includes(q) ||
        String(p.description || '').toLowerCase().includes(q) ||
        String(p.sku || '').toLowerCase().includes(q);

      return okCat && okSearch;
    });

    if (state.sort === 'price-asc') {
      list = list.slice().sort(
        (a, b) => Number(a.price) - Number(b.price)
      );
    } else if (state.sort === 'price-desc') {
      list = list.slice().sort(
        (a, b) => Number(b.price) - Number(a.price)
      );
    } else if (state.sort === 'name') {
      list = list.slice().sort(
        (a, b) => a.name.localeCompare(b.name, 'es')
      );
    }

    return list;
  }

  /* ---------- Filtros de categoría ---------- */

  function renderCategoryFilters() {
    const box = document.getElementById('category-filters');
    if (!box) return;

    const chips = [
      { id: 'todos', name: 'Todos' }
    ].concat(
      state.categories.map(c => ({
        id: c.id,
        name: c.name
      }))
    );

    box.innerHTML = chips.map(c => {
      const activeChip =
        state.currentCategory === c.id;

      const cls = activeChip
        ? 'cat-btn px-4 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap bg-asunta-600 text-white shadow-sm'
        : 'cat-btn px-4 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap bg-slate-100 text-slate-700 hover:bg-slate-200';

      return '<button data-cat="' +
        ASUNTA.esc(c.id) +
        '" class="' + cls + '">' +
        ASUNTA.esc(c.name) +
        '</button>';
    }).join('');

    box.querySelectorAll('.cat-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        setCategory(
          this.getAttribute('data-cat')
        );
      });
    });
  }

  /* ---------- Productos ---------- */

  function renderProducts() {
    const grid = document.getElementById('products-grid');
    const noResults = document.getElementById('no-results');
    const emptyCatalog = document.getElementById('empty-catalog');
    const countEl = document.getElementById('product-count');
    const titleEl = document.getElementById('catalog-title');
    const pager = document.getElementById('catalog-pager');

    if (!grid || !state.loaded) return;

    const all = state.products;

    if (all.length === 0) {
      if (emptyCatalog) {
        emptyCatalog.classList.remove('hidden');
      }

      if (noResults) {
        noResults.classList.add('hidden');
      }

      grid.innerHTML = '';

      if (countEl) {
        countEl.textContent = '0 productos';
      }

      if (pager) {
        pager.innerHTML = '';
      }

      return;
    }

    if (emptyCatalog) {
      emptyCatalog.classList.add('hidden');
    }

    const filtered = filteredProducts();

    if (countEl) {
      countEl.textContent = filtered.length +
        (filtered.length === 1
          ? ' producto'
          : ' productos');
    }

    if (titleEl) {
      const cat = state.categories.find(
        c => c.id === state.currentCategory
      );

      titleEl.textContent =
        state.currentCategory === 'todos'
          ? 'Nuestros Productos'
          : (cat ? cat.name : 'Nuestros Productos');
    }

    if (filtered.length === 0) {
      if (noResults) {
        noResults.classList.remove('hidden');
      }

      grid.innerHTML = '';

      if (pager) {
        pager.innerHTML = '';
      }

      return;
    }

    if (noResults) {
      noResults.classList.add('hidden');
    }

    const pages = Math.max(
      1,
      Math.ceil(filtered.length / PAGE_SIZE)
    );

    if (state.page > pages) {
      state.page = pages;
    }

    const start = (state.page - 1) * PAGE_SIZE;

    const pageItems = filtered.slice(
      start,
      start + PAGE_SIZE
    );

    grid.innerHTML = pageItems.map(p => {
      const offer = bestOfferFor(p);

      const stock = Math.floor(
        Number(p.stock) || 0
      );

      const out = stock <= 0;

      const settings =
        ASUNTA.cart.getSettings() || {};

      const low = !out &&
        stock <= (settings.low_stock_threshold || 10);

      const unit = p.unit
        ? ASUNTA.esc(p.unit)
        : 'unidad';

      const priceHtml = offer
        ? '<span class="text-xs text-slate-400 line-through">' +
        ASUNTA.fmt(p.price) +
        '</span>' +
        '<span class="text-lg font-black text-asunta-700">' +
        ASUNTA.fmt(offer.price) +
        '</span>' +
        '<span class="text-[10px] text-amber-700 font-bold"> / ' +
        unit +
        '</span>'
        : '<span class="text-lg font-black text-asunta-700">' +
        ASUNTA.fmt(p.price) +
        '</span>' +
        '<span class="text-[10px] text-slate-400 font-medium"> / ' +
        unit +
        '</span>';

      const stockBadge = out
        ? '<span class="absolute top-3 right-3 bg-slate-800/90 text-white font-bold text-[10px] px-2.5 py-1 rounded-full shadow">AGOTADO</span>'
        : (low
          ? '<span class="absolute top-3 right-3 bg-amber-100 text-amber-800 font-bold text-[10px] px-2.5 py-1 rounded-full shadow">¡ÚLTIMAS ' +
          stock +
          '!</span>'
          : '<span class="absolute top-3 right-3 bg-white/90 backdrop-blur-sm text-asunta-700 font-bold text-[10px] px-2.5 py-1 rounded-full shadow">Stock: ' +
          stock +
          '</span>');

      const offerBadge = offer
        ? '<span class="absolute top-3 left-3 bg-asunta-yellow-400 text-slate-900 font-black text-[10px] px-2.5 py-1 rounded-full shadow">OFERTA</span>'
        : '';

      const btn = out
        ? '<button disabled class="bg-slate-100 text-slate-400 p-3 rounded-xl flex items-center justify-center w-11 h-11 cursor-not-allowed" aria-label="Producto agotado">' +
        '<i class="fa-solid fa-cart-plus text-base"></i></button>'
        : '<button data-add="' +
        ASUNTA.esc(p.id) +
        '" class="bg-asunta-100 hover:bg-asunta-500 text-asunta-700 hover:text-white p-3 rounded-xl font-semibold transition-colors flex items-center justify-center w-11 h-11 shadow-sm" aria-label="Agregar ' +
        ASUNTA.esc(p.name) +
        ' al carrito">' +
        '<i class="fa-solid fa-cart-plus text-base"></i></button>';

      return (
        '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden group' +
        (out ? ' opacity-75' : '') +
        '">' +

        '<div class="relative bg-slate-100 h-48 overflow-hidden flex items-center justify-center p-4">' +

        '<img src="' +
        ASUNTA.esc(
          p.image_url || ASUNTA.placeholderImg(p.name)
        ) +
        '" alt="' +
        ASUNTA.esc(p.name) +
        '" loading="lazy" class="object-cover h-full w-full rounded-xl group-hover:scale-105 transition-transform duration-300" onerror="this.onerror=null;this.src=\'' +
        ASUNTA.placeholderImg(p.name) +
        '\';">' +

        '<span class="absolute bottom-3 left-3 bg-white/95 backdrop-blur-sm text-slate-700 font-bold text-[11px] px-2.5 py-1 rounded-full shadow-sm">' +
        ASUNTA.esc(p.sku || '') +
        '</span>' +

        stockBadge +
        offerBadge +

        '</div>' +

        '<div class="p-5 flex-1 flex flex-col justify-between space-y-3">' +

        '<div>' +
        '<h3 class="font-bold text-slate-900 text-base leading-snug group-hover:text-asunta-600 transition-colors">' +
        ASUNTA.esc(p.name) +
        '</h3>' +
        '<p class="text-xs text-slate-500 mt-1 line-clamp-2">' +
        ASUNTA.esc(p.description || '') +
        '</p>' +
        '</div>' +

        '<div class="flex items-center justify-between pt-3 border-t border-slate-100">' +
        '<div>' +
        '<span class="text-xs text-slate-400 block font-medium">Precio</span>' +
        priceHtml +
        '</div>' +
        btn +
        '</div>' +

        '</div>' +
        '</div>'
      );
    }).join('');

    grid.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', function () {
        const p = productById(
          this.getAttribute('data-add')
        );

        if (!p) return;

        if (ASUNTA.cart.addProduct(p, 1)) {
          ASUNTA.toast(
            '¡' + p.name + ' agregado al carrito!'
          );
        }
      });
    });

    if (pager) {
      pager.innerHTML = pages > 1
        ? '<div class="flex items-center justify-center gap-3 mt-8">' +
        '<button id="pg-prev" class="btn-ghost text-sm ' +
        (state.page === 1
          ? 'opacity-40 pointer-events-none'
          : '') +
        '"><i class="fa-solid fa-chevron-left mr-1"></i> Anterior</button>' +
        '<span class="text-sm font-semibold text-slate-600">Página ' +
        state.page +
        ' de ' +
        pages +
        '</span>' +
        '<button id="pg-next" class="btn-ghost text-sm ' +
        (state.page === pages
          ? 'opacity-40 pointer-events-none'
          : '') +
        '">Siguiente <i class="fa-solid fa-chevron-right ml-1"></i></button>' +
        '</div>'
        : '';

      const prev = document.getElementById('pg-prev');
      const next = document.getElementById('pg-next');

      if (prev) {
        prev.addEventListener('click', () => {
          state.page--;
          renderProducts();

          document.getElementById('productos')
            .scrollIntoView({ behavior: 'smooth' });
        });
      }

      if (next) {
        next.addEventListener('click', () => {
          state.page++;
          renderProducts();

          document.getElementById('productos')
            .scrollIntoView({ behavior: 'smooth' });
        });
      }
    }
  }

  /* ---------- Ofertas y combos ---------- */

  function renderOffers() {
    const container =
      document.getElementById('offers-container');

    const section =
      document.getElementById('ofertas');

    if (!container) return;

    const cards = [];

    // Combos
    state.combos.forEach(c => {
      cards.push(offerCard({
        id: c.id,
        kind: 'combo',
        title: c.title,
        description: c.description,
        image: c.image_url,
        badge: c.badge || 'COMBO',
        oldPrice: c.compareAt,
        price: c.promo_price,
        disabled: !c.available,
        note: c.available
          ? ''
          : 'Temporalmente sin stock'
      }));
    });

    // Ofertas individuales
    state.offers.forEach(o => {
      const p = productById(o.product_id);

      if (!p || Number(p.stock) <= 0) return;

      const discount = Number(
        o.discount_percentage || 0
      );

      const price = calculateDiscountPrice(
        p.price,
        discount
      );

      if (
        price === null ||
        discount <= 0 ||
        price >= Number(p.price)
      ) {
        return;
      }

      cards.push(offerCard({
        id: o.id,
        kind: 'product',
        title: o.title || o.name || p.name,
        description: o.description ||
          ('Oferta en ' + p.name + ' (' +
            (p.unit || 'unidad') + ')'),
        image: o.image_url || p.image_url,
        badge: 'OFERTA',
        oldPrice: Number(p.price),
        price: price,
        disabled: false,
        note: ''
      }));
    });

    if (cards.length === 0) {
      if (section) {
        section.classList.add('hidden');
      }

      container.innerHTML = '';
      return;
    }

    if (section) {
      section.classList.remove('hidden');
    }

    container.innerHTML = cards.join('');

    container.querySelectorAll('[data-offer-add]')
      .forEach(btn => {
        btn.addEventListener('click', function () {
          const kind = this.getAttribute(
            'data-offer-kind'
          );

          const id = this.getAttribute(
            'data-offer-add'
          );

          if (kind === 'combo') {
            const c = comboById(id);

            if (!c || !c.available) {
              ASUNTA.toast(
                'El combo no tiene stock por ahora.',
                'warn'
              );

              return;
            }

            ASUNTA.cart.addCombo(c, 1);

            ASUNTA.toast(
              '¡Combo "' + c.title +
              '" agregado al carrito!'
            );
          } else {
            const o = state.offers.find(
              x => x.id === id
            );

            const p = o && productById(o.product_id);

            if (!p) return;

            if (ASUNTA.cart.addProduct(p, 1)) {
              ASUNTA.toast(
                '¡' + p.name +
                ' con oferta agregado al carrito!'
              );
            }
          }

          ASUNTA.cart.toggleDrawer(true);
        });
      });
  }

  function offerCard(o) {
    const savings =
      o.oldPrice && o.oldPrice > o.price
        ? Math.round(
          (o.oldPrice - o.price) * 100
        ) / 100
        : null;

    const partsList = '';

    return (
      '<div class="bg-white rounded-2xl border border-asunta-200 shadow-md overflow-hidden flex flex-col justify-between' +
      (o.disabled ? ' opacity-70' : '') +
      '">' +

      '<div>' +

      '<div class="relative h-48 bg-asunta-700 overflow-hidden">' +
      '<img src="' +
      ASUNTA.esc(
        o.image || ASUNTA.placeholderImg(o.title)
      ) +
      '" alt="' +
      ASUNTA.esc(o.title) +
      '" loading="lazy" class="w-full h-full object-cover" onerror="this.onerror=null;this.src=\'' +
      ASUNTA.placeholderImg(o.title) +
      '\';">' +

      '<span class="absolute top-3 right-3 bg-asunta-yellow-400 text-slate-900 font-bold text-xs px-3 py-1 rounded-full shadow">' +
      ASUNTA.esc(o.badge || 'OFERTA') +
      '</span>' +

      '</div>' +

      '<div class="p-6 space-y-2">' +
      '<h3 class="text-xl font-bold text-slate-900">' +
      ASUNTA.esc(o.title) +
      '</h3>' +
      '<p class="text-slate-600 text-sm">' +
      ASUNTA.esc(o.description) +
      '</p>' +
      partsList +
      '</div>' +

      '</div>' +

      '<div class="p-6 pt-0 flex items-center justify-between">' +

      '<div>' +

      (savings
        ? '<span class="text-xs text-slate-400 line-through">' +
        ASUNTA.fmt(o.oldPrice) +
        '</span>'
        : '') +

      '<div class="text-2xl font-black text-asunta-700">' +
      ASUNTA.fmt(o.price) +
      '</div>' +

      (savings
        ? '<span class="text-[10px] font-bold text-asunta-600">Ahorras ' +
        ASUNTA.fmt(savings) +
        '</span>'
        : '') +

      (o.note
        ? '<span class="text-[10px] text-red-500 font-bold block mt-1">' +
        ASUNTA.esc(o.note) +
        '</span>'
        : '') +

      '</div>' +

      (o.disabled
        ? '<button disabled class="bg-slate-200 text-slate-500 font-bold px-5 py-2.5 rounded-xl text-sm cursor-not-allowed">Sin stock</button>'
        : '<button data-offer-add="' +
        ASUNTA.esc(o.id) +
        '" data-offer-kind="' +
        o.kind +
        '" class="bg-asunta-600 hover:bg-asunta-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-colors shadow-sm flex items-center gap-2">' +
        '<i class="fa-solid fa-cart-plus"></i> ' +
        (o.kind === 'combo'
          ? 'Añadir Combo'
          : 'Añadir Oferta') +
        '</button>') +

      '</div>' +
      '</div>'
    );
  }

  /* ---------- Interacción ---------- */

  function setCategory(catId) {
    state.currentCategory = catId;
    state.page = 1;

    renderCategoryFilters();
    renderProducts();
  }

  function resetFilters() {
    state.search = '';

    const input =
      document.getElementById('search-input');

    if (input) {
      input.value = '';
    }

    setCategory('todos');
  }

  /* ---------- Mapa y contacto ---------- */

  async function initMapAndContact() {
    const s = await ASUNTA.getSettings();

    const mapEl = document.getElementById('map');

    if (mapEl && window.L) {
      const lat = Number(s.store_lat) || -11.9355;
      const lng = Number(s.store_lng) || -77.0572;

      if (ASUNTA._mapInstance) {
        try {
          ASUNTA._mapInstance.remove();
        } catch (_) { }

        ASUNTA._mapInstance = null;

        try {
          delete mapEl._leaflet_id;
        } catch (_) { }
      }

      const map = L.map('map').setView(
        [lat, lng],
        15
      );

      ASUNTA._mapInstance = map;

      L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }
      ).addTo(map);

      L.marker([lat, lng])
        .addTo(map)
        .bindPopup(
          '<div style="text-align:center;font-family:Inter,sans-serif;padding:4px;">' +
          '<b style="color:#166534;font-size:14px;">ASUNTA</b><br>' +
          '<span style="font-size:12px;color:#475569;">' +
          ASUNTA.esc(s.store_address) +
          '</span><br>' +
          '<span style="font-size:11px;color:#16a34a;font-weight:bold;">Comas, Lima, Perú</span>' +
          '</div>'
        )
        .openPopup();
    }

    const addrEl =
      document.getElementById('store-address-text');

    if (addrEl) {
      addrEl.textContent = s.store_address;
    }

    const dirBtn =
      document.getElementById('directions-btn');

    if (dirBtn) {
      dirBtn.href =
        'https://maps.google.com/?q=' +
        encodeURIComponent(s.store_address);
    }

    const waFooter =
      document.getElementById('footer-whatsapp-btn');

    if (waFooter) {
      waFooter.onclick = function () {
        ASUNTA.orders.openWhatsAppContact(
          s.whatsapp_number
        );
      };
    }

    document.querySelectorAll('[data-delivery-info]')
      .forEach(el => {
        el.textContent =
          'Delivery: ' +
          ASUNTA.fmt(s.delivery_fee) +
          ' (Gratis desde ' +
          ASUNTA.fmt(s.free_delivery_threshold) +
          ')';
      });
  }

  /* ---------- Arranque ---------- */

  async function boot() {
    const grid =
      document.getElementById('products-grid');

    try {
      renderSkeletons();

      await loadCatalog();

      ASUNTA.hideConnBanner();

      renderCategoryFilters();
      renderOffers();
      renderProducts();

    } catch (e) {
      console.error(
        '[ASUNTA] Error cargando catálogo:',
        e
      );

      if (grid) {
        grid.innerHTML = '';
      }

      const box =
        document.getElementById('catalog-error');

      if (box) {
        box.classList.remove('hidden');

        const msg =
          document.getElementById('catalog-error-msg');

        if (msg) {
          msg.textContent =
            e.message || 'Error de conexión.';
        }

        const retry =
          document.getElementById('catalog-retry');

        if (retry) {
          retry.onclick = () => {
            box.classList.add('hidden');
            boot();
          };
        }
      }

      ASUNTA.showConnBanner(
        'No se pudo cargar el catálogo desde el servidor de la tienda.'
      );
    }
  }

  function renderSkeletons() {
    const grid =
      document.getElementById('products-grid');

    if (!grid) return;

    let html = '';

    for (let i = 0; i < 8; i++) {
      html +=
        '<div class="bg-white rounded-2xl border border-slate-200 overflow-hidden">' +
        '<div class="skeleton h-48 rounded-none"></div>' +
        '<div class="p-5 space-y-3">' +
        '<div class="skeleton h-4 w-3/4"></div>' +
        '<div class="skeleton h-3 w-full"></div>' +
        '<div class="skeleton h-6 w-1/2"></div>' +
        '</div></div>';
    }

    grid.innerHTML = html;
  }

  /* ---------- API pública ---------- */

  return {
    boot: boot,
    loadCatalog: loadCatalog,
    setCategory: setCategory,
    renderProducts: renderProducts,
    renderOffers: renderOffers,
    resetFilters: resetFilters,

    setSearch: function (v) {
      state.search = v;
      state.page = 1;
      renderProducts();
    },

    setSort: function (v) {
      state.sort = v;
      state.page = 1;
      renderProducts();
    },

    productById: productById,
    comboById: comboById,
    bestOfferFor: bestOfferFor,

    getState: function () {
      return state;
    },

    initMapAndContact: initMapAndContact
  };
})();
