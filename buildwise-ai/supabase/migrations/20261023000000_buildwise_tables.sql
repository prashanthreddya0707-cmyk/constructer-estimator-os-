-- BuildWise AI: database schema for Supabase (PostgreSQL), with Row Level Security.
--
-- Additive and idempotent: only creates what is missing, never drops or rewrites data.
-- Users live in Supabase Auth (auth.users); every user-owned row points at auth.users(id).
-- The browser never touches these tables directly (the Data API can stay off): the FastAPI backend connects to the database,
-- switches to the `authenticated` role for the signed-in user and sets that user's JWT claims, so the policies below apply to
-- the backend's own queries as well (defence in depth on top of the ownership checks in the API).

-- ============================================================================ profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 120),
  created_at  timestamptz not null default now()
);

-- (No trigger on auth.users: that table belongs to Supabase's auth service. The backend creates the profile row on first sign-in.)

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

-- ============================================================================ projects and rooms
create table if not exists public.projects (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                 text not null check (char_length(name) between 1 and 160),
  description          text not null default '',
  owner_name           text not null default '',
  building_type        text not null default 'residential',
  location             text not null default '',
  floors               integer not null default 1 check (floors between 1 and 50),
  currency             text not null default 'INR',
  budget               double precision check (budget is null or budget > 0),
  length               double precision not null check (length > 0),
  width                double precision not null check (width > 0),
  height               double precision not null default 3.0 check (height > 0),
  wall_thickness       double precision not null default 0.23 check (wall_thickness > 0),
  slab_thickness       double precision not null default 0.15 check (slab_thickness > 0),
  built_up_area        double precision check (built_up_area is null or built_up_area > 0),
  assumptions          jsonb not null default '{}',
  wastage              jsonb not null default '{}',
  material_selections  jsonb not null default '{}',
  extra_costs          jsonb not null default '{}',
  purchase_quantities  jsonb not null default '{}',
  layout               jsonb,
  is_demo              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists ix_projects_owner_updated on public.projects (owner_id, updated_at desc);
drop trigger if exists trg_projects_touch on public.projects;
create trigger trg_projects_touch before update on public.projects for each row execute function public.touch_updated_at();

create table if not exists public.project_rooms (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  room_type       text not null default 'other',
  length          double precision not null check (length > 0),
  width           double precision not null check (width > 0),
  height          double precision not null default 3.0 check (height > 0),
  floor_number    integer not null default 1 check (floor_number >= 1),
  wall_thickness  double precision check (wall_thickness is null or wall_thickness > 0),
  doors           integer not null default 0 check (doors >= 0),
  windows         integer not null default 0 check (windows >= 0),
  area_override   double precision check (area_override is null or area_override > 0),
  pos_x           double precision,
  pos_y           double precision,
  created_at      timestamptz not null default now()
);
create index if not exists ix_rooms_project_floor on public.project_rooms (project_id, floor_number, created_at);
create index if not exists ix_rooms_owner on public.project_rooms (owner_id);

-- ============================================================================ floor plans (files live in Storage)
create table if not exists public.floor_plan_files (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  original_name  text not null,
  content_type   text not null,
  size_bytes     integer not null check (size_bytes >= 0),
  storage_key    text not null,
  width_px       integer,
  height_px      integer,
  scale_m_per_px double precision check (scale_m_per_px is null or scale_m_per_px > 0),
  calibration    jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists ix_floorplans_project on public.floor_plan_files (project_id);
create index if not exists ix_floorplans_owner on public.floor_plan_files (owner_id);

-- ============================================================================ materials and prices
-- owner_id NULL = shared sample catalogue (read-only for everyone); otherwise private to the owner.
create table if not exists public.materials (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid references auth.users (id) on delete cascade,
  estimate_key      text not null,
  name              text not null,
  category          text not null,
  brand             text not null default '',
  grade             text not null default '',
  specification     text not null default '',
  durability_notes  text not null default '',
  unit              text not null,
  is_sample         boolean not null default false,
  created_at        timestamptz not null default now()
);
create index if not exists ix_materials_owner on public.materials (owner_id);
create index if not exists ix_materials_key on public.materials (estimate_key);

create table if not exists public.material_price_records (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  owner_id    uuid references auth.users (id) on delete cascade,
  unit_price  double precision not null check (unit_price >= 0),
  currency    text not null default 'INR',
  supplier    text not null default '',
  location    text not null default '',
  is_sample   boolean not null default false,
  updated_at  timestamptz not null default now()
);
create index if not exists ix_prices_material on public.material_price_records (material_id);
create index if not exists ix_prices_owner on public.material_price_records (owner_id);
drop trigger if exists trg_prices_touch on public.material_price_records;
create trigger trg_prices_touch before update on public.material_price_records for each row execute function public.touch_updated_at();

-- ============================================================================ estimates
create table if not exists public.project_estimates (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  owner_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  summary             jsonb not null default '{}',
  geometry            jsonb not null default '{}',
  assumptions         jsonb not null default '{}',
  warnings            jsonb not null default '[]',
  total_material_cost double precision not null default 0,
  total_area_sqm      double precision not null default 0,
  currency            text not null default 'INR',
  created_at          timestamptz not null default now()
);
create index if not exists ix_estimates_project_created on public.project_estimates (project_id, created_at desc);
create index if not exists ix_estimates_owner on public.project_estimates (owner_id);

create table if not exists public.estimate_items (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.project_estimates (id) on delete cascade,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  position    integer not null default 0,
  data        jsonb not null
);
create index if not exists ix_estimate_items_pos on public.estimate_items (estimate_id, position);
create index if not exists ix_estimate_items_owner on public.estimate_items (owner_id);

create table if not exists public.optimization_recommendations (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.project_estimates (id) on delete cascade,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  position    integer not null default 0,
  data        jsonb not null
);
create index if not exists ix_recs_pos on public.optimization_recommendations (estimate_id, position);
create index if not exists ix_recs_owner on public.optimization_recommendations (owner_id);

-- ============================================================================ reports (PDFs live in Storage)
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  estimate_id uuid references public.project_estimates (id) on delete set null,
  file_name   text not null,
  storage_key text not null,
  size_bytes  integer not null default 0 check (size_bytes >= 0),
  total_cost  double precision not null default 0,
  currency    text not null default 'INR',
  created_at  timestamptz not null default now()
);
create index if not exists ix_reports_owner_created on public.reports (owner_id, created_at desc);
create index if not exists ix_reports_project on public.reports (project_id);

