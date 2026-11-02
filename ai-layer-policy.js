// AI 기본 도형과 리습의 레이어 기본값. 사용자 레이어와 현재 레이어는 바꾸지 않는다.
import {standardLayerForLabel,TEMPLATE_LAYERS,SITE_PLAN_LAYERS,ON_DEMAND_LAYERS} from './layer-standards.js';
const standards=new Map([...TEMPLATE_LAYERS,...SITE_PLAN_LAYERS,...ON_DEMAND_LAYERS].map(l=>[l.name,l]));
const purposes={wall:'A-WALL',door:'A-DOOR',window:'A-GLAZ',stair:'A-STAIR',column:'A-COL',room:'A-AREA',dimension:'A-DIM',text:'A-TEXT',symbol:'A-SYM',detail:'A-DETL',review:'A-REVIEW',벽:'A-WALL',창:'A-GLAZ',실:'A-AREA',치수:'A-DIM'};
export const ARCHITECTURE_TOOL_GUIDE='건축 요소는 cad_get_layer_usage(규칙 layer-usage.json)와 cad_list_commands/cad_get_command(명령 라이브러리)를 먼저 읽고 카드·command-runner(cad_describe_command → cad_preview_command → cad_run_command)를 우선 사용하세요. 벽은 WALDRAW/WAL, 문 D1, 창 W1이며 계단·기둥·실·치수도 명령 라이브러리에서 찾으세요. 명령이 없거나 실행 불가임을 확인한 다음 리습, 둘 다 없을 때만 기본 도형을 사용하세요.';
export const isBarunLayer=name=>standards.has(name);
const text=(v,key)=>{if(typeof v!=='string'||!v.trim()||v.length>200)throw Error(key+'는 비어 있지 않은 레이어 이름·ID 또는 용도 문자열이어야 합니다.');return v.trim();};
export function resolveAILayer(document,args={}){
 if(args.layer===undefined&&args.purpose===undefined)return null;
 const value=args.layer!==undefined?text(args.layer,'layer'):text(args.purpose,'purpose');
 const name=purposes[value.toLowerCase()]||standardLayerForLabel(value)?.name||value;
 const existing=document.layers.find(l=>l.id===value||l.name===value)||document.layers.find(l=>l.name===name);
 if(existing){if(existing.locked||existing.frozen||existing.visible===false)throw Error('대상 레이어가 잠겨 있거나 숨겨져 있습니다: '+existing.name);return existing;}
 const standard=standards.get(name);
 if(!standard)throw Error('레이어 또는 용도를 찾을 수 없습니다: '+value+'. cad_get_layer_usage와 cad_get_document에서 확인하세요.');
 return {...standard,id:crypto.randomUUID(),visible:true,locked:false};
}
export function aiLayerWarnings(document,entities,{primitive=false}={}){
 const names=new Map(document.layers.map(l=>[l.id,l.name])),outside=new Set();
 const visit=e=>{const name=names.get(e.layer);if(!isBarunLayer(name))outside.add(name||String(e.layer||'(미지정)'));for(const key of ['entities','children'])for(const child of e[key]||[])visit(child);};
 for(const e of entities)visit(e);
 const warnings=outside.size?['바른 A- 레이어 세트 밖에 생성했습니다: '+[...outside].join(', ')+'. 레이어 미지정 실행은 현재 레이어를 유지합니다. cad_get_layer_usage로 용도를 확인하고 layer/purpose 또는 객체 layer를 지정해 고치세요. 사용자 도면의 기존 레이어 체계는 자동 변경하지 않습니다.']:[];
 if(primitive&&entities.length)warnings.push(ARCHITECTURE_TOOL_GUIDE);
 return warnings;
}
/** 복사본에서만 계획하며 필요한 layer.add도 같은 batch/Undo에 넣는다. 결과를 다시 넣어도 바뀌지 않는다. */
export function prepareAICommand(document,input,args={},activeLayer){
 const command=structuredClone(input),layers=document.layers.slice(),created=[];
 const planned=c=>{if(c?.type==='layer.add'&&!layers.some(l=>l.name===c.name||l.id===c.id)){c.id ||= crypto.randomUUID();layers.push({...c,id:c.id});}if(c?.type==='batch')for(const child of c.commands||[])planned(child);};
 planned(command);
 const staged={layers},fallback=resolveAILayer(staged,args),current=layers.find(l=>l.id===activeLayer)||layers[0];
 const ensure=layer=>{if(!layers.some(l=>l.id===layer.id)){layers.push(layer);created.push({type:'layer.add',...layer});}return layer.id;};
 const entity=e=>{if(!e||typeof e!=='object')return;const layer=e.layer===undefined?(fallback||current):resolveAILayer(staged,{layer:e.layer});if(layer)e.layer=ensure(layer);for(const key of ['entities','children'])for(const child of e[key]||[])entity(child);};
 // 바꾸기(update·updateMany)의 changes.layer 와 블록 넣기 layer 도 이름·용도를 ID 로 바꾼다. 안 바꾸면 엔진이
 // '객체의 레이어가 없습니다'로 거절했다(10/16·10/22 기록).
 const change=changes=>{if(changes&&typeof changes==='object'&&changes.layer!==undefined&&!layers.some(l=>l.id===changes.layer)){const layer=resolveAILayer(staged,{layer:changes.layer});if(layer)changes.layer=ensure(layer);}};
 const visit=c=>{if(c?.type==='add')entity(c.entity);if(c?.type==='addMany'){c.keepLayers=true;for(const e of c.entities||[])entity(e);}
  if(c?.type==='update')change(c.changes);if(c?.type==='updateMany')for(const u of c.updates||[])change(u?.changes);
  if(c?.type==='block.insert'){const layer=c.layer===undefined?(fallback||current):layers.some(l=>l.id===c.layer)?null:resolveAILayer(staged,{layer:c.layer});if(layer)c.layer=ensure(layer);}
  if(c?.type==='batch')for(const child of c.commands||[])visit(child);};
 visit(command);
 return created.length?{type:'batch',commands:[...created,command]}:command;
}
