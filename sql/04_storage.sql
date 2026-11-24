-- ============================================================================
-- ASUNTA - MIGRACIÓN 04: SUPABASE STORAGE (IMÁGENES DE PRODUCTOS)
-- ----------------------------------------------------------------------------
-- DÓNDE EJECUTAR:  Supabase Dashboard  >  SQL Editor  >  New query  >  Run
-- REQUIERE:        01 ejecutada antes (usa public.is_admin()).
--
-- Crea el bucket público 'product-images':
--   * Lectura pública: cualquier visitante ve las imágenes del catálogo.
--   * Escritura solo del administrador (subir, cambiar, eliminar).
--   * Límite de tamaño 2 MB y solo JPG / PNG / WEBP (validado en el bucket).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  2097152,  -- 2 MB por archivo
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública de las imágenes del catálogo
drop policy if exists "Public read product images" on storage.objects;
create policy "Public read product images" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-images');

-- Subida solo del administrador
drop policy if exists "Admin upload product images" on storage.objects;
create policy "Admin upload product images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

-- Reemplazo / cambio de fotografía solo del administrador
drop policy if exists "Admin update product images" on storage.objects;
create policy "Admin update product images" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

-- Eliminación de imágenes no utilizadas solo del administrador
drop policy if exists "Admin delete product images" on storage.objects;
create policy "Admin delete product images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
