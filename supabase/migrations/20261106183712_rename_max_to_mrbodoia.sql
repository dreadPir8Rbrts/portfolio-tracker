begin;
select pg_advisory_xact_lock(90128672);
lock table public.people, public.deals, public.entries in access exclusive mode;
do $$begin
 if not exists(select 1 from public.people where id='max' and name='Max') or exists(select 1 from public.people where id='mrbodoia') then
  raise exception 'Expected Max identity is missing or destination already exists';
 end if;
end$$;
-- Preserve the full original state; existing FK cascades handle relational references.
do $$declare snapshot jsonb := '{}'::jsonb; t text; rows jsonb; begin
 foreach t in array array['people','deals','entries','deal_participants','transactions','transaction_allocations','ledger_entries','reconciliation_checkpoints','inventory_items','transaction_items','import_batches','import_records','attachments'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',t) into rows;
  snapshot := snapshot || jsonb_build_object(t,rows);
 end loop;
 insert into private.identity_migration_audit(id,snapshot) values('max-to-mrbodoia',snapshot);
end$$;

update public.people set id='mrbodoia' where id='max';
create function private.remap_person(v text) returns text language sql immutable set search_path='' as $$
 select case v when 'max' then 'mrbodoia' else v end
$$;
create function private.remap_identity_json(v jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; k text; item jsonb; begin
 if jsonb_typeof(v)='array' then
  select coalesce(jsonb_agg(private.remap_identity_json(value) order by ord),'[]'::jsonb) into result from jsonb_array_elements(v) with ordinality a(value,ord);
  return result;
 elsif jsonb_typeof(v)='object' then
  result:='{}'::jsonb;
  for k,item in select * from jsonb_each(v) loop
   if k in ('_source','_previousPayload') then null; -- Original audit evidence stays verbatim.
   elsif k in ('from','to','person','seller','creditObligor') and jsonb_typeof(item)='string' then item:=to_jsonb(private.remap_person(item #>> '{}'));
   elsif k='funders' then select coalesce(jsonb_agg(to_jsonb(private.remap_person(value)) order by ord),'[]'::jsonb) into item from jsonb_array_elements_text(item) with ordinality a(value,ord);
   else item:=private.remap_identity_json(item);
   end if;
   result:=result||jsonb_build_object(k,item);
  end loop;
  return result;
 end if;
 return v;
end$$;
revoke all on function private.remap_person(text),private.remap_identity_json(jsonb) from public;
alter table public.deals drop constraint deals_members_check1;
alter table public.entries drop constraint entries_payload_check1;
update public.deals set payload=private.remap_identity_json(payload);
update public.entries set payload=private.remap_identity_json(payload);
alter table public.deals add constraint deals_members_check1 check(members <@ array['dread','1of1','mrbodoia','chang','pokemonhooper']);
alter table public.entries add constraint entries_payload_check1 check(payload->>'from' in ('dread','1of1','mrbodoia','chang','pokemonhooper'));
drop function private.remap_identity_json(jsonb);
drop function private.remap_person(text);

commit;
