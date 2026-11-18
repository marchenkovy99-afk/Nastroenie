import { createClient } from '@supabase/supabase-js';
import { cloudUrl, cloudKey } from './cloud-config';
import { db, repo, type DeleteIntent } from './repository';
import { syncScope } from './sync';
import type { Entry, Preferences } from './domain';
export const supabase=createClient(cloudUrl,cloudKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
export type SyncState='disabled'|'offline'|'pending'|'syncing'|'synced'|'error'|'conflict';
const locks=new Map<string,Promise<string>>();
export function enabled(scope:string){return scope!=='guest'&&localStorage.getItem('lad-sync:'+scope)==='on'}
export function setEnabled(scope:string,on:boolean){localStorage.setItem('lad-sync:'+scope,on?'on':'off')}
export async function syncCloud(scope:string):Promise<string>{
  if(scope==='guest')return 'disabled';
  const deletion=await db.meta.get(scope+':deleteAll');
  if(!enabled(scope)&&!deletion)return 'disabled';
  if(!navigator.onLine)return 'offline';
  if(locks.has(scope))return locks.get(scope)!;
  const task=(async()=>{
    const {data:{session}}=await supabase.auth.getSession();
    if(session?.user.id!==scope)throw Error('Синхронизация остановлена: аккаунт изменился');
    // A fixed token prevents an account change from redirecting in-flight requests into another account.
    const client=createClient(cloudUrl,cloudKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${session.access_token}`}}});
    const assertScope=async()=>{const {data:{session:current}}=await supabase.auth.getSession();if(current?.user.id!==scope)throw Error('Синхронизация остановлена: аккаунт изменился')};
    const intent=(await db.meta.get(scope+':deleteAll'))?.value as DeleteIntent|undefined;
    if(intent){await assertScope();const {error}=await client.rpc('lad_delete_all',{p_operation:intent.operationId});if(error)throw error;await repo.ackDeleteAll(scope,intent.operationId);}
    const pushOff=await db.meta.get(scope+':pushDisabledDevice');
    if(pushOff?.value){const {error}=await client.from('lad_push_subscriptions').delete().eq('user_id',scope).eq('device_id',String(pushOff.value));if(error)throw error;await db.meta.delete(scope+':pushDisabledDevice');}
    if(!enabled(scope))return 'disabled';
    const status=await syncScope(repo,scope,{
      apply:async(op)=>{await assertScope();if(!enabled(scope))throw Error('Синхронизация выключена');const {data,error}=await client.rpc('lad_apply',{p_operation:op.operationId,p_id:op.entryId,p_base:op.baseRevision,p_payload:op.payload});if(error)throw error;return data;},
      pull:async(cursor)=>{await assertScope();const {data,error}=await client.from('lad_entries').select('payload').gt('change_seq',cursor).order('change_seq').limit(500);if(error)throw error;return(data??[]).map(r=>r.payload as Entry);}
    });
    await assertScope();
    const state=await repo.preferenceState(scope);
    if(state.dirty){const {error}=await client.from('lad_preferences').upsert({user_id:scope,payload:state.prefs,updated_at:new Date().toISOString()});if(error)throw error;await repo.ackPreferences(scope,state.revision);}
    else{const {data,error}=await client.from('lad_preferences').select('payload').eq('user_id',scope).maybeSingle();if(error)throw error;if(data?.payload)await repo.acceptPreferences(scope,data.payload as Preferences,state.revision);}
    const pending=await repo.pending(scope);const current=await repo.preferenceState(scope);
    const result=status==='synced'&&(pending.length||current.dirty)?'pending':status;
    if(result==='synced')await db.meta.put({key:scope+':lastSync',value:new Date().toISOString()});
    return result;
  })();
  locks.set(scope,task);try{return await task}finally{locks.delete(scope)}
}
export async function deleteAccountEntries(scope:string){await repo.queueDeleteAll(scope);await locks.get(scope)?.catch(()=>{});try{await syncCloud(scope)}catch{return false}return !await db.meta.get(scope+':deleteAll');}
export function authError(e:unknown){const message=e instanceof Error?e.message:String((e as {message?:string})?.message??e);if(/rate|security|seconds/i.test(message))return 'Слишком много попыток. Попробуй чуть позже.';if(/invalid|expired|token/i.test(message))return 'Код или ссылка недействительны. Запроси новое письмо.';if(/fetch|network/i.test(message))return 'Нет связи с облаком. Записи на устройстве сохранены.';return message;}
export async function verifyEmail(email:string,input:string){
  let args:{email:string;token:string;type:'email'}|{token_hash:string;type:'email'|'magiclink'|'signup'};
  if(/^\d{6,8}$/.test(input.trim()))args={email,token:input.trim(),type:'email'};
  else{let u:URL;try{u=new URL(input.trim())}catch{throw Error('Вставь код или полную ссылку из письма')};if(u.origin!==cloudUrl)throw Error('Это ссылка другого сервиса');const token=u.searchParams.get('token')??u.searchParams.get('token_hash');if(!token)throw Error('В ссылке нет кода подтверждения');const t=u.searchParams.get('type');args={token_hash:token,type:t==='signup'?'signup':t==='magiclink'?'magiclink':'email'};}
  const {error}=await supabase.auth.verifyOtp(args);if(error)throw error;
}
