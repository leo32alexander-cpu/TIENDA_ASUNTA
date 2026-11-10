-- ============================================================================
-- ASUNTA - MIGRACIÓN 01: ESTRUCTURA COMPLEMENTARIA
-- ----------------------------------------------------------------------------
-- DÓNDE EJECUTAR:  Supabase Dashboard  >  SQL Editor  >  New query  >  Run
-- ORDEN:           01 → 02 → 03 → 04 → (05 opcional)
--
-- Esta migración NO elimina ni recrea las 7 tablas existentes
-- (products, categories, orders, order_items, customers, admin_users,
-- admin_activity). Solo AGREGA columnas, índices y tablas complementarias.
-- Es RE-EJECUTABLE: si ya la ejecutaste antes, correrla de nuevo no
-- modifica nada (todo usa "if not exists" / "if not found").
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1.0 Garantías para el panel administrativo (todo es idempotente)
-- ----------------------------------------------------------------------------
-- a) La función is_admin() es la llave de TODA la seguridad (migraciones 03
--    y 04 la usan al crear las políticas). El proyecto original normalmente
--    ya la tiene; este bloque SOLO la crea si NO existe, sin reemplazar
--    nunca la versión original.
do $block$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name  = 'admin_users'
        and column_name = 'user_id'
    ) then
      create function public.is_admin() returns boolean
        language sql stable security definer set search_path = ''
        as $fn$
          select exists (
            select 1 from public.admin_users
            where user_id = auth.uid()
          );
        $fn$;
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name  = 'admin_users'
        and column_name = 'email'
    ) then
      create function public.is_admin() returns boolean
        language sql stable security definer set search_path = ''
        as $fn$
          select exists (
            select 1 from public.admin_users au
            join auth.users u on u.id = auth.uid()
            where lower(btrim(au.email)) = lower(u.email)
          );
        $fn$;
    else
      raise exception 'No existe public.is_admin() ni una tabla admin_users con columna user_id o email. Registre primero al administrador.';
    end if;
  end if;
end
$block$;

-- b) Columnas de productos que usa el panel (si tu tabla ya las tiene,
--    estas líneas no hacen nada):
alter table public.products
  add column if not exists sku         text,
  add column if not exists cost_price  numeric(12,2) check (cost_price >= 0),
  add column if not exists featured    boolean not null default false;

-- ----------------------------------------------------------------------------
-- 1.1 Columnas nuevas en `orders`
--     order_code        -> código público del pedido (ASU-000001) para
--                          WhatsApp y consulta por parte del cliente.
--     district          -> distrito de entrega (formulario de compra).
--     address_reference -> referencia del domicilio (formulario de compra).
--     idempotency_key   -> evita pedidos duplicados por reintentos del
--                          navegador o de la red (clave única generada por el
--                          cliente y validada en el servidor).
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists order_code text,
  add column if not exists district text,
  add column if not exists address_reference text,
  add column if not exists idempotency_key uuid;

-- Secuencia para códigos de pedido legibles y únicos
create sequence if not exists public.order_code_seq start 1;

create unique index if not exists orders_order_code_key
  on public.orders (order_code) where order_code is not null;

create unique index if not exists orders_idempotency_key
  on public.orders (idempotency_key) where idempotency_key is not null;

-- Índice útil para consultar el historial de un producto
create index if not exists idx_order_items_product
  on public.order_items (product_id);

-- ----------------------------------------------------------------------------
-- 1.1b Columna quantity en promotion_items: indica cuántas unidades de cada
--      producto contiene el combo. La tabla promotions/promotion_items ya
--      existía en el proyecto SIN esta columna, por eso se agrega con
--      ALTER TABLE (los combos existentes quedan con quantity = 1).
-- ----------------------------------------------------------------------------
alter table public.promotion_items
  add column if not exists quantity numeric(12,3) not null default 1
    check (quantity > 0);

-- Índice para resolver las ofertas vigentes de un producto rápidamente
create index if not exists idx_promotions_product
  on public.promotions (product_id, type);

-- ----------------------------------------------------------------------------
-- 1.2 Tabla `promotions` (ofertas y combos administrables)
--     type = 'oferta'  -> precio promocional de UN producto
--                         (product_id obligatorio + promo_price o % descuento)
--     type = 'combo'   -> paquete de varios productos a precio de combo
--                         (los componentes se registran en promotion_items)
-- ----------------------------------------------------------------------------
create table if not exists public.promotions (
  id                   uuid primary key default gen_random_uuid(),
  title                varchar(150) not null,
  name                 varchar(150),
  description          text,
  type                 varchar(10) not null default 'oferta'
                         check (type in ('oferta','combo')),
  product_id           uuid references public.products(id) on delete cascade,
  promo_price          numeric(12,2) check (promo_price >= 0),
  discount_percentage  numeric(5,2)  check (discount_percentage between 0 and 100),
  image_url            text,
  badge                varchar(50),
  start_date           date,
  end_date             date,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint promotions_valid_type check (
    ( type = 'oferta' and product_id is not null
                       and (promo_price is not null or discount_percentage is not null) )
    or
    ( type = 'combo' and (promo_price is not null or discount_percentage is not null) )
  )
);

-- Componentes de cada combo (qué productos y cuántas unidades de cada uno)
create table if not exists public.promotion_items (
  id           uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  quantity     numeric(12,3) not null check (quantity > 0),
  constraint promotion_items_unique unique (promotion_id, product_id)
);

-- ----------------------------------------------------------------------------
-- 1.3 Tabla `inventory_movements` (control de inventario)
--     Cada venta, entrada de mercadería o ajuste queda registrado aquí.
--     El historial es inmutable: no existen políticas de UPDATE/DELETE.
--     `reference` guarda el order_code para poder devolver stock al cancelar.
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid references public.products(id) on delete set null,
  movement_type varchar(10) not null
                  check (movement_type in ('entrada','salida','ajuste')),
  quantity      numeric(12,3) not null check (quantity > 0),
  previous_stock numeric(12,3) not null,
  new_stock      numeric(12,3) not null,
  reference      varchar(50),
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_movements_product
  on public.inventory_movements (product_id, created_at desc);
create index if not exists idx_movements_reference
  on public.inventory_movements (reference);
create index if not exists idx_movements_created
  on public.inventory_movements (created_at desc);

-- ----------------------------------------------------------------------------
-- 1.4 Tabla `store_settings` (configuración administrable, una sola fila)
--     Delivery, WhatsApp, dirección/coordenadas del negocio, métodos de pago
--     y umbral de stock bajo. El panel administrativo puede modificarla.
-- ----------------------------------------------------------------------------
create table if not exists public.store_settings (
  id                      smallint primary key default 1 check (id = 1),
  delivery_fee            numeric(12,2) not null default 3.00
                            check (delivery_fee >= 0),
  free_delivery_threshold numeric(12,2) not null default 50.00
                            check (free_delivery_threshold >= 0),
  whatsapp_number         varchar(20) not null default '51999999999',
  store_address           text not null default
    'Av. Universitaria / Zona Comercial (Referencial), Comas, Lima, Perú',
  store_lat               double precision not null default -11.9355,
  store_lng               double precision not null default -77.0572,
  payment_methods         jsonb not null
                            default '["Efectivo contra entrega","Yape","Plin"]'::jsonb,
  low_stock_threshold     numeric(12,3) not null default 10
                            check (low_stock_threshold >= 0),
  updated_at              timestamptz not null default now()
);

-- Fila única de configuración (idempotente)
insert into public.store_settings (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 1.5 Timestamps automáticos para las tablas nuevas
--     Reutiliza la función update_updated_at si el proyecto ya la tiene;
--     si no existe, se crea con la implementación estándar (idempotente:
--     nunca reemplaza una versión ya presente).
-- ----------------------------------------------------------------------------
do $block$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_updated_at'
  ) then
    create function public.update_updated_at() returns trigger
      language plpgsql as $fn$
      begin
        new.updated_at := now();
        return new;
      end;
      $fn$;
  end if;
end
$block$;
drop trigger if exists update_promotions_timestamp on public.promotions;
create trigger update_promotions_timestamp
  before update on public.promotions
  for each row execute function public.update_updated_at();

drop trigger if exists update_store_settings_timestamp on public.store_settings;
create trigger update_store_settings_timestamp
  before update on public.store_settings
  for each row execute function public.update_updated_at();
