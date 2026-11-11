/* ============================================================
   ASUNTA - js/auth.js
   Autenticación y autorización con Supabase Auth.

   Roles en el sistema:
     * Administrador: único. Debe existir en la tabla admin_users
       (el proyecto ya lo tiene registrado con leo27alexander@admin.com).
       El check REAL se hace en el servidor con la función SQL
       is_admin() y con las políticas RLS, no con JavaScript.
     * Clientes: pueden comprar como invitados; el panel administrativo
       les está prohibido tanto en el frontend como (de verdad) en la
       base de datos.
   ============================================================ */

window.ASUNTA = window.ASUNTA || {};

ASUNTA.auth = (function () {
  'use strict';

  const sb = ASUNTA.sb;

  /* Sesión actual (cacheada por el SDK de Supabase en localStorage) */
  async function getSession() {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data && data.session ? data.session : null;
  }

  async function getUser() {
    const s = await getSession();
    return s ? s.user : null;
  }

  /* ¿El usuario de la sesión actual es el administrador?
     La respuesta la decide Supabase (función is_admin + RLS),
     no este archivo. */
  async function isAdmin() {
    const s = await getSession();
    if (!s) return false;
    const { data, error } = await sb.rpc('is_admin');
    if (error) {
      console.warn('[ASUNTA] is_admin falló:', error.message);
      return false;
    }
    return data === true;
  }

  /* Inicia sesión y comprueba autorización de administrador.
     Devuelve { ok, needsPasswordChange?, error? } */
  async function signInAdmin(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({
      email: String(email || '').trim(),
      password: String(password || '')
    });
    if (error) return { ok: false, error: traducirAuthError(error) };

    const admin = await isAdmin();
    if (!admin) {
      // No es el administrador autorizado: cerrar sesión inmediatamente
      await sb.auth.signOut();
      return {
        ok: false,
        error: 'Esta cuenta no tiene permisos de administrador. Solo el administrador autorizado puede ingresar.'
      };
    }
    return { ok: true, user: data.user };
  }

  async function signOut() {
    const { error } = await sb.auth.signOut();
    if (error) console.warn('[ASUNTA] signOut:', error.message);
    return !error;
  }

  /* Envía el correo de recuperación de contraseña.
     Requiere SMTP configurado en Supabase (Dashboard > Authentication). */
  async function sendPasswordReset(email) {
    const { error } = await sb.auth.resetPasswordForEmail(String(email || '').trim());
    if (error) return { ok: false, error: traducirAuthError(error) };
    return { ok: true };
  }

  /* Cambia la contraseña del usuario autenticado
     (se usa al aterrizar desde el enlace de recuperación). */
  async function updatePassword(newPassword) {
    const { error } = await sb.auth.updateUser({ password: String(newPassword || '') });
    if (error) return { ok: false, error: traducirAuthError(error) };
    return { ok: true };
  }

  /* Escucha cambios de sesión (incluye cierre de sesión en otra pestaña) */
  function onSessionChange(cb) {
    sb.auth.onAuthStateChange((event, session) => {
      try { cb(event, session); } catch (e) { console.error(e); }
    });
  }

  function traducirAuthError(err) {
    const m = (err && err.message) || '';
    if (/Invalid login credentials/i.test(m)) {
      return 'Correo o contraseña incorrectos.';
    }
    if (/Email not confirmed/i.test(m)) {
      return 'El correo aún no está confirmado. Verifica tu correo en Supabase Auth.';
    }
    if (/Failed to fetch|NetworkError/i.test(m)) {
      return 'No se pudo conectar con el servidor de autenticación. Verifica tu conexión.';
    }
    if (/rate limit/i.test(m)) {
      return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
    }
    return m || 'Error de autenticación.';
  }

  return {
    getSession: getSession,
    getUser: getUser,
    isAdmin: isAdmin,
    signInAdmin: signInAdmin,
    signOut: signOut,
    sendPasswordReset: sendPasswordReset,
    updatePassword: updatePassword,
    onSessionChange: onSessionChange
  };
})();
