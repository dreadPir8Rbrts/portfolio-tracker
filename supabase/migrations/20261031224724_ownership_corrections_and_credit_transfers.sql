begin;
alter table public.entries drop constraint entries_kind_v3;
alter table public.entries add constraint entries_kind_v4 check(payload->>'kind' in ('ownership_correction','credit_sale','purchase_funding','purchase_obligation','sale','expense','funding_repayment','distribution','payment','on_behalf','opening','adjustment','void'));
alter table public.transactions drop constraint transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check check(kind in ('purchase','ownership_correction','credit_sale','purchase_funding','purchase_obligation','sale','expense','funding_repayment','distribution','payment','on_behalf','opening','adjustment','void'));
alter table public.inventory_items add column previous_inventory_id uuid unique references public.inventory_items(id);
create unique index one_credit_sale_per_acquisition on public.transactions(acquisition_id) where kind='credit_sale';
create or replace function private.materialize_deal() returns trigger language plpgsql security invoker set search_path='' as $$
declare m jsonb; i integer:=0; amount bigint; allocated bigint:=0; item jsonb;
begin
 if not private.is_admin() then raise exception 'Admin access required'; end if;
 if jsonb_array_length(new.payload->'members')<1 then raise exception 'Participants required'; end if;
 select sum((v->>'funded')::bigint) into amount from jsonb_array_elements(new.payload->'members') v;
 if coalesce(new.payload->>'fundingMode','')='' then
  if amount<>(new.payload->>'cost')::bigint then raise exception 'Funding must equal purchase cost';end if;
 else
  if new.payload->>'fundingMode' not in ('payments','seller_credit') or amount<>0 then raise exception 'Tracked purchases require zero initial funding';end if;
  if new.payload->>'fundingMode'='seller_credit' and (new.payload->>'seller' is null or exists(select 1 from jsonb_array_elements(new.payload->'members') owner_row where owner_row.value->>'person'=new.payload->>'seller') or not exists(select 1 from jsonb_array_elements(new.payload->'members') owner_row where owner_row.value->>'person'=coalesce(new.payload->>'creditObligor',case when jsonb_array_length(new.payload->'members')=1 then new.payload->'members'->0->>'person' end))) then raise exception 'Seller credit requires a responsible buyer and separate seller';end if;
 end if;
 amount:=(new.payload->>'cost')::bigint;
 insert into public.transactions(id,deal_id,kind,occurred_on,amount_cents,notes,created_by)
 values(new.id,new.id,'purchase',(new.payload->>'acquired')::date,amount,coalesce(new.payload->>'notes',''),new.created_by);
 for m in select value from jsonb_array_elements(new.payload->'members') loop
  insert into public.deal_participants values(new.id,m->>'person',(m->>'weight')::integer,i);i:=i+1;
  insert into public.transaction_allocations values(new.id,m->>'person','funding',(m->>'funded')::bigint);
 end loop;
 insert into public.transaction_allocations select new.id,person_id,'cost_share',amount_cents from private.allocate_cost(amount,new.payload->'members');
 if coalesce(new.payload->>'fundingMode','')='' then
 insert into public.ledger_entries select new.id,f.person_id,f.amount_cents-c.amount_cents from public.transaction_allocations f join public.transaction_allocations c on c.transaction_id=f.transaction_id and c.person_id=f.person_id and c.purpose='cost_share' where f.transaction_id=new.id and f.purpose='funding';
 end if;
 if jsonb_array_length(coalesce(new.payload->'inventory','[]'))>0 then
  for item in select value from jsonb_array_elements(new.payload->'inventory') loop
   insert into public.inventory_items(id,deal_id,kind,name,variant,grade,certification,quantity,cost_cents,notes,created_by,previous_inventory_id)
   values((item->>'id')::uuid,new.id,item->>'kind',item->>'name',coalesce(item->>'variant',''),coalesce(item->>'grade',''),coalesce(item->>'certification',''),(item->>'quantity')::integer,(item->>'cost')::bigint,coalesce(item->>'notes',''),new.created_by,(item->>'previousInventoryId')::uuid);
   allocated:=allocated+(item->>'cost')::bigint;
  end loop;
  if allocated<>amount then raise exception 'Inventory costs must equal purchase cost'; end if;
 else
  insert into public.inventory_items(id,deal_id,kind,name,variant,grade,cost_cents,notes,created_by)
  values(new.id,new.id,'lot',new.payload->>'name',coalesce(new.payload->>'variant',''),coalesce(new.payload->>'grade',''),amount,new.payload->>'items',new.created_by);
 end if;
 return new;
end $$;
create or replace function private.materialize_entry() returns trigger language plpgsql security invoker set search_path='' as $$
declare e jsonb:=new.payload; weights jsonb; posting jsonb; item jsonb; target public.transactions; total bigint; used integer; available integer; acquisition jsonb;
begin
 if not private.is_admin() then raise exception 'Admin access required'; end if;
 if length(trim(coalesce(e->>'notes','')))=0 then raise exception 'Transaction purpose required'; end if;
 if not (e ? '_postings') or jsonb_typeof(e->'_postings')<>'array' then raise exception 'Calculated ledger postings required'; end if;
 if new.deal_id is null and e->>'kind' not in ('purchase_obligation','payment','on_behalf','opening','adjustment','void') then raise exception 'Deal required'; end if;
 if new.deal_id is not null and e->>'kind' in ('purchase_obligation','payment','on_behalf','opening','adjustment') then raise exception 'General payments cannot be assigned to deals'; end if;
 if e->>'kind'='purchase_obligation' then
  select payload into strict acquisition from public.deals where id=(e->>'acquisitionId')::uuid;
  if acquisition->>'fundingMode' is distinct from 'seller_credit' or e->>'from' is distinct from coalesce(acquisition->>'creditObligor',acquisition->'members'->0->>'person') or e->>'to' is distinct from acquisition->>'seller' or (e->>'amount')::bigint is distinct from (acquisition->>'cost')::bigint or e->>'date' is distinct from acquisition->>'acquired' then raise exception 'Purchase obligation does not match acquisition';end if;
 end if;
 if e->>'kind'='credit_sale' then
  select payload into strict acquisition from public.deals where id=(e->>'acquisitionId')::uuid;
  if acquisition->>'fundingMode' is distinct from 'seller_credit' or jsonb_array_length(acquisition->'members')<>1 or acquisition->'members'->0->>'person' is distinct from e->>'to' or acquisition->>'seller' is distinct from e->>'from' or (acquisition->>'cost')::bigint is distinct from (e->>'amount')::bigint or acquisition->>'acquired' is distinct from e->>'date' or (e->>'fees')::bigint<>0 then raise exception 'Credit sale must match buyer acquisition';end if;
  if exists(select 1 from public.transactions where kind='credit_sale' and acquisition_id=(e->>'acquisitionId')::uuid) then raise exception 'Transfer already recorded';end if;
  if not exists(select 1 from public.deal_participants where deal_id=new.deal_id and person_id=e->>'from') then raise exception 'Seller must participate in original deal';end if;
 end if;
 if e->>'kind'='ownership_correction' then
  select payload into strict acquisition from public.deals where id=new.deal_id;
  if e->'revision'->'after' is distinct from acquisition or (e->>'amount')::bigint<>0 or e->>'to' is not null or e->>'date' is distinct from acquisition->>'acquired' or e->'revision'->'before'->>'id' is distinct from new.deal_id::text or e->'revision'->'before'->>'cost' is distinct from acquisition->>'cost' then raise exception 'Invalid ownership revision';end if;
 end if;
 if e->>'kind'='purchase_funding' then
  select payload into strict acquisition from public.deals where id=new.deal_id;
  if acquisition->>'fundingMode' is distinct from 'payments' or e->>'to' is not null then raise exception 'Invalid purchase funding';end if;
  if (select coalesce(sum(t.amount_cents),0) from public.transactions t where t.deal_id=new.deal_id and t.kind='purchase_funding' and not exists(select 1 from public.transactions r where r.reverses_id=t.id))+(e->>'amount')::bigint > (acquisition->>'cost')::bigint then raise exception 'Purchase funding exceeds price';end if;
 end if;
 if e->>'kind'='void' then
  select * into strict target from public.transactions where id=(e->>'target')::uuid;
  if target.kind in ('purchase','purchase_obligation','ownership_correction','credit_sale','void') or target.deal_id is distinct from new.deal_id or target.paid_by is distinct from e->>'from' or target.paid_for is distinct from e->>'to' then raise exception 'Invalid reversal';end if;
 end if;
 insert into public.transactions(id,deal_id,entry_id,kind,occurred_on,amount_cents,fee_cents,paid_by,paid_for,notes,reference,reverses_id,created_by,acquisition_id)
 values(new.id,new.deal_id,new.id,e->>'kind',(e->>'date')::date,(e->>'amount')::bigint,(e->>'fees')::bigint,e->>'from',e->>'to',e->>'notes',coalesce(e->>'reference',''),case when e->>'kind'='void' then (e->>'target')::uuid end,new.created_by,(e->>'acquisitionId')::uuid);
 for posting in select value from jsonb_array_elements(e->'_postings') loop
  if new.deal_id is not null and not exists(select 1 from public.deal_participants where deal_id=new.deal_id and person_id=posting->>'person') and not exists(select 1 from public.deals d where d.id=new.deal_id and coalesce(d.payload->'funders','[]'::jsonb) ? (posting->>'person')) then raise exception 'Posting outside deal';end if;
  if new.deal_id is null and posting->>'person' not in (e->>'from',e->>'to') then raise exception 'Posting outside payment relationship';end if;
  insert into public.ledger_entries values(new.id,posting->>'person',(posting->>'amount')::bigint);
 end loop;
 select coalesce(sum(amount_cents),0) into total from public.ledger_entries where transaction_id=new.id;
 if total<>0 then raise exception 'Ledger postings must balance'; end if;
 if new.deal_id is null and e->>'kind'<>'void' then
  if (select count(*) from public.ledger_entries where transaction_id=new.id)<>2 or
     (select amount_cents from public.ledger_entries where transaction_id=new.id and person_id=e->>'from') is distinct from ((e->>'amount')::bigint*case when e->>'kind' in ('purchase_obligation','opening','adjustment') then -1 else 1 end)
  then raise exception 'Payment postings do not match its amount and direction';end if;
 end if;
 if e->>'kind' in ('expense','purchase_funding') then
  weights:=e->'allocations';
  if weights is null or jsonb_array_length(weights)=0 then select payload->'members' into weights from public.deals where id=new.deal_id;end if;
  if exists(select 1 from jsonb_array_elements(weights) w where not exists(select 1 from public.deal_participants p where p.deal_id=new.deal_id and p.person_id=w->>'person')) then raise exception 'Expense allocation outside deal';end if;
  insert into public.transaction_allocations values(new.id,e->>'from','funding',(e->>'amount')::bigint);
  insert into public.transaction_allocations select new.id,person_id,'cost_share',amount_cents from private.allocate_cost((e->>'amount')::bigint,weights);
 end if;
 for item in select value from jsonb_array_elements(coalesce(e->'soldItems','[]')) loop
  if e->>'kind' not in ('sale','credit_sale') then raise exception 'Items require sale';end if;
  select quantity into strict available from public.inventory_items where id=(item->>'itemId')::uuid and deal_id=new.deal_id;
  if exists(select 1 from public.inventory_items where parent_id=(item->>'itemId')::uuid) then raise exception 'Sell the child inventory records';end if;
  select coalesce(sum(ti.quantity),0) into used from public.transaction_items ti join public.transactions t on t.id=ti.transaction_id where ti.item_id=(item->>'itemId')::uuid and not exists(select 1 from public.transactions r where r.reverses_id=t.id);
  if used+(item->>'quantity')::integer>available then raise exception 'Quantity exceeds remaining inventory';end if;
  insert into public.transaction_items values(new.id,(item->>'itemId')::uuid,(item->>'quantity')::integer);
 end loop;
 if e->>'kind' in ('sale','credit_sale') and (e->>'close')::boolean and exists(
  select 1 from public.inventory_items inv where inv.deal_id=new.deal_id
  and not exists(select 1 from public.inventory_items child where child.parent_id=inv.id)
  and inv.quantity > (select coalesce(sum(ti.quantity),0) from public.transaction_items ti join public.transactions t on t.id=ti.transaction_id where ti.item_id=inv.id and not exists(select 1 from public.transactions r where r.reverses_id=t.id))
 ) then raise exception 'Final sale must include all remaining inventory';end if;
 if coalesce(e->>'receiptUrl','')<>'' then
  insert into public.attachments(transaction_id,label,url,created_by) values(new.id,'Supporting document',e->>'receiptUrl',new.created_by);
 end if;
 return new;
end $$;


-- A buyer inventory record links to a sold ownership period, not a second live copy.
create function private.verify_inventory_transfer() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.previous_inventory_id is not null and not exists(
  select 1 from public.transactions t join public.transaction_items ti on ti.transaction_id=t.id
  join public.inventory_items prev on prev.id=ti.item_id
  where t.kind='credit_sale' and t.acquisition_id=new.deal_id and ti.item_id=new.previous_inventory_id
  and ti.quantity=new.quantity and prev.quantity=new.quantity and prev.grade=new.grade
 ) then raise exception 'Inventory transfer requires matching credit sale';end if;
 return new;
end $$;
revoke all on function private.verify_inventory_transfer() from public,anon;
create constraint trigger inventory_transfer_complete after insert on public.inventory_items deferrable initially deferred for each row execute function private.verify_inventory_transfer();
commit;
