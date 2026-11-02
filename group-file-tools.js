// 그룹·파일 도구 5개: GEE(그룹 수정) STL(다른 도면에서 가져오기) FLT(Z값 0으로) ON(다음 도면 열기) OPA(저장 없이 다시 열기).
// 2026-09-24 검토(F13): 이 다섯은 "아직 제공하지 않습니다" 안내만 하던 명령이다. 바른 CAD 구조 안에서 실제로 할 수 있는 동작으로 바꾼다.
// 근거: docs/izzarder-reference-20260921/references/18-etc.md(GEE /200 · FLT /341 · STL /464), 01-setup.md(ON /110 · OPA /591).
//
// - GEE: 엔진에 그룹 객체가 없어 객체의 `group` 속성(그룹 이름)으로 묶음을 나타낸다. 만들기(M)/추가/제거/여러 그룹해제(E)/
//        모든 그룹해제(A)/객체없는 그룹퍼지(P)/같은 그룹 전체 선택 을 제공한다.
// - FLT: 정점·중심·삽입점의 z 와 elevation 을 지운다(블록 안까지). 3D 검토 부재(model3d.elevation)는 선택 옵션으로만 0 으로 만든다.
// - STL: 다른 도면 파일(.bcad/.json, 설치본에서는 .dxf/.dwg 도 로컬 변환 엔진으로)을 읽어 켜·블록·치수모양을 골라 현재 도면에 복사한다.
// - ON : 열려 있는 다음 도면 탭으로 넘어간다(폴더 목록 API 가 없어 "폴더의 다음 파일" 대신 열린 도면 순서). 탭이 하나뿐이면 파일을 골라 연다.
// - OPA: 현재 도면을 저장하지 않고 파일에서 다시 읽어 그 내용으로 바꾼다(열린 도면에 원본 경로가 없어 파일을 한 번 고른다).
import * as G from './geometry.js';

/* ══════════════ GEE · 그룹 ══════════════ */
const hasGroup=e=>typeof e?.group==='string'&&e.group.trim()!=='';
/** 그룹 이름 → 객체 id 목록 */
export function groupMap(entities){
 const map=new Map();
 for(const e of entities||[]){if(!hasGroup(e))continue;const name=e.group.trim();if(!map.has(name))map.set(name,[]);map.get(name).push(e.id);}
 return map;
}
/** 겹치지 않는 새 그룹 이름(G1, G2, …). */
export function nextGroupName(entities,prefix='G'){
 const used=new Set([...groupMap(entities).keys()].map(n=>n.toUpperCase()));
 for(let i=1;i<100000;i++){const n=`${prefix}${i}`;if(!used.has(n.toUpperCase()))return n;}
 throw Error('새 그룹 이름을 만들 수 없습니다.');
}
export function validGroupName(raw){
 const name=String(raw??'').trim();
 if(!name)throw Error('그룹 이름을 입력하세요.');
 if(name.length>64)throw Error('그룹 이름은 64자 이하로 입력하세요.');
 return name;
}
/** 선택 객체를 그룹 name 에 넣는 갱신 명령. 이미 같은 그룹이면 건너뛴다. */
export function assignGroupPlan(entities,name){
 const n=validGroupName(name);
 return (entities||[]).filter(e=>!(hasGroup(e)&&e.group.trim()===n)).map(e=>({type:'update',ids:[e.id],changes:{group:n}}));
}
/** 그룹 표식을 지우는 갱신 명령. */
export function clearGroupPlan(entities){
 return (entities||[]).filter(hasGroup).map(e=>({type:'update',ids:[e.id],changes:{group:null}}));
}
/** 선택 객체가 속한 그룹들의 구성원 전체(선택 안 한 것 포함). */
export function membersOfGroups(all,selected){
 const names=new Set((selected||[]).filter(hasGroup).map(e=>e.group.trim()));
 return (all||[]).filter(e=>hasGroup(e)&&names.has(e.group.trim()));
}

/* ══════════════ FLT · Z값 0 ══════════════ */
const flatPoint=p=>{if(!p||typeof p!=='object')return {changed:false,value:p};const has='z' in p;const {z,...rest}=p;return {changed:has,value:rest};};
/** 한 객체의 z·elevation 을 지운 사본. 바꿀 것이 없으면 null. model3d 는 옵션이 켜진 경우에만 elevation 을 0 으로. */
export function flattenEntity(e,{model3d=false}={}){
 if(!e||typeof e!=='object')return null;
 let changed=false;const out={...e};
 if(Array.isArray(e.points)){const pts=e.points.map(p=>{const r=flatPoint(p);if(r.changed)changed=true;return r.value;});if(changed)out.points=pts;}
 for(const key of ['center','position','start','end']){if(e[key]){const r=flatPoint(e[key]);if(r.changed){changed=true;out[key]=r.value;}}}
 // z·elevation: 엔진 update 는 Object.assign 이라 키를 지울 수 없어 null 로 둔다(null·0·없음 모두 "평면").
 // thickness 는 이 엔진에서 벽 두께(wall.thickness, engine.js 검증 대상)라 건드리지 않는다(2026-09-24 검토자 지적 1).
 for(const key of ['z','elevation']){if(key in e&&e[key]!=null&&Number(e[key])!==0){changed=true;out[key]=null;}}
 if(model3d&&e.model3d&&Number.isFinite(e.model3d.elevation)&&e.model3d.elevation!==0){changed=true;out.model3d={...e.model3d,elevation:0};}
 if(Array.isArray(e.entities)){let inner=false;const list=e.entities.map(c=>{const f=flattenEntity(c,{model3d});if(f){inner=true;return f;}return c;});if(inner){changed=true;out.entities=list;}}
 return changed?out:null;
}
export function flattenPlan(entities,opts={}){
 const commands=[];let count=0;
 for(const e of entities||[]){
  const flat=flattenEntity(e,opts);
  if(!flat)continue;
  const {id,type,...changes}=flat;
  commands.push({type:'update',ids:[e.id],changes});count++;
 }
 return {commands,count};
}

/* ══════════════ STL · 다른 도면에서 가져오기 ══════════════ */
/** 원본 도면에서 가져올 수 있는 항목 목록. */
export function stealableItems(sourceDoc){
 const layers=(sourceDoc?.layers||[]).map(l=>l.name).filter(n=>typeof n==='string'&&n.trim());
 const blocks=(sourceDoc?.blocks||[]).map(b=>b.name).filter(n=>typeof n==='string'&&n.trim());
 const ds=sourceDoc?.dimStyles;
 const dimStyles=Array.isArray(ds)?ds.map(s=>s?.name).filter(Boolean):Object.keys(ds&&typeof ds==='object'?ds:{});
 return {layers:[...new Set(layers)],blocks:[...new Set(blocks)],dimStyles:[...new Set(dimStyles)]};
}
/** 켜·블록·치수모양을 현재 도면으로 복사할 명령 묶음. 블록 안 객체의 켜 id 는 이름으로 현재 도면 켜에 다시 맞춘다(없으면 켜를 함께 만든다). */
export function stealPlan(sourceDoc,targetDoc,{layers=[],blocks=[],dimStyles=[]}={}){
 const commands=[];const notes=[];
 const srcLayerById=new Map((sourceDoc?.layers||[]).map(l=>[l.id,l]));
 const targetLayerNames=new Set((targetDoc?.layers||[]).map(l=>l.name));
 const wantLayers=new Set(layers);
 // 블록이 쓰는 켜도 같이 가져와야 색·선종류가 유지된다.
 const chosenBlocks=(sourceDoc?.blocks||[]).filter(b=>blocks.includes(b.name));
 const walk=(list,fn)=>{for(const e of list||[]){fn(e);if(Array.isArray(e.entities))walk(e.entities,fn);}};
 for(const b of chosenBlocks)walk(b.entities,e=>{const l=srcLayerById.get(e.layer);if(l)wantLayers.add(l.name);});
 let addedLayers=0;
 for(const name of wantLayers){
  if(targetLayerNames.has(name))continue;
  const src=(sourceDoc?.layers||[]).find(l=>l.name===name);
  if(!src)continue;
  commands.push({type:'layer.add',name,color:src.color||'#ffffff'});
  addedLayers++;
  targetLayerNames.add(name);
 }
 const layerStyleFixes=[...wantLayers].map(name=>{const src=(sourceDoc?.layers||[]).find(l=>l.name===name);if(!src)return null;const changes={};if(src.linetype&&src.linetype!=='CONTINUOUS')changes.linetype=src.linetype;if(Number.isFinite(src.lineweight))changes.lineweight=src.lineweight;return Object.keys(changes).length?{name,changes}:null;}).filter(Boolean);
 let blockDefs=null,addedBlocks=0,replacedBlocks=0;
 if(chosenBlocks.length){
  const existing=(targetDoc?.blocks||[]).map(b=>structuredClone(b));
  for(const b of chosenBlocks){
   const copy=structuredClone(b);
   // 켜 id 는 부를 때 이름으로 다시 맞추므로 여기서는 원본 켜 이름을 적어 둔다.
   walk(copy.entities,e=>{const l=srcLayerById.get(e.layer);if(l)e.layerName=l.name;delete e.id;});
   const idx=existing.findIndex(x=>x.name===b.name);
   if(idx>=0){existing[idx]=copy;replacedBlocks++;}else{existing.push(copy);addedBlocks++;}
  }
  blockDefs=existing;
 }
 let dimStyleDefs=null,addedDim=0;
 if(dimStyles.length){
  const src=sourceDoc?.dimStyles;const srcMap=Array.isArray(src)?Object.fromEntries(src.filter(s=>s?.name).map(s=>[s.name,s])):(src||{});
  const tgt=targetDoc?.dimStyles;const merged=Array.isArray(tgt)?Object.fromEntries(tgt.filter(s=>s?.name).map(s=>[s.name,structuredClone(s)])):structuredClone(tgt||{});
  for(const name of dimStyles){if(!srcMap[name])continue;merged[name]={...structuredClone(srcMap[name]),name};addedDim++;}
  dimStyleDefs=merged;
 }
 return {commands,layerStyleFixes,blockDefs,dimStyleDefs,addedLayers,addedBlocks,replacedBlocks,addedDim,notes};
}
/** 원본 파일 내용(문자열)을 도면 문서로. .bcad/.json 만 여기서 읽는다. */
export function parseDrawingJson(text){
 let doc;
 try{doc=JSON.parse(String(text));}catch{throw Error('도면 파일(.bcad/.json) 내용을 읽을 수 없습니다.');}
 if(!doc||typeof doc!=='object'||!Array.isArray(doc.entities)||!Array.isArray(doc.layers))throw Error('바른 CAD 도면 형식(.bcad)이 아닙니다.');
 return doc;
}

/* ══════════════ ON · 다음 도면 ══════════════ */
export function nextDrawingId(tabs,activeId){
 const list=(tabs||[]).map(t=>t.id);
 if(list.length<2)return null;
 const i=list.indexOf(activeId);
 return list[(i+1)%list.length];
}

/* ══════════════ 설치 ══════════════ */
/** env: {desktop:window.cadDesktop, cad:window.cad, document} 를 시험에서 바꿔 끼울 수 있게 한다. */
export function installGroupFileTools(ctx,env={}){
 const desktop=()=>env.desktop??globalThis.window?.cadDesktop;
 const cad=()=>env.cad??globalThis.window?.cad;
 const dom=()=>env.document??globalThis.document;
 const guard=fn=>async(...args)=>{try{await fn(...args);}catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}};
 const askForm=(title,fields)=>new Promise(resolve=>ctx.form(title,fields,async values=>{resolve(values);}));
 const currentDoc=()=>{try{const d=typeof ctx.document==='function'?ctx.document():cad()?.getDocument?.();if(d)return d;}catch{}return {entities:ctx.entities(),layers:ctx.layers(),blocks:ctx.blocks?.()||[],dimStyles:{}};};

 /* ── GEE ── */
 async function gee(){
  const selected=ctx.selected()||[];
  const all=ctx.entities();
  const groups=groupMap(all);
  const v=await askForm(`GEE · 그룹 수정 (izzarder.com/200) · 현재 그룹 ${groups.size}개 · 그룹 객체를 클릭하면 그룹 전체가 선택되고(PICKSTYLE 로 끔), DXF 로 내보내면 DXF 그룹으로 남습니다`,[
   {name:'mode',label:'작업',value:selected.length?'make':'select',options:[
    ['make','그룹만들기(M) · 선택 객체를 새 그룹으로'],
    ['add','추가 · 선택 객체를 아래 이름의 그룹에 넣기'],
    ['remove','제거 · 선택 객체를 그룹에서 빼기'],
    ['select','그룹 선택 · 선택 객체와 같은 그룹 전체 선택'],
    ['explode','여러 그룹해제(E) · 선택 객체가 속한 그룹 풀기'],
    ['explodeAll','모든 그룹해제(A)'],
    ['purge','객체없는 그룹퍼지(P)']]},
   {name:'name',label:'그룹 이름 (만들기·추가에 사용)',value:nextGroupName(all)},
  ]);
  const mode=v.mode;
  if(mode==='make'||mode==='add'){
   if(!selected.length)throw Error('그룹에 넣을 객체를 먼저 선택하세요.');
   const name=validGroupName(v.name);
   if(mode==='make'&&groups.has(name))throw Error(`그룹 "${name}"이(가) 이미 있습니다. 추가 작업을 쓰거나 다른 이름을 입력하세요.`);
   const commands=assignGroupPlan(selected,name);
   if(!commands.length){ctx.toast(`GEE · 선택 객체는 이미 그룹 "${name}"에 있습니다.`);return;}
   ctx.execute({type:'batch',commands});ctx.refresh?.();
   ctx.toast(`GEE · 객체 ${commands.length}개를 그룹 "${name}"에 ${mode==='make'?'묶었습니다':'추가했습니다'} · Ctrl+Z 로 되돌리기`);
   return;
  }
  if(mode==='remove'){
   if(!selected.length)throw Error('그룹에서 뺄 객체를 먼저 선택하세요.');
   const commands=clearGroupPlan(selected);
   if(!commands.length){ctx.toast('GEE · 선택 객체는 어느 그룹에도 속해 있지 않습니다.');return;}
   ctx.execute({type:'batch',commands});ctx.refresh?.();
   ctx.toast(`GEE · 객체 ${commands.length}개를 그룹에서 뺐습니다 · Ctrl+Z 로 되돌리기`);
   return;
  }
  if(mode==='select'){
   let seeds=selected;
   if(!seeds.length){const e=await ctx.pickEntity({prompt:'GEE · 그룹에 속한 객체를 하나 클릭하세요 · Esc 취소'});if(!e)return;seeds=[e];}
   const members=membersOfGroups(all,seeds);
   if(!members.length)throw Error('선택 객체가 속한 그룹이 없습니다. 먼저 그룹만들기(M)로 묶으세요.');
   ctx.setSelected(members.map(e=>e.id));ctx.refresh?.();
   const names=[...new Set(members.map(e=>e.group.trim()))];
   ctx.toast(`GEE · 그룹 ${names.join(', ')} 의 객체 ${members.length}개를 선택했습니다.`);
   return;
  }
  if(mode==='explode'){
   if(!selected.length)throw Error('풀 그룹의 객체를 먼저 선택하세요.');
   const members=membersOfGroups(all,selected);
   if(!members.length){ctx.toast('GEE · 선택 객체가 속한 그룹이 없습니다.');return;}
   const names=[...new Set(members.map(e=>e.group.trim()))];
   ctx.execute({type:'batch',commands:clearGroupPlan(members)});ctx.refresh?.();
   ctx.toast(`GEE · 그룹 ${names.length}개(${names.join(', ')})를 풀었습니다 · 객체 ${members.length}개 · Ctrl+Z 로 되돌리기`);
   return;
  }
  if(mode==='explodeAll'){
   const commands=clearGroupPlan(all);
   if(!commands.length){ctx.toast('GEE · 도면에 그룹이 없습니다.');return;}
   ctx.execute({type:'batch',commands});ctx.refresh?.();
   ctx.toast(`GEE · 그룹 ${groups.size}개를 모두 풀었습니다 · 객체 ${commands.length}개 · Ctrl+Z 로 되돌리기`);
   return;
  }
  ctx.toast(`GEE · 바른 CAD 그룹은 객체에 붙는 이름표라 객체 없는 빈 그룹이 생기지 않습니다. 지울 빈 그룹이 없습니다(현재 그룹 ${groups.size}개).`);
 }

 /* ── FLT ── */
 async function flt(){
  let targets=ctx.selected()||[];
  const v=await askForm('FLT · Z값 0으로 만들기 (izzarder.com/341)',[
   {name:'scope',label:'대상',value:targets.length?'selected':'all',options:[['selected',`선택 객체 (${targets.length}개)`],['all','도면 전체']]},
   {name:'model3d',label:'3D 검토용 부재(model3d)의 바닥 높이도 0 으로',type:'checkbox',value:''},
  ]);
  if(v.scope==='all')targets=ctx.entities();
  if(!targets.length)throw Error('Z값을 지울 객체가 없습니다. 객체를 선택하거나 도면 전체를 고르세요.');
  const {commands,count}=flattenPlan(targets,{model3d:v.model3d==='on'});
  if(!count){ctx.toast(`FLT · 객체 ${targets.length}개를 확인했지만 Z값·elevation 이 남아 있는 객체가 없습니다(이미 평면입니다).`);return;}
  ctx.execute({type:'batch',commands});ctx.refresh?.();
  ctx.toast(`FLT · 객체 ${count}개의 Z값·elevation 을 0 으로 만들었습니다(확인 ${targets.length}개) · Ctrl+Z 로 되돌리기`);
 }

 /* ── 파일 읽기(STL·OPA 공용) ── */
 async function pickSourceDocument(label){
  const d=desktop();
  if(d?.pickDrawingFiles){
   const paths=await d.pickDrawingFiles();
   if(!paths?.length)return null;
   const target=paths[0],name=String(target).split(/[\\/]/).at(-1);
   if(/\.(dxf|dwg)$/i.test(name)){
    if(!d.importDrawingPath)throw Error('DXF/DWG 변환 경로가 없습니다. .bcad 파일을 고르세요.');
    ctx.toast(`${label} · ${name} 을(를) 로컬 변환 엔진으로 읽고 있습니다…`);
    const result=await d.importDrawingPath(target);
    const doc=result?.document||result?.doc;
    if(!doc)throw Error('도면 변환 결과에 문서가 없습니다.');
    return {doc,name};
   }
   if(!d.readExternalFile)throw Error('파일 읽기 경로가 없습니다.');
   const item=await d.readExternalFile(target);
   const binary=typeof atob==='function'?atob(item.data):Buffer.from(item.data,'base64').toString('binary');
   const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
   return {doc:parseDrawingJson(new TextDecoder().decode(bytes)),name};
  }
  const doc=dom();
  if(!doc?.createElement)throw Error('파일을 고를 수 있는 화면이 없습니다.');
  return new Promise((resolve,reject)=>{
   const input=doc.createElement('input');input.type='file';input.accept='.bcad,.json';
   input.onchange=async()=>{try{const f=input.files?.[0];if(!f){resolve(null);return;}resolve({doc:parseDrawingJson(await f.text()),name:f.name});}catch(e){reject(e);}};
   input.oncancel=()=>resolve(null);
   input.click();
  });
 }

 /* ── STL ── */
 async function stl(){
  const src=await pickSourceDocument('STL');
  if(!src)return;
  const items=stealableItems(src.doc);
  const total=items.layers.length+items.blocks.length+items.dimStyles.length;
  if(!total)throw Error(`"${src.name}" 에는 가져올 켜·블록·치수모양이 없습니다.`);
  const cat=await askForm(`STL · 훔쳐오기 (izzarder.com/464) · 원본 "${src.name}"`,[
   {name:'category',label:'항목',value:items.blocks.length?'blocks':'layers',options:[['blocks',`Blocks (${items.blocks.length})`],['layers',`Layers (${items.layers.length})`],['dimStyles',`Dimension Styles (${items.dimStyles.length})`]]},
   {name:'filter',label:'이름 걸러내기 (비우면 전부 · * 허용)',value:''},
  ]);
  const list=items[cat.category]||[];
  const pattern=String(cat.filter||'').trim();
  const re=pattern?new RegExp('^'+pattern.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$','i'):null;
  const shown=list.filter(n=>!re||re.test(n)).slice(0,200);
  if(!shown.length)throw Error('조건에 맞는 항목이 없습니다.');
  const targetDoc=currentDoc();
  const existing=new Set(cat.category==='blocks'?(targetDoc.blocks||[]).map(b=>b.name):cat.category==='layers'?(targetDoc.layers||[]).map(l=>l.name):Object.keys(targetDoc.dimStyles||{}));
  const pick=await askForm(`STL · ${cat.category} · 가져올 항목을 고르세요${list.length>shown.length?` (앞 ${shown.length}개만 표시)`:''}`,[
   {name:'all',label:'모두 가져오기',type:'checkbox',value:''},
   ...shown.map((n,i)=>({name:'i'+i,label:n+(existing.has(n)?' (이미 있음 · 덮어씀)':''),type:'checkbox',value:''})),
  ]);
  const chosen=pick.all==='on'?shown:shown.filter((n,i)=>pick['i'+i]==='on');
  if(!chosen.length)throw Error('가져올 항목을 하나 이상 고르세요.');
  const plan=stealPlan(src.doc,targetDoc,{[cat.category]:chosen});
  const commands=[...plan.commands];
  if(plan.blockDefs){
   // 블록 안 객체의 켜 이름 → 현재 도면 켜 id (켜는 위에서 layer.add 로 먼저 만들어진다)
   ctx.execute({type:'batch',commands:commands.splice(0)});
   const byName=new Map(ctx.layers().map(l=>[l.name,l.id]));
   const fix=list=>{for(const e of list||[]){if(e.layerName){const id=byName.get(e.layerName);if(id)e.layer=id;delete e.layerName;}if(Array.isArray(e.entities))fix(e.entities);}};
   for(const b of plan.blockDefs)fix(b.entities);
   commands.push({type:'document.update',changes:{blocks:plan.blockDefs}});
  }
  if(plan.dimStyleDefs)commands.push({type:'document.update',changes:{dimStyles:plan.dimStyleDefs}});
  if(commands.length)ctx.execute({type:'batch',commands});
  if(plan.layerStyleFixes.length){
   const byName=new Map(ctx.layers().map(l=>[l.name,l.id]));
   const fixes=plan.layerStyleFixes.filter(f=>byName.has(f.name)).map(f=>({type:'layer.update',id:byName.get(f.name),changes:f.changes}));
   if(fixes.length){try{ctx.execute({type:'batch',commands:fixes});}catch(e){console.error('[card] STL 켜 선종류 반영 실패',e);}}
  }
  ctx.refresh?.();
  const parts=[];
  if(plan.addedLayers)parts.push(`켜 ${plan.addedLayers}개`);
  if(plan.addedBlocks||plan.replacedBlocks)parts.push(`블록 ${plan.addedBlocks}개 추가${plan.replacedBlocks?` · ${plan.replacedBlocks}개 덮어씀`:''}`);
  if(plan.addedDim)parts.push(`치수모양 ${plan.addedDim}개`);
  ctx.toast(`STL · "${src.name}" 에서 ${parts.join(' · ')||'가져온 항목 없음'} · Ctrl+Z 로 되돌리기`);
 }

 /* ── ON ── */
 async function on(){
  const drawings=cad()?.drawings;
  if(!drawings?.list)throw Error('열린 도면 목록을 읽을 수 없습니다(브라우저 화면 연결 없음).');
  const tabs=drawings.list(),active=drawings.active();
  const next=nextDrawingId(tabs,active);
  if(next){
   drawings.select(next);
   const tab=tabs.find(t=>t.id===next);
   ctx.toast(`ON · 다음 도면 "${tab?.name||''}" (${tabs.findIndex(t=>t.id===next)+1}/${tabs.length}) 으로 넘어갔습니다.`);
   return;
  }
  // 도면 칸마다 프로세스: 이 칸에 다음 도면이 없으면 다음 도면 칸으로 넘어간다.
  if(await globalThis.window?.cadDesktop?.windowShortcut?.('next')){ctx.toast('ON · 다음 도면 창으로 넘어갔습니다.');return;}
  const d=desktop();
  if(!d?.pickDrawingFiles)throw Error('열린 도면이 하나뿐입니다. 폴더의 다음 파일을 자동으로 찾는 기능은 없어, 파일을 열어 두고 ON 으로 차례로 넘기세요.');
  const src=await pickSourceDocument('ON');
  if(!src)return;
  if(!drawings.open)throw Error('새 도면 탭을 열 수 없습니다.');
  drawings.open(src.doc,src.name);
  ctx.toast(`ON · "${src.name}" 을(를) 새 탭으로 열었습니다. 다시 ON 을 누르면 다음 탭으로 넘어갑니다.`);
 }

 /* ── OPA ── */
 async function reloadCurrentFile(path){
  const name=String(path).split(/[\\/]/).at(-1);
  ctx.toast(`OPA · ${name} 을(를) 파일에서 다시 읽고 있습니다…`);
  const result=await ctx.readDrawingFile(path);
  const doc=result?.document||result?.doc;
  if(!doc)throw Error('도면 변환 결과에 문서가 없습니다.');
  return {doc,name};
 }
 async function opa(){
  const v=await askForm('OPA · 저장 없이 다시 열기 (izzarder.com/591)',[
   {name:'confirm',label:'현재 도면의 저장하지 않은 변경을 버리고 파일에서 다시 읽습니다. 확인',type:'checkbox',value:''},
  ]);
  if(v.confirm!=='on')throw Error('확인 체크박스를 선택해야 다시 엽니다.');
  // 2026-10-27: 파일에서 연 도면이면 그 파일을 바로 다시 읽는다(고르기 창은 새 도면처럼 경로가 없을 때만).
  const path=typeof ctx.drawingFilePath==='function'?ctx.drawingFilePath():'';
  const src=/\.(dxf|dwg)$/i.test(path)&&ctx.readDrawingFile?await reloadCurrentFile(path):await pickSourceDocument('OPA');
  if(!src)return;
  ctx.execute({type:'load',document:src.doc});
  ctx.setSelected?.([]);ctx.refresh?.();
  ctx.toast(`OPA · "${src.name}" 을(를) 파일 내용으로 다시 읽었습니다(저장 안 함) · 객체 ${src.doc.entities.length}개 · Ctrl+Z 로 되돌리기`);
 }

 return {GEE:guard(gee),STL:guard(stl),FLT:guard(flt),ON:guard(on),OPA:guard(opa)};
}
