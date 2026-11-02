import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DrawingEngine} from './engine.js';
import {installImageCommands} from './image-commands.js';
import {loadImageSource} from './image-underlay.js';
import {connectBridge,createDocumentRequestHandler} from './bridge-client.js';
import {createChunkedRecoveryAdapter} from './recovery-chunks.js';

const photo={id:'photo',type:'image',layer:'0',data:'data:image/png;base64,'+'A'.repeat(200000),path:'C:/photo.png',pixelWidth:200,pixelHeight:100,position:{x:0,y:0},width:200,height:100};

test('file dialog attachment keeps the Electron file path without file.path',async()=>{
 const original={window:globalThis.window,FileReader:globalThis.FileReader,Image:globalThis.Image};
 const engine=new DrawingEngine(),file={size:10};let picked;
 globalThis.window={cadDesktop:{filePath:f=>{assert.equal(f,file);return photo.path;}}};
 globalThis.FileReader=class{readAsDataURL(){this.result=photo.data;this.onload();}};
 globalThis.Image=class{naturalWidth=200;naturalHeight=100;set src(value){this.onload();}};
 try{
  const commands=installImageCommands({doc:()=>engine.doc,execute:c=>engine.execute(c),pickFiles:(_ext,_multi,fn)=>picked=fn,
   pickPoint:async()=>({x:0,y:0}),form:(_title,_fields,fn)=>fn({width:200})});
  commands.IMAGEATTACH();await picked([file]);
  assert.equal(engine.doc.entities[0].path,photo.path);
 }finally{Object.assign(globalThis,original);}
});

test('browser rejects images above 25 million pixels and accepts the boundary',async()=>{
 const original=globalThis.Image;let width=5000;
 globalThis.Image=class{naturalWidth=width;naturalHeight=5000;set src(value){this.onload();}};
 try{
  assert.equal((await loadImageSource({data:'data:image/png;base64,AAAA'})).pixelWidth,5000);
  width=5001;await assert.rejects(loadImageSource({data:'data:image/png;base64,AAAA'}),/too large/);
 }finally{globalThis.Image=original;}
});

test('image data does not consume selection or window query detail budgets',()=>{
 const line={id:'line',type:'line',layer:'0',points:[{x:0,y:0},{x:10,y:10}]};
 const doc={entities:[photo,line],layers:[{id:'0',name:'0'}]},handler=createDocumentRequestHandler({engine:{doc},selected:()=>new Set(['photo','line'])},{assert(){}});
 for(const mode of ['selection','window']){
  const reply=handler({id:crypto.randomUUID(),expires_at:Date.now()+20000,args:{target:{revision:0},mode,...(mode==='window'?{window:{x0:-1,y0:-1,x1:201,y1:101}}:{})}});
  assert.equal(reply.error,undefined);assert.equal(reply.result.truncated,false);
  assert.equal(reply.result.document.entities[0].hasData,true);assert.equal(reply.result.document.entities[0].data,undefined);
  assert.deepEqual(reply.result.document.entities[1],line);
 }
 assert.ok(photo.data);
});

test('heartbeat strips nested image bytes before cloning and preserves the source',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout,structuredClone:globalThis.structuredClone};let payload;
 globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=()=>{};
 globalThis.structuredClone=value=>{assert.ok(!JSON.stringify(value).includes(photo.data));return original.structuredClone(value);};
 const doc={entities:[photo,{id:'block',type:'block',entities:[photo]}],sharedBlocks:{ref:{entities:[photo]}}};
 try{
  connectBridge({context:{engine:{doc,onChange(){}},selected:()=>new Set(),getCommandSettings:()=>({})},getFolder:()=>'',api:async(name,body)=>{if(name==='bridge')payload=body;return {requests:[]};}});
  await Promise.resolve();await Promise.resolve();
  assert.ok(payload);assert.ok(!JSON.stringify(payload.document).includes(photo.data));
  assert.equal(payload.document.sharedBlocks.ref.entities[0].hasData,true);assert.equal(doc.entities[0].data,photo.data);
 }finally{Object.assign(globalThis,original);}
});

test('image rendering presence is scanned once per drawing revision without calling visible()',()=>{
 const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('let imagePresenceDoc='),source.indexOf('const imageRenderer='));
 let scans=0;const entities=()=>({some:fn=>{scans++;return [].some(fn);}});
 const context=vm.createContext({sceneRevision:0,engine:{doc:{entities:entities()}},visible:()=>assert.fail('visible() must not be called')});
 vm.runInContext(code,context);
 assert.equal(vm.runInContext('hasImages()',context),false);assert.equal(vm.runInContext('hasImages()',context),false);assert.equal(scans,1);
 context.sceneRevision++;context.engine.doc.entities=[photo];assert.equal(vm.runInContext('hasImages()',context),true);
 context.engine.doc={entities:[]};assert.equal(vm.runInContext('hasImages()',context),false,'new document rescans');
 assert.equal((source.match(/if\(hasImages\(\)\)imageRenderer.draw/g)||[]).length,2);
});

test('printer helper resets the request before parsing and has no inspect API',()=>{
 const source=readFileSync(new URL('./desktop-print-windows.ps1',import.meta.url),'utf8');
 assert.match(source,/while \(\$true\) \{\r?\n  \$cmd = \$null/);
 assert.ok(!source.includes('Inspect('));assert.ok(!source.includes("'inspect'"));
 const client=readFileSync(new URL('./desktop-print-windows.cjs',import.meta.url),'utf8');assert.ok(!client.includes("request('inspect')"));
});

test('local workspace recovery retains image bytes after bridge synchronization',async()=>{
 const values=new Map();
 const adapter=createChunkedRecoveryAdapter({get:async key=>structuredClone(values.get(key)),keys:async()=>[...values.keys()],
  put:async(key,value)=>{if(value===undefined)values.delete(key);else values.set(key,structuredClone(value));}},
 {maxRecordBytes:4096,yield:async()=>{},lock:operation=>operation()});
 const workspace={version:1,savedAt:1,activeId:'tab',tabs:[{id:'tab',name:'Drawing',dirty:true,doc:{layers:[],entities:[photo]}}]};
 await adapter.put('current',workspace);
 assert.deepEqual(await adapter.get('current'),workspace);
});
