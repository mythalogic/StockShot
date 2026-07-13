-- ============================================================
-- StockShot — Supabase schema
-- Run this whole file in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- ---------- Profiles (role per user) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'member' check (role in ('member', 'manager')),
  created_at timestamptz not null default now()
);

-- Auto-create a profile row when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: is the current user a manager?
create or replace function public.is_manager()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager'
  );
$$;

-- ---------- Products ----------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  product_name text not null,
  supplier text not null,
  created_at timestamptz not null default now()
);

-- ---------- Captures (one row per product) ----------
create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products (id) on delete cascade,
  product_photo_url text,
  barcode_photo_url text,
  barcode_value text,
  captured_by uuid references auth.users (id),
  captured_at timestamptz not null default now(),
  status text not null default 'not_started'
    check (status in ('not_started', 'partial', 'done'))
);

-- ---------- App settings (export restriction toggle) ----------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null
);
insert into public.app_settings (key, value)
values ('export_managers_only', 'false'::jsonb)
on conflict (key) do nothing;

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.captures enable row level security;
alter table public.app_settings enable row level security;

-- Profiles: everyone signed in can read (needed to show "captured by"),
-- users can update only their own non-role fields via app (role changes done in SQL).
drop policy if exists "profiles readable by signed-in" on public.profiles;
create policy "profiles readable by signed-in"
  on public.profiles for select to authenticated using (true);

-- Products: read for all signed-in; write only managers (import)
drop policy if exists "products read" on public.products;
create policy "products read"
  on public.products for select to authenticated using (true);

drop policy if exists "products insert manager" on public.products;
create policy "products insert manager"
  on public.products for insert to authenticated with check (public.is_manager());

drop policy if exists "products update manager" on public.products;
create policy "products update manager"
  on public.products for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- Captures: any signed-in user can read and write (whole team captures)
drop policy if exists "captures read" on public.captures;
create policy "captures read"
  on public.captures for select to authenticated using (true);

drop policy if exists "captures insert" on public.captures;
create policy "captures insert"
  on public.captures for insert to authenticated with check (true);

drop policy if exists "captures update" on public.captures;
create policy "captures update"
  on public.captures for update to authenticated using (true) with check (true);

-- Settings: read all signed-in, write manager only
drop policy if exists "settings read" on public.app_settings;
create policy "settings read"
  on public.app_settings for select to authenticated using (true);

drop policy if exists "settings write manager" on public.app_settings;
create policy "settings write manager"
  on public.app_settings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ---------- Realtime ----------
-- Broadcast capture changes so all devices update live
alter publication supabase_realtime add table public.captures;

-- ---------- Storage bucket for photos ----------
insert into storage.buckets (id, name, public)
values ('captures', 'captures', true)
on conflict (id) do nothing;

drop policy if exists "captures bucket read" on storage.objects;
create policy "captures bucket read"
  on storage.objects for select to authenticated
  using (bucket_id = 'captures');

drop policy if exists "captures bucket public read" on storage.objects;
create policy "captures bucket public read"
  on storage.objects for select to anon
  using (bucket_id = 'captures');

drop policy if exists "captures bucket write" on storage.objects;
create policy "captures bucket write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'captures');

drop policy if exists "captures bucket update" on storage.objects;
create policy "captures bucket update"
  on storage.objects for update to authenticated
  using (bucket_id = 'captures') with check (bucket_id = 'captures');

-- ============================================================
-- AFTER YOUR FIRST USER SIGNS UP, promote them to manager:
--
--   update public.profiles set role = 'manager'
--   where email = 'you@example.com';
-- ============================================================
