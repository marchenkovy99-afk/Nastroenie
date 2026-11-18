export interface Draft {mood:number; note:string; occurredAt:string; localDate:string; timeZone:string}
export interface Entry extends Draft {id:string;scope:string;revision:number;deletedAt:string|null;changeSeq?:number}
export interface Operation {key:string;operationId:string;scope:string;entryId:string;baseRevision:number;payload:Entry}
export interface Preferences {theme:'light'|'dark'|'system';times:string[];reminders:boolean;timeZone:string}
export const defaultPrefs:Preferences={theme:'system',times:['09:00','13:00','17:00','21:00'],reminders:false,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
export const moods = [
  { label: 'Очень плохо', color: '#768198' },
  { label: 'Плохо', color: '#9395A7' },
  { label: 'Нейтрально', color: '#B3B8C3' },
  { label: 'Хорошо', color: '#20DE4D' },
  { label: 'Очень хорошо', color: '#FFC400' },
];
export function localDate(d:Date){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export function addDays(d:string,n:number){const v=new Date(d+'T12:00:00');v.setDate(v.getDate()+n);return localDate(v)}
export function weekStart(d:string){const day=new Date(d+'T12:00:00').getDay();return addDays(d,-((day+6)%7))}
export function dayMean(rows:Pick<Entry,'mood'|'localDate'|'deletedAt'>[],date:string){const r=rows.filter(x=>!x.deletedAt&&x.localDate===date);return r.length?r.reduce((a,x)=>a+x.mood,0)/r.length:null}
export function weekMean(rows:Pick<Entry,'mood'|'localDate'|'deletedAt'>[],start:string){const r=Array.from({length:7},(_,i)=>dayMean(rows,addDays(start,i))).filter((n):n is number=>n!==null);return r.length?r.reduce((a,n)=>a+n,0)/r.length:null}
export function formatMean(n:number|null){return n===null?'Нет отметок':n.toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})}
export function validateDraft(d:Draft){if(!Number.isInteger(d.mood)||d.mood<1||d.mood>5)throw new Error('Выбери настроение от 1 до 5');if(typeof d.note!=='string'||d.note.length>10000)throw new Error('Заметка может содержать до 10 000 символов');if(!Number.isFinite(Date.parse(d.occurredAt)))throw new Error('Проверь время записи');if(!/^\d{4}-\d{2}-\d{2}$/.test(d.localDate)||new Date(d.localDate+'T12:00:00Z').toISOString().slice(0,10)!==d.localDate)throw new Error('Проверь дату');try{new Intl.DateTimeFormat('ru',{timeZone:d.timeZone})}catch{throw new Error('Неизвестный часовой пояс')}}
export function parseBackup(text:string):Array<Draft&{id:string}>{const data=JSON.parse(text);if(data.version!==1||!Array.isArray(data.entries)||data.entries.length>50000)throw new Error('Это не резервная копия Лада');return data.entries.map((e:Draft&{id:string})=>{validateDraft(e);if(typeof e.id!=='string'||!isUUID(e.id))throw new Error('В копии есть некорректный идентификатор записи');return {id:e.id,mood:e.mood,note:e.note,occurredAt:e.occurredAt,localDate:e.localDate,timeZone:e.timeZone}})}
export function csvExport(rows:Draft[]){const cell=(x:string)=>'"'+(/^[=+@\-\t\r]/.test(x)?"'"+x:x).replaceAll('"','""')+'"';return '\uFEFF'+['Дата,Время UTC,Настроение,Заметка',...rows.map(e=>[e.localDate,e.occurredAt,String(e.mood),e.note].map(cell).join(','))].join('\r\n')}
export function isUUID(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)}
export function validatePreferences(p:Preferences){if(!p||!['light','dark','system'].includes(p.theme)||typeof p.reminders!=='boolean'||!Array.isArray(p.times)||p.times.length!==4||!p.times.every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw Error('Проверь время напоминаний и тему');try{new Intl.DateTimeFormat('ru',{timeZone:p.timeZone})}catch{throw Error('Проверь часовой пояс')}}
