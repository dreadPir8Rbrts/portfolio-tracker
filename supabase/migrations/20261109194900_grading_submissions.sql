begin;
create table public.grading (
 id uuid primary key,
 deal_id uuid not null references public.deals(id),
 card_name text not null check(length(trim(card_name)) between 1 and 300),
 inventory_item_id uuid references public.inventory_items(id),
 submitted_by text not null references public.people(id),
 grading_company text not null check(length(trim(grading_company)) between 1 and 100),
 submission_tier text not null default '' check(length(submission_tier)<=100),
 date_submitted date not null,
 date_completed date,
 final_grade text check(final_grade is null or length(trim(final_grade)) between 1 and 100),
 -- USD cents, consistent with the financial ledger; null means unknown.
 final_grading_costs bigint check(final_grading_costs between 0 and 100000000000),
 grading_costs_paid_by text references public.people(id),
 grading_costs_paid_on date,
 expense_entry_id uuid unique references public.entries(id),
 status text not null default 'submitted' check(status in ('submitted','grading','completed','returned','cancelled')),
 submission_reference text not null default '' check(length(submission_reference)<=200),
 certification_number text not null default '' check(length(certification_number)<=200),
 notes text not null default '' check(length(notes)<=5000),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid not null default auth.uid() references auth.users(id),
 check(date_completed is null or date_completed>=date_submitted),
 check(status not in ('completed','returned') or (date_completed is not null and final_grade is not null)),
 check((grading_costs_paid_by is null and grading_costs_paid_on is null and expense_entry_id is null)
    or (grading_costs_paid_by is not null and grading_costs_paid_on is not null and expense_entry_id is not null and final_grading_costs is not null and final_grading_costs>0))
);
create index grading_deal_idx on public.grading(deal_id);
create index grading_inventory_idx on public.grading(inventory_item_id);
create index grading_submitter_idx on public.grading(submitted_by);
create index grading_payer_idx on public.grading(grading_costs_paid_by);
create index grading_creator_idx on public.grading(created_by);

create table public.grading_history (
 id uuid primary key default gen_random_uuid(),
 grading_id uuid not null references public.grading(id),
 before_record jsonb, after_record jsonb not null,
 changed_at timestamptz not null default now(),
 changed_by uuid not null default auth.uid() references auth.users(id)
);
create index grading_history_grading_idx on public.grading_history(grading_id);
create index grading_history_actor_idx on public.grading_history(changed_by);
alter table public.grading enable row level security;
alter table public.grading_history enable row level security;
revoke all on public.grading, public.grading_history from public, anon, authenticated;
grant select,insert,update on public.grading to authenticated;
grant select,insert on public.grading_history to authenticated;
create policy grading_read on public.grading for select to authenticated using (private.can_read_deal(deal_id));
create policy grading_insert on public.grading for insert to authenticated with check ((select private.is_admin()) and created_by=(select auth.uid()));
create policy grading_update on public.grading for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy grading_history_read on public.grading_history for select to authenticated using ((select private.is_admin()));
create policy grading_history_insert on public.grading_history for insert to authenticated with check ((select private.is_admin()) and changed_by=(select auth.uid()));

create function private.validate_grading() returns trigger language plpgsql security invoker set search_path='' as $$
declare e jsonb;
begin
 if tg_op='UPDATE' then
   if new.id<>old.id or new.deal_id<>old.deal_id or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'Submission identity cannot change'; end if;
   if new.version<>old.version+1 then raise exception 'Submission version must advance once'; end if;
   if old.expense_entry_id is not null and not exists(select 1 from public.entries v where v.payload->>'kind'='void' and v.payload->>'target'=old.expense_entry_id::text) then
     if (new.expense_entry_id,new.final_grading_costs,new.grading_costs_paid_by,new.grading_costs_paid_on) is distinct from
        (old.expense_entry_id,old.final_grading_costs,old.grading_costs_paid_by,old.grading_costs_paid_on) then
       raise exception 'Reverse the original expense before changing recorded payment details';
     end if;
   end if;
 end if;
 if new.inventory_item_id is not null and not exists(select 1 from public.inventory_items i where i.id=new.inventory_item_id and i.deal_id=new.deal_id and i.kind='card') then raise exception 'Inventory card must belong to this deal'; end if;
 if new.expense_entry_id is not null then
   select payload into e from public.entries where id=new.expense_entry_id;
   if e is null or e->>'kind' is distinct from 'expense' or (e->>'dealId')::uuid is distinct from new.deal_id
    or e->>'from' is distinct from new.grading_costs_paid_by or (e->>'date')::date is distinct from new.grading_costs_paid_on
    or (e->>'amount')::bigint is distinct from new.final_grading_costs
    or exists(select 1 from public.entries v where v.payload->>'kind'='void' and v.payload->>'target'=new.expense_entry_id::text)
   then raise exception 'Payment must match an active expense for this deal'; end if;
 end if;
 new.updated_at=now();
 return new;
end $$;
revoke all on function private.validate_grading() from public,anon,authenticated;
create trigger grading_validate before insert or update on public.grading for each row execute function private.validate_grading();

create function private.audit_grading() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.grading_history(grading_id,before_record,after_record) values(new.id,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
revoke all on function private.audit_grading() from public,anon,authenticated;
create trigger grading_audit after insert or update on public.grading for each row execute function private.audit_grading();

-- Both the expense and submission commit together. Existing expense links do not
-- post money again. Version/count checks reject stale forms and duplicate retries.
create function public.save_grading(submission jsonb, expense_data jsonb, expected_version integer, expected_count integer)
returns public.grading language plpgsql security invoker set search_path='' as $$
declare r public.grading; previous public.grading;
begin
 if not private.is_admin() then raise exception 'Admin access required'; end if;
 perform pg_advisory_xact_lock(90128672);
 if (select count(*) from public.entries)<>expected_count then raise exception 'Ledger changed. Refresh and try again.'; end if;
 r=jsonb_populate_record(null::public.grading,submission);
 select * into previous from public.grading where id=r.id for update;
 if coalesce(previous.version,0) is distinct from expected_version then raise exception 'Submission changed. Refresh and try again.'; end if;
 if previous.id is not null and previous.deal_id<>r.deal_id then raise exception 'Submission cannot move deals'; end if;
 if expense_data is not null then
   if expense_data->>'kind' is distinct from 'expense' or (expense_data->>'dealId')::uuid is distinct from r.deal_id
     or (expense_data->>'id')::uuid is distinct from r.expense_entry_id or expense_data->>'to' is not null
   then raise exception 'Grading payment must be an expense for this deal'; end if;
   perform public.append_entry(expense_data,expected_count);
 end if;
 r.version=expected_version+1; r.created_by=coalesce(previous.created_by,auth.uid());
 r.created_at=coalesce(previous.created_at,now());r.updated_at=now();
 insert into public.grading select r.* on conflict(id) do update set
  card_name=excluded.card_name, inventory_item_id=excluded.inventory_item_id,
  submitted_by=excluded.submitted_by, grading_company=excluded.grading_company,
  submission_tier=excluded.submission_tier,date_submitted=excluded.date_submitted,date_completed=excluded.date_completed,
  final_grade=excluded.final_grade,final_grading_costs=excluded.final_grading_costs,
  grading_costs_paid_by=excluded.grading_costs_paid_by,grading_costs_paid_on=excluded.grading_costs_paid_on,
  expense_entry_id=excluded.expense_entry_id,status=excluded.status,submission_reference=excluded.submission_reference,
  certification_number=excluded.certification_number,notes=excluded.notes,version=excluded.version
 returning * into r;
 return r;
end $$;
revoke all on function public.save_grading(jsonb,jsonb,integer,integer) from public,anon;
grant execute on function public.save_grading(jsonb,jsonb,integer,integer) to authenticated;
commit;
