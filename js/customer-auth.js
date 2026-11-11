/* ============================================================
   ASUNTA - js/customer-auth.js
   Autenticación de CLIENTES (no administradores).

   Permite:
     * Registrarse (email + contraseña + nombre + teléfono)
     * Iniciar sesión / cerrar sesión
     * Ver y editar el perfil (datos guardados en la BD)
     * Ver la lista de pedidos propios (orders donde user_id = yo)

   Convive con js/auth.js (admin): si una cuenta resulta ser el
   administrador, se le invita a entrar por admin.html.
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.customerAuth = (function () {
  'use strict';

  const sb = ASUNTA.sb;

  /* ---------- Estado en memoria (cacheado) ---------- */
  let sessionCache = null;       // sesión de Supabase Auth
  let profileCache = null;       // fila de public.customers

  /* ---------- Utilidad: traducir errores de Auth ---------- */
  function traducirAuthError(err) {
    const m = (err && err.message) || '';
    if (/User already registered/i.test(m)) {
      return 'Ya existe una cuenta con este correo. Inicia sesión.';
    }
    if (/Invalid login credentials/i.test(m)) {
      return 'Correo o contraseña incorrectos.';
    }
    if (/Email not confirmed/i.test(m)) {
      return 'Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.';
    }
    if (/Password should be at least/i.test(m)) {
      return 'La contraseña debe tener al menos 6 caracteres.';
    }
    if (/Failed to fetch|NetworkError/i.test(m)) {
      return 'No se pudo conectar con el servidor. Verifica tu internet.';
    }
    if (/rate limit/i.test(m)) {
      return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
    }
    return m || 'Error de autenticación.';
  }

  /* ---------- Registro de un cliente nuevo ---------- */
  /* Devuelve { ok, needsEmailConfirmation, error } */
  async function signUp(datos) {
    const email = String(datos.email || '').trim().toLowerCase();
    const password = String(datos.password || '');
    const fullName = String(datos.fullName || '').trim();
    const phone = String(datos.phone || '').trim();

    if (!email || !password) {
      return { ok: false, error: 'Correo y contraseña son obligatorios.' };
    }
    if (password.length < 6) {
      return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' };
    }
    if (fullName.length < 3) {
      return { ok: false, error: 'Ingresa tu nombre completo.' };
    }
    if (!/^[0-9+\-\s()]{6,17}$/.test(phone)) {
      return { ok: false, error: 'Ingresa un teléfono válido (ej. 987 654 321).' };
    }

    // Los metadatos viajan al trigger handle_new_customer para crear la fila
    // en public.customers automáticamente.
    const { data, error } = await sb.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { full_name: fullName, phone: phone }
      }
    });
    if (error) return { ok: false, error: traducirAuthError(error) };

    // Si Supabase tiene "Confirm email" activado, data.session es null y hay
    // que confirmar por correo. Si no, la sesión queda abierta.
    if (data.session) {
      sessionCache = data.session;
      await loadProfile();
    }
    return {
      ok: true,
      needsEmailConfirmation: !data.session,
      user: data.user
    };
  }

  /* ---------- Inicio de sesión ---------- */
  async function signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password: String(password || '')
    });
    if (error) return { ok: false, error: traducirAuthError(error) };

    // ¿Es el administrador? Lo mandamos a admin.html
    const { data: isAdm, error: eAdm } = await sb.rpc('is_admin');
    if (!eAdm && isAdm === true) {
      await sb.auth.signOut();
      return {
        ok: false,
        error: 'Esta cuenta es del administrador. Ingresa por el panel admin: admin.html',
        redirectToAdmin: true
      };
    }

    sessionCache = data.session;
    await loadProfile();
    return { ok: true, user: data.user };
  }

  /* ---------- Cerrar sesión ---------- */
  async function signOut() {
    await sb.auth.signOut();
    sessionCache = null;
    profileCache = null;
  }

  /* ---------- Sesión actual ---------- */
  async function getSession() {
    if (sessionCache) return sessionCache;
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    sessionCache = data && data.session ? data.session : null;
    return sessionCache;
  }

  async function getUser() {
    const s = await getSession();
    return s ? s.user : null;
  }

  /* ---------- Perfil (public.customers) ---------- */
  async function loadProfile() {
    const u = await getUser();
    if (!u) { profileCache = null; return null; }
    const { data, error } = await sb
      .from('customers')
      .select('*')
      .eq('id', u.id)
      .single();
    if (error) {
      // Si la fila no existe (trigger falló), la creamos ahora
      if (/no rows|PGRST116|406/i.test(error.message || '')) {
        const { data: ins } = await sb.from('customers').insert({
          id: u.id,
          full_name: (u.user_metadata && u.user_metadata.full_name) || '',
          phone: (u.user_metadata && u.user_metadata.phone) || ''
        }).select('*').single();
        profileCache = ins || null;
        return profileCache;
      }
      console.warn('[ASUNTA] loadProfile:', error.message);
      profileCache = null;
      return null;
    }
    profileCache = data;
    return data;
  }

  function getProfile() { return profileCache; }

  async function updateProfile(campos) {
    const u = await getUser();
    if (!u) throw new Error('No has iniciado sesión.');
    const payload = {
      updated_at: new Date().toISOString()
    };
    if (typeof campos.fullName === 'string')        payload.full_name        = campos.fullName.trim();
    if (typeof campos.phone === 'string')           payload.phone            = campos.phone.trim();
    if (typeof campos.defaultAddress === 'string')  payload.default_address  = campos.defaultAddress.trim() || null;
    if (typeof campos.defaultDistrict === 'string') payload.default_district = campos.defaultDistrict.trim() || null;
    if (typeof campos.defaultReference === 'string') payload.default_reference = campos.defaultReference.trim() || null;
    if (typeof campos.marketingOptIn === 'boolean') payload.marketing_opt_in = campos.marketingOptIn;

    const { data, error } = await sb.from('customers')
      .update(payload).eq('id', u.id).select('*').single();
    if (error) throw new Error(ASUNTA.dbErrorMessage(error));
    profileCache = data;
    return data;
  }

  /* ---------- Pedidos propios ---------- */
  /* Devuelve array de pedidos con sus líneas ya formateadas */
  async function loadMyOrders() {
    const u = await getUser();
    if (!u) return [];
    const { data, error } = await sb
      .from('orders')
      .select(`
        id, order_code, status, payment_status, payment_method,
        customer_name, customer_phone, customer_email,
        delivery_address, district, address_reference,
        subtotal, delivery_cost, total, notes, created_at,
        order_items ( product_name, quantity, unit, unit_price, subtotal )
      `)
      .eq('user_id', u.id)
      .order('created_at', { ascending: false });
    if (error) throw new Error(ASUNTA.dbErrorMessage(error));
    return data || [];
  }

  /* ---------- Cambio de contraseña ---------- */
  async function changePassword(newPassword) {
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' };
    }
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: traducirAuthError(error) };
    return { ok: true };
  }

  /* ---------- Reset de contraseña por correo ---------- */
  async function sendPasswordReset(email) {
    const { error } = await sb.auth.resetPasswordForEmail(String(email || '').trim().toLowerCase());
    if (error) return { ok: false, error: traducirAuthError(error) };
    return { ok: true };
  }

  /* ---------- Escucha cambios de sesión ---------- */
  function onSessionChange(cb) {
    sb.auth.onAuthStateChange((event, session) => {
      sessionCache = session || null;
      if (!session) profileCache = null;
      try { cb(event, session); } catch (e) { console.error(e); }
    });
  }

  return {
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    getSession: getSession,
    getUser: getUser,
    loadProfile: loadProfile,
    getProfile: getProfile,
    updateProfile: updateProfile,
    loadMyOrders: loadMyOrders,
    changePassword: changePassword,
    sendPasswordReset: sendPasswordReset,
    onSessionChange: onSessionChange,
    traducirAuthError: traducirAuthError
  };
})();
