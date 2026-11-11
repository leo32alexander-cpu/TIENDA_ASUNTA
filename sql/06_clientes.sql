-- ============================================================================
-- ASUNTA - MIGRACIÓN 06: CLIENTES REGISTRADOS
-- ----------------------------------------------------------------------------
-- DÓNDE EJECUTAR:  Supabase Dashboard  >  SQL Editor  >  New query  >  Run
-- REQUIERE:        Migraciones 01 → 04 ejecutadas antes.
-- ES RE-EJECUTABLE: si ya la ejecutaste, volver a correrla no modifica nada
--                   existente (todo usa "if not exists" / "drop policy if
--                   exists" antes de crear).
--
-- Qué hace esta migración:
--   6.1 Garantiza que exista la tabla `customers` con los campos necesarios
--       para el perfil del cliente (nombre, teléfono, dirección favorita,
--       distrito, referencia). El id del cliente = auth.users.id (1:1).
--   6.2 Crea un TRIGGER que automáticamente inserta una fila en `customers`
--       cada vez que un usuario nuevo se registra en Supabase Auth. Así el
--       cliente nunca se queda sin fila de perfil.
--   6.3 Habilita RLS en `customers`: cada cliente solo puede ver y editar SU
--       fila. El administrador puede ver todos los clientes.
--   6.4 Permite a los clientes autenticados LEER sus propios pedidos y sus
--       líneas (orders y order_items) directamente desde la base de datos
--       (para alimentar la página "Mis pedidos" sin usar lookup_order).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 6.1 Tabla `customers` (perfil del cliente, 1:1 con auth.users)
-- ----------------------------------------------------------------------------
-- Si tu proyecto ya tenía una tabla `customers`, este bloque NO la reemplaza:
-- solo agrega las columnas que usa la página "Mi cuenta" si faltan.
do $block$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'customers'
  ) then
    create table public.customers (
      id                 uuid primary key references auth.users(id) on delete cascade,
      full_name          varchar(150) not null default '',
      phone              varchar(30)  not null default '',
      default_address    text,
      default_district   varchar(80),
      default_reference  text,
      marketing_opt_in   boolean not null default false,
      active             boolean not null default true,
      created_at         timestamptz not null default now(),
      updated_at         timestamptz not null default now()
    );
  else
    -- La tabla ya existía: aseguramos las columnas nuevas si faltan.
    alter table public.customers
      add column if not exists full_name          varchar(150) not null default '',
      add column if not exists phone              varchar(30)  not null default '',
      add column if not exists default_address    text,
      add column if not exists default_district   varchar(80),
      add column if not exists default_reference  text,
      add column if not exists marketing_opt_in   boolean not null default false,
      add column if not exists active             boolean not null default true,
      add column if not exists updated_at         timestamptz not null default now();
  end if;
end
$block$;

-- Garantiza el trigger de updated_at (idempotente)
drop trigger if exists update_customers_timestamp on public.customers;
create trigger update_customers_timestamp
  before update on public.customers
  for each row execute function public.update_updated_at();

-- ----------------------------------------------------------------------------
-- 6.2 Trigger: crear fila en `customers` al registrarse un usuario nuevo
-- ----------------------------------------------------------------------------
-- Cuando un cliente hace signUp con Supabase Auth, se inserta una fila en
-- auth.users. Este trigger copia el id + metadatos (full_name, phone) a la
-- tabla public.customers para que el cliente tenga un perfil listo para
-- editar desde la página "Mi cuenta".
create or replace function public.handle_new_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.customers (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_customer();

-- ----------------------------------------------------------------------------
-- 6.3 RLS en `customers`: el cliente solo ve/edita SU fila; admin ve todo
-- ----------------------------------------------------------------------------
alter table public.customers enable row level security;

-- El cliente puede leer SU fila
drop policy if exists "Customers read own profile" on public.customers;
create policy "Customers read own profile" on public.customers
  for select to authenticated
  using (id = auth.uid());

-- El cliente puede actualizar SU fila (no puede cambiar el id)
drop policy if exists "Customers update own profile" on public.customers;
create policy "Customers update own profile" on public.customers
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- El cliente puede insertar SU fila (en caso de que el trigger no alcance)
drop policy if exists "Customers insert own profile" on public.customers;
create policy "Customers insert own profile" on public.customers
  for insert to authenticated
  with check (id = auth.uid());

-- El administrador puede ver todos los clientes
drop policy if exists "Admin read all customers" on public.customers;
create policy "Admin read all customers" on public.customers
  for select to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 6.4 RLS en `orders` y `order_items`: el cliente autenticado puede leer
--     SOLO los pedidos donde user_id = auth.uid()
-- ----------------------------------------------------------------------------
-- Esto permite alimentar la página "Mis pedidos" directamente desde la base
-- de datos, sin necesidad de usar lookup_order (que sigue estando disponible
-- para clientes invitados que compran sin cuenta).

drop policy if exists "Customers read own orders" on public.orders;
create policy "Customers read own orders" on public.orders
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Customers read own order items" on public.order_items;
create policy "Customers read own order items" on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (o.user_id = auth.uid() or public.is_admin())
    )
  );

-- ----------------------------------------------------------------------------
-- 6.5 Función auxiliar para que el admin vea la lista completa de clientes
--     con cantidad de pedidos y total acumulado.
-- ----------------------------------------------------------------------------
create or replace function public.list_customers()
returns table (
  id              uuid,
  full_name       varchar(150),
  phone           varchar(30),
  default_address text,
  default_district varchar(80),
  created_at      timestamptz,
  orders_count    bigint,
  total_spent     numeric(12,2)
)
language sql
security definer
set search_path = ''
as $$
  select c.id,
         c.full_name,
         c.phone,
         c.default_address,
         c.default_district,
         c.created_at,
         count(o.id)        as orders_count,
         coalesce(sum(o.total), 0) as total_spent
    from public.customers c
    left join public.orders o on o.user_id = c.id
   group by c.id, c.full_name, c.phone, c.default_address, c.default_district, c.created_at
   order by c.created_at desc;
$$;

revoke all on function public.list_customers() from public;
grant execute on function public.list_customers() to authenticated;
