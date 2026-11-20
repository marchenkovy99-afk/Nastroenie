// @vitest-environment jsdom
import 'fake-indexeddb/auto';import {act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect,vi} from 'vitest';
const auth = vi.hoisted(() => ({
 handler: undefined as undefined | ((event: string, session: any) => void),
 session: { user: { id: 'account-a', email: 'a@example.invalid' } } as { user: { id: string; email: string } } | null,
 password: vi.fn(),
 otp: vi.fn(),
}));
vi.mock('../src/cloud',()=>({supabase:{auth:{getSession:async()=>({data:{session:auth.session}}),signInWithPassword:auth.password,signInWithOtp:auth.otp,onAuthStateChange:(fn:any)=>{auth.handler=fn;return {data:{subscription:{unsubscribe(){}}}}}}},enabled:()=>false,syncCloud:async()=> 'disabled',setEnabled:()=>{},authError:(e:any)=>String(e),verifyEmail:async()=>{},deleteAccountEntries:async()=>true}));
vi.mock('../src/reminders',()=>({checkPush:async()=>false,enablePush:async()=>{},disablePush:async()=>{}}));
import App from '../src/App';import {db,repo} from '../src/repository';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
HTMLElement.prototype.scrollTo=function(){};
(globalThis as any).ResizeObserver=class {observe(){}disconnect(){}};
async function until(check:()=>boolean){for(let i=0;i<60;i++){await act(async()=>{await new Promise(r=>setTimeout(r,5))});if(check())return}throw Error('UI did not settle')}
it('switching account never renders previous private note while next account query is pending',async()=>{
 await db.entries.clear();await db.outbox.clear();await repo.save('account-a',{mood:4,note:'PRIVATE NOTE ACCOUNT A',occurredAt:new Date().toISOString(),localDate:new Date().toLocaleDateString('en-CA'),timeZone:'UTC'});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(<App/>));await until(()=>!!host.querySelector('nav'));
 await act(async()=>Array.from(host.querySelectorAll('nav button')).find(b=>b.textContent?.includes('История'))!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
 await until(()=>host.textContent!.includes('PRIVATE NOTE ACCOUNT A'));
 const original=repo.list.bind(repo);const spy=vi.spyOn(repo,'list').mockImplementation(scope=>scope==='account-b'?new Promise(()=>{}):original(scope));
 await act(async()=>auth.handler?.('SIGNED_IN',{user:{id:'account-b',email:'b@example.invalid'}}));
 expect(host.textContent).not.toContain('PRIVATE NOTE ACCOUNT A');
 spy.mockRestore();await act(async()=>root.unmount());host.remove();
});

it('save feedback never clears a fresh mood selection',async()=>{
 const {EntryScreen}=await import('../src/App');vi.useFakeTimers({toFake:['setTimeout','clearTimeout'],shouldAdvanceTime:true});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(<EntryScreen scope="guest" entries={[]} onSaved={()=>{}} onError={()=>{}} onHistory={()=>{}}/>));
 const click=(label:string)=>{const el=Array.from(host.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===label||b.textContent===label)!;el.dispatchEvent(new MouseEvent('click',{bubbles:true}));};
 await act(async()=>click('4 — Хорошо'));await act(async()=>click('Сохранить'));await until(()=>host.textContent!.includes('Сохранено'));await act(async()=>click('1 — Очень плохо'));
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});expect(host.querySelector('[aria-label="1 — Очень плохо"]')?.getAttribute('aria-pressed')).toBe('true');
 }finally{await act(async()=>root.unmount());host.remove();vi.useRealTimers()}
});
it('untouched date defaults refresh before save after midnight',async()=>{
 const {EntryScreen}=await import('../src/App');await db.entries.where('scope').equals('guest').delete();vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout'],shouldAdvanceTime:true});vi.setSystemTime(new Date('2026-11-17T23:58:00'));
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(<EntryScreen scope="guest" entries={[]} onSaved={()=>{}} onError={()=>{}} onHistory={()=>{}}/>));
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="4 — Хорошо"]')!.click());vi.setSystemTime(new Date('2026-11-18T00:03:00'));
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Сохранить')!.click());await until(()=>host.textContent!.includes('Сохранено'));expect((await repo.list('guest'))[0].localDate).toBe('2026-11-18');
 }finally{await act(async()=>root.unmount());host.remove();vi.useRealTimers()}
});

it('offers existing accounts a direct password login without sending a code', async () => {
 const previous = auth.session;
 auth.session = null;
 auth.password.mockResolvedValue({ error: null });
 auth.otp.mockClear();
 const host = document.createElement('div');
 document.body.append(host);
 const root = createRoot(host);
 const click = (label: string) => Array.from(host.querySelectorAll('button'))
   .find(b => b.textContent?.startsWith(label))!.click();
 const fill = (selector: string, value: string) => {
   const input = host.querySelector<HTMLInputElement>(selector)!;
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
   input.dispatchEvent(new Event('input', { bubbles: true }));
 };
 try {
   await act(async () => root.render(<App/>));
   await until(() => !!host.querySelector('nav'));
   await act(async () => click('Настройки'));
   await act(async () => click('Синхронизация'));
   expect(host.querySelector('input[type=password]')).not.toBeNull();
   await act(async () => {
     fill('input[type=email]', 'existing@example.invalid');
     fill('input[type=password]', 'test-password');
   });
   await act(async () => click('Войти'));
   expect(auth.password).toHaveBeenCalledWith({ email: 'existing@example.invalid', password: 'test-password' });
   expect(auth.otp).not.toHaveBeenCalled();
 } finally {
   auth.session = previous;
   await act(async () => root.unmount());
   host.remove();
 }
});
