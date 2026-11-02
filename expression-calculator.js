import * as G from './geometry.js';

/* 계산기 창(CAL). 식 계산기 + 도면 숫자 찍기(포인트).
   - 식은 eval 없이 직접 만든 파서로 계산한다(+ − × ÷ ( ) %, 천 단위 쉼표 무시).
   - 포인트: 커서 근처 후보만 공간 인덱스(nearby)에서 받아 글자(문자·다중문자·치수·블록 속성)의 숫자를 식에 넣는다. */

const OP_SIGN={'+':'+','-':'−','*':'×','/':'÷'};

// ── 글자 → 숫자들 ─────────────────────────────────────────────
export function stripTextMarkup(text){
 return String(text??'')
  .replace(/\\[fFcCHhQqWwTtAa][^;\\]*;/g,'')
  .replace(/\\[Pp]/g,'\n').replace(/\\[LlOoKk~]/g,'')
  .replace(/%%[cC]/g,'Ø').replace(/%%[dD]/g,'°').replace(/%%[pP]/g,'±').replace(/[{}]/g,'')
  .replace(/\\\\/g,'\\');
}
const NUMBER_RE=/[-−]?(?:\d{1,3}(?:,\d{3})+(?!\d)(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)/g;
export function extractNumbers(text){
 const s=stripTextMarkup(text),out=[];
 for(const m of s.matchAll(NUMBER_RE)){
  let raw=m[0];
  if(raw[0]==='-'||raw[0]==='−'){
   const before=s[m.index-1];
   if(before!==undefined&&!/[\s(=:,;]/.test(before))raw=raw.slice(1); // "A-101", "2020-05" 의 붙임표는 부호가 아니다
  }
  const value=Number(raw.replaceAll(',','').replaceAll('−','-'));
  if(Number.isFinite(value))out.push({value,raw,index:m.index});
 }
 return out;
}

// ── 식 계산(안전한 파서) ──────────────────────────────────────
export function tokenizeExpression(input){
 const s=String(input??'').replaceAll('−','-').replaceAll('–','-').replaceAll('×','*').replaceAll('÷','/').replaceAll('（','(').replaceAll('）',')');
 const tokens=[];let i=0;
 while(i<s.length){
  const ch=s[i];
  if(/\s/.test(ch)){i++;continue;}
  if('+-*/()%'.includes(ch)){tokens.push({t:ch});i++;continue;}
  if(/[\d.]/.test(ch)){
   const m=/^(?:\d[\d,]*(?:\.\d*)?|\.\d+)/.exec(s.slice(i));
   if(!m)throw Error('숫자를 읽을 수 없습니다.');
   const n=Number(m[0].replaceAll(',',''));
   if(!Number.isFinite(n))throw Error('숫자를 읽을 수 없습니다.');
   tokens.push({t:'n',v:n});i+=m[0].length;continue;
  }
  throw Error(`사용할 수 없는 글자: ${ch}`);
 }
 return tokens;
}
export function evaluateExpression(input){
 const tokens=tokenizeExpression(input);let pos=0;
 if(!tokens.length)throw Error('식이 비어 있습니다.');
 const peek=()=>tokens[pos]?.t,next=()=>tokens[pos++];
 function primary(){
  const tk=next();
  if(!tk)throw Error('식이 끝나지 않았습니다.');
  if(tk.t==='n')return {v:tk.v,pct:false};
  if(tk.t==='('){const r=expr();if(next()?.t!==')')throw Error('괄호가 닫히지 않았습니다.');return {v:r.v,pct:false};}
  throw Error('숫자가 필요합니다.');
 }
 function unary(){
  if(peek()==='-'){next();const r=unary();return {v:-r.v,pct:r.pct};}
  if(peek()==='+'){next();return unary();}
  let r=primary();
  while(peek()==='%'){next();r={v:r.v/100,pct:true};}
  return r;
 }
 function term(){
  let l=unary();
  while(peek()==='*'||peek()==='/'){
   const op=next().t,r=unary();
   if(op==='/'){if(r.v===0)throw Error('0으로 나눌 수 없습니다.');l={v:l.v/r.v,pct:false};}
   else l={v:l.v*r.v,pct:false};
  }
  return l;
 }
 function expr(){
  let l=term();
  while(peek()==='+'||peek()==='-'){
   const op=next().t,r=term();
   // 100+10% → 110 (계산기식 퍼센트: 앞 값의 비율)
   const rv=r.pct?l.v*r.v:r.v;
   l={v:op==='+'?l.v+rv:l.v-rv,pct:false};
  }
  return l;
 }
 const result=expr();
 if(pos<tokens.length)throw Error('식을 해석할 수 없습니다.');
 if(!Number.isFinite(result.v))throw Error('계산 범위를 넘었습니다.');
 return Number(result.v.toPrecision(14));
}
// 입력 중인 식의 실시간 합계: 끝의 연산자를 떼고 열린 괄호를 닫아 계산해 본다.
export function liveValue(input){
 let s=String(input??'').trim();
 if(!s)return null;
 try{return evaluateExpression(s);}catch{}
 s=s.replace(/[\s+\-−×÷*/(]+$/,'');
 if(!s)return null;
 const open=(s.match(/\(/g)||[]).length-(s.match(/\)/g)||[]).length;
 if(open>0)s+=')'.repeat(open);
 try{return evaluateExpression(s);}catch{return null;}
}
export function formatNumber(n,grouping=true){
 if(!Number.isFinite(n))return '';
 const v=Number(Number(n).toFixed(6));
 return v.toLocaleString('ko-KR',{useGrouping:grouping,maximumFractionDigits:6});
}
export function plainNumber(n){return String(Number(Number(n).toFixed(6)));}

// 캐럿 위치에 숫자를 식으로 넣는다. 앞이 비었거나 연산자·여는 괄호면 숫자만, 아니면 지정 연산자와 함께.
export function insertPickedNumber(expression,caret,value,operator='+'){
 const at=Math.max(0,Math.min(expression.length,caret??expression.length));
 let before=expression.slice(0,at);const after=expression.slice(at);
 const number=value<0?`(${plainNumber(value)})`:plainNumber(value);
 const trimmed=before.trim();
 const needsOp=trimmed&&!/[+\-−×÷*/(]$/.test(trimmed);
 if(needsOp)before=before.replace(/\s+$/,'');
 const piece=(needsOp?` ${OP_SIGN[operator]||'+'} `:trimmed&&!/\($/.test(trimmed)&&!/\s$/.test(before)?' ':'')+number;
 return {text:before+piece+after,caret:before.length+piece.length};
}

// ── 도면에서 글자 찾기 ────────────────────────────────────────
const textCache=new WeakMap();
export function numericTextsOf(root){
 if(!root)return [];
 let cached=textCache.get(root);
 if(cached)return cached;
 const prims=root.type==='text'?[root]:G.visiblePrimitives(root);
 cached=prims.filter(e=>e.type==='text'&&!e.hidden&&extractNumbers(e.text).length).map(label=>({root,label}));
 textCache.set(root,cached);
 return cached;
}
export function textAtPoint(candidates,point,tolerance){
 let best=null,bestDistance=tolerance;
 for(let i=candidates.length-1;i>=0;i--){
  for(const item of numericTextsOf(candidates[i])){
   if(!G.visiblePoint(item.label,point))continue;
   const d=G.entityDistance(item.label,point,bestDistance);
   if(d<bestDistance||(best===null&&d<=tolerance)){best=item;bestDistance=d;}
  }
 }
 return best;
}

// ── 창 ───────────────────────────────────────────────────────
export function installExpressionCalculator({canvas,nearby,screen,worldPoint,scale,positionKey='barun-calculator-position'}){
 const host=canvas.parentElement;
 const panel=document.createElement('section');panel.id='expression-calculator';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','계산기');
 panel.innerHTML=`<div class="ec-heading"><strong>계산기</strong><button type="button" class="ec-close" aria-label="계산기 닫기" title="닫기 (Esc)">×</button></div>
<input class="ec-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="계산식" placeholder="예: 151.25 + 157.92">
<output class="ec-total" aria-live="polite">0</output>
<div class="ec-pickrow"><button type="button" class="ec-pick" aria-pressed="false" title="도면의 숫자를 눌러 식에 넣습니다">포인트</button><span class="ec-pickop" role="group" aria-label="포인트 연산자"></span></div>
<div class="ec-keys"></div>
<p class="ec-status" role="status"></p>
<div class="ec-chooser" hidden></div>
<div class="ec-history" aria-label="최근 결과"></div>`;
 host.append(panel);
 const hover=document.createElement('div');hover.className='ec-hover';hover.hidden=true;host.append(hover);
 const $=s=>panel.querySelector(s),input=$('.ec-input'),total=$('.ec-total'),status=$('.ec-status');
 let pickOp='+',picking=false,pressed=null,hovered=null,pending=0,lastMove=null,history=[];
 try{const saved=JSON.parse(localStorage.getItem('barun-calculator-history')||'[]');if(Array.isArray(saved))history=saved.filter(h=>h&&typeof h.expr==='string').slice(0,8);}catch{}

 const say=m=>{status.textContent=m||'';};
 function renderTotal(){
  const v=liveValue(input.value);
  total.textContent=v===null?(input.value.trim()?'…':'0'):formatNumber(v);
  total.dataset.value=v===null?'':String(v);
 }
 function setText(text,caret){input.value=text;const c=caret??text.length;input.setSelectionRange(c,c);renderTotal();}
 function renderHistory(){
  const box=$('.ec-history');box.replaceChildren();
  for(const item of history){
   const b=document.createElement('button');b.type='button';b.className='ec-hist';b.title=item.expr+' = '+item.result;
   const l=document.createElement('span'),r=document.createElement('b');l.textContent=item.expr;r.textContent='= '+formatNumber(Number(item.result));b.append(l,r);
   b.onclick=()=>{setText(plainNumber(Number(item.result)));input.focus();};
   box.append(b);
  }
 }
 function evaluate(){
  try{
   const expr=input.value.trim();
   if(!expr){say('식을 입력하세요.');return;}
   const v=evaluateExpression(expr);
   history=[{expr,result:String(v)},...history.filter(h=>h.expr!==expr)].slice(0,8);
   try{localStorage.setItem('barun-calculator-history',JSON.stringify(history));}catch{}
   renderHistory();setText(plainNumber(v));say('결과 '+formatNumber(v));
  }catch(e){say(e.message);}
 }
 async function copy(){
  const v=liveValue(input.value);
  if(v===null){say('복사할 결과가 없습니다.');return;}
  try{await navigator.clipboard.writeText(plainNumber(v));say('결과를 복사했습니다: '+formatNumber(v));}catch{say('위 결과 숫자를 선택하여 복사하세요.');}
 }
 function insertText(t){
  const s=input.selectionStart??input.value.length,e=input.selectionEnd??s,v=input.value;
  setText(v.slice(0,s)+t+v.slice(e),s+t.length);input.focus();
 }
 function addNumber(value){
  const r=insertPickedNumber(input.value,input.selectionEnd??input.value.length,value,pickOp);
  setText(r.text,r.caret);
  const live=liveValue(input.value);
  say(`${plainNumber(value)} 입력 · 합계 ${live===null?'…':formatNumber(live)}`);
 }

 // 화면 키패드
 const keys=[['C','C'],['(','('],[')',')'],['⌫','back'],['7','7'],['8','8'],['9','9'],['÷','/'],['4','4'],['5','5'],['6','6'],['×','*'],['1','1'],['2','2'],['3','3'],['−','-'],['0','0'],['.','.'],['%','%'],['+','+']];
 for(const [label,code] of keys){
  const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.key=code;
  if('+-*/'.includes(code))b.classList.add('ec-op');
  b.onclick=()=>{
   if(code==='C'){setText('');say('');input.focus();}
   else if(code==='back'){const s=input.selectionStart??0,e=input.selectionEnd??s;if(s!==e)setText(input.value.slice(0,s)+input.value.slice(e),s);else if(s>0)setText(input.value.slice(0,s-1)+input.value.slice(s),s-1);input.focus();}
   else insertText(label);
  };
  $('.ec-keys').append(b);
 }
 {const eq=document.createElement('button');eq.type='button';eq.textContent='=';eq.className='ec-eq';eq.dataset.key='=';eq.title='계산 (Enter)';eq.onclick=()=>{evaluate();input.focus();};$('.ec-keys').append(eq);}
 for(const op of ['+','-','*','/']){
  const b=document.createElement('button');b.type='button';b.textContent=OP_SIGN[op];b.dataset.op=op;b.setAttribute('aria-pressed',String(op===pickOp));b.title='포인트로 찍는 숫자 앞에 넣을 연산자';
  b.onclick=()=>{pickOp=op;for(const x of $('.ec-pickop').children)x.setAttribute('aria-pressed',String(x.dataset.op===op));};
  $('.ec-pickop').append(b);
 }
 {const b=document.createElement('button');b.type='button';b.className='ec-copy';b.textContent='복사';b.title='결과 복사';b.onclick=copy;$('.ec-pickrow').append(b);}

 // 포인트(도면 숫자 찍기): 커서 근처 후보만 공간 인덱스에서 받는다.
 const tolerance=()=>10/scale();
 function findAt(e){
  const p=worldPoint(e),tol=tolerance();
  return textAtPoint(nearby(p,tol),p,tol);
 }
 function showHover(hit){
  hovered=hit;
  if(!hit){hover.hidden=true;return;}
  const b=G.bounds([hit.label]);
  if(!b){hover.hidden=true;return;}
  const a=screen({x:b.minX,y:b.maxY}),c=screen({x:b.maxX,y:b.minY});
  hover.style.left=(canvas.offsetLeft+Math.min(a.x,c.x)-3)+'px';hover.style.top=(canvas.offsetTop+Math.min(a.y,c.y)-3)+'px';
  hover.style.width=(Math.abs(c.x-a.x)+6)+'px';hover.style.height=(Math.abs(c.y-a.y)+6)+'px';hover.hidden=false;
 }
 function hideChooser(){const ch=$('.ec-chooser');ch.hidden=true;ch.replaceChildren();}
 function choose(numbers,label){
  const ch=$('.ec-chooser');ch.replaceChildren();
  const title=document.createElement('span');title.textContent='어느 숫자? '+stripTextMarkup(label.text).replace(/\s+/g,' ').slice(0,30);ch.append(title);
  for(const n of numbers){const b=document.createElement('button');b.type='button';b.textContent=formatNumber(n.value);b.onclick=()=>{hideChooser();addNumber(n.value);input.focus();};ch.append(b);}
  const all=document.createElement('button');all.type='button';all.textContent='모두 더하기';all.onclick=()=>{hideChooser();for(const n of numbers)addNumber(n.value);input.focus();};ch.append(all);
  ch.hidden=false;
 }
 function pickHit(hit){
  const nums=extractNumbers(hit.label.text);
  if(!nums.length)return;
  if(nums.length===1){hideChooser();addNumber(nums[0].value);}
  else choose(nums,hit.label);
 }
 function setPicking(on){
  picking=!!on;$('.ec-pick').setAttribute('aria-pressed',String(picking));canvas.classList.toggle('ec-picking',picking);
  if(!picking){showHover(null);pressed=null;}
  say(picking?'도면의 숫자를 클릭하세요 · 오른쪽 클릭 또는 Esc로 끝냅니다.':'');
  if(picking)panel.hidden=false;
 }
 $('.ec-pick').onclick=()=>setPicking(!picking);

 canvas.addEventListener('pointerdown',e=>{
  if(!picking)return;
  if(e.button===2){e.preventDefault();e.stopImmediatePropagation();setPicking(false);return;}
  if(e.button!==0||e.ctrlKey||e.metaKey||e.altKey)return;
  e.preventDefault();e.stopImmediatePropagation();
  pressed={id:e.pointerId,x:e.clientX,y:e.clientY};
 },true);
 window.addEventListener('pointerup',e=>{
  if(!picking||!pressed||e.pointerId!==pressed.id||e.button!==0)return;
  const start=pressed;pressed=null;e.preventDefault();e.stopImmediatePropagation();
  if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>=5)return;
  const hit=findAt(e);
  if(hit){showHover(hit);pickHit(hit);input.focus();}else say('이 자리에는 숫자 글자가 없습니다.');
 },true);
 canvas.addEventListener('contextmenu',e=>{if(picking){e.preventDefault();e.stopImmediatePropagation();}},true);
 canvas.addEventListener('pointermove',e=>{
  if(!picking)return;
  lastMove={clientX:e.clientX,clientY:e.clientY};
  if(pending)return;
  pending=requestAnimationFrame(()=>{pending=0;if(!picking||!lastMove)return;const hit=findAt(lastMove);if(hit?.label!==hovered?.label)showHover(hit);});
 });
 canvas.addEventListener('pointerleave',()=>{if(picking)showHover(null);});

 // 창 열기/닫기/끌기(위치는 기억한다)
 function place(){
  let pos=null;try{pos=JSON.parse(localStorage.getItem(positionKey)||'null');}catch{}
  if(pos&&Number.isFinite(pos.left)&&Number.isFinite(pos.top)){
   panel.style.left=Math.max(0,Math.min(pos.left,host.clientWidth-80))+'px';panel.style.top=Math.max(0,Math.min(pos.top,host.clientHeight-40))+'px';panel.style.right='auto';
  }
 }
 function open(){panel.hidden=false;place();renderTotal();renderHistory();input.focus();input.select();}
 function close(){setPicking(false);hideChooser();panel.hidden=true;canvas.focus();}
 $('.ec-close').onclick=close;
 $('.ec-heading').addEventListener('pointerdown',e=>{
  if(e.target.closest('button')||e.button!==0)return;
  const r=panel.getBoundingClientRect(),h=host.getBoundingClientRect(),dx=e.clientX-r.left,dy=e.clientY-r.top;
  const move=ev=>{panel.style.left=Math.max(0,Math.min(ev.clientX-h.left-dx,host.clientWidth-60))+'px';panel.style.top=Math.max(0,Math.min(ev.clientY-h.top-dy,host.clientHeight-30))+'px';panel.style.right='auto';};
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);try{localStorage.setItem(positionKey,JSON.stringify({left:parseFloat(panel.style.left),top:parseFloat(panel.style.top)}));}catch{}};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);e.preventDefault();
 });
 input.addEventListener('input',()=>{renderTotal();say('');});
 panel.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  e.stopPropagation();
  if(e.key==='Enter'){e.preventDefault();evaluate();}
  else if(e.key==='Escape'){e.preventDefault();if(picking)setPicking(false);else close();}
 });
 // 포인트 중 Esc 는 캔버스 쪽 다른 명령 취소보다 먼저 포인트만 끝낸다.
 window.addEventListener('keydown',e=>{
  if(panel.hidden||e.key!=='Escape')return;
  const inside=panel.contains(e.target);
  if(!picking&&!inside)return;
  e.preventDefault();e.stopImmediatePropagation();
  if(picking)setPicking(false);else close(); // 앱의 전역 Esc(명령 취소)보다 먼저 처리해야 창 안에서 Esc 가 닫기로 동작한다
 },true);
 panel.addEventListener('pointerdown',e=>e.stopPropagation());
 panel.addEventListener('wheel',e=>e.stopPropagation());
 return {open,close,toggle:()=>panel.hidden?open():close(),get active(){return !panel.hidden;},get picking(){return picking;},setPicking,setText,evaluate,panel};
}
