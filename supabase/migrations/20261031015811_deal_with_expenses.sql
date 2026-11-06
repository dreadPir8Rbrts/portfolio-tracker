begin;
-- The purchase and its paid expenses must either all succeed or all roll back.
create function public.create_deal_with_expenses(deal_data jsonb, expense_rows jsonb, expected_count integer)
returns void language plpgsql security invoker set search_path='' as $$
declare e jsonb; did uuid:=(deal_data->>'id')::uuid;
begin
 if not private.is_admin() then raise exception 'Admin access required';end if;
 perform pg_advisory_xact_lock(90128672);
 if (select count(*) from public.entries)<>expected_count then raise exception 'Ledger changed. Refresh and try again.';end if;
 if jsonb_typeof(expense_rows) is distinct from 'array' or jsonb_array_length(expense_rows)>50 then raise exception 'Provide up to 50 expenses';end if;
 insert into public.deals(id,payload) values(did,deal_data);
 for e in select value from jsonb_array_elements(expense_rows) loop
  if e->>'kind' is distinct from 'expense' or (e->>'dealId')::uuid is distinct from did or e->>'to' is not null then raise exception 'Additional costs must be expenses for this deal';end if;
  insert into public.entries(id,deal_id,payload) values((e->>'id')::uuid,did,e);
 end loop;
end $$;
revoke all on function public.create_deal_with_expenses(jsonb,jsonb,integer) from public;
grant execute on function public.create_deal_with_expenses(jsonb,jsonb,integer) to authenticated;
commit;
