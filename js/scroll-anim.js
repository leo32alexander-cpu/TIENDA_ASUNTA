/* ============================================================
   ASUNTA - js/scroll-anim.js  (ARCHIVO NUEVO: no modifica ningún
   archivo existente, solo agrega comportamiento).

   Animación fade-in al hacer scroll usando IntersectionObserver
   (vanilla JS, sin librerías).

   Funcionamiento:
   - Todo elemento con class="reveal" arranca invisible (ver CSS
     agregado al final del <head> de index.html).
   - Cuando entra en el viewport se le agrega la clase "visible",
     lo que dispara la transición fade-in definida en el CSS.

   Nota: el contenedor de la sección del catálogo (#productos) NO
   se toca en index.html ni en store.js: este módulo le agrega la
   clase "reveal" por JS a nivel de sección, tal como se pidió.
   ============================================================ */
(function () {
  'use strict';

  function iniciarAnimacionesScroll() {
    /* 1) Aplicar "reveal" al CONTENEDOR de la sección del catálogo.
       Se hace por JavaScript para no modificar una sola línea
       existente de index.html ni el render de store.js. */
    var seccionCatalogo = document.getElementById('productos');
    if (seccionCatalogo && !seccionCatalogo.classList.contains('reveal')) {
      seccionCatalogo.classList.add('reveal');
    }

    /* 2) Observar todos los elementos .reveal (sección Nuestra Tienda,
       franja de bienvenida, badges de confianza y el catálogo). */
    var elementos = document.querySelectorAll('.reveal');

    /* Navegadores sin IntersectionObserver: mostrar todo sin animar. */
    if (!('IntersectionObserver' in window)) {
      elementos.forEach(function (el) { el.classList.add('visible'); });
      return;
    }

    var observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (entrada.isIntersecting) {
          entrada.target.classList.add('visible');
          /* Se anima una sola vez y se deja de observar. */
          observador.unobserve(entrada.target);
        }
      });
    }, { threshold: 0.1 });

    elementos.forEach(function (el) { observador.observe(el); });
  }

  /* El script se carga con defer (después de los scripts existentes),
     pero se deja el guard por si se cambia la forma de carga. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarAnimacionesScroll);
  } else {
    iniciarAnimacionesScroll();
  }
})();
