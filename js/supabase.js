/* ============================================================
   ASUNTA - js/supabase.js
   Configuración de conexión con Supabase + utilidades compartidas.

   Este archivo es el ÚNICO punto donde se define la conexión.
   La Publishable Key es segura de usar en el cliente porque toda la
   autorización se controla con políticas RLS en Supabase (ver sql/03).
   NUNCA colocar aquí la service_role key.
   ============================================================ */

window.ASUNTA = (function () {
  'use strict';

  /* ---------- Conexión (datos de tu proyecto Supabase) ---------- */
  const SUPABASE_URL = 'https://ftbyxefpyjxerwrilftv.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_AcFjtEaXvVj7mqad06cr9g_vJTnPG1c';

  // El SDK se carga por CDN y expone window.supabase
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  /* ---------- Valores por defecto de la configuración ----------
     Se usan SOLO mientras no se pueda leer store_settings de la base
     de datos (por ejemplo, sin conexión). Coinciden con las
     condiciones actuales de la tienda y con la fila 1 de store_settings. */
  const DEFAULT_SETTINGS = {
    delivery_fee: 3.00,
    free_delivery_threshold: 50.00,
    whatsapp_number: '51999999999', // provisional, configurable en el panel
    store_address: 'Av. Universitaria / Zona Comercial (Referencial), Comas, Lima, Perú',
    store_lat: -11.9355,
    store_lng: -77.0572,
    payment_methods: ['Efectivo contra entrega'],
    low_stock_threshold: 10
  };

  let settingsCache = null;

  /* ---------- Utilidades ---------- */
  function fmt(n) {
    return 'S/ ' + Number(n || 0).toFixed(2);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Toast de notificación (reutiliza el elemento #toast de la página)
  function toast(message, type) {
    const t = document.getElementById('toast');
    const m = document.getElementById('toast-message');
    const icon = document.getElementById('toast-icon');
    if (!t || !m) return;
    m.textContent = message;
    if (icon) {
      icon.className = 'text-lg ' + (type === 'error'
        ? 'fa-solid fa-circle-exclamation text-red-400'
        : type === 'warn'
          ? 'fa-solid fa-triangle-exclamation text-amber-400'
          : 'fa-solid fa-circle-check text-asunta-yellow-400');
    }
    t.classList.remove('translate-y-20', 'opacity-0');
    t.classList.add('translate-y-0', 'opacity-100');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.classList.remove('translate-y-0', 'opacity-100');
      t.classList.add('translate-y-20', 'opacity-0');
    }, 3200);
  }

  // Banner global de conexión (se muestra cuando Supabase no responde)
  function showConnBanner(message) {
    const b = document.getElementById('conn-banner');
    if (!b) return;
    document.getElementById('conn-banner-text').textContent = message || 'No se pudo conectar con el servidor de la tienda.';
    b.classList.remove('hidden');
  }
  function hideConnBanner() {
    const b = document.getElementById('conn-banner');
    if (b) b.classList.add('hidden');
  }

  // Traduce errores comunes de Supabase a mensajes claros
  function dbErrorMessage(err) {
    const msg = (err && (err.message || err.details || err.hint)) || String(err || 'Error desconocido');
    if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) {
      return 'No se pudo conectar con el servidor. Verifica tu conexión a internet.';
    }
    if (/JWT|invalid.*api\s*key|Invalid API key/i.test(msg)) {
      return 'Problema de credenciales con el servidor (revisa la configuración de Supabase).';
    }
    if (/row-level security/i.test(msg)) {
      return 'No tienes permisos para realizar esta operación.';
    }
    return msg;
  }

  /* ---------- Configuración de la tienda (store_settings) ---------- */
  async function getSettings(force) {
    if (settingsCache && !force) return settingsCache;
    try {
      const { data, error } = await sb
        .from('store_settings')
        .select('*')
        .eq('id', 1)
        .single();
      if (error) throw error;
      if (data) {
        settingsCache = Object.assign({}, DEFAULT_SETTINGS, data);
        return settingsCache;
      }
    } catch (e) {
      console.warn('[ASUNTA] No se pudo leer store_settings, usando valores por defecto:', e.message);
      showConnBanner('No se pudo leer la configuración de la tienda. Se muestran valores provisionales.');
    }
    settingsCache = Object.assign({}, DEFAULT_SETTINGS);
    return settingsCache;
  }

  function invalidateSettings() { settingsCache = null; }

  /* ---------- Formateo de fechas ---------- */
  function fmtDate(iso) {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString('es-PE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) { return iso; }
  }

  // Estados de pedido -> etiqueta y clase CSS
  const ORDER_STATUS = {
    pending:   { label: 'Pendiente',  cls: 'status-pending' },
    confirmed: { label: 'Confirmado', cls: 'status-confirmed' },
    preparing: { label: 'Preparando', cls: 'status-preparing' },
    shipped:   { label: 'En camino',  cls: 'status-shipped' },
    delivered: { label: 'Entregado',  cls: 'status-delivered' },
    cancelled: { label: 'Cancelado',  cls: 'status-cancelled' }
  };

  function statusBadge(status) {
    const st = ORDER_STATUS[status] || { label: status || '-', cls: 'status-pending' };
    return '<span class="status-badge ' + st.cls + '">' + esc(st.label) + '</span>';
  }

  function placeholderImg(text) {
    return 'https://placehold.co/400x400/f0fdf4/166534?text=' +
      encodeURIComponent(text || 'ASUNTA');
  }

  return {
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_KEY: SUPABASE_KEY,
    sb: sb,
    fmt: fmt,
    esc: esc,
    toast: toast,
    showConnBanner: showConnBanner,
    hideConnBanner: hideConnBanner,
    dbErrorMessage: dbErrorMessage,
    getSettings: getSettings,
    invalidateSettings: invalidateSettings,
    fmtDate: fmtDate,
    ORDER_STATUS: ORDER_STATUS,
    statusBadge: statusBadge,
    placeholderImg: placeholderImg,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };
})();
