// ACAD200 영역 6 명령 모음(블록·속성·데이터·외부 도면). 로직은 각 모듈에 있고 여기는 명령 창·실행만 잇는다.
//  BLOCKSTORAGE  블록 저장 방식(공유 정의/예전 사본)               601
//  BLOCKSHARE    같은 이름·모양의 사본형 블록 → 공유 정의 하나       605·607
//  BLOCKSTATS    참조를 펼치지 않고 객체·점·중첩 블록 수              603
//  BVSTATE       고른 객체에 가시성 상태 이름 달기(BLOCK 전에)         610
//  VISSTATE      공유 블록 참조의 가시성 상태 바꾸기                   610
//  ATTDEF·ATTSYNC·ATTEDIT  속성 정의 만들기·정의에 맞추기·값 고치기    611·612
//  DATAEXTRACTION 블록·속성 추출 표 만들기·갱신·CSV                   614
//  BLOCKSPOT(BCONVERT) 반복 도형 → 공유 블록                         615
//  BLOCKBROWSE   다른 도면의 블록 가져오기(곁 문서 캐시), BLOCKSIMILAR 비슷한 블록으로 교체   616·623
//  PICKSTYLE     그룹 선택(클릭하면 그룹 전체)                       621
//  DWGCOMPARE    다른 도면 파일과 비교해 구름 표시                     625
//  PDFATTACH     PDF 한 쪽을 밑그림으로                              620
//  INSUNITSDEF   단위 없는 원본의 기본 단위                          623
import * as G from './geometry.js';
import {tableBlock} from './studio.js';
import {migratePlainBlocks,sharedDefinitionStats,referenceStats,visibilityStates,attributeDefinitions,buildSharedRefIndex,referencesOf} from './shared-blocks.js';
import {attsyncPlan,attributeEditChanges} from './block-tools.js';
import {runExtraction,staleExtractionTables,extractionCsv,normalizeSpec} from './data-extraction.js';
import {planBlockSpot,blockSpotCommand,similarDefinitions} from './block-spot.js';
import {prefGet,prefSet,createSideDocPool,importSideBlock} from './side-docs.js';
import {unitConversion,UNIT_NAMES,unitHint} from './units.js';
import {compareDocs,revisionCloud} from './drawing-compare.js';
import {underlayDefinition,underlayReference,UNDERLAY_LAYER} from './underlay.js';

/* ── 611 삽입 도우미(앱 INSERT) ── */
export function sharedDefinitionForInsert(doc,name){
  const template=(doc.blocks||[]).find(block=>block.name===name);
  return template?.sharedBlock?doc.sharedBlocks?.[template.sharedBlock]||null:null;
}
/** 묻지 않는 속성 값: 사전설정은 기본값. 상수는 참조에 두지 않는다(정의에서 그린다). */
export function promptlessAttributes(entities){
  const out={};for(const entity of entities||[])if(entity?.attdef&&!entity.attdef.constant&&entity.attdef.preset)out[entity.attdef.tag]=entity.attdef.default??'';return out;
}

/* ── 621 그룹 선택(PICKSTYLE) ──
   고른 객체에 group 이름이 있을 때만 그 도면 객체 배열의 그룹 색인을 한 번 만든다(배열마다 WeakMap).
   그룹이 없는 객체를 고를 때는 아무 일도 하지 않는다 — 선택 경로 비용 없음. */
let pickstyle=Number(prefGet('pickstyle',1))||0;
export const groupPickEnabled=()=>(pickstyle&1)===1;
export function setPickStyle(value){pickstyle=Number(value)||0;prefSet('pickstyle',pickstyle);return pickstyle;}
const groupIndexes=new WeakMap();
export function groupMemberIds(entities,name){
  if(!name||!Array.isArray(entities))return [];
  let index=groupIndexes.get(entities);
  if(!index){index=new Map();for(const entity of entities){const group=typeof entity?.group==='string'?entity.group.trim():'';if(!group)continue;let list=index.get(group);if(!list){list=[];index.set(group,list);}list.push(entity.id);}groupIndexes.set(entities,index);}
  return index.get(String(name).trim())||[];
}
/** 선택 확장(순수): ids 에 그룹 동료를 더한 목록. */
export function expandByGroups(entities,ids,byId){
  const out=new Set(ids);
  for(const id of ids){const group=byId(id)?.group;if(typeof group==='string'&&group.trim())for(const member of groupMemberIds(entities,group))out.add(member);}
  return [...out];
}

// 616 곁 문서 풀: 다른 도면을 한 번 읽으면 정의·레이어·단위만 남겨 4개까지 기억한다(같은 파일을 다시 열 때 변환 없음).
const sideLoaders=new Map(),sidePool=createSideDocPool(path=>sideLoaders.get(path)(),4);

export function installBlockDataTools(studio){
  const {engine,form,execute,field:f,pointFields,chosen,add,getSettings,toast,activeLayer,api,output,pickFiles,b64,selected}=studio.context;
  const choice=(name,label,value,options)=>f(name,label,value,'text',options.map(x=>Array.isArray(x)?x:[x,x]));
  const num=value=>{const n=Number(value);if(!Number.isFinite(n))throw Error('숫자를 입력하세요.');return n;};
  const sharedRefs=()=>{const list=chosen().filter(e=>e.type==='block'&&e.sharedBlock);if(!list.length)throw Error('공유 블록 참조를 선택하세요.');return list;};
  const ensureLayer=(spec)=>{const found=engine.doc.layers.find(l=>l.name===spec.name);if(found)return {id:found.id,commands:[]};const id=crypto.randomUUID();return {id,commands:[{type:'layer.add',id,name:spec.name,color:spec.color,lineweight:spec.lineweight}]};};
  const handlers={
    BLOCKSTORAGE(){form('블록 저장 방식 · 601',[choice('storage','새 블록','shared',[['shared','공유 정의(정의 1개 + 참조) · 재정의하면 삽입본 모두 바뀜 · 권장'],['copy','예전 방식(삽입마다 사본)']])].map(x=>({...x,value:prefGet('storage','shared')})),v=>{prefSet('storage',v.storage==='copy'?'copy':'shared');toast(v.storage==='copy'?'새 블록을 예전처럼 사본으로 만듭니다.':'새 블록을 공유 정의로 만듭니다(BLOCK·INSERT·블록 모음).');});},
    BLOCKSHARE(){
      const plan=migratePlainBlocks(engine.doc,{names:chosen().length?[...new Set(chosen().filter(e=>e.type==='block').map(e=>e.name))]:null});
      if(!plan.converted)throw Error('같은 이름·같은 모양의 사본형 블록이 두 개 이상 있어야 공유 정의로 바꿉니다.');
      execute({type:'batch',commands:[{type:'shared.add',definitions:plan.definitions,templates:plan.templates},{type:'updateMany',updates:plan.updates.map(u=>{const {id,type,...changes}=u.replacement;return {id:u.id,changes};})}]});
      toast(`사본형 블록 ${plan.converted}개를 공유 정의 ${plan.groups}개로 바꿨습니다. 이제 재정의하면 모두 함께 바뀝니다. Ctrl+Z 로 되돌리기`);
    },
    BLOCKSTATS(){
      const refs=sharedRefs(),defs=engine.doc.sharedBlocks;let prims=0,points=0;const nested=new Map();
      for(const ref of refs){const s=referenceStats(defs,ref);prims+=s.prims;points+=s.points;for(const [name,count] of sharedDefinitionStats(defs,ref.sharedBlock).blocks)nested.set(name,(nested.get(name)||0)+count);}
      const index=buildSharedRefIndex(engine.doc),users=new Set(refs.flatMap(ref=>referencesOf(index,ref.sharedBlock).map(e=>e.id)));
      toast(`참조 ${refs.length}개 · 펼치면 객체 ${prims.toLocaleString()}개·점 ${points.toLocaleString()}개 · 같은 정의를 쓰는 삽입본 ${users.size}개${nested.size?` · 중첩 블록 ${[...nested].slice(0,6).map(([n,c])=>n+' '+c).join(', ')}`:''}`);
    },
    BVSTATE(){
      const list=chosen();if(!list.length)throw Error('가시성 상태를 달 객체를 선택하세요(BLOCK 으로 묶기 전).');
      form('가시성 상태 달기 · 610',[f('states','이 객체가 보일 상태 이름(쉼표로 여러 개, 비우면 항상 보임)','열림')],v=>{const states=String(v.states||'').split(',').map(s=>s.trim()).filter(Boolean);execute({type:'updateMany',updates:list.map(e=>({id:e.id,changes:{states:states.length?states:null}}))});toast(states.length?`객체 ${list.length}개 · 상태 ${states.join(', ')}에서만 보임`:'상태 표시를 지웠습니다.');});
    },
    VISSTATE(){
      const refs=sharedRefs(),defs=engine.doc.sharedBlocks,states=[...new Set(refs.flatMap(ref=>visibilityStates(defs[ref.sharedBlock])))];
      if(!states.length)throw Error('이 블록 정의에는 가시성 상태가 없습니다. BVSTATE 로 객체에 상태를 달고 BLOCK 으로 다시 정의하세요.');
      form('가시성 상태 · 610',[choice('state','보일 상태',refs[0].visibility||states[0],[['','모두 보기(상태 없음)'],...states])],v=>{execute({type:'updateMany',updates:refs.map(ref=>({id:ref.id,changes:{visibility:v.state||null}}))});toast(`블록 ${refs.length}개 · 상태 ${v.state||'모두'} · 정의는 하나 그대로`);});
    },
    ATTDEF(){
      form('속성 정의 · ATTDEF(611)',[f('tag','태그(띄어쓰기 없이)','NO'),f('prompt','묻는 말','번호'),f('default','기본값',''),choice('mode','종류','normal',[['normal','보통(삽입 때 묻기)'],['preset','사전설정(묻지 않고 기본값)'],['constant','상수(모든 삽입본 같은 값)'],['verify','확인(두 번 확인)'],['invisible','숨김(값만 저장)']]),f('height','글자 높이 mm',getSettings().textHeight||250,'number'),...pointFields()],v=>{
        const tag=String(v.tag||'').trim();if(!tag||/\s/.test(tag))throw Error('태그는 띄어쓰기 없이 입력하세요.');
        const attdef={tag,prompt:String(v.prompt||tag),default:String(v.default??''),...(v.mode!=='normal'?{[v.mode]:true}:{})};
        add([{type:'text',position:{x:num(v.x),y:num(v.y)},height:Math.max(1,num(v.height)),text:tag,attdef}]);
        toast(`속성 정의 ${tag} · BLOCK 으로 묶으면 삽입할 때 값을 묻습니다.`);
      });
    },
    ATTSYNC(){
      const keys=[...new Set(sharedRefs().map(ref=>ref.sharedBlock))],updates=[];
      for(const key of keys){const plan=attsyncPlan(engine.doc,key,referencesOf(buildSharedRefIndex(engine.doc),key));if(plan)updates.push(...plan.updates);}
      if(!updates.length){toast('모든 삽입본의 속성이 정의와 같습니다.');return;}
      execute({type:'updateMany',updates});toast(`삽입본 ${updates.length}개의 속성을 정의에 맞췄습니다(값은 유지). Ctrl+Z 로 되돌리기`);
    },
    ATTEDIT(){
      const block=chosen().find(e=>e.type==='block');if(!block)throw Error('속성을 고칠 블록을 선택하세요.');
      const defs=block.sharedBlock?attributeDefinitions(engine.doc.sharedBlocks?.[block.sharedBlock]).filter(e=>!e.attdef.constant):[];
      const tags=[...new Set([...defs.map(e=>e.attdef.tag),...Object.keys(block.attributes||{})])];
      if(!tags.length)throw Error('이 블록에는 속성이 없습니다.');
      form(`속성 값 · ${block.name}`,tags.map(tag=>f(tag,defs.find(e=>e.attdef.tag===tag)?.attdef.prompt||tag,block.attributes?.[tag]??defs.find(e=>e.attdef.tag===tag)?.attdef.default??'')),v=>{const values=Object.fromEntries(tags.map(tag=>[tag,String(v[tag]??'')]));execute({type:'update',ids:[block.id],changes:attributeEditChanges(block,values)});toast('속성 값을 바꿨습니다(화면 문자도 함께).');});
    },
    DATAEXTRACTION(){
      const table=chosen().find(e=>e.table&&e.extraction);
      form('데이터 추출 · 614',[choice('action','작업',table?'refresh':'create',[['create','새 추출 표'],['refresh','추출 표 모두 갱신'],['csv','CSV(엑셀) 파일로 저장']]),f('names','블록 이름(쉼표, 비우면 전체)',''),f('layers','레이어(쉼표, 비우면 전체)',''),f('attrs','속성 열(태그, 쉼표)',''),choice('byLayer','레이어별로 나누기','no',[['no','아니오'],['yes','예']]),choice('nested','블록 안의 블록도 세기','yes',[['yes','예'],['no','아니오']]),...pointFields()],async v=>{
        const attrs=String(v.attrs||'').split(',').map(s=>s.trim()).filter(Boolean);
        const spec=normalizeSpec({filter:{names:v.names,layers:v.layers},groupBy:['name',...(v.byLayer==='yes'?['layer']:[]),...attrs.map(tag=>'attr:'+tag)],nested:v.nested==='yes'});
        if(v.action==='refresh'){
          const stale=staleExtractionTables(engine.doc);if(!stale.length){toast('추출 표가 모두 최신입니다.');return;}
          execute({type:'batch',commands:stale.map(({entity,rows})=>{const o=entity.extraction.origin||{x:0,y:0,height:getSettings().textHeight||250};const rebuilt=tableBlock(rows,{x:o.x,y:o.y,height:o.height,layer:entity.layer,name:entity.name});return {type:'update',ids:[entity.id],changes:{entities:rebuilt.entities,table:rebuilt.table}};})});
          toast(`추출 표 ${stale.length}개를 다시 채웠습니다.`);return;
        }
        const rows=runExtraction(engine.doc,spec);if(rows.length<2)throw Error('조건에 맞는 블록이 없습니다.');
        if(v.action==='csv'){const text=extractionCsv(rows),bytes=new TextEncoder().encode(text);let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));await output(btoa(s),'데이터추출.csv','text/csv');return;}
        const height=getSettings().textHeight||250,origin={x:num(v.x),y:num(v.y),height};
        add([{...tableBlock(rows,{x:origin.x,y:origin.y,height,layer:activeLayer(),name:'데이터 추출'}),extraction:{...spec,origin}}]);
        toast(`추출 표 ${rows.length-1}행 · 도면이 바뀌면 DATAEXTRACTION → 갱신`);
      });
    },
    BLOCKSPOT(){
      const pool=(chosen().length?chosen():engine.doc.entities).filter(e=>e.type!=='block'||e.sharedBlock);
      if(pool.length>200000)throw Error('객체가 너무 많습니다. 범위를 선택한 뒤 실행하세요.');
      form('반복 도형 → 블록 · BLOCKSPOT(615)',[f('gap','묶음 간격 mm(이 안으로 닿으면 한 묶음)',1,'number'),f('min','최소 반복 수',2,'number'),f('name','블록 이름 앞부분','반복')],v=>{
        const plan=planBlockSpot(pool,{gap:Math.max(0,num(v.gap)),min:Math.max(2,Math.round(num(v.min))),name:String(v.name||'반복'),existing:engine.doc.sharedBlocks||{}});
        const command=blockSpotCommand(plan,null);if(!command)throw Error('같은 모양으로 반복되는 묶음을 찾지 못했습니다(이동·회전·대칭·축척까지 확인).');
        execute(command);toast(`반복 묶음 ${plan.converted}개 → 블록 정의 ${plan.groups.length}개 · 객체 ${plan.removed.toLocaleString()}개가 참조 ${plan.converted}개로. Ctrl+Z 로 되돌리기`);
      });
    },
    BLOCKBROWSE(){
      pickFiles('.dxf,.dwg,.bcad,.json',false,async files=>{
        const file=files[0],path=file.name+':'+file.size+':'+file.lastModified;
        if(!sidePool.has(path))sideLoaders.set(path,async()=>{if(/\.(bcad|json)$/i.test(file.name))return JSON.parse(await file.text());const r=await api('import',{data:await b64(file),extension:'.'+file.name.split('.').pop().toLowerCase()});return {...r.document,sourceUnits:r.report?.unitless?0:null};});
        const side=await sidePool.get(path);sideLoaders.delete(path);
        const keys=Object.keys(side.sharedBlocks||{}).filter(k=>!side.sharedBlocks[k].xref);if(!keys.length)throw Error('이 도면에는 가져올 블록 정의가 없습니다.');
        const factor=unitConversion(side.units||prefGet('defaultSourceUnits',4),4);
        form(`다른 도면 블록 · ${file.name}${side.units?` · 원본 단위 ${UNIT_NAMES[side.units]||side.units}`:''}`,[choice('key','블록',keys[0],keys.map(k=>[k,side.sharedBlocks[k].name||k])),f('prefix','이름 앞에 붙일 말(겹치면 자동 번호)','')],v=>{
          const result=importSideBlock(side,v.key,engine.doc,{prefix:String(v.prefix||'')});
          // 623: 원본 단위가 mm 가 아니면 견본 축척에 환산 배율을 넣는다(INSERT 가 그대로 쓴다).
          const template={name:result.definitions[result.key].name||result.key,sharedBlock:result.key,position:{x:0,y:0},scale:factor,rotation:0,entities:[]};
          execute({type:'batch',commands:[...result.layers.map(layer=>({type:'layer.add',...layer})),{type:'shared.add',definitions:result.definitions,templates:[template],replace:false}]});
          toast(`블록 "${template.name}" 을 가져왔습니다${factor!==1?` (단위 환산 ×${factor})`:''}. INSERT 로 넣으세요.`);
        });
      });
    },
    BLOCKSIMILAR(){
      const refs=sharedRefs(),key=refs[0].sharedBlock,list=similarDefinitions(engine.doc.sharedBlocks||{},key);
      if(!list.length)throw Error('비슷한 블록 정의가 없습니다.');
      form('비슷한 블록으로 교체 · 616',[choice('key','바꿀 블록(비슷한 순)',list[0].key,list.map(x=>[x.key,`${x.name} · 차이 ${x.distance.toFixed(3)}`]))],v=>{const definition=engine.doc.sharedBlocks[v.key];execute({type:'updateMany',updates:refs.map(ref=>({id:ref.id,changes:{sharedBlock:v.key,name:definition.name||v.key}}))});toast(`블록 ${refs.length}개를 ${definition.name||v.key} 로 바꿨습니다.`);});
    },
    PICKSTYLE(){form('그룹 선택 · PICKSTYLE(621)',[choice('value','클릭하면','1',[['1','그룹 전체가 선택됨(AutoCAD 기본)'],['0','객체 하나만 선택됨(예전 바른 CAD)']])].map(x=>({...x,value:String(pickstyle&1)})),v=>{setPickStyle(v.value==='1'?1:0);toast(groupPickEnabled()?'그룹에 속한 객체를 고르면 그룹 전체가 선택됩니다.':'객체 하나만 선택됩니다.');});},
    INSUNITSDEF(){form('단위 없는 원본의 기본 단위 · 623',[choice('unit','원본 단위가 없을 때',String(prefGet('defaultSourceUnits',4)),[['4','mm'],['5','cm'],['6','m'],['1','인치'],['2','피트']])],v=>{prefSet('defaultSourceUnits',Number(v.unit)||4);toast(`단위 없는 외부참조·블록은 ${UNIT_NAMES[Number(v.unit)||4]} 로 보고 환산합니다.`);});},
    DWGCOMPARE(){
      pickFiles('.dxf,.dwg,.bcad,.json',false,async files=>{
        const file=files[0];
        const other=/\.(bcad|json)$/i.test(file.name)?JSON.parse(await file.text()):(await api('import',{data:await b64(file),extension:'.'+file.name.split('.').pop().toLowerCase()})).document;
        const result=compareDocs(engine.doc,other);
        if(!result.onlyA.length&&!result.onlyB.length){toast(`차이가 없습니다(같은 객체 ${result.same.toLocaleString()}개).`);return;}
        const removed=ensureLayer({name:'비교_이 도면에만',color:'#ff6b6b',lineweight:.35}),addedLayer=ensureLayer({name:'비교_'+file.name.replace(/\.[^.]+$/,'')+'에만',color:'#6bd38f',lineweight:.35});
        const clouds=result.clouds.map(c=>({...revisionCloud(c.box),layer:c.side==='a'?removed.id:addedLayer.id,comparison:{side:c.side,count:c.count,file:file.name}}));
        execute({type:'batch',commands:[...removed.commands,...addedLayer.commands,{type:'addMany',entities:clouds}]});
        toast(`비교: 이 도면에만 ${result.onlyA.length}개 · ${file.name}에만 ${result.onlyB.length}개 · 같은 것 ${result.same.toLocaleString()}개 · 구름 ${clouds.length}개(레이어 비교_*)`);
      });
    },
    PDFATTACH(){
      pickFiles('.pdf',false,async files=>{
        const file=files[0];
        form(`PDF 밑그림 · ${file.name}`,[f('page','쪽 번호',1,'number'),f('scale','축척(PDF 1mm → 도면 mm)',100,'number'),...pointFields()],async v=>{
          const page=Math.max(1,Math.round(num(v.page)));
          const r=await api('pdf-import',{data:await b64(file),page:page-1,scale:num(v.scale),text:true});
          const layer=ensureLayer(UNDERLAY_LAYER);
          const {key,definition}=underlayDefinition(r.entities||[],{name:file.name,page,kind:'pdf'},layer.id);
          const bounds=G.bounds(definition.entities)||{minX:0,minY:0};
          const local={...definition,entities:definition.entities.map(e=>G.translate(e,-bounds.minX,-bounds.minY))};
          const ref=underlayReference(key,local,{position:{x:num(v.x),y:num(v.y)},layer:layer.id});
          const commands=[...layer.commands];
          if(layer.commands.length)commands.push({type:'layer.update',id:layer.id,changes:{plot:false}});
          commands.push({type:'shared.add',definitions:engine.doc.sharedBlocks?.[key]?{}:{[key]:local},entities:[ref]});
          execute({type:'batch',commands});
          toast(`밑그림 ${file.name} ${page}쪽 · 벡터 ${definition.entities.length.toLocaleString()}개를 정의 하나로(스냅 가능, 출력 안 함)${r.report?.images?` · 그림 ${r.report.images}개는 아직 표시하지 않습니다`:''}`);
        });
      });
    },
  };
  handlers.BCONVERT=handlers.BLOCKSPOT;handlers.EATTEDIT=handlers.ATTEDIT;handlers.BATTMAN=handlers.ATTSYNC;handlers.COUNTSTATS=handlers.BLOCKSTATS;
  Object.assign(studio.handlers,handlers);
  return studio;
}
export {unitHint};
