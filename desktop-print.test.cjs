const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPrinterService,validateJob,printHTML}=require('./desktop-print.cjs');
const page={svg:'<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm"><defs><clipPath id="a"/></defs><g clip-path="url(#a)"/></svg>',paper:'A3',orientation:'landscape'};
function setup(failAt=Infinity){
 const calls=[],windows=[];
 class Window{
  constructor(options){this.options=options;windows.push(this);this.webContents={setWindowOpenHandler(){},on(){},print:(o,cb)=>{calls.push(o);cb(calls.length!==failAt,'printer failed');}};}
  async loadURL(url){this.url=url;}
  isDestroyed(){return !!this.destroyed;}
  destroy(){this.destroyed=true;}
 }
 return {calls,windows,service:createPrinterService({platform:'linux',BrowserWindow:Window,getPrinters:async()=>[{name:'device-id',displayName:'Office',isDefault:true}]})};
}
test('silent print sends selected printer, exact paper, copies in collated page order, cleans window',async()=>{
 const {service,calls,windows}=setup();
 assert.deepEqual(await service.list(),[{name:'device-id',displayName:'Office',isDefault:true}]);
 const result=await service.print({printerName:'device-id',copies:2,pages:[page,{...page,paper:'A4',orientation:'portrait'}]});
 assert.equal(result.submittedPages,4);assert.deepEqual(calls.map(c=>c.pageSize),['A3','A4','A3','A4']);
 for(const c of calls){assert.equal(c.silent,true);assert.equal(c.deviceName,'device-id');assert.equal(c.copies,1);assert.equal(c.margins.marginType,'none');}
 assert.equal(windows[0].options.show,false);assert.equal(windows[0].options.webPreferences.javascript,false);assert.equal(windows[0].destroyed,true);
});
test('unknown printer and unsafe SVG never reach physical print',async()=>{
 const {service,calls}=setup();
 await assert.rejects(service.print({...page,printerName:'missing'}),/프린터/);
 for(const svg of ['<svg><script>alert(1)</script></svg>','<svg onload="x()"/>','<svg><image href="file:///private"/></svg>','<svg><style>@import "https://x";</style></svg>']){
  assert.throws(()=>validateJob({...page,svg,printerName:'device-id'}));
 }
 assert.equal(calls.length,0);
});
test('validation rejects invalid copies/paper and print failure stops without retry',async()=>{
 for(const copies of [0,100,1.5,NaN])assert.throws(()=>validateJob({...page,printerName:'device-id',copies}));
 assert.throws(()=>validateJob({...page,printerName:'device-id',paper:'unknown'}));
 const {service,calls,windows}=setup(2);
 await assert.rejects(service.print({pages:[page,page,page],printerName:'device-id'}),/1장은 프린터로 전송/);
 assert.equal(calls.length,2);assert.equal(windows[0].destroyed,true);
});
test('output page is isolated with restrictive CSP and millimetre SVG',()=>{
 const html=printHTML(page);assert.match(html,/default-src 'none'/);assert.match(html,/@page\{size:A3 landscape;margin:0\}/);assert.match(html,/420mm/);
});
test('ordinary drawing text is not interpreted as SVG attributes',()=>{
 assert.doesNotThrow(()=>validateJob({...page,printerName:'device-id',svg:'<svg><text>ONLINE=1 href=note url(sample)</text></svg>'}));
});
test('stalled printer enumeration and page load expire and release busy state',async()=>{
 let hang=true,destroyed=0,printed=0;
 class Window{constructor(){this.webContents={setWindowOpenHandler(){},on(){},print:(_o,cb)=>{printed++;cb(true);}};}loadURL(){return hang?new Promise(()=>{}):Promise.resolve();}isDestroyed(){return false;}destroy(){destroyed++;}}
 const service=createPrinterService({platform:'linux',BrowserWindow:Window,getPrinters:async()=>[{name:'device-id'}],timeoutMs:10});
 await assert.rejects(service.print({...page,printerName:'device-id'}),/응답 시간/);
 assert.equal(destroyed,1);assert.equal(printed,0);hang=false;
 assert.equal((await service.print({...page,printerName:'device-id'})).submittedPages,1);
 let enumerate=true;
 const second=createPrinterService({platform:'linux',BrowserWindow:Window,getPrinters:()=>enumerate?new Promise(()=>{}):Promise.resolve([{name:'device-id'}]),timeoutMs:10});
 await assert.rejects(second.print({...page,printerName:'device-id'}),/응답 시간/);
 enumerate=false;assert.equal((await second.print({...page,printerName:'device-id'})).submittedPages,1);
});

function windowsSetup({print='ok',setError=false,restoreError=false,loadError=false,openError=false}={}){
 const events=[];
 class Window{
  constructor(){this.webContents={setWindowOpenHandler(){},on(){},print:(o,cb)=>{events.push('print '+o.pageSize);if(print==='throw')throw Error('driver threw');if(print!=='hang')cb(print==='ok','driver failed');}};}
  async loadURL(){if(loadError)throw Error('load failed');}
  isDestroyed(){return false;}destroy(){events.push('destroy');}
 }
 const service=createPrinterService({BrowserWindow:Window,getPrinters:async()=>[{name:'fake'}],platform:'win32',timeoutMs:10,createPrinterSettings:name=>{
  assert.equal(name,'fake');
  return {open:async()=>{events.push('open');if(openError)throw Error('open failed');},set:async(p,o)=>{events.push('set '+p+' '+o);if(setError)throw Error('A3 용지를 지원하지 않습니다.');},restore:async()=>{events.push('restore');if(restoreError)throw Error('restore failed');}};
 }});
 return {service,events};
}
test('Windows settings wrap mixed paper jobs and restore before returning',async()=>{
 const {service,events}=windowsSetup();
 assert.equal((await service.print({printerName:'fake',pages:[page,{...page,paper:'A4',orientation:'portrait'}]})).submittedPages,2);
 assert.deepEqual(events,['open','set A3 landscape','print A3','set A4 portrait','print A4','destroy','restore']);
});
test('Windows restores on print rejection, synchronous error, timeout, load and settings failure',async()=>{
 for(const options of [{print:'fail'},{print:'throw'},{print:'hang'},{setError:true},{loadError:true}]){
  const {service,events}=windowsSetup(options);
  await assert.rejects(service.print({...page,printerName:'fake'}));
  assert.equal(events.at(-1),'restore',JSON.stringify(options));
  assert.equal(events.filter(e=>e==='restore').length,1);
  if(options.setError||options.loadError)assert.ok(!events.some(e=>e.startsWith('print')));
 }
});
test('Windows restoration failure is surfaced and blocks subsequent printing',async()=>{
 const {service,events}=windowsSetup({restoreError:true});
 await assert.rejects(service.print({...page,printerName:'fake'}),/복원 실패/);
 await assert.rejects(service.print({...page,printerName:'fake'}),/다시 실행/);
 assert.equal(events.filter(e=>e.startsWith('print')).length,1);
});

test('Windows helper open failure falls back and does not block the next job',async()=>{
 const {service,events}=windowsSetup({openError:true,restoreError:true});
 for(let i=0;i<2;i++)assert.equal((await service.print({...page,printerName:'fake'})).submittedPages,1);
 assert.equal(events.filter(e=>e==='restore').length,2);
 assert.equal(events.filter(e=>e==='print A3').length,2);
 assert.ok(!events.some(e=>e.startsWith('set ')));
});

test('Windows restore failure before a successful set does not latch printing off',async()=>{
 const {service,events}=windowsSetup({setError:true,restoreError:true});
 for(let i=0;i<2;i++)await assert.rejects(service.print({...page,printerName:'fake'}),/복원 실패/);
 assert.equal(events.filter(e=>e==='open').length,2);
});
test('Windows helper ignores a late settings reply while waiting for restoration acknowledgement',async()=>{
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),{readFileSync}=require('node:fs'),vm=require('node:vm');
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
 const timers=[],requests=[];let input='';
 child.stdin.on('data',chunk=>{input+=chunk;let n;while((n=input.indexOf('\n'))>=0){const line=input.slice(0,n);input=input.slice(n+1);if(line.startsWith('{'))requests.push(JSON.parse(line));}});
 const context={module:{exports:{}},__dirname,process,Buffer,require:name=>name==='node:child_process'?{spawn:()=>child}:require(name),setTimeout:fn=>{timers.push(fn);return fn;},clearTimeout:()=>{}};
 vm.runInNewContext(readFileSync(require.resolve('./desktop-print-windows.cjs'),'utf8'),context);
 const settings=context.module.exports.createPrinterSettings('fake');
 const opening=settings.open();timers[0]();await assert.rejects(opening,/응답 시간/);
 let restored=false;
 const restoring=settings.restore().then(()=>{restored=true;});
 child.stdout.write(JSON.stringify({id:requests[0].id,ok:true})+'\n');
 await Promise.resolve();assert.equal(restored,false);
 child.stdout.write(JSON.stringify({id:requests[1].id,ok:true})+'\n');
 await restoring;assert.equal(restored,true);assert.equal(child.stdin.writableEnded,true);
 child.stdout.end();child.stderr.end();
});


test('embedded generated raster is printable; URLs, SVG images and extra attributes remain blocked',()=>{
 const raster='<image href="data:image/png;base64,AAAA" x="0" y="-100" width="200" height="100" preserveAspectRatio="none" opacity="0.6" transform="translate(10 -20) rotate(-30)"/>';
 const payload=tag=>({printerName:'virtual',...page,svg:page.svg.replace('</svg>',tag+'</svg>')});
 assert.doesNotThrow(()=>validateJob(payload(raster)));
 for(const unsafe of [raster.replace('data:image/png;base64,AAAA','https://example.com/image.png'),raster.replace('image/png','image/svg+xml'),raster.replace('/>',' onload="alert(1)"/>'),raster.replace('width="200"','width="200" style="filter:url(https://example.com)"')])assert.throws(()=>validateJob(payload(unsafe)));
});
