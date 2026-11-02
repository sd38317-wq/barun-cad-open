const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createSharedSettings,PER_WINDOW}=require('./desktop-shared-settings.cjs');

const memoryFs=(initial)=>{const files=new Map(initial?[['s.json',initial]]:[]);return {files,readFileSync:f=>{if(!files.has(f))throw Object.assign(Error('ENOENT'),{code:'ENOENT'});return files.get(f);},writeFileSync:(f,d)=>files.set(f,d),renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);}};};

test('first run: only the seeding (slot 1) view gets null, then its settings fill the store without per-window keys', ()=>{
 const fsImpl=memoryFs(),shared=createSharedSettings({file:'s.json',fsImpl,delayMs:0});
 assert.deepEqual(shared.snapshot({seeding:false}),{});
 assert.equal(shared.snapshot({seeding:true}),null);
 assert.equal(shared.seed({'barun-com-shortcuts':'{"L":"LINE"}','barun-cad-recovery-v2':'big','barun-cad-clean-exit':'1','barun-pad-sessions-v1':'[]'}),true);
 assert.deepEqual(shared.snapshot(),{'barun-com-shortcuts':'{"L":"LINE"}','barun-pad-sessions-v1':'[]'});
 assert.equal(shared.seed({'barun-snap-angle':'15'}),false,'seeds only once');
 shared.flush();
 assert.deepEqual(JSON.parse(fsImpl.files.get('s.json')),{'barun-com-shortcuts':'{"L":"LINE"}','barun-pad-sessions-v1':'[]'});
});

test('set reports only real changes and ignores per-window or malformed keys', ()=>{
 const shared=createSharedSettings({file:'s.json',fsImpl:memoryFs('{"a":"1"}'),delayMs:0});
 assert.equal(shared.set('a','1'),false);
 assert.equal(shared.set('a','2'),true);
 assert.equal(shared.set('a',null),true);
 assert.equal(shared.set('a',null),false);
 assert.equal(shared.set('barun-cad-recovery-v2','x'),false);
 assert.equal(shared.set('',  'x'),false);
 assert.equal(shared.set('b',5),false);
 assert.equal(shared.set('x'.repeat(201),'x'),false);
 assert.deepEqual(shared.snapshot(),{});
});

test('a broken settings file starts empty instead of crashing', ()=>{
 const shared=createSharedSettings({file:'s.json',fsImpl:memoryFs('[1,2]'),delayMs:0});
 assert.equal(shared.snapshot({seeding:true}),null);
});

test('preload keeps the same per-window key pattern (sandboxed preload cannot require the module)', ()=>{
 const preload=fs.readFileSync(path.join(__dirname,'desktop-preload.cjs'),'utf8');
 const found=preload.match(/const PER_WINDOW=\/(.+)\/;/);
 assert.ok(found,'PER_WINDOW in preload');
 assert.equal(found[1],PER_WINDOW.source);
});
