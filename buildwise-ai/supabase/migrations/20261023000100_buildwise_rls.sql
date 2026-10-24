-- BuildWise AI part 2/3: Row Level Security, privileges and policies (see part 1 for the overview).

-- ============================================================================ Row Level Security
alter table public.profiles                    enable row level security;
alter table public.projects                    enable row level security;
alter table public.project_rooms               enable row level security;
alter table public.floor_plan_files            enable row level security;
alter table public.materials                   enable row level security;
alter table public.material_price_records      enable row level security;
alter table public.project_estimates           enable row level security;
alter table public.estimate_items              enable row level security;
alter table public.optimization_recommendations enable row level security;
alter table public.reports                     enable row level security;

-- Nothing is readable or writable by anonymous visitors. Signed-in users get table privileges that RLS then narrows to
-- their own rows. (Policies use "(select auth.uid())" so Postgres evaluates it once per statement, not once per row.)
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.projects, public.project_rooms, public.floor_plan_files, public.materials, public.material_price_records,
  public.project_estimates, public.estimate_items, public.optimization_recommendations, public.reports
  to authenticated;
grant select, insert, update on public.profiles to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists projects_own on public.projects;
create policy projects_own on public.projects for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Child rows: they must belong to the user AND hang under one of the user's own projects / estimates.
drop policy if exists rooms_own on public.project_rooms;
create policy rooms_own on public.project_rooms for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

drop policy if exists floorplans_own on public.floor_plan_files;
create policy floorplans_own on public.floor_plan_files for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

drop policy if exists estimates_own on public.project_estimates;
create policy estimates_own on public.project_estimates for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

drop policy if exists items_own on public.estimate_items;
create policy items_own on public.estimate_items for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.project_estimates e where e.id = estimate_id and e.owner_id = (select auth.uid())));

drop policy if exists recs_own on public.optimization_recommendations;
create policy recs_own on public.optimization_recommendations for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.project_estimates e where e.id = estimate_id and e.owner_id = (select auth.uid())));

drop policy if exists reports_own on public.reports;
create policy reports_own on public.reports for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

-- Catalogue: shared sample rows (owner_id is null) are read-only; user rows are private and writable by the owner only.
drop policy if exists materials_read on public.materials;
create policy materials_read on public.materials for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
drop policy if exists materials_write on public.materials;
create policy materials_write on public.materials for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists prices_read on public.material_price_records;
create policy prices_read on public.material_price_records for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
drop policy if exists prices_write on public.material_price_records;
create policy prices_write on public.material_price_records for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.materials m
                          where m.id = material_id and (m.owner_id is null or m.owner_id = (select auth.uid()))));

