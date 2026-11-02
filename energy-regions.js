// 에너지절약계획서 영역: 출력 창의 [윈도우]처럼 두 점으로 고른 도면 범위(개요·층 평면·입면·단면·창호 일람표).
// 영역은 도면 reviewSettings.energyPlanRegions 에 둔다(되돌리기 됨). 좌표는 mm.
import * as G from './geometry.js';
const KINDS=['overview','floor','elevation','section','window_schedule'];
export const DIRECTIONS={south:'남',north:'북',east:'동',west:'서'};
const finitePoint=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);
export function energyRegionLabel(r){
 if(r.kind==='overview')return '개요';
 if(r.kind==='floor')return r.floor<0?`지하${-r.floor}층`:`${r.floor}층`;
 if(r.kind==='elevation')return '입면-'+DIRECTIONS[r.direction];
 if(r.kind==='section')return '단면'+(r.name?' '+r.name:'');
 return '창호 일람표';
}
const regionKey=r=>r.kind+(r.kind==='floor'?':'+r.floor:r.kind==='elevation'?':'+r.direction:r.kind==='section'?':'+(r.name||''):'');
/** 종류·두 점 → 저장할 영역. 잘못되면 이유를 말하는 Error. */
export function makeEnergyRegion(spec,a,b){
 const s=spec||{};
 if(!KINDS.includes(s.kind))throw Error('영역 종류가 올바르지 않습니다(개요·층·입면·단면·창호 일람표).');
 if(s.kind==='floor'&&!(Number.isInteger(s.floor)&&s.floor!==0))throw Error('층 번호를 넣으세요(지하는 -1, -2 …).');
 if(s.kind==='elevation'&&!Object.hasOwn(DIRECTIONS,s.direction))throw Error('입면 방위를 고르세요(남·북·동·서).');
 if(!finitePoint(a)||!finitePoint(b))throw Error('윈도우 두 점이 올바르지 않습니다.');
 const bounds={minX:Math.min(a.x,b.x),minY:Math.min(a.y,b.y),maxX:Math.max(a.x,b.x),maxY:Math.max(a.y,b.y)};
 if(bounds.maxX-bounds.minX<=0||bounds.maxY-bounds.minY<=0)throw Error('윈도우 영역의 넓이가 없습니다. 대각선 두 점을 찍으세요.');
 const region={kind:s.kind,...(s.kind==='floor'?{floor:s.floor}:{}),...(s.kind==='elevation'?{direction:s.direction}:{}),...(s.kind==='section'&&s.name?{name:String(s.name).trim()}:{}),bounds};
 return {...region,key:regionKey(region),label:energyRegionLabel(region)};
}
const ORDER=r=>[KINDS.indexOf(r.kind),r.kind==='floor'?r.floor:r.kind==='elevation'?Object.keys(DIRECTIONS).indexOf(r.direction):0];
/** 저장된 영역을 개요 → 층(아래부터) → 입면(남북동서) → 단면 → 창호 일람표 순서로. */
export function energyRegions(doc){
 const list=Array.isArray(doc?.reviewSettings?.energyPlanRegions)?doc.reviewSettings.energyPlanRegions:[];
 return [...list].sort((a,b)=>{const x=ORDER(a),y=ORDER(b);return x[0]-y[0]||x[1]-y[1]||String(a.name||'').localeCompare(String(b.name||''));});
}
/** 같은 이름(key)의 영역은 바꾸고, 없으면 더한다. 한 번에 되돌린다. */
export function setEnergyRegion(engine,region){
 const list=energyRegions(engine.doc).filter(r=>r.key!==region.key);
 engine.execute({type:'review.settings',settings:{energyPlanRegions:[...list,structuredClone(region)]}});
}
const LIST_LIMIT=300,num=v=>typeof v==='number'&&Number.isFinite(v)?v:null,str=v=>typeof v==='string'&&v?v:null;
const pathLength=pts=>Array.isArray(pts)?pts.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-pts[i].x,p.y-pts[i].y),0):0;
const dimensionValue=e=>{const [a,b]=e.points||[];if(!a||!b)return null;return e.mode==='horizontal'?Math.abs(b.x-a.x):e.mode==='vertical'?Math.abs(b.y-a.y):Math.hypot(b.x-a.x,b.y-a.y);};
const isOpening=e=>['WINDOW','DOOR'].includes(e.category)||!!e.cardOpening;
const isWall=e=>e.type==='wall'||!!e.wallPreset;
/** 영역 안에 다 들어온 객체(출력 윈도우와 같은 기준)를 AI가 에너지 검토에 쓰기 좋은 모양으로. 모르는 값은 null. */
export function energyRegionContents(doc,region){
 const {minX,minY,maxX,maxY}=region.bounds,names=new Map((doc.layers||[]).map(l=>[l.id,l.name])),layer=e=>e.layer==null?null:names.get(e.layer)??String(e.layer);
 const out={texts:[],walls:[],openings:[],dimensions:[],closedShapes:[]},blocks=new Map(),layers=new Map(),types={};let total=0,truncated=false;
 const push=(key,value)=>{if(out[key].length<LIST_LIMIT)out[key].push(value);else truncated=true;};
 for(const e of doc.entities||[]){
  const b=G.bounds([e]);if(!b||b.minX<minX||b.minY<minY||b.maxX>maxX||b.maxY>maxY)continue;
  total++;types[e.type]=(types[e.type]||0)+1;const L=layer(e);if(L!==null)layers.set(L,(layers.get(L)||0)+1);
  if(e.type==='text'&&str(e.text))push('texts',{id:e.id,text:e.text,x:e.position?.x??null,y:e.position?.y??null,height:num(e.height)});
  else if(isWall(e))push('walls',{id:e.id,layer:L,lengthMm:Math.round(pathLength(e.points)),thicknessMm:num(e.thickness??e.parameters?.thickness),preset:str(e.wallPreset)??str(e.wallPreset?.name),exposure:str(e.exposure),reviewObjectId:str(e.reviewObjectId),thermalLayers:Array.isArray(e.thermalLayers)?structuredClone(e.thermalLayers):null});
  else if(isOpening(e)){const v=e.cardOpening?.values||{},p=e.parameters||{},a=e.attributes||{};push('openings',{id:e.id,layer:L,category:str(e.category),kind:str(v.kind)??str(p.style),widthMm:num(a.width??v.width??p.width),heightMm:num(a.height??v.height??p.height),sillMm:num(a.sill??v.sill??p.sill),uValue:num(e.uValue??p.uValue??v.uValue),airtightGrade:str(e.airtightGrade??p.airtightGrade??v.airtightGrade),shgc:num(e.shgc??p.shgc??v.shgc),reviewObjectId:str(e.reviewObjectId)});}
  else if(e.type==='dimension'){const v=dimensionValue(e);push('dimensions',{id:e.id,mode:e.mode??null,valueMm:v===null?null:Math.round(v)});}
  else if((e.type==='polyline'&&e.closed||e.type==='rectangle')&&e.points?.length>=3)push('closedShapes',{id:e.id,layer:L,areaM2:Math.round(G.polygonArea(e.points)/1e4)/100});
  else if(e.type==='block'&&str(e.name))blocks.set(e.name,(blocks.get(e.name)||0)+1);
 }
 return {region:{label:region.label,key:region.key,bounds:{...region.bounds}},counts:{total,byType:types},...out,
  blocks:[...blocks].map(([name,count])=>({name,count})),layers:[...layers].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count),truncated,
  view:{tool:'cad_view_drawing',window:{x0:minX,y0:minY,x1:maxX,y1:maxY}}};
}
export const ENERGY_REGION_FIELDS=[
 {name:'kind',label:'영역',type:'select',value:'floor',options:[['overview','개요'],['floor','층 평면'],['elevation','입면'],['section','단면'],['window_schedule','창호 일람표']]},
 {name:'floor',label:'층 (층 평면만 · 지하는 -1)',type:'number',value:''},
 {name:'direction',label:'방위 (입면만)',type:'select',value:'south',options:Object.entries(DIRECTIONS)},
 {name:'name',label:'단면 이름 (단면만 · 예: A-A)',value:''}];
/** 영역 입력 칸 — 부른 곳이 종류 등을 정해 열 수 있다(예: 에너지 ④ 창호 일람표). 객체가 아니면 기본값. */
export const energyRegionFields=(preset={})=>ENERGY_REGION_FIELDS.map(f=>preset&&typeof preset==='object'&&preset[f.name]!=null?{...f,value:preset[f.name]}:f);
/** 입력 창 값 → makeEnergyRegion 의 종류. 그 종류에 쓰지 않는 칸은 버린다. */
export function energyRegionSpec(values){
 const kind=values.kind,floor=String(values.floor??'').trim();
 return {kind,...(kind==='floor'?{floor:floor===''?null:Number(floor)}:{}),...(kind==='elevation'?{direction:values.direction}:{}),...(kind==='section'&&String(values.name??'').trim()?{name:String(values.name).trim()}:{})};
}
