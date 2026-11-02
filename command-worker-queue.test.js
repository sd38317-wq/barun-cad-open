import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createCommandClient} from './command-runner.js';

function harness(t){
 const workers=[],timers=new Map();let clock=0,seq=0;
 const originals={Worker:globalThis.Worker,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 class FakeWorker{constructor(){this.messages=[];this.terminated=false;workers.push(this);}postMessage(message){this.messages.push(message);}terminate(){this.terminated=true;}send(data){this.onmessage({data});}}
 globalThis.Worker=FakeWorker;
 globalThis.setTimeout=(fn,delay)=>{const id=++seq;timers.set(id,{fn,at:clock+delay});return id;};
 globalThis.clearTimeout=id=>timers.delete(id);
 t.after(()=>Object.assign(globalThis,originals));
 return {workers,timers,tick(ms){clock+=ms;for(const [id,item] of [...timers])if(item.at<=clock){timers.delete(id);item.fn();}}};
}

test('queued short work cannot time out and terminate a running PLANSET',async t=>{
 const h=harness(t),client=createCommandClient({limitMs:60_000});
 const long=client.run({},'PLANSET',{}),short=client.run({},'D1',{});long.catch(()=>{});short.catch(()=>{});
 const worker=h.workers[0];worker.send({id:worker.messages[0].id,started:true});
 h.tick(60_001);
 assert.equal(worker.terminated,false);
 assert.equal(worker.messages.length,1);
 worker.send({id:worker.messages[0].id,result:{command:'PLANSET'}});assert.equal((await long).command,'PLANSET');
 assert.equal(worker.messages.length,2);worker.send({id:worker.messages[1].id,started:true});
 h.tick(59_999);assert.equal(worker.terminated,false);
 worker.send({id:worker.messages[1].id,result:{command:'D1'}});assert.equal((await short).command,'D1');
});

test('Worker loading and queued work consume no execution timeout',async t=>{
 const h=harness(t),client=createCommandClient({limitMs:20});const pending=client.run({},'D1',{});pending.catch(()=>{});
 h.tick(100);assert.equal(h.workers[0].terminated,false);assert.equal(h.timers.size,1,'only the separate start limit runs while loading');
 const id=h.workers[0].messages[0].id;h.workers[0].send({id,started:true});h.tick(19);assert.equal(h.workers[0].terminated,false);
 h.workers[0].send({id,result:{ok:true}});assert.deepEqual(await pending,{ok:true});
});

test('cancelling queued work does not kill active work or dispatch the cancelled request',async t=>{
 const h=harness(t),client=createCommandClient(),controller=new AbortController();
 const active=client.run({},'PLANSET',{}),queued=client.run({},'D1',{}, {signal:controller.signal});
 const rejected=assert.rejects(queued,/중지/);controller.abort();await rejected;
 assert.equal(h.workers[0].terminated,false);assert.equal(h.workers[0].messages.length,1);
 h.workers[0].send({id:h.workers[0].messages[0].id,result:{ok:true}});await active;assert.equal(h.workers[0].messages.length,1);
});

test('active timeout terminates only that work and queued work starts on a replacement Worker',async t=>{
 const h=harness(t),client=createCommandClient({limitMs:20});
 const active=client.run({},'D1',{}),queued=client.run({},'W1',{});const rejected=assert.rejects(active,/끝나지/);queued.catch(()=>{});
 h.workers[0].send({id:h.workers[0].messages[0].id,started:true});h.tick(21);await rejected;
 assert.equal(h.workers[0].terminated,true);assert.equal(h.workers.length,2);
 const next=h.workers[1];next.send({id:next.messages[0].id,started:true});next.send({id:next.messages[0].id,result:{ok:true}});
 assert.deepEqual(await queued,{ok:true});
});

test('cancelling active work leaves unrelated queued work runnable',async t=>{
 const h=harness(t),client=createCommandClient(),controller=new AbortController();
 const active=client.run({},'D1',{}, {signal:controller.signal}),queued=client.run({},'W1',{});const rejected=assert.rejects(active,/중지/);
 controller.abort();await rejected;assert.equal(h.workers[0].terminated,true);assert.equal(h.workers.length,2);
 const next=h.workers[1];next.send({id:next.messages[0].id,result:{ok:true}});assert.deepEqual(await queued,{ok:true});
});

test('one request generation abort cancels its whole queue without starting cancelled siblings',async t=>{
 const h=harness(t),client=createCommandClient(),controller=new AbortController();
 const promises=['D1','W1','D2'].map(name=>client.run({},name,{}, {signal:controller.signal}));
 const rejected=promises.map(p=>assert.rejects(p,/중지/));controller.abort();await Promise.all(rejected);
 assert.equal(h.workers.length,1);assert.equal(h.workers[0].messages.length,1);assert.equal(h.workers[0].terminated,true);
});

test('explicit client stop rejects active and queued work without starting a replacement',async t=>{
 const h=harness(t),client=createCommandClient();const active=client.run({},'D1',{}),queued=client.run({},'W1',{});
 const rejected=[active,queued].map(p=>assert.rejects(p,/중지/));client.stop();await Promise.all(rejected);
 assert.equal(h.workers.length,1);assert.equal(h.workers[0].messages.length,1);assert.equal(h.timers.size,0);
});

test('real Worker handler announces start only when the serialized job begins',async()=>{
 const source=await fs.readFile(new URL('./command-worker.js',import.meta.url),'utf8'),events=[];let finish;
 const first=new Promise(resolve=>{finish=resolve;});
 const self={postMessage:message=>events.push(message)};
 let vaultSource=null;
 let transport=null,imageTransport=null;
 vm.runInNewContext(source.replace("import {commandJob} from './command-runner.js';",'').replace("import {setImageTransport} from './image-underlay.js';",'').replace("import {setScreenVaultSource} from './screen-vault.js';",'').replace("import {setComputeTransport,ComputeError} from './compute-client.js';",''),{self,setImageTransport:fn=>{imageTransport=fn;},setScreenVaultSource:fn=>{vaultSource=fn;},Map,Promise,ComputeError:class extends Error{constructor(message,code){super(message);this.code=code;}},setComputeTransport:fn=>{transport=fn;},commandJob:async data=>{if(data.id===1)await first;return {id:data.id,result:true};}});
 // 서버 계산은 화면에 대신 묻는다: 지금 작업 번호를 달고 보내고, 화면 답(computeReply)으로 끝난다.
 const asked=transport('walls.detect',{document:{entities:[]}});const ask=events.pop();assert.equal(ask.compute.action,'walls.detect');
 self.onmessage({data:{computeReply:{call:ask.compute.call,error:{message:'로그인 필요',code:'not_logged_in'}}}});
 await assert.rejects(asked,e=>e.code==='not_logged_in'&&e.message==='로그인 필요');assert.deepEqual(events,[]);
 const imageRead=imageTransport({path:'C:/photo.png'}),imageAsk=events.pop();assert.equal(imageAsk.compute.action,'image.read');
 self.onmessage({data:{computeReply:{call:imageAsk.compute.call,result:{pixelWidth:20,pixelHeight:10}}}});assert.equal((await imageRead).pixelWidth,20);
 self.onmessage({data:{id:1}});self.onmessage({data:{id:2}});await new Promise(setImmediate);
 assert.deepEqual(events.map(e=>[e.id,e.started]),[[1,true]]);
 finish();await new Promise(setImmediate);
 assert.deepEqual(events.map(e=>[e.id,e.started]),[[1,true],[1,undefined],[2,true],[2,undefined]]);
 // 잠근 화면 코드: Worker 는 화면 스레드에 한 번만 묻고(겹친 요청은 같은 답을 기다림), 잠김 오류도 그대로 받는다.
 events.length=0;const a=vaultSource(),b=vaultSource();
 assert.equal(JSON.stringify(events),'[{"vault":true}]');
 self.onmessage({data:{vault:{bundle:{order:['x.js'],files:{'x.js':''}}}}});
 assert.equal((await a).order[0],'x.js');assert.equal(await b,await a);
 const c=vaultSource();self.onmessage({data:{vault:{error:'로그인하면 상세·도면 생성을 쓸 수 있어요.'}}});
 await assert.rejects(c,error=>error.code==='screen_locked'&&/로그인하면/.test(error.message));
});

test('a Worker that never reports started is stopped after the start limit and queued work still runs',async t=>{
 // 예전: 실행 상한은 started 뒤부터라, 시작 못 한 Worker 는 이 작업과 뒤에 줄 선 작업(AI 도면 생성 등)을 끝없이 붙잡았다.
 const h=harness(t),client=createCommandClient({limitMs:60_000,startLimitMs:120_000});
 const stuck=client.run({},'PLANSET',{}),next=client.run({},'D1',{});let error=null;stuck.catch(e=>{error=e;});next.catch(()=>{});
 h.tick(119_999);assert.equal(h.workers[0].terminated,false);
 h.tick(2);await Promise.resolve();assert.equal(h.workers[0].terminated,true);await stuck.catch(()=>{});assert.match(error.message,/시작하지 못해/);
 const fresh=h.workers[1];assert.ok(fresh,'queued work moves to a fresh Worker');fresh.send({id:fresh.messages[0].id,started:true});
 fresh.send({id:fresh.messages[0].id,result:{command:'D1'}});assert.equal((await next).command,'D1');
});

test('one job that throws in the real Worker handler does not stop every later job',async()=>{
 // 예전: chain 에 catch 가 없어 한 번 던지면 이 Worker 의 다음 작업이 started 도 못 보내고 영영 멈췄다.
 const source=await fs.readFile(new URL('./command-worker.js',import.meta.url),'utf8'),events=[];
 const self={postMessage:message=>{if(message?.result==='uncloneable')throw new Error('DataCloneError');events.push(message);}};
 vm.runInNewContext(source.replace("import {commandJob} from './command-runner.js';",'').replace("import {setImageTransport} from './image-underlay.js';",'').replace("import {setScreenVaultSource} from './screen-vault.js';",'').replace("import {setComputeTransport,ComputeError} from './compute-client.js';",''),
  {self,Map,Promise,Error,String,setImageTransport:()=>{},setScreenVaultSource:()=>{},setComputeTransport:()=>{},ComputeError:class extends Error{},
   commandJob:async data=>data.id===1?{id:1,result:'uncloneable'}:{id:data.id,result:{ok:data.id}}});
 self.onmessage({data:{id:1}});self.onmessage({data:{id:2}});await new Promise(setImmediate);await new Promise(setImmediate);
 assert.deepEqual(events.map(e=>[e.id,e.started??null,e.error?'error':null,e.result?.ok??null]),[[1,true,null,null],[1,null,'error',null],[2,true,null,null],[2,null,null,2]]);
});
