// ACAD200 영역 3 — 선택 보조(302~306, 321, 323~324). app.js 는 연결 몇 줄만 두고 판단은 여기서 한다.
// 성능 원칙: 커서가 멈춘 뒤 한 번(호버), 상자가 바뀐 프레임에만 한 번(창 미리보기, 6ms 예산으로 나눔),
// 후보는 언제나 공간 색인이 준 것만 본다. 도면 전체를 훑지 않는다.

const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

// 303. 호버 선택 미리보기(AutoCAD SELECTIONPREVIEW, rollover). 비트 1 = 명령 없을 때, 2 = 명령의 객체 선택 단계.
// 커서가 멈춘 뒤 idleMs(10ms) 에 한 번만 집고, 결과가 바뀔 때만 다시 그린다.
// AutoCAD 보다 나은 점: 겹친 객체를 Shift+Space 로 돌린 "고정" 후보는 손떨림(4px)에 풀리지 않고 그대로 클릭에 쓰인다.
export function hoverAllowed({mode='SELECT',phase='idle',busy=false,dragging=false,buttons=0,pref=3,objectPick=true}={}){
  if(busy||dragging||(buttons&7)||!objectPick)return false;
  const bits=Number(pref)|0;
  if(mode==='SELECT')return phase==='idle'&&!!(bits&1);
  return phase==='select'&&!!(bits&2);
}
export class HoverPreview {
  constructor({idleMs=10,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
    this.idleMs=idleMs;this.setTimer=setTimer;this.clearTimer=clearTimer;this.id=null;this.timer=0;this.pinned=null;
  }
  clear(){const had=this.id!==null;if(this.timer)this.clearTimer(this.timer);this.timer=0;this.id=null;this.pinned=null;return had;}
  /** 이동마다. allowed 가 거짓이면 끄고(바뀌었으면 onChange), 참이면 멈춘 뒤 pick() 한 번. */
  schedule(allowed,pick,onChange,screenPoint=null){
    if(this.timer)this.clearTimer(this.timer);this.timer=0;
    if(!allowed){if(this.clear())onChange?.();return;}
    if(this.pinned&&screenPoint&&dist(screenPoint,this.pinned.at)<=4)return;   // 순환으로 고른 후보 유지
    this.pinned=null;
    this.timer=this.setTimer(()=>{this.timer=0;const next=pick()??null;if(next!==this.id){this.id=next;onChange?.();}},this.idleMs);
  }
  /** 305: 겹친 후보 ids 중 다음 것으로 옮기고 고정. 후보가 둘 미만이면 false. */
  cycle(ids,screenPoint){
    if(!Array.isArray(ids)||ids.length<2)return false;
    const i=ids.indexOf(this.id);this.id=ids[(i+1)%ids.length];
    this.pinned={at:screenPoint?{x:screenPoint.x,y:screenPoint.y}:{x:0,y:0},ids:[...ids]};
    return true;
  }
  /** 클릭이 쓸 후보: 순환으로 고정된 것만(평소 클릭은 그 자리에서 다시 집는다). */
  pinnedId(screenPoint){return this.pinned&&(!screenPoint||dist(screenPoint,this.pinned.at)<=4)?this.id:null;}
}

// 305. 겹친 객체 순환(SELECTIONCYCLING). 0 끔, 1 순환만(목록 없음), 2 목록 표시. 음수 = 꺼 두었지만 켜면 돌아갈 값.
// AutoCAD 0x1b0238 과 같은 규칙: 0 이면 2 로, 아니면 부호만 뒤집는다.
export const toggleSelectionCycling=value=>{const v=Number(value)|0;return v===0?2:-v;};
export const selectionCyclingMode=value=>Math.max(0,Number(value)|0);

// 306·324. 선택 단계 기록. SelectionSet 의 add·delete 가 record() 를 불러 "이번 단계에 더한/뺀 id" 를 쌓는다.
// U(되돌리기)는 마지막 단계를 거꾸로 돌린다. 기록은 명령의 선택 단계에서만 켠다(대기 중 비용 0).
export class SelectionSteps {
  constructor(){this.steps=[];this.active=false;this.current=null;this.muted=false;}
  clear(){this.steps.length=0;this.active=false;this.current=null;}
  start(){this.active=true;this.current=null;}
  /** 새 선택 동작(클릭·창·옵션)이 시작될 때. 빈 단계는 남기지 않는다. */
  begin(){if(!this.active)return;this.current=null;}
  record(op,id){
    if(!this.active||this.muted)return;
    if(!this.current){this.current={added:[],removed:[]};this.steps.push(this.current);}
    (op==='+'?this.current.added:this.current.removed).push(id);
  }
  get size(){return this.steps.length;}
  /** 마지막 단계를 되돌린다. 되돌린 개수(더한 것 + 뺀 것)를 돌려준다. */
  undo(selection){
    const step=this.steps.pop();this.current=null;
    if(!step)return 0;
    this.muted=true;
    try{for(const id of step.added)selection.delete(id);for(const id of step.removed)selection.add(id);}
    finally{this.muted=false;}
    return step.added.length+step.removed.length;
  }
}

// 302. 올가미(lasso). 빈 곳에서 누른 채 끌면 사각형 대신 지나간 길을 모은다(설정으로 켬).
// 오른쪽→왼쪽으로 시작하면 걸침(CP), 아니면 창(WP). Space 로 창 → 걸침 → 울타리 → 창 … 순환.
// 4px 보다 촘촘한 점은 버려 점 수가 화면 길이에 비례한다(마우스 이벤트 수가 아니라).
export const LASSO_KINDS=['WP','CP','F'];
export const LASSO_LABELS={WP:'창',CP:'걸침',F:'울타리'};
export class LassoPath {
  constructor(startWorld,startScreen,{spacing=4}={}){
    this.points=[{x:startWorld.x,y:startWorld.y}];this.lastScreen={x:startScreen.x,y:startScreen.y};this.start={x:startScreen.x,y:startScreen.y};
    this.spacing=spacing;this.kind=null;this.auto='WP';
  }
  add(world,screenPoint){
    this.auto=screenPoint.x<this.start.x?'CP':'WP';
    if(dist(screenPoint,this.lastScreen)<this.spacing)return false;
    this.points.push({x:world.x,y:world.y});this.lastScreen={x:screenPoint.x,y:screenPoint.y};return true;
  }
  get effectiveKind(){return this.kind??this.auto;}
  cycle(){this.kind=LASSO_KINDS[(LASSO_KINDS.indexOf(this.effectiveKind)+1)%LASSO_KINDS.length];return this.kind;}
  bounds(){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of this.points){if(p.x<minX)minX=p.x;if(p.y<minY)minY=p.y;if(p.x>maxX)maxX=p.x;if(p.y>maxY)maxY=p.y;}
    return {minX,minY,maxX,maxY};
  }
}
/** F·WP·CP 판정(app.js applySelectPolygon 과 같은 규칙). candidates 는 다각형 경계 상자로 미리 추린 것. */
export function polygonSelectionHits(candidates,kind,poly,G){
  const edges=[];for(let i=0;i<poly.length-(kind==='F'?1:0);i++)edges.push([poly[i],poly[(i+1)%poly.length]]);
  const cross=(a,b)=>edges.some(([c,d])=>{const r=G.lineIntersection(a,b,c,d);return r&&r.t>=0&&r.t<=1&&r.u>=0&&r.u<=1;});
  const hits=[];
  for(const e of candidates){
    const vs=G.vertices(e)||[];if(!vs.length)continue;
    let hit=false;
    if(kind==='WP')hit=vs.every(v=>G.inside(v,poly));
    else{
      if(kind==='CP')hit=vs.some(v=>G.inside(v,poly));
      for(let i=0;!hit&&i<vs.length-1;i++)hit=cross(vs[i],vs[i+1]);
      if(!hit&&kind==='CP'&&vs.length===1)hit=G.inside(vs[0],poly);
    }
    if(hit)hits.push(e);
  }
  return hits;
}
/** 다각형(울타리는 선) 의 경계 상자. */
export function polygonBounds(points){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of points){if(p.x<minX)minX=p.x;if(p.y<minY)minY=p.y;if(p.x>maxX)maxX=p.x;if(p.y>maxY)maxY=p.y;}
  return {minX,minY,maxX,maxY};
}

// 304. 선택창을 끄는 동안 걸릴 객체를 미리 강조한다. 후보가 limit(20000) 를 넘으면 미리보기를 건너뛰고(개수만 '많음'),
// 넘지 않으면 한 프레임에 budgetMs(6ms) 만 판정하고 나머지는 다음 프레임에 잇는다. 다 끝난 결과는 놓을 때 그대로 쓴다.
// AutoCAD 보다 나은 점: 상자 모서리 끝에 "창 N개 / 걸침 N개" 를 바로 보여 준다.
export function windowSelects(entity,box,cross,{G,crossing}){
  const eb=G.bounds([entity]);if(!eb)return false;
  return cross?crossing(entity,box):eb.minX>=box.minX&&eb.maxX<=box.maxX&&eb.minY>=box.minY&&eb.maxY<=box.maxY;
}
export function windowKey(box,cross){return [box.minX,box.minY,box.maxX,box.maxY,cross?1:0].join(',');}
export class WindowPreview {
  constructor({limit=20000,budgetMs=6,clock=()=>performance.now()}={}){this.limit=limit;this.budgetMs=budgetMs;this.clock=clock;this.reset();}
  reset(){this.tooManyBox=null;this.key='';this.box=null;this.cross=false;this.list=[];this.cursor=0;this.ids=[];this.idSet=new Set();this.skipped=false;}
  /** 이번 프레임 몫을 계산한다. 끝났으면 true(더 그릴 필요 없음), 남았으면 false(다음 프레임 필요). */
  update(box,cross,candidates,test){
    const key=windowKey(box,cross);
    if(key!==this.key){
      const tooMany=this.tooManyBox;
      this.reset();this.key=key;this.box=box;this.cross=cross;
      // 더 큰 상자는 후보가 더 많다 — 한도를 넘었던 상자를 품으면 질의하지 않고 바로 생략.
      if(tooMany&&box.minX<=tooMany.minX&&box.minY<=tooMany.minY&&box.maxX>=tooMany.maxX&&box.maxY>=tooMany.maxY){this.skipped=true;this.tooManyBox=tooMany;return true;}
      const list=candidates(box);
      if(list.length>this.limit){this.skipped=true;this.list=[];this.tooManyBox={...box};return true;}
      this.list=list;
    }
    if(this.skipped)return true;
    const end=this.clock()+this.budgetMs;
    while(this.cursor<this.list.length){
      const e=this.list[this.cursor++];
      if(test(e,this.box,this.cross)){this.ids.push(e.id);this.idSet.add(e.id);}
      if((this.cursor&15)===0&&this.clock()>=end)break;
    }
    return this.cursor>=this.list.length;
  }
  get done(){return !!this.key&&!this.skipped&&this.cursor>=this.list.length;}
  /** 놓을 때: 같은 상자의 계산이 끝났으면 그 결과(엔티티 id 배열), 아니면 null. */
  result(box,cross){return this.done&&this.key===windowKey(box,cross)?this.ids:null;}
}

// 321. 더블클릭 편집을 객체 종류별 표로(AutoCAD AcDbDoubleClickEdit*). 표에 없는 종류는 특성 창.
// 잠긴 레이어의 객체는 편집하지 않고 특성 창만 연다(고칠 수 없는 편집기를 여는 대신).
export const DOUBLE_CLICK_EDIT=Object.freeze({
  text:'text-inline',
  block:'block-edit',
  hatch:'command:HATCHEDIT',
  polyline:'command:PLINEEDIT',
});
export function doubleClickAction(entity,{enabled=true,locked=false,blockEditing=false,table=DOUBLE_CLICK_EDIT}={}){
  if(!enabled||!entity)return 'none';
  if(locked)return 'properties';
  const action=table[entity.type]||'properties';
  if(action==='block-edit'&&blockEditing)return 'properties';
  if(entity.type==='block'&&entity.drawingSet)return 'properties';
  return action;
}

// 324. 객체 선택 옵션 U·SI·M·BOX·AU 해석. 지금 기본 동작이 BOX·AU(클릭=한 개, 빈 곳=창)·M(찍을 때마다 바로 반영)이다.
export function selectionOption(option){
  const o=String(option||'').toUpperCase();
  if(['U','UNDO'].includes(o))return 'undo';
  if(['SI','SINGLE'].includes(o))return 'single';
  if(['BOX','AU','AUTO','M','MULTIPLE'].includes(o))return 'default';
  return null;
}
