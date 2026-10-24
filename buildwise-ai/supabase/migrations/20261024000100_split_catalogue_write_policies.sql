-- The catalogue "write" policies were created FOR ALL, which also covers SELECT and so overlaps the "read" policies
-- (Supabase's performance advisor warns about that: every read evaluates two policies). Replace each with separate
-- insert / update / delete policies. Behaviour is identical; the old policy names are removed.
-- NOTE: this file contains DROP POLICY statements on policies created by this project's own earlier migration.
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'materials' and policyname = 'materials_write') then
    drop policy materials_write on public.materials;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'material_price_records' and policyname = 'prices_write') then
    drop policy prices_write on public.material_price_records;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'materials' and policyname = 'materials_insert') then
    create policy materials_insert on public.materials for insert to authenticated with check (owner_id = (select auth.uid()));
    create policy materials_update on public.materials for update to authenticated
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
    create policy materials_delete on public.materials for delete to authenticated using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'material_price_records' and policyname = 'prices_insert') then
    create policy prices_insert on public.material_price_records for insert to authenticated
      with check (owner_id = (select auth.uid())
                  and exists (select 1 from public.materials m
                              where m.id = material_id and (m.owner_id is null or m.owner_id = (select auth.uid()))));
    create policy prices_update on public.material_price_records for update to authenticated
      using (owner_id = (select auth.uid()))
      with check (owner_id = (select auth.uid())
                  and exists (select 1 from public.materials m
                              where m.id = material_id and (m.owner_id is null or m.owner_id = (select auth.uid()))));
    create policy prices_delete on public.material_price_records for delete to authenticated using (owner_id = (select auth.uid()));
  end if;
end $$;
