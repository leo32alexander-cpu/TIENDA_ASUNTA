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

## Seguridad implementada
- RLS en las 11 tablas: público solo lectura del catálogo; clientes solo sus
  pedidos; administrador único (verificado con `is_admin()` en el servidor).
- Precios, promociones y stock se calculan SIEMPRE en el servidor
  (`create_order`): el navegador solo envía ids y cantidades.
- Pedidos atómicos con bloqueo de filas: nunca hay sobreventa ni pedidos
  incompletos; cancelación devuelve el stock exactamente una vez.
- Idempotencia de pedidos: los reintentos de red no duplican compras.
- Publishable key pública en el cliente (sin service_role en el frontend).
