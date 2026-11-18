import {it,expect} from 'vitest';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {execFileSync} from 'node:child_process';import {runInNewContext} from 'node:vm';
it('serves a version-matched cached shell even when network has a newer build',async()=>{const tmp=mkdtempSync(join(tmpdir(),'lad-sw-'));try{mkdirSync(join(tmp,'dist'));writeFileSync(join(tmp,'dist/index.html'),'version-one');execFileSync(process.execPath,[resolve('scripts/finalize.mjs')],{cwd:tmp});const handlers:any={};let network=0;let response:Promise<string>|undefined;runInNewContext(readFileSync(join(tmp,'dist/sw.js'),'utf8'),{URL,self:{location:{origin:'https://lad.test'},registration:{scope:'https://lad.test/lad/'},addEventListener:(name:string,fn:any)=>handlers[name]=fn},caches:{match:async()=> 'cached-shell',open:async()=>({match:async()=> 'cached-shell'})},fetch:async()=>{network++;return 'new-network-shell'}});handlers.fetch({request:{url:'https://lad.test/lad/',method:'GET',mode:'navigate'},respondWith:(p:Promise<string>)=>response=p});expect(await response).toBe('cached-shell');expect(network).toBe(0)}finally{rmSync(tmp,{recursive:true,force:true})}});

it('activates an update as soon as its complete offline cache is ready', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lad-update-'));
  try {
    mkdirSync(join(tmp, 'dist'));
    writeFileSync(join(tmp, 'dist/index.html'), 'new release');
    execFileSync(process.execPath, [resolve('scripts/finalize.mjs')], { cwd: tmp });

    type Handler = (event: { waitUntil: (promise: Promise<void>) => void }) => void;
    const handlers = new Map<string, Handler>();
    let finishCaching!: () => void;
    let cachedRequests: Request[] = [];
    let activations = 0;
    const cacheReady = new Promise<void>(resolve => { finishCaching = resolve; });
    runInNewContext(readFileSync(join(tmp, 'dist/sw.js'), 'utf8'), {
      URL,
      Request,
      self: {
        registration: { scope: 'https://lad.test/lad/' },
        addEventListener: (name: string, fn: Handler) => handlers.set(name, fn),
        skipWaiting: async () => { activations++; },
      },
      caches: { open: async () => ({
        addAll: (requests: Request[]) => { cachedRequests = requests; return cacheReady; },
      }) },
    });

    let installation!: Promise<void>;
    handlers.get('install')!({ waitUntil: p => { installation = p; } });
    await Promise.resolve();
    expect(activations).toBe(0);
    finishCaching();
    await installation;
    expect(activations).toBe(1);
    expect(cachedRequests[0]).toMatchObject({
      url: 'https://lad.test/lad/index.html',
      cache: 'reload',
      integrity: expect.stringMatching(/^sha256-/),
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
