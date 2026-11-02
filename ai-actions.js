import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {buildRoomSchedule} from './room-schedule.js';
import {ARCH_LIBRARY,architecturalDetail} from './architectural-library.js';
import {wallOpening} from './architecture.js';
import {workflowCommands} from './workflow-names.js';
import {MATERIAL_PRESETS,MATERIAL_KINDS,KIND_LABELS,DEFAULT_MATERIALS} from './material-presets.js';
import {planDeliveryCheck} from './delivery-check.js';
export const AI_DIALOG_COMMANDS=[...new Set(['NUMCALC','APPLOAD','CONVERT','ARCHLIB',...workflowCommands.map(([name])=>name),'PDF','SHEET','SHEETS','GLOBAL',...Object.keys(ARCH_LIBRARY)])];
const siteCommands=new Set(['site_plan.generate','site_plan.validate','parcel_import']);

// A30(10-21): 계획 탭과 같은 EPSG:5187 로 받고, 도면에 지적 원점(drawingGeo)이 있으면 그 원점으로 받아 겹치게 한다.
export async function importParcelAction(args,{api,unchanged,open,commit,geo=null}){
 if(!args||Object.keys(args).some(k=>!['query','surroundings','contextMeters','x','y'].includes(k))||args.query!==undefined&&typeof args.query!=='string'||args.surroundings!==undefined&&typeof args.surroundings!=='boolean')throw Error('대지 가져오기 인자를 확인하세요.');
 const contextMeters=args.contextMeters??30;if(!Number.isFinite(contextMeters)||contextMeters<5||contextMeters>200)throw Error('주변 범위는 5~200m입니다.');
 const query=(args.query||'').trim(),options={contextMeters,surroundings:args.surroundings??true};
 for(const key of ['x','y'])if(args[key]!==undefined&&!Number.isFinite(args[key]))throw Error('삽입 좌표는 숫자여야 합니다.');
 if(!query){await open('',options);return '대지 가져오기를 열었습니다. 열린 창에서 로그인 또는 주소 입력을 진행해주세요.';}
 if(query.length<2||query.length>200)throw Error('대지 주소는 2~200자로 입력하세요.');
 const status=await api('parcel',{action:'status'});
 if(!status.connected){await open(query,options);return '바른 계정 로그인이 필요합니다. 로그인 창을 열었습니다.';}
 const found=await api('parcel',{action:'search',query});
 const choices=[...new Map((found.results||[]).filter(r=>/^\d{19}$/.test(r.pnu)).map(r=>[r.pnu,r])).values()];
 if(choices.length!==1){await open(query,options);return choices.length?'주소가 여러 필지와 일치합니다. 대지 가져오기 창에서 정확한 지번을 선택해주세요.':'주소 검색 결과가 없습니다. 대지 가져오기 창에서 주소를 확인해주세요.';}
 const parcel=await api('parcel',{action:'fetch',pnu:choices[0].pnu,surroundings:args.surroundings??true,contextMeters,x:args.x??0,y:args.y??0,crs:'EPSG:5187',...(geo?.crs==='EPSG:5187'?{originM:geo.originM}:{})});
 if(!unchanged())throw Error('대지를 조회하는 동안 도면이 변경되었습니다. 현재 도면으로 다시 요청하세요.');
 if(!parcel.entities?.length)throw Error('조회된 대지 경계가 없습니다.');
 await commit(parcel.entities,parcel.drawingGeo);
 return `${choices[0].jibunAddress||choices[0].roadAddress} 대지경계·도로·주변필지를 각각의 레이어에 추가했습니다. 경계선을 선택해 점과 레이어를 수정할 수 있습니다. Ctrl+Z로 되돌릴 수 있습니다.`;
}

export function directParcelRequest(message){
 let text=message.trim();
 const radius=text.match(/(?:주변\s*|반경\s*)?(\d+(?:\.\d+)?)\s*(?:m|미터)(?:\s*(?:범위|까지|이내))?/i);
 const roads=/주변\s*도로|도로\s*(?:포함|같이|함께)/.test(text),contextMeters=radius?Number(radius[1]):30;
 if(radius)text=text.replace(radius[0],' ');
 text=text.replace(/(?:주변\s*)?도로(?:도|를)?\s*(?:포함해서|포함하여|포함|같이|함께)?(?:\s*(?:해서|해서는))?/g,' ').replace(/\s+(?:같이|함께)\s*/g,' ');
 // Route only a standalone imperative, leaving questions and compound design requests to the planner.
 const match=text.match(/^(.*?)\s*(?:대지|필지|지적도)(?:\s*경계)?(?:를|을)?\s*(?:좀\s*)?(?:가져와|가져오(?:기|라고|고|는)?|불러와|불러오(?:기)?|띄워|떠|열어)(?:\s*줘|주세요|해줘|해|라)?[.!。]*$/);
 if(!match||/주변|도로|\d+\s*(?:m|미터)/i.test(match[1])||/왜|어떻게|말고|않|마|하지|그리고|하고|면적|설계|\?|？/.test(match[1]))return null;
 // "지금 대지 지적도 떠줘" 의 "지금 대지" 는 주소가 아니다. 가리키는 말과 끝의 '대지·필지' 를 떼고, 남는 게 없으면 대지 가져오기 창을 연다.
 const query=match[1].trim().replace(/^주소\s*[:：]?\s*/,'').replace(/^(?:지금|현재|이번|이|우리|해당)(?:\s+|$)/,'').replace(/(?:^|\s+)(?:의\s*)?(?:대지|필지)$/,'').trim();
 return {actions:[{cmd:'parcel_import',args:{query,...(radius||roads?{contextMeters,surroundings:true}:{})}}],ask:null,note:null};
}
const supported=new Set(['architecture','architecture_update','open_tool','line','polyline','rect','circle','wall','text','offset','move','copy','rotate','mirror','trim','delete','layer_set','layer_create','layer_auto','dxf_save','zoom_fit','select','room_schedule','materials_set','delivery_fix']);
export function parseActions(text){
 const value=JSON.parse(text);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['actions','ask','note'].includes(k))||!Array.isArray(value.actions)||value.actions.length>200||!['string','object'].includes(typeof value.ask)||!['string','object'].includes(typeof value.note)||value.ask!==null&&typeof value.ask!=='string'||value.note!==null&&typeof value.note!=='string')throw Error('AI JSON 형식이 올바르지 않습니다.');
 for(const a of value.actions)if(!a||!supported.has(a.cmd)&&!siteCommands.has(a.cmd)||!a.args||typeof a.args!=='object'||Array.isArray(a.args)||Object.keys(a).some(k=>!['cmd','args'].includes(k)))throw Error('지원하지 않는 AI 명령 형식입니다.');
 return value;
}
/* 리습 먼저(library_first.py 와 같은 판정): 옛 actions 로 새로 그리는 도형의 종류·레이어 이름만 모아 엔진에 묻는다.
   무엇을 막을지(표)와 써 본 기록은 엔진 한 곳에만 있다. 써 보고도 못 그리면 그 action args 에 library_check:{command,reason}. */
const DRAW_TYPES={line:'line',polyline:'polyline',rect:'rectangle',circle:'circle',wall:'wall',text:'text'};
export function libraryFirstRequest(doc,plan,{activeLayer}={}){
 const name=value=>{const l=doc.layers.find(l=>l.id===value||l.name===value);return String(l?l.name:value??'');};
 let layer=activeLayer||doc.layers[0]?.id;const entities=[],checks=[];
 for(const {cmd,args:a} of plan.actions){
  if(cmd==='layer_set')layer=a.layer;
  else if(DRAW_TYPES[cmd]){entities.push({type:DRAW_TYPES[cmd],layer:name(a.layer||layer)});if(a.library_check!==undefined)checks.push(...[a.library_check].flat());}
 }
 return entities.length?{entities,...(checks.length?{library_check:checks}:{})}:null;
}
export async function assertLibraryFirst(api,doc,plan,options){
 const request=libraryFirstRequest(doc,plan,options);if(!request)return;
 const result=await api('chat',{action:'libraryFirst',...request});
 if(result?.blocked?.length||result?.unlabelled){const error=Error(result.message||'리습 먼저: 바른 명령 라이브러리로 그리세요.');error.code='library_first';error.blocked=result.blocked||[];throw error;}
}
export function stageActions(engine,plan,{selected=[],activeLayer}={}){
 if(plan.ask!==null)return {ask:plan.ask};
 const staged=new DrawingEngine();staged.doc=structuredClone(engine.doc);
 let ids=[...selected],layer=activeLayer||staged.doc.layers[0].id,save=null,fit=false;
 const counts={},summaries=[];
 const target=a=>{const result=a.ids??ids;if(!Array.isArray(result)||!result.length||result.some(id=>!staged.doc.entities.some(e=>e.id===id)))throw Error('대상 객체를 찾을 수 없습니다.');return result;};
 const point=p=>{if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))throw Error('유효한 X,Y 좌표가 필요합니다.');return {x:p.x,y:p.y};};
 const pts=a=>{if(!Array.isArray(a.pts)||a.pts.length<2)throw Error('두 점 이상 필요합니다.');return a.pts.map(point);};
 const exec=c=>staged.execute(c);
 try{for(let i=0;i<plan.actions.length;i++){
  const {cmd,args:a}=plan.actions[i];let count=1;
  if(siteCommands.has(cmd))throw Error('배치 API 실행 경로를 사용하세요.');
  if(cmd==='open_tool')throw Error('설정창 열기는 다른 작업과 분리해서 실행하세요.');
  if(cmd==='architecture'){
   if(!ARCH_LIBRARY[a.command]||!a.options||typeof a.options!=='object'||Array.isArray(a.options))throw Error('건축 기능과 규격을 확인하세요.');
   const l=staged.doc.layers.find(l=>l.id===layer);if(!l||l.locked||!l.visible||l.frozen)throw Error('사용 가능한 레이어를 지정하세요.');
   const options={...a.options};point({x:options.x,y:options.y});
   let entity=architecturalDetail(a.command,options,layer);
   if(a.hostWallId){const wall=staged.doc.entities.find(e=>e.id===a.hostWallId);if(!wall||wall.type!=='wall'||staged.doc.layers.find(l=>l.id===wall.layer)?.locked||!['DOOR','WINDOW'].includes(ARCH_LIBRARY[a.command].kind))throw Error('연결할 벽을 확인하세요.');entity={...wallOpening(ARCH_LIBRARY[a.command].kind,options,wall,{x:options.x,y:options.y},layer),libraryCommand:a.command};}
   ids=exec({type:'add',entity});fit=true;
  }else if(cmd==='architecture_update'){
   const targets=target(a);if(!a.changes||typeof a.changes!=='object'||Array.isArray(a.changes))throw Error('변경할 건축 규격이 필요합니다.');exec({type:'architecture.update',ids:targets,changes:a.changes});ids=targets;
  }else if(['line','polyline','rect','circle','wall','text'].includes(cmd)){
   let entities;
   /* 실 이름을 못 넣으면 평면도가 아니다. 예전에는 text 가 없어 AI 가 실명을 통째로 빼고 그렸다. */
   if(cmd==='text'){
    const body=String(a.text??'');
    if(!body.trim())throw Error('넣을 글자를 지정하세요.');
    if(body.length>2000)throw Error('문자는 2000자 이내로 넣으세요.');
    const height=Number(a.height);
    if(!(height>0))throw Error('글자 높이는 양수입니다.');
    const rotation=a.rotation===undefined?0:Number(a.rotation);
    if(!Number.isFinite(rotation))throw Error('글자 회전각을 확인하세요.');
    const align=['left','center','right'].includes(a.align)?a.align:undefined;
    entities=[{type:'text',position:point(a.position),text:body,height,rotation,...(align?{align}:{})}];
   }
   else if(cmd==='circle')entities=[{type:'circle',center:point(a.center),radius:a.radius}];
   else if(cmd==='rect'){const p=point(a.origin);entities=[{type:'rectangle',points:[p,{x:p.x+a.width,y:p.y},{x:p.x+a.width,y:p.y+a.height},{x:p.x,y:p.y+a.height}]}];if(!(a.width>0&&a.height>0))throw Error('사각형 크기는 양수입니다.');}
   else {const p=pts(a);entities=cmd==='wall'?p.slice(1).map((b,j)=>({type:'wall',points:[p[j],b],thickness:a.thickness,openings:[]})):[{type:cmd,points:p,closed:!!a.closed}];}
   const l=staged.doc.layers.find(l=>l.id===(a.layer||layer)||l.name===a.layer);if(!l||l.locked||!l.visible||l.frozen)throw Error('사용 가능한 레이어를 지정하세요.');
   ids=exec({type:'addMany',entities:entities.map(e=>({...e,layer:l.id}))});count=entities.length;
  }else if(['move','copy','rotate','mirror','offset','delete'].includes(cmd)){
   const c={type:cmd,ids:target(a)};
   if(['move','copy'].includes(cmd))Object.assign(c,{dx:a.dx,dy:a.dy});
   if(cmd==='rotate')Object.assign(c,{base:point(a.base),angle:a.angle});
   if(cmd==='mirror')Object.assign(c,{a:point(a.a),b:point(a.b),eraseSource:a.eraseSource===true});
   if(cmd==='offset')Object.assign(c,{distance:a.distance,side:point(a.side)});
   const result=exec(c);if(Array.isArray(result))ids=result;
  }else if(cmd==='trim'){exec({type:'trim',id:a.id||target(a)[0],boundaryIds:a.boundaryIds,pick:point(a.point)});
  }else if(cmd==='select'){
   const f=a.filter;if(!f||typeof f!=='object'||Array.isArray(f)||Object.keys(f).some(k=>!['ids','type','layer','all'].includes(k))||!Object.keys(f).length)throw Error('선택 조건이 필요합니다.');
   ids=staged.doc.entities.filter(e=>{const l=staged.doc.layers.find(l=>l.id===e.layer);return l?.visible&&!l.frozen&&(!f.ids||f.ids.includes(e.id))&&(!f.type||f.type===e.type)&&(!f.layer||f.layer===e.layer||f.layer===l.name);}).map(e=>e.id);
  }else if(cmd==='layer_auto'){const result=exec({type:'layer.auto'});count=result.changed;summaries.push(`레이어 정리 ${result.changed}개 · 검토 ${result.review}개 · 제외 ${result.excluded}개`);
  }else if(cmd==='layer_create'){exec({type:'layer.add',name:a.name,color:a.color,lineweight:a.lineweight});
  }else if(cmd==='layer_set'){const l=staged.doc.layers.find(l=>l.id===a.layer||l.name===a.layer);if(!l||l.locked||!l.visible||l.frozen)throw Error('사용 가능한 레이어가 아닙니다.');layer=l.id;
  }else if(cmd==='room_schedule'){
   if(Object.keys(a).some(k=>!['ids','floor','holeLayers','position'].includes(k)))throw Error('실별 면적표 인자를 확인하세요.');
   const result=buildRoomSchedule(staged.doc,{...a,ids:a.ids??ids,layer});
   summaries.push(result.summary);
   ids=exec({type:'add',entity:result.entity});fit=true;
  }else if(cmd==='materials_set'){
   // 3D 재료(material-presets.js): 종류 전체(materials) 또는 벽·닫힌 윤곽 객체(ids+material). 되돌리기 한 번.
   if(Object.keys(a).some(k=>!['materials','ids','material'].includes(k))||a.materials===undefined&&a.ids===undefined)throw Error('재료 인자를 확인하세요(materials 또는 ids+material).');
   const commands=[];if(a.materials!==undefined)commands.push({type:'model3d.settings',settings:{materials:a.materials}});
   if(a.ids!==undefined){if(a.material===undefined)throw Error('ids 와 함께 material 을 주세요.');commands.push({type:'model3d.set',ids:target(a),changes:{material:a.material}});}
   exec(commands.length===1?commands[0]:{type:'batch',commands});
   summaries.push('3D 재료: '+[...Object.entries(a.materials||{}).map(([k,v])=>`${KIND_LABELS[k]||k} ${v===null?'기본':MATERIAL_PRESETS.find(m=>m.id===v)?.label||v}`),...(a.ids?[`객체 ${a.ids.length}개 ${MATERIAL_PRESETS.find(m=>m.id===a.material)?.label||'기본'}`]:[])].join(', ')+' · 3D 화면에서 확인');
  }else if(cmd==='delivery_fix'){
   // 납품 전 점검(delivery-check.js) 중 자동으로 고칠 수 있는 것만, 하나 고칠 때마다 다시 검사한 도면으로
   if(Object.keys(a).some(k=>!['keys','denominator'].includes(k))||!Array.isArray(a.keys)||!a.keys.length||a.keys.some(k=>!['audit','overkill','angle','ends'].includes(k)))throw Error('고칠 항목(keys: audit·overkill·angle·ends)을 주세요.');
   const locked=new Set(staged.doc.layers.filter(l=>l.locked).map(l=>l.id)),fixed=[];
   for(const key of ['audit','overkill','angle','ends'].filter(k=>a.keys.includes(k))){const item=planDeliveryCheck(staged.doc,{lockedLayers:locked,denominator:a.denominator||100}).items.find(i=>i.key===key),command=item?.fix?.();if(command){exec(command);fixed.push(`${item.title} ${item.count}`);}}
   count=fixed.length;summaries.push(fixed.length?'납품 전 점검 고침: '+fixed.join(', '):'납품 전 점검: 자동으로 고칠 것이 없습니다.');
  }else if(cmd==='zoom_fit')fit=true;
  else if(cmd==='dxf_save'){if(i!==plan.actions.length-1)throw Error('DXF 저장은 마지막 액션이어야 합니다.');if(typeof a.name!=='string'||!a.name.toLowerCase().endsWith('.dxf')||/[\\/:]/.test(a.name))throw Error('DXF 파일 이름을 지정하세요.');save=a.name;}
  counts[cmd]=(counts[cmd]||0)+count;
 }}catch(error){while(staged.undoStack.length)staged.execute({type:'undo'});throw error;}
 return {document:staged.doc,changed:staged.undoStack.length>0,selected:ids,activeLayer:layer,save,fit,summary:plan.actions.length===1&&summaries.length?summaries[0]:'실행: '+Object.entries(counts).map(([cmd,n])=>`${({architecture:'건축 요소',architecture_update:'건축 요소 수정',line:'선',polyline:'폴리선',rect:'사각형',circle:'원',wall:'벽',copy:'복사',move:'이동',delete:'삭제',rotate:'회전',room_schedule:'실별 면적표',select:'선택',layer_create:'레이어 생성',layer_set:'레이어 선택',zoom_fit:'도면 맞춤',dxf_save:'DXF 저장'})[cmd]||cmd} ${n}개`).join(', ')};
}
export function actionContext(doc,selected,layer,recent){
 const es=doc.entities.filter(e=>selected.has(e.id)),types={};for(const e of es)types[e.type]=(types[e.type]||0)+1;
 return {materials3d:{kinds:MATERIAL_KINDS.map(kind=>({kind,label:KIND_LABELS[kind],current:doc.model3d?.materials?.[kind]||DEFAULT_MATERIALS[kind],choices:MATERIAL_PRESETS.filter(m=>m.kinds.includes(kind)).map(m=>m.id+'='+m.label)}))},
  units:doc.units,currentLayer:doc.layers.find(l=>l.id===layer),layers:doc.layers.map(({id,name,color})=>({id,name,color})),selection:{ids:es.map(e=>e.id),count:es.length,types,bounds:G.bounds(es)},dialogCommands:AI_DIALOG_COMMANDS,architectureCommands:Object.entries(ARCH_LIBRARY).map(([command,spec])=>({command,label:spec.label,fields:spec.fields.map(f=>({name:f.name,default:f.value,options:f.options}))})),recentCommands:recent.slice(-5)};
}
