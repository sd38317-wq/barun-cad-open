// 사무실 패드 화면(같은 와이파이). PC 화면 사진 위에 펜으로 표시·그리기·고르기(마우스)·글을 하고, 지시 칸으로 명령·AI 를 보낸다.
// 패드는 점과 글만 보낸다. 실제 일은 PC 가 한다. 7.0: 손가락으로 당기면 PC 화면도 같이 움직이고(A25), 자로 곧은 선(A26).
const $=id=>document.getElementById(id),pad=$('pad'),drawing=$('drawing'),ink=$('ink');
const TOKEN_KEY='barun-pad-token',RULER_LENGTH=420,RULER_HEIGHT=64,EDGE_PX=26;
let token='',seq=0,queue=[],sending=false,retryAt=0,frameId=0,frameBusy=false,frameReady=false,lastFrameAt=0,info={};
let imageWidth=1600,imageHeight=900,viewScale=1,offset={x:0,y:0},viewMode='fit',syncWaiting=false;
let pointers=new Map(),stroke=null,gesture=null,penSeen=false,mode='mark',lastTap=0,localInk=[],textAt=null,textAs='memo';
const ruler={visible:false,x:0,y:0,angle:0,drag:null};
try{token=sessionStorage.getItem(TOKEN_KEY)||'';}catch{}

async function post(path,data){
 const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(6000)});
 let v={};try{v=await r.json();}catch{}
 if(!r.ok){const error=Error(v.error||'연결 오류');error.status=r.status;throw error;}return v;
}
// ── 화면 맞추기 ──
function bars(){const top=$('top').getBoundingClientRect().bottom,bottom=$('bottom').getBoundingClientRect().top;return {top,bottom:bottom>top?bottom:innerHeight};}
// 당기는 동안은 사진 밖으로도 끌 수 있다(PC 화면 밖을 보러 감, A24). 손을 떼면 PC 가 그 자리를 새로 그려 보낸다.
function paintView(){const r=pad.getBoundingClientRect(),w=imageWidth*viewScale,h=imageHeight*viewScale;offset.x=Math.min(r.width*.9,Math.max(r.width*.1-w,offset.x));offset.y=Math.min(r.height*.9,Math.max(r.height*.1-h,offset.y));drawing.style.cssText=`width:${w}px;height:${h}px;left:${offset.x}px;top:${offset.y}px`;drawInk();}
function fitScale(){const r=pad.getBoundingClientRect();return Math.min(r.width/imageWidth,r.height/imageHeight);}
function fitView(){viewMode='fit';const r=pad.getBoundingClientRect();viewScale=fitScale();offset={x:(r.width-imageWidth*viewScale)/2,y:(r.height-imageHeight*viewScale)/2};paintView();}
function layout(){const {top,bottom}=bars();pad.style.cssText=`left:0;top:${top}px;width:${innerWidth}px;height:${Math.max(80,bottom-top)}px`;if(viewMode==='fit')fitView();else paintView();placeRuler();}
function zoomAt(factor,x,y){const minimum=fitScale(),old=viewScale;viewScale=Math.max(minimum*.5,Math.min(minimum*12,viewScale*factor));const k=viewScale/old;offset={x:x-(x-offset.x)*k,y:y-(y-offset.y)*k};viewMode='custom';paintView();}
const padPoint=e=>{const r=pad.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
const toImage=p=>({x:(p.x-offset.x)/viewScale,y:(p.y-offset.y)/viewScale});
const toPad=p=>({x:offset.x+p.x*viewScale,y:offset.y+p.y*viewScale});
function normalized(p){const q=toImage(p);return {x:Math.max(0,Math.min(1,q.x/imageWidth)),y:Math.max(0,Math.min(1,q.y/imageHeight))};}

// ── 보내기: 와이파이가 밀려도 획을 버리지 않는다(A20), 끊겨도 다시 붙는다(A21) ──
function send(event){
 queue.push(event.kind==='point'?{...event,frame:frameId}:event);
 if(queue.length>3000){const moves=queue.map((e,i)=>e.kind==='point'&&e.phase==='move'?i:-1).filter(i=>i>=0);const drop=new Set(moves.filter((_,k)=>k%2===0));queue=queue.filter((_,i)=>!drop.has(i));}
}
async function flush(){
 if(!token||sending||Date.now()<retryAt||!queue.length)return;sending=true;const session=token,events=queue.slice(0,256);
 try{await post('/input',{token:session,seq,events});seq++;queue=queue.slice(events.length);retryAt=0;}
 catch(e){if(session!==token)return;if(e.status===403){disconnect('PC 연결이 끝났습니다. 새 코드로 다시 연결하세요.');return;}retryAt=Date.now()+800;$('status').textContent='다시 보내는 중…';}
 finally{sending=false;}
}
function disconnect(message){cancelStroke();token='';try{sessionStorage.removeItem(TOKEN_KEY);}catch{}frameReady=false;queue=[];$('status').textContent='연결 끊김';$('status').classList.remove('live');$('login').hidden=false;$('error').textContent=message;}

// ── PC 화면 받기 ──
async function receiveFrame(){
 if(!token||frameBusy)return;frameBusy=true;const session=token;
 try{
  const r=await post('/frame',{token:session,after:frameId});if(session!==token)return;
  if(r.info)updateInfo(r.info);
  if(r.frame){const frame=r.frame;   // img.decode() 는 가려진 화면에서 끝나지 않을 수 있다 — 바로 붙인다
   const resized=imageWidth!==frame.width||imageHeight!==frame.height;imageWidth=frame.width;imageHeight=frame.height;drawing.src=frame.image;frameId=frame.id;
   if(!frameReady||resized||syncWaiting){syncWaiting=false;fitView();}
   frameReady=true;lastFrameAt=Date.now();$('waiting').hidden=true;
   const now=Date.now();localInk=localInk.filter(s=>!s.until||s.until>now);drawInk();}
  const fresh=frameReady&&Date.now()-lastFrameAt<12000;$('status').classList.toggle('live',fresh);
  $('status').textContent=fresh?(info.drawing?'연결됨 · '+info.drawing:'연결됨'):frameReady?'PC 화면 기다리는 중':'도면 받는 중';
 }catch(e){if(e.status===403){disconnect('PC 연결이 끝났습니다. 새 코드로 다시 연결하세요.');return;}$('status').textContent='화면 다시 받는 중';$('status').classList.remove('live');}
 finally{frameBusy=false;}
}
function updateInfo(next){
 info=next||{};const pending=info.pending||'';
 $('pending').hidden=!pending;$('pending').textContent=pending;for(const id of ['cancel','confirm'])$(id).hidden=!pending;
 if(info.message&&info.message!==updateInfo.last){updateInfo.last=info.message;$('ask').placeholder=info.message;}
}

// ── 패드 위 선(PC 사진이 올 때까지 남겨 둔다, A12) ──
function drawInk(){
 const paths=[...localInk,...(stroke?.points?.length?[stroke]:[])].filter(s=>s.points.length>1);
 ink.innerHTML=paths.map(s=>`<polyline fill="none" stroke="${s.mode==='draw'?'#9dcbe0':'#ff9d59'}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${s.points.map(p=>{const q=toPad(p);return q.x.toFixed(1)+','+q.y.toFixed(1);}).join(' ')}"/>`).join('');
}

// ── 자(A26): 손가락으로 옮기고 돌리고, 펜을 가장자리에 대면 곧은 선 ──
function placeRuler(){const el=$('ruler');el.hidden=!ruler.visible;el.style.transform=`translate(${ruler.x}px,${ruler.y}px) rotate(${ruler.angle}deg)`;$('ruler-label').textContent=Math.round(((ruler.angle%360)+360)%360)+'°';}
function rulerLocal(p){const a=-ruler.angle*Math.PI/180,dx=p.x-ruler.x,dy=p.y-ruler.y;return {x:dx*Math.cos(a)-dy*Math.sin(a),y:dx*Math.sin(a)+dy*Math.cos(a)};}
function rulerGlobal(q){const a=ruler.angle*Math.PI/180;return {x:ruler.x+q.x*Math.cos(a)-q.y*Math.sin(a),y:ruler.y+q.x*Math.sin(a)+q.y*Math.cos(a)};}
const onRuler=p=>{if(!ruler.visible)return false;const q=rulerLocal(p);return q.x>=0&&q.x<=RULER_LENGTH&&q.y>=0&&q.y<=RULER_HEIGHT;};
function rulerEdge(p){if(!ruler.visible)return null;const q=rulerLocal(p);if(q.x<-20||q.x>RULER_LENGTH+20)return null;for(const edge of [0,RULER_HEIGHT])if(Math.abs(q.y-edge)<=EDGE_PX)return edge;return null;}
function snapAngle(a){for(const t of [0,45,90,135,180,225,270,315,360])if(Math.abs(((a%360)+360)%360-t)<=3)return t%360;return a;}
function showMeasure(p,lengthPad){const mm=info.unitsPerPixel?Math.round(lengthPad/viewScale*info.unitsPerPixel):null,el=$('measure');if(mm===null){el.hidden=true;return;}el.hidden=false;el.textContent=mm.toLocaleString('ko-KR');el.style.left=(p.x+14)+'px';el.style.top=(p.y-34)+'px';}

// ── 펜·손가락 ──
function pair(){const ps=[...pointers.values()];if(ps.length!==2)return null;return {x:(ps[0].x+ps[1].x)/2,y:(ps[0].y+ps[1].y)/2,d:Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y),a:Math.atan2(ps[1].y-ps[0].y,ps[1].x-ps[0].x)*180/Math.PI};}
function cancelStroke(){if(stroke){if(stroke.sent)send({kind:'point',phase:'cancel',mode:stroke.mode});stroke=null;$('measure').hidden=true;drawInk();}}
function startGesture(){cancelStroke();const g=pair();if(!g)return;const onBoth=[...pointers.values()].every(onRuler);gesture={...g,ruler:onBoth,startScale:viewScale,moved:false};}
// 손가락을 다 떼면 패드에서 당긴 만큼 PC 화면도 옮긴다. 새 사진이 오면 패드는 다시 맞춤 보기(선명).
function syncView(startScale){
 const r=pad.getBoundingClientRect(),center=normalized({x:r.width/2,y:r.height/2}),factor=viewScale/(startScale||fitScale());
 if(Math.abs(factor-1)<.02&&Math.abs(center.x-.5)<.01&&Math.abs(center.y-.5)<.01)return;
 send({kind:'view',factor:Math.max(.05,Math.min(20,factor)),x:center.x,y:center.y,dx:.5-center.x,dy:.5-center.y});syncWaiting=true;
}
const touchOnly=e=>e.pointerType==='touch'&&penSeen;   // 펜을 한 번 쓰면 손가락·손바닥은 그리지 않고 화면만 옮긴다(A22)

pad.onpointerdown=e=>{
 e.preventDefault();if(!frameReady||!token)return;if(e.pointerType==='pen')penSeen=true;
 const p=padPoint(e);
 if(e.pointerType==='pen'&&pointers.size){for(const [id,q] of pointers)if(q.type==='touch')pointers.delete(id);cancelStroke();gesture=null;}
 if(stroke?.type==='pen'&&e.pointerType==='touch')return;
 try{pad.setPointerCapture(e.pointerId);}catch{}
 pointers.set(e.pointerId,{...p,type:e.pointerType});
 if(pointers.size>1){startGesture();return;}
 // 손가락으로 자를 잡으면 자를 옮긴다
 if(e.pointerType!=='pen'&&onRuler(p)){ruler.drag={from:p,x:ruler.x,y:ruler.y};return;}
 if(touchOnly(e)){
  const now=Date.now();if(now-lastTap<320){lastTap=0;fitView();return;}lastTap=now;   // 두 번 톡 = 맞춤 보기
  gesture={x:p.x,y:p.y,d:0,single:true,startScale:viewScale,moved:false};return;
 }
 if(mode==='text'){textAt={...normalized(p),frame:frameId,pad:p};return;}
 const edge=e.pointerType==='pen'||!penSeen?rulerEdge(p):null;
 const at=edge===null?p:rulerGlobal({x:rulerLocal(p).x,y:edge});
 stroke={id:e.pointerId,type:e.pointerType,mode,edge,start:at,points:[toImage(at)],sent:true};
 send({kind:'point',phase:'down',mode,...normalized(at),...(edge!==null?{ruler:true}:{})});drawInk();
};
pad.onpointermove=e=>{
 if(!pointers.has(e.pointerId))return;e.preventDefault();const p=padPoint(e),before=pointers.get(e.pointerId);pointers.set(e.pointerId,{...p,type:before.type});
 if(ruler.drag&&pointers.size===1){ruler.x=ruler.drag.x+p.x-ruler.drag.from.x;ruler.y=ruler.drag.y+p.y-ruler.drag.from.y;placeRuler();return;}
 const next=pair();
 if(next&&gesture&&!gesture.single){
  if(gesture.ruler){ruler.angle=snapAngle(ruler.angle+next.a-gesture.a);ruler.x+=next.x-gesture.x;ruler.y+=next.y-gesture.y;placeRuler();}
  else{offset.x+=next.x-gesture.x;offset.y+=next.y-gesture.y;viewMode='custom';if(gesture.d>5)zoomAt(next.d/gesture.d,next.x,next.y);else paintView();}
  gesture={...gesture,...next,moved:true};return;
 }
 if(gesture?.single&&pointers.size===1){offset.x+=p.x-before.x;offset.y+=p.y-before.y;viewMode='custom';gesture.moved=true;paintView();return;}
 if(stroke?.id===e.pointerId){
  const at=stroke.edge===null?p:rulerGlobal({x:rulerLocal(p).x,y:stroke.edge});
  stroke.points.push(toImage(at));send({kind:'point',phase:'move',mode:stroke.mode,...normalized(at)});
  if(stroke.edge!==null)showMeasure(at,Math.hypot(at.x-stroke.start.x,at.y-stroke.start.y));drawInk();
 }
};
function end(e){
 if(!pointers.has(e.pointerId))return;const p=padPoint(e);pointers.delete(e.pointerId);
 if(ruler.drag){ruler.drag=null;return;}
 if(textAt&&e.type==='pointerup'){openTextBox(textAt);textAt=null;return;}
 if(stroke?.id===e.pointerId){
  const at=stroke.edge===null?p:rulerGlobal({x:rulerLocal(p).x,y:stroke.edge});
  send({kind:'point',phase:e.type==='pointercancel'?'cancel':'up',mode:stroke.mode,...normalized(at)});
  if(e.type!=='pointercancel'&&stroke.mode!=='select')localInk.push({mode:stroke.mode,points:stroke.points,until:Date.now()+700});
  stroke=null;$('measure').hidden=true;drawInk();setTimeout(()=>{localInk=localInk.filter(s=>s.until>Date.now()-2300);drawInk();},3100);
 }
 if(!pointers.size&&gesture){if(gesture.moved&&!gesture.ruler)syncView(gesture.startScale);gesture=null;}
}
pad.onpointerup=end;pad.onpointercancel=end;pad.onlostpointercapture=e=>{if(pointers.has(e.pointerId))end({type:'pointercancel',clientX:e.clientX,clientY:e.clientY,pointerId:e.pointerId});};
pad.onwheel=e=>{e.preventDefault();if(!frameReady)return;const r=pad.getBoundingClientRect(),start=wheelStart??viewScale;wheelStart=start;zoomAt(Math.exp(-e.deltaY*.002),e.clientX-r.left,e.clientY-r.top);clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{syncView(start);wheelStart=null;},350);};
let wheelStart=null,wheelTimer=0;

// ── 글 상자(B8): 톡 한 자리에 바로 열린다. 키보드로 치거나 펜으로 쓰면 기기가 글자로 바꿔 준다 ──
function openTextBox(at){
 const box=$('textbox'),r=pad.getBoundingClientRect();box.hidden=false;box.dataset.x=at.x;box.dataset.y=at.y;box.dataset.frame=at.frame;
 box.style.left=Math.max(8,Math.min(r.width-308,at.pad.x))+'px';box.style.top=Math.max(8,Math.min(r.height-150,at.pad.y))+'px';$('textbox-input').value='';$('textbox-input').focus();
}
for(const b of document.querySelectorAll('#textbox [data-as]'))b.onclick=()=>{textAs=b.dataset.as;for(const o of document.querySelectorAll('#textbox [data-as]'))o.setAttribute('aria-pressed',String(o===b));};
$('textbox').onsubmit=e=>{e.preventDefault();const box=$('textbox'),text=$('textbox-input').value.trim();if(!text)return;send({kind:'text',x:Number(box.dataset.x),y:Number(box.dataset.y),frame:Number(box.dataset.frame),text,as:textAs});box.hidden=true;};
$('textbox-close').onclick=()=>{$('textbox').hidden=true;};

// ── 도구 줄 ──
function setMode(next){mode=next;cancelStroke();for(const b of document.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));$('chips').hidden=mode!=='select';$('textbox').hidden=true;}
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>setMode(b.dataset.mode);
for(const b of document.querySelectorAll('[data-command]'))b.onclick=()=>send({kind:'ask',text:b.dataset.command});
$('ruler-toggle').onclick=()=>{ruler.visible=!ruler.visible;if(ruler.visible&&!ruler.placed){const r=pad.getBoundingClientRect();ruler.x=(r.width-RULER_LENGTH)/2;ruler.y=r.height/2-RULER_HEIGHT/2;ruler.placed=true;}$('ruler-toggle').setAttribute('aria-pressed',String(ruler.visible));$('ruler-toggle').classList.toggle('on',ruler.visible);placeRuler();};
$('undo').onclick=()=>send({kind:'undo'});
$('clear').onclick=()=>{cancelStroke();localInk=[];drawInk();send({kind:'clear'});};
$('keep').onclick=()=>send({kind:'keep'});
$('confirm').onclick=()=>send({kind:'confirm'});$('cancel').onclick=()=>send({kind:'cancel'});
$('voice').onclick=()=>send({kind:'voice'});
$('full').onclick=async()=>{try{await document.documentElement.requestFullscreen();}catch{$('status').textContent='홈 화면에 추가하면 넓게 볼 수 있습니다';}};
$('bottom').onsubmit=e=>{e.preventDefault();const text=$('ask').value.trim();if(!text)return;send({kind:'ask',text});$('ask').value='';};
$('login').onsubmit=async e=>{e.preventDefault();try{token=(await post('/pair',{code:$('code').value})).token;try{sessionStorage.setItem(TOKEN_KEY,token);}catch{}queue=[];seq=0;frameId=0;frameReady=false;$('login').hidden=true;$('waiting').hidden=false;$('status').textContent='도면 받는 중';await receiveFrame();}catch(e){$('error').textContent=e.message;}};
{const el=$('ruler');for(let x=0;x<=RULER_LENGTH;x+=20){const t=document.createElement('span');t.className='tick'+(x%100===0?' long':'');t.style.left=x+'px';el.append(t);}}
if(token){$('login').hidden=true;$('waiting').hidden=false;}
window.addEventListener('resize',()=>{cancelStroke();layout();});window.addEventListener('blur',()=>{if(stroke)end({type:'pointercancel',pointerId:stroke.id,clientX:0,clientY:0});});
setInterval(receiveFrame,300);setInterval(flush,40);layout();if(token)receiveFrame();
