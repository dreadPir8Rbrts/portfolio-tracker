begin;
select pg_advisory_xact_lock(90128672);
lock table public.people, public.deals, public.entries in access exclusive mode;

-- Preserve original financial payloads and projections, including their old IDs.
create table private.identity_migration_audit (
 id text primary key, recorded_at timestamptz not null default now(), snapshot jsonb not null
);
alter table private.identity_migration_audit enable row level security;
revoke all on private.identity_migration_audit from public, anon, authenticated;
do $$declare snapshot jsonb := '{}'::jsonb; t text; rows jsonb; begin
 foreach t in array array['people','deals','entries','deal_participants','transactions','transaction_allocations','ledger_entries','reconciliation_checkpoints','inventory_items','transaction_items','import_batches','import_records','attachments'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',t) into rows;
  snapshot := snapshot || jsonb_build_object(t,rows);
 end loop;
 snapshot := snapshot || jsonb_build_object('accounts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from private.accounts a));
 insert into private.identity_migration_audit(id,snapshot) values('people-auth-identity',snapshot);
end$$;

alter table public.people add column auth_user_id uuid unique references auth.users(id) on delete set null;
alter table public.people add column admin boolean not null default false;
update public.people p set auth_user_id=a.user_id from private.accounts a where a.person_id=p.id;
update public.people set admin=(id='joey');

-- Cascades cover relational references; generated member arrays follow the JSON below.
do $$declare c record; begin
 for c in select conrelid::regclass as tbl,conname,pg_get_constraintdef(oid) as definition from pg_constraint where contype='f' and confrelid='public.people'::regclass loop
  execute format('alter table %s drop constraint %I',c.tbl,c.conname);
  execute format('alter table %s add constraint %I %s on update cascade',c.tbl,c.conname,c.definition);
 end loop;
end$$;
update public.people set id=case id when 'joey' then 'dread' when 'matthew' then 'chang' when 'hooper' then 'pokemonhooper' else id end;
update public.people set name=case id when 'dread' then 'Joey' when '1of1' then 'Michael' when 'chang' then 'Matthew' when 'pokemonhooper' then 'Seb' when 'max' then 'Max' else name end;
alter table public.people add constraint people_login_id check (id=lower(id) and id ~ '^[a-z0-9][a-z0-9_-]{0,63}$');

create function private.remap_person(v text) returns text language sql immutable set search_path='' as $$
 select case v when 'joey' then 'dread' when 'matthew' then 'chang' when 'hooper' then 'pokemonhooper' else v end
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
alter table public.deals add constraint deals_members_check1 check(members <@ array['dread','1of1','max','chang','pokemonhooper']);
alter table public.entries add constraint entries_payload_check1 check(payload->>'from' in ('dread','1of1','max','chang','pokemonhooper'));
drop function private.remap_identity_json(jsonb);
drop function private.remap_person(text);

-- No client may edit identities, auth links, or roles. Only ID/name are readable.
alter table public.people enable row level security;
revoke all on public.people from public, anon, authenticated;
grant select(id,name) on public.people to authenticated;
-- Existing people_read policy is retained; these helpers avoid recursive RLS checks.
create or replace function private.person_id() returns text language sql stable security definer set search_path='' as $$
 select id from public.people where auth_user_id=(select auth.uid())
$$;
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select admin from public.people where auth_user_id=(select auth.uid())),false)
$$;
drop table private.accounts;

-- Fixed-window per-username throttling is shared across all Edge Function instances.
create table private.login_attempts(username text primary key, window_start timestamptz not null, attempts integer not null);
alter table private.login_attempts enable row level security;
revoke all on private.login_attempts from public,anon,authenticated;
grant usage on schema private, auth to service_role;
grant select(id,email) on auth.users to service_role;
grant select,insert,update,delete on private.login_attempts to service_role;
grant select on public.people to service_role;
create function public.resolve_login(username text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare normalized text:=lower(trim(username)); attempts integer; email text; begin
 if normalized is null or normalized !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then return jsonb_build_object('email',null,'limited',false); end if;
 delete from private.login_attempts where window_start < now()-interval '1 day';
 insert into private.login_attempts as a values(normalized,now(),1)
 on conflict on constraint login_attempts_pkey do update set
 attempts=case when a.window_start<=now()-interval '1 minute' then 1 else a.attempts+1 end,
 window_start=case when a.window_start<=now()-interval '1 minute' then now() else a.window_start end
 returning a.attempts into attempts;
 if attempts>10 then return jsonb_build_object('limited',true); end if;
 select u.email into email from public.people p join auth.users u on u.id=p.auth_user_id where p.id=normalized;
 return jsonb_build_object('email',email,'limited',false);
end$$;
revoke all on function public.resolve_login(text) from public,anon,authenticated;
grant execute on function public.resolve_login(text) to service_role;
commit;
