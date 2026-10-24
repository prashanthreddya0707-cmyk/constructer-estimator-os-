-- Index for the foreign key reports.estimate_id (flagged by Supabase's performance advisor). Additive.
create index if not exists ix_reports_estimate on public.reports (estimate_id);
