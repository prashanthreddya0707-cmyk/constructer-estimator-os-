-- BuildWise AI part 3/3: private Storage buckets and their per-user policy.

-- ============================================================================ Storage (private buckets, one folder per user)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('floorplans', 'floorplans', false, 10485760, array['image/png', 'image/jpeg', 'application/pdf']),
       ('reports',    'reports',    false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "buildwise own files" on storage.objects;
create policy "buildwise own files" on storage.objects for all to authenticated
  using (bucket_id in ('floorplans', 'reports') and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id in ('floorplans', 'reports') and (storage.foldername(name))[1] = (select auth.uid())::text);
