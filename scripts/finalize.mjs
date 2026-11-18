import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const files = (await readdir('dist', { recursive: true, withFileTypes: true }))
  .filter(file => file.isFile() && !['sw.js', '.gitkeep'].includes(file.name) && !file.name.endsWith('.map'))
  .map(file => file.parentPath.slice('dist'.length + 1).split(/[\\/]/).filter(Boolean).concat(file.name).join('/'))
  .sort();

const assets = await Promise.all(files.map(async file => {
  const bytes = await readFile('dist/' + file);
  return { file, integrity: 'sha256-' + createHash('sha256').update(bytes).digest('base64') };
}));
const version = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 12);

await writeFile('dist/sw.js', `const CACHE='lad-${version}';
const ROOT=self.registration.scope;
const INDEX=new URL('index.html', ROOT).href;
const ASSETS=${JSON.stringify(assets)};

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const requests = ASSETS.map(({file, integrity}) =>
      new Request(new URL(file, ROOT), {cache: 'reload', integrity})
    );
    await cache.addAll(requests);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Keep the previous release for pages still open during the update.
    const previous = (await caches.keys()).filter(key => key.startsWith('lad-') && key !== CACHE);
    await Promise.all(previous.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(ROOT)) return;
  const isShell = request.mode === 'navigate' && (!url.pathname.includes('.') || url.href === INDEX);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const current = await cache.match(isShell ? INDEX : request);
    if (current) return current;
    if (!isShell) {
      const previous = await caches.match(request);
      if (previous) return previous;
    }
    return fetch(request);
  })());
});
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch{}e.waitUntil(self.registration.showNotification(d.title||'Лад',{body:d.body||'Как ты сейчас? Найди минутку для себя.',icon:new URL('icon-192.png',ROOT).href,badge:new URL('icon-192.png',ROOT).href,tag:d.tag||'lad-reminder',data:{url:ROOT}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{if(list.length)return list[0].focus();return self.clients.openWindow(ROOT)}));});`);
