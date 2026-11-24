/* ============================================================
   ASUNTA - js/nuestra-tienda.js  (ARCHIVO NUEVO: no modifica
   ningún archivo existente, solo agrega comportamiento).

   Carga los datos DINÁMICOS de la sección #nuestra-tienda a
   partir de store_settings, usando ASUNTA.getSettings() de
   js/supabase.js: exactamente la MISMA fuente que usa la tienda
   para whatsapp_number y store_address.

   - Dirección   -> store_settings.store_address
   - WhatsApp    -> store_settings.whatsapp_number (enlace wa.me)
   - Mini-mapa   -> store_settings.store_lat / store_lng
                    (Google Maps embebido; si no hay coordenadas,
                     el contenedor del mapa permanece oculto)
   - Cómo llegar -> Google Maps con las coordenadas (pestaña nueva)
   ============================================================ */
(function () {
  'use strict';

  /* Respaldo idéntico a DEFAULT_SETTINGS de js/supabase.js: se usa
     solo si la configuración aún no llegó desde la base de datos. */
  const WHATSAPP_RESPALDO = '51923736870';

  /* 51923736870 -> "+51 923 736 870" (solo para mostrarlo bonito). */
  function formatearNumero(wa) {
    if (wa.length === 11 && wa.indexOf('51') === 0) {
      return '+51 ' + wa.slice(2, 5) + ' ' + wa.slice(5, 8) + ' ' + wa.slice(8);
    }
    return '+' + wa;
  }

  async function cargarDatosTienda() {
    try {
      /* Misma fuente que la tienda (cacheada: no hace una segunda
         consulta a store_settings). */
      const s = await ASUNTA.getSettings();

      /* 1) Dirección (store_address) */
      const dirEl = document.getElementById('nt-direccion');
      if (dirEl && s.store_address) {
        dirEl.textContent = s.store_address;
      }

      /* 2) WhatsApp (whatsapp_number) como enlace wa.me */
      const wa = String(s.whatsapp_number || WHATSAPP_RESPALDO).replace(/\D/g, '');
      const waEl = document.getElementById('nt-whatsapp-enlace');
      if (waEl && wa) {
        waEl.href = 'https://wa.me/' + wa;
        waEl.textContent = formatearNumero(wa);
      }

      /* 3) Mini-mapa con store_lat / store_lng */
      const lat = Number(s.store_lat);
      const lng = Number(s.store_lng);
      const tieneCoords = Number.isFinite(lat) && Number.isFinite(lng);
      const mapaBox = document.getElementById('nt-mapa-contenedor');
      const mapaEl = document.getElementById('nt-mapa');
      const btnEl = document.getElementById('nt-como-llegar');

      if (tieneCoords) {
        /* Mapa embebido de Google Maps (no requiere API key).
           Ancho 100% y alto 250px se definen por clases en el HTML. */
        if (mapaEl) {
          mapaEl.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng) +
                       '&z=16&hl=es&output=embed';
        }
        /* Con coordenadas se muestra el contenedor del mapa. */
        if (mapaBox) mapaBox.classList.remove('hidden');
        /* Botón "Cómo llegar": ruta hacia las coordenadas, pestaña nueva. */
        if (btnEl) {
          btnEl.href = 'https://www.google.com/maps/dir/?api=1&destination=' +
                       encodeURIComponent(lat + ',' + lng);
        }
      } else if (btnEl && s.store_address) {
        /* Sin coordenadas: el mapa NUNCA se muestra y el botón cae a
           una búsqueda por la dirección textual de la tienda. */
        btnEl.href = 'https://www.google.com/maps/search/?api=1&query=' +
                     encodeURIComponent(s.store_address);
      }
    } catch (e) {
      /* La sección queda con sus valores iniciales del HTML. */
      console.warn('[ASUNTA] nuestra-tienda: no se pudo leer la configuración:', e && e.message);
    }
  }

  /* El script se carga con defer (el DOM ya está listo), pero se
     deja el guard por si se cambia la forma de carga. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cargarDatosTienda);
  } else {
    cargarDatosTienda();
  }
})();
