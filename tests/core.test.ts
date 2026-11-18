import 'fake-indexeddb/auto';
import {describe,it,expect,beforeEach} from 'vitest';
import {dayMean,weekMean,weekStart,localDate,validateDraft,parseBackup,csvExport} from '../src/domain';
import {LadDB,Repository} from '../src/repository';
const draft=(mood=4,note='')=>({mood,note,occurredAt:'2026-11-17T14:00:00.000Z',localDate:'2026-11-17',timeZone:'Europe/Moscow'});
describe('statistics and validation',()=>{
 it('averages recorded days equally, ignores missing and deleted days',()=>{const rows=[{...draft(1),deletedAt:null},{...draft(5),deletedAt:null},{...draft(5),localDate:'2026-11-18',deletedAt:null},{...draft(1),deletedAt:'now'}];expect(dayMean(rows,'2026-11-17')).toBe(3);expect(weekMean(rows,'2026-11-16')).toBe(4);expect(weekMean([],'2026-11-16')).toBe(null)});
 it('starts weeks on Monday even Sunday and year boundary',()=>{expect(weekStart('2026-11-22')).toBe('2026-11-16');expect(weekStart('2027-01-01')).toBe('2026-12-28')});
 it('validates mood, note length, timestamp and local date',()=>{expect(()=>validateDraft(draft(6))).toThrow();expect(()=>validateDraft(draft(4,'x'.repeat(10001)))).toThrow();expect(()=>validateDraft({...draft(),localDate:'2026-02-30'})).toThrow();expect(()=>validateDraft({...draft(),occurredAt:'invalid'})).toThrow();expect(()=>validateDraft(draft(1))).not.toThrow()});
 it('exports multiline quotes safely and neutralizes spreadsheet formulas',()=>{const csv=csvExport([{...draft(4,'=SUM(1,2)\n"text"')}]);expect(csv).toContain("'=SUM");expect(csv).toContain('""text""')});
 it('rejects malformed backups before importing anything',()=>{expect(()=>parseBackup('{"entries":[{"mood":99}]}')).toThrow();expect(parseBackup(JSON.stringify({version:1,entries:[{...draft(),id:'00000000-0000-4000-8000-000000000021'}]}))).toHaveLength(1)});
 it('formats local dates without UTC day shifting',()=>{expect(localDate(new Date(2026,10,17,0,5))).toBe('2026-11-17')});
});
describe('durable repository and sync races',()=>{
 let db:LadDB;let repo:Repository;
 beforeEach(async()=>{db=new LadDB('test-'+crypto.randomUUID());repo=new Repository(db)});
 it('saves entry and outbox atomically and persists after reopening',async()=>{const e=await repo.save('guest',draft());expect(await db.outbox.count()).toBe(1);db.close();await db.open();expect((await repo.list('guest'))[0].id).toBe(e.id)});
 it('isolates scopes and coalesces unsent edits with stable base revision',async()=>{const e=await repo.save('a',draft());await repo.save('a',draft(5),e.id);expect(await repo.list('b')).toHaveLength(0);const ops=await db.outbox.toArray();expect(ops).toHaveLength(1);expect(ops[0].baseRevision).toBe(0);expect(ops[0].payload.mood).toBe(5)});
 it('acknowledges old flight without dropping a newer local edit',async()=>{const e=await repo.save('a',draft());const flight=(await repo.pending('a'))[0];await repo.save('a',draft(5,'new'),e.id);await repo.ack(flight,{...e,revision:1,changeSeq:1});expect((await repo.list('a'))[0].note).toBe('new');expect((await repo.pending('a'))[0].baseRevision).toBe(1)});
 it('preserves conflicts and never replaces a dirty local note on pull',async()=>{const e=await repo.save('a',draft(4,'local'));await repo.receive('a',{...e,note:'remote',revision:2,changeSeq:2});expect((await repo.list('a'))[0].note).toBe('local');expect(await db.conflicts.count()).toBe(1)});
 it('deletion queues a tombstone instead of removing the record',async()=>{const e=await repo.save('a',draft());await repo.remove('a',e.id);expect(await repo.list('a')).toHaveLength(0);expect((await repo.pending('a'))[0].payload.deletedAt).toBeTruthy()});
 it('local guest import is explicit, deduplicated and does not mutate guest entries',async()=>{await repo.save('guest',draft());expect(await repo.list('user')).toHaveLength(0);await repo.copyGuest('user');await repo.copyGuest('user');expect(await repo.list('user')).toHaveLength(1);expect(await repo.list('guest')).toHaveLength(1)});
});
