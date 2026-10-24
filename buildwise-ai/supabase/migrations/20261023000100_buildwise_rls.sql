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

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select') then
    create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_insert') then
    create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update') then
    create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_own') then
    create policy projects_own on public.projects for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end $$;

-- Child rows: they must belong to the user AND hang under one of the user's own projects / estimates.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_rooms' and policyname = 'rooms_own') then
    create policy rooms_own on public.project_rooms for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'floor_plan_files' and policyname = 'floorplans_own') then
    create policy floorplans_own on public.floor_plan_files for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_estimates' and policyname = 'estimates_own') then
    create policy estimates_own on public.project_estimates for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'estimate_items' and policyname = 'items_own') then
    create policy items_own on public.estimate_items for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.project_estimates e where e.id = estimate_id and e.owner_id = (select auth.uid())));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'optimization_recommendations' and policyname = 'recs_own') then
    create policy recs_own on public.optimization_recommendations for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.project_estimates e where e.id = estimate_id and e.owner_id = (select auth.uid())));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reports' and policyname = 'reports_own') then
    create policy reports_own on public.reports for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
  end if;
end $$;

-- Catalogue: shared sample rows (owner_id is null) are read-only; user rows are private and writable by the owner only.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'materials' and policyname = 'materials_read') then
    create policy materials_read on public.materials for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'materials' and policyname = 'materials_write') then
    create policy materials_write on public.materials for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'material_price_records' and policyname = 'prices_read') then
    create policy prices_read on public.material_price_records for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'material_price_records' and policyname = 'prices_write') then
    create policy prices_write on public.material_price_records for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.materials m
                          where m.id = material_id and (m.owner_id is null or m.owner_id = (select auth.uid()))));
  end if;
end $$;

