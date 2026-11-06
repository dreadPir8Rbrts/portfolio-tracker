begin;
do $$begin
 if exists(select 1 from public.deals) or exists(select 1 from public.entries) then raise exception 'Existing financial records require a reviewed backfill before applying this migration';end if;
end$$;
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.entries'::regclass and contype='c' and pg_get_constraintdef(oid) like '%kind%' loop
  execute format('alter table public.entries drop constraint %I',c.conname);
 end loop;
end$$;
alter table public.entries add constraint entries_kind_v2 check(payload->>'kind' in ('sale','expense','funding_repayment','distribution','payment','on_behalf','opening','adjustment','void'));
-- Keep the original immutable payloads as source/audit records while materializing
-- queryable relational data in the same transaction. No existing rows are deleted.
alter table public.deals add column name text generated always as (payload->>'name') stored;
alter table public.deals add column acquired_on date;
alter table public.deals add column purchase_cents bigint;
create table public.deal_participants(
 deal_id uuid not null references public.deals(id),person_id text not null references public.people(id),
 ownership_units integer not null check(ownership_units>0),sort_order integer not null,
 primary key(deal_id,person_id),unique(deal_id,sort_order)
);
create index deal_participants_person_idx on public.deal_participants(person_id);
create table public.inventory_items(
 id uuid primary key default gen_random_uuid(),deal_id uuid not null references public.deals(id),
 parent_id uuid references public.inventory_items(id),kind text not null check(kind in ('lot','card')),
 name text not null check(length(trim(name))>0),variant text not null default '',grade text not null default '',certification text not null default '',
 quantity integer not null default 1 check(quantity>0),cost_cents bigint not null check(cost_cents>=0),
 notes text not null default '',created_at timestamptz not null default now(),created_by uuid not null default auth.uid() references auth.users(id)
);
create index inventory_deal_idx on public.inventory_items(deal_id);
create index inventory_parent_idx on public.inventory_items(parent_id);
create index inventory_creator_idx on public.inventory_items(created_by);
create table public.transactions(
 id uuid primary key,deal_id uuid references public.deals(id),entry_id uuid unique references public.entries(id),
 kind text not null check(kind in ('purchase','sale','expense','funding_repayment','distribution','payment','on_behalf','opening','adjustment','void')),
 occurred_on date not null,amount_cents bigint not null check(amount_cents>=0),fee_cents bigint not null default 0 check(fee_cents>=0),
 paid_by text references public.people(id),paid_for text references public.people(id),
 notes text not null,reference text not null default '',reverses_id uuid unique references public.transactions(id),
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 check(fee_cents<=amount_cents),check(paid_by is null or paid_for is null or paid_by<>paid_for)
);
create index transactions_deal_idx on public.transactions(deal_id,occurred_on);
create index transactions_by_idx on public.transactions(paid_by);
create index transactions_for_idx on public.transactions(paid_for);
create index transactions_creator_idx on public.transactions(created_by);
create table public.transaction_allocations(
 transaction_id uuid not null references public.transactions(id),person_id text not null references public.people(id),
 purpose text not null check(purpose in ('funding','cost_share')),amount_cents bigint not null check(amount_cents>=0),
 primary key(transaction_id,person_id,purpose)
);
create index allocations_person_idx on public.transaction_allocations(person_id);
create table public.transaction_items(
 transaction_id uuid not null references public.transactions(id),item_id uuid not null references public.inventory_items(id),
 quantity integer not null check(quantity>0),primary key(transaction_id,item_id)
);
create index transaction_items_item_idx on public.transaction_items(item_id);
create table public.ledger_entries(
 transaction_id uuid not null references public.transactions(id),person_id text not null references public.people(id),
 amount_cents bigint not null,primary key(transaction_id,person_id)
);
create index ledger_person_idx on public.ledger_entries(person_id);
create table public.reconciliation_checkpoints(
 id uuid primary key default gen_random_uuid(),from_person text not null references public.people(id),to_person text not null references public.people(id),
 as_of date not null,agreed_cents bigint not null check(agreed_cents>=0),tolerance_cents bigint not null default 0 check(tolerance_cents>=0),
 notes text not null check(length(trim(notes))>0),created_at timestamptz not null default now(),created_by uuid not null default auth.uid() references auth.users(id),
 check(from_person<>to_person)
);
create index checkpoints_from_idx on public.reconciliation_checkpoints(from_person,as_of);
create index checkpoints_to_idx on public.reconciliation_checkpoints(to_person);
create index checkpoints_creator_idx on public.reconciliation_checkpoints(created_by);
create table public.import_batches(
 id uuid primary key default gen_random_uuid(),filename text not null,content_hash text not null unique,
 source_rows jsonb not null check(jsonb_typeof(source_rows)='array'),notes text not null default '',
 created_at timestamptz not null default now(),created_by uuid not null default auth.uid() references auth.users(id)
);
create index imports_creator_idx on public.import_batches(created_by);
create table public.import_records(
 batch_id uuid not null references public.import_batches(id),row_number integer not null check(row_number>0),
 transaction_id uuid not null unique references public.transactions(id),primary key(batch_id,row_number,transaction_id)
);
create table public.attachments(
 id uuid primary key default gen_random_uuid(),transaction_id uuid not null references public.transactions(id),
 label text not null check(length(trim(label))>0),url text not null check(url ~ '^https://'),
 created_at timestamptz not null default now(),created_by uuid not null default auth.uid() references auth.users(id)
);
create index attachments_transaction_idx on public.attachments(transaction_id);
create index attachments_creator_idx on public.attachments(created_by);
-- Internal helpers run with caller permissions; they respect the underlying RLS.
create function private.can_read_deal(did uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select private.is_admin() or exists(select 1 from public.deals d where d.id=did and d.members @> array[private.person_id()])
$$;
create function private.can_read_transaction(tid uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.transactions t where t.id=tid)
$$;
revoke all on function private.can_read_deal(uuid),private.can_read_transaction(uuid) from public;
grant execute on function private.can_read_deal(uuid),private.can_read_transaction(uuid) to authenticated;
do $$ declare t text; begin
 foreach t in array array['deal_participants','inventory_items','transactions','transaction_allocations','transaction_items','ledger_entries','reconciliation_checkpoints','import_batches','import_records','attachments'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select,insert on public.%I to authenticated',t);
  if t in ('inventory_items','transactions','reconciliation_checkpoints','import_batches','attachments') then
   execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select private.is_admin()) and created_by=(select auth.uid()))',t);
  else
   execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select private.is_admin()))',t);
  end if;
 end loop;
end $$;
create policy participants_read on public.deal_participants for select to authenticated using(private.can_read_deal(deal_id));
create policy inventory_read on public.inventory_items for select to authenticated using(private.can_read_deal(deal_id));
create policy transactions_read on public.transactions for select to authenticated using(
 (select private.is_admin()) or (deal_id is not null and private.can_read_deal(deal_id)) or
 (deal_id is null and (select private.person_id()) in (paid_by,paid_for))
);
create policy allocations_read on public.transaction_allocations for select to authenticated using(private.can_read_transaction(transaction_id));
create policy items_read on public.transaction_items for select to authenticated using(private.can_read_transaction(transaction_id));
create policy ledger_read on public.ledger_entries for select to authenticated using(private.can_read_transaction(transaction_id));
create policy checkpoints_read on public.reconciliation_checkpoints for select to authenticated using((select private.is_admin()) or (select private.person_id()) in (from_person,to_person));
create policy imports_read on public.import_batches for select to authenticated using((select private.is_admin()));
create policy import_rows_read on public.import_records for select to authenticated using((select private.is_admin()));
create policy attachments_read on public.attachments for select to authenticated using(private.can_read_transaction(transaction_id));
-- Integer, largest-remainder cost allocation; ownership order is the tie breaker.
create function private.allocate_cost(total bigint, weights jsonb) returns table(person_id text,amount_cents bigint)
language sql immutable security invoker set search_path='' as $$
 with w as (select value->>'person' person, (value->>'weight')::numeric weight, ordinality ord from jsonb_array_elements(weights) with ordinality),
 fractions as (select *,total*weight/sum(weight) over() exact from w),
 rounded as(select *,floor(exact)::bigint base, row_number() over(order by exact-floor(exact) desc,ord) ranking from fractions)
 select person,base+case when ranking<=total-sum(base) over() then 1 else 0 end from rounded
$$;
revoke all on function private.allocate_cost(bigint,jsonb) from public;
grant execute on function private.allocate_cost(bigint,jsonb) to authenticated;
create function private.materialize_deal() returns trigger language plpgsql security invoker set search_path='' as $$
declare m jsonb; i integer:=0; amount bigint; allocated bigint:=0; item jsonb;
begin
 if not private.is_admin() then raise exception 'Admin access required'; end if;
 if jsonb_array_length(new.payload->'members')<1 then raise exception 'Participants required'; end if;
 select sum((v->>'funded')::bigint) into amount from jsonb_array_elements(new.payload->'members') v;
 if amount<>(new.payload->>'cost')::bigint then raise exception 'Funding must equal purchase cost'; end if;
 insert into public.transactions(id,deal_id,kind,occurred_on,amount_cents,notes,created_by)
 values(new.id,new.id,'purchase',(new.payload->>'acquired')::date,amount,coalesce(new.payload->>'notes',''),new.created_by);
 for m in select value from jsonb_array_elements(new.payload->'members') loop
  insert into public.deal_participants values(new.id,m->>'person',(m->>'weight')::integer,i);i:=i+1;
  insert into public.transaction_allocations values(new.id,m->>'person','funding',(m->>'funded')::bigint);
 end loop;
 insert into public.transaction_allocations select new.id,person_id,'cost_share',amount_cents from private.allocate_cost(amount,new.payload->'members');
 insert into public.ledger_entries select new.id,f.person_id,f.amount_cents-c.amount_cents from public.transaction_allocations f join public.transaction_allocations c on c.transaction_id=f.transaction_id and c.person_id=f.person_id and c.purpose='cost_share' where f.transaction_id=new.id and f.purpose='funding';
 if jsonb_array_length(coalesce(new.payload->'inventory','[]'))>0 then
  for item in select value from jsonb_array_elements(new.payload->'inventory') loop
   insert into public.inventory_items(id,deal_id,kind,name,variant,grade,certification,quantity,cost_cents,notes,created_by)
   values((item->>'id')::uuid,new.id,item->>'kind',item->>'name',coalesce(item->>'variant',''),coalesce(item->>'grade',''),coalesce(item->>'certification',''),(item->>'quantity')::integer,(item->>'cost')::bigint,coalesce(item->>'notes',''),new.created_by);
   allocated:=allocated+(item->>'cost')::bigint;
  end loop;
  if allocated<>amount then raise exception 'Inventory costs must equal purchase cost'; end if;
 else
  insert into public.inventory_items(id,deal_id,kind,name,variant,grade,cost_cents,notes,created_by)
  values(new.id,new.id,'lot',new.payload->>'name',coalesce(new.payload->>'variant',''),coalesce(new.payload->>'grade',''),amount,new.payload->>'items',new.created_by);
 end if;
 return new;
end $$;
create function private.deal_columns() returns trigger language plpgsql security invoker set search_path='' as $$begin new.acquired_on:=(new.payload->>'acquired')::date;new.purchase_cents:=(new.payload->>'cost')::bigint;return new;end$$;
revoke all on function private.materialize_deal(),private.deal_columns() from public;
create trigger deal_columns before insert on public.deals for each row execute function private.deal_columns();
create trigger deal_records after insert on public.deals for each row execute function private.materialize_deal();
create function private.materialize_entry() returns trigger language plpgsql security invoker set search_path='' as $$
declare e jsonb:=new.payload; weights jsonb; posting jsonb; item jsonb; target public.transactions; total bigint; used integer; available integer;
begin
 if not private.is_admin() then raise exception 'Admin access required'; end if;
 if length(trim(coalesce(e->>'notes','')))=0 then raise exception 'Transaction purpose required'; end if;
 if not (e ? '_postings') or jsonb_typeof(e->'_postings')<>'array' then raise exception 'Calculated ledger postings required'; end if;
 if new.deal_id is null and e->>'kind' not in ('payment','on_behalf','opening','adjustment','void') then raise exception 'Deal required'; end if;
 if new.deal_id is not null and e->>'kind' in ('payment','on_behalf','opening','adjustment') then raise exception 'General payments cannot be assigned to deals'; end if;
 if e->>'kind'='void' then
  select * into strict target from public.transactions where id=(e->>'target')::uuid;
  if target.kind in ('purchase','void') or target.deal_id is distinct from new.deal_id or target.paid_by is distinct from e->>'from' or target.paid_for is distinct from e->>'to' then raise exception 'Invalid reversal';end if;
 end if;
 insert into public.transactions(id,deal_id,entry_id,kind,occurred_on,amount_cents,fee_cents,paid_by,paid_for,notes,reference,reverses_id,created_by)
 values(new.id,new.deal_id,new.id,e->>'kind',(e->>'date')::date,(e->>'amount')::bigint,(e->>'fees')::bigint,e->>'from',e->>'to',e->>'notes',coalesce(e->>'reference',''),case when e->>'kind'='void' then (e->>'target')::uuid end,new.created_by);
 for posting in select value from jsonb_array_elements(e->'_postings') loop
  if new.deal_id is not null and not exists(select 1 from public.deal_participants where deal_id=new.deal_id and person_id=posting->>'person') then raise exception 'Posting outside deal';end if;
  if new.deal_id is null and posting->>'person' not in (e->>'from',e->>'to') then raise exception 'Posting outside payment relationship';end if;
  insert into public.ledger_entries values(new.id,posting->>'person',(posting->>'amount')::bigint);
 end loop;
 select coalesce(sum(amount_cents),0) into total from public.ledger_entries where transaction_id=new.id;
 if total<>0 then raise exception 'Ledger postings must balance'; end if;
 if new.deal_id is null and e->>'kind'<>'void' then
  if (select count(*) from public.ledger_entries where transaction_id=new.id)<>2 or
     (select amount_cents from public.ledger_entries where transaction_id=new.id and person_id=e->>'from') is distinct from ((e->>'amount')::bigint*case when e->>'kind' in ('opening','adjustment') then -1 else 1 end)
  then raise exception 'Payment postings do not match its amount and direction';end if;
 end if;
 if e->>'kind'='expense' then
  weights:=e->'allocations';
  if weights is null or jsonb_array_length(weights)=0 then select payload->'members' into weights from public.deals where id=new.deal_id;end if;
  if exists(select 1 from jsonb_array_elements(weights) w where not exists(select 1 from public.deal_participants p where p.deal_id=new.deal_id and p.person_id=w->>'person')) then raise exception 'Expense allocation outside deal';end if;
  insert into public.transaction_allocations values(new.id,e->>'from','funding',(e->>'amount')::bigint);
  insert into public.transaction_allocations select new.id,person_id,'cost_share',amount_cents from private.allocate_cost((e->>'amount')::bigint,weights);
 end if;
 for item in select value from jsonb_array_elements(coalesce(e->'soldItems','[]')) loop
  if e->>'kind'<>'sale' then raise exception 'Items require sale';end if;
  select quantity into strict available from public.inventory_items where id=(item->>'itemId')::uuid and deal_id=new.deal_id;
  if exists(select 1 from public.inventory_items where parent_id=(item->>'itemId')::uuid) then raise exception 'Sell the child inventory records';end if;
  select coalesce(sum(ti.quantity),0) into used from public.transaction_items ti join public.transactions t on t.id=ti.transaction_id where ti.item_id=(item->>'itemId')::uuid and not exists(select 1 from public.transactions r where r.reverses_id=t.id);
  if used+(item->>'quantity')::integer>available then raise exception 'Quantity exceeds remaining inventory';end if;
  insert into public.transaction_items values(new.id,(item->>'itemId')::uuid,(item->>'quantity')::integer);
 end loop;
 if e->>'kind'='sale' and (e->>'close')::boolean and exists(
  select 1 from public.inventory_items inv where inv.deal_id=new.deal_id
  and not exists(select 1 from public.inventory_items child where child.parent_id=inv.id)
  and inv.quantity > (select coalesce(sum(ti.quantity),0) from public.transaction_items ti join public.transactions t on t.id=ti.transaction_id where ti.item_id=inv.id and not exists(select 1 from public.transactions r where r.reverses_id=t.id))
 ) then raise exception 'Final sale must include all remaining inventory';end if;
 if coalesce(e->>'receiptUrl','')<>'' then
  insert into public.attachments(transaction_id,label,url,created_by) values(new.id,'Supporting document',e->>'receiptUrl',new.created_by);
 end if;
 return new;
end $$;
revoke all on function private.materialize_entry() from public;
create trigger entry_records after insert on public.entries for each row execute function private.materialize_entry();
-- Inventory subdivision replaces a parent lot with children; preserve all parent records.
create function public.split_inventory(parent uuid,children jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare p public.inventory_items; child jsonb; total bigint:=0;
begin
 if not private.is_admin() then raise exception 'Admin access required';end if;
 perform pg_advisory_xact_lock(90128672);
 select * into strict p from public.inventory_items where id=parent;
 if p.kind<>'lot' or exists(select 1 from public.inventory_items where parent_id=parent) then raise exception 'Choose an unsplit lot';end if;
 if exists(select 1 from public.transaction_items i join public.transactions t on t.id=i.transaction_id where i.item_id=parent and not exists(select 1 from public.transactions r where r.reverses_id=t.id)) then raise exception 'Cannot subdivide a sold lot';end if;
 if jsonb_array_length(children)<1 then raise exception 'Children required';end if;
 for child in select value from jsonb_array_elements(children) loop
  insert into public.inventory_items(deal_id,parent_id,kind,name,variant,grade,certification,quantity,cost_cents,notes)
  values(p.deal_id,p.id,child->>'kind',child->>'name',coalesce(child->>'variant',''),coalesce(child->>'grade',''),coalesce(child->>'certification',''),(child->>'quantity')::integer,(child->>'cost')::bigint,coalesce(child->>'notes',''));
  total:=total+(child->>'cost')::bigint;
 end loop;
 if total<>p.cost_cents then raise exception 'Child costs must equal lot cost; include a remainder lot if needed';end if;
end $$;
revoke all on function public.split_inventory(uuid,jsonb) from public;
grant execute on function public.split_inventory(uuid,jsonb) to authenticated;
-- Single atomic commit for a reviewed CSV batch, with duplicate/stale protection.
create function public.import_portfolio(batch jsonb,deal_rows jsonb,entry_rows jsonb,expected_count integer) returns void language plpgsql security invoker set search_path='' as $$
declare d jsonb;e jsonb;bid uuid;row_no integer:=0;
begin
 if not private.is_admin() then raise exception 'Admin access required';end if;
 perform pg_advisory_xact_lock(90128672);
 if (select count(*) from public.entries)<>expected_count then raise exception 'Ledger changed. Refresh and preview again.';end if;
 insert into public.import_batches(filename,content_hash,source_rows,notes) values(batch->>'filename',batch->>'hash',batch->'rows',coalesce(batch->>'notes','')) returning id into bid;
 for d in select value from jsonb_array_elements(deal_rows) loop
  insert into public.deals(id,payload) values((d->>'id')::uuid,d);row_no:=row_no+1;
  insert into public.import_records values(bid,coalesce((d->>'_importRow')::integer,row_no),(d->>'id')::uuid);
 end loop;
 for e in select value from jsonb_array_elements(entry_rows) loop
  insert into public.entries(id,deal_id,payload) values((e->>'id')::uuid,(e->>'dealId')::uuid,e);row_no:=row_no+1;
  insert into public.import_records values(bid,coalesce((e->>'_importRow')::integer,row_no),(e->>'id')::uuid);
 end loop;
end $$;
revoke all on function public.import_portfolio(jsonb,jsonb,jsonb,integer) from public;
grant execute on function public.import_portfolio(jsonb,jsonb,jsonb,integer) to authenticated;
commit;
