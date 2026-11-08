begin;
-- Optional metadata lives alongside the existing immutable financial payload.
-- Historical classification is a guarded, audited data update, not a replay.
alter table public.entries add constraint entries_source_classification check (
  (not (payload ?| array['source','sourceCategory','payoutEntryId','payoutGroup']))
  or coalesce(
    payload->>'source' = 'ebay'
    and case payload->>'sourceCategory'
      when 'shared_payout' then payload->>'kind' = 'sale'
      when 'personal_payout' then payload->>'kind' in ('sale','payment')
      when 'pass_through' then payload->>'kind' = 'payment'
      when 'refund' then payload->>'kind' = 'payment'
      when 'purchase' then payload->>'kind' in ('purchase_funding','expense','on_behalf')
      when 'forwarded' then payload->>'kind' = 'on_behalf'
      else false end
    and ((payload->>'sourceCategory' = 'forwarded') = (payload ? 'payoutEntryId'))
    and (not (payload ? 'payoutEntryId') or
      (jsonb_typeof(payload->'payoutEntryId') = 'string' and payload->>'payoutEntryId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'))
    and (not (payload ? 'payoutGroup') or
      (payload->>'sourceCategory' in ('shared_payout','personal_payout','pass_through')
       and jsonb_typeof(payload->'payoutGroup') = 'string'
       and length(trim(payload->>'payoutGroup')) between 1 and 100)), false)
);

create function private.validate_entry_source() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare incoming jsonb; forwarded bigint; member_count integer;
begin
  if new.payload->>'source' is distinct from 'ebay' then return new; end if;
  if new.payload->>'sourceCategory' in ('shared_payout','personal_payout') and new.payload->>'kind' = 'sale' then
    select jsonb_array_length(d.payload->'members') into member_count from public.deals d where d.id=new.deal_id;
    if member_count is null or
      (new.payload->>'sourceCategory'='shared_payout' and member_count<2) or
      (new.payload->>'sourceCategory'='personal_payout' and member_count<>1) then
      raise exception 'Payout category must match deal ownership';
    end if;
  end if;
  if new.payload->>'sourceCategory'='forwarded' then
    perform pg_advisory_xact_lock(90128672);
    select e.payload into incoming from public.entries e
      where e.id=(new.payload->>'payoutEntryId')::uuid
      and not exists(select 1 from public.entries v where v.payload->>'target'=e.id::text and v.payload->>'kind'='void');
    if incoming is null or incoming->>'source' is distinct from 'ebay'
      or incoming->>'sourceCategory' is distinct from 'pass_through'
      or incoming->>'from' is distinct from new.payload->>'to'
      or incoming->>'to' is distinct from new.payload->>'from'
      or incoming->>'date' > new.payload->>'date' then
      raise exception 'Choose an earlier incoming pass-through payout between these partners';
    end if;
    select coalesce(sum((e.payload->>'amount')::bigint),0) into forwarded from public.entries e
      where e.id<>new.id and e.payload->>'payoutEntryId'=incoming->>'id'
      and not exists(select 1 from public.entries v where v.payload->>'target'=e.id::text and v.payload->>'kind'='void');
    if forwarded+(new.payload->>'amount')::bigint > (incoming->>'amount')::bigint then
      raise exception 'Forwarded payments exceed the incoming payout';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.validate_entry_source() from public, anon, authenticated;
create trigger entry_source before insert or update of payload on public.entries
for each row execute function private.validate_entry_source();
-- No new API grants, policies, or privileged functions.
commit;
