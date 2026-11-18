begin;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $test$
declare payload jsonb:='{"id":"00000000-0000-4000-8000-000000000021","mood":4,"note":"test","occurredAt":"2026-11-17T14:00:00Z","localDate":"2026-11-17","timeZone":"Europe/Moscow","deletedAt":null}'; a jsonb; b jsonb; denied boolean:=false;
begin
 a:=public.lad_apply('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021',0,payload);
 b:=public.lad_apply('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021',0,payload);
 if a<>b or (select count(*) from public.lad_entries)<>1 then raise exception 'idempotency failed';end if;
 b:=public.lad_apply('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000021',0,payload);
 if b->>'status'<>'conflict' then raise exception 'conflict detection failed';end if;
 b:=public.lad_apply('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000021',1,payload||'{"deletedAt":"2026-11-17T15:00:00Z"}');
 if b->'entry'->>'deletedAt' is null then raise exception 'tombstone missing';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 if (select count(*) from public.lad_entries)<>0 then raise exception 'read isolation failed';end if;
 begin
 insert into public.lad_entries values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000099',1,999,payload);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'write isolation failed';end if;
 denied:=false;
 begin perform private_key from public.lad_push_config;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'push secret isolation failed';end if;
end $test$;
select jsonb_build_object('idempotent_retry',true,'stale_write_conflict',true,'tombstone',true,'cross_account_read_denied',true,'cross_account_write_denied',true,'push_secret_denied',true) as checks;
rollback;
