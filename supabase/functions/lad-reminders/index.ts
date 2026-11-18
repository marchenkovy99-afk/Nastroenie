import {createClient} from 'npm:@supabase/supabase-js@2.89.0';
import webpush from 'npm:web-push@3.6.7';
import {reminderSlot} from './reminder-time.ts';
const url=Deno.env.get('SUPABASE_URL')!;
const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const origin='https://lad-mood-journal.marchenkovy99.chatgpt.site';
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-lad-cron','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json'};
const answer=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
function allowedEndpoint(endpoint:string){try{const u=new URL(endpoint);return u.protocol==='https:'&&(u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname.endsWith('.push.apple.com')||u.hostname.endsWith('.notify.windows.com'))&&!u.username&&!u.password&&!u.port}catch{return false}}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 const action=new URL(req.url).searchParams.get('action');
 const {data:config,error:configError}=await db.from('lad_push_config').select('*').eq('id',1).single();
 if(configError)return answer({error:'Reminder service unavailable'},503);
 if(req.method==='GET'&&action==='public-key')return answer({publicKey:config.public_key});
 if(req.method!=='POST')return answer({error:'Method not allowed'},405);
 const token=req.headers.get('x-lad-cron')??'';
 const expected=config.cron_token;let mismatch=token.length^expected.length;for(let i=0;i<expected.length;i++)mismatch|=(token.charCodeAt(i)||0)^expected.charCodeAt(i);
 if(mismatch!==0)return answer({error:'Unauthorized'},401);
 webpush.setVapidDetails(origin,config.public_key,config.private_key);
 const {data:subscriptions,error}=await db.from('lad_push_subscriptions').select('user_id,device_id,subscription').limit(1000);
 if(error)return answer({error:'Storage unavailable'},503);
 if(!subscriptions?.length)return answer({checked:0,sent:0});
 const users=[...new Set(subscriptions.map(s=>s.user_id))];
 const {data:preferences,error:prefsError}=await db.from('lad_preferences').select('user_id,payload').in('user_id',users);
 if(prefsError)return answer({error:'Preferences unavailable'},503);
 const prefs=new Map(preferences?.map(p=>[p.user_id,p.payload]));
 let sent=0;let failed=0;
 for(const sub of subscriptions){
  const pref=prefs.get(sub.user_id);if(!pref?.reminders||!Array.isArray(pref.times)||!allowedEndpoint(sub.subscription?.endpoint))continue;
  const slot=reminderSlot(new Date(),pref.timeZone,pref.times);if(!slot)continue;
  const {data:claimed,error:claimError}=await db.rpc('lad_claim_push',{p_user:sub.user_id,p_device:sub.device_id,p_slot:slot});
  if(claimError||!claimed)continue;
  try{
   await webpush.sendNotification(sub.subscription,JSON.stringify({title:'Как ты сейчас?',body:'Остановись на минутку и отметь своё настроение.',tag:'lad-'+slot}),{TTL:300,timeout:8000});
   await db.from('lad_push_deliveries').update({status:'sent'}).eq('user_id',sub.user_id).eq('device_id',sub.device_id).eq('slot',slot);
   sent++;
  }catch(e){failed++;const code=(e as {statusCode?:number}).statusCode;
   if(code===404||code===410)await db.from('lad_push_subscriptions').delete().eq('user_id',sub.user_id).eq('device_id',sub.device_id);
   await db.from('lad_push_deliveries').delete().eq('user_id',sub.user_id).eq('device_id',sub.device_id).eq('slot',slot).eq('status','pending');
  }
 }
 return answer({checked:subscriptions.length,sent,failed});
});
