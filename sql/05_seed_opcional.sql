-- ============================================================================
-- ASUNTA - MIGRACIÓN 05 (OPCIONAL): DATOS INICIALES DEL CATÁLOGO
-- ----------------------------------------------------------------------------
-- DÓNDE EJECUTAR:  Supabase Dashboard  >  SQL Editor  >  New query  >  Run
-- REQUIERE:        01, 02, 03 y 04 ejecutadas antes.
--
-- ESTA MIGRACIÓN ES OPCIONAL. Carga el catálogo que ya estaba escrito en el
-- archivo avance.html original (los mismos 21 productos con sus mismos
-- precios y descripciones) y los 3 combos de la semana.
--
-- IMPORTANTE:
--   * Los STOCKS se crean en 25 unidades como valor provisional de trabajo:
--     ajustelos con sus existencias reales desde el panel administrativo
--     (módulo Inventario) inmediatamente después de ejecutar esta migración.
--   * Si no desea cargar datos de ejemplo, NO ejecute este archivo y registre
--     sus productos desde el panel administrativo.
--   * El script es re-ejecutable: ignora productos que ya existan.
-- ============================================================================

do $$
declare
  c_abarrotes uuid;
  c_aceites   uuid;
  c_lacteos   uuid;
  c_bebidas   uuid;
  c_limpieza  uuid;
  c_snacks    uuid;
  c_conservas uuid;
  p_arroz_sup uuid;
  p_azucar    uuid;
  p_leche     uuid;
  p_detergente uuid;
  p_lejia     uuid;
  p_papel     uuid;
  p_aceite    uuid;
  p_fideos    uuid;
  p_salsa     uuid;
  p_atun      uuid;
  v_combo     uuid;
begin
  -- Categorías ya existentes en el proyecto (migración original)
  select id into c_abarrotes from public.categories where name = 'Abarrotes';
  select id into c_aceites   from public.categories where name = 'Aceites y condimentos';
  select id into c_lacteos   from public.categories where name = 'Lacteos';
  select id into c_bebidas   from public.categories where name = 'Bebidas';
  select id into c_limpieza  from public.categories where name = 'Limpieza';
  select id into c_snacks    from public.categories where name = 'Snacks y golosinas';
  select id into c_conservas from public.categories where name = 'Conservas';

  if c_abarrotes is null or c_aceites is null or c_lacteos is null
     or c_bebidas is null or c_limpieza is null or c_snacks is null
     or c_conservas is null then
    raise exception 'Faltan categorias en el proyecto. Verifique la tabla categories.';
  end if;

  -- ------------------- PRODUCTOS (catálogo original ASUNTA) -------------------
  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_abarrotes, 'Arroz corriente', 'Arroz corriente de grano seleccionado ideal para el día a día.', 4.50, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Arroz corriente');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_abarrotes, 'Arroz superior', 'Arroz superior extra selecto, saco familiar de 5 kilos.', 22.00, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Arroz superior');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_abarrotes, 'Azúcar rubia', 'Azúcar rubia natural para repostería y bebidas.', 4.20, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Azúcar rubia');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_abarrotes, 'Lentejas', 'Lentejas frescas y seleccionadas, ricas en hierro.', 4.00, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Lentejas');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_abarrotes, 'Frejoles', 'Frejoles negros o canario de alta calidad.', 4.50, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Frejoles');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_abarrotes, 'Avena', 'Avena hojuelas tradicionales nutritivas.', 4.00, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Avena');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_abarrotes, 'Fideos', 'Fideos tallarín o pluma de trigo duro.', 3.50, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Fideos');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_aceites, 'Aceite vegetal', 'Aceite vegetal puro para freír y cocinar.', 8.50, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Aceite vegetal');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_conservas, 'Atún en conserva', 'Lomo de atún sólido en aceite vegetal.', 5.50, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Atún en conserva');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_lacteos, 'Leche evaporada', 'Leche evaporada entera Gloria o marca líder.', 4.50, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Leche evaporada');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_conservas, 'Salsa de tomate', 'Salsa de tomate lista para pastas y guisos.', 3.00, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Salsa de tomate');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_bebidas, 'Agua mineral', 'Agua mineral sin gas pura y refrescante.', 1.50, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Agua mineral');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_bebidas, 'Gaseosa', 'Bebida gaseosa personal helada.', 2.50, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Gaseosa');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_bebidas, 'Jugo en caja', 'Néctar de fruta variada en caja de 1L.', 2.00, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Jugo en caja');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_limpieza, 'Detergente', 'Detergente en polvo aroma floral para ropa limpia.', 8.00, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Detergente');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_limpieza, 'Lavavajilla', 'Crema lavavajillas eficaz contra la grasa.', 3.50, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Lavavajilla');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_limpieza, 'Lejía', 'Lejía desinfectante multiusos.', 4.00, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Lejía');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_limpieza, 'Papel higiénico', 'Papel higiénico suave doble hoja, paquete de 4.', 6.50, 25, 'paquete', true
  where not exists (select 1 from public.products where name = 'Papel higiénico');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_snacks, 'Galletas', 'Galletas rellenas o saladas para el antojo.', 1.50, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Galletas');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_snacks, 'Chocolate', 'Barra de chocolate sublime o bitter.', 3.00, 25, 'unidad', true
  where not exists (select 1 from public.products where name = 'Chocolate');

  insert into public.products (category_id, name, description, price, stock, unit, active)
  select c_snacks, 'Papas fritas en bolsa', 'Papas nativas o clásicas crujientes.', 2.50, 25, 'bolsa', true
  where not exists (select 1 from public.products where name = 'Papas fritas en bolsa');

  -- ------------------- COMBOS (ofertas originales ASUNTA) -------------------
  select id into p_arroz_sup  from public.products where name = 'Arroz superior';
  select id into p_azucar     from public.products where name = 'Azúcar rubia';
  select id into p_leche      from public.products where name = 'Leche evaporada';
  select id into p_detergente from public.products where name = 'Detergente';
  select id into p_lejia      from public.products where name = 'Lejía';
  select id into p_papel      from public.products where name = 'Papel higiénico';
  select id into p_aceite     from public.products where name = 'Aceite vegetal';
  select id into p_fideos     from public.products where name = 'Fideos';
  select id into p_salsa      from public.products where name = 'Salsa de tomate';
  select id into p_atun       from public.products where name = 'Atún en conserva';

  -- Combo 1: Desayuno Familiar
  insert into public.promotions (title, description, type, promo_price, badge, start_date, end_date, active)
  select 'Combo Desayuno Familiar',
         'Incluye 1 Arroz superior 5kg, 1 Azúcar rubia 1kg y 1 Leche evaporada.',
         'combo', 27.50, '¡Ahorra S/ 3.20!', current_date, current_date + 30, true
  where not exists (select 1 from public.promotions where title = 'Combo Desayuno Familiar');

  select id into v_combo from public.promotions where title = 'Combo Desayuno Familiar';
  insert into public.promotion_items (promotion_id, product_id, quantity)
  select v_combo, p_arroz_sup, 1
  where not exists (select 1 from public.promotion_items where promotion_id = v_combo and product_id = p_arroz_sup);
  insert into public.promotion_items (promotion_id, product_id, quantity)
  select v_combo, p_azucar, 1
  where not exists (select 1 from public.promotion_items where promotion_id = v_combo and product_id = p_azucar);
  insert into public.promotion_items (promotion_id, product_id, quantity)
  select v_combo, p_leche, 1
  where not exists (select 1 from public.promotion_items where promotion_id = v_combo and product_id = p_leche);

  -- Combo 2: Pack Limpieza Total
  insert into public.promotions (title, description, type, promo_price, badge, start_date, end_date, active)
  select 'Pack Limpieza Total',
         '1 Detergente 800g, 1 Lejía 1L y 1 Paquete de papel higiénico de 4.',
         'combo', 16.00, 'Más Vendido', current_date, current_date + 30, true
  where not exists (select 1 from public.promotions where title = 'Pack Limpieza Total');

  select id into v_combo from public.promotions where title = 'Pack Limpieza Total';
  insert into public.promotion_items (promotion_id, product_id, quantity)
  select v_combo, p_detergente, 1
  where not exists (select 1 from public.promotion_items where promotion_id = v_combo and product_id = p_detergente);
  insert into public.promotion_items (promotion_id, product_id, quantity)
  select v_combo, p_lejia, 1
  where not exists (select 1 from public.promotion_items where promotion_id = v_combo and product_id = p_lejia);
  insert into public.promotion_items (promotion_id, product_id, quantity)
  select v_combo, p_papel, 1
  where not exists (select 1 from public.promotion_items where promotion_id = v_combo and product_id = p_papel);

  -- Combo 3: Surtido de Abarrotes Básicos
  insert into public.promotions (title, description, type, promo_price, badge, start_date, end_date, active)
  select 'Surtido de Abarrotes Básicos',
         '1 Aceite vegetal 1L, 1 Fideos 500g, 1 Salsa de tomate y 1 Atún en conserva.',
         'combo', 18.00, 'Oferta Semanal', current_date, current_date + 30, true
  where not exists (select 1 from public.promotions where title = 'Surtido de Abarrotes Básicos');

  select id into v_combo from public.promotions where title = 'Surtido de Abarrotes Básicos';
  insert into public.promotion_items (promotion_id, product_id, quantity)
  select v_combo, p_aceite, 1
  where not exists (select 1 from public.promotion_items where promotion_id = v_combo and product_id = p_aceite);
  insert into public.promotion_items (promotion_id, product_id, quantity)
  select v_combo, p_fideos, 1
  where not exists (select 1 from public.promotion_items where promotion_id = v_combo and product_id = p_fideos);
  insert into public.promotion_items (promotion_id, product_id, quantity)
  select v_combo, p_salsa, 1
  where not exists (select 1 from public.promotion_items where promotion_id = v_combo and product_id = p_salsa);
  insert into public.promotion_items (promotion_id, product_id, quantity)
  select v_combo, p_atun, 1
  where not exists (select 1 from public.promotion_items where promotion_id = v_combo and product_id = p_atun);
end $$;
