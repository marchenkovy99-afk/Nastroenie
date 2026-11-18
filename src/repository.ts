import Dexie, { type Table } from 'dexie';
import { type Draft, type Entry, type Operation, validateDraft, type Preferences, defaultPrefs, validatePreferences } from './domain';
export interface Conflict { key: string; scope: string; local: Entry; remote: Entry; operationId: string }
export interface PreferenceState { prefs: Preferences; revision: number; dirty: boolean }
export interface DeleteIntent {operationId:string;versions:Array<{id:string;operationId:string|null}>}
export class LadDB extends Dexie {
  entries!: Table<Entry, [string, string]>;
  outbox!: Table<Operation, string>;
  conflicts!: Table<Conflict, string>;
  meta!: Table<{ key: string; value: unknown }, string>;
  quarantine!: Table<Operation,string>;
  constructor(name = 'lad-journal-v1') {
    super(name);
    this.version(1).stores({ entries: '[scope+id],scope,localDate', outbox: 'key,scope', conflicts: 'key,scope', meta: 'key' });
    this.version(2).stores({quarantine:'key,scope'});
  }
}
const key = (scope: string, id: string) => scope + ':' + id;
export class Repository {
  constructor(public db: LadDB) {}
  async list(scope: string) {
    return (await this.db.entries.where('scope').equals(scope).toArray())
      .filter(e => !e.deletedAt).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
  async pending(scope: string) { return this.db.outbox.where('scope').equals(scope).toArray(); }
  async save(scope: string, draft: Draft, id: string = crypto.randomUUID()): Promise<Entry> {
    validateDraft(draft);
    return this.db.transaction('rw', this.db.entries, this.db.outbox, this.db.conflicts, async () => {
      const prev = await this.db.entries.get([scope, id]);
      const row: Entry = { ...draft, id, scope, revision: prev?.revision ?? 0, deletedAt: null };
      const old = await this.db.outbox.get(key(scope, id));
      const op: Operation = {key:key(scope,id),operationId:crypto.randomUUID(),scope,entryId:id,baseRevision:old?.baseRevision??row.revision,payload:row};
      await this.db.entries.put(row);
      await this.db.outbox.put(op);
      const conflict = await this.db.conflicts.get(op.key);
      if(conflict) await this.db.conflicts.put({...conflict,local:row,operationId:op.operationId});
      return row;
    });
  }
  async remove(scope:string,id:string) {
    return this.db.transaction('rw',this.db.entries,this.db.outbox,this.db.conflicts,async()=>{
      const row=await this.db.entries.get([scope,id]); if(!row)return;
      const conflict=await this.db.conflicts.get(key(scope,id));
      row.deletedAt=new Date().toISOString();
      if(conflict) row.revision=conflict.remote.revision;
      const old=await this.db.outbox.get(key(scope,id));
      await this.db.entries.put(row);
      await this.db.outbox.put({key:key(scope,id),operationId:crypto.randomUUID(),scope,entryId:id,baseRevision:conflict?.remote.revision??old?.baseRevision??row.revision,payload:row});
      await this.db.conflicts.delete(key(scope,id));
    });
  }
  async ack(op:Operation,server:Entry) {
    await this.db.transaction('rw',this.db.entries,this.db.outbox,async()=>{
      const current=await this.db.outbox.get(op.key);if(!current)return;
      if(current.operationId===op.operationId){await this.db.entries.put({...server,scope:op.scope});await this.db.outbox.delete(op.key);}
      else{const row=await this.db.entries.get([op.scope,op.entryId]);if(row)await this.db.entries.put({...row,revision:server.revision});await this.db.outbox.put({...current,baseRevision:server.revision,payload:{...current.payload,revision:server.revision}});}
    });
  }
  async receive(scope:string,server:Entry) {
    await this.db.transaction('rw',this.db.entries,this.db.outbox,this.db.conflicts,async()=>{
      const pending=await this.db.outbox.get(key(scope,server.id));
      const row={...server,scope};
      if(pending){if(server.revision>pending.baseRevision)await this.putConflict(pending,row);return;}
      const local=await this.db.entries.get([scope,server.id]);
      if(!local||server.revision>local.revision)await this.db.entries.put(row);
    });
  }
  private async putConflict(current:Operation,remote:Entry){
    const existing=await this.db.conflicts.get(current.key);
    const newest=existing&&existing.remote.revision>remote.revision?existing.remote:{...remote,scope:current.scope};
    await this.db.conflicts.put({key:current.key,scope:current.scope,local:current.payload,remote:newest,operationId:current.operationId});
  }
  async conflict(op:Operation,remote:Entry){
    await this.db.transaction('rw',this.db.outbox,this.db.conflicts,async()=>{
      const current=await this.db.outbox.get(op.key);
      if(current)await this.putConflict(current,remote);
    });
  }
  async resolve(c:Conflict,choice:'local'|'remote'|'both') {
    await this.db.transaction('rw',this.db.entries,this.db.outbox,this.db.conflicts,async()=>{
      const shown=await this.db.conflicts.get(c.key);const op=await this.db.outbox.get(c.key);
      if(!shown||!op||op.operationId!==c.operationId||shown.remote.revision!==c.remote.revision)throw Error('Запись изменилась. Сравни версии ещё раз.');
      if(choice==='remote'){await this.db.entries.put(shown.remote);await this.db.outbox.delete(c.key);}
      else{
        const row={...op.payload,revision:shown.remote.revision};
        await this.db.entries.put(row);
        await this.db.outbox.put({...op,operationId:crypto.randomUUID(),baseRevision:shown.remote.revision,payload:row});
        if(choice==='both'&&!shown.remote.deletedAt){const copy={...shown.remote,id:crypto.randomUUID(),revision:0};await this.db.entries.put(copy);await this.db.outbox.put({key:key(c.scope,copy.id),operationId:crypto.randomUUID(),scope:c.scope,entryId:copy.id,baseRevision:0,payload:copy});}
      }
      await this.db.conflicts.delete(c.key);
    });
  }
  async copyGuest(scope:string){for(const e of await this.list('guest'))if(!await this.db.entries.get([scope,e.id]))await this.save(scope,e,e.id);}
  async preferenceState(scope:string):Promise<PreferenceState>{
    const stored=(await this.db.meta.get(scope+':prefs'))?.value as PreferenceState|Preferences|undefined;
    if(stored&&'prefs' in stored)return stored;
    const oldDirty=await this.db.meta.get(scope+':prefsDirty');
    return {prefs:{...defaultPrefs,...stored},revision:0,dirty:!!oldDirty?.value};
  }
  async preferences(scope:string){return (await this.preferenceState(scope)).prefs;}
  async setPreferences(scope:string,prefs:Preferences){
    validatePreferences(prefs);
    await this.db.transaction('rw',this.db.meta,async()=>{const state=await this.preferenceState(scope);await this.db.meta.put({key:scope+':prefs',value:{prefs,revision:state.revision+1,dirty:true}});await this.db.meta.delete(scope+':prefsDirty');});
  }
  async ackPreferences(scope:string,revision:number){
    await this.db.transaction('rw',this.db.meta,async()=>{const state=await this.preferenceState(scope);if(state.revision===revision){await this.db.meta.put({key:scope+':prefs',value:{...state,dirty:false}});await this.db.meta.delete(scope+':prefsDirty');}});
  }
  async acceptPreferences(scope:string,prefs:Preferences,expectedRevision:number){
    validatePreferences(prefs);
    return this.db.transaction('rw',this.db.meta,async()=>{const state=await this.preferenceState(scope);if(state.dirty||state.revision!==expectedRevision)return false;await this.db.meta.put({key:scope+':prefs',value:{prefs,revision:state.revision+1,dirty:false}});return true;});
  }
  async quarantineOperation(op:Operation){await this.db.transaction('rw',this.db.outbox,this.db.quarantine,async()=>{const current=await this.db.outbox.get(op.key);if(current?.operationId!==op.operationId)return;await this.db.quarantine.put(op);await this.db.outbox.delete(op.key);});}
  async repairQuarantine(scope:string){await this.db.transaction('rw',this.db.entries,this.db.outbox,this.db.quarantine,async()=>{for(const op of await this.db.quarantine.where('scope').equals(scope).toArray()){const source=await this.db.entries.get([scope,op.entryId])??op.payload;const row={...source,id:crypto.randomUUID(),scope,revision:0};await this.db.entries.put(row);await this.db.outbox.put({key:key(scope,row.id),scope,entryId:row.id,operationId:crypto.randomUUID(),baseRevision:0,payload:row});await this.db.entries.delete([scope,op.entryId]);await this.db.quarantine.delete(op.key);}});}
  async queueDeleteAll(scope:string):Promise<DeleteIntent>{return this.db.transaction('rw',this.db.meta,this.db.entries,this.db.outbox,async()=>{const existing=await this.db.meta.get(scope+':deleteAll');if(existing)return existing.value as DeleteIntent;const operations=new Map((await this.pending(scope)).map(o=>[o.entryId,o.operationId]));const rows=await this.db.entries.where('scope').equals(scope).toArray();const intent={operationId:crypto.randomUUID(),versions:rows.map(e=>({id:e.id,operationId:operations.get(e.id)??null}))};await this.db.meta.put({key:scope+':deleteAll',value:intent});return intent;});}
  async ackDeleteAll(scope:string,operationId:string){await this.db.transaction('rw',[this.db.meta,this.db.entries,this.db.outbox,this.db.conflicts,this.db.quarantine],async()=>{const intent=(await this.db.meta.get(scope+':deleteAll'))?.value as DeleteIntent|undefined;if(!intent||intent.operationId!==operationId)return;for(const v of intent.versions){const pending=await this.db.outbox.get(key(scope,v.id));if((pending?.operationId??null)!==v.operationId)continue;await this.db.entries.delete([scope,v.id]);await this.db.outbox.delete(key(scope,v.id));await this.db.conflicts.delete(key(scope,v.id));await this.db.quarantine.delete(key(scope,v.id));}await this.db.meta.delete(scope+':deleteAll');await this.db.meta.delete(scope+':cursor');});}
  async clearScope(scope:string){await this.db.transaction('rw',[this.db.entries,this.db.outbox,this.db.conflicts,this.db.meta,this.db.quarantine],async()=>{await this.db.entries.where('scope').equals(scope).delete();await this.db.outbox.where('scope').equals(scope).delete();await this.db.conflicts.where('scope').equals(scope).delete();await this.db.quarantine.where('scope').equals(scope).delete();const keys=(await this.db.meta.toArray()).filter(m=>m.key.startsWith(scope+':')).map(m=>m.key);await this.db.meta.bulkDelete(keys);});}
}
export const db=new LadDB();export const repo=new Repository(db);
