// 사무실 패드(같은 와이파이) PC 쪽: 패드에서 온 펜·글·지시를 도면에 옮긴다. 7.0 "사무실에서는 전부 다".
//  표시 = 가리키기(도면에 저장 안 함, 일이 끝나면 사라짐) · 그리기 = 스케치 정리(직선·사각형·원·문·창)
//  고르기 = PC 마우스처럼(선택·명령의 점 찍기) · 글 = 그 자리 글 상자(메모 | 도면 글자) · 지시 칸 = 명령 또는 AI
import * as G from './geometry.js';
import {classifyStroke,straightLine,arrowMove,recognizeDoors,recognizeWindow,findWallLines,snapLength} from './pad-sketch.js';

export const MEMO_LAYER='A-PAD-MEMO';
const GROUP_MS=1500,SKETCH_MS=1200,MARK_LIMIT=10,TAP_PX=8;
const RECENT_SKETCH_LIMIT=10,RECENT_STROKE_LIMIT=128;
const direction=u=>u.x>0?'오른쪽':u.x<0?'왼쪽':u.y>0?'위':'아래';
const boxOf=ps=>G.bounds([{type:'polyline',points:ps}]);
const nearBox=(b,p,gap)=>!!b&&p.x>=b.minX-gap&&p.x<=b.maxX+gap&&p.y>=b.minY-gap&&p.y<=b.maxY+gap;
export const looksLikeCommand=text=>/^[A-Za-z][A-Za-z0-9]{0,15}$/.test(text.trim());
export const looksLikeNumber=text=>/^\d+(?:\.\d+)?$/.test(text.trim());

// 표시가 고른 객체: 닫힌 고리면 꼭짓점이 다 안에 든 것, 아니면 펜이 지나간 것. AI 에 보낼 길은 100점 이하로.
export function markTargets(ps,ids,{editable,scale}){
 const b=boxOf(ps);
 const closed=ps.length>=4&&b&&Math.abs(G.polygonArea(ps))*scale*scale>400&&G.dist(ps[0],ps.at(-1))<=Math.max(18/scale,Math.hypot(b.maxX-b.minX,b.maxY-b.minY)*.25);
 // 블록(문·창 등)은 놓인 점이 고리 안이면 고른 것으로 본다 — 손으로 문 전체를 다 감싸기 어렵다
 if(closed){for(const entity of editable()){const vs=entity.type==='block'&&entity.position?[entity.position]:G.vertices(entity);if(vs.length&&vs.every(p=>G.inside(p,ps)))ids.add(entity.id);}}
 const path=ps.filter((_,i)=>i===0||i===ps.length-1||i%Math.max(1,Math.ceil(ps.length/98))===0).map(p=>({...p}));
 return {objectIds:[...ids],mark:path,region:closed?'enclosed':'stroke'};
}

export function createTabletPad(host){
 let marks=[],stroke=null,sketch=[],sketchTimer=null,pending=null,message='',hinted=false,mouse=null;
 const views=new Map(),history=[];   // history: 패드 [되돌리기] 순서('mark' | 'cad')
 const recentSketches=[],sketchGroups=new WeakMap();let sketchSequence=0;
 // 원획 참조만 보관한다(도면 순회·복사·범위 계산 없음). 파일/복구본에는 저장하지 않는다.
 function rememberSketch(group,points,mode,capturedAt,number){
  let id=sketchGroups.get(group);if(!id||recentSketches.at(-1)?.id!==id){id=`sketch-${++sketchSequence}`;sketchGroups.set(group,id);}
  let entry=recentSketches.at(-1);
  if(entry?.id!==id){entry={id,mode,number,capturedAt,strokes:[],truncated:false};recentSketches.push(entry);if(recentSketches.length>RECENT_SKETCH_LIMIT)recentSketches.shift();}
  entry.strokes.push(points);entry.endedAt=new Date().toISOString();
  if(entry.strokes.length>RECENT_STROKE_LIMIT){entry.strokes.shift();entry.truncated=true;}
 }
 function forgetSketch(points){
  for(let i=recentSketches.length-1;i>=0;i--){const e=recentSketches[i];e.strokes=e.strokes.filter(path=>path!==points);if(!e.strokes.length)recentSketches.splice(i,1);}
 }
 const view=()=>host.view();
 const toWorld=e=>{const v=views.get(e.frame)||view();return {x:(e.x*v.width-v.origin.x)/v.scale,y:(v.origin.y-e.y*v.height)/v.scale};};
 const px=()=>1/view().scale;
 const changed=()=>{host.render();host.infoChanged?.();};
 const say=text=>{message=text;host.toast?.(text);host.infoChanged?.();};

 function rememberFrame(id,v){views.set(id,{...v,origin:{...v.origin}});if(views.size>40)views.delete(views.keys().next().value);}
 // 동그라미 안에 문·창이 있으면 그것만 옮긴다(벽 조각·치수가 같이 들어와도, A17)
 function moveTargets(ids){const openings=host.entities(ids).filter(e=>['DOOR','WINDOW'].includes(e.category||e.parameters?.kind)).map(e=>e.id);return openings.length?openings:[...ids];}
 // 벽선에 끼운 문·창은 벽을 따라서만 옮긴다. 구멍 양쪽 벽선 끝을 같이 늘이고 줄이며 문틀 선도 같이 옮긴다.
 // (벽선 연결 기록은 같은 벽에 창호가 둘 이상이면 낡는다 — 기록 대신 지금 도면의 선을 보고 옮긴다)
 function moveCommands(ids,v){
  const commands=[],plain=[];
  for(const e of host.entities(ids)){
   if(!['DOOR','WINDOW'].includes(e.category)||!e.position||!e.parameters?.width){plain.push(e.id);continue;}
   const u=G.polar(1,e.parameters.rotation||0),width=e.parameters.width,depth=e.parameters.depth||200,base=e.position;
   const along=p=>G.dot(G.sub(p,base),u),across=p=>G.cross(u,G.sub(p,base)),tol=Math.max(2,depth*.1),d=G.dot(v,u);
   const near=(p,at)=>Math.abs(along(p)-at)<=tol&&Math.abs(across(p))<=depth+tol,edits=[];
   for(const line of host.editable()){
    if(line.type!=='line'||line.points?.length!==2)continue;
    const [a,b]=line.points,dir=G.sub(b,a);if(G.len(dir)<G.EPS)continue;
    const w=G.unit(dir);
    if(Math.abs(G.dot(w,u))<.02&&[0,width].some(at=>near(a,at)&&near(b,at)))edits.push({type:'move',ids:[line.id],dx:v.x,dy:v.y});   // 문틀·구멍 끝 선
    else if(Math.abs(G.cross(w,u))<.02&&line.points.some(p=>near(p,0)||near(p,width))){
     const moved=line.points.map(p=>near(p,0)||near(p,width)?G.add(p,G.mul(u,d)):p);   // 구멍 쪽 끝만: 한쪽 벽선은 늘고 다른 쪽은 준다
     if(G.dot(G.sub(moved[1],moved[0]),G.sub(b,a))<=0)throw Error('옮기는 거리가 옆 벽선보다 깁니다. 거리를 줄이세요.');
     edits.push({type:'update',ids:[line.id],changes:{points:moved}});
    }
   }
   if(edits.length&&Math.abs(G.cross(u,v))>1)throw Error('벽에 끼운 문·창은 벽을 따라서만 옮길 수 있습니다. 벽 밖으로 빼려면 지우고 다시 그리세요.');
   commands.push(...edits);plain.push(e.id);
  }
  if(plain.length)commands.unshift({type:'move',ids:plain,dx:v.x,dy:v.y});
  return commands;
 }
 function clearMarks(preserveSketches=false){marks=[];stroke=null;if(!preserveSketches)recentSketches.length=0;if(pending?.kind==='move')pending=null;changed();}
 function dropMark(mark){marks=marks.filter(m=>m!==mark);}

 // ── 표시 ──
 function finishMark(ps,ids,at,remember=true){
  const last=marks.at(-1),box=last?boxOf(last.ink.flat()):null;
  // 동그라미 다음 화살표: 그 표시 근처에서 시작한 곧은 획 = 표시한 것을 수평·수직으로 이동(A18)
  if(last?.objectIds.length&&!last.arrow&&nearBox(box,ps[0],40*px())&&G.dist(ps[0],ps.at(-1))>12*px()){
   const move=arrowMove(ps);
   if(move?.straight){last.ink.push(ps);last.arrow=move;if(remember)rememberSketch(last,ps,'mark',at,last.number);pending={kind:'move',mark:last,ids:moveTargets(last.objectIds),vector:move.vector,distance:move.distance,u:move.u};history.push('mark');changed();return;}
  }
  const done=markTargets(ps,ids,{editable:host.editable,scale:view().scale});
  // 손글씨처럼 잇따라 가까이 그은 획은 번호 하나(A4)
  if(last&&!last.arrow&&Date.now()-last.endedAt<GROUP_MS&&nearBox(box,ps[0],150*px())){
   const path=[...last.mark,...done.mark];
   Object.assign(last,{ink:[...last.ink,ps],objectIds:[...new Set([...last.objectIds,...done.objectIds])],region:last.region==='enclosed'||done.region==='enclosed'?'enclosed':'stroke',mark:path.filter((_,i)=>i%Math.ceil(path.length/100)===0),strokes:(last.strokes||1)+1,capturedAt:at,endedAt:Date.now()});
  }else{
   marks.push({number:(last?.number||0)+1,point:{...ps[0]},...done,ink:[ps],capturedAt:at,endedAt:Date.now()});marks=marks.slice(-MARK_LIMIT);history.push('mark');
   if(!hinted){hinted=true;say('펜 표시에 번호가 붙습니다. 지시 칸에 "1번 지워"처럼 쓰거나 화살표로 옮기세요.');}
  }
  const current=marks.at(-1);if(remember)rememberSketch(current,ps,'mark',at,current.number);if(current.objectIds.length)host.setSelected(current.objectIds);
  changed();
 }

 // ── 그리기(스케치 정리) ──
 function scheduleSketch(){clearTimeout(sketchTimer);sketchTimer=setTimeout(recognizeSketch,SKETCH_MS);}
 function recognizeSketch(){
  if(!sketch.length)return;
  const strokes=sketch;sketch=[];const unit=px(),shapes=strokes.map(s=>({...(s.ruler?{kind:'line',...lineOf(s.points)}:classifyStroke(s.points,unit)),raw:s.points}));
  const doors=recognizeDoors(shapes,unit),window=doors.length?null:recognizeWindow(shapes,unit);
  if(doors.length||window){
   const items=doors.length?doors:[window],used=new Set(items.flatMap(i=>i.used));
   const leftovers=shapes.filter(s=>!used.has(s));
   const entities=items.map(item=>opening(item)).filter(Boolean);
   if(!entities.length){keepAsMarks(shapes);say('문·창을 넣을 수 없습니다. 펜 표시로 남겼습니다.');return;}
   pending={kind:'sketch',items:entities,label:entities.map(e=>e.label).join(' · '),preview:entities.flatMap(e=>e.preview)};
   if(leftovers.length)commitShapes(leftovers);
   changed();return;
  }
  commitShapes(shapes);
 }
 function lineOf(ps){return {a:ps[0],b:ps.at(-1),length:G.dist(ps[0],ps.at(-1)),u:G.unit(G.sub(ps.at(-1),ps[0]))};}
 function commitShapes(shapes){
  const layer=host.activeLayer(),entities=[],unknown=[];
  for(const s of shapes){
   if(s.kind==='line')entities.push({type:'line',layer,points:straightLine(s)});
   else if(s.kind==='rect')entities.push({type:'rectangle',layer,points:G.rectangle(snapPoint(s.min),snapPoint(s.max))});
   else if(s.kind==='circle')entities.push({type:'circle',layer,center:s.center,radius:snapLength(s.radius,50)});
   else if(s.kind==='polyline')entities.push({type:'polyline',layer,points:s.points,closed:false});
   else if(s.kind==='arc'){const start=G.angle(G.sub(s.start,s.center)),end=G.angle(G.sub(s.end,s.center));entities.push({type:'arc',layer,center:s.center,radius:s.radius,startAngle:s.sweep>0?start:end,endAngle:s.sweep>0?end:start});}
   else if(s.kind!=='dot')unknown.push(s);
  }
  if(entities.length){try{host.execute({type:'addMany',entities});history.push('cad');}catch(error){say('넣지 못했습니다: '+error.message);}}
  if(unknown.length){keepAsMarks(unknown);say('모르는 모양은 도면에 넣지 않고 펜 표시로 남겼습니다.');}
  changed();
 }
 const snapPoint=p=>({x:Math.round(p.x/50)*50,y:Math.round(p.y/50)*50});
 function keepAsMarks(shapes){for(const s of shapes)finishMark(s.raw,new Set(),new Date().toISOString(),false);}
 // 손그림 문·창 → 진짜 문·창. 벽선 두 줄이 있으면 끼워 넣고(개구부), 없으면 그 자리에 놓는다.
 function opening(item){
  const command=item.kind==='door'?'DOD':'WID',u=item.u,width=item.width;
  const start=item.kind==='door'?item.hinge:G.sub(item.center,G.mul(u,width/2)),middle=G.add(start,G.mul(u,width/2));
  const pair=findWallLines(host.editable(),middle,u,width);
  const options={width,...(item.kind==='door'?{style:item.style==='double'?'double':'single',hand:'left',side:item.side}:{style:item.style})};
  const label=item.kind==='door'?`문 ${width}${item.style==='double'?' 양개':''}`:`창 ${width} ${item.style==='sliding'?'미서기':'고정'}`;
  try{
   if(pair){
    const sources=pair.lines,wall=host.parallelWallPair(sources),offset=G.dot(G.sub(start,wall.center[0]),wall.u),base=G.add(wall.center[0],G.mul(wall.u,offset));
    const entity=host.architecturalDetail(command,{...options,x:base.x,y:base.y,rotation:G.angle(wall.u),depth:Math.abs(wall.offset)}),parts=host.wallLineOpening(sources,offset,width);
    return {label:label+' · 벽에 끼움',command:{type:'linewall.place',ids:sources.map(e=>e.id),entity,parts,sources},preview:[entity]};
   }
  }catch{}
  try{const entity=host.architecturalDetail(command,{...options,x:start.x,y:start.y,rotation:G.angle(u),depth:item.thickness||200});return {label,command:{type:'add',entity},preview:[entity]};}
  catch(error){say(label+' 을(를) 만들지 못했습니다: '+error.message);return null;}
 }

 // ── 고르기 = PC 마우스 ──
 function mouseEvent(type,p){host.pointer(type,host.screen(p));}

 // ── 확인 · 취소 · 숫자 ──
 function confirm(){
  if(!pending)return;const job=pending;pending=null;
  try{
   if(job.kind==='move'){const commands=moveCommands(job.ids,job.vector);host.execute(commands.length===1?commands[0]:{type:'batch',commands});dropMark(job.mark);}
   else host.execute({type:'batch',commands:job.items.map(i=>i.command)});
   history.push('cad');say(job.kind==='move'?'옮겼습니다.':'넣었습니다.');
  }catch(error){say('하지 못했습니다: '+error.message);}
  changed();
 }
 function cancel(){if(!pending)return;if(pending.kind==='move'){pending.mark.arrow=null;forgetSketch(pending.mark.ink.pop());}pending=null;changed();}
 function setNumber(value){
  if(pending?.kind==='move'){pending.distance=value;pending.vector=G.mul(pending.u,value);changed();return true;}
  if(pending?.kind==='sketch'&&pending.items.length===1){say('폭은 문·창을 넣은 뒤 특성에서 바꾸세요.');return true;}
  return false;
 }
 function undo(){
  if(pending){cancel();return;}
  const last=history.pop();
  if(last==='mark'&&marks.length){const mark=marks.at(-1);forgetSketch(mark.ink.at(-1));if(mark.ink.length>1)mark.ink.pop();else marks.pop();changed();return;}
  host.undo();changed();
 }

 // ── 글 상자 ──
 function placeText(e){
  const text=String(e.text||'').trim();if(!text)return;
  const at=toWorld(e),height=host.textHeight();
  try{
   if(e.as==='text'){host.execute({type:'add',entity:{type:'text',text,position:at,height,layer:host.activeLayer()}});}
   else{
    const layer=host.ensureLayer(MEMO_LAYER,'#f0b35e'),w=Math.max(height*text.length*.9,height*3),pad=height*.6;
    const ring=[{x:at.x-pad,y:at.y-pad},{x:at.x+w+pad,y:at.y-pad},{x:at.x+w+pad,y:at.y+height+pad},{x:at.x-pad,y:at.y+height+pad}];
    host.execute({type:'addMany',entities:[{type:'text',text,position:at,height,layer},{...host.cloud(ring,height*1.5),layer}]});
   }
   history.push('cad');say(e.as==='text'?'글자를 넣었습니다.':'메모를 남겼습니다.');
  }catch(error){say('글을 넣지 못했습니다: '+error.message);}
  changed();
 }

 // 남기고 싶은 표시 → 메모 레이어의 진짜 객체(선·번호)로(A9~A11 [메모로 남기기])
 function keep(){
  if(!marks.length){say('남길 펜 표시가 없습니다.');return;}
  try{
   const layer=host.ensureLayer(MEMO_LAYER,'#f0b35e'),height=host.textHeight();
   const entities=marks.flatMap(m=>[...m.ink.filter(path=>path.length>1).map(points=>({type:'polyline',layer,points,closed:false})),{type:'text',layer,text:String(m.number),position:m.point,height}]);
   host.execute({type:'addMany',entities});history.push('cad');marks=[];if(pending?.kind==='move')pending=null;say('펜 표시를 메모 레이어에 남겼습니다.');
  }catch(error){say('남기지 못했습니다: '+error.message);}
  changed();
 }

 // ── 지시 칸 ──
 function ask(text){
  text=String(text||'').trim();if(!text)return;
  if(looksLikeNumber(text)&&setNumber(Number(text)))return;
  // 명령 중이면 키보드로 친 것처럼 명령 줄에. 명령 이름처럼 생겼으면 명령으로.
  if(host.commandActive()||looksLikeCommand(text)){host.command(text);history.push('cad');return;}
  // AI 는 보낼 때 표시 문맥을 이미 받아 간다 — 보냈으면 표시는 할 일을 다 했다(A11).
  if(host.askAi(text))clearMarks(true);else say('AI 가 다른 일을 하는 중입니다. 끝난 뒤 다시 보내세요.');
 }

 function handle(e){
  if(e.kind==='clear'){clearMarks();return;}
  if(e.kind==='keep'){keep();return;}
  if(e.kind==='voice'){host.voice();return;}
  if(e.kind==='view'){host.applyView(e);return;}
  if(e.kind==='confirm'){confirm();return;}
  if(e.kind==='cancel'){cancel();return;}
  if(e.kind==='undo'){undo();return;}
  if(e.kind==='ask'){ask(e.text);return;}
  if(e.kind==='text'){placeText(e);return;}
  if(e.kind!=='point')return;
  if(e.phase==='cancel'){if(mouse){mouseEvent('pointerup',mouse);mouse=null;}stroke=null;changed();return;}
  if(!Number.isFinite(e.x)||!Number.isFinite(e.y))return;
  const p=toWorld(e);
  if(e.mode==='select'){   // PC 마우스처럼: 누르기·끌기·떼기를 그대로 캔버스에
   if(e.phase==='down'){mouse=p;mouseEvent('pointermove',p);mouseEvent('pointerdown',p);}
   else if(mouse){mouse=p;mouseEvent(e.phase==='up'?'pointerup':'pointermove',p);if(e.phase==='up')mouse=null;}
   return;
  }
  if(e.phase==='down'){stroke={mode:e.mode,points:[p],ids:new Set(),ruler:!!e.ruler,at:new Date().toISOString()};if(e.mode==='mark'){const id=host.pick(p)?.id;if(id)stroke.ids.add(id);}changed();return;}
  if(!stroke)return;
  const ps=stroke.points;if(G.dist(ps.at(-1),p)*view().scale>2&&ps.length<4000)ps.push(p);
  if(stroke.mode==='mark'){const id=host.pick(p)?.id;if(id)stroke.ids.add(id);}
  if(e.phase!=='up'){host.render();return;}
  const done=stroke;stroke=null;
  if(done.mode==='mark')finishMark(done.points,done.ids,done.at);
  else if(done.mode==='draw'){rememberSketch(sketch,done.points,'draw',done.at);sketch.push({points:done.points,ruler:done.ruler});scheduleSketch();changed();}
 }

 // ── 그리기·문맥 ──
 function paint(ctx,screen,scale,drawEntity){
  const ink='#ff8f53',sky='#9dcbe0';
  for(const mark of marks){for(const path of mark.ink)if(path.length>1)drawEntity(ctx,{type:'polyline',points:path},screen,scale,ink,2.5);const p=screen(mark.point);ctx.fillStyle='#ffad66';ctx.font='bold 15px sans-serif';ctx.fillText(String(mark.number),p.x-14,p.y-8);}
  for(const s of sketch)if(s.points.length>1)drawEntity(ctx,{type:'polyline',points:s.points},screen,scale,sky,2);
  if(stroke?.points.length>1)drawEntity(ctx,{type:'polyline',points:stroke.points},screen,scale,stroke.mode==='draw'?sky:ink,2.5);
  if(pending?.kind==='move')for(const e of host.entities(pending.ids))drawEntity(ctx,G.translate(e,pending.vector.x,pending.vector.y),screen,scale,sky,1.5,false,true);
  if(pending?.kind==='sketch')for(const e of pending.preview)drawEntity(ctx,e,screen,scale,sky,1.5,false,true);
 }
 const label=()=>pending?.kind==='move'?`${pending.mark.number}번 ${direction(pending.u)} ${pending.distance}`:pending?.label||'';
 function context(){
  if(!marks.length)return {};
  const live=new Set(host.editable().map(e=>e.id));
  return {tabletMarks:marks.map(({ink,endedAt,arrow,...m})=>({...m,objectIds:m.objectIds.filter(id=>live.has(id))})),
   tabletGuide:'tabletMarks = 사용자가 패드 펜으로 도면 위에 그린 표시(도면 객체 아님). number 는 화면에 보이는 번호, region 이 enclosed 면 objectIds 는 둘러싼 영역 안 객체, stroke 면 펜이 지나간 객체. "2번"·"동그라미 친 것"이라고 하면 그 표시의 objectIds 를 대상으로, 번호 없이 "이거"면 가장 최근 표시를 쓴다. 동그라미 안에 지시와 다른 종류(벽·치수 등)가 섞이면 지시한 종류(예: 문)만 대상으로 한다.'};
 }
 return {handle,paint,context,rememberFrame,clearMarks,confirm,cancel,flushSketch:()=>{clearTimeout(sketchTimer);recognizeSketch();},
  getSketches:()=>structuredClone(recentSketches).reverse(),
  get busy(){return !!stroke||!!mouse;},get hasMarks(){return marks.length>0;},
  info:()=>({pending:label(),message}),
  snapshot:()=>({}),
  reset(){clearTimeout(sketchTimer);clearMarks();sketch=[];pending=null;history.length=0;views.clear();}};
}
