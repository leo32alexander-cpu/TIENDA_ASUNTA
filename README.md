# ASUNTA – Tienda Virtual de Abarrotes (Comas, Lima)

Tienda virtual completa conectada a **Supabase** (PostgreSQL + Auth + Storage).
Identidad visual original conservada: verde `#16a34a`, amarillo `#facc15`, blanco,
tipografía **Inter**.

## Contenido de la carpeta

```
asunta-tienda/
├── index.html                 → Tienda pública (catálogo, carrito, checkout)
├── admin.html                 → Panel administrativo protegido
├── css/styles.css             → Estilos adicionales (identidad ASUNTA)
├── js/
│   ├── supabase.js            → Conexión a Supabase + utilidades compartidas
│   ├── auth.js                → Autenticación y autorización (is_admin en servidor)
│   ├── store.js               → Catálogo, filtros, ofertas, mapa
│   ├── cart.js                → Carrito persistente (localStorage)
│   ├── checkout.js            → Registro real del pedido (función create_order)
│   ├── orders.js              → Consulta segura de pedidos por código + teléfono
│   ├── admin.js               → Núcleo del panel: guard, dashboard, configuración
│   ├── admin-products.js      → CRUD de productos + imágenes (Storage)
│   ├── admin-categories.js    → CRUD de categorías
│   ├── admin-promos.js        → Ofertas y combos administrables
│   ├── admin-orders.js        → Panel de pedidos y cambio de estados
│   └── inventory.js           → Entradas, salidas, ajustes e historial
├── sql/                       → Migraciones (ejecutar EN ORDEN en Supabase SQL Editor)
│   ├── 01_estructura_complementaria.sql
│   ├── 02_funciones_seguras.sql
│   ├── 03_politicas_rls.sql
│   ├── 04_storage.sql
│   └── 05_seed_opcional.sql   → (OPCIONAL) catálogo inicial de ejemplo
└── _original_backup/
    └── avance.html            → Copia de tu archivo original (sin modificar)
```

## Instalación en 6 pasos (Supabase + hosting)

### 1. Ejecutar las migraciones SQL (obligatorio)
Entra a https://supabase.com/dashboard → tu proyecto `ftbyxefpyjxerwrilftv`
→ menú **SQL Editor** → **New query** → pega el contenido completo de cada
archivo (uno por uno, en orden) → **Run**:

1. `sql/01_estructura_complementaria.sql`
2. `sql/02_funciones_seguras.sql`
3. `sql/03_politicas_rls.sql`
4. `sql/04_storage.sql`
5. `sql/05_seed_opcional.sql` (opcional: carga el catálogo de ejemplo con
   stocks provisionales de 25 unidades; ajústalos luego en el módulo Inventario)

### 2. Subir imágenes
Las imágenes se suben desde el panel (módulo Productos) al bucket público
`product-images` (creado por la migración 04, límite 2 MB, JPG/PNG/WEBP).

### 3. Contraseña del administrador
La contraseña de `leo27alexander@admin.com` se gestiona en
**Dashboard → Authentication → Users** (no está escrita en ningún archivo).
Si necesitas restablecerla: usa el botón "Olvidé mi contraseña" del panel
(requiere SMTP configurado en Authentication) o envía un reset desde
Authentication → Users → Send magic link / reset.

### 4. Publicar los archivos
Sube TODO el contenido de esta carpeta a un hosting estático:
- **Netlify**: arrastrar la carpeta en app.netlify.com → "Sites".
- **GitHub Pages**: subir a un repositorio → Settings → Pages → main.
- **Vercel**: vercel.com → New Project → importar carpeta.
No se necesita build ni servidor: es HTML + JS estáticos.

### 5. Configurar la tienda
Entra a `https://tu-dominio/admin.html` con `leo27alexander@admin.com` y
en **Configuración** define: WhatsApp real (hoy provisional 51999999999),
dirección exacta, coordenadas del mapa, costo de delivery (S/ 3.00),
delivery gratis desde (S/ 50.00) y métodos de pago.

### 6. Verificar
- Abre `index.html` publicado: deben verse los productos y categorías reales.
- Realiza una compra de prueba y verifica el pedido en **Pedidos** del panel.
- Marca el pedido como *Entregado* y revisa las estadísticas del **Dashboard**.

## Segunda revisión (esquema real verificado)

Se verificó la estructura REAL de tu proyecto de Supabase mediante consultas
de solo lectura y se corrigió el paquete para que coincida al 100%:

- Tus tablas `promotions` y `promotion_items` usan `is_active` y
  `discount_percentage`; migraciones 01/02/03/05 corregidas para usar esos
  nombres exactos (antes fallarían al ejecutarse).
- `promotion_items` no tenía `quantity`: la migración 01 la agrega con valor
  por defecto 1 (tus combos actuales siguen funcionando).
- Regla de precios unificada (tienda + panel + servidor): oferta = precio
  fijo `promo_price` si existe, si no `discount_percentage` sobre el precio
  de lista; combo = precio fijo o porcentaje sobre sus componentes.
- `admin-promos.js` corregido (leía/escribía columnas inexistentes).
- Al eliminar un producto ya no se intentan borrar movimientos de inventario
  (historial inmutable; la FK `ON DELETE SET NULL` los conserva).

Validación: réplica local de PostgreSQL 17 con tu esquema real →
**62 pruebas automatizadas aprobadas, 0 fallidas** (RLS, pedidos atómicos,
precios, combos con cantidades, idempotencia, cancelación con devolución
de stock, inventario solo-admin).

## Tercera revisión (revisión integral del código + estado real verificado)

Revisión cruzada completa del paquete antes de la entrega final:

- **Referencias**: los dos HTML cargan exactamente los 12 módulos JS existentes;
  sintaxis validada con `node --check` (0 errores); verificación cruzada
  automatizada de todos los IDs usados por el JavaScript contra el HTML.
- **Firmas RPC**: las 4 funciones que el frontend invoca coinciden 1:1 con la
  migración 02 (`create_order` 10 parámetros, `lookup_order` 2, `adjust_stock` 5,
  `is_admin`).
- **Corrección defensiva 1**: la migración 01 ahora crea `is_admin()` SOLO si el
  proyecto no la tiene (detecta la estructura real de `admin_users`: columna
  `user_id` o `email`). Nunca reemplaza la versión original.
- **Corrección defensiva 2**: la migración 01 garantiza `sku`, `cost_price` y
  `featured` en `products` con `add column if not exists`.
- Ambas correcciones son idempotentes: **si ya ejecutaste la migración 01 antes
  de esta revisión, correrala una vez más**; no modifica nada de lo existente.

**Estado real de tu Supabase (verificado por API pública a la fecha de esta
revisión):** las tablas originales existen (categories tiene "Abarrotes");
`products`, `promotions` y `promotion_items` están vacías; `store_settings` e
`inventory_movements` NO existen → **las migraciones 01→04 siguen sin ejecutarse**.
Que la página cargue su diseño no significa que la tienda opere: sin las
migraciones, el catálogo queda vacío y el checkout no registra pedidos.

> **IMPORTANTE – pendiente de tu lado:** ejecuta los 5 archivos SQL en orden
> (paso 1 de arriba), crea/verifica `leo27alexander@admin.com` en
> Authentication → Users, registra tus productos y configura WhatsApp real,
> dirección y coordenadas desde el panel. Lista completa con estados:
> sección 5.15 del manual (Parte V).

## Registro de clientes (NUEVO)

Se añadió un sistema completo de cuentas de cliente. **Requiere ejecutar la
migración 06** además de las 4 obligatorias anteriores:

6. `sql/06_clientes.sql` — crea la tabla `customers` (perfil 1:1 con
   `auth.users`), un trigger que crea automáticamente la fila de perfil al
   registrarse un usuario, políticas RLS para que cada cliente solo vea y
   edite SUS datos y SUS pedidos, y una función `list_customers()` para que
   el administrador vea todos los clientes con su historial de compras.

### Cómo activarlo
1. Ejecuta `sql/06_clientes.sql` en Supabase SQL Editor (Run).
2. Verifica en **Authentication → Sign In / Providers → Email** que el
   proveedor de correo esté activado y que "Confirm email" esté como
   prefieras (recomendado: activado para mayor seguridad).
3. Abre `cuenta.html` desde tu sitio publicado y prueba el registro.

### Qué incluye
- `cuenta.html`: página con pestañas **Iniciar sesión / Crear cuenta /
  Recuperar contraseña** y, ya autenticado, **Mis datos / Mis pedidos /
  Seguridad** (cambio de contraseña).
- `js/customer-auth.js`: registro, login, logout, edición de perfil, lectura
  de pedidos propios.
- `index.html` y `js/store.js`: botón "Iniciar sesión / Mi cuenta" en el
  header; muestra el nombre del cliente cuando hay sesión activa.
- `js/checkout.js`: si el cliente inició sesión, el formulario de compra se
  **rellena automáticamente** con su nombre, teléfono, correo y dirección
  favorita guardada.
- `js/orders.js`: si el cliente inició sesión, la consulta de pedidos
  muestra su historial completo sin pedir código ni teléfono.
- **Panel admin – módulo Clientes (NUEVO)**: botón "Clientes" en el sidebar
  del admin (`admin.html` + `js/admin-customers.js`). Lista todos los
  clientes con teléfono, dirección favorita, número de pedidos y total
  comprado. Incluye buscador y modal de detalle con el historial completo
  de pedidos del cliente.
- **Panel admin – módulo Pedidos mejorado**: cada pedido muestra un badge
  "Registrado" o "Invitado" según si fue hecho con cuenta o sin ella, y
  muestra el correo del cliente cuando lo aportó.
- Cada pedido hecho por un cliente autenticado queda vinculado a su cuenta
  (`orders.user_id = auth.uid()`), permitiendo verlo después en "Mis
  pedidos" y en el panel admin.

### Notas de seguridad
- Las cuentas de cliente **NO** pueden entrar al panel admin: si una cuenta
  resulta ser el administrador, se le invita a usar `admin.html`.
- El administrador lista los clientes con la función SQL `list_customers()`
  (security definer, solo ejecutable por authenticated; internamente valida
  `is_admin()` para acceder a todos los registros).
- Las compras como invitado siguen funcionando: clientes sin cuenta pueden
  comprar y consultar su pedido con código + teléfono.

## Seguridad implementada
- RLS en las 11 tablas: público solo lectura del catálogo; clientes solo sus
  pedidos; administrador único (verificado con `is_admin()` en el servidor).
- Precios, promociones y stock se calculan SIEMPRE en el servidor
  (`create_order`): el navegador solo envía ids y cantidades.
- Pedidos atómicos con bloqueo de filas: nunca hay sobreventa ni pedidos
  incompletos; cancelación devuelve el stock exactamente una vez.
- Idempotencia de pedidos: los reintentos de red no duplican compras.
- Publishable key pública en el cliente (sin service_role en el frontend).
