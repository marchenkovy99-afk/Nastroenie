create or replace function public.lad_delete_all(p_operation uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid();prior jsonb;result jsonb;n integer;
begin
 if u is null then raise exception 'authentication required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(7254609812345);
 select response into prior from public.lad_receipts where user_id=u and operation_id=p_operation;
 if found then return prior;end if;
 with changes as (select id,revision+1 as rev,nextval('public.lad_change_seq') as seq from public.lad_entries where user_id=u and payload->>'deletedAt' is null)
 update public.lad_entries e set revision=c.rev,change_seq=c.seq,payload=e.payload||jsonb_build_object('revision',c.rev,'changeSeq',c.seq,'deletedAt',now())
 from changes c where e.user_id=u and e.id=c.id;
 get diagnostics n=row_count;
 result:=jsonb_build_object('status','deleted','count',n);
 insert into public.lad_receipts values(u,p_operation,result);
 return result;
end $$;
revoke all on function public.lad_delete_all(uuid) from public,anon;
grant execute on function public.lad_delete_all(uuid) to authenticated;
