
create sequence public.lad_change_seq;
create table public.lad_entries (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, revision integer not null, change_seq bigint not null,
 payload jsonb not null,
 primary key(user_id,id)
);
create index lad_entries_changes on public.lad_entries(user_id,change_seq);
create table public.lad_receipts (
 user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null, response jsonb not null, primary key(user_id,operation_id)
);
create table public.lad_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null, updated_at timestamptz not null default now()
);
create table public.lad_push_subscriptions (
 user_id uuid not null references auth.users(id) on delete cascade,
 device_id uuid not null, subscription jsonb not null,
 primary key(user_id,device_id)
);
alter table public.lad_entries enable row level security;
alter table public.lad_receipts enable row level security;
alter table public.lad_preferences enable row level security;
alter table public.lad_push_subscriptions enable row level security;
create policy owner_entries on public.lad_entries for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy owner_receipts on public.lad_receipts for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy owner_preferences on public.lad_preferences for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy owner_subscriptions on public.lad_push_subscriptions for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.lad_entries,public.lad_receipts,public.lad_preferences,public.lad_push_subscriptions from anon;
grant select,insert,update on public.lad_entries,public.lad_receipts to authenticated;
grant select,insert,update,delete on public.lad_preferences,public.lad_push_subscriptions to authenticated;
grant usage on sequence public.lad_change_seq to authenticated;
create or replace function public.lad_apply(p_operation uuid,p_id uuid,p_base integer,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); current_row public.lad_entries; prior jsonb; result jsonb; seq bigint; rev integer;
begin
 if u is null then raise exception 'authentication required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(7254609812345);
 select response into prior from public.lad_receipts where user_id=u and operation_id=p_operation;
 if found then return prior; end if;
 if p_payload->>'id' is distinct from p_id::text or p_base<0 or
 (p_payload->>'mood')::numeric not between 1 and 5 or
 (p_payload->>'mood')::numeric<>trunc((p_payload->>'mood')::numeric) or
 jsonb_typeof(p_payload->'note') is distinct from 'string' or length(p_payload->>'note')>10000 or
 (p_payload->>'occurredAt') is null or (p_payload->>'localDate') is null or (p_payload->>'timeZone') is null
 then raise exception 'invalid entry'; end if;
 perform (p_payload->>'occurredAt')::timestamptz;
 perform (p_payload->>'localDate')::date;
 select * into current_row from public.lad_entries where user_id=u and id=p_id for update;
 if (found and current_row.revision<>p_base) or (not found and p_base<>0) then
 result:=jsonb_build_object('status','conflict','entry',current_row.payload||jsonb_build_object('revision',current_row.revision,'changeSeq',current_row.change_seq));
 return result;
 end if;
 rev:=coalesce(current_row.revision,0)+1;
 seq:=nextval('public.lad_change_seq');
 p_payload:=p_payload||jsonb_build_object('revision',rev,'changeSeq',seq);
 insert into public.lad_entries(user_id,id,revision,change_seq,payload) values(u,p_id,rev,seq,p_payload)
 on conflict(user_id,id) do update set revision=excluded.revision,change_seq=excluded.change_seq,payload=excluded.payload;
 result:=jsonb_build_object('status','ok','entry',p_payload);
 insert into public.lad_receipts values(u,p_operation,result);
 return result;
end $$;
revoke all on function public.lad_apply(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.lad_apply(uuid,uuid,integer,jsonb) to authenticated;

