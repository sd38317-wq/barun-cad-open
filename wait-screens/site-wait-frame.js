// App adapter for the copied recording. Recording data is never engine input.
import {siteWaitResult,siteWaitModel,siteWaitNumber as number,mountSiteWaitScene} from '../site-plan-wait-scene.js';
const $=id=>document.getElementById(id);
const badge=document.createElement('div');badge.id='recording-label';
const css=document.createElement('style');css.textContent=`
.head{padding-right:110px}.head h1{font-size:12px}.head .speed{display:none}
#recording-label{position:absolute;z-index:3;left:16px;top:12px;max-width:calc(100% - 350px);padding:6px 10px;background:#222c3a;color:#f2ca89;border:1px solid #637d8b;font:13px/1.5 var(--sans)}
#actual-site{position:absolute;left:0;top:56px;width:calc(100% - 330px);height:calc(100% - 100px);background:#10151d}
#sub{max-width:400px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.compact .app{grid-template-rows:150px minmax(0,1fr) min(300px,calc(var(--H) * .22))}
.compact .head{grid-template-columns:1fr;padding-right:125px;gap:4px}
.compact .head h1{font-size:18px}.compact .head h1 small{font-size:16px}
.compact .cnt{grid-template-columns:repeat(3,minmax(0,1fr))}.compact .cnt div{font-size:17px}.compact .cnt b{font-size:21px}
.compact .grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr))}
.compact table,.compact .feed,.compact .lane{font-size:20px;line-height:25px}.compact .p h2{font-size:19px}
.compact .res{font-size:20px}.compact #recording-label{font-size:20px}.compact .site{font-size:20px}
#res{overflow:auto}#res p{margin:8px 0}#site{max-width:calc(100% - 350px)}
`;
document.head.append(css);document.querySelector('.hero').append(badge);
const actual=document.createElement('canvas');actual.id='actual-site';actual.setAttribute('aria-label','이번 대지의 실제 경계와 수신한 층별 도형');document.querySelector('.hero').append(actual);
$('siteTag').textContent='이번 대지 · 실제 입력';$('planTag').textContent='이번 대지 · 실제 도형';
let payload=null,scene=null,model=null,result=null,paused=false,lastPhase='',search=null;
// 예시 기록(site_example.js)은 설치판에 없다. 없으면 기록 재생 대신 실제 값과 '계산 중'만 보인다.
const example=Boolean(window.ENGINE_RUN);
// 엔진 실시간 탐색 걸음이 들어올 자리(docs/엔진요청_대기화면_실시간탐색_2026-10-23.md): cmd 'search' 로 받은 최신 걸음.
const searchLine=()=>search?`실시간 탐색 · ${search.phase||'후보 탐색'} · 후보 ${search.tried??'–'}개`+(search.best?` · 지금 최고 ${number(search.best.far,'%')}`:''):'후보 탐색 · 계산 중';
const phaseNow=()=>example?S.phase:(result?'final':'run');
const text=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
// The lower diagnostic panels retain recorded data, each explicitly labelled. 예시 기록(example)과 text() 를 만든 뒤에 돌아야 한다 — 앞에 두면 설치판(예시 없음)에서 멈춰 빈 화면이 된다(10-24).
for(const panel of document.querySelectorAll('.grid .p'))if(!panel.contains($('siteInfo'))&&!panel.contains($('cPlan'))){if(!example){for(const box of panel.querySelectorAll(':scope > :not(h2)'))box.replaceChildren(text('div','계산 중'));continue;}const label=document.createElement('span');label.textContent='예시 · ';label.style.color='#f2ca89';panel.querySelector('h2').prepend(label);}
function table(id,rows){const t=document.createElement('table');for(const [key,value]of rows){const row=document.createElement('tr');row.append(text('td',key),text('td',value));t.append(row);}$(id).replaceChildren(t);}
function drawPlan(){
 if(!payload||document.hidden||paused)return;
 const canvas=$('cPlan'),box=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.5);
 canvas.width=Math.max(1,box.width*ratio);canvas.height=Math.max(1,box.height*ratio);
 const g=canvas.getContext('2d');g.setTransform(ratio,0,0,ratio,0,0);
 const rings=[model.boundary,...(result?.geometry?.floors||[]).filter(Boolean).map(r=>r.map(([x,y])=>[x-model.center[0],y-model.center[1]]))];
 const points=rings.flat();if(!points.length)return;
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
 const scale=Math.max(.01,Math.min((box.width-20)/Math.max(xmax-xmin,1),(box.height-20)/Math.max(ymax-ymin,1)));
 for(const [i,ring]of rings.entries()){g.beginPath();ring.forEach(([x,y],k)=>{const a=box.width/2+(x-(xmin+xmax)/2)*scale,b=box.height/2-(y-(ymin+ymax)/2)*scale;k?g.lineTo(a,b):g.moveTo(a,b);});g.closePath();g.strokeStyle=i?'#a4e4ce':'#75dde8';g.stroke();}
}
function paint(){
 if(!payload||document.hidden||paused)return;
 $('siteTag').textContent='이번 대지 · 실제 입력';$('planTag').textContent='이번 대지 · 실제 도형';
 const r=payload.request,z=r.zoning||{},p=r.program||{},job=payload.job,n=result?.numbers;
 const status={submitting:'작업 접수 중',queued:'계산 대기',running:'대지 계산 중',sync:'동기 생성 중',succeeded:'결과 수신'}[job.status]||'결과 대기';
 $('sub').textContent=(r.site?.address||'이번 요청 대지')+(example?' · 아래 탐색/검증은 예시 · 다른 대지 기록 · 엔진 실시간 연결 전':' · 후보 탐색은 계산 중');
 $('cnt').replaceChildren(...[['작업 상태',(job.mock?'개발 예시 · ':'')+status],['안 순서',job.planIndex?job.planIndex+' / '+(job.planTotal??'미확인'):'미확인'],['대지면적',number(model.area,'㎡')],['건폐 상한',number(z.bcr,'%')],['용적 상한',number(z.far,'%')],['목표 연면적',number(p.target_gfa,'㎡')]].map(([k,v])=>{const d=text('div',k);d.append(text('b',v));return d;}));
 $('site').textContent=(r.site?.address||'이번 대지')+' · 실제 경계 '+model.boundary.length+'점 · 인접 '+model.neighbors.length+'개';
 table('siteInfo',[['주소',r.site?.address||'미확인'],['용도지역',z.zone||'미확인'],['대지면적',number(model.area,'㎡')],['건폐 / 용적 상한',number(z.bcr,'%')+' / '+number(z.far,'%')],['용도',p.use||'미확인'],['층수',p.floors_search?'탐색':number(p.floors,'층')],['목표 연면적',number(p.target_gfa,'㎡')],['요청 주차',number(p.parking?.count,'대')]]);
 const phase=phaseNow(),showActual=!example||Boolean(result)||['law','site','target'].includes(phase);
 actual.hidden=!showActual;$('hero').style.visibility=showActual?'hidden':'visible';
 badge.textContent=showActual?'이번 대지 · '+(result?'수신한 실제 결과 · 표시 높이는 '+(result.numbers?.floor_h>0?'엔진 층고':model.heightAssumed?'층고 3m 가정':'입력 층고'):'실제 입력 경계 · 법규 적합 판정 대기'):'예시 · 다른 대지 기록 · 엔진 실시간 연결 전 · '+S.it.id;
 if(showActual&&example)badge.textContent+=' · 아래 패널: 예시 · 다른 대지 기록 · 엔진 실시간 연결 전';
 $('res').className='res';$('res').replaceChildren(text('div','이번 대지 · 실제 '+(n?'수신 결과'+(payload.resultPlanIndex?' · '+payload.resultPlanIndex+'안':''):'입력')),text('h3',status));
 const rows=n?[['연면적',number(n.gfa,'㎡')],['건축면적',number(n.building_area,'㎡')],['건폐 / 용적',number(n.bcr,'%')+' / '+number(n.far,'%')],['층수',number(n.floors,'층')],['주차 확보 / 필요',number(n.parking_placed)+' / '+number(n.parking_required)],['층별 도형',result.geometry?.floors?.some(r=>r?.length>=3)?'실제 수신':'미수신']]:[['용도지역',z.zone||'미확인'],['건폐 / 용적 상한',number(z.bcr,'%')+' / '+number(z.far,'%')],['용도',p.use||'미확인'],['목표 연면적',number(p.target_gfa,'㎡')],['층수',p.floors_search?'탐색':number(p.floors,'층')]];
 for(const [k,v]of rows)$('res').append(text('p',k+' · '+v));
 $('res').append(text('p',example&&!search?'후보·검사·선택 진행은 아래 예시 기록입니다. 실제 엔진의 진행률은 제공되지 않습니다.':searchLine()));
 scene?.pause(paused||document.hidden||!showActual);
 if(phase!==lastPhase){lastPhase=phase;parent.postMessage({source:'barun-wait',kind:'site',event:phase==='final'?'done':'phase',phase,example},location.origin);}
}
// Preserve the original cinematic scene, then replace only known current-job facts.
if(example){const recordedFrame=frame;frame=at=>{recordedFrame(at);if(S.phase!==lastPhase)paint();};}
// Known facts belong to the current request; replay must not overwrite them.
if(example)for(const name of ['counters','paintSite','showRes','preRes']){const recorded=window[name];window[name]=(...args)=>{if(!payload)return recorded(...args);};}
window.drawPlan=()=>drawPlan();
addEventListener('message',e=>{
 if(e.source!==parent||e.origin!==location.origin||e.data?.target!=='barun-wait')return;
 const {cmd,value}=e.data;
 if(cmd==='update'&&value?.request){payload=value;result=siteWaitResult(value.result);model=siteWaitModel(value.request);const boundaryOnly={...model,floors:[],count:0};
  if(!scene)scene=mountSiteWaitScene(actual,boundaryOnly);
  scene.update(boundaryOnly,{state:result?'result':'boundary',result});paint();drawPlan();
 }
 if(cmd==='search'&&value&&typeof value==='object'){search=value;paint();}
 if(cmd==='pause'){paused=true;scene?.pause(true);}
 if(cmd==='resume'){paused=false;paint();drawPlan();}
});
window.addEventListener('visibilitychange',()=>{scene?.pause(document.hidden||paused);if(!document.hidden){paint();drawPlan();}});
new ResizeObserver(()=>{paint();drawPlan();}).observe(document.querySelector('.hero'));
parent.postMessage({source:'barun-wait',kind:'site',event:'ready'},location.origin);
