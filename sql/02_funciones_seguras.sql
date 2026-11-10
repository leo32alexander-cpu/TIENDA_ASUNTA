-- ============================================================================
-- ASUNTA - MIGRACIÓN 02: FUNCIONES SEGURAS (BACKEND SQL)
-- ----------------------------------------------------------------------------
-- DÓNDE EJECUTAR:  Supabase Dashboard  >  SQL Editor  >  New query  >  Run
-- REQUIERE:        01_estructura_complementaria.sql ejecutada antes.
--
-- Contenido:
--   2.1 set_order_item_price (REEMPLAZA la versión anterior - ver nota)
--   2.2 create_order      -> registra el pedido de forma ATÓMICA: valida
--                            datos, precios reales, promociones vigentes y
--                            stock; descuenta inventario; genera código.
--   2.3 lookup_order      -> consulta segura de pedido para clientes
--                            (código + teléfono privado).
--   2.4 adjust_stock      -> entradas, salidas y ajustes de inventario
--                            con historial (solo administrador).
--   2.5 handle_order_cancellation -> al cancelar un pedido devuelve el
--                            stock exactamente como se descontó (una sola vez).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.1 set_order_item_price (actualización de la función existente)
--
--     POR QUÉ SE REEMPLAZA: la versión original rechazaba toda línea con
--     product_id NULL, lo que impedía registrar COMBOS en order_items; y
--     forzaba siempre el precio de lista, lo que impedía aplicar precios
--     promocionales. La nueva versión:
--       * sigue fijando nombre y unidad desde la tabla products (el cliente
--         nunca puede inventarlos),
--       * respeta el precio enviado SOLO cuando la inserción proviene de la
--         función segura create_order (contexto de servidor, marcado con el
--         GUC de transacción app.create_order) o cuando es el administrador,
--       * en cualquier otro caso fija el precio de lista de la base de datos.
--     La escritura directa de clientes en order_items queda bloqueada por
--     políticas RLS (ver migración 03), así que el trigger actúa como doble
--     barrera defensiva.
-- ----------------------------------------------------------------------------
create or replace function public.set_order_item_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    p record;
    owner_id uuid;
    order_state text;
    v_server_ctx boolean;
BEGIN
    v_server_ctx := coalesce(current_setting('app.create_order', true), '') = 'on';

    SELECT user_id, status
    INTO owner_id, order_state
    FROM public.orders
    WHERE id = NEW.order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido no encontrado';
    END IF;

    IF NOT public.is_admin() AND NOT v_server_ctx THEN
        IF owner_id IS DISTINCT FROM (SELECT auth.uid())
           OR order_state <> 'pending' THEN
            RAISE EXCEPTION 'Operacion no autorizada';
        END IF;
    END IF;

    IF NEW.product_id IS NOT NULL THEN
        SELECT name, price, unit, active
        INTO p
        FROM public.products
        WHERE id = NEW.product_id;

        IF NOT FOUND OR NOT p.active THEN
            RAISE EXCEPTION 'Producto no disponible';
        END IF;

        NEW.product_name := p.name;
        NEW.unit := p.unit;
        IF NOT v_server_ctx THEN
            NEW.unit_price := p.price;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Re-crea el trigger existente apuntando a la función actualizada
drop trigger if exists protect_order_item_price on public.order_items;
create trigger protect_order_item_price
  before insert or update on public.order_items
  for each row execute function public.set_order_item_price();

-- ----------------------------------------------------------------------------
-- 2.2 create_order: registro atómico del pedido (venta real)
--
--     Recibe el carrito como JSONB (sin precios: los precios los calcula el
--     servidor). Dentro de UNA transacción:
--       1. Verifica idempotencia (evita pedidos duplicados por reintento).
--       2. Valida los datos del cliente.
--       3. Bloquea las filas de productos (FOR UPDATE) para evitar sobreventa
--          con pedidos concurrentes.
--       4. Valida producto activo + stock suficiente (incluye componentes de
--          combos).
--       5. Calcula los precios vigentes en la base de datos y aplica la mejor
--          promoción activa por fecha.
--       6. Calcula el delivery según store_settings (gratis desde el umbral).
--       7. Inserta el pedido y sus detalles (el trigger recalcula totales).
--       8. Descuenta existencias y registra movimientos de inventario.
--     Si cualquier paso falla, TODO se revierte (no quedan pedidos incompletos
--     ni inventario mal descontado).
-- ----------------------------------------------------------------------------
create or replace function public.create_order(
  p_customer_name     text,
  p_customer_phone    text,
  p_customer_email    text,
  p_delivery_address  text,
  p_district          text,
  p_items             jsonb,
  p_address_reference text default null,
  p_notes             text default null,
  p_payment_method    text default 'Efectivo contra entrega',
  p_idempotency_key   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := auth.uid();
  v_order_id      uuid;
  v_order_code    text;
  v_settings      public.store_settings%rowtype;
  v_subtotal      numeric(12,2) := 0;
  v_delivery      numeric(12,2);
  v_item          jsonb;
  v_type          text;
  v_pid           uuid;
  v_qty           numeric(12,3);
  v_prod          record;
  v_promo         record;
  v_unit_price    numeric(12,2);
  v_compare_at    numeric(12,2);
  v_combo_title   text;
  v_combo_price   numeric(12,2);
  v_compare_sum   numeric(12,2);
  v_pid2          uuid;
  v_q2            numeric(12,3);
  v_prev          numeric(12,3);
  v_new           numeric(12,3);
  v_ids           uuid[] := '{}';
  v_n_items       int := 0;
  v_phone_digits  text;
  v_lines         jsonb := '[]'::jsonb;
  v_line          jsonb;
begin
  -- ---------- 1. Idempotencia: si el pedido ya existe, devolverlo ----------
  if p_idempotency_key is not null then
    select id, order_code
      into v_order_id, v_order_code
      from public.orders
     where idempotency_key = p_idempotency_key
     limit 1;
    if found then
      return jsonb_build_object(
        'duplicate',  true,
        'order_id',   v_order_id,
        'order_code', v_order_code
      );
    end if;
  end if;

  -- ---------- 2. Validación de datos del cliente ----------
  if p_customer_name is null or length(btrim(p_customer_name)) < 3
     or length(btrim(p_customer_name)) > 150 then
    raise exception 'Ingrese un nombre completo valido (minimo 3 caracteres)';
  end if;

  v_phone_digits := regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g');
  if length(v_phone_digits) < 6 or length(v_phone_digits) > 15 then
    raise exception 'Ingrese un numero de telefono valido';
  end if;

  if p_customer_email is not null and btrim(p_customer_email) <> ''
     and p_customer_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo electronico no es valido';
  end if;

  if p_delivery_address is null or length(btrim(p_delivery_address)) < 5 then
    raise exception 'Ingrese la direccion de entrega';
  end if;

  if p_district is null or length(btrim(p_district)) < 3 then
    raise exception 'Ingrese el distrito de entrega';
  end if;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito esta vacio';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Demasiados articulos en el pedido';
  end if;

  -- ---------- 3. Configuración de la tienda (delivery) ----------
  select * into v_settings from public.store_settings where id = 1;
  if not found then
    v_settings.delivery_fee            := 3.00;
    v_settings.free_delivery_threshold := 50.00;
  end if;

  -- ---------- 4. Validación estructural de los items del carrito ----------
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_type := lower(coalesce(v_item->>'type', ''));
    v_pid  := nullif(btrim(coalesce(v_item->>'id', '')), '')::uuid;
    v_qty  := nullif(btrim(coalesce(v_item->>'quantity', '')), '')::numeric;

    if v_type not in ('product','combo') then
      raise exception 'Tipo de articulo invalido en el carrito';
    end if;
    if v_pid is null then
      raise exception 'Identificador de producto invalido';
    end if;
    if v_qty is null or v_qty <= 0 or v_qty > 999 then
      raise exception 'Cantidad invalida en el carrito';
    end if;
  end loop;

  -- ---------- 5. Recopilar todos los productos afectados ----------
  -- (incluye los componentes internos de cada combo)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_type := lower(v_item->>'type');
    v_pid  := (v_item->>'id')::uuid;

    if v_type = 'product' then
      v_ids := v_ids || v_pid;
    else
      if not exists (
        select 1 from public.promotions pm
        where pm.id = v_pid
          and pm.type = 'combo'
          and pm.active = true
          and (pm.start_date is null or pm.start_date <= current_date)
          and (pm.end_date   is null or pm.end_date   >= current_date)
      ) then
        raise exception 'El combo seleccionado ya no esta disponible';
      end if;

      for v_pid2, v_q2 in
        select pi.product_id, pi.quantity
          from public.promotion_items pi
         where pi.promotion_id = v_pid
      loop
        v_ids := v_ids || v_pid2;
      end loop;
    end if;
  end loop;

  -- ---------- 6. Bloquear filas de productos (evita sobreventa) ----------
  v_ids := array(select distinct unnest(v_ids) order by 1);
  perform 1
    from public.products p
   where p.id = any(v_ids)
   order by p.id
   for update;

  -- ---------- 7. Resolver precios vigentes y validar stock ----------
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_type := lower(v_item->>'type');
    v_pid  := (v_item->>'id')::uuid;
    v_qty  := (v_item->>'quantity')::numeric;

    if v_type = 'product' then
      select id, name, price, active, stock
        into v_prod
        from public.products
       where id = v_pid;

      if not found or not v_prod.active then
        raise exception 'El producto "%" ya no esta disponible',
          coalesce(v_prod.name, v_pid::text);
      end if;
      if v_prod.stock < v_qty then
        raise exception 'Stock insuficiente de "%": quedan % unidades',
          v_prod.name, v_prod.stock;
      end if;

      -- Mejor promoción vigente para este producto (precio desde la BD)
      select pm.* into v_promo
        from public.promotions pm
       where pm.type = 'oferta'
         and pm.product_id = v_pid
         and pm.active = true
         and (pm.start_date is null or pm.start_date <= current_date)
         and (pm.end_date   is null or pm.end_date   >= current_date)
       order by
         case when pm.promo_price is not null
              then pm.promo_price
              else v_prod.price * (1 - coalesce(pm.discount_percent, 0) / 100.0)
         end asc
       limit 1;

      v_compare_at := v_prod.price;
      if found then
        if v_promo.promo_price is not null then
          v_unit_price := v_promo.promo_price;
        else
          v_unit_price := round(v_prod.price
                           * (1 - coalesce(v_promo.discount_percent, 0) / 100.0), 2);
        end if;
        -- La promoción jamás puede subir el precio
        if v_unit_price > v_compare_at then
          v_unit_price := v_compare_at;
        end if;
      else
        v_unit_price := v_prod.price;
      end if;

      v_subtotal := v_subtotal + round(v_unit_price * v_qty, 2);
      v_n_items  := v_n_items + 1;

      -- Línea resuelta (precio calculado por el servidor)
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'type', 'product', 'id', v_pid, 'quantity', v_qty,
        'price', v_unit_price
      ));

    else
      -- COMBO: precio del combo desde la BD + stock de cada componente
      select pm.title, pm.promo_price
        into v_combo_title, v_combo_price
        from public.promotions pm
       where pm.id = v_pid;

      v_compare_sum := 0;
      for v_pid2, v_q2 in
        select pi.product_id, pi.quantity
          from public.promotion_items pi
         where pi.promotion_id = v_pid
      loop
        select name, price, active, stock
          into v_prod
          from public.products
         where id = v_pid2;

        if not found or not v_prod.active then
          raise exception 'Un producto del combo "%" ya no esta disponible',
            v_combo_title;
        end if;
        if v_prod.stock < v_q2 * v_qty then
          raise exception 'Stock insuficiente para el combo "%": el producto "%" tiene % unidades',
            v_combo_title, v_prod.name, v_prod.stock;
        end if;
        v_compare_sum := v_compare_sum + round(v_prod.price * v_q2, 2);
      end loop;

      v_subtotal := v_subtotal + round(v_combo_price * v_qty, 2);
      v_n_items  := v_n_items + 1;

      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'type', 'combo', 'id', v_pid, 'quantity', v_qty,
        'price', v_combo_price, 'name', v_combo_title
      ));
    end if;
  end loop;

  if v_n_items = 0 then
    raise exception 'El carrito esta vacio';
  end if;

  -- ---------- 8. Delivery según configuración ----------
  if v_settings.free_delivery_threshold is not null
     and v_subtotal >= v_settings.free_delivery_threshold then
    v_delivery := 0;
  else
    v_delivery := v_settings.delivery_fee;
  end if;

  -- ---------- 9. Registrar el pedido ----------
  -- Marca el contexto de servidor para el trigger de precios
  perform set_config('app.create_order', 'on', true);

  v_order_code := 'ASU-' || lpad(nextval('public.order_code_seq')::text, 6, '0');

  insert into public.orders (
    user_id, customer_name, customer_email, customer_phone,
    delivery_address, district, address_reference,
    payment_method, payment_status, status,
    subtotal, delivery_cost, total, notes,
    order_code, idempotency_key
  ) values (
    v_uid,
    btrim(p_customer_name),
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    btrim(p_customer_phone),
    btrim(p_delivery_address),
    btrim(p_district),
    nullif(btrim(coalesce(p_address_reference, '')), ''),
    nullif(btrim(coalesce(p_payment_method, '')), ''),
    'pending', 'pending',
    0, 0, 0,
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_order_code, p_idempotency_key
  )
  returning id into v_order_id;

  -- ---------- 10. Detalles del pedido ----------
  -- (usa los precios ya calculados por el servidor en el paso 7)
  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    v_type := v_line->>'type';
    v_pid  := (v_line->>'id')::uuid;
    v_qty  := (v_line->>'quantity')::numeric;

    if v_type = 'product' then
      -- El trigger set_order_item_price completa nombre/unidad desde products
      -- y respeta el precio promocional calculado por el servidor.
      insert into public.order_items
        (order_id, product_id, product_name, quantity, unit, unit_price)
      values
        (v_order_id, v_pid, 'x', v_qty, 'unidad',
         (v_line->>'price')::numeric);
    else
      insert into public.order_items
        (order_id, product_id, product_name, quantity, unit, unit_price)
      values
        (v_order_id, null, v_line->>'name', v_qty, 'paquete',
         (v_line->>'price')::numeric);
    end if;
  end loop;

  -- ---------- 11. Delivery y total final ----------
  update public.orders
     set delivery_cost = v_delivery,
         total         = v_subtotal + v_delivery
   where id = v_order_id;

  -- ---------- 12. Descontar inventario y registrar movimientos ----------
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_type := lower(v_item->>'type');
    v_pid  := (v_item->>'id')::uuid;
    v_qty  := (v_item->>'quantity')::numeric;

    if v_type = 'product' then
      select stock into v_prev from public.products where id = v_pid;

      update public.products
         set stock = stock - v_qty
       where id = v_pid
       returning stock into v_new;

      insert into public.inventory_movements
        (product_id, movement_type, quantity, previous_stock, new_stock,
         reference, notes)
      values
        (v_pid, 'salida', v_qty, v_prev, v_new, v_order_code,
         'Venta - pedido ' || v_order_code);
    else
      for v_pid2, v_q2 in
        select pi.product_id, pi.quantity
          from public.promotion_items pi
         where pi.promotion_id = v_pid
      loop
        select stock into v_prev from public.products where id = v_pid2;

        update public.products
           set stock = stock - (v_q2 * v_qty)
         where id = v_pid2
         returning stock into v_new;

        insert into public.inventory_movements
          (product_id, movement_type, quantity, previous_stock, new_stock,
           reference, notes)
        values
          (v_pid2, 'salida', v_q2 * v_qty, v_prev, v_new, v_order_code,
           'Venta combo - pedido ' || v_order_code);
      end loop;
    end if;
  end loop;

  -- ---------- 13. Confirmación para el cliente ----------
  return jsonb_build_object(
    'duplicate',       false,
    'order_id',        v_order_id,
    'order_code',      v_order_code,
    'status',          'pending',
    'subtotal',        v_subtotal,
    'delivery_cost',   v_delivery,
    'total',           v_subtotal + v_delivery,
    'customer_name',   btrim(p_customer_name),
    'customer_phone',  btrim(p_customer_phone),
    'delivery_address',btrim(p_delivery_address),
    'district',        btrim(p_district),
    'payment_method',  coalesce(nullif(btrim(p_payment_method), ''),
                                'Efectivo contra entrega')
  );
end;
$$;

revoke all on function public.create_order(text,text,text,text,text,jsonb,text,text,text,uuid) from public;
grant execute on function public.create_order(text,text,text,text,text,jsonb,text,text,text,uuid)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2.3 lookup_order: consulta segura de un pedido (cliente invitado)
--     Solo devuelve información si el código Y el teléfono coinciden.
-- ----------------------------------------------------------------------------
create or replace function public.lookup_order(
  p_order_code text,
  p_phone      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o           public.orders%rowtype;
  v_items     jsonb;
  v_phone_db  text;
  v_phone_in  text;
begin
  if p_order_code is null or btrim(p_order_code) = '' then
    raise exception 'Ingrese el codigo de pedido';
  end if;
  if p_phone is null or btrim(p_phone) = '' then
    raise exception 'Ingrese el telefono usado en el pedido';
  end if;

  select * into o
    from public.orders
   where order_code = btrim(upper(p_order_code))
   limit 1;

  if not found then
    raise exception 'No existe un pedido con ese codigo';
  end if;

  v_phone_db := regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g');
  v_phone_in := regexp_replace(p_phone, '\D', '', 'g');

  if v_phone_db = '' or v_phone_in = '' or v_phone_db <> v_phone_in then
    raise exception 'El telefono no coincide con el pedido';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_name', oi.product_name,
           'quantity',     oi.quantity,
           'unit',         oi.unit,
           'unit_price',   oi.unit_price,
           'subtotal',     oi.subtotal
         ) order by oi.created_at), '[]'::jsonb)
    into v_items
    from public.order_items oi
   where oi.order_id = o.id;

  return jsonb_build_object(
    'order_code',      o.order_code,
    'status',          o.status,
    'payment_method',  o.payment_method,
    'payment_status',  o.payment_status,
    'customer_name',   o.customer_name,
    'customer_phone',  o.customer_phone,
    'delivery_address',o.delivery_address,
    'district',        o.district,
    'subtotal',        o.subtotal,
    'delivery_cost',   o.delivery_cost,
    'total',           o.total,
    'created_at',      o.created_at,
    'items',           v_items
  );
end;
$$;

revoke all on function public.lookup_order(text,text) from public;
grant execute on function public.lookup_order(text,text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2.4 adjust_stock: entradas de mercadería, salidas y ajustes justificados.
--     Solo el administrador. Registra el movimiento en el historial.
--     No permite stock negativo.
-- ----------------------------------------------------------------------------
create or replace function public.adjust_stock(
  p_product_id    uuid,
  p_movement_type text,          -- 'entrada' | 'salida' | 'ajuste'
  p_quantity      numeric default null,  -- para entrada/salida
  p_new_stock     numeric default null,  -- para ajuste (valor absoluto)
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev numeric(12,3);
  v_new  numeric(12,3);
  v_qty  numeric(12,3);
begin
  if not public.is_admin() then
    raise exception 'Solo el administrador puede modificar el inventario';
  end if;

  if p_movement_type not in ('entrada','salida','ajuste') then
    raise exception 'Tipo de movimiento invalido';
  end if;

  select stock into v_prev
    from public.products
   where id = p_product_id
   for update;

  if not found then
    raise exception 'Producto no encontrado';
  end if;

  if p_movement_type = 'entrada' then
    if p_quantity is null or p_quantity <= 0 then
      raise exception 'Cantidad invalida para la entrada';
    end if;
    v_qty := p_quantity;
    v_new := v_prev + v_qty;

  elsif p_movement_type = 'salida' then
    if p_quantity is null or p_quantity <= 0 then
      raise exception 'Cantidad invalida para la salida';
    end if;
    v_qty := p_quantity;
    v_new := v_prev - v_qty;
    if v_new < 0 then
      raise exception 'No hay stock suficiente: actual %, solicitado %',
        v_prev, v_qty;
    end if;

  else -- ajuste
    if p_new_stock is null or p_new_stock < 0 then
      raise exception 'Stock nuevo invalido';
    end if;
    v_new := p_new_stock;
    v_qty := abs(v_new - v_prev);
    if v_new = v_prev then
      raise exception 'El stock nuevo es igual al actual';
    end if;
  end if;

  if p_movement_type in ('salida','ajuste')
     and (p_notes is null or length(btrim(p_notes)) < 3) then
    raise exception 'Debe justificar la salida o el ajuste con una nota';
  end if;

  update public.products
     set stock = v_new
   where id = p_product_id;

  insert into public.inventory_movements
    (product_id, movement_type, quantity, previous_stock, new_stock,
     reference, notes, created_by)
  values
    (p_product_id, p_movement_type, v_qty, v_prev, v_new,
     null, btrim(coalesce(p_notes, '')), auth.uid());

  return jsonb_build_object(
    'previous_stock', v_prev,
    'new_stock',      v_new,
    'movement_type',  p_movement_type
  );
end;
$$;

revoke all on function public.adjust_stock(uuid,text,numeric,numeric,text) from public;
grant execute on function public.adjust_stock(uuid,text,numeric,numeric,text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 2.5 handle_order_cancellation (trigger sobre orders)
--     Al pasar un pedido a 'cancelled' devuelve el stock EXACTAMENTE según los
--     movimientos de salida registrados (incluye componentes de combos), una
--     sola vez y sin duplicar movimientos. Un pedido cancelado queda cerrado:
--     no puede volver a otro estado.
-- ----------------------------------------------------------------------------
create or replace function public.handle_order_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m          record;
  v_prev     numeric(12,3);
  v_new      numeric(12,3);
  v_restored int := 0;
begin
  -- Un pedido cancelado es terminal
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'Un pedido cancelado no puede cambiar de estado';
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    for m in
      select *
        from public.inventory_movements
       where reference = old.order_code
         and movement_type = 'salida'
    loop
      if m.product_id is not null then
        select stock into v_prev
          from public.products
         where id = m.product_id
         for update;

        update public.products
           set stock = stock + m.quantity
         where id = m.product_id
         returning stock into v_new;

        insert into public.inventory_movements
          (product_id, movement_type, quantity, previous_stock, new_stock,
           reference, notes, created_by)
        values
          (m.product_id, 'entrada', m.quantity, v_prev, v_new,
           old.order_code, 'Cancelacion - pedido ' || old.order_code,
           auth.uid());

        v_restored := v_restored + 1;
      end if;
    end loop;
    -- Si el pedido no tiene movimientos (pedidos antiguos), no hay stock
    -- que devolver; la cancelación procede normalmente.
  end if;

  return new;
end;
$$;

drop trigger if exists on_order_cancelled on public.orders;
create trigger on_order_cancelled
  before update on public.orders
  for each row execute function public.handle_order_cancellation();
