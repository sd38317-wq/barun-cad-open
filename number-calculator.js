import * as G from './geometry.js';

export function drawingNumber(text){
 const s=String(text).trim().replaceAll('−','-');
 if(!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)$/.test(s))return null;
 const n=Number(s.replaceAll(',',''));return Number.isFinite(n)?n:null;
}
export function displayedDimensionNumber(text){
 const s=String(text).trim().replaceAll('−','-');
 const match=s.match(/^(?:R\s*|[Ø⌀]\s*)?([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+))\s*°?$/i);
 return match?drawingNumber(match[1]):null;
}
export function calculate(a,operator,b){
 if(!Number.isFinite(a)||!Number.isFinite(b))throw Error('유효한 숫자를 선택하세요.');
 if(operator==='/'&&b===0)throw Error('0으로 나눌 수 없습니다. 다른 숫자를 선택하세요.');
 const n=operator==='+'?a+b:operator==='-'?a-b:operator==='*'?a*b:operator==='/'?a/b:NaN;
 if(!Number.isFinite(n))throw Error('계산 가능한 숫자 범위를 넘었습니다.');
 return Number(n.toPrecision(14));
}
export function calculateSequence(operator,numbers){
 if(!['+','-','*','/'].includes(operator))throw Error('먼저 연산자를 선택하세요.');
 if(!Array.isArray(numbers)||!numbers.length)throw Error('계산할 숫자를 선택하세요.');
 return numbers.slice(1).reduce((result,number)=>calculate(result,operator,number),numbers[0]);
}
export function calculatorOperator(value){
 return ({'+':'+','-':'-','*':'*','/':'/','×':'*','÷':'/'})[String(value??'').trim()]||null;
}
export function formatCalculatedNumber(number,decimalPlaces='auto',grouping=false){
 if(!Number.isFinite(number))throw Error('표시할 계산 결과가 없습니다.');
 const normalized=Object.is(number,-0)?0:number;
 if(decimalPlaces==='auto'){
  const rounded=Number(normalized.toFixed(6));
  return rounded.toLocaleString('ko-KR',{useGrouping:grouping,maximumFractionDigits:6});
 }
 const places=Number(decimalPlaces);
 if(!Number.isInteger(places)||places<0||places>6)throw Error('소수 자릿수는 0~6으로 선택하세요.');
 return normalized.toLocaleString('ko-KR',{useGrouping:grouping,minimumFractionDigits:places,maximumFractionDigits:places});
}
export function resultTextEntity(text,position,source,fallbackLayer='default'){
 if(!source||source.type!=='text')throw Error('첫 숫자의 문자 모양을 확인할 수 없습니다.');
 const entity=structuredClone(source);
 for(const key of ['id','dimensionLabel','calculatorNumber','clipMasks'])delete entity[key];
 return {...entity,type:'text',text:String(text),position:{x:position.x,y:position.y},layer:source.layer||fallbackLayer,hidden:false};
}
export function numericLabels(entity){
 return G.visiblePrimitives(entity).flatMap(e=>{
  if(e.type!=='text'||e.hidden)return [];
  const number=e.dimensionLabel?displayedDimensionNumber(e.text):drawingNumber(e.text);
  return number===null?[]:[{...e,calculatorNumber:number}];
 });
}
export function numericLabelsInBox(entities,box,crossing=false){
 return entities.flatMap(root=>numericLabels(root).flatMap((label,index)=>{
  const bounds=G.bounds([label]);
  if(!bounds)return [];
  const overlaps=bounds.maxX>=box.minX&&bounds.minX<=box.maxX&&bounds.maxY>=box.minY&&bounds.minY<=box.maxY;
  const inside=bounds.minX>=box.minX&&bounds.maxX<=box.maxX&&bounds.minY>=box.minY&&bounds.maxY<=box.maxY;
  const key=`${root.id||'root'}:${label.id||index}:${label.text}:${label.position?.x??''}:${label.position?.y??''}`;
  return (crossing?overlaps:inside)?[{root,label,key}]:[];
 }));
}
// 소수 자릿수 설정(NUMDEC·숫자키 0~6)은 다음 실행에도 남긴다. 'auto' 는 고른 숫자에 맞춤.
const PLACES_KEY='barun-number-calculator-places';
function storedPlaces(){try{const v=localStorage.getItem(PLACES_KEY);return /^[0-6]$/.test(v??'')?Number(v):null;}catch{return null;}}
export function installNumberCalculator({canvas,visible,chosen=()=>[],worldPoint,scale,idle,reset,toast,insertResult,setSelection=()=>{},announce=()=>{},status=announce,started=()=>{}}){
 // 창 없이 동작한다: 연산자 키 → 숫자 클릭·드래그(또는 미리 고른 숫자) → Space/Enter → 결과 문자가 커서에 붙어 따라다니고 클릭한 곳에 놓인다.
 // 식과 결과는 명령줄에. 연산자를 바꾸면 다음 숫자부터 그 연산(10 + 5 − 3).
 const sign={'+':'+','-':'−','*':'×','/':'÷'};let active=false,placing=false,places=storedPlaces(),steps=[],operator=null,pressed=null,sourceLabel=null,selectedKeys=new Set(),selectedRoots=new Set();
 const value=()=>steps.at(-1)?.result;
 // 소수 자릿수: 숫자키 0~6 으로 고르면 그 값(다음 계산에도 유지), 아니면 고른 숫자 중 가장 긴 소수 자리에 맞춘다(151.25 → 2자리).
 const decimals=()=>places??Math.min(6,Math.max(0,...steps.map(step=>step.decimals)));
 const formatted=()=>formatCalculatedNumber(value(),String(decimals()),sourceLabel?.text?.includes(','));
 const formula=()=>{const part=(step,i)=>(i?` ${sign[step.op]} `:'')+step.number;return steps.length<=10?steps.map(part).join(''):`${steps.slice(0,5).map(part).join('')} … ${steps.slice(-2).map((step,i)=>part(step,i+1)).join('')} (${steps.length}개)`;};
 const recompute=()=>{let result=null;for(const step of steps){result=result===null?step.number:calculate(result,step.op,step.number);step.result=result;}};
 const show=()=>status(steps.length?`${formula()} = ${formatted()} · 소수 ${decimals()}자리(숫자키 0~6) · ${sign[operator]} 숫자 계속 선택 · Space/Enter 결과 놓기 · Backspace 취소 · Esc 끝`:`${sign[operator]} 계산 · 숫자를 클릭하거나 드래그로 선택하세요 · Esc 끝`);
 const entriesOf=roots=>roots.flatMap(root=>numericLabels(root).map((label,index)=>({root,label,key:`${root.id||'root'}:${label.id||index}:${label.text}:${label.position?.x??''}:${label.position?.y??''}`})));
 function addEntries(entries){const additions=entries.filter(entry=>!selectedKeys.has(entry.key));if(!additions.length){status('이미 선택한 숫자입니다.');return;}const before=steps;steps=[...steps,...additions.map(entry=>({number:entry.label.calculatorNumber,decimals:String(entry.label.text).match(/\.(\d+)/)?.[1].length??0,op:operator,key:entry.key,rootId:entry.root?.id}))];try{recompute();}catch(e){steps=before;recompute();status(e.message);return;}if(!sourceLabel)sourceLabel=structuredClone(additions[0].label);for(const entry of additions){selectedKeys.add(entry.key);if(entry.root?.id)selectedRoots.add(entry.root.id);}setSelection([...selectedRoots]);show();}
 function back(){const removed=steps.pop();if(removed){selectedKeys.delete(removed.key);if(removed.rootId&&!steps.some(step=>step.rootId===removed.rootId))selectedRoots.delete(removed.rootId);}if(!steps.length)sourceLabel=null;recompute();setSelection([...selectedRoots]);show();}
 function start(op){const preselected=entriesOf(chosen());reset();active=true;placing=false;steps=[];sourceLabel=null;selectedKeys.clear();selectedRoots.clear();operator=op||'+';started(operator);announce(`${sign[operator]} 숫자 계산`);if(preselected.length)addEntries(preselected);else{setSelection([]);show();}canvas.focus();}
 const close=()=>{active=false;placing=false;pressed=null;canvas.focus();};
 function beginPlacing(){if(!steps.length||!sourceLabel){show();return;}placing=true;status(`${formula()} = ${formatted()} · 놓을 곳을 클릭하세요 · 소수 ${decimals()}자리(숫자키 0~6) · Esc 끝`);}
 window.addEventListener('keydown',e=>{
  if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.target?.closest?.('input,textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]'))return;
  const op={'+':'+','-':'-','*':'*','/':'/','×':'*','÷':'/'}[e.key];
  if(!active){if(!op||!idle())return;e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)start(op);return;}
  if(!idle()){close();return;}
  if(/^[0-6]$/.test(e.key)){e.preventDefault();e.stopImmediatePropagation();setPlaces(Number(e.key));if(placing)beginPlacing();else show();return;}
  if(op||['Escape','Backspace','Enter',' '].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;if(e.key==='Escape'){close();status('숫자 계산을 마쳤습니다.');}else if(placing){if(e.key==='Backspace'){placing=false;show();}}else if(op){operator=op;show();}else if(e.key==='Backspace')back();else beginPlacing();}
 },true);
 canvas.addEventListener('pointerdown',e=>{
  if(!active||!idle()||e.button!==0||e.ctrlKey||e.metaKey||e.altKey)return;
  e.preventDefault();e.stopImmediatePropagation();canvas.focus();const point=worldPoint(e);let best=null,distance=14/scale();
  for(const root of visible().toReversed()){const labels=numericLabels(root);for(let index=labels.length-1;index>=0;index--){const label=labels[index];if(!G.visiblePoint(label,point))continue;const d=G.entityDistance(label,point);if(d<distance){best={root,label,key:`${root.id||'root'}:${label.id||index}:${label.text}:${label.position?.x??''}:${label.position?.y??''}`};distance=d;}}}
  pressed={pointerId:e.pointerId,startClient:{x:e.clientX,y:e.clientY},startWorld:point,best};canvas.setPointerCapture?.(e.pointerId);
 },true);
 window.addEventListener('pointermove',e=>{if(!pressed||e.pointerId!==pressed.pointerId)return;e.preventDefault();e.stopImmediatePropagation();},true);
 window.addEventListener('pointerup',e=>{if(!pressed||e.pointerId!==pressed.pointerId||e.button!==0)return;const pending=pressed;pressed=null;e.preventDefault();e.stopImmediatePropagation();canvas.releasePointerCapture?.(e.pointerId);const end=worldPoint(e),moved=Math.hypot(e.clientX-pending.startClient.x,e.clientY-pending.startClient.y);
  if(placing){if(moved<4){try{const text=formatted();insertResult(resultTextEntity(text,end,sourceLabel));setSelection([]);toast(`${formula()} = ${text} 를 도면에 배치했습니다.`);close();}catch(error){status(error.message);}}return;}
  if(moved>=4){const box={minX:Math.min(pending.startWorld.x,end.x),minY:Math.min(pending.startWorld.y,end.y),maxX:Math.max(pending.startWorld.x,end.x),maxY:Math.max(pending.startWorld.y,end.y)};const entries=numericLabelsInBox(visible(),box,e.clientX<pending.startClient.x);if(entries.length)addEntries(entries);else status('선택창 안에 계산 가능한 숫자가 없습니다.');return;}
  if(pending.best){addEntries([pending.best]);return;}
  status('숫자 문자 또는 숫자로 표시된 치수를 클릭하거나 드래그 선택하세요.');
 },true);
 function setPlaces(value){places=value===null||value==='auto'?null:Number(value);try{localStorage.setItem(PLACES_KEY,places===null?'auto':String(places));}catch{}}
 return {open:(operator=null)=>start(operator),close,places:()=>places,setPlaces,get active(){return active;},get picking(){return active&&!placing;},get placing(){return active&&placing;},draft:cursor=>active&&placing&&cursor&&sourceLabel?[resultTextEntity(formatted(),cursor,sourceLabel)]:null};
}
