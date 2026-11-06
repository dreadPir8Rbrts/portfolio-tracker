begin;
-- Supabase may grant anon directly through default privileges; revoke that grant too.
revoke all on function public.create_deal_with_expenses(jsonb,jsonb,integer) from public,anon;
commit;
