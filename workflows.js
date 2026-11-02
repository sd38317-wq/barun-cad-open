import * as G from './geometry.js';
import {architecture,wallOpening,measure,formwork,simplify} from './architecture.js';
import {tableBlock,num,positive} from './studio.js';
import {buildRoomSchedule} from './room-schedule.js';
import {replaceBlock,cleanBlockDefinitions,blockCounts} from './block-tools.js';
import {blockCountMaintainer} from './block-count-live.js';
import {hatchEditChanges,hatchPatternChoices} from './hatch-patterns.js';
import {dimensionPreview} from './dimension-preview.js';
import {selectSimilar,describeSimilarMode} from './drafting-tools.js';
import {findMatcher,matchOptions,textSlots,findAll,planSlotEdits,lockedBy,literalReplacer,slotBounds,slotLabel,MATCH_MODES,SCOPE_MODES} from './text-find.js';
import {saveLayerState,layerStateCommands,deleteLayerState,listLayerStates,LAYER_STATE_KEYS,LAYER_STATE_LABELS} from './layer-states.js';


const p=(x,y)=>({x,y});
export function installWorkflows(studio){
 const c=studio.context,{engine,form,execute,field:f,pointFields,chosen,add,change,getSettings,toast,activeLayer,selected,refresh,api,output,pickFiles,b64,bytes,pickPoint}=c;
 const h=()=>getSettings().textHeight;
 const table=(rows,v,name)=>tableBlock(rows,{x:num(v.x),y:num(v.y),height:h(),layer:activeLayer(),name});
 const need=()=>{const es=chosen();if(!es.length)throw Error('객체를 먼저 선택하세요.');return es;};
 const selectedOrAll=()=>chosen().length?chosen():engine.doc.entities;
 const report=(rows,v,name)=>add([table(rows,v,name)]);
 const text=(value,v)=>({type:'text',layer:activeLayer(),position:p(num(v.x),num(v.y)),height:h(),text:value});
 const choices=(name,label,value,options)=>f(name,label,value,'text',options.map(a=>Array.isArray(a)?a:[a,a]));
 const number=(name,label,value)=>f(name,label,value,'number');
 const batch=commands=>execute({type:'batch',commands});
 const update=(e,changes)=>({type:'update',ids:[e.id],changes});
 // 522 찾기·바꾸기: 문자·치수 문자·블록 속성·표 칸·블록 안 문자를 text-find.js 공급자로 찾는다. 잠긴 레이어는 건너뛰고 센다.
 // '찾을 곳'을 '문자 객체만'으로 고르면 예전과 같다. 찾기만 하면 결과 목록에서 골라 그 위치로 확대·선택한다.
 const showHits=(hits,index,locked)=>form(`찾기 결과 ${hits.length}곳 · 고르고 [적용] = 그 위치로 확대·선택`,[
  choices('hit','결과',String(index),hits.map((s,k)=>[String(k),slotLabel(s,k)+(locked(s)?' · 잠김':'')])),
  choices('after','적용한 뒤','list',[['list','이 목록을 다시 열고 다음 결과를 고름'],['close','목록 닫기']])
 ],v=>{
  const k=Math.max(0,Math.min(hits.length-1,Math.trunc(num(v.hit)))),s=hits[k],e=engine.doc.entities.find(x=>x.id===s.id);
  if(!e)throw Error('그 객체가 도면에 없습니다(지워졌거나 바뀜). 다시 찾으세요.');
  selected().clear();selected().add(e.id);
  const b=slotBounds(e,s);if(b&&typeof c.zoomToBounds==='function')c.zoomToBounds(b);
  refresh();
  if(v.after==='list'&&hits.length>1)showHits(hits,(k+1)%hits.length,locked);
 });
 const findReplace=(pool,v)=>{
  const re=findMatcher(v.find,matchOptions(v.match)),scope=v.scope||'all',locked=lockedBy(engine.doc.layers);
  if(v.action==='find'){
   const hits=findAll(pool,re,{scope});
   if(!hits.length){toast(`"${v.find}"을(를) 찾지 못했습니다.`);return;}
   showHits(hits,0,locked);return;
  }
  const swap=literalReplacer(re,v.replace),plan=planSlotEdits(pool,s=>swap(s.value),{locked,scope});
  const notes=(plan.skippedLocked?` 잠긴 레이어 ${plan.skippedLocked}곳은 건너뛰었습니다.`:'')+(plan.guarded?` 치수 측정값 자리(<>)를 지우는 ${plan.guarded}곳은 바꾸지 않았습니다.`:'');
  if(!plan.updates.length){toast(`바꿀 곳이 없습니다.${notes}`);return;}
  execute({type:'updateMany',updates:plan.updates});
  toast(`찾아 바꾸기 · 객체 ${plan.updates.length}개 ${plan.edits.length}곳을 바꿨습니다.${notes} Ctrl+Z 로 되돌립니다.`);
 };
 const hasSlots=pool=>pool.some(e=>{for(const s of textSlots(e))if(s.value)return true;return false;});
 const textEditor=(defaultAction='replace')=>{
  const pool=selectedOrAll(),texts=pool.filter(e=>e.type==='text');
  if(!texts.length&&!(defaultAction==='replace'&&hasSlots(pool)))throw Error('문자가 없습니다.');
  form('문자 일괄 편집 · 선택 없으면 전체',[
   choices('action','작업',defaultAction,[['replace','찾아 바꾸기'],['find','찾기만 (결과 목록 · 골라서 확대)'],['number','좌→우/위→아래 번호 매기기'],['increment','숫자 증감'],['merge','같은 높이·같은 줄 문자 합치기'],['count','문자 개수 결과 삽입'],['name','선택 도형에 가장 가까운 문자 이름 지정']]),
   f('find','찾을 문자열',''),f('replace','바꿀 문자열/번호 접두사',''),choices('match','찾는 방식','case',MATCH_MODES),choices('scope','찾을 곳 (찾기·바꾸기)','all',SCOPE_MODES),number('start','시작 번호/증감값',1),number('step','번호 증가 간격',1),...pointFields()
  ],v=>{
   if(v.action==='replace'||v.action==='find')return findReplace(pool,v);
   if(!texts.length)throw Error('문자가 없습니다.');
   const sorted=texts.toSorted((a,b)=>Math.abs(a.position.y-b.position.y)>h()?b.position.y-a.position.y:a.position.x-b.position.x);
   if(v.action==='count'){add([text('문자 '+texts.length.toLocaleString('ko-KR')+'개',v)]);return;}
   if(v.action==='name'){
    const es=need().filter(e=>e.type!=='text');
    batch(es.map(e=>{const b=G.bounds([e]),center=p((b.minX+b.maxX)/2,(b.minY+b.maxY)/2),nearest=texts.toSorted((a,b)=>G.dist(center,a.position)-G.dist(center,b.position))[0];return update(e,{name:nearest.text,attributes:{...e.attributes,name:nearest.text}});}));
    return;
   }
   if(v.action==='merge'){
    const groups=[];
    for(const e of sorted){let group=groups.find(g=>Math.abs(g[0].height-e.height)<.001&&Math.abs(g[0].position.y-e.position.y)<e.height*.25&&(g[0].rotation||0)===(e.rotation||0));if(!group){group=[];groups.push(group);}group.push(e);}
    const commands=[];
    for(const g of groups.filter(g=>g.length>1)){g.sort((a,b)=>a.position.x-b.position.x);commands.push(update(g[0],{text:g.map(e=>e.text).join(' ')}),{type:'delete',ids:g.slice(1).map(e=>e.id)});}
    batch(commands);return;
   }
   if(v.action==='replace'&&!v.find)throw Error('찾을 문자열을 입력하세요.');
   batch(sorted.map((e,i)=>update(e,{text:v.action==='number'?v.replace+(num(v.start)+i*num(v.step)):v.action==='increment'?e.text.replace(/-?\d+(?:\.\d+)?/g,x=>String(Number(x)+num(v.start))):e.text.split(v.find).join(v.replace)})));
  });
 };
 // ACAD200 703 레이어 상태: 무엇을 저장·되살릴지(마스크)·설명·목록·지우기. 예전 형식(레이어 표 배열)도 읽는다. 바뀌는 레이어만 고친다(되돌리기 한 번).
 const stateList=()=>listLayerStates(engine.doc).filter(s=>!s.hidden);
 const layerTools=(defaultAction='stateSave')=>form('레이어 병합·상태·표준',[
  choices('action','작업',defaultAction,[['stateSave','레이어 상태 저장'],['stateRestore','레이어 상태 복구'],['stateDelete','레이어 상태 지우기'],['merge','선택 객체 레이어를 현재 레이어로 합치기'],['standard','표준 레이어 표 붙여넣기']]),
  f('name','상태 이름 (저장·복구·지우기)',stateList()[0]?.name||'기본'),f('description','설명 (저장)',''),
  ...LAYER_STATE_KEYS.map(key=>({name:'mask_'+key,label:'저장·복구할 속성: '+LAYER_STATE_LABELS[key],type:'checkbox',value:true})),
  {name:'saved',label:'저장된 상태',type:'textarea',value:stateList().map(s=>`${s.name} · ${s.mask.map(k=>LAYER_STATE_LABELS[k]).join('·')}${s.description?' · '+s.description:''}`).join('\n')||'없음',readonly:true},
  f('rows','표준 레이어: 이름 TAB 색상 TAB 선굵기 (행 구분)','벽체\t#d6e6ed\t0.35','textarea')
 ],v=>{
  // 체크박스가 하나도 오지 않으면(예전 매크로·화면 없는 실행) 모든 속성으로 본다.
  const masked=LAYER_STATE_KEYS.filter(key=>['on','true','1',true].includes(v['mask_'+key])),mask=Object.keys(v).some(k=>k.startsWith('mask_'))?masked:[...LAYER_STATE_KEYS];
  if(v.action==='stateSave')change({layerStates:saveLayerState(engine.doc,v.name,{description:v.description,mask})});
  else if(v.action==='stateDelete')change({layerStates:deleteLayerState(engine.doc,v.name)});
  else if(v.action==='stateRestore'){
   const ls=engine.doc.layerStates?.[v.name];if(!ls)throw Error('저장된 상태가 없습니다.');
   if(!mask.length)throw Error('복구할 속성을 하나 이상 고르세요.');
   const commands=layerStateCommands(engine.doc,ls,{onlyKeys:mask,currentLayer:activeLayer()});
   if(commands.length)batch(commands);toast(`레이어 상태 "${v.name}" · 레이어 ${commands.length}개를 되살렸습니다.`);
  }else if(v.action==='merge')execute({type:'layer.merge',sources:[...new Set(need().map(e=>e.layer))],target:activeLayer()});
  else{
   const commands=[];
   for(const row of v.rows.trim().split('\n')){const [name,color='#79d4ff',weight='.25']=row.split('\t');if(!/^#[\da-f]{6}$/i.test(color))throw Error('색상은 #RRGGBB입니다.');const existing=engine.doc.layers.find(l=>l.name===name);if(existing)commands.push({type:'layer.update',id:existing.id,changes:{color,lineweight:num(weight)}});else commands.push({type:'layer.add',name,color,lineweight:num(weight)});}
   batch(commands);
  }
 });
 const hatchTools=(defaultAction='pattern')=>{
  const es=need(),firstHatch=es.find(e=>e.type==='hatch');
  form('해치 편집 · 무늬·축척·각도 / 경계·합치기·지목',[
   choices('action','작업',defaultAction,[['pattern','무늬·축척·각도 바꾸기 (여러 해치 한꺼번에)'],['boundary','선택 해치의 경계 추출'],['merge','겹치는 해치 영역 합집합'],['land','닫힌 경계에 지목 해치']]),
   choices('patternName','무늬','',[['','그대로 (축척·각도만)'],...hatchPatternChoices()]),
   f('scale','축척 · 빈칸 = 그대로 (바른 무늬 1 = 간격 100mm, 표준 무늬는 도면 축척값)',firstHatch?String(firstHatch.patternScale??firstHatch.hatchScale??((firstHatch.spacing??100)/100)):''),
   f('angle','각도 (도) · 빈칸 = 그대로',''),
   choices('land','지목','대',['대','전','답','임야','도로']),number('spacing','패턴 간격 mm',200)
  ],async v=>{
   if(v.action==='pattern'){
    const layers=new Map(engine.doc.layers.map(l=>[l.id,l]));
    const hs=es.filter(e=>e.type==='hatch'),ok=hs.filter(e=>!layers.get(e.layer)?.locked);
    if(!hs.length)throw Error('무늬를 바꿀 해치를 선택하세요.');
    if(!ok.length)throw Error('선택한 해치가 모두 잠긴 레이어에 있습니다.');
    const scale=String(v.scale??'').trim(),angle=String(v.angle??'').trim();
    if(!String(v.patternName||'').trim()&&!scale&&!angle)throw Error('바꿀 무늬·축척·각도 중 하나를 적으세요.');
    batch(ok.map(e=>update(e,hatchEditChanges(e,{name:v.patternName,scale:scale===''?null:Number(scale),angle:angle===''?null:Number(angle)}))));
    toast(`해치 ${ok.length}개의 무늬를 바꿨습니다.${hs.length-ok.length?` 잠긴 레이어 해치 ${hs.length-ok.length}개는 건너뛰었습니다.`:''} Ctrl+Z 로 되돌립니다.`);
    return;
   }
   if(v.action==='boundary'){
    const hs=es.filter(e=>e.type==='hatch');if(!hs.length)throw Error('경계를 추출할 해치를 선택하세요.');
    add(hs.flatMap(e=>[e.points,...(e.loops||[])].map(points=>({type:'polyline',closed:true,points}))));
   }else if(v.action==='merge'){
    const hs=es.filter(e=>e.type==='hatch');if(hs.length<2)throw Error('해치를 두 개 이상 선택하세요.');
    // 여러 영역 해치는 영역마다 나눠 보낸다(첫 루프만 바깥으로 보면 다른 영역이 구멍이 된다). 합친 결과는 해치 하나(여러 루프).
    const r=await api('regions',{regions:hs.flatMap(e=>G.hatchRegions(e).map(region=>({points:region.outer,loops:region.holes})))});
    const rings=r.regions.flatMap(region=>[region.points,...(region.loops||[])]);if(!rings.length)throw Error('병합한 해치 영역이 없습니다.');
    const entities=[{...hs[0],id:undefined,points:rings[0],loops:rings.slice(1)}];
    batch([{type:'delete',ids:hs.map(e=>e.id)},{type:'addMany',entities}]);
   }else{
    const spacing=positive(v.spacing,'간격'),angle={'대':45,'전':0,'답':90,'임야':30,'도로':135}[v.land];
    add(es.map(e=>{if(!(e.closed||e.type==='rectangle'))throw Error('닫힌 폴리선/사각형을 선택하세요.');return {type:'hatch',points:e.points,spacing,angle,solid:false,landCategory:v.land};}));
   }
  });
 };
 const nearestOnPath=(e,q)=>{
  let point=null,index=-1,distance=Infinity;
  for(const [i,[a,b]] of G.segments(e).entries()){
   const v=G.sub(b,a),vv=G.dot(v,v),t=vv?Math.max(0,Math.min(1,G.dot(G.sub(q,a),v)/vv)):0,c=G.add(a,G.mul(v,t)),gap=G.dist(c,q);
   if(gap<distance){point=c;index=i;distance=gap;}
  }
  return {point,index,distance};
 };
 const lineLength=(e)=>G.segments(e).reduce((sum,[a,b])=>sum+G.dist(a,b),0);
 const rebuildTable=(e,options)=>{
  const base=e.entities?.[0]?.points?.[0]||p(0,0),direction=e.entities?.[0]?.points?.[1]||p(1,0),next=e.entities?.[1]?.points?.[0]||p(0,-1),angle=G.angle(G.sub(direction,base)),reflected=G.cross(G.sub(direction,base),G.sub(next,base))>0;
  let made=tableBlock(options.rows,{height:options.height,widths:options.widths,rowHeight:options.rowHeight,align:options.align,merges:options.merges,layer:e.layer,name:e.name});
  if(reflected)made=G.mirror(made,p(0,0),p(1,0));made=G.translate(G.rotate(made,p(0,0),angle),base.x,base.y);return update(e,{entities:made.entities,table:made.table});
 };
 const tableTools=(defaultAction='content')=>{
  const tables=need();if(tables.some(e=>e.type!=='block'||!e.table))throw Error('바른 CAD 표 블록만 선택하세요.');const first=tables[0],meta=first.table,rowsText=meta.rows.map(row=>row.join('\t')).join('\n');
  form('표 내용·셀 병합·간격·정렬',[choices('action','작업',defaultAction,[['content','표 내용 바꾸기'],['merge','셀 범위 병합'],['unmerge','선택 셀 병합 해제'],['spacing','문자·행·열 간격'],['align','전체 셀 문자 정렬']]),f('rows','탭으로 열 구분, 줄바꿈으로 행 구분',rowsText,'textarea'),number('r1','시작 행 (1부터)',1),number('c1','시작 열 (1부터)',1),number('r2','끝 행',1),number('c2','끝 열',2),number('textHeight','문자 높이 mm',meta.height),number('rowHeight','행 높이 mm',meta.rowHeight??meta.height*2.2),f('widths','열 너비 mm (쉼표, 빈칸은 자동)',(meta.widths||[]).join(',')),choices('align','문자 정렬',meta.align||'left',[['left','왼쪽'],['center','가운데'],['right','오른쪽']])],v=>batch(tables.map(e=>{
   let rows=structuredClone(e.table.rows),height=e.table.height,widths=e.table.widths,rowHeight=e.table.rowHeight??height*2.2,align=e.table.align||'left',merges=structuredClone(e.table.merges||[]);
   if(v.action==='content'){rows=v.rows.trim().split(/\r?\n/).map(row=>row.split('\t').map(value=>value.trim()!==''&&Number.isFinite(Number(value))?Number(value):value));if(!rows.length||!rows.some(row=>row.length))throw Error('표 내용을 입력하세요.');const columns=Math.max(...rows.map(row=>row.length));widths=widths?.length===columns?widths:null;merges=[];}
   else if(['merge','unmerge'].includes(v.action)){let r1=num(v.r1)-1,c1=num(v.c1)-1,r2=num(v.r2)-1,c2=num(v.c2)-1;if(![r1,c1,r2,c2].every(Number.isInteger))throw Error('셀 번호는 정수입니다.');if(r2<r1)[r1,r2]=[r2,r1];if(c2<c1)[c1,c2]=[c2,c1];if(r1<0||c1<0||r2>=rows.length||c2>=Math.max(...rows.map(row=>row.length)))throw Error('셀 범위가 표를 벗어났습니다.');if(v.action==='merge'){if(r1===r2&&c1===c2)throw Error('두 셀 이상을 지정하세요.');if(merges.some(m=>!(r2<m.r1||r1>m.r2||c2<m.c1||c1>m.c2)))throw Error('기존 병합 범위와 겹칩니다. 먼저 병합을 해제하세요.');const values=[];for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++){const value=rows[r]?.[c];if(value!==undefined&&String(value).trim())values.push(String(value));if(r!==r1||c!==c1){rows[r]??=[];rows[r][c]='';}}rows[r1][c1]=values.join(' ');merges.push({r1,c1,r2,c2});}else{const before=merges.length;merges=merges.filter(m=>!(r1>=m.r1&&r1<=m.r2&&c1>=m.c1&&c1<=m.c2));if(merges.length===before)throw Error('지정한 셀은 병합되어 있지 않습니다.');}}
   else if(v.action==='spacing'){height=positive(v.textHeight,'문자 높이');rowHeight=positive(v.rowHeight,'행 높이');if(rowHeight<height*1.2)throw Error('행 높이는 문자 높이의 1.2배 이상이어야 합니다.');const columns=Math.max(...rows.map(row=>row.length));widths=v.widths.trim()?v.widths.split(',').map(value=>positive(value.trim(),'열 너비')):null;if(widths&&widths.length!==columns)throw Error('열 너비 개수가 표의 열 수와 다릅니다.');}
   else align=v.align;
   return rebuildTable(e,{rows,height,widths,rowHeight,align,merges});
  })));
 };
 Object.assign(studio.handlers,{
  ROOMSCHEDULE(){const ids=chosen().map(e=>e.id);form('실별 면적표 · 선택 경계 또는 전체 도면',[f('floor','층 (기존 실 정보 우선)','미지정'),f('holes','공제 레이어 이름 (쉼표 구분)','')],v=>{const result=buildRoomSchedule(engine.doc,{ids,floor:v.floor,holeLayers:v.holes.split(',').map(s=>s.trim()).filter(Boolean),layer:activeLayer(),height:h()});add([result.entity]);toast(result.summary);});},
  WALLCENTER(){const es=need().filter(e=>e.type==='wall');if(!es.length)throw Error('벽을 선택하세요.');add(es.map(e=>({type:'line',points:e.points,linetype:'CENTER'})));},
  DIMCONTINUE(){const e=need().find(e=>e.type==='dimension');if(!e||!['horizontal','vertical','aligned'].includes(e.mode))throw Error('기존 직선 치수를 선택하세요.');form('기존 치수에서 이어 그리기',pointFields(e.points[1].x+1000,e.points[1].y),v=>add([{...e,id:undefined,text:'',points:[e.points[1],p(num(v.x),num(v.y)),e.points[2]]}]));},
  TRIMEXTEND(){const es=need();if(es.length<2)throw Error('대상과 경계를 함께 선택하세요.');form('연장/자르기',[choices('target','편집 대상',es[0].id,es.map(e=>[e.id,e.type+' '+e.id.slice(0,8)])),choices('action','작업','trim',['trim','extend']),...pointFields()],v=>execute({type:v.action,id:v.target,boundaryIds:es.filter(e=>e.id!==v.target).map(e=>e.id),pick:p(num(v.x),num(v.y))}));},
  async WALLJOIN(){const walls=need().filter(e=>e.type==='wall');if(walls.length<2)throw Error('벽 두 개 이상을 선택하세요.');const r=await api('regions',{regions:walls.flatMap(e=>G.wallPolygons(e).map(points=>({points})))});const entities=r.regions.map(region=>({type:'hatch',layer:activeLayer(),...region,solid:true,spacing:100,angle:45}));batch([{type:'delete',ids:walls.map(e=>e.id)},{type:'add',entity:{type:'block',name:'접합 벽체',layer:activeLayer(),sourceWalls:walls,entities}}]);toast('벽 교차부 합집합 접합 완료. Undo로 원본 벽을 복원할 수 있습니다.');},
  EXCEL(){form('엑셀 왕복 · 객체ID를 유지해 속성 갱신',[choices('action','작업','export',[['export','선택 도면 표 → XLSX'],['table','XLSX → 도면 표'],['coordinates','XLSX X/Y 열 → 폴리선'],['attributes','XLSX 객체ID/속성 열 → 객체 갱신'],['layers','XLSX 이름/색상/선굵기 → 레이어']]),...pointFields()],async v=>{
    if(v.action==='export'){const es=need().filter(e=>e.table);if(!es.length)throw Error('도면 표 블록을 선택하세요.');for(const e of es){const r=await api('excel',{action:'export',rows:e.table.rows,formulas:e.table.formulas||[]});await output(r.data,(e.name||'도면표')+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}return;}
    pickFiles('.xlsx',false,async files=>{const r=await api('excel',{action:'import',data:await b64(files[0])}),rows=r.rows;if(rows.length<2)throw Error('헤더와 데이터 행이 필요합니다.');
      if(v.action==='table'){report(rows,v,files[0].name.replace(/\.xlsx$/i,''));return;}
      if(v.action==='coordinates'){const headers=rows[0].map(x=>String(x).trim().toLowerCase()),ix=headers.findIndex(x=>x==='x'||x==='x mm'),iy=headers.findIndex(x=>x==='y'||x==='y mm');if(ix<0||iy<0)throw Error('X, Y 열 헤더가 필요합니다.');add([{type:'polyline',points:rows.slice(1).map(r=>p(num(r[ix]),num(r[iy]))),closed:false}]);return;}
      if(v.action==='attributes'){const headers=rows[0].map(String);if(!['객체ID','id'].includes(headers[0]))throw Error('첫 열 헤더는 객체ID 또는 id입니다.');const seen=new Set();const commands=rows.slice(1).map(row=>{const e=engine.doc.entities.find(e=>e.id===row[0]);if(!e)throw Error('도면에 없는 객체ID: '+row[0]);if(seen.has(e.id))throw Error('중복 객체ID');seen.add(e.id);const attributes={...e.attributes},changes={};for(let i=1;i<headers.length;i++){const key=headers[i],value=row[i];if(['text','name'].includes(key))changes[key]=String(value);else if(['height','radius','thickness'].includes(key)&&key in e)changes[key]=positive(value,key);else attributes[key]=value;}return update(e,{...changes,attributes});});batch(commands);return;}
      if(v.action==='layers'){const commands=[];for(const row of rows.slice(1)){const [name,color='#79d4ff',weight=.25]=row;if(!name||!/^#[\da-f]{6}$/i.test(color))throw Error('이름/색상 #RRGGBB/선굵기 열이 필요합니다.');const l=engine.doc.layers.find(l=>l.name===name);if(l)commands.push({type:'layer.update',id:l.id,changes:{color,lineweight:num(weight)}});else commands.push({type:'layer.add',name,color,lineweight:num(weight)});}batch(commands);}
    });
  });},
  BUILDING(){form('매개변수 건축 요소',[choices('kind','요소','COLUMN',[['COLUMN','기둥'],['DOOR','문'],['WINDOW','창'],['STAIR','직선 계단'],['CURVESTAIR','곡선 계단'],['ELEVATOR','엘리베이터'],['INSULATION','단열'],['RAMP','경사로'],['SECTION','단면 기호'],['LEVEL','레벨'],['ARROW','화살'],['BREAKSYMBOL','생략'],['TITLE','타이틀'],['TEXTBOX','문자 박스'],['OPENINGTAG','창호 기호']]),...pointFields(),number('width','폭/길이 (mm)',1000),number('depth','깊이/두께 (mm)',1000),number('height','높이 (mm)',2100),number('rotation','회전 (도)',0),f('mark','부재/창호 번호 또는 문자','C1'),choices('shape','기둥 형상','rectangle',['rectangle','circle']),number('count','계단 단수',12),number('run','디딤판 (mm)',280),number('radius','곡선계단 안쪽 반지름 (mm)',1500),number('sweep','곡선계단 회전각 (도)',180),number('rise','경사로 상승 높이 (mm)',''),choices('wall','선택한 벽 개구부 연동','no',[['no','독립 삽입'],['yes','선택 벽 위 삽입점에서 문/창 폭만큼 개구부']])],v=>{
    const options={...v,textHeight:h()};for(const key of ['x','y','width','depth','height','rotation','count','run','radius','sweep','rise'])options[key]=num(v[key]);if(v.rise===''||v.rise==null)delete options.rise;
    if(v.kind==='INSULATION'){studio.context.startInsulation(options.depth);return;}
    let e=architecture(v.kind,options,activeLayer());
    const commands=[];
    if(v.wall==='yes'){
      const wall=need().find(e=>e.type==='wall');if(!wall)throw Error('벽을 하나 선택하세요.');if(!['DOOR','WINDOW'].includes(v.kind))throw Error('문/창에만 벽 연동을 사용하세요.');
      const length=G.dist(...wall.points),u=G.unit(G.sub(wall.points[1],wall.points[0]));
      const t=G.dot(G.sub(p(options.x,options.y),wall.points[0]),u)/length;
      if(engine.doc.layers.find(l=>l.id===wall.layer)?.locked)throw Error('연동 벽 레이어가 잠겨 있습니다.');
      e=wallOpening(v.kind,options,wall,p(options.x,options.y),activeLayer());
    }
    commands.push({type:'add',entity:e});batch(commands);
  });},
  ROOM(){const e=need()[0],m=measure(e);if(m.area<=0)throw Error('닫힌 실 경계를 선택하세요.');const b=G.bounds([e]);form('실 경계에 이름과 면적 태그 지정',[f('name','실명','거실'),f('floor','층','1F'),...pointFields((b.minX+b.maxX)/2,(b.minY+b.maxY)/2)],v=>{
    batch([update(e,{room:{name:v.name,floor:v.floor}}),{type:'add',entity:{...text(v.name+'\n'+(m.area/1e6).toFixed(2)+' ㎡',v),roomBoundary:e.id}}]);
  });},
  SCHEDULE(){form('선택 객체 또는 전체 도면 수량표',[choices('kind','종류','blocks',[['blocks','블록/창호별 수량'],['rooms','실별 면적표']]),...pointFields()],v=>{
    const es=selectedOrAll(),rows=[];
    if(v.kind==='rooms'){const result=buildRoomSchedule(engine.doc,{ids:chosen().map(e=>e.id),layer:activeLayer(),height:h(),position:p(num(v.x),num(v.y))});add([result.entity]);toast(result.summary);return;}
    else {rows.push(['분류','번호/이름','폭','높이','수량']);const groups=new Map();for(const e of es.filter(e=>e.type==='block')){const a=e.attributes||{};const key=JSON.stringify([e.category||'블록',a.mark||e.name,a.width||'',a.height||'']);groups.set(key,(groups.get(key)||0)+1);}for(const [key,count]of groups)rows.push([...JSON.parse(key),count]);}
    if(rows.length===1)throw Error('집계할 객체가 없습니다.');add([{...table(rows,v,'수량표'),scheduleKind:'blocks',scheduleIds:chosen().length?chosen().map(e=>e.id):null}]);
  });},
  DIMCHAIN(){const es=need(),live=typeof pickPoint==='function';
   return form('신속 치수 · 선택 도형 끝점/중심선',[choices('source','기준점','ends',[['ends','끝점'],['centers','객체 중심']]),choices('mode','치수 방향',live?'auto':'horizontal',live?['auto','horizontal','vertical','aligned']:['horizontal','vertical','aligned']),...(live?[]:pointFields()),number('denominator','주석 축척 1:',getSettings().denominator)],async v=>{
    const raw=es.flatMap(e=>v.source==='centers'?[e.center||e.position||(()=>{const b=G.bounds([e]);return b?p((b.minX+b.maxX)/2,(b.minY+b.maxY)/2):null;})()]:e.points?.slice(0,e.type==='line'?2:undefined)||[e.center||e.position]).filter(Boolean);
    if(raw.length<2)throw Error('서로 다른 기준점 두 개 이상이 필요합니다.');
    const box=G.bounds([{type:'polyline',points:raw}]),height=getSettings().paperTextHeight*positive(v.denominator,'축척');
    const make=cursor=>{
     let mode=v.mode;
     if(mode==='auto'){const ex=Math.max(box.minX-cursor.x,0,cursor.x-box.maxX),ey=Math.max(box.minY-cursor.y,0,cursor.y-box.maxY);mode=ex>ey?'vertical':'horizontal';if(!ex&&!ey)mode=box.maxX-box.minX>=box.maxY-box.minY?'horizontal':'vertical';}
     const k=mode==='vertical'?'y':'x',sorted=raw.toSorted((a,b)=>a[k]-b[k]),ps=sorted.filter((a,i)=>!i||Math.abs(a[k]-sorted[i-1][k])>.001);
     if(ps.length<2)throw Error('해당 치수 방향에 서로 다른 기준점 두 개 이상이 필요합니다.');
     return ps.slice(1).map((b,i)=>{const d={type:'dimension',mode,points:[ps[i],b,cursor],textHeight:height,layer:activeLayer()};return c.styledDimension?c.styledDimension(d):d;});
    };
    const cursor=live?await pickPoint({prompt:'치수선 위치 지정',preview:dimensionPreview(make)}):p(num(v.x),num(v.y));
    if(cursor)add(make(cursor));
   });
  },
  DIMSCALE(){const es=need().filter(e=>e.type==='dimension');if(!es.length)throw Error('치수를 선택하세요.');form('측정값을 유지하고 주석 크기만 변경',[number('scale','주석 축척 1:',getSettings().denominator)],v=>batch(es.map(e=>update(e,{textHeight:getSettings().paperTextHeight*positive(v.scale,'축척')}))));},
   DIMEDIT(){const es=need().filter(e=>e.type==='dimension');if(!es.length||es.some(e=>!['horizontal','vertical','aligned'].includes(e.mode)))throw Error('나누거나 합칠 직선 치수를 선택하세요.');
    form('치수 나누기/합치기',[choices('action','작업','split',[['split','첫 치수를 비율로 나누기'],['merge','선택한 직선 치수 합치기']]),number('ratio','분할 위치 비율 (0~1)',.5)],async v=>{
     let entities,remove;
     if(v.action==='split'){const e=es[0],t=num(v.ratio);if(t<=0||t>=1)throw Error('분할비는 0과 1 사이입니다.');const [a,b,pos]=e.points,m=G.add(a,G.mul(G.sub(b,a),t));entities=[{...e,id:undefined,points:[a,m,pos]},{...e,id:undefined,points:[m,b,pos]}];remove=[e.id];}
     else{if(es.length<2||es.some(e=>e.mode!==es[0].mode))throw Error('같은 방향의 직선 치수 두 개 이상을 선택하세요.');const first=es[0],u=G.unit(G.sub(first.points[1],first.points[0]));if(es.some(e=>Math.abs(G.cross(G.unit(G.sub(e.points[1],e.points[0])),u))>.001))throw Error('평행한 치수만 합칠 수 있습니다.');const pts=es.flatMap(e=>e.points.slice(0,2)).sort((a,b)=>G.dot(a,u)-G.dot(b,u));entities=[{...first,id:undefined,points:[pts[0],pts.at(-1),first.points[2]]}];remove=es.map(e=>e.id);}
     if(typeof pickPoint==='function'){const at=await pickPoint({prompt:'DIMEDIT · 편집 결과 확인 · 클릭하여 적용 · Esc 취소',preview:dimensionPreview(()=>entities)});if(!at)return;}
     batch([{type:'delete',ids:remove},{type:'addMany',entities}]);
    });
   },

  QUICKDIM(){return studio.handlers.DIMCHAIN();},
  DIMAFFIX(){const es=need();if(es.some(e=>e.type!=='dimension'))throw Error('치수만 선택하세요.');form('치수 측정값 앞뒤 문자',[f('prefix','접두어',''),f('suffix','접미어',' mm')],v=>batch(es.map(e=>update(e,{text:'',textTemplate:v.prefix+'<>'+v.suffix}))));},
  DIMSTYLEMERGE(){const es=need();if(es.length<2||es.some(e=>e.type!=='dimension'))throw Error('기준 치수를 포함해 치수 두 개 이상을 선택하세요.');const source=es[0],keys=['textHeight','precision','arrowSize','extensionOffset','extensionOvershoot','textGap','measurementScale','scale','textTemplate'];form('첫 치수의 스타일을 나머지 치수에 적용',[choices('template','사용자 치수문자','keep',[['keep','대상 치수의 접두·접미어 유지'],['copy','기준 치수의 접두·접미어 복사']])],v=>batch(es.slice(1).map(e=>{const changes={};for(const key of keys)if(key!=='textTemplate'||v.template==='copy')changes[key]=source[key];return update(e,changes);})));},
  DIMEXTENSION(){const es=need();if(es.some(e=>e.type!=='dimension'))throw Error('치수만 선택하세요.');form('치수 보조선과 문자 간격',[number('extensionOffset','보조선 시작 간격 mm',0),number('extensionOvershoot','치수선 밖 돌출 mm',100),number('textGap','치수선과 문자 간격 mm',75),number('arrowSize','화살표 크기 mm',100)],v=>{const changes={};for(const key of ['extensionOffset','extensionOvershoot','textGap']){changes[key]=num(v[key]);if(changes[key]<0)throw Error('간격은 0 이상입니다.');}changes.arrowSize=positive(v.arrowSize,'화살표 크기');batch(es.map(e=>update(e,changes)));});},
  DIMTEXTMOVE(){const es=need();if(es.some(e=>e.type!=='dimension'))throw Error('치수만 선택하세요.');const first=G.primitives(es[0]).find(e=>e.type==='text')?.position||es[0].points.at(-1);const build=cursor=>es.map(e=>update(e,{textPosition:cursor}));if(typeof pickPoint==='function')return pickPoint({prompt:'DIMTEDIT · 치수 문자를 끌 위치를 지정하세요',preview:dimensionPreview(cursor=>es.map(e=>({...e,textPosition:cursor})))}).then(cursor=>{if(cursor)batch(build(cursor));});form('치수 문자 위치 지정',[...pointFields(first.x,first.y)],v=>batch(build(p(num(v.x),num(v.y)))));},
   LEADER(){
    const make=(a,b,label)=>{const u=G.unit(G.sub(b,a)),n=G.normal(u),size=h()*.8;return {type:'block',name:'지시선',layer:activeLayer(),entities:[{type:'line',points:[a,b],layer:activeLayer()},{type:'polyline',points:[G.add(a,G.add(G.mul(u,size),G.mul(n,size*.3))),a,G.add(a,G.sub(G.mul(u,size),G.mul(n,size*.3)))],closed:false,layer:activeLayer()},{...text(label,b),leader:true}]};};
    return form('지시선',[...pointFields(),number('endX','문자 위치 X',2000),number('endY','문자 위치 Y',1000),f('text','지시 내용','마감 상세 참조')],async v=>{
     let a=p(num(v.x),num(v.y)),b=p(num(v.endX),num(v.endY));
     if(typeof pickPoint==='function'){
      a=await pickPoint({prompt:'첫 번째 지시선 점 지정'});if(!a)return;
      b=await pickPoint({prompt:'다음 점 지정',preview:dimensionPreview(cursor=>make(a,cursor,v.text))});if(!b)return;
     }
     add([make(a,b,v.text)]);
    });
   },
  TEXTEDIT(){textEditor();},
  FINDREPLACE(){textEditor('replace');},
  TEXTNUMBER(){textEditor('number');},
  TEXTINCREMENT(){textEditor('increment');},
  TEXTMERGE(){textEditor('merge');},
  TEXTCOUNT(){textEditor('count');},
  NEARTEXTNAME(){textEditor('name');},
  TEXTSTYLEMERGE(){const es=need();if(es.length<2||es.some(e=>e.type!=='text'))throw Error('기준 문자를 포함해 문자 두 개 이상을 선택하세요.');const source=es[0],keys=['height','rotation','align','widthFactor','textStyle','sourceFont','sourceBigFont','color','lineweight','linetype'];form('첫 문자의 스타일을 나머지 문자에 적용',[choices('rotation','회전값','copy',[['copy','회전도 함께 복사'],['keep','대상 회전 유지']])],v=>batch(es.slice(1).map(e=>{const changes={};for(const key of keys)if(key!=='rotation'||v.rotation==='copy')changes[key]=source[key];return update(e,changes);})));},
  TEXTAFFIX(){const es=need();if(es.some(e=>e.type!=='text'))throw Error('문자만 선택하세요.');form('선택 문자 접두·접미어',[f('prefix','앞에 붙일 문자',''),f('suffix','뒤에 붙일 문자',''),choices('duplicate','이미 붙은 문자','skip',[['skip','중복해서 붙이지 않기'],['repeat','항상 붙이기']])],v=>batch(es.map(e=>{let value=e.text;if(v.prefix&&(v.duplicate==='repeat'||!value.startsWith(v.prefix)))value=v.prefix+value;if(v.suffix&&(v.duplicate==='repeat'||!value.endsWith(v.suffix)))value+=v.suffix;return update(e,{text:value});})));},
  TEXTSPLIT(){const es=need();if(es.some(e=>e.type!=='text'))throw Error('문자만 선택하세요.');form('문자 내용을 여러 문자 객체로 나누기',[f('delimiter','나눌 문자 · 빈칸이면 공백',' '),choices('direction','배치 방향','horizontal',[['horizontal','문자 방향으로 가로'],['vertical','문자 아래로 세로']]),number('gap','삽입점 간격 mm',h()*1.5)],v=>{const gap=positive(v.gap,'간격'),commands=[],added=[];let total=0;for(const e of es){const delimiter=v.delimiter==='\\n'?'\n':v.delimiter,parts=(delimiter?e.text.split(delimiter):e.text.trim().split(/\s+/)).map(s=>s.trim()).filter(Boolean);if(parts.length<2)continue;total+=parts.length;const angle=(e.rotation||0)+(v.direction==='vertical'?-90:0),step=G.polar(gap,angle);commands.push(update(e,{text:parts[0]}));for(let i=1;i<parts.length;i++)added.push({...e,id:undefined,text:parts[i],position:G.add(e.position,G.mul(step,i))});}if(!total)throw Error('나눌 수 있는 문자가 없습니다. 구분 문자를 확인하세요.');if(added.length)commands.push({type:'addMany',entities:added});batch(commands);});},
  TEXTMASK(){const es=need();if(es.some(e=>e.type!=='text'))throw Error('문자만 선택하세요.');form('문자 뒤 도면 가리기',[choices('action','작업','on',[['on','배경 가리기 켜기'],['off','배경 가리기 끄기']]),number('padding','문자 바깥 여백 mm',h()*.25)],v=>{const enabled=v.action==='on',padding=enabled?num(v.padding):0;if(padding<0)throw Error('여백은 0 이상입니다.');batch(es.map(e=>update(e,{backgroundMask:enabled,maskPadding:padding})));});},
  ATTRIBUTETEXT(){const es=need();if(es.some(e=>e.type!=='block'||e.table||e.sharedBlock))throw Error('편집 가능한 일반 블록만 선택하세요.');form('블록 속성값과 표시 문자',[f('key','속성 이름','MARK'),f('value','속성값','A-1'),number('dx','블록 중심에서 X 이동 mm',0),number('dy','블록 중심에서 Y 이동 mm',0),number('height','문자 높이 mm',h())],v=>{const key=v.key.trim();if(!key)throw Error('속성 이름을 입력하세요.');const height=positive(v.height,'문자 높이'),dx=num(v.dx),dy=num(v.dy);batch(es.map(e=>{const b=G.bounds([e]),position=p((b.minX+b.maxX)/2+dx,(b.minY+b.maxY)/2+dy),attributes={...e.attributes,[key]:v.value},entities=[...(e.entities||[]).filter(child=>child.attributeTag!==key),{type:'text',layer:e.layer,position,height,text:v.value,align:'center',attributeTag:key}];return update(e,{attributes,entities});}));});},
  QUANTITY(){const es=need();form('선택 객체 면적/길이 산출표',pointFields(),v=>{const rows=[['객체','면적 ㎡','면적 평','길이 m']];let area=0,length=0;for(const e of es){const m=measure(e);area+=m.area;length+=m.length;rows.push([e.name||e.type,Number((m.area/1e6).toFixed(4)),Number((m.area/1e6*121/400).toFixed(4)),Number((m.length/1000).toFixed(4))]);}rows.push(['합계 (중복 포함)',area/1e6,area/1e6*121/400,length/1000]);report(rows,v,'면적 길이 산출표');});},
  FORMWORK(){const length=chosen().reduce((s,e)=>s+measure(e).length/1000,0);form('거푸집 산출 · 단위 m/㎡ · 산정 면을 선택하세요',[number('length','길이 m',length||10),number('height','높이 m',3),number('allowance','할증 %',0),number('rise','경사 높이 m',0),number('run','경사 수평길이 m',0),number('steps','계단 단수',0),number('tread','디딤판 m',0),number('riser','챌판 m',0),number('stairWidth','계단 폭 m',0),choices('stairMode','계단 산정 면','soffit',[['soffit','계단 하부 경사면'],['soffitRisers','하부 경사면 + 챌판'],['developed','디딤판 + 챌판 전개면']]),number('stairSides','계단 측면 입력 ㎡',0),number('openings','개구부 공제 ㎡',0),...pointFields()],v=>{const input=Object.fromEntries(['length','height','allowance','rise','run','steps','tread','riser','stairWidth','openings','stairSides'].map(k=>[k,num(v[k])]));const r=formwork({...input,stairMode:v.stairMode});report([['항목','입력/결과','단위'],...Object.entries(input).map(([k,n])=>[k,n,['steps'].includes(k)?'개':k==='allowance'?'%':k==='openings'?'㎡':'m']),['경사계수',r.slope,''],['벽면',r.wall,'㎡'],['계단면',r.stair,'㎡'],['순면적',r.net,'㎡'],['할증 포함',r.total,'㎡'],['계단 산식',r.stairFormula,''],['총 산식',r.formula,'']],v,'거푸집 산출서');});},
  CALCULATE(){const values=selectedOrAll().filter(e=>e.type==='text').flatMap(e=>(e.text.replaceAll(',','').match(/-?\d+(?:\.\d+)?/g)||[]).map(Number));form('도면 숫자 계산',[choices('action','작업','sum',[['sum','선택 문자 숫자 합계'],['multiply','A × B'],['divide','A ÷ B'],['pyToM','평 → ㎡'],['mToPy','㎡ → 평']]),number('a','A',0),number('b','B',1),...pointFields()],v=>{const a=num(v.a),b=num(v.b);if(v.action==='divide'&&b===0)throw Error('0으로 나눌 수 없습니다.');const result={sum:values.reduce((s,n)=>s+n,0),multiply:a*b,divide:a/b,pyToM:a*400/121,mToPy:a*121/400}[v.action];add([text(v.action+' = '+result.toLocaleString('ko-KR',{maximumFractionDigits:6}),v)]);});},
  RATIOS(){form('면적 입력 기반 건폐율·용적률 · 산입/제외 면적은 사용자가 확정',[number('site','대지면적 ㎡',1000),number('footprint','건축면적 ㎡',400),number('gross','용적률 산정 연면적 ㎡',1200),f('basis','적용 기준/산입 제외 근거','사용자 확정 면적'),...pointFields()],v=>{const site=positive(v.site,'대지면적'),footprint=num(v.footprint),gross=num(v.gross);if(footprint<0||gross<0)throw Error('면적은 0 이상입니다.');report([['항목','면적/비율'],['대지면적 ㎡',site],['건축면적 ㎡',footprint],['용적률 산정 연면적 ㎡',gross],['건폐율 %',footprint/site*100],['용적률 %',gross/site*100],['산식','각 산정면적 ÷ 대지면적 × 100'],['산입/제외 근거',v.basis]],v,'건폐율 용적률');});},
  EXWALL(){
   const es=need().filter(e=>['polyline','line','rectangle'].includes(e.type));
   if(!es.length)throw Error('기준선이 될 선·폴리선·사각형을 먼저 선택하세요.');
   form('외벽 다층 작도 · 기준선에서 구성선 만들기',[
    number('con','콘크리트 두께 mm',200),
    number('ins','단열재 두께 mm',90),
    number('fin','마감 두께 mm',12),
    choices('base','기준선 위치','struct',[['struct','구조체(콘크리트) 중심'],['wall','벽체 전체 중심']]),
    f('conLayer','콘크리트 레이어','CON'),
    f('insLayer','단열재 레이어','INS'),
    f('finLayer','마감 레이어','FIN'),
    ...pointFields(),
   ],v=>{
    const con=num(v.con),ins=num(v.ins),fin=num(v.fin);
    for(const [label,value] of [['콘크리트',con],['단열재',ins],['마감',fin]])
     if(!Number.isFinite(value)||value<0)throw Error(label+' 두께는 0 이상 숫자여야 합니다.');
    const total=con+ins+fin;
    if(total<=0)throw Error('두께를 하나 이상 입력하세요.');
    const side=p(num(v.x),num(v.y));
    if(!Number.isFinite(side.x)||!Number.isFinite(side.y))throw Error('단열재가 놓일 쪽의 점을 입력하세요.');
    // 기준선 위의 최근접점을 구해 반대쪽 점을 만든다. 오프셋 방향 지정에 쓴다.
    const closestOn=(e,q)=>{let best=null,bd=Infinity;
     for(const [a,b] of G.segments(e)){
      const d=G.sub(b,a),dd=G.dot(d,d),t=dd?Math.max(0,Math.min(1,G.dot(G.sub(q,a),d)/dd)):0;
      const c=G.add(a,G.mul(d,t)),gap=G.dist(c,q);
      if(gap<bd){bd=gap;best=c;}}
     return best;};
    // 안쪽 면에서 바깥으로 누적. 두께 0인 층은 빠지므로 선이 겹치지 않는다.
    const stack=[[con,v.conLayer],[ins,v.insLayer],[fin,v.finLayer]].filter(([t])=>t>0);
    let acc=v.base==='wall'?-total/2:-con/2;
    const plan=[[acc,stack[0][1]]];
    for(const [t,name] of stack){acc+=t;plan.push([acc,name]);}
    // 필요한 레이어를 먼저 만든다. 색은 콘크리트 회색·단열재 초록·마감 빨강.
    const palette={[v.conLayer]:'#9aa7b0',[v.insLayer]:'#7fd6a2',[v.finLayer]:'#e8776a'};
    const missing=[...new Set(plan.map(x=>x[1]))].filter(n=>!engine.doc.layers.some(l=>l.name===n));
    if(missing.length)batch(missing.map(name=>({type:'layer.add',name,color:palette[name]||'#ffd479',lineweight:.25})));
    const layerId=name=>{const l=engine.doc.layers.find(x=>x.name===name);
     if(!l)throw Error('레이어를 만들지 못했습니다: '+name);return l.id;};
    const entities=[];
    for(const e of es){
     const near=closestOn(e,side);
     if(!near)throw Error('기준선에서 방향을 정할 수 없습니다. 다른 선을 선택하세요.');
     const opposite={x:2*near.x-side.x,y:2*near.y-side.y};
     for(const [distance,name] of plan){
      if(Math.abs(distance)<1e-9){entities.push({...structuredClone(e),id:undefined,layer:layerId(name)});continue;}
      const made=G.offsetEntity(e,Math.abs(distance),distance>0?side:opposite);
      for(const one of (Array.isArray(made)?made:[made]))entities.push({...one,layer:layerId(name)});
     }
    }
    execute({type:'addMany',entities});
    toast('외벽 구성선 '+entities.length+'개 · 총 두께 '+total+'mm');
   });
  },
  MULTIOFFSET(){const es=need();form('여러 거리 오프셋',[f('distances','거리 목록 mm (쉼표 구분)','100,200,300'),...pointFields()],v=>{const ds=v.distances.split(',').map(x=>num(x));if(ds.length>100)throw Error('거리는 최대 100개입니다.');batch(ds.map(distance=>({type:'offset',ids:es.map(e=>e.id),distance,side:p(num(v.x),num(v.y))})));});},
  POLARARRAY(){const es=need();form('원/호 따라 배열',[...pointFields(),number('count','원본 포함 개수',6),number('angle','전체 회전각 (도)',360),choices('rotate','객체 방향','yes',[['yes','회전'],['no','방향 유지']])],v=>{const count=num(v.count),angle=num(v.angle),center=p(num(v.x),num(v.y));if(!Number.isInteger(count)||count<2||count>1000)throw Error('개수는 2~1000입니다.');const items=[];for(let i=1;i<count;i++)for(const e of es){const theta=angle*i/(Math.abs(angle)===360?count:count-1),rot=G.rotate(e,center,theta);if(v.rotate==='no'){const b=G.bounds([e]),base=p((b.minX+b.maxX)/2,(b.minY+b.maxY)/2),target=G.rotate({type:'point',position:base},center,theta).position;items.push(G.translate(e,target.x-base.x,target.y-base.y));}else items.push(rot);}add(items.map(e=>({...e,id:undefined})));});},
  // 325: 기본 '비슷한 것' = SELECTSIMILARMODE(설정, 기본 종류+레이어+이름)로 고른 객체 모두를 기준. 예전 한 가지 조건도 그대로.
  SELECTSIMILAR(){const refs=need(),e=refs[0],mode=Number(c.inputPrefs?.()?.selectSimilarMode??130);form('같은 조건 객체 선택',[choices('condition','조건','similar',[['similar','비슷한 것 ('+describeSimilarMode(mode)+')'],'type','layer','name','color','text','height'])],v=>{
    const visible=new Set(engine.doc.layers.filter(l=>l.visible&&!l.frozen).map(l=>l.id));
    const found=v.condition==='similar'?selectSimilar(engine.doc.entities,engine.doc.layers,refs,mode):engine.doc.entities.filter(a=>a[v.condition]===e[v.condition]&&!a.hidden&&visible.has(a.layer));
    selected().clear();found.forEach(a=>selected().add(a.id));refresh();toast(selected().size+'개 선택');});},
  SELECTRANGE(){form('좌표 범위로 객체 선택',[number('minX','최소 X',0),number('minY','최소 Y',0),number('maxX','최대 X',1000),number('maxY','최대 Y',1000),choices('mode','선택 방식','inside',[['inside','범위 안에 완전히 포함'],['crossing','범위와 닿거나 교차']])],v=>{
    const b={minX:num(v.minX),minY:num(v.minY),maxX:num(v.maxX),maxY:num(v.maxY)};if(b.maxX<=b.minX||b.maxY<=b.minY)throw Error('최대 좌표는 최소 좌표보다 커야 합니다.');
    const visible=e=>!e.hidden&&engine.doc.layers.some(l=>l.id===e.layer&&l.visible&&!l.frozen),inside=p=>p.x>=b.minX&&p.x<=b.maxX&&p.y>=b.minY&&p.y<=b.maxY;
    selected().clear();
    for(const e of engine.doc.entities.filter(visible)){const points=G.vertices(e),eb=G.bounds([e]);if(!points.length||!eb)continue;const hit=v.mode==='inside'?points.every(inside):eb.maxX>=b.minX&&eb.minX<=b.maxX&&eb.maxY>=b.minY&&eb.minY<=b.maxY;if(hit)selected().add(e.id);}
    refresh();toast(selected().size+'개 선택');
  });},
  SELECTBOUNDARY(){const boundary=need()[0],polygon=boundary.points;if(!polygon?.length||polygon.length<3||!(boundary.closed||['rectangle','hatch'].includes(boundary.type)))throw Error('닫힌 폴리선·사각형·해치를 경계로 선택하세요.');form('경계 안 객체 선택',[choices('mode','선택 방식','inside',[['inside','경계 안에 완전히 포함'],['crossing','경계와 닿거나 교차']])],v=>{
    const edge={type:'polyline',points:polygon,closed:true},contains=q=>G.inside(q,polygon)||G.entityDistance(edge,q)<1e-6,visible=e=>e.id!==boundary.id&&!e.hidden&&engine.doc.layers.some(l=>l.id===e.layer&&l.visible&&!l.frozen);
    const encloses=(e,q)=>e.type==='circle'?G.dist(e.center,q)<=e.radius:e.type==='hatch'||e.type==='rectangle'||e.type==='polyline'&&e.closed?G.inside(q,e.points):false;
    selected().clear();
    for(const e of engine.doc.entities.filter(visible)){const points=G.vertices(e);if(!points.length)continue;let hit=points.every(contains);if(!hit&&v.mode==='crossing'){hit=points.some(contains)||G.primitives(e).some(one=>G.intersections(one,edge).length)||encloses(e,polygon[0]);}if(hit)selected().add(e.id);}
    refresh();toast(selected().size+'개 선택');
  });},
  SIMPLIFY(){const es=need().filter(e=>e.type==='polyline');if(!es.length)throw Error('폴리선을 선택하세요.');form('허용 오차 이내에서 꼭짓점 줄이기',[number('tolerance','허용 오차 mm',5)],v=>batch(es.map(e=>{let points=simplify(e.closed?[...e.points,e.points[0]]:e.points,positive(v.tolerance,'오차'));if(e.closed)points=points.slice(0,-1);if(points.length<(e.closed?3:2))throw Error('경계가 무너집니다. 오차를 줄이세요.');return update(e,{points});})));},
  BREAKMULTI(){const es=need();if(es.some(e=>e.type!=='line'))throw Error('여러 선 끊기는 개별 직선만 지원합니다.');form('여러 직선의 같은 두 기준점 사이 끊기',[number('ax','첫 기준점 X',0),number('ay','첫 기준점 Y',0),number('bx','둘째 기준점 X',100),number('by','둘째 기준점 Y',0)],v=>batch(es.map(e=>({type:'break',id:e.id,a:p(num(v.ax),num(v.ay)),b:p(num(v.bx),num(v.by))}))));},
  TRIMBOUNDARY(){const es=need();if(es.length<2)throw Error('경계와 편집 대상을 함께 선택하세요.');form('하나의 기준 경계로 여러 객체 자르기·연장',[choices('boundary','기준 경계',es[0].id,es.map(e=>[e.id,(e.name||e.type)+' '+e.id.slice(0,8)])),choices('action','작업','trim',[['trim','선택 지점 쪽 자르기'],['extend','선택 끝 쪽 연장']]),...pointFields()],v=>{const targets=es.filter(e=>e.id!==v.boundary);if(!targets.length)throw Error('편집 대상이 없습니다.');batch(targets.map(e=>({type:v.action,id:e.id,boundaryIds:[v.boundary],pick:p(num(v.x),num(v.y))})));});},
  MULTIFILLET(){const es=need();if(es.length<2||es.some(e=>e.type!=='line'))throw Error('끝점이 이어진 직선 두 개 이상을 선택하세요.');form('이어진 직선 모서리 한 번에 모깎기',[number('radius','반지름 mm',100)],v=>{
    const radius=num(v.radius);if(!Number.isFinite(radius)||radius<0)throw Error('반지름은 0 이상입니다.');
    const near=(a,b)=>G.dist(a,b)<.001,adj=es.map(()=>[]);
    for(let i=0;i<es.length;i++)for(let j=i+1;j<es.length;j++)if(es[i].points.some(a=>es[j].points.some(b=>near(a,b)))){adj[i].push(j);adj[j].push(i);}
    if(adj.some(a=>a.length>2)||!adj.some(a=>a.length===1))throw Error('갈라지지 않은 열린 선 묶음만 연속 모깎기할 수 있습니다.');
    const order=[],start=adj.findIndex(a=>a.length===1);let previous=-1,current=start;
    while(current>=0&&!order.includes(current)){order.push(current);const next=adj[current].find(i=>i!==previous);previous=current;current=next??-1;}
    if(order.length!==es.length)throw Error('모든 선의 끝점이 하나의 열린 경로로 이어져야 합니다.');
    const oriented=[];
    for(let k=0;k<order.length;k++){const source=structuredClone(es[order[k]]),ps=source.points;if(!k){const next=es[order[1]];source.points=next.points.some(q=>near(ps[0],q))?[ps[1],ps[0]]:ps;}else source.points=near(ps[0],oriented[k-1].points[1])?ps:[ps[1],ps[0]];oriented.push(source);}
    const starts=oriented.map(e=>e.points[0]),ends=oriented.map(e=>e.points[1]),arcs=[];
    for(let i=0;i<oriented.length-1;i++){const made=G.corner(oriented[i],oriented[i+1],radius,false);ends[i]=made[0].points[1];starts[i+1]=made[1].points[0];if(made[2])arcs.push({...made[2],id:undefined});}
    const entities=oriented.map((e,i)=>({...e,id:undefined,points:[starts[i],ends[i]]}));batch([{type:'delete',ids:es.map(e=>e.id)},{type:'addMany',entities:[...entities,...arcs]}]);
  });},
  LENGTHADJUST(){const es=need();if(es.some(e=>!['line','polyline'].includes(e.type)||e.closed))throw Error('열린 선·폴리선만 길이를 조절할 수 있습니다.');form('선·폴리선 길이 조절',[choices('method','입력 방식','delta',[['delta','현재 길이에서 증감'],['total','전체 길이 지정']]),number('value','길이 또는 증감값 mm',100),choices('end','조절할 끝','finish',[['finish','끝점'],['start','시작점'],['both','양 끝']])],v=>batch(es.map(e=>{
    const current=lineLength(e),desired=v.method==='total'?positive(v.value,'길이'):current+num(v.value);if(!(desired>0))throw Error('조절 후 길이는 양수여야 합니다.');const delta=desired-current,points=structuredClone(e.points),parts=v.end==='both'?[['start',delta/2],['finish',delta/2]]:[[v.end,delta]];
    for(const [end,amount] of parts){const i=end==='start'?0:points.length-1,j=end==='start'?1:points.length-2,u=G.unit(G.sub(points[i],points[j])),segment=G.dist(points[i],points[j]);if(segment+amount<=G.EPS)throw Error('한 구간을 넘어 줄일 수 없습니다. 정점을 먼저 정리하세요.');points[i]=G.add(points[i],G.mul(u,amount));}
    return update(e,{points});
  })));},
  OBJECTALIGN(){const es=need();if(es.length<2)throw Error('정렬할 객체를 두 개 이상 선택하세요.');form('첫 객체 기준 정렬·전체 등간격',[choices('mode','정렬 방식','left',[['left','왼쪽 맞춤'],['centerX','가로 중심 맞춤'],['right','오른쪽 맞춤'],['bottom','아래 맞춤'],['centerY','세로 중심 맞춤'],['top','위 맞춤'],['distributeX','가로 등간격'],['distributeY','세로 등간격']])],v=>{
    const box=e=>G.bounds([e]),center=(b,key)=>(b[key==='x'?'minX':'minY']+b[key==='x'?'maxX':'maxY'])/2,commands=[];
    if(v.mode.startsWith('distribute')){if(es.length<3)throw Error('등간격은 객체 세 개 이상이 필요합니다.');const key=v.mode.endsWith('X')?'x':'y',sorted=es.toSorted((a,b)=>center(box(a),key)-center(box(b),key)),first=center(box(sorted[0]),key),last=center(box(sorted.at(-1)),key),gap=(last-first)/(sorted.length-1);for(let i=1;i<sorted.length-1;i++){const d=first+gap*i-center(box(sorted[i]),key);commands.push({type:'move',ids:[sorted[i].id],dx:key==='x'?d:0,dy:key==='y'?d:0});}}
    else{const ref=box(es[0]),axis=['left','centerX','right'].includes(v.mode)?'x':'y',value={left:ref.minX,centerX:(ref.minX+ref.maxX)/2,right:ref.maxX,bottom:ref.minY,centerY:(ref.minY+ref.maxY)/2,top:ref.maxY}[v.mode];for(const e of es.slice(1)){const b=box(e),at={left:b.minX,centerX:(b.minX+b.maxX)/2,right:b.maxX,bottom:b.minY,centerY:(b.minY+b.maxY)/2,top:b.maxY}[v.mode],d=value-at;commands.push({type:'move',ids:[e.id],dx:axis==='x'?d:0,dy:axis==='y'?d:0});}}
    batch(commands);
  });},
  DIVIDECOPY(){const es=need();form('두 기준점 사이 등분 복사 · 원본 포함',[number('x','원본 기준점 X',0),number('y','원본 기준점 Y',0),number('endX','마지막 기준점 X',1000),number('endY','마지막 기준점 Y',0),number('count','원본 포함 배치 수',5)],v=>{const count=num(v.count);if(!Number.isInteger(count)||count<2||count>1000)throw Error('배치 수는 2~1000의 정수입니다.');const a=p(num(v.x),num(v.y)),b=p(num(v.endX),num(v.endY)),step=G.mul(G.sub(b,a),1/(count-1)),items=[];for(let i=1;i<count;i++)for(const e of es)items.push({...G.translate(e,step.x*i,step.y*i),id:undefined});add(items);});},
  ANGLECOPY(){const es=need();form('기준점 주위 지정 각도 복사',[...pointFields(),f('angles','복사 각도 목록 (도, 쉼표 구분)','30,45,90')],v=>{const angles=v.angles.split(',').map(s=>num(s.trim())).filter(a=>Math.abs(a)>G.EPS);if(!angles.length||angles.length>360||angles.some(a=>!Number.isFinite(a)))throw Error('0이 아닌 각도를 1~360개 입력하세요.');const base=p(num(v.x),num(v.y));add(angles.flatMap(angle=>es.map(e=>({...G.rotate(e,base,angle),id:undefined}))));});},
  DOUBLEOFFSET(){const es=need();form('선택 객체 양쪽 오프셋',[number('distance','거리 mm',100),...pointFields()],v=>{const distance=positive(v.distance,'거리'),side=p(num(v.x),num(v.y)),items=[];for(const e of es){if(['circle','arc'].includes(e.type)){let u=G.unit(G.sub(side,e.center));if(!Number.isFinite(u.x))u=p(1,0);items.push(G.offsetEntity(e,distance,G.add(e.center,G.mul(u,e.radius+distance+1))),G.offsetEntity(e,distance,e.center));}else{const near=nearestOnPath(e,side);if(!near.point)throw Error('선·폴리선·원·호만 오프셋할 수 있습니다.');if(near.distance<G.EPS)throw Error('방향점은 객체 위가 아닌 한쪽에 지정하세요.');const opposite=G.sub(G.mul(near.point,2),side);items.push(G.offsetEntity(e,distance,side),G.offsetEntity(e,distance,opposite));}}add(items.map(e=>({...e,id:undefined})));});},
  CHAINOFFSET(){const es=need();form('같은 간격으로 연속 오프셋',[number('distance','간격 mm',100),number('count','생성 개수',3),...pointFields()],v=>{const distance=positive(v.distance,'간격'),count=num(v.count),side=p(num(v.x),num(v.y));if(!Number.isInteger(count)||count<1||count>100)throw Error('생성 개수는 1~100의 정수입니다.');const items=[];for(const e of es)for(let i=1;i<=count;i++)items.push({...G.offsetEntity(e,distance*i,side),id:undefined});add(items);});},
  PLINEEDIT(){const es=need();if(es.some(e=>e.type!=='polyline'))throw Error('폴리선만 정점 편집할 수 있습니다.');form('폴리선 정점·방향·닫힘 편집',[choices('action','작업','add',[['add','가까운 구간에 정점 추가'],['delete','가까운 정점 삭제'],['clean','중복·불필요 정점 정리'],['reverse','방향 뒤집기'],['close','닫기'],['open','열기']]),...pointFields(),number('tolerance','정리 허용 오차 mm',1)],v=>batch(es.map(e=>{let points=structuredClone(e.points),closed=e.closed;const q=p(num(v.x),num(v.y));if(v.action==='add'){const hit=nearestOnPath(e,q);if(!hit.point)throw Error('정점을 넣을 구간이 없습니다.');if(points.some(a=>G.dist(a,hit.point)<G.EPS))throw Error('기존 정점과 같은 위치입니다.');points.splice(hit.index+1,0,hit.point);}else if(v.action==='delete'){const index=points.map(a=>G.dist(a,q)).reduce((best,d,i,a)=>d<a[best]?i:best,0);if(points.length-1<(closed?3:2))throw Error('폴리선의 최소 정점 수보다 줄일 수 없습니다.');points.splice(index,1);}else if(v.action==='clean'){const tolerance=positive(v.tolerance,'허용 오차');points=points.filter((a,i)=>!i||G.dist(a,points[i-1])>G.EPS);points=simplify(closed?[...points,points[0]]:points,tolerance);if(closed)points=points.slice(0,-1);if(points.length<(closed?3:2))throw Error('경계가 무너집니다. 허용 오차를 줄이세요.');}else if(v.action==='reverse')points.reverse();else if(v.action==='close'){if(points.length<3)throw Error('정점 세 개 이상이어야 닫을 수 있습니다.');closed=true;}else closed=false;return update(e,{points,closed});})));},
  LAYERS(){layerTools();},
  LAYMERGE(){layerTools('merge');},
  LAYSTATE(){layerTools('stateSave');},
  LAYSTANDARD(){layerTools('standard');},
  LIBRARY(){form('공용 심볼 라이브러리',[choices('action','작업','save',[['save','선택 객체를 라이브러리에 저장'],['insert','이름으로 삽입']]),f('name','심볼 이름','심볼1'),...pointFields()],v=>{
    let library;try{library=JSON.parse(localStorage.getItem('barun-cad-symbols')||'{}');}catch{library={};}
    if(v.action==='save'){const es=need(),b=G.bounds(es);library[v.name]=es.map(e=>G.translate(e,-b.minX,-b.minY));localStorage.setItem('barun-cad-symbols',JSON.stringify(library));change({library});toast('라이브러리 저장');}
    else{const es=library[v.name]||engine.doc.library?.[v.name];if(!es)throw Error('심볼을 찾을 수 없습니다.');const remap=e=>({...e,layer:activeLayer(),...(e.entities?{entities:e.entities.map(remap)}:{})});add([{type:'block',name:v.name,entities:es.map(e=>remap(G.translate(e,num(v.x),num(v.y))))}]);}
  });},
  BLOCKREPLACE(){const blocks=need();if(blocks.length<2||blocks.some(entity=>entity.type!=='block'||entity.xref))throw Error('기준 블록 하나와 교체할 일반 블록을 선택하세요.');const source=blocks[0];batch(blocks.slice(1).map(target=>{const replacement=replaceBlock(source,target),{id,type,...changes}=replacement;return update(target,changes);}));toast((blocks.length-1)+'개 블록을 교체했습니다.');},
  BLOCKCLEAN(){const result=cleanBlockDefinitions(engine.doc);if(!result.removed.length){toast('정리할 미사용 블록 정의가 없습니다.');return;}change({blocks:result.blocks});toast('미사용 블록 정의 '+result.removed.length+'개를 정리했습니다.');},
  BLOCKBASE(){const blocks=need();if(blocks.some(entity=>entity.type!=='block'||entity.sharedBlock||entity.xref))throw Error('삽입점을 바꿀 편집 가능한 일반 블록만 선택하세요.');const origin=blocks[0].position||G.vertices(blocks[0])[0]||p(0,0);form('블록 삽입점 지정 · 표시 형상은 유지',[...pointFields(origin.x,origin.y)],v=>batch(blocks.map(entity=>update(entity,{position:p(num(v.x),num(v.y))}))));},
  BLOCKCOUNT(){const counts=chosen().length?blockCounts(chosen(),engine.doc.sharedBlocks):blockCountMaintainer.read(engine.doc);if(!counts.length)throw Error('집계할 블록이 없습니다.');form('블록 이름별 수량표',[...pointFields()],v=>report([['블록 이름','수량'],...counts.map(item=>[item.name,item.count])],v,'블록 수량표'));},
  BLOCKEXPORT(){const blocks=need();if(blocks.some(entity=>entity.type!=='block'))throw Error('내보낼 블록만 선택하세요.');return Promise.all(blocks.map(async(entity,index)=>{const doc=structuredClone(engine.doc);doc.entities=[structuredClone(entity)];doc.sheets=[];const result=await api('export',{document:doc}),name=(entity.name||'블록').replace(/[\\/:*?"<>|]/g,'_')+(blocks.length>1?'_'+String(index+1).padStart(2,'0'):'');await output(result.data,name+'.dxf','application/dxf');})).then(()=>toast('블록 '+blocks.length+'개를 DXF로 저장했습니다.'));},
  HATCHEDIT(){hatchTools();},
  HATCHMERGE(){hatchTools('merge');},
  LANDHATCH(){hatchTools('land');},
  TABLE(){form('표 붙여넣기 / 선택 문자에서 표 읽기',[choices('action','입력','paste',[['paste','탭 구분 표 붙여넣기'],['read','선택 문자 위치로 행/열 인식']]),f('rows','표 내용','번호\t항목\t수량\n1\t벽체\t10','textarea'),...pointFields()],v=>{let rows;
    if(v.action==='read'){const texts=need().flatMap(G.primitives).filter(e=>e.type==='text');if(!texts.length)throw Error('표의 문자 또는 문자 블록을 선택하세요.');const tolerance=Math.min(...texts.map(e=>e.height))*.5;const xs=[],ys=[];for(const e of texts){if(!xs.some(x=>Math.abs(x-e.position.x)<tolerance))xs.push(e.position.x);if(!ys.some(y=>Math.abs(y-e.position.y)<tolerance))ys.push(e.position.y);}xs.sort((a,b)=>a-b);ys.sort((a,b)=>b-a);rows=ys.map(()=>xs.map(()=>''));for(const e of texts){const col=xs.findIndex(x=>Math.abs(x-e.position.x)<tolerance),row=ys.findIndex(y=>Math.abs(y-e.position.y)<tolerance);rows[row][col]+=(rows[row][col]?' ':'')+e.text;}}
    else rows=v.rows.trim().split(/\r?\n/).map(r=>r.split('\t').map(x=>x.trim()!==''&&Number.isFinite(Number(x))?Number(x):x));report(rows,v,'도면 표');});},
  TABLEEDIT(){tableTools('content');},
  TABLECELLMERGE(){tableTools('merge');},
  TABLESPACING(){tableTools('spacing');},
  TABLEALIGN(){tableTools('align');},
  COORDINATES(){form('좌표 표 작도/내보내기',[choices('action','작업','draw',[['draw','붙여넣은 좌표로 폴리선 작도'],['export','선택 객체 꼭짓점 표 작성']]),f('rows','X TAB Y (mm, 한 행 한 점)','0\t0\n6000\t0\n6000\t4000','textarea'),choices('closed','닫기','no',[['no','열림'],['yes','닫힘']]),...pointFields()],v=>{if(v.action==='draw'){const points=v.rows.trim().split(/\r?\n/).map(row=>{const [x,y]=row.split(/[\t,]/);return p(num(x),num(y));});if(points.length<2)throw Error('좌표 두 개 이상');add([{type:'polyline',points,closed:v.closed==='yes'}]);}else report([['객체ID','점','X mm','Y mm'],...need().flatMap(e=>G.vertices(e).map((p,i)=>[e.id,i+1,p.x,p.y]))],v,'좌표표');});},
  ATTRIBUTES(){form('객체 속성표',[f('keys','속성 이름 (쉼표 구분)','mark,width,height,name'),...pointFields()],v=>{const keys=v.keys.split(',').map(s=>s.trim());report([['객체ID',...keys],...need().map(e=>[e.id,...keys.map(k=>e.attributes?.[k]??e.structural?.[k]??e[k]??'')])],v,'속성표');});},
 });
 return studio;
}
