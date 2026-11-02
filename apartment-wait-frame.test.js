import test from 'node:test';
import assert from 'node:assert/strict';
import {apartmentMmToM,apartmentWaitReal,apartmentWaitProgress,mountApartmentWaitFrame} from './apartment-wait-frame.js';

test('uses the CAD Frame origin and anchor',()=>assert.deepEqual(apartmentMmToM({engine:{frame:{ox:100,oy:200,ax:1000,ay:2000}}},{x:2000,y:3000}),[101,201]));
test('derives rotated scale from paired site coordinates',()=>assert.deepEqual(apartmentMmToM({engine:{site_mm:[[0,0],[1000,0]],site:[[10,20],[10,22]]}},[500,0]),[10,21]));
test('accounts for the source millimetre edge angle',()=>assert.deepEqual(apartmentMmToM({engine:{site_mm:[[0,0],[1000,1000]],site:[[10,20],[10,22]]}},[500,500]),[10,21]));
test('normalizes real input and plan building geometry',()=>{
 const e={engine:{address:'연산동 586-3',site:[[0,0],[10,0]],site_area_m2:100,parts:[{zone:'주거',area_m2:100,bcr:60,far:200,points_mm:[[0,0],[1000,0],[1000,1000]]}],frame:{ox:0,oy:0,ax:0,ay:0}}};
 assert.equal(apartmentWaitReal(e).pieces[0].poly[1][0],1);
 assert.equal(apartmentWaitProgress({status:'running',plans:[{buildings:[{points_mm:[{x:0,y:0},{x:1000,y:0}]}]}]},e).plans[0].buildings[0].poly[1][0],1);
});

test('actual metre pieces stay in metres and missing limits stay unknown',()=>{
 const site=[[987,1234],[1000,1234],[1000,1300]];
 const r=apartmentWaitReal({engine:{site,parts:[{zone:'A',poly:site,bcr:null},{zone:'B'}]}});
 assert.deepEqual(r.pieces[0].poly,site);
 assert.equal(r.pieces[0].bcr,undefined);
 assert.equal(r.far_cap,undefined);
 assert.equal(r.zone,'A + B');
 assert.equal(apartmentMmToM({},[1000,2000]),null,'unknown frame does not pass millimetres as metres');
});

test('overlay survives terminal updates, closes independently, cleans up and honors switch',()=>{
 const listeners=new Map(), sent=[];let removed=0,closed=0;
 const win={location:{origin:'http://127.0.0.1:8899'},localStorage:{getItem:()=>null},addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)};
 const style=()=>({important:{},setProperty(k,v,p){this[k.replace(/-./g,m=>m[1].toUpperCase())]=v;if(p==='important')this.important[k]=v;}});
 const createElement=tag=>({tag,style:style(),events:{},setAttribute(){},append(){},addEventListener(k,fn){this.events[k]=fn;},showModal(){this.open=true;},close(){this.open=false;},remove(){removed++;},contentWindow:{postMessage:(m,origin)=>sent.push({m,origin})}});
 const viewport={ownerDocument:{defaultView:win,createElement},append(el){this.shell=el;},getBoundingClientRect:()=>({left:20,top:60,width:1200,height:700})};
 const overlay=mountApartmentWaitFrame(viewport,{},{onClose:()=>closed++});
 assert.equal(viewport.shell.tag,'dialog');assert.equal(viewport.shell.open,true);
 assert.equal(viewport.shell.style.width,'1200px');
 assert.deepEqual([viewport.shell.style.important.width,viewport.shell.style.important.height,viewport.shell.style.important.left,viewport.shell.style.important.zoom],['1200px','700px','20px','1'],'공용 대화상자 !important(780px·zoom .75)를 이겨 도면 칸을 덮는다');
 overlay.update({status:'done',current:null,done:['84','max'],elapsed_s:63,plans:[{mode:'84',buildings:[]}]});
 overlay.update({status:'done',elapsed_s:undefined});
 assert.equal(sent.length,0,'cache until iframe loads');
 overlay.element.events.load();
 const p=sent.at(-1).m.value;
 assert.deepEqual(p.done,['84','max']);assert.equal(p.elapsed_s,63);assert.equal(p.plans.length,1);
 assert.equal(sent.at(-1).origin,win.location.origin);
 const source=overlay.element.contentWindow;
 listeners.get('message')({source,origin:'http://other',data:{target:'barun-wait',cmd:'close'}});
 assert.equal(closed,0);
 listeners.get('message')({source,origin:win.location.origin,data:{target:'barun-wait',cmd:'close'}});
 assert.equal(closed,1);assert.equal(removed,1);assert.equal(listeners.size,0);
 overlay.destroy();assert.equal(closed,1);
 win.localStorage.getItem=()=> '0';
 assert.equal(mountApartmentWaitFrame(viewport,{}),null);
});

test('빠른 검토 칸 안에 초점이 있어도 Esc 로 닫는다',async()=>{
  const fs=await import('node:fs'),embed=fs.readFileSync('wait-screens/apartment-embed.js','utf8');
  assert.match(embed,/addEventListener\('keydown', e => \{ if \(e\.key === 'Escape'\) parent\.postMessage\(\{target:'barun-wait',cmd:'close'\}/);
});

test('예시 기록이 없는 설치판: 가운데 탐색은 계산 중(또는 실시간 걸음)이고 예시 문구를 그리지 않는다',async()=>{
  const fs=await import('node:fs'),embed=fs.readFileSync('wait-screens/apartment-embed.js','utf8');
  assert.match(embed,/script\.onerror=\(\)=>\{exampleError=true;dirty=true;\};/);
  assert.match(embed,/else text\(c,exampleError\?searchLine\(\):'불러오는 중'/);
  assert.match(embed,/if \(example\) \{text\(c,'예시 탐색 · 다른 대지 기록/,'예시 표시는 예시가 있을 때만');
  assert.match(embed,/'배치 탐색 · 계산 중'/);assert.match(embed,/if\(cmd==='search'&&value&&typeof value==='object'\)search=value;/);
});
// 2026-10-28: 계획 탭 ③(지적도 EPSG:5187)로 그린 대지는 frame 이 5187 m 이다. 엔진 대지(site)는 5179 라, frame 으로 바꾸면
// 동이 대지에서 1,000km 떨어져 빠른 검토 창 배치도가 점처럼 작아졌다 — 5179 가 아닌 frame 은 대지 짝 좌표로 맞춘다.
test('a non-5179 frame does not mix drawing metres with engine site metres',()=>{
 const e={engine:{frame:{ox:206000,oy:287000,ax:0,ay:0,crs:'EPSG:5187'},site:[[1142970,1688239],[1142970,1688249]]},site_mm:[{x:0,y:0},{x:0,y:10000}]};
 assert.deepEqual(apartmentMmToM(e,{x:0,y:5000}),[1142970,1688244]);
 assert.deepEqual(apartmentMmToM({engine:{frame:{ox:100,oy:200,ax:1000,ay:2000,crs:'EPSG:5179'}}},{x:2000,y:3000}),[101,201]);
});
