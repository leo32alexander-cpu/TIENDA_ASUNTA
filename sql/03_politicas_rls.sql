-- ============================================================================
-- ASUNTA - MIGRACIÓN 03: POLÍTICAS RLS (SEGURIDAD A NIVEL DE FILA)
-- ----------------------------------------------------------------------------
-- DÓNDE EJECUTAR:  Supabase Dashboard  >  SQL Editor  >  New query  >  Run
-- REQUIERE:        01 y 02 ejecutadas antes.
--
-- Resumen del modelo de seguridad:
--   * PÚBLICO (anon): solo puede LEER productos activos, categorías activas,
--     promociones vigentes, imágenes y la configuración pública de la tienda.
--   * CLIENTE autenticado: además puede crear pedidos SOLO a través de la
--     función segura create_order y consultar SUS pedidos (RLS por user_id).
--   * ADMINISTRADOR (miembro de admin_users, verificado con is_admin()):
--     gestión completa de productos, categorías, promociones, pedidos,
--     inventario y configuración.
--
-- CAMBIO IMPORTANTE (justificado):
--   Se eliminan las políticas "Customers create own orders" y "Add items to
--   own pending orders". Con el nuevo flujo, la creación de pedidos y de sus
--   detalles pasa EXCLUSIVAMENTE por la función segura create_order, que
--   recalcula precios y valida stock en el servidor. Eso cierra la puerta a
--   pedidos manipulados desde el navegador (precios o cantidades falsos).
--   La lectura de pedidos propios y la función create_order siguen cubriendo
--   a los clientes autenticados; los invitados compran igual (user_id NULL).
-- ============================================================================

-- Habilita RLS en las tablas nuevas
alter table public.promotions         enable row level security;
alter table public.promotion_items    enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.store_settings     enable row level security;

-- ----------------------------------------------------------------------------
-- PROMOCIONES: lectura pública de ofertas/combos vigentes; gestión del admin
-- ----------------------------------------------------------------------------
drop policy if exists "Public read active promotions" on public.promotions;
create policy "Public read active promotions" on public.promotions
  for select to anon, authenticated
  using ((is_active = true) or public.is_admin());

drop policy if exists "Admin manage promotions" on public.promotions;
create policy "Admin manage promotions" on public.promotions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Componentes de combos: visibles si la promo está activa (o para el admin)
drop policy if exists "Public read promotion items" on public.promotion_items;
create policy "Public read promotion items" on public.promotion_items
  for select to anon, authenticated
  using (exists (
    select 1 from public.promotions pm
    where pm.id = promotion_id
      and ((pm.is_active = true) or public.is_admin())
  ));

drop policy if exists "Admin manage promotion items" on public.promotion_items;
create policy "Admin manage promotion items" on public.promotion_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- INVENTARIO: solo el administrador lee y registra movimientos.
-- No hay políticas de UPDATE ni DELETE: el historial es inmutable.
-- ----------------------------------------------------------------------------
drop policy if exists "Admin read movements" on public.inventory_movements;
create policy "Admin read movements" on public.inventory_movements
  for select to authenticated
  using (public.is_admin());

drop policy if exists "Admin insert movements" on public.inventory_movements;
create policy "Admin insert movements" on public.inventory_movements
  for insert to authenticated
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- CONFIGURACIÓN: lectura pública (delivery, WhatsApp, dirección, pagos),
-- modificación solo por el administrador.
-- ----------------------------------------------------------------------------
drop policy if exists "Public read settings" on public.store_settings;
create policy "Public read settings" on public.store_settings
  for select to anon, authenticated
  using (true);

drop policy if exists "Admin update settings" on public.store_settings;
create policy "Admin update settings" on public.store_settings
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admin insert settings" on public.store_settings;
create policy "Admin insert settings" on public.store_settings
  for insert to authenticated
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- ENDURECIMIENTO DE PEDIDOS: la escritura pasa SOLO por create_order
-- ----------------------------------------------------------------------------
drop policy if exists "Customers create own orders" on public.orders;
drop policy if exists "Add items to own pending orders" on public.order_items;
