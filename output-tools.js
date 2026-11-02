// 출력 및 저장 분류 미연결 16개 + 열기,닫기 및 설정 분류 미연결 7개 = 23개.
// 정리본 docs/izzarder-reference-20260921/references/17-plot-save.md(CER FCC MSL PBD RLD A0 A1 AON AOFF SAB TBC 는
// 18-etc.md 에 있었다 · 정리본 목차와 실제 절이 다른 분류에 있어 원문 확인 후 옮겼다), 01-setup.md(EXP ON OPA QQ
// xiUnintall xiBackup xiRestore). izzarder.com 원문 번호는 각 명령 주석에 적는다. LII 는 블럭 묶음 모듈에서도 만들어
// 여기서는 등록하지 않는다(아래 "LII" 참고).
import * as G from './geometry.js';
import {builder,wallFrame,entitiesSvg,openCardDialog,resolveLayers,isPlotBoxLayerName} from './card-kit.js';
import {isChecked,downloadText,safeFileName} from './card-input.js';
import {getSnapAngle,setSnapAngle,slopePercentToAngle} from './snap-angle.js';
import {installGroupFileTools} from './group-file-tools.js';

/* ══════════════════════════ CER · 미세하게 틀어진 도면 보정 (izzarder.com/89) ══════════════════════════ */
export function roundValue(v,tol){ if(!(tol>0))return v; return Math.round(v/tol)*tol; }
export function roundPoint(p,tol,base={x:0,y:0}){ return {x:base.x+roundValue(p.x-base.x,tol),y:base.y+roundValue(p.y-base.y,tol)}; }
/** 객체 하나를 근사값 단위로 정렬한 "바뀐 필드만" 돌려준다(patch). 바뀐 게 없으면 {}.
 *  block 은 위치(outer)와, blockInner 가 켜져 있으면 내부 entities 도(항상 원점 0,0 기준·blockTol 로) 함께 본다. */
export function correctionPatch(e,{tol,base={x:0,y:0},types=null,roundRadius=false,blockInner=false,blockTol=tol}={}){
 const applies=t=>!types||types.includes(t);
 if(e.type==='block'){
  const patch={};
  if(applies('block')&&e.position){const np=roundPoint(e.position,tol,base);if(np.x!==e.position.x||np.y!==e.position.y)patch.position=np;}
  if(blockInner&&Array.isArray(e.entities)){
   const inner=e.entities.map(c=>({...c,...correctionPatch(c,{tol:blockTol,base:{x:0,y:0},types:null,roundRadius,blockInner:true,blockTol})}));
   if(JSON.stringify(inner)!==JSON.stringify(e.entities))patch.entities=inner;
  }
  return patch;
 }
 if(!applies(e.type))return {};
 const patch={};
 if(['line','polyline','rectangle','dimension'].includes(e.type)&&Array.isArray(e.points)){
  const np=e.points.map(p=>roundPoint(p,tol,base));
  if(JSON.stringify(np)!==JSON.stringify(e.points))patch.points=np;
 }
 if((e.type==='circle'||e.type==='arc'||e.type==='ellipse')&&e.center){
  const nc=roundPoint(e.center,tol,base);if(nc.x!==e.center.x||nc.y!==e.center.y)patch.center=nc;
  if(roundRadius&&(e.type==='circle'||e.type==='arc')&&Number.isFinite(e.radius)){const nr=roundValue(e.radius,tol);if(nr!==e.radius)patch.radius=nr;}
 }
 if(e.type==='text'&&e.position){const np=roundPoint(e.position,tol,base);if(np.x!==e.position.x||np.y!==e.position.y)patch.position=np;}
 return patch;
}

/* ══════════════════════════ PBD · 출력용 PLOT_BOX 모두 지우기 (izzarder.com/102) ══════════════════════════ */
export function plotBoxLayerIds(layers){ return (layers||[]).filter(l=>isPlotBoxLayerName(l.name)).map(l=>l.id); }
export function entitiesOnLayers(entities,layerIds){ const set=new Set(layerIds); return (entities||[]).filter(e=>set.has(e.layer)).map(e=>e.id); }

/* ══════════════════════════ SAB · 블럭파일로 저장 (izzarder.com/514) ══════════════════════════ */
export function sabTranslateDelta(entities){ const b=G.bounds(entities); if(!b)return {dx:0,dy:0}; return {dx:-b.minX,dy:-b.minY}; }
/** 모든 객체(중첩 블럭 내부 포함)의 켜를 zeroLayerId 로, 색·선모양을 ByLayer(null) 로 통일한다. */
export function toZeroLayerStandard(e,zeroLayerId){
 const out={...e,layer:zeroLayerId,color:null,linetype:null};
 if(Array.isArray(e.entities))out.entities=e.entities.map(c=>toZeroLayerStandard(c,zeroLayerId));
 return out;
}
/** 2026-09-24(검토 P6): 잠긴 켜의 객체는 엔진이 편집을 거부해 SAB 전체가 멈췄다. 잠긴 켜 객체는 건너뛰고 따로 센다. */
export function splitByLockedLayer(entities,layers){
 const locked=new Set((layers||[]).filter(l=>l.locked).map(l=>l.id));
 const editable=[],skipped=[];
 for(const e of entities||[])(locked.has(e.layer)?skipped:editable).push(e);
 return {editable,skipped,lockedLayerIds:[...locked]};
}

/* ══════════════════════════ FCC · 사용 글꼴 모으기 (izzarder.com/600) ══════════════════════════
   2026-09-24: 안내만 하던 것을 실제 동작으로. 도면의 문자(블록 안 포함)가 쓰는 문자모양·원본 글꼴 파일(DWG/DXF 에서
   가져온 textStyle·sourceFont·sourceBigFont)을 모아 목록 파일로 내보내고, 바른 CAD 가 도면을 그릴 때 쓰는 내장 글꼴
   파일(NanumGothic)을 함께 내려받는다. 원문처럼 윈도우 글꼴 폴더를 뒤지는 것은 화면(브라우저) 권한 밖이라,
   외부 글꼴은 "파일 이름 목록"으로 넘긴다. 굴림·돋움 같은 윈도우 기본 글꼴은 원문처럼 "기본"으로 표시한다. */
export const DEFAULT_FONT_PATTERN=/^(gulim|dotum|batang|gungsuh|malgun|arial|times|tahoma|verdana|txt|simplex|romans|isocp|monotxt|whgtxt|whgdtxt|hgtxt|standard)/i;
export function fontUsageRows(entities){
 const rows=new Map();
 const visit=e=>{
  if(!e)return;
  if(e.type==='text'){
   const style=String(e.textStyle||'Standard'),font=String(e.sourceFont||''),big=String(e.sourceBigFont||'');
   const key=JSON.stringify([style,font,big]);
   const row=rows.get(key)||{style,font,bigFont:big,count:0};row.count++;rows.set(key,row);
  }
  for(const c of e.entities||[])visit(c);
 };
 for(const e of entities||[])visit(e);
 return [...rows.values()].sort((a,b)=>b.count-a.count||a.style.localeCompare(b.style,'ko'));
}
export function formatFontReport(rows,{drawingFont='NanumGothic-Regular.ttf',date=new Date()}={}){
 const lines=[`바른 CAD 사용 글꼴 목록 (FCC) · ${date.toISOString().slice(0,10)}`,`바른 CAD 화면·PDF 출력 글꼴: ${drawingFont}`,''];
 if(!rows.length)lines.push('도면에 문자 객체가 없습니다.');
 const files=new Set();
 for(const r of rows){
  const fonts=[r.font,r.bigFont].filter(Boolean);
  for(const f of fonts)if(!DEFAULT_FONT_PATTERN.test(f))files.add(f);
  lines.push(`- 문자모양 ${r.style} · 문자 ${r.count}개 · 원본 글꼴 ${fonts.length?fonts.map(f=>f+(DEFAULT_FONT_PATTERN.test(f)?'(기본)':'')).join(' + '):'(지정 없음 · 바른 CAD 내장 글꼴로 표시)'}`);
 }
 lines.push('',files.size?`모아야 할 외부 글꼴 파일 ${files.size}개: ${[...files].join(', ')} — 원본 도면을 만든 PC 의 글꼴 폴더에서 이 파일들을 도면 폴더 안 fonts 폴더로 복사하세요.`:'모아야 할 외부 글꼴 파일이 없습니다(기본 글꼴 또는 바른 CAD 내장 글꼴만 사용).');
 return {text:lines.join(String.fromCharCode(10))+String.fromCharCode(10),externalFonts:[...files]};
}

/* ══════════════════════════ MSL · 여러 도면 자동 정리 (izzarder.com/265) ══════════════════════════
   2026-09-24: 안내만 하던 것을 실제 동작으로. 원문의 "현재 파일만" + 공통 정리 항목(포인트 삭제·빈 문자 삭제·특정 켜
   객체 삭제·모든 객체 0번 켜·좌하귀 0,0 이동·빈 켜 퍼지)을 현재 도면 또는 열린 도면 탭 전부에 차례로 적용한다.
   폴더 안 닫힌 파일을 몰래 열어 고치는 방식(ObjectDBX)은 없으므로 "열린 도면"이 대상이다. 잠긴 켜 객체는 건드리지 않는다. */
/** 현재 칸·다른 칸·AI가 같은 정리 계획과 batch를 쓴다. */
export function cleanOutputDrawing(ctx,opts){
 const zeroLayerId=opts.zeroLayer?ctx.ensureLayer('0','#ffffff'):null;
 const plan=mslCleanupPlan(ctx.entities(),ctx.layers(),{...opts,zeroLayerId,blocks:ctx.blocks?.()||[],keepLayerIds:[ctx.activeLayer?.()]});
 if(!plan.commands.length)return plan.counts;
 try{ctx.execute({type:'batch',commands:plan.commands});}
 catch(error){
  /* 켜 삭제 하나가 거부돼도 객체 정리는 남기고, 지울 수 있는 켜만 하나씩 지운다(SAB 와 같은 방식). */
  if(!plan.layerDeletes.length)throw error;
  if(plan.entityCommands.length)ctx.execute({type:'batch',commands:plan.entityCommands});
  let purged=0;for(const c of plan.layerDeletes){try{ctx.execute(c);purged++;}catch{}}
  return {...plan.counts,purged};
 }
 return plan.counts;

}
/** 닫기 응답 뒤 편집 경쟁을 막는다. 예약 중에만 엔진 실행을 감싸고, 취소·만료 시 원래 함수를 복원한다. */
export function createOutputCloseReservation({engine,hold,release,schedule=setTimeout,unschedule=clearTimeout}){
 let lease=null;
 const unlock=id=>{if(!lease||lease.id!==id)return;const old=lease;lease=null;unschedule(old.timer);if(engine.execute===old.guard)engine.execute=old.execute;release();};
 return {release:unlock,active:id=>!!lease&&lease.id===id&&lease.expiresAt>Date.now(),acquire:request=>{
  if(lease)throw Error('다른 닫기 요청을 처리하고 있습니다.');
  const execute=engine.execute,guard=()=>{throw Error('도면 닫기를 확인하는 중입니다. 잠시 뒤 다시 실행하세요.');};
  lease={id:request.id,expiresAt:request.expiresAt,execute,guard,timer:null};engine.execute=guard;hold();
  lease.timer=schedule(()=>unlock(request.id),Math.max(1,request.expiresAt-Date.now()));
  return {lease:request.id,expiresAt:request.expiresAt};
 }};
}
const sameOutputIds=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
/** 칸 내부 실행: 객체 본문은 옮기지 않고 대상과 저장 상태를 적용 직전에 확인한다. */
export function handleOutputRequest(ctx,request){
 if(request.expiresAt<=Date.now())throw Error('요청 시간이 지났습니다.');
 const options=request.options||{},state=ctx.outputState(request.allowAI,options.lease),ids=state.drawings.map(t=>t.id),dirty=state.drawings.some(t=>t.dirty);
 if(request.operation==='can-close'){
  const safe=!state.busy&&!dirty&&ids.length>0&&(!options.ids||sameOutputIds(options.ids,ids));
  return {dirty,safe,ids,...(safe&&options.reserve?ctx.outputReserve(request):{})};
 }
 if(request.operation==='confirm-close')return {dirty,safe:!!ctx.outputReservation?.active(options.lease)&&!state.busy&&!dirty&&sameOutputIds(options.ids||[],ids)};
 if(state.busy)throw Error('도면에서 진행 중인 작업이나 열린 창을 마친 뒤 다시 실행하세요.');
 if(request.operation==='close-tabs'){
  const closed=[],dirty=[],failed=[];
  for(const id of options.ids||[]){
   const tab=ctx.outputState(request.allowAI).drawings.find(t=>t.id===id);
   if(!tab){failed.push(id);continue;}if(tab.dirty){dirty.push(id);continue;}
   try{ctx.outputCloseTab(id);(ctx.outputState(request.allowAI).drawings.some(t=>t.id===id)?failed:closed).push(id);}catch{failed.push(id);}
  }
  ctx.refresh();return {closed,dirty,failed};
 }
 if(request.operation!=='clean')throw Error('알 수 없는 도면 요청입니다.');
 const results=[],failures=[],start=ctx.outputActive();
 try{for(const tab of state.drawings){
  try{ctx.outputSelect(tab.id);const counts=ctx.outputBatch(()=>cleanOutputDrawing(ctx,options));results.push({name:tab.name,counts});}
  catch(error){failures.push(tab.name+': '+ctx.userErrorMessage(error));}
 }}finally{ctx.outputSelect(start);ctx.refresh();}
 return {results,failures};
}
const outputTabs=state=>(state?.windows||[]).flatMap(w=>(w.drawings||[]).map(d=>({...d,id:d.id??w.id,windowId:w.id,name:d.name||w.title,dirty:!!d.dirty})));
const outputWindowIds=tabs=>[...new Set(tabs.map(t=>t.windowId))];
const deferOutput=(ctx,task)=>ctx.scripted?task():setTimeout(()=>{Promise.resolve().then(task).catch(e=>ctx.toast(ctx.userErrorMessage(e),true));},0);
const applyOutput=(ctx,apply)=>ctx.commitOutput?ctx.commitOutput(apply):ctx.beforeOutput?Promise.resolve(ctx.beforeOutput()).then(apply):apply();
export async function runOutputCommand(ctx,name,inputs={}){
 if(!['MSL','QQ'].includes(name))throw Error('지원하지 않는 도면 명령입니다.');
 await ctx.beforeOutput?.();
 const messages=[],values=Array.isArray(inputs.form)?inputs.form[0]||{}:inputs.form||{};
 const live={...ctx,scripted:true,toast:(text,isError)=>{messages.push(text);ctx.toast(text,isError);},form:(title,fields,apply)=>{
  const initial={...Object.fromEntries(fields.map(f=>[f.name,f.value??''])),...values};
  if(name==='MSL'&&initial.scope!=='all')return apply(initial);
  if(typeof ctx.form!=='function')throw Error('CAD 화면에서 실행 내용을 확인해 주세요.');
  return new Promise((resolve,reject)=>{
   let submitted=false;
   ctx.form(title,fields.map(f=>({...f,value:f.name==='confirmAll'?false:initial[f.name]})),v=>{
    if(submitted)return;
    if(name==='MSL'&&v.scope==='all'&&fields.some(f=>f.name==='confirmAll')&&!isChecked(v.confirmAll))throw Error('다른 칸 도면을 포함한 정리 안내를 읽고 확인 체크박스를 선택하세요.');
    submitted=true;
    // 화면 폼의 제출 처리가 끝나 닫힌 뒤 칸 사이 요청을 시작한다.
    setTimeout(()=>{Promise.resolve().then(()=>apply(v)).then(resolve,reject);},0);
   },()=>{if(!submitted){submitted=true;resolve({cancelled:true,applied:false});}});
  });
 }};
 const result=await installOutputTools(live)[name]();return {command:name,messages,applied:false,...result};
}
export function mslCleanupPlan(entities,layers,{points=true,emptyText=true,deleteLayerName='',zeroLayer=false,zeroLayerId=null,moveToOrigin=false,purgeLayers=false,blocks=[],keepLayerIds=[]}={}){
 const {editable,skipped}=splitByLockedLayer(entities,layers);
 const name=String(deleteLayerName||'').trim();
 const target=name?(layers||[]).find(l=>l.name===name):null;
 if(name&&!target)throw Error('삭제할 켜가 없습니다: '+name);
 if(zeroLayer&&!zeroLayerId)throw Error('0번 켜를 찾을 수 없습니다.');
 const removeIds=new Set();
 for(const e of editable){
  if(points&&e.type==='point')removeIds.add(e.id);
  if(emptyText&&e.type==='text'&&!String(e.text||'').trim())removeIds.add(e.id);
  if(target&&e.layer===target.id)removeIds.add(e.id);
 }
 const commands=[];
 if(removeIds.size)commands.push({type:'delete',ids:[...removeIds]});
 const remain=editable.filter(e=>!removeIds.has(e.id));
 let moved=0,zeroed=0;
 const delta=moveToOrigin?sabTranslateDelta(remain):{dx:0,dy:0};
 const finalOf=new Map();
 for(const e of remain){
  let next=e;
  if(moveToOrigin&&(delta.dx||delta.dy)){next=G.translate(next,delta.dx,delta.dy);moved++;}
  if(zeroLayer&&(e.layer!==zeroLayerId||e.color||e.linetype||(e.entities||[]).length)){next=toZeroLayerStandard(next,zeroLayerId);zeroed++;}
  finalOf.set(e.id,next);
  if(next!==e){const {id,type,...rest}=next;commands.push({type:'update',ids:[e.id],changes:rest});}
 }
 const purged=[],layerDeletes=[];
 if(purgeLayers){
  /* 2026-09-24(비평 1): engine.js layer.delete 는 블록 정의(doc.blocks) 안의 켜 사용도 막는다. 블록 정의만 쓰는 켜
     (DXF 도면에 흔함)를 지우려다 batch 전체가 거부되지 않게 블록 정의까지 사용 켜로 센다. 현재 켜도 남긴다. */
  const used=new Set(keepLayerIds.filter(Boolean));
  const visit=e=>{if(e?.layer)used.add(e.layer);for(const c of e?.entities||[])visit(c);};
  for(const e of remain)visit(finalOf.get(e.id)||e);
  for(const e of skipped)visit(e);
  for(const b of blocks||[])visit(b);
  for(const l of layers||[])if(l.name!=='0'&&!l.locked&&l.id!==zeroLayerId&&!used.has(l.id)){layerDeletes.push({type:'layer.delete',id:l.id});purged.push(l.name);}
 }
 return {commands:[...commands,...layerDeletes],entityCommands:commands,layerDeletes,counts:{removed:removeIds.size,moved,zeroed,purged:purged.length,skippedLocked:skipped.length}};
}

/* ══════════════════════════ TBC · 배경색 흑/백 전환 (izzarder.com/155) ══════════════════════════ */
export function nextBackgroundTheme(current){ return current==='ivory'?'dark':'ivory'; }

/* ══════════════════════════ EXP · 작업폴더 탐색기로 열기 (izzarder.com/108) ══════════════════════════ */
export function isAbsoluteWindowsPath(p){ return /^[a-zA-Z]:[\\/]/.test(String(p||''))||/^\\\\/.test(String(p||'')); }
/** 윈도 절대 경로 또는 맥 절대 경로('/Users/…'). 2026-10-27 맥판에서 EXP 가 맥 경로를 거절하던 것을 고쳤다. */
export function isAbsoluteFolderPath(p){ return isAbsoluteWindowsPath(p)||/^\//.test(String(p||'')); }
/** 파일 경로 → 그 파일이 있는 폴더(절대 경로가 아니면 ''). 'D:\a\b.dxf' → 'D:\a', 'D:\b.dxf' → 'D:\', '/a/b.dxf' → '/a'. */
export function folderOfPath(p){
 const s=String(p||'').trim();if(!isAbsoluteFolderPath(s))return '';
 const at=Math.max(s.lastIndexOf('\\'),s.lastIndexOf('/'));
 const folder=s.slice(0,at);
 return /^[a-zA-Z]:$/.test(folder)||folder===''?folder+s[at]:folder;
}

/* ══════════════════════════ QQ · 열린 도면 일괄 닫기 (izzarder.com/174) ══════════════════════════ */
/** scope: 'excludeCurrent'(기본) · 'includeCurrent' · 'onlyCurrent'. 저장하지 않은(dirty) 도면은 항상 건너뛴다
 *  (저장 API 가 카드 문맥에 없어 "저장하고 모으기"류는 만들지 않았다 · 보고서 참고). */
export function tabsInScope(tabs,scope,activeId){
 const list=tabs||[];
 if(scope==='onlyCurrent')return list.filter(t=>t.id===activeId);
 if(scope==='includeCurrent')return list;
 return list.filter(t=>t.id!==activeId);
}
export function closableTabIds(tabs,scope,activeId){ return tabsInScope(tabs,scope,activeId).filter(t=>!t.dirty).map(t=>t.id); }
export function dirtySkippedCount(tabs,scope,activeId){ return tabsInScope(tabs,scope,activeId).filter(t=>t.dirty).length; }
/** 2026-10-06(봇 점검: "도면이 안 닫혀도 성공 표시"): 닫기를 누른 뒤 실제로 목록에서 사라졌는지 확인해 닫힌 것·안 닫힌 것을 나눈다.
 *  list() = 지금 열린 탭 목록, clickClose(id) = 그 탭의 닫기 단추를 눌렀으면 true(단추가 없으면 false), wait() = 한 박자 쉬기.
 *  닫는 사이에 저장 안 된 상태가 된 탭은 저장 묻기 창이 뜨지 않도록 누르지 않고 dirty 로 센다. */
export async function closeTabsVerified(ids,{list,clickClose,wait=async()=>{}}){
 const closed=[],failed=[],dirty=[];
 for(const id of ids){
  const before=list().find(t=>t.id===id);
  if(!before){closed.push(id);continue;}
  if(before.dirty){dirty.push(id);continue;}
  const pressed=clickClose(id);
  await wait();
  const still=list().some(t=>t.id===id);
  (pressed&&!still?closed:failed).push(id);
 }
 return {closed,failed,dirty};
}
export function qqResultMessage({requested,closed,failed,dirtySkipped=0,names=[],deferred=0}){
 if(deferred){const done=closed?`도면 ${closed}개를 닫았습니다 · `:'';return {text:`QQ · ${done}결과 전달 뒤 닫기 대기 ${deferred}개${dirtySkipped?` · 저장하지 않은 도면 ${dirtySkipped}개 건너뜀`:''}${failed?` · 닫지 못한 도면 ${failed}개`:''}.`,isError:failed>0};}
 const tail=dirtySkipped?` · 저장하지 않은 도면 ${dirtySkipped}개는 건너뛰었습니다.`:'';
 if(!failed)return {text:`QQ · 도면 ${closed}개를 닫았습니다.${tail}`,isError:false};
 const which=names.length?` (${names.slice(0,3).join(', ')}${names.length>3?' 외':''})`:'';
 const why=' 다른 창이 열려 있거나 도면을 읽고·저장하는 중이면 닫히지 않습니다. 끝난 뒤 QQ 를 다시 실행하세요.';
 if(!closed)return {text:`QQ · 도면을 닫지 못했습니다${which}.${why}${tail}`,isError:true};
 return {text:`QQ · 도면 ${requested}개 중 ${closed}개만 닫았습니다 · 닫히지 않은 도면 ${failed}개${which}.${why}${tail}`,isError:true};
}

/* ══════════════════════════ xiBackup / xiRestore · 사용자 설정 내보내기·불러오기 (izzarder.com/319) ══════════════════════════
   바른 CAD 리습 의 단축키·Lib 파일 대신, 바른 CAD 카드 설정(localStorage 의 barun- 로 시작하는 키)을 옮긴다. */
export function filterBackupEntries(entries){ return (entries||[]).filter(([k])=>/^barun-/.test(k)); }
export function restoreEntries(parsed){
 const data=parsed&&typeof parsed==='object'?parsed.data:null;
 if(!data||typeof data!=='object')return [];
 return Object.entries(data).filter(([k,v])=>/^barun-/.test(k)&&typeof v==='string');
}
/* ACAD200 725 설정 묶음 고르기(AutoCAD Settings Transfer 대응).
   AutoCAD: 외부 이전 도구에 묶음 이름을 넘긴다. 바른 CAD 가 더 나은 점: 묶음을 고르는 창이 앱 안에 있고, 파일에 앱·판 번호를 적고,
   불러오기 전에 덮일 현재 값을 자동으로 따로 남겨(BEFORE_RESTORE_KEY) 한 번에 되돌릴 수 있다. 모르는 키는 건너뛰고 개수를 알려 준다. */
export const BEFORE_RESTORE_KEY='barun-settings-before-restore';
export const SETTING_GROUPS=Object.freeze({
 commands:{label:'명령 별칭·단축키',test:k=>/^barun-cad-command-settings|^barun-(aliases|hotkeys)/.test(k)},
 plot:{label:'출력 설정',test:k=>/^barun-plot-/.test(k)},
 menu:{label:'빠른 메뉴·최근 명령',test:k=>/^barun-qmenu-/.test(k)},
 prefs:{label:'사용자 설정(자동 교정·LAYISO 방식·플롯 스탬프 등)',test:k=>k==='barun-cad-prefs-v1'},
 colorbooks:{label:'색 견본집',test:k=>/^barun-colorbooks/.test(k)},
 cards:{label:'카드·기타 설정',test:k=>/^barun-/.test(k)},
});
export function settingGroupOf(key){
 if(key===BEFORE_RESTORE_KEY)return null;
 for(const [name,g] of Object.entries(SETTING_GROUPS))if(g.test(key))return name;
 return null;
}
export function exportSettings(entries,groups=Object.keys(SETTING_GROUPS),version=''){
 const pick=filterBackupEntries(entries).filter(([k])=>groups.includes(settingGroupOf(k)));
 return {app:'barun-cad',kind:'settings',version:String(version||''),groups:[...groups],exportedAt:new Date().toISOString(),data:Object.fromEntries(pick)};
}
/** BRRESTORE 로 고른 파일 글자 → 설정 묶음. JSON 이 아니면(도면 파일 등) 무엇을 골라야 하는지 알려 준다. */
export function parseSettingsFile(text){
 try{return JSON.parse(String(text||'{}'));}catch{throw Error('바른 CAD 설정 파일이 아닙니다. BRBACKUP 으로 만든 설정 파일(.json)을 고르세요.');}
}
/** 불러오기 계획: 고른 묶음만, 모르는 키는 건너뜀, 덮일 현재 값은 backup 으로. 예전 BRBACKUP 파일(app 없음)도 받는다. */
export function planImport(parsed,currentEntries,{groups=Object.keys(SETTING_GROUPS)}={}){
 if(parsed?.app&&parsed.app!=='barun-cad')throw Error('바른 CAD 설정 파일이 아닙니다.');
 const incoming=restoreEntries(parsed);
 if(!incoming.length)throw Error('백업 파일에 복원할 설정이 없습니다.');
 const apply=incoming.filter(([k])=>groups.includes(settingGroupOf(k)));
 const current=new Map(filterBackupEntries(currentEntries));
 const backup=apply.filter(([k,v])=>current.has(k)&&current.get(k)!==v).map(([k])=>[k,current.get(k)]);
 return {apply,backup,skipped:incoming.length-apply.length,version:parsed.version||''};
}

/* ══════════════════════════ RLD · 출도 도장 넣기 (izzarder.com/596) ══════════════════════════ */
export const RLD_PURPOSE_LABEL=Object.freeze({estimate:'견적도',approval:'승인도',review:'검토용',production:'제작용',archive:'보관용',request:'요청본'});
export const RLD_FIELDS=[
 {key:'purpose',label:'출도목적',type:'select',def:'estimate',options:Object.entries(RLD_PURPOSE_LABEL).map(([k,l])=>[k,l]),group:'출도목적'},
 {key:'auto',label:'일시 자동(실행 시각 사용)',type:'check',def:false,group:'일시'},
 {key:'year',label:'년',type:'number',def:2026,min:2000,max:2100,group:'일시',when:v=>!v.auto},
 {key:'month',label:'월',type:'number',def:1,min:1,max:12,group:'일시',when:v=>!v.auto},
 {key:'day',label:'일',type:'number',def:1,min:1,max:31,group:'일시',when:v=>!v.auto},
 {key:'hour',label:'시',type:'number',def:9,min:0,max:23,group:'일시',when:v=>!v.auto},
 {key:'minute',label:'분',type:'number',def:0,min:0,max:59,group:'일시',when:v=>!v.auto},
 {key:'deptOn',label:'부서 표시',type:'check',def:true,group:'부서/회사'},
 {key:'dept',label:'부서명',type:'text',def:'설계팀',group:'부서/회사',when:v=>v.deptOn},
 {key:'deptRatio',label:'부서 폭비율',type:'number',def:0.8,min:0.1,max:2,step:0.05,group:'부서/회사',when:v=>v.deptOn},
 {key:'companyOn',label:'회사 표시',type:'check',def:true,group:'부서/회사'},
 {key:'company',label:'회사명',type:'text',def:'바른 CAD',group:'부서/회사',when:v=>v.companyOn},
 {key:'companyRatio',label:'회사 폭비율',type:'number',def:0.8,min:0.1,max:2,step:0.05,group:'부서/회사',when:v=>v.companyOn},
 {key:'radius',label:'도장 반지름 (mm · 원문에 크기값이 없어 추가함)',type:'number',def:1500,min:200,step:50,group:'크기'},
];
export const RLD_SHARED_FIELDS=[{key:'layer',label:'도장 켜 (원문 기본값은 "0" · 규칙서 §6 표준 켜를 따라 A-SYM 로 바꿈)',type:'layer',def:'A-SYM',group:'켜'}];
export function stampDateText(v){
 if(v.auto){const d=new Date();return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
 return `${v.year}.${String(v.month).padStart(2,'0')}.${String(v.day).padStart(2,'0')} ${String(v.hour).padStart(2,'0')}:${String(v.minute).padStart(2,'0')}`;
}
/** 도장 하나(원+24 눈금+"출도"+화살표+일시+목적+부서/회사)를 insert 를 중심으로 그린다. */
export function buildStamp(v,insert={x:0,y:0}){
 const R=Number(v.radius)||1500,out=[];
 out.push({type:'circle',center:{...insert},radius:R});
 for(let i=0;i<24;i++){
  const a=i*(360/24)*Math.PI/180,inner=R*0.88;
  out.push({type:'line',points:[{x:insert.x+inner*Math.cos(a),y:insert.y+inner*Math.sin(a)},{x:insert.x+R*Math.cos(a),y:insert.y+R*Math.sin(a)}]});
 }
 out.push({type:'text',position:{x:insert.x,y:insert.y+R*0.18},text:'출도',height:R*0.32,rotation:0,align:'center'});
 const ax0=insert.x-R*0.35,ay=insert.y-R*0.05,ax1=insert.x+R*0.35;
 out.push({type:'line',points:[{x:ax0,y:ay},{x:ax1,y:ay}]});
 out.push({type:'polyline',closed:true,points:[{x:ax1,y:ay},{x:ax1-R*0.12,y:ay+R*0.06},{x:ax1-R*0.12,y:ay-R*0.06}]});
 out.push({type:'text',position:{x:insert.x,y:insert.y-R*0.22},text:stampDateText(v),height:R*0.11,rotation:0,align:'center'});
 out.push({type:'text',position:{x:insert.x,y:insert.y-R*0.4},text:RLD_PURPOSE_LABEL[v.purpose]||v.purpose,height:R*0.14,rotation:0,align:'center'});
 let line=insert.y-R*0.6;
 if(v.deptOn){out.push({type:'text',position:{x:insert.x,y:line},text:String(v.dept||''),height:R*0.11*(Number(v.deptRatio)||1),rotation:0,align:'center'});line-=R*0.16;}
 if(v.companyOn)out.push({type:'text',position:{x:insert.x,y:line},text:String(v.company||''),height:R*0.11*(Number(v.companyRatio)||1),rotation:0,align:'center'});
 return out;
}

/* ══════════════════════════ KCI/KCL · 주방가구 그리기 (izzarder.com/236 · /237) ══════════════════════════
   원문은 "3개의 점을 지정하면 그려진다"는 것과 냉장고 8종 표만 확실하고, 폭 구간별 정확한 모듈 조합표는
   원문·정리본 모두 없다(정리본의 "7단계 모듈"은 정리본 작성자의 추정이라 근거로 삼지 않았다). 아래 모듈 배치는
   개수대(600) → 조리대(남는 만큼) → 가스대(남는 폭에 따라 2·3구) 순으로 직접 정한 합리적 근사치다. 보고서 참고. */
export const FRIDGE_TYPES=Object.freeze([
 {key:'none',label:'없음',w:0,d:0},
 {key:'f825',label:'825L · W912×D927 (양문)',w:912,d:927},
 {key:'f630',label:'630L · W912×D725 (양문 빌트인)',w:912,d:725},
 {key:'f590',label:'590L · W860×D730 (단문)',w:860,d:730},
 {key:'f480',label:'480L · W780×D730 (단문)',w:780,d:730},
 {key:'f430',label:'430L · W703×D730 (단문)',w:703,d:730},
 {key:'f320',label:'320L · W595×D650 (단문)',w:595,d:650},
 {key:'f250',label:'250L · W555×D620 (단문)',w:555,d:620},
]);
export function fridgeSize(key){ return FRIDGE_TYPES.find(f=>f.key===key)||FRIDGE_TYPES[0]; }
const SINK_W=600,STOVE_W=600,MIN_COUNTER=300;
/** 전체 길이를 냉장고(있으면 시작점 쪽)·개수대·조리대·가스대 구간으로 나눈다. s0~s1 은 벽 방향(s) 좌표. */
export function kitchenModules(length,fridgeWidth=0){
 if(!(length>0))throw Error('가구 길이(두 점 사이 거리)는 0보다 커야 합니다.');
 const modules=[];let s=0;
 if(fridgeWidth>0){
  if(fridgeWidth>=length)throw Error('냉장고 폭이 가구 전체 길이보다 크거나 같습니다. 냉장고를 없음으로 바꾸거나 두 점 사이를 늘리세요.');
  modules.push({type:'fridge',s0:s,s1:s+fridgeWidth});s+=fridgeWidth;
 }
 const remain=length-s;
 if(remain<=SINK_W){modules.push({type:'sink',s0:s,s1:s+remain});return modules;}
 modules.push({type:'sink',s0:s,s1:s+SINK_W});s+=SINK_W;
 const remain2=length-s;
 if(remain2<=0)return modules;
 if(remain2<=STOVE_W){modules.push({type:'stove',s0:s,s1:s+remain2});return modules;}
 if(remain2-STOVE_W>=MIN_COUNTER){modules.push({type:'counter',s0:s,s1:length-STOVE_W});modules.push({type:'stove',s0:length-STOVE_W,s1:length});}
 else modules.push({type:'stove',s0:s,s1:length});
 return modules;
}
export const KITCHEN_FIELDS=[
 {key:'fridge',label:'냉장고 종류',type:'select',def:'none',options:FRIDGE_TYPES.map(f=>[f.key,f.label]),group:'냉장고 종류'},
 {key:'depth',label:'가구 깊이 (mm)',type:'number',def:600,min:300,step:10,group:'가구 깊이'},
 {key:'recycle',label:'명령 종료 후 재순환',type:'check',def:false,group:'기타'},
];
export const KCL_FIELDS=[...KITCHEN_FIELDS.slice(0,2),{key:'cornerLength',label:'꺾인 쪽 길이 (mm, 코너 포함)',type:'number',def:1800,min:0,step:100,group:'가구 깊이'},...KITCHEN_FIELDS.slice(2)];
export const KITCHEN_SHARED_FIELDS=[{key:'layer',label:'주방가구 켜',type:'layer',def:'A-KTCH',group:'켜'}];
/** f: wallFrame(1점 시작 · 2점 끝 · 3점 안쪽 방향). corner 가 참이면(KCL) 시작점 쪽에 코너 복귀 사각형을 덧붙인다
 *  (원문 정리본이 말하는 "코너 모듈"을 두 점 밖 4번째 점 없이, 같은 3점 조작 안에서 표현한 것 · 보고서 참고). */
export function kitchenGeometry(f,length,depth,fridgeKey,layerName,corner=false){
 const b=builder(f,layerName),modules=kitchenModules(length,fridgeSize(fridgeKey).w);
 // 냉장고 칸은 가구 깊이가 아니라 냉장고 실제 깊이로(590L 이면 D730, 2026-10-27 설명서 시험).
 const fd=fridgeSize(fridgeKey).d||depth;
 for(const m of modules){
  const md=m.type==='fridge'?fd:depth;
  b.rect(m.s0,0,m.s1,md);
  if(m.type==='sink')b.rect(m.s0+40,depth*0.18,m.s1-40,depth*0.62);
  else if(m.type==='stove'){const n=(m.s1-m.s0)>=550?3:2;for(let i=0;i<n;i++){const cx=m.s0+(m.s1-m.s0)*(i+0.5)/n;b.circle(cx,depth*0.4,Math.min(depth,m.s1-m.s0)*0.13);}}
  else if(m.type==='fridge'){b.line(m.s0,0,m.s1,md);b.line(m.s1,0,m.s0,md);}
 }
 // corner: true = 코너 사각형만(예전), 숫자 = 꺾인 쪽 다리 길이(시작점 쪽 벽을 따라 안쪽으로). 2026-10-27 설명서 시험: 두 번째 다리가 없었다.
 if(corner){
  const legLen=typeof corner==='number'&&corner>depth?corner:depth;
  b.rect(-depth,0,0,legLen);
  for(let y=depth+600;y<legLen-1;y+=600)b.line(-depth,y,0,y); // 하부장 600 나눔
 }
 return {entities:b.list,modules,length,depth};
}
export function kitchenPreviewSvg(v,shared,opts={},corner=false){
 const length=1800,f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:1}),r=kitchenGeometry(f,length,v.depth,v.fridge,shared.layer,corner&&(Number(v.cornerLength)||true));
 const m=v.depth*0.05,marks=[{type:'circle',center:{x:0,y:0},radius:m,previewColor:'#ff9f68'},{type:'circle',center:{x:length,y:0},radius:m,previewColor:'#ff9f68'},{type:'circle',center:{x:length/2,y:v.depth*1.15},radius:m,previewColor:'#ff9f68'}];
 return entitiesSvg([...r.entities,...marks],{label:opts.compact?'':`예시 길이 1800 · 깊이 ${v.depth} · 냉장고 ${fridgeSize(v.fridge).label}`,colorOf:e=>e.cardLayer==='A-FURN'?'#f4a261':null,...opts});
}

/* ══════════════════════════ MTB1/MTB2 · 화장실 칸막이 그리기 (izzarder.com/221, MTB1)
   MTB2 는 원문·정리본 어디에도 별도 문서가 없다(izzarder.com/221 은 xiMakeToiletBooth1 하나만 기록).
   WebSearch 로도 "화장실 칸막이 그리기2"·xiMakeToiletBooth2 를 찾지 못했다. 정직하게: MTB2 는 MTB1 과 같은
   그리기 로직을 그대로 쓰고 변기종류 기본값만 다르게 등록했다(보고서 참고). ══════════════════════════ */
export function stallCount(length,stallWidth){
 if(!(stallWidth>0))throw Error('칸 폭은 0보다 커야 합니다.');
 const n=Math.floor((length+1e-6)/stallWidth);
 if(n<1)throw Error(`두 점 사이(${Math.round(length)}mm)가 칸 폭(${stallWidth}mm)보다 좁습니다.`);
 return n;
}
/** 칸막이 판이 서는 위치 인덱스(0..n, n+1 장) 중 mode 에 따라 뺄 것을 뺀다.
 *  none=모두없음(양끝 다 뺌) · noStart=시작없음(0번만 뺌) · noEnd=끝없음(n번만 뺌) · 그 외=모두 그림. */
export function partitionPositions(n,mode){
 const idx=Array.from({length:n+1},(_,i)=>i);
 if(mode==='none')return idx.filter(i=>i!==0&&i!==n);
 if(mode==='noStart')return idx.filter(i=>i!==0);
 if(mode==='noEnd')return idx.filter(i=>i!==n);
 return idx;
}
export const TOILET_FIELDS=[
 {key:'stallWidth',label:'칸 폭 (mm)',type:'number',def:900,min:400,step:10,group:'칸막이'},
 {key:'depth',label:'칸 깊이 (mm)',type:'number',def:1200,min:600,step:10,group:'칸막이'},
 {key:'thickness',label:'칸막이 두께 (mm)',type:'number',def:30,min:5,step:5,group:'칸막이'},
 {key:'endMode',label:'양끝 처리',type:'select',def:'none',options:[['none','모두없음'],['noStart','시작없음'],['noEnd','끝없음']],group:'칸막이'},
 {key:'toiletType',label:'변기종류',type:'select',def:'type1',options:[['type1','양식1(수조형)'],['type2','양식2(수조 없음)'],['type3','양식3(벽부형)']],group:'변기종류'},
];
export const TOILET_SHARED_FIELDS=[
 {key:'boothLayer',label:'칸막이 켜',type:'layer',def:'A-WALL-PRTN',group:'켜설정'},
 {key:'toiletLayer',label:'변기 켜',type:'layer',def:'A-SANI',group:'켜설정'},
];
function toiletPictogram(b,cx,depth,type,toiletLayer){
 const w=Math.min(depth*0.5,500),bowlY=depth*0.35;
 if(type==='type1')b.rect(cx-w*0.45,depth*0.78,cx+w*0.45,depth*0.95,{layer:toiletLayer}); // 수조는 양식1(수조형)만
 b.circle(cx,bowlY,w*0.42,{layer:toiletLayer});
 if(type==='type3')b.rect(cx-w*0.3,depth*0.85,cx+w*0.3,depth*0.98,{layer:toiletLayer});
}
export function boothGeometry(f,length,v,shared){
 const b=builder(f,shared.boothLayer),n=stallCount(length,v.stallWidth),boards=partitionPositions(n,v.endMode);
 for(const i of boards){const s=i*v.stallWidth;b.rect(s-v.thickness/2,0,s+v.thickness/2,v.depth);}
 for(let i=0;i<n;i++)toiletPictogram(b,i*v.stallWidth+v.stallWidth/2,v.depth,v.toiletType,shared.toiletLayer);
 return {entities:b.list,count:n};
}
export function toiletPreviewSvg(v,shared,opts={}){
 const length=v.stallWidth*3,f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:1}),r=boothGeometry(f,length,v,shared);
 const m=v.stallWidth*0.04,marks=[{type:'circle',center:{x:0,y:0},radius:m,previewColor:'#ff9f68'},{type:'circle',center:{x:length,y:0},radius:m,previewColor:'#ff9f68'},{type:'circle',center:{x:length/2,y:v.depth*1.15},radius:m,previewColor:'#ff9f68'}];
 return entitiesSvg([...r.entities,...marks],{label:opts.compact?'':`예시 3칸 · 칸 폭 ${v.stallWidth} · 깊이 ${v.depth}`,...opts});
}

/* ══════════════════════════ 화면 문맥이 필요한 명령들 ══════════════════════════ */
export function installOutputTools(ctx){
 /* 2026-09-24: 체크박스는 card-input isChecked(on·true·yes·1 = 켜짐)로 읽는다. */
 const flag=isChecked;
 const IME_AUTOCONVERT_KEY='barun-ime-autoconvert'; /* commands.js 와 같은 키(output-tools.test.js 가 확인) */

 /* CER — 미세하게 틀어진 도면 보정(izzarder.com/89) */
 function CER(){
  const TYPE_FIELDS=[['line','선'],['polyline','폴리선/사각형'],['dimension','치수'],['block','블럭'],['text','문자'],['circle','원'],['arc','호'],['ellipse','타원']];
  ctx.form('미세하게 틀어진 도면 보정 (CER)',[
   {name:'scope',label:'대상',type:'select',options:[['all','도면 전체(기본값)'],['selected','화면에서 선택된 객체']],value:'all'},
   ...TYPE_FIELDS.map(([k,label])=>({name:'t_'+k,label:'유형 · '+label,type:'checkbox',value:true})),
   {name:'blockInner',label:'블럭 내부 객체도 보정(항상 원점 0,0 기준)',type:'checkbox',value:false},
   {name:'roundRadius',label:'원·호 반지름도 보정',type:'checkbox',value:false},
   {name:'tol',label:'근사값 (mm)',type:'number',value:1},
   {name:'blockTol',label:'블럭 내부 근사값 (mm)',type:'number',value:0.1},
   {name:'useOrigin',label:'기준점: 원점(0,0) 사용(끄면 도면에서 점 찍기)',type:'checkbox',value:false},
  ],async values=>{
   const tol=Number(values.tol);if(!(tol>0))throw Error('근사값은 0보다 커야 합니다.');
   const blockTol=Number(values.blockTol);if(!(blockTol>0))throw Error('블럭 내부 근사값은 0보다 커야 합니다.');
   if(tol>1000||blockTol>1000)throw Error('근사값은 1000mm 이하로 입력하세요(너무 크면 객체가 한 점으로 뭉개집니다).');
   const types=TYPE_FIELDS.map(([k])=>k).filter(k=>flag(values['t_'+k])).flatMap(k=>k==='polyline'?['polyline','rectangle']:[k]);
   if(!types.length)throw Error('보정할 객체 유형을 하나 이상 고르세요.');
   const picked=values.scope==='selected'?ctx.selected():ctx.entities();
   if(values.scope==='selected'&&!picked.length)throw Error('먼저 보정할 객체를 화면에서 선택하세요.');
   const {editable:pool,skipped:lockedSkipped}=splitByLockedLayer(picked,ctx.layers()); /* 2026-09-24: 잠긴 켜 객체가 섞이면 엔진이 전체를 거부했다 */
   if(!pool.length&&lockedSkipped.length)throw Error(`보정할 객체(${lockedSkipped.length}개)가 모두 잠긴 켜에 있습니다. 켜 잠금을 푼 뒤 다시 실행하세요.`);
   if(!pool.length)return ctx.toast('보정할 객체가 없습니다.');
   let base={x:0,y:0};
   if(!flag(values.useOrigin)){const p=await ctx.pickPoint('보정 기준점을 클릭하세요(오스냅으로 정확히 찍으세요) · Esc = 원점(0,0) 사용');if(p)base=p;}
   const opts={tol,base,types,roundRadius:flag(values.roundRadius),blockInner:flag(values.blockInner),blockTol};
   const commands=[];
   for(const e of pool){const patch=correctionPatch(e,opts);if(Object.keys(patch).length){commands.push({type:'update',ids:[e.id],changes:patch});}}
   if(!commands.length)return ctx.toast('근사값 단위에서 이미 어긋나지 않았습니다. 바뀐 좌표가 없습니다.');
   ctx.execute({type:'batch',commands});ctx.refresh();
   ctx.toast(`객체 ${commands.length}개의 좌표를 근사값 ${tol}mm 단위로 보정했습니다${lockedSkipped.length?` · 잠긴 켜 객체 ${lockedSkipped.length}개는 건너뛰었습니다`:''} · Ctrl+Z 로 되돌리기`);
  });
 }

 /* PBD — 출력용 PLOT_BOX 모두 지우기(izzarder.com/102) */
 function PBD(){
  const layerIds=plotBoxLayerIds(ctx.layers());
  if(!layerIds.length)return ctx.toast('출력 박스 켜(A-PLOT · PLOT_BOX)가 없습니다.');
  const ids=entitiesOnLayers(ctx.entities(),layerIds);
  if(!ids.length)return ctx.toast('출력 박스 켜에 객체가 없습니다.');
  ctx.execute({type:'delete',ids});ctx.refresh();
  ctx.toast(`출력 박스 켜 객체 ${ids.length}개를 지웠습니다 · Ctrl+Z 로 되돌리기`);
 }

 /* SAB — 블럭파일로 저장, 0번 켜로 표준화(izzarder.com/514). 대화상자 없음, 원샷 파이프라인(원문과 같음). */
 function SAB(){
  const all=ctx.entities();
  if(!all.length)throw Error('블럭 파일로 정리할 객체가 없습니다.');
  const {editable:entities,skipped}=splitByLockedLayer(all,ctx.layers());
  if(!entities.length)throw Error(`모든 객체(${skipped.length}개)가 잠긴 켜에 있어 정리할 수 없습니다. LUK 등으로 켜 잠금을 푼 뒤 다시 실행하세요.`);
  const zero=ctx.ensureLayer('0','#ffffff');
  const {dx,dy}=sabTranslateDelta(entities);
  const commands=entities.map(e=>{
   const standardized=toZeroLayerStandard(G.translate(e,dx,dy),zero);
   const {id,type,...rest}=standardized;
   return {type:'update',ids:[e.id],changes:rest};
  });
  ctx.execute({type:'batch',commands});
  let purged=0;
  for(const l of ctx.layers()){
   if(l.id===zero||l.locked)continue;
   if(!ctx.entities().some(e=>e.layer===l.id)){try{ctx.execute({type:'layer.delete',id:l.id});purged++;}catch{}}
  }
  ctx.refresh();
  ctx.toast(`블럭 표준화 완료: 객체 ${entities.length}개를 0번 켜·ByLayer 색/선모양으로, 좌하귀를 (0,0)으로 옮겼습니다${purged?` · 빈 켜 ${purged}개 삭제`:''}${skipped.length?` · 잠긴 켜의 객체 ${skipped.length}개는 건너뛰었습니다`:''}. "저장"으로 블럭 파일을 만드세요. · Ctrl+Z 로 되돌리기`);
 }

 /* TBC — 배경색 흑/백 전환(izzarder.com/155). 대화상자 없음, Undo 대상 아님(원문과 같음). */
 function TBC(){
  const root=document.documentElement,next=nextBackgroundTheme(root.dataset.theme);
  root.dataset.theme=next;
  ctx.toast(`화면 배경을 ${next==='ivory'?'밝은 색(인쇄·발표용)':'어두운 색'} 으로 전환했습니다. 되돌리려면 TBC 를 다시 실행하세요.`);
 }

 /* EXP — 현재 작업폴더 탐색기로 열기(izzarder.com/108). project.folder 는 항상 빈 문자열이라, 원문의 DWGPREFIX 처럼
    지금 탭 도면 파일이 있는 폴더(ctx.drawingFilePath)를 기본값으로 채운다. 열거나 저장한 적 없는 새 도면이면 비워 두고 입력받는다.
    2026-10-06(봇 점검): 데스크톱 open-folder 는 없는 폴더를 만들고 열었다 — 오타 경로가 새 빈 폴더로 생기지 않도록 mustExist 로 연다. */
 function EXP(){
  const desktop=globalThis.window?.cadDesktop;
  if(!desktop?.openFolder)return ctx.toast('폴더 열기는 설치한 바른 CAD(윈도·맥)에서만 됩니다. 브라우저 화면에는 연결이 없습니다.',true);
  const current=folderOfPath(typeof ctx.drawingFilePath==='function'?ctx.drawingFilePath():'');
  ctx.form('작업폴더 탐색기로 열기 (EXP)'+(current?'':' · 이 도면은 아직 파일로 열거나 저장하지 않았습니다'),[
   {name:'folder',label:'열 폴더의 절대 경로 (예: D:\\프로젝트\\현장A · 맥은 /Users/이름/프로젝트/현장A)',type:'text',value:current},
  ],async values=>{
   const folder=String(values.folder||'').trim();
   if(!isAbsoluteFolderPath(folder))throw Error('절대 경로를 입력하세요 (예: D:\\프로젝트\\현장A · 맥은 /Users/이름/프로젝트/현장A)');
   try{await desktop.openFolder(folder,{mustExist:true});ctx.toast('탐색기로 열었습니다: '+folder);}
   catch(e){throw Error('폴더를 열지 못했습니다. '+ctx.userErrorMessage(e));}
  });
 }

 /* ON(izzarder.com/110)·OPA(izzarder.com/591) — 2026-09-24 검토(F13) 뒤 group-file-tools.js 에서 실제 동작으로 구현(열린 도면 탭 넘기기 · 파일에서 다시 읽기). */
 const groupFile=installGroupFileTools(ctx);
 const ON=groupFile.ON,OPA=groupFile.OPA;
 /* xiUnintall — 바른 CAD 리습 제거(izzarder.com/372, 목록 원문 표기 그대로 "xiUnintall"). architecture-command-pack.js
    75행의 미연결 명령 참고 목록이 이 명령의 표시 라벨을 이미 "보조명령 설정 초기화"로 바꿔 두었다(그 파일은
    고치지 않았고 라벨만 읽었다). 바른 CAD 리습 처럼 호스트 CAD 의 지원파일 경로·시작세트를 되돌릴 것이 바른 CAD 에는
    없으므로(독립 프로그램), 그 라벨이 가리키는 "카드 설정 초기화"로 만들었다. */
 function xiUnintall(){
  ctx.form('보조명령 설정 초기화 (BRUNINSTALL) · 바른 CAD 는 애드온이 아니라 독립 프로그램이라 "제거" 대신 카드 설정만 초기화합니다',[
   {name:'confirm',label:'카드 설정(WAL·문/창/개구부 등 칸 설정)을 모두 기본값으로 되돌립니다. 확인',type:'checkbox',value:false},
  ],values=>{
   if(!flag(values.confirm))throw Error('확인 체크박스를 선택해야 초기화됩니다.');
   const entries=[];for(let i=0;i<ctx.storage.length;i++){const k=ctx.storage.key(i);entries.push([k,ctx.storage.getItem(k)]);}
   const keys=filterBackupEntries(entries).map(([k])=>k);
   for(const k of keys)ctx.storage.removeItem(k);
   ctx.toast(`카드 설정 ${keys.length}개를 초기화했습니다. (다른 CAD 의 지원파일 경로·시작세트를 되돌리는 개념은 바른 CAD 에 없습니다 · 프로그램 제거는 윈도는 설정의 "앱", 맥은 응용 프로그램 폴더에서 하세요)`);
  });
 }
 /* AON/AOFF — 한영자동변환(izzarder.com/299, xiSetup 의 항목). 2026-09-24: 실제 스위치로 바꿨다.
    명령창의 한글 자모→영문 명령 변환(commands.js preprocessImeCommand)이 이 값을 읽는다(끔이면 입력을 그대로 둔다). */
 function AON(){
  ctx.storage.setItem(IME_AUTOCONVERT_KEY,'on');
  ctx.toast('AON · 한영 자동 변환을 켰습니다. 명령창에 한글 자판으로 친 명령(예: ㅣㅑㅜㄷ → LINE)을 영문 명령으로 읽습니다.');
 }
 function AOFF(){
  ctx.storage.setItem(IME_AUTOCONVERT_KEY,'off');
  ctx.toast('AOFF · 한영 자동 변환을 껐습니다. 명령창에 친 한글은 그대로 두고 명령으로 바꾸지 않습니다(다시 켜려면 AON).');
 }
 /* A0/A1 — 작업축 각도(izzarder.com/242). 2026-09-24: 실제 동작으로 바꿨다. 원문 SNAPANG 처럼 직교(F8) 입력이
    정한 각도로 돌아간 두 축을 따른다(snap-angle.js · app.js orthogonalInput). A0 는 0°(직각)로 되돌린다. */
 const orthoHint=()=>{const node=globalThis.document?.getElementById?.('ortho');return node&&!node.checked?' 직교(F8)를 켜면 이 각도로 그려집니다.':'';};
 function A0(){
  const before=getSnapAngle();
  setSnapAngle(0,ctx.storage);
  ctx.toast(`A0 · 작업 각도를 0°(직각)로 되돌렸습니다${before?`(이전 ${Number(before.toFixed(3))}°)`:''}. 직교 입력이 도면의 X·Y 축을 따릅니다.`);
 }
 function A1(){
  ctx.form('A1 · 작업 각도 변경 (SNAPANG)',[
   {name:'mode',label:'각도 지정 방법',value:'line',options:[['line','선 객체 선택'],['points','두 점 지정(폴리선 구간 등)'],['angle','각도 입력(도)'],['slope','경사도 입력(%)']]},
   {name:'value',label:'각도(도) 또는 경사도(%)',type:'number',value:0},
  ],values=>{
   const apply=(deg,how)=>{const v=setSnapAngle(deg,ctx.storage);ctx.toast(`A1 · 작업 각도를 ${Number(v.toFixed(3))}°로 바꿨습니다(${how}). 직교 입력이 이 각도의 두 축을 따릅니다(이 도면 탭에서만 · 프로그램을 다시 열면 0°, 상태표시줄 직교 단추에 각도 표시) · A0 로 되돌리기.${orthoHint()}`);};
   if(values.mode==='angle'||values.mode==='slope'){
    const n=Number(values.value);
    if(String(values.value??'').trim()===''||!Number.isFinite(n)||Math.abs(n)>1e6)throw Error('A1 · 각도·경사도에는 숫자를 입력하세요.');
    return apply(values.mode==='slope'?slopePercentToAngle(n):n,values.mode==='slope'?`경사도 ${n}%`:'입력값');
   }
   setTimeout(()=>{(async()=>{
    try{
     if(values.mode==='points'){
      const a=await ctx.pickPoint('A1 · 기준 방향의 첫 점을 지정하세요(선 위 끝점 등) · Esc 취소');if(!a)return;
      const b=await ctx.pickPoint('A1 · 기준 방향의 둘째 점을 지정하세요 · Esc 취소');if(!b)return;
      if(G.dist(a,b)<G.EPS)throw Error('A1 · 두 점이 같아 방향을 알 수 없습니다.');
      return apply(G.angle(G.sub(b,a)),'두 점');
     }
     const pre=ctx.selected().find(e=>e.type==='line');
     const line=pre||await ctx.pickEntity({prompt:'A1 · 각도 기준이 될 선을 선택하세요 · Esc 취소',types:['line']});
     if(!line)return;
     if(G.dist(line.points[0],line.points[1])<G.EPS)throw Error('A1 · 길이가 0인 선입니다.');
     apply(G.angle(G.sub(line.points[1],line.points[0])),'선 객체');
    }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
   })();},0);
  });
 }
 /* FCC — 사용 글꼴 모으기(izzarder.com/600). 위 fontUsageRows/formatFontReport 설명 참고. */
 async function FCC(){
  const rows=fontUsageRows(ctx.entities());
  const report=formatFontReport(rows);
  const stamp=new Date().toISOString().slice(0,10);
  downloadText(safeFileName(`사용글꼴_${stamp}`)+'.txt',report.text);
  let fontNote='';
  try{
   if(typeof fetch!=='function')throw Error('no fetch');
   const response=await fetch('fonts/NanumGothic-Regular.ttf');
   if(!response.ok)throw Error(String(response.status));
   const blob=await response.blob();
   const url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download='NanumGothic-Regular.ttf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
   fontNote=' · 바른 CAD 도면 글꼴 NanumGothic-Regular.ttf 도 함께 저장했습니다';
  }catch{fontNote=' · 내장 글꼴 파일은 이 화면에서 읽지 못해 목록만 저장했습니다';}
  ctx.toast(`FCC · 문자모양 ${rows.length}종의 글꼴 목록을 저장했습니다${report.externalFonts.length?` · 모아야 할 외부 글꼴 ${report.externalFonts.length}개(${report.externalFonts.slice(0,3).join(', ')}${report.externalFonts.length>3?' 외':''})`:''}${fontNote}.`);
 }
 /* MSL — 여러 도면 자동 정리(izzarder.com/265). 위 mslCleanupPlan 설명 참고. */
 async function MSL(){
  const yesNo=(name,label,value)=>({name,label,value,options:[['yes','예'],['no','아니요']]});
  const desk=globalThis.window?.cadDesktop,state=desk?.outputWindows?await desk.outputWindows():null;
  const tabs=state?outputTabs(state):globalThis.window?.cad?.drawings?.list?.()||[];
  const otherCount=(state?.windows||[]).filter(w=>w.id!==state.self).reduce((n,w)=>n+Math.max(1,w.drawings?.length||0),0);
  return ctx.form('MSL · 여러 도면 자동 정리',[
   {name:'scope',label:'대상',value:'current',options:[['current','현재 도면만'],...(tabs.length>1?[['all',`열린 도면 모두(${tabs.length}장)`]]:[])]},
   yesNo('points','포인트 객체 삭제','yes'),
   yesNo('emptyText','내용 없는 문자 삭제','yes'),
   {name:'deleteLayer',label:'이 켜의 모든 객체 삭제(비우면 안 함)',type:'text',value:''},
   yesNo('zeroLayer','모든 객체를 0번 켜·ByLayer 로','no'),
   yesNo('moveToOrigin','좌하귀를 0,0 으로 이동','no'),
   yesNo('purgeLayers','객체 없는 켜 삭제(퍼지)','yes'),
   ...(otherCount>0?[{name:'confirmAll',label:`열린 도면 모두 실행 전 확인 · 다른 칸 도면 ${otherCount}장 포함 · 객체가 삭제될 수 있습니다. 각 칸에서 Ctrl+Z 한 번으로 되돌릴 수 있습니다.`,type:'checkbox',value:false}]:[]),
  ],values=>{
   const opts={points:values.points==='yes',emptyText:values.emptyText==='yes',deleteLayerName:String(values.deleteLayer||'').trim(),zeroLayer:values.zeroLayer==='yes',moveToOrigin:values.moveToOrigin==='yes',purgeLayers:values.purgeLayers==='yes'};
   const cleanCurrent=()=>{
    return ctx.outputBatch?ctx.outputBatch(()=>cleanOutputDrawing(ctx,opts)):cleanOutputDrawing(ctx,opts);
   };
   const describe=c=>`삭제 ${c.removed} · 0번 켜 ${c.zeroed} · 이동 ${c.moved} · 켜 퍼지 ${c.purged}${c.skippedLocked?` · 잠긴 켜 객체 ${c.skippedLocked}개 건너뜀`:''}`;
   if(values.scope!=='all'){
    const apply=()=>{const c=cleanCurrent();ctx.refresh();ctx.toast(`MSL · 현재 도면 정리 완료(${describe(c)}) · Ctrl+Z 로 되돌리기`);return {results:[{name:'현재 도면',counts:c}],failures:[]};};
    return applyOutput(ctx,()=>({...apply(),applied:true}));
   }
   if(state){
    if(otherCount>0&&!flag(values.confirmAll))throw Error('다른 칸 도면을 포함한 정리 안내를 읽고 확인 체크박스를 선택하세요.');
    return deferOutput(ctx,async()=>{
     await ctx.beforeOutput?.();const r=await desk.cleanOutputWindows(outputWindowIds(tabs),opts);
     ctx.toast('MSL · 열린 도면 '+r.results.length+'장을 정리했습니다('+r.results.map(x=>x.name+': '+describe(x.counts)).join(' / ')+')'+(r.failures.length?' · 실패 '+r.failures.length+'장 — '+r.failures.join(' / '):'')+' · 각 도면을 저장하세요 · 각 칸에서 Ctrl+Z 한 번으로 되돌리기',r.failures.length>0);
     return {...r,applied:r.results.length>0};
    });
   }
   setTimeout(()=>{(async()=>{
    const drawings=globalThis.window?.cad?.drawings;
    const start=drawings.active(),results=[],failures=[];
    for(const tab of drawings.list()){
     try{drawings.select(tab.id);await new Promise(r=>setTimeout(r,30));results.push({name:tab.name,counts:cleanCurrent()});}
     catch(e){failures.push(`${tab.name}: ${ctx.userErrorMessage(e)}`);}
    }
    /* 시작 탭으로 돌아가기: 열린 창·작업 중이면 거부되므로 잠시 뒤 다시 시도하고, 끝내 못 돌아가면 알린다. */
    let restored=false,restoreError=null;
    for(let attempt=0;attempt<3&&!restored;attempt++){
     try{drawings.select(start);}catch(e){restoreError=e;}
     restored=drawings.active()===start;
     if(!restored)await new Promise(r=>setTimeout(r,200));
    }
    ctx.refresh();
    if(!restored)ctx.toast(`MSL · 정리를 시작한 도면 탭으로 돌아가지 못했습니다${restoreError?`(${ctx.userErrorMessage(restoreError)})`:''}. 지금 보이는 도면은 "${drawings.list().find(t=>t.id===drawings.active())?.name||'알 수 없음'}" 입니다 — 탭을 직접 눌러 돌아가세요.`,true);
    const otherWindows=globalThis.window?.cadDesktop?.windowShortcut?' · 다른 도면 창의 도면은 그 창에서 MSL 을 따로 실행하세요':'';
    ctx.toast(`MSL · 열린 도면 ${results.length}장을 정리했습니다(${results.map(r=>`${r.name}: ${describe(r.counts)}`).join(' / ')})${failures.length?` · 실패 ${failures.length}장 — ${failures.join(' / ')}`:''} · 각 도면을 저장하세요(원문의 "저장" 옵션은 탭의 모두 저장을 쓰세요).${otherWindows}`,failures.length>0);
   })().catch(e=>{console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);});},0);
  });
 }

 /* QQ — 열린 도면 일괄 닫기(izzarder.com/174). window.cad.drawings 로 목록만 얻을 수 있고 close API 가 없어,
    탭 UI 의 닫기(×) 버튼을 대신 눌러 닫는다. 저장 API 도 없어 "저장하고 모으기"류는 만들지 않고, 저장하지
    않은(dirty) 도면은 항상 건너뛴다(데이터 손실 방지) · 보고서 참고.
    2026-10-06(봇 점검): 예전에는 [적용] 콜백 안에서 바로 × 를 눌렀는데, 그때는 QQ 설정 창(form-dialog)이 아직 열려 있어
    app.js closeDrawingTab → tabSwitchAllowed 가 "열려 있는 설정·검토 창을 닫은 뒤…"로 거부했다. 그런데도 누른 개수로
    "닫았습니다"를 띄웠다. 이제 창이 닫힌 뒤에 누르고, 실제로 목록에서 사라진 개수만 성공으로 알린다. */
 async function QQ(){
  const drawings=globalThis.window?.cad?.drawings;
  if(!drawings)throw Error('열린 도면 목록을 가져올 수 없습니다.');
  const desk=globalThis.window?.cadDesktop;
  if(desk?.outputWindows){
    const state=await desk.outputWindows();
    if(!outputTabs(state).length)return {applied:false};
    return ctx.form('열린 도면 일괄 닫기 (QQ) · 저장하지 않은 도면은 건너뜁니다',[
     {name:'scope',label:'범위',type:'select',options:[['excludeCurrent','현재 도면 제외(기본값)'],['includeCurrent','현재 도면 포함'],['onlyCurrent','현재 도면만']],value:'excludeCurrent'},
    ],values=>deferOutput(ctx,async()=>{
     await ctx.beforeOutput?.();
     const all=outputTabs(state),active=all.find(t=>t.windowId===state.self&&t.active)||all.find(t=>t.windowId===state.self&&t.id===drawings.active?.())||all.find(t=>t.windowId===state.self);
     const targets=all.filter(t=>values.scope==='includeCurrent'||(values.scope==='onlyCurrent'?t===active:t!==active));
     if(!targets.length){ctx.toast('닫을 다른 도면이 없습니다.');return {applied:false,closed:[],dirty:[],failed:[],deferred:[]};}
     const ids=outputWindowIds(targets),names=new Map(targets.map(t=>[t.id,t.name]));
     const r=await desk.closeOutputWindows(ids,!!ctx.deferOutputClose,{targets});
     const pending=targets.filter(t=>r.deferred?.includes(t.windowId)).length;
     const message=qqResultMessage({requested:targets.length,closed:r.closed.length,failed:r.failed.length,dirtySkipped:r.dirty.length,names:r.failed.map(id=>names.get(id)||id),deferred:pending});
     ctx.toast(message.text,message.isError);
     if(r.deferred?.length)ctx.deferOutputClose(async delivery=>{
      const report=final=>{const message=qqResultMessage({requested:final.requested??targets.length,closed:final.closed.length,failed:final.failed.length,dirtySkipped:final.dirty.length,names:final.names||final.failed.map(id=>names.get(id)||id)});ctx.toast(message.text,message.isError);return final;};
      if(delivery?.rejected)return report(await desk.closeOutputWindows([],false,{previous:r,cancel:true}));
      try{await (ctx.beforeOutputClose||ctx.beforeOutput)?.();return report(await desk.closeOutputWindows(r.deferred,false,{targets,previous:r}));}
      catch(error){await desk.closeOutputWindows([],false,{previous:r,cancel:true}).then(report).catch(()=>{});throw error;}
     });
     return {...r,pending,applied:r.closed.length>0||pending>0};
    }),()=>ctx.toast('QQ · 취소했습니다. 닫은 도면이 없습니다.'));
   }
  const tabs=drawings.list();
  if(tabs.length<2)return ctx.toast(globalThis.window?.cadDesktop?.windowShortcut?'이 도면 창에는 닫을 다른 도면이 없습니다. 다른 도면 창은 탭 줄의 × 나 Ctrl+W 로 닫으세요.':'닫을 다른 도면이 없습니다.');
  const doc=()=>globalThis.document;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const clickClose=id=>{
   const wrapper=[...(doc()?.querySelectorAll?.('.drawing-tab')||[])].find(w=>w.querySelector('[data-drawing-id]')?.dataset.drawingId===id);
   const button=wrapper?.querySelector('.drawing-tab-close');
   if(!button)return false;
   button.click();return true;
  };
  const run=async(targetIds,dirtySkipped)=>{
   /* 설정 창이 닫힐 때까지 잠깐 기다린다(열린 창이 있으면 탭 닫기가 거부된다). */
   for(let i=0;i<20&&doc()?.querySelector?.('dialog[open]');i++)await sleep(25);
   const nameOf=new Map(drawings.list().map(t=>[t.id,t.name]));
   const r=await closeTabsVerified(targetIds,{list:()=>drawings.list(),clickClose,wait:()=>sleep(30)});
   const message=qqResultMessage({requested:targetIds.length,closed:r.closed.length,failed:r.failed.length,dirtySkipped:dirtySkipped+r.dirty.length,names:r.failed.map(id=>nameOf.get(id)||id)});
   ctx.toast(message.text,message.isError);
  };
  ctx.form('열린 도면 일괄 닫기 (QQ) · 저장하지 않은 도면은 건너뜁니다',[
   {name:'scope',label:'범위',type:'select',options:[['excludeCurrent','현재 도면 제외(기본값)'],['includeCurrent','현재 도면 포함'],['onlyCurrent','현재 도면만']],value:'excludeCurrent'},
  ],values=>{
   const now=drawings.list(),activeId=drawings.active(); /* 창을 연 사이 바뀐 저장 상태를 반영한다 */
   const targetIds=closableTabIds(now,values.scope,activeId);
   const dirtySkipped=dirtySkippedCount(now,values.scope,activeId);
   if(!targetIds.length)throw Error('닫을 수 있는(저장된) 도면이 없습니다. 저장하지 않은 도면은 먼저 저장하세요.');
   setTimeout(()=>{run(targetIds,dirtySkipped).catch(e=>{console.error('[card]',e);ctx.toast('QQ · 도면을 닫지 못했습니다. '+ctx.userErrorMessage(e),true);});},0);
  },()=>ctx.toast('QQ · 취소했습니다. 닫은 도면이 없습니다.'));
 }

 /* xiBackup — 사용자 설정 내보내기(izzarder.com/319) */
 function xiBackup(){
  ctx.form('사용자 설정 내보내기 (BRBACKUP) · 고른 묶음을 파일로 저장합니다',[
   {name:'name',label:'파일 이름',type:'text',value:'barun-cad-settings-backup'},
   ...Object.entries(SETTING_GROUPS).map(([key,g])=>({name:'g_'+key,label:'포함: '+g.label,type:'checkbox',def:true,value:true})),
  ],values=>{
   const entries=[];for(let i=0;i<ctx.storage.length;i++){const k=ctx.storage.key(i);entries.push([k,ctx.storage.getItem(k)]);}
   // 체크박스가 하나도 오지 않으면(화면 없는 실행) 모든 묶음. 화면에서는 끈 칸이 값 없이 오므로 켠 칸만.
   const anyBox=Object.keys(values).some(k=>k.startsWith('g_')),chosen=Object.keys(SETTING_GROUPS).filter(key=>!anyBox||flag(values['g_'+key]));
   if(!chosen.length)return ctx.toast('내보낼 묶음을 하나 이상 고르세요.',true);
   const file=exportSettings(entries,chosen,ctx.appVersion?.()||'');
   const data=file.data;
   if(!Object.keys(data).length)return ctx.toast('내보낼 카드 설정이 없습니다.',true);
   const blob=new Blob([JSON.stringify({...file,version:1,appVersion:file.version},null,1)],{type:'application/json'});
   const url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download=(String(values.name||'barun-cad-settings-backup').trim()||'barun-cad-settings-backup')+'.json';
   document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
   ctx.toast(`카드 설정 ${Object.keys(data).length}개 항목을 내보냈습니다.`);
  });
 }
 /* xiRestore — 사용자 설정 불러오기(izzarder.com/319) */
 function xiRestore(){
  const input=document.createElement('input');input.type='file';input.accept='application/json,.json';input.style.display='none';
  document.body.append(input);
  input.onchange=()=>{
   const file=input.files?.[0];input.remove();if(!file)return;
   const reader=new FileReader();
   reader.onload=()=>{
    try{
     const current=[];for(let i=0;i<ctx.storage.length;i++){const k=ctx.storage.key(i);current.push([k,ctx.storage.getItem(k)]);}
     const plan=planImport(parseSettingsFile(reader.result),current);
     if(!plan.apply.length)throw Error('백업 파일에 복원할 설정이 없습니다.');
     // 덮기 전에 지금 값을 따로 남긴다(설정이 엉키면 이 값으로 되돌릴 수 있다).
     if(plan.backup.length)ctx.storage.setItem(BEFORE_RESTORE_KEY,JSON.stringify({savedAt:new Date().toISOString(),data:Object.fromEntries(plan.backup)}));
     for(const [k,v] of plan.apply)ctx.storage.setItem(k,v);
     ctx.toast(`설정 ${plan.apply.length}개를 불러왔습니다${plan.backup.length?` · 덮인 ${plan.backup.length}개는 따로 남겼습니다`:''}${plan.skipped?` · 모르는 항목 ${plan.skipped}개는 건너뛰었습니다`:''}. 새로고침하면 모두 적용됩니다.`);
    }catch(e){ctx.toast('백업 파일을 읽지 못했습니다. '+ctx.userErrorMessage(e),true);}
   };
   reader.onerror=()=>ctx.toast('백업 파일을 읽지 못했습니다.',true);
   reader.readAsText(file);
  };
  input.click();
 }

 /* RLD — 출도 도장 넣기(izzarder.com/596) */
 function RLD(){
  return openCardDialog({ctx,title:'출도 도장 넣기 · RLD',storageKey:'barun-rld-card',fields:RLD_FIELDS,sharedFields:RLD_SHARED_FIELDS,slots:2,fixedNames:['RLD 기본'],
   preview:(v,shared,o)=>entitiesSvg(buildStamp(v,{x:0,y:0}).map(e=>({...e,cardLayer:shared.layer})),{label:o.compact?'':'주황 점 = 도장 중심',...o}),
   validate:v=>{if(!(Number(v.radius)>0))throw Error('도장 반지름은 0보다 커야 합니다.');},
   onGo:async(v,shared)=>{
    const p=await ctx.pickPoint('출도 도장을 놓을 중심점을 클릭하세요 · Esc 중단');
    if(!p)return null;
    const layerId=ctx.ensureLayer(shared.layer||'A-SYM','#ff6b6b');
    const entities=buildStamp(v,p).map(e=>({...e,layer:layerId}));
    const ids=ctx.execute({type:'addMany',entities});
    ctx.setSelected(ids);ctx.refresh();
    ctx.toast('출도 도장을 찍었습니다 · Ctrl+Z 로 되돌리기');
    return ids;
   },
   note:'점을 하나 찍으면 그 점이 도장의 중심이 됩니다.'});
 }

 /* KCI/KCL — 주방가구 그리기(izzarder.com/236 · /237) */
 function installKitchen(title,storageKey,fixedName,defaultFridge,corner){
  async function draw(v,shared){
   const previewOf=(points,cursor)=>{
    const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];
    try{
     const p3=pts[2]||G.add(pts[0],G.mul(G.normal(G.unit(G.sub(pts[1],pts[0]))),v.depth));
     const f=wallFrame(pts[0],pts[1],p3);
     return kitchenGeometry(f,G.dist(pts[0],pts[1]),v.depth,v.fridge,shared.layer,corner&&(Number(v.cornerLength)||true)).entities.map(e=>({...e,previewColor:'#f4a261'}));
    }catch{return [];}
   };
   const pts=(await ctx.pickPath({prompt:`${fixedName} · ① 시작점 ② 끝점 ③ 가구 안쪽(깊이) 방향 · Esc 중단`,preview:previewOf,minPoints:3,maxPoints:3}))?.points;
   if(!pts)return null;
   const f=wallFrame(pts[0],pts[1],pts[2]),r=kitchenGeometry(f,G.dist(pts[0],pts[1]),v.depth,v.fridge,shared.layer,corner&&(Number(v.cornerLength)||true));
   const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities)});
   ctx.toast(`${fixedName} · 길이 ${Math.round(G.dist(pts[0],pts[1]))}mm · 모듈 ${r.modules.length}개 · Ctrl+Z 로 되돌리기`);
   if(v.recycle)await draw(v,shared);
   return ids;
  }
  return ()=>openCardDialog({ctx,title,storageKey,fields:corner?KCL_FIELDS:KITCHEN_FIELDS,sharedFields:KITCHEN_SHARED_FIELDS,slots:2,fixedNames:[fixedName],slotDefaults:()=>({fridge:defaultFridge}),
   preview:(v,s,o)=>kitchenPreviewSvg(v,s,o,corner),onGo:(v,s)=>draw(v,s),
   note:'세 점: ① 시작점 ② 끝점 ③ 가구가 놓이는 안쪽(깊이) 방향. 냉장고는 시작점 쪽에 붙습니다.'+(corner?' ㄴ자 코너는 시작점 쪽에 깊이만큼의 복귀 사각형으로 표시합니다(원문에 정확한 코너 처리가 없어 근사함 · 보고서 참고).':'')});
 }

 /* MTB1/MTB2 — 화장실 칸막이 그리기(izzarder.com/221) */
 function installToilet(title,storageKey,fixedName,defaultToiletType){
  async function draw(v,shared){
   const previewOf=(points,cursor)=>{
    const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];
    try{
     const p3=pts[2]||G.add(pts[0],G.mul(G.normal(G.unit(G.sub(pts[1],pts[0]))),v.depth));
     const f=wallFrame(pts[0],pts[1],p3);
     return boothGeometry(f,G.dist(pts[0],pts[1]),v,shared).entities.map(e=>({...e,previewColor:'#6ec6ff'}));
    }catch{return [];}
   };
   const pts=(await ctx.pickPath({prompt:`${fixedName} · ① 시작점 ② 끝점 ③ 칸 안쪽(깊이) 방향 · Esc 중단`,preview:previewOf,minPoints:3,maxPoints:3}))?.points;
   if(!pts)return null;
   const f=wallFrame(pts[0],pts[1],pts[2]),r=boothGeometry(f,G.dist(pts[0],pts[1]),v,shared);
   const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities)});
   ctx.toast(`${fixedName} · 칸 ${r.count}개 · Ctrl+Z 로 되돌리기`);
   return ids;
  }
  return ()=>openCardDialog({ctx,title,storageKey,fields:TOILET_FIELDS,sharedFields:TOILET_SHARED_FIELDS,slots:2,fixedNames:[fixedName],slotDefaults:()=>({toiletType:defaultToiletType}),
   preview:(v,s,o)=>toiletPreviewSvg(v,s,o),onGo:(v,s)=>draw(v,s),
   note:'세 점: ① 시작점 ② 끝점 ③ 칸이 놓이는 안쪽(깊이) 방향.'});
 }

 /* 비평 11: 오류 처리는 app.js runCardCommand(보고·되돌리기 묶음) 한 곳에서 한다 — 모듈 안의 두 번째 감싸기는 뺐다. */
 const guard=fn=>fn;
 return {
  CER:guard(CER),PBD:guard(PBD),SAB:guard(SAB),TBC:guard(TBC),EXP:guard(EXP),ON,OPA,xiUnintall:guard(xiUnintall),AON:guard(AON),AOFF:guard(AOFF),A0:guard(A0),A1:guard(A1),FCC:guard(FCC),MSL:guard(MSL),QQ:guard(QQ),xiBackup:guard(xiBackup),xiRestore:guard(xiRestore),RLD,
  KCI:installKitchen('ㅡ자형 주방가구 그리기 · KCI','barun-kci-card','KCI 기본','none',false),
  KCL:installKitchen('ㄴ자형 주방가구 그리기 · KCL','barun-kcl-card','KCL 기본','f590',true),
  MTB1:installToilet('화장실 칸막이 그리기1 · MTB1','barun-mtb1-card','MTB1 기본','type1'),
  MTB2:installToilet('화장실 칸막이 그리기2 · MTB2 (원문에 별도 문서 없음 · MTB1과 같은 로직, 변기종류 기본값만 다름)','barun-mtb2-card','MTB2 기본','type2'),
 };
}
