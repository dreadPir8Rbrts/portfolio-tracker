begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create table public.people(id text primary key, name text not null);
insert into public.people values ('joey','Joey · Dread'),('1of1','1of1'),('max','Max'),('matthew','Matthew'),('hooper','Pokemon Hooper');
create table private.accounts(user_id uuid primary key references auth.users(id) on delete cascade, person_id text not null unique references public.people(id), is_admin boolean not null default false);
alter table private.accounts enable row level security;
create function private.person_id() returns text language sql stable security definer set search_path='' as $$ select person_id from private.accounts where user_id=(select auth.uid()) $$;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select is_admin from private.accounts where user_id=(select auth.uid())),false) $$;
revoke all on function private.person_id(),private.is_admin() from public;
grant execute on function private.person_id(),private.is_admin() to authenticated;
create function public.my_identity() returns jsonb language sql stable security invoker set search_path='' as $$ select jsonb_build_object('person',private.person_id(),'admin',private.is_admin()) $$;
create function private.member_ids(data jsonb) returns text[] language sql immutable set search_path='' as $$ select coalesce(array_agg(m->>'person'),'{}') from jsonb_array_elements(data->'members') m $$;
revoke all on function private.member_ids(jsonb) from public;
grant execute on function private.member_ids(jsonb) to authenticated;
create table public.deals(
 id uuid primary key,
 payload jsonb not null check (jsonb_typeof(payload)='object' and payload->>'id'=id::text),
 members text[] generated always as (private.member_ids(payload)) stored,
 created_at timestamptz not null default now(),
 created_by uuid not null default auth.uid() references auth.users(id),
 check(cardinality(members) between 1 and 5),
 check(members <@ array['joey','1of1','max','matthew','hooper'])
);
create index deals_members_idx on public.deals using gin(members);
create table public.entries(
 id uuid primary key,
 deal_id uuid references public.deals(id),
 payload jsonb not null check(jsonb_typeof(payload)='object' and payload->>'id'=id::text),
 seq bigint generated always as identity unique,
 created_at timestamptz not null default now(),
 created_by uuid not null default auth.uid() references auth.users(id),
 check ((payload->>'dealId')::uuid is not distinct from deal_id),
 check(payload->>'kind' in ('sale','expense','funding_repayment','distribution','payment','on_behalf','opening','void')),
 check(payload->>'from' in ('joey','1of1','max','matthew','hooper')),
 check((payload->>'amount')::bigint between 0 and 100000000000)
);
create index entries_deal_idx on public.entries(deal_id,seq);
create index entries_from_idx on public.entries((payload->>'from')) where deal_id is null;
create index entries_to_idx on public.entries((payload->>'to')) where deal_id is null;
alter table public.people enable row level security;
alter table public.deals enable row level security;
alter table public.entries enable row level security;
create policy people_read on public.people for select to authenticated using ((select private.person_id()) is not null);
create policy deals_read on public.deals for select to authenticated using ((select private.is_admin()) or members @> array[(select private.person_id())]);
create policy deals_insert on public.deals for insert to authenticated with check ((select private.is_admin()) and created_by=(select auth.uid()));
create policy entries_read on public.entries for select to authenticated using (
 (select private.is_admin()) or
 (deal_id is not null and exists(select 1 from public.deals d where d.id=entries.deal_id and d.members @> array[(select private.person_id())])) or
 (deal_id is null and (select private.person_id()) in (payload->>'from',payload->>'to'))
);
create policy entries_insert on public.entries for insert to authenticated with check ((select private.is_admin()) and created_by=(select auth.uid()));
revoke all on public.people,public.deals,public.entries from anon,authenticated;
grant select on public.people,public.deals,public.entries to authenticated;
grant insert on public.deals,public.entries to authenticated;
grant usage on sequence public.entries_seq_seq to authenticated;
-- Serializes append operations and rejects stale projections; no update/delete grants.
create function public.append_entry(data jsonb, expected_count integer) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'Admin access required'; end if;
 perform pg_advisory_xact_lock(90128672);
 if (select count(*) from public.entries) <> expected_count then raise exception 'Ledger changed. Refresh and try again.'; end if;
 insert into public.entries(id,deal_id,payload) values ((data->>'id')::uuid,(data->>'dealId')::uuid,data);
end $$;
revoke all on function public.my_identity(),public.append_entry(jsonb,integer) from public;
grant execute on function public.my_identity(),public.append_entry(jsonb,integer) to authenticated;
commit;
