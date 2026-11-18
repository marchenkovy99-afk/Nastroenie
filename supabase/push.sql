create table public.lad_push_config(id integer primary key check(id=1),public_key text not null,private_key text not null,cron_token text not null);
alter table public.lad_push_config enable row level security;
revoke all on public.lad_push_config from public,anon,authenticated;
grant all on public.lad_push_config to service_role;
create table public.lad_push_deliveries(user_id uuid not null,device_id uuid not null,slot text not null,status text not null default 'pending',claimed_at timestamptz not null default now(),primary key(user_id,device_id,slot));
alter table public.lad_push_deliveries enable row level security;
revoke all on public.lad_push_deliveries from public,anon,authenticated;
grant all on public.lad_push_deliveries to service_role;
create or replace function public.lad_claim_push(p_user uuid,p_device uuid,p_slot text) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 insert into public.lad_push_deliveries(user_id,device_id,slot) values(p_user,p_device,p_slot) on conflict(user_id,device_id,slot) do update set claimed_at=now() where public.lad_push_deliveries.status='pending' and public.lad_push_deliveries.claimed_at<now()-interval '45 seconds';
 get diagnostics n=row_count; return n>0;
end $$;
revoke all on function public.lad_claim_push(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.lad_claim_push(uuid,uuid,text) to service_role;
create extension if not exists pg_net;
create extension if not exists pg_cron;

