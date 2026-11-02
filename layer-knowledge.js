import {standardLayerForName} from './layer-standards.js';
// 레이어 정리 지식은 핵심 자산이다. 설치본에서는 엔진이 로그인 뒤 서버 열쇠로 풀어 주고, 그 전에는 빈 지식(locked)이 온다
// (vault_gate.py). 로그인으로 풀리면 reloadLayerKnowledge() 로 새로 읽는다 — export let 이라 쓰는 쪽도 새 값을 본다.
import {LAYER_KNOWLEDGE as SHIPPED} from './layer-knowledge-data.js';
export let LAYER_KNOWLEDGE=SHIPPED;
let classes=new Map(LAYER_KNOWLEDGE.classRules.map(r=>[r.className,r]));
export async function reloadLayerKnowledge(){
 const m=await import(new URL('./layer-knowledge-data.js',import.meta.url).href+'?v='+Date.now());
 LAYER_KNOWLEDGE=m.LAYER_KNOWLEDGE;classes=new Map(LAYER_KNOWLEDGE.classRules.map(r=>[r.className,r]));
 return !LAYER_KNOWLEDGE.locked;
}
const kinds={WALL:'벽체',DOOR:'문',WINDOW:'창호',COLUMN:'기둥',STAIR:'계단',CURVESTAIR:'계단',INSULATION:'단열재',ELEVATOR:'승강기',RAMP:'경사로'};
const types={wall:'벽체',door:'문',window:'창호',text:'문자',mtext:'문자',hatch:'해치'};
// 위생기구(변기·세면대·욕조)는 바른 레이어 세트의 '위생'(A-SANI) 하나로 모은다. A-PLMB 는 배관 전용(2026-10-10 사용자 결정).
const LABEL_ALIAS={'위생기구':'위생'};
const canonical=label=>LABEL_ALIAS[label]||label;
// 새 도면 표준 레이어(공간_*·주방기구)는 기본 기능이라 지식 자료가 아니라 위 이름표에서 만든다(잠겨 있어도 같다).
export {LEARNED_LAYERS as learnedLayerStandards} from './layer-standards.js';

// 레이어 이름이 표준 분류 하나를 분명히 가리키면 그 분류(예: DIM → 치수, A-WALL → 벽체). 둘 이상이거나 없으면 null.
export function layerNameLabel(layer){
 const standard=standardLayerForName(String(layer?.name||'').toUpperCase());if(standard)return standard.label;
 const tokens=new Set(String(layer?.name||'').normalize('NFKC').toUpperCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
 const labels=new Set(LAYER_KNOWLEDGE.aliases.filter(rule=>rule.tokens.some(token=>tokens.has(token.toUpperCase()))).map(rule=>canonical(rule.target)));
 return labels.size===1?[...labels][0]:null;
}
export function classifyByLayerKnowledge(entity,layer){
 const evidence=[];
 const offer=(label,ruleId,strong,reason)=>{label=canonical(label);if(label)evidence.push({label,ruleId,strong,reason});};
 const type=String(entity.type||'').toLowerCase();
 offer(types[type],'native.'+type,true,'객체 자체의 형식');
 if(/^(dimension|dim)/.test(type))offer('치수','native.dimension',true,'치수 객체');
 for(const key of [entity.category,entity.parameters?.kind])offer(kinds[String(key||'').toUpperCase()],'native.kind.'+key,true,'건축 요소 종류');
 if(entity.parcelRole==='site'||entity.parcelRole==='road')offer(entity.parcelRole==='site'?'대지':'도로','native.parcel',true,'명시된 필지 역할');
 const classRule=classes.get(entity.name);
 if(classRule?.target){
  const provenance=typeof entity.sourceCase==='string'&&entity.sourceCase.length>0&&entity.sourceAnnotation!==undefined&&entity.sourceAnnotation!==null;
  offer(classRule.target,classRule.id,provenance,provenance?'원본 주석 분류와 출처':'출처 미확인 객체 이름');
 }
 const layerName=String(layer?.name||'').normalize('NFKC').toUpperCase();
 const tokens=new Set(layerName.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
 const standard=standardLayerForName(layerName);if(standard)offer(standard.label,'standard.name',false,'A- 표준 레이어 이름');
 for(const rule of standard?[]:LAYER_KNOWLEDGE.aliases){
  if(rule.tokens.some(token=>tokens.has(token.toUpperCase())))offer(rule.target,rule.id,false,'레이어 이름의 독립 단어');
 }
 // Space class names must stay space boundaries, never become fixtures or stairs.
 if(classRule?.className.startsWith('공간_')){
  for(let i=evidence.length-1;i>=0;i--)if(evidence[i].ruleId.startsWith('alias.')&&!evidence[i].strong)evidence.splice(i,1);
 }
 const labels=[...new Set(evidence.map(e=>e.label))];
 if(!labels.length)return null;
 const conflict=labels.length>1;
 const strong=evidence.some(e=>e.strong);
 return {id:entity.id,label:conflict?null:labels[0],accepted:!conflict&&strong,confidence:conflict?0:strong?1:.8,
  evidenceKind:conflict?'conflict':strong?'semantic':'name_candidate',ruleIds:evidence.map(e=>e.ruleId),evidence,
  reason:conflict?'객체 형식·분류·레이어 이름 충돌 · 원본 유지':evidence.map(e=>e.reason).join(' · ')};
}
