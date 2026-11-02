// BARUN_SITE_PLAN_MOCK=1 node tools/check-site-plan-wait.mjs
// Start python server.py --port 8852 --no-browser with the same flag first.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),base='http://127.0.0.1:8852',out=path.resolve('tmp/site-wait2');
if(process.env.BARUN_SITE_PLAN_MOCK!=='1')throw Error('Use an explicitly enabled development mock server.');
const home=process.env.USERPROFILE;
const pw=require(process.env.PLAYWRIGHT_MODULE||path.join(home,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const raw=JSON.parse(await fs.readFile('test-fixtures/site-plan-v053/demo_site_north_road.json','utf8'));
const request={site:raw.site,zoning:{...raw.zoning,zone:'개발 예시 지역',bcr:60,far:200},program:raw.program};
await fs.mkdir(out,{recursive:true});
const browserServer=await pw.chromium.launchServer({headless:true});
const browser=await pw.chromium.connect(browserServer.wsEndpoint());
const report={};
async function setup(enabled=true){
 const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 await context.addInitScript(enabled=>{localStorage.clear();localStorage.setItem('barun.aiDrawReveal',enabled?'1':'0');localStorage.setItem('barun-ai-sidebar','false');},enabled);
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/app.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__siteTest={studio,engine,execute,reveal:()=>({active:!!aiReveal,clusters:aiReveal?.plan.clusters.length,progress:aiReveal?.player.progress})};'});});
 await page.goto(base,{waitUntil:'commit',timeout:20000});await page.waitForFunction(()=>window.__siteTest,null,{timeout:90000});
 // Fixture injection only in this isolated page. MCP requires a signed-in account;
 // no account state or authentication check is changed by this smoke check.
 await page.evaluate(req=>{const t=window.__siteTest;t.execute({type:'load',document:new t.engine.constructor().doc});t.execute({type:'add',entity:{type:'polyline',closed:true,layer:t.engine.doc.layers[0].id,points:[{x:0,y:0},{x:15000,y:0},{x:15000,y:20000},{x:0,y:20000}]}});t.execute({type:'document.update',changes:{sitePlanInput:req}});},request);
 return {context,page,errors};
}
try{
 if(!process.argv.includes('--extra-only')){
 const {context,page,errors}=await setup();
 let submitCount=0,releaseStart,releaseResult,atResult=false;
 const startGate=new Promise(r=>releaseStart=r),resultGate=new Promise(r=>releaseResult=r);
 await page.route('**/api/site-plan/jobs',async route=>{
  const body=route.request().postDataJSON();if(body.action==='submit'){submitCount++;if(submitCount===1)await startGate;}
  const response=await route.fetch(),job=await response.json();
  if(submitCount===3&&job.status==='succeeded'){atResult=true;await resultGate;}
  await route.fulfill({response});
 });
 const capture=async name=>{
  for(const [size,viewport]of Object.entries({wide:{width:1440,height:1000},narrow:{width:620,height:900}})){
   await page.setViewportSize(viewport);await page.waitForTimeout(80);
   const layout=await page.locator('.site-plan-wait').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,minFont:Math.min(...[...e.querySelectorAll('p,figcaption,dt,dd,small,li,button')].map(n=>parseFloat(getComputedStyle(n).fontSize))),background:getComputedStyle(e).backgroundImage,blur:getComputedStyle(e,'::backdrop').backdropFilter,height:e.clientHeight,scrollHeight:e.scrollHeight,leadFont:getComputedStyle(e.querySelector('.site-plan-wait__lead')).fontSize,titleFont:getComputedStyle(e.querySelector('h2')).fontSize,stats:e.querySelectorAll('.site-plan-wait__stat').length}));
   assert.equal(layout.scroll,layout.width);assert.ok(layout.minFont>=12);assert.equal(layout.background,'none');assert.equal(layout.blur,'none');assert.equal(layout.stats,3);assert.equal(layout.scrollHeight,layout.height);report[name+'-'+size]=layout;
   await page.screenshot({path:path.join(out,name+'-'+size+'.png')});
  }
  await page.setViewportSize({width:1440,height:1000});
 };
 await page.evaluate(()=>{window.__before=structuredClone(window.__siteTest.engine.doc);window.__samples=[];window.__timer=setInterval(()=>window.__samples.push(window.__siteTest.reveal()),80);window.__siteTest.studio.context.sitePlanOpen();});
 await page.getByRole('button',{name:'계획 3안 생성',exact:true}).click();await page.locator('.site-plan-wait').waitFor();
 await capture('wait-early');releaseStart();
 await page.waitForFunction(()=>document.querySelector('.site-plan-wait__status')?.textContent.includes('대지 계산 중'),null,{timeout:20000});await capture('wait-search');
 await page.waitForFunction(()=>document.querySelector('.site-plan-wait__status')?.textContent.includes('안 3/3'),null,{timeout:30000});
 await page.waitForFunction(()=>document.querySelector('.site-plan-wait__facts')?.textContent.includes('실제 결과 수치'));await capture('wait-before-result');
 // Gate only the development response so both viewport captures inspect the same state.
 const deadline=Date.now()+15000;while(!atResult&&Date.now()<deadline)await page.waitForTimeout(100);assert.ok(atResult);releaseResult();
 await page.waitForFunction(()=>window.__samples.some(s=>s.active&&s.clusters===3&&s.progress>0),null,{timeout:40000});
 await page.screenshot({path:path.join(out,'result-drawing-wide.png')});
 await page.waitForFunction(()=>!window.__siteTest.reveal().active,null,{timeout:20000});
 await page.screenshot({path:path.join(out,'result-wide.png')});await page.setViewportSize({width:620,height:900});await page.screenshot({path:path.join(out,'result-narrow.png')});await page.setViewportSize({width:1440,height:1000});
 await page.unroute('**/api/site-plan/jobs');
 const success=await page.evaluate(()=>{clearInterval(window.__timer);const t=window.__siteTest;return {before:window.__before,after:structuredClone(t.engine.doc),samples:window.__samples};});
 assert.deepEqual(success.after.entities[0],success.before.entities[0]);assert.equal(success.after.sitePlanAlternatives.length,3);assert.ok(success.samples.some(s=>s.progress>0));report.reveal={clusters:Math.max(...success.samples.filter(s=>s.active).map(s=>s.clusters||0)),samples:success.samples.filter(s=>s.active).length};
 const beforeCancel=await page.evaluate(()=>JSON.stringify(window.__siteTest.engine.doc));
 await page.evaluate(()=>window.__siteTest.studio.context.sitePlanOpen());await page.getByRole('button',{name:'계획 3안 생성',exact:true}).click();await page.locator('.site-plan-wait').waitFor();await page.locator('.site-plan-wait').getByRole('button',{name:'생성 취소',exact:true}).click();await page.locator('.site-plan-wait').waitFor({state:'detached'});
 await page.waitForTimeout(6500);assert.equal(await page.evaluate(()=>JSON.stringify(window.__siteTest.engine.doc)),beforeCancel);report.cancel=true;console.log('취소 확인');
 await page.route('**/api/site-plan/jobs',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'개발 검증 오류'})}));
 await page.getByRole('button',{name:'계획 3안 생성',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#site-plan-dialog')?.innerText.includes('개발 검증 오류'));assert.equal(await page.locator('.site-plan-wait').count(),0);assert.equal(await page.evaluate(()=>JSON.stringify(window.__siteTest.engine.doc)),beforeCancel);report.error=true;
 await page.unroute('**/api/site-plan/jobs');
 // One undo removes the entire result, independently of the presentation clock.
 await page.evaluate(()=>{document.querySelector('#site-plan-dialog').close();window.__siteTest.execute({type:'undo'});});assert.equal(await page.evaluate(()=>window.__siteTest.engine.doc.entities.length),1);report.oneUndo=true;
 assert.deepEqual(errors,[]);await context.close();
 const disabled=await setup(false);await disabled.page.evaluate(()=>window.__siteTest.studio.context.sitePlanOpen());await disabled.page.getByRole('button',{name:'계획 3안 생성',exact:true}).click();await disabled.page.getByRole('button',{name:'생성 취소',exact:true}).waitFor();assert.equal(await disabled.page.locator('.site-plan-wait').count(),0);await disabled.page.getByRole('button',{name:'생성 취소',exact:true}).click();assert.equal(await disabled.page.evaluate(()=>window.__siteTest.engine.doc.entities.length),1);report.disabled=true;console.log('기본 흐름 확인');await disabled.context.close();
 }
 const checks=await setup(),p=checks.page;
 const lifecycle=await browser.newPage({viewport:{width:1000,height:800}});
 await lifecycle.route('**/wait-lifecycle',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><body><main class="viewport" style="position:absolute;inset:0"></main></body></html>'}));await lifecycle.goto(base+'/wait-lifecycle',{waitUntil:'commit'});
 report.lifecycle=await lifecycle.evaluate(async req=>{
  const {mountSitePlanWait}=await import('/site-plan-wait.js');
  const clocks=new Set(),rafs=new Set(),observers=new Set(),set=window.setInterval,clear=window.clearInterval,raf=window.requestAnimationFrame,caf=window.cancelAnimationFrame,RO=window.ResizeObserver,IO=window.IntersectionObserver,proto=CanvasRenderingContext2D.prototype,stroke=proto.stroke;
  let hidden=false,draws=0,intersection;
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
  window.setInterval=(...args)=>{const id=set(...args);clocks.add(id);return id;};window.clearInterval=id=>{clocks.delete(id);clear(id);};
  window.requestAnimationFrame=callback=>{const id=raf(at=>{rafs.delete(id);callback(at);});rafs.add(id);return id;};window.cancelAnimationFrame=id=>{rafs.delete(id);caf(id);};
  window.ResizeObserver=class extends RO{constructor(cb){super(cb);observers.add(this);}disconnect(){observers.delete(this);super.disconnect();}};
  window.IntersectionObserver=class extends IO{constructor(cb){super(cb);intersection=cb;observers.add(this);}disconnect(){observers.delete(this);super.disconnect();}};
  proto.stroke=function(...args){draws++;return stroke.apply(this,args);};
  const delay=ms=>new Promise(r=>setTimeout(r,ms));let stage;
  try{
   stage=mountSitePlanWait(document.querySelector('.viewport'),req);stage.update({status:'running',planIndex:1,planTotal:3});await delay(100);
   if(clocks.size!==1||rafs.size!==1||observers.size!==3)throw Error('mount resources');
   hidden=true;document.dispatchEvent(new Event('visibilitychange'));const before=draws;
   for(let i=0;i<5;i++)stage.update({status:'running',program:{...req.program,floors:i+1}});await delay(100);
   if(draws!==before||clocks.size||rafs.size)throw Error('hidden drawing or clocks');
   hidden=false;document.dispatchEvent(new Event('visibilitychange'));await delay(50);if(clocks.size!==1||rafs.size!==1||draws===before)throw Error('resume resources');
   intersection([{isIntersecting:false}]);const offscreen=draws;stage.update({status:'running'});await delay(50);if(rafs.size||draws!==offscreen)throw Error('offscreen drawing');intersection([{isIntersecting:true}]);
   stage.update({status:'succeeded',planIndex:3,planTotal:3,result:{report:{numbers:{gfa:731.2}}}});if(rafs.size||clocks.size||observers.size)throw Error('finish resources');
   if(!stage.element.textContent.includes('731.2'))throw Error('actual result metrics');stage.destroy();stage.destroy();if(document.querySelector('.site-plan-wait'))throw Error('destroy DOM');
   const {mountSiteWaitScene,siteWaitModel}=await import('/site-plan-wait-scene.js'),cv=document.createElement('canvas');cv.style.cssText='width:700px;height:360px';document.body.append(cv);const model=siteWaitModel(req),preview=mountSiteWaitScene(cv,model);preview.update(model,{state:'search'});await delay(100);const begin=performance.now(),beforeFrames=preview.frames;await delay(1100);const seconds=(performance.now()-begin)/1000,frames=preview.frames-beforeFrames;preview.destroy();cv.remove();if(frames>seconds*30+1)throw Error('over 30fps');
   const media=window.matchMedia;window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});const stillCanvas=document.createElement('canvas');stillCanvas.style.cssText='width:700px;height:360px';document.body.append(stillCanvas);const still=mountSiteWaitScene(stillCanvas,model);still.update(model,{state:'search'});await delay(50);if(rafs.size)throw Error('reduced motion RAF');still.destroy();stillCanvas.remove();window.matchMedia=media;
   return {hiddenDraws:0,measuredFPS:Math.round(frames/seconds*10)/10,reducedMotion:true,remainingRAF:rafs.size,remainingClocks:clocks.size,remainingObservers:observers.size};
  }finally{stage?.destroy();delete document.hidden;window.setInterval=set;window.clearInterval=clear;window.requestAnimationFrame=raf;window.cancelAnimationFrame=caf;window.ResizeObserver=RO;window.IntersectionObserver=IO;proto.stroke=stroke;}
 },request);await lifecycle.close();report.visibilityCleanup=true;console.log('숨은 창 정지 확인');
 await p.evaluate(async req=>{
  const t=window.__siteTest,{openDetailPlanDialog}=await import('/plan-workflow-panel.js');window.__detailPromise=openDetailPlanDialog({studio:t.studio,api:(...args)=>t.studio.api(...args)},req,{address:'개발 예시'});
 },request);
 await p.locator('.plan-detail-dialog').evaluate(d=>{const selects=d.querySelectorAll('select'),inputs=d.querySelectorAll('input[type=number]');selects[0].value='업무시설';selects[1].value='fixed';inputs[0].value='10';inputs[1].value='1234';});
 await p.getByRole('button',{name:'계획안 만들기',exact:true}).click();await p.locator('.site-plan-wait').waitFor();await p.waitForFunction(()=>document.querySelector('.site-plan-wait__facts')?.textContent.includes('업무시설')&&document.querySelector('.site-plan-wait__facts')?.textContent.includes('1,234㎡')&&document.querySelector('.site-plan-wait__facts')?.textContent.includes('10층'));
 await p.locator('.site-plan-wait').getByRole('button',{name:'생성 취소',exact:true}).click();await p.locator('.site-plan-wait').waitFor({state:'detached'});await p.locator('.plan-detail-dialog').evaluate(d=>d.close());report.activeConditions=true;console.log('상세 조건 확인');
 await p.evaluate(async req=>{
  const t=window.__siteTest,{installAutoPlan}=await import('/auto-plan.js');const site=t.engine.doc.entities[0];site.parcelRole='site';site.attributes={sourceCRS:'EPSG:5187',originMetres:[200000,400000],pnu:'1234567890123456789'};
  window.__autoCalls=0;window.__delayFromDrawing=false;
  installAutoPlan({context:{...t.studio.context,selected:()=>new Set([site.id])},api:(route,body)=>{
   if(route==='site-plan/from-drawing'){if(window.__delayFromDrawing)return new Promise(resolve=>window.__resolveDrawing=()=>resolve({request:structuredClone(req)}));return Promise.resolve({request:structuredClone(req)});}
   if(route==='auto-plan')window.__autoCalls++;return t.studio.api(route,body);
  }});
 },request);
 await p.getByTitle('대지 안에서 법규·주차를 검토하고 배치도를 생성 (바른 설계엔진 연동)',{exact:true}).evaluate(button=>button.click());await p.locator('#form-dialog button[type=submit]').click();await p.locator('.site-plan-wait').waitFor();await p.waitForFunction(()=>window.__siteTest.reveal().active,null,{timeout:45000});report.autoPlan=true;console.log('자동 배치 확인');
 await p.keyboard.press('Escape');await p.waitForFunction(()=>!window.__siteTest.reveal().active);
 await p.evaluate(()=>window.__delayFromDrawing=true);await p.getByTitle('대지 안에서 법규·주차를 검토하고 배치도를 생성 (바른 설계엔진 연동)',{exact:true}).evaluate(button=>button.click());await p.locator('#form-dialog button[type=submit]').click();await p.waitForFunction(()=>!!window.__resolveDrawing);
 await p.locator('#form-dialog').evaluate(d=>d.close());await p.evaluate(()=>window.__resolveDrawing());await p.waitForTimeout(100);assert.equal(await p.locator('.site-plan-wait').count(),0);assert.equal(await p.evaluate(()=>window.__autoCalls),1);report.cancelBeforeEngine=true;
 assert.deepEqual(checks.errors,[]);await checks.context.close();
 await fs.writeFile(path.join(out,process.argv.includes('--extra-only')?'smoke-extra.json':'smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error(error);throw error;}finally{browserServer.process()?.kill();await browserServer.close();}
