/* ============================================================
   ASUNTA - js/admin.js
   Núcleo del panel administrativo:
     * Protección de la ruta: sesión + is_admin() en el servidor.
     * Inicio/cierre de sesión y recuperación de contraseña.
     * Navegación por pestañas.
     * Dashboard con estadísticas reales de Supabase.
     * Configuración de la tienda (store_settings).
     * Registro de actividad del administrador (admin_activity).
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.admin = (function () {
  'use strict';

  const sb = ASUNTA.sb;
  let settings = null;
  const initedTabs = {};

  /* ---------- Arranque: verificar sesión y autorización ---------- */
  async function boot() {
    bindLoginUI();
    bindPanelUI();

    // Soporte del enlace de recuperación (#access_token=...&type=recovery)
    if (location.hash && location.hash.includes('type=recovery')) {
      showView('login');
      document.getElementById('newpass-box').classList.remove('hidden');
      return;
    }

    try {
      const session = await ASUNTA.auth.getSession();
      if (!session) { showLogin(); return; }
      const admin = await ASUNTA.auth.isAdmin();
      if (!admin) { await ASUNTA.auth.signOut(); showLogin(); return; }
      await enterPanel();
    } catch (e) {
      console.warn('[ASUNTA] boot:', e.message);
      showLogin();
    }

    // Si la sesión se cierra (pestaña o botón), volver al login
    ASUNTA.auth.onSessionChange((event) => {
      if (event === 'SIGNED_OUT') showLogin();
    });
  }

  function showLogin() {
    document.getElementById('view-login').classList.remove('hidden');
    document.getElementById('view-panel').classList.add('hidden');
  }

  async function enterPanel() {
    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('view-panel').classList.remove('hidden');
    const user = await ASUNTA.auth.getUser();
    document.getElementById('admin-email').textContent = user ? user.email : '';
    settings = await ASUNTA.getSettings(true);
    switchTab('dashboard');
  }

  /* ---------- Login / recuperación ---------- */
  function bindLoginUI() {
    const errBox = document.getElementById('login-error');
    const showErr = (m) => {
      errBox.textContent = m;
      errBox.classList.remove('hidden');
    };

    document.getElementById('toggle-pass').addEventListener('click', function () {
      const input = document.getElementById('login-password');
      input.type = input.type === 'password' ? 'text' : 'password';
      this.innerHTML = input.type === 'password'
        ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-eye-slash"></i>';
    });

    document.getElementById('login-btn').addEventListener('click', doLogin);
    document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('login-email').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

    async function doLogin() {
      const btn = document.getElementById('login-btn');
      errBox.classList.add('hidden');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Verificando…';
      const email = document.getElementById('login-email').value.trim();
      const pass = document.getElementById('login-password').value;
      const res = await ASUNTA.auth.signInAdmin(email, pass);
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Iniciar sesión';
      if (!res.ok) { showErr(res.error); return; }
      await enterPanel();
    }

    document.getElementById('forgot-btn').addEventListener('click', () => {
      document.getElementById('reset-box').classList.toggle('hidden');
    });

    document.getElementById('reset-btn').addEventListener('click', async () => {
      const email = document.getElementById('reset-email').value.trim();
      const msg = document.getElementById('reset-msg');
      msg.className = 'text-xs font-semibold text-slate-500';
      msg.textContent = 'Enviando…';
      const res = await ASUNTA.auth.sendPasswordReset(email);
      if (res.ok) {
        msg.className = 'text-xs font-semibold text-asunta-700';
        msg.textContent = 'Correo enviado. Revisa tu bandeja (y spam).';
      } else {
        msg.className = 'text-xs font-semibold text-red-600';
        msg.textContent = res.error;
      }
    });

    document.getElementById('newpass-btn').addEventListener('click', async () => {
      const p1 = document.getElementById('newpass-1').value;
      const p2 = document.getElementById('newpass-2').value;
      const msg = document.getElementById('newpass-msg');
      if (p1.length < 6) { msg.className = 'text-xs font-semibold text-red-600'; msg.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
      if (p1 !== p2) { msg.className = 'text-xs font-semibold text-red-600'; msg.textContent = 'Las contraseñas no coinciden.'; return; }
      const res = await ASUNTA.auth.updatePassword(p1);
      if (res.ok) {
        msg.className = 'text-xs font-semibold text-asunta-700';
        msg.textContent = 'Contraseña actualizada. Ingresa con ella.';
        setTimeout(() => { location.hash = ''; showLogin(); }, 1200);
      } else {
        msg.className = 'text-xs font-semibold text-red-600';
        msg.textContent = res.error;
      }
    });
  }

  /* ---------- Navegación por pestañas ---------- */
  function bindPanelUI() {
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await ASUNTA.auth.signOut();
      location.reload();
    });
    document.getElementById('dash-refresh').addEventListener('click', loadDashboard);

    document.querySelectorAll('#admin-nav .nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
    });
  }

  function switchTab(tab) {
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById('panel-' + tab);
    if (panel) panel.classList.remove('hidden');

    document.querySelectorAll('#admin-nav .nav-btn').forEach(b => {
      const on = b.getAttribute('data-tab') === tab;
      b.classList.toggle('bg-asunta-600', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('hover:bg-slate-800', !on);
    });

    // Carga diferida por módulo
    if (!initedTabs[tab]) {
      initedTabs[tab] = true;
      if (tab === 'dashboard') loadDashboard();
      if (tab === 'products' && ASUNTA.adminProducts) ASUNTA.adminProducts.init();
      if (tab === 'categories' && ASUNTA.adminCategories) ASUNTA.adminCategories.init();
      if (tab === 'promos' && ASUNTA.adminPromos) ASUNTA.adminPromos.init();
      if (tab === 'orders' && ASUNTA.adminOrders) ASUNTA.adminOrders.init();
      if (tab === 'inventory' && ASUNTA.inventory) ASUNTA.inventory.init();
      if (tab === 'config') loadConfig();
    } else {
      if (tab === 'dashboard') loadDashboard();
    }
  }

  /* ---------- DASHBOARD ---------- */
  async function loadDashboard() {
    const cards = document.getElementById('dash-cards');
    cards.innerHTML = '<div class="skeleton h-24 col-span-2"></div><div class="skeleton h-24 col-span-2"></div>';
    try {
      const settingsRow = await ASUNTA.getSettings();
      const low = Number(settingsRow.low_stock_threshold) || 10;

      const [prodRes, catRes, ordRes, itemsRes] = await Promise.all([
        sb.from('products').select('id, name, stock, active'),
        sb.from('categories').select('id, active'),
        sb.from('orders').select('id, status, total, created_at').order('created_at', { ascending: false }).limit(2000),
        sb.from('order_items').select('product_name, quantity, subtotal, order_id').limit(5000)
      ]);
      [prodRes, catRes, ordRes, itemsRes].forEach(r => { if (r.error) throw r.error; });

      const products = prodRes.data || [];
      const categories = catRes.data || [];
      const orders = ordRes.data || [];
      const items = itemsRes.data || [];

      // Ventas = pedidos NO cancelados; ingresos registrados = entregados
      const notCancelled = orders.filter(o => o.status !== 'cancelled');
      const delivered = orders.filter(o => o.status === 'delivered');
      const pending = orders.filter(o => ['pending', 'confirmed', 'preparing', 'shipped'].includes(o.status));

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      const salesToday = delivered.filter(o => new Date(o.created_at) >= today)
        .reduce((s, o) => s + Number(o.total), 0);
      const salesMonth = delivered.filter(o => new Date(o.created_at) >= monthStart)
        .reduce((s, o) => s + Number(o.total), 0);
      const revenueAll = delivered.reduce((s, o) => s + Number(o.total), 0);
      const ordersToday = orders.filter(o => new Date(o.created_at) >= today).length;

      const card = (icon, color, value, label) =>
        '<div class="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">' +
          '<div class="w-11 h-11 rounded-xl flex items-center justify-center text-lg ' + color + '">' +
            '<i class="fa-solid ' + icon + '"></i></div>' +
          '<div><div class="text-xl font-black text-slate-900 leading-none">' + value + '</div>' +
          '<div class="text-xs text-slate-500 mt-1 font-medium">' + label + '</div></div>' +
        '</div>';

      cards.innerHTML =
        card('fa-boxes-stacked', 'bg-asunta-100 text-asunta-700', products.length, 'Productos totales') +
        card('fa-check-double', 'bg-asunta-100 text-asunta-700', products.filter(p => p.active).length, 'Productos activos') +
        card('fa-layer-group', 'bg-asunta-100 text-asunta-700', categories.length, 'Categorías') +
        card('fa-receipt', 'bg-slate-100 text-slate-700', orders.length, 'Pedidos recibidos') +
        card('fa-hourglass-half', 'bg-amber-100 text-amber-700', pending.length, 'Pedidos pendientes') +
        card('fa-sun', 'bg-asunta-100 text-asunta-700', ASUNTA.fmt(salesToday), 'Ventas de hoy (entregadas)') +
        card('fa-calendar', 'bg-asunta-100 text-asunta-700', ASUNTA.fmt(salesMonth), 'Ventas del mes (entregadas)') +
        card('fa-sack-dollar', 'bg-asunta-yellow-100 text-amber-700', ASUNTA.fmt(revenueAll), 'Ingresos registrados');

      // Top productos (pedidos no cancelados)
      const orderIds = new Set(notCancelled.map(o => o.id));
      const byName = {};
      items.forEach(it => {
        if (!orderIds.has(it.order_id)) return;
        const k = it.product_name;
        byName[k] = byName[k] || { qty: 0, total: 0 };
        byName[k].qty += Number(it.quantity);
        byName[k].total += Number(it.subtotal);
      });
      const top = Object.entries(byName).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);
      document.getElementById('dash-top-products').innerHTML = top.length
        ? '<table class="admin-table"><thead><tr><th>#</th><th>Producto</th><th>Vendidos</th><th>Importe</th></tr></thead><tbody>' +
          top.map((t, i) => '<tr><td>' + (i + 1) + '</td><td class="font-semibold">' + ASUNTA.esc(t[0]) + '</td>' +
            '<td>' + t[1].qty + '</td><td>' + ASUNTA.fmt(t[1].total) + '</td></tr>').join('') + '</tbody></table>'
        : '<p class="text-slate-400 text-sm">Aún no hay ventas registradas.</p>';

      // Stock bajo / agotado
      const lowList = products.filter(p => p.active && Number(p.stock) <= low && Number(p.stock) > 0);
      const outList = products.filter(p => Number(p.stock) <= 0);
      const row = (p, cls, txt) =>
        '<div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">' +
          '<span class="font-medium text-slate-700">' + ASUNTA.esc(p.name) + '</span>' +
          '<span class="status-badge ' + cls + '">' + txt + '</span></div>';
      document.getElementById('dash-low-stock').innerHTML =
        (outList.length ? outList.map(p => row(p, 'status-cancelled', 'AGOTADO')).join('') : '') +
        (lowList.length ? lowList.map(p => row(p, 'status-pending', 'Bajo: ' + Number(p.stock))).join('') : '') +
        (!outList.length && !lowList.length ? '<p class="text-slate-400 text-sm">Todo el inventario está sano.</p>' : '');

      // Badge de pendientes en el menú
      const badge = document.getElementById('orders-pending-badge');
      if (badge) {
        badge.textContent = pending.length;
        badge.classList.toggle('hidden', pending.length === 0);
      }
    } catch (e) {
      cards.innerHTML = '<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm col-span-4">' +
        '<i class="fa-solid fa-triangle-exclamation mr-2"></i>' + ASUNTA.esc(ASUNTA.dbErrorMessage(e)) + '</div>';
    }
  }

  /* ---------- CONFIGURACIÓN ---------- */
  const payMethods = [];
  async function loadConfig() {
    settings = await ASUNTA.getSettings(true);
    document.getElementById('cfg-delivery-fee').value = settings.delivery_fee;
    document.getElementById('cfg-free-from').value = settings.free_delivery_threshold;
    document.getElementById('cfg-whatsapp').value = settings.whatsapp_number;
    document.getElementById('cfg-low-stock').value = settings.low_stock_threshold;
    document.getElementById('cfg-address').value = settings.store_address;
    document.getElementById('cfg-lat').value = settings.store_lat;
    document.getElementById('cfg-lng').value = settings.store_lng;
    payMethods.length = 0;
    (settings.payment_methods || []).forEach(m => payMethods.push(m));
    renderPayMethods();

    if (!document.getElementById('cfg-save')._bound) {
      document.getElementById('cfg-save')._bound = true;
      document.getElementById('cfg-save').addEventListener('click', saveConfig);
      document.getElementById('cfg-pay-add').addEventListener('click', addPayMethod);
    }
  }

  function renderPayMethods() {
    document.getElementById('cfg-pay-list').innerHTML = payMethods.map((m, i) =>
      '<span class="inline-flex items-center gap-2 bg-asunta-50 border border-asunta-200 text-asunta-700 font-semibold text-sm px-3 py-1.5 rounded-full">' +
        ASUNTA.esc(m) +
        '<button type="button" data-pay-remove="' + i + '" class="text-red-400 hover:text-red-600" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>' +
      '</span>').join('') || '<span class="text-xs text-slate-400">Sin métodos de pago configurados.</span>';
    document.querySelectorAll('[data-pay-remove]').forEach(btn => {
      btn.addEventListener('click', function () {
        payMethods.splice(Number(this.getAttribute('data-pay-remove')), 1);
        renderPayMethods();
      });
    });
  }

  function addPayMethod() {
    const input = document.getElementById('cfg-pay-new');
    const v = input.value.trim();
    if (v && !payMethods.includes(v)) { payMethods.push(v); input.value = ''; renderPayMethods(); }
  }

  async function saveConfig() {
    const payload = {
      delivery_fee: Number(document.getElementById('cfg-delivery-fee').value) || 0,
      free_delivery_threshold: Number(document.getElementById('cfg-free-from').value) || 0,
      whatsapp_number: document.getElementById('cfg-whatsapp').value.trim() || '51999999999',
      low_stock_threshold: Number(document.getElementById('cfg-low-stock').value) || 0,
      store_address: document.getElementById('cfg-address').value.trim(),
      store_lat: Number(document.getElementById('cfg-lat').value) || 0,
      store_lng: Number(document.getElementById('cfg-lng').value) || 0,
      payment_methods: payMethods,
      updated_at: new Date().toISOString()
    };
    if (payload.whatsapp_number.replace(/\D/g, '').length < 9) {
      ASUNTA.toast('El número de WhatsApp no es válido (usa formato 51XXXXXXXXX).', 'error');
      return;
    }
    const { error } = await sb.from('store_settings').update(payload).eq('id', 1);
    if (error) { ASUNTA.toast(ASUNTA.dbErrorMessage(error), 'error'); return; }
    ASUNTA.invalidateSettings();
    settings = await ASUNTA.getSettings(true);
    logActivity('settings.update', { delivery_fee: payload.delivery_fee });
    ASUNTA.toast('Configuración guardada. La tienda pública la usará en la próxima carga.');
  }

  /* ---------- Registro de actividad ---------- */
  async function logActivity(action, details) {
    try {
      await sb.from('admin_activity').insert({
        action: String(action).slice(0, 100),
        details: details || {}
      });
    } catch (_) { /* el registro de actividad no debe bloquear la operación */ }
  }

  return {
    boot: boot,
    switchTab: switchTab,
    loadDashboard: loadDashboard,
    logActivity: logActivity,
    getSettings: function () { return settings; }
  };
})();
