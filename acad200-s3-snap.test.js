// ACAD200 영역 3 — 스냅: 311 조리개, 312 끄는 객체 빼기, 313 Tab 순환, 314 해치·치수 보조선, 315 객체 추적, 316 극좌표 보강.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';
import * as IA from './input-assist.js';
import {snapIntersections} from './snap-intersections.js';

const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const body=app.slice(app.indexOf('function snap(p)'),app.indexOf('// 직교(F8)'));
const p=(x,y)=>({x,y});
const line=(id,a,b,extra={})=>({id,type:'line',points:[a,b],...extra});
function snapper(entities,{checked=['osnap','snap-end','snap-mid','snap-intersection'],assist=IA.createInputAssist(),points=[],mode='LINE'}={}){
  const on=new Set(checked);
  const c={G,IA,assist,scale:1,points,mode,phase:'point',params:{},osnapOnce:null,ORTHO_EXEMPT_MODES:new Set(['SELECT']),ORTHO_EXEMPT_PHASES:new Set(['select']),orthogonalInput:q=>q,num:(id,f)=>f,snapIntersections,
    $:id=>({checked:on.has(id),value:id==='polar-angle'?'90':''}),
    nearby:(q,r,primitives,accept)=>(function*(){for(const e of entities){if(accept&&!accept(e))continue;yield* (e.type==='dimension'?G.visiblePrimitives(e):[e]);}})()};
  vm.createContext(c);vm.runInContext(body,c);c.on=on;return c;
}

test('311 조리개: 마우스는 정한 크기, 펜은 25% 넓게, 손가락은 최소 24px',()=>{
  assert.equal(IA.apertureRadiusPx(16,'mouse'),16);assert.equal(IA.apertureRadiusPx(16,'pen'),20);assert.equal(IA.apertureRadiusPx(10,'touch'),24);assert.equal(IA.apertureRadiusPx(99,'mouse'),40);
  const es=[line('a',p(20,0),p(200,0))];
  const mouse=snapper(es);assert.equal(mouse.snap(p(0,0)).snapped,undefined,'마우스 16px 밖');
  const touch=snapper(es);touch.assist.lastPointerType='touch';const hit=touch.snap(p(0,0));assert.equal(hit.snapped,true);assert.equal(hit.x,20);
});

test('312 끄는 객체는 스냅 후보에서 빠지고, 늘리는 폴리선의 움직이지 않는 꼭짓점은 남는다',()=>{
  const moving=line('m',p(1,0),p(100,0)),other=line('o',p(3,0),p(3,50));
  const c=snapper([moving,other]);
  assert.equal(c.snap(p(0,0)).x,1,'평소에는 가까운 자기 끝점');
  assert.equal(c.snap(p(0,0),{exclude:{ids:new Set(['m'])}}).x,3,'빼면 다른 객체');
  const poly={id:'pl',type:'polyline',points:[p(0,0),p(100,0),p(100,100),p(2,100)]};
  const drag={kind:'entity-grip',id:'pl',grip:{kind:'vertex',index:0,point:p(0,0)}};
  const ex=IA.dragSnapExclusion(drag,poly);assert.deepEqual(ex.keep,[p(100,0),p(100,100),p(2,100)]);
  const d=snapper([poly]);const r=d.snap(p(1,98),{exclude:ex});assert.equal(r.snapped,true);assert.deepEqual([r.x,r.y],[2,100],'같은 폴리선의 다른 꼭짓점에 맞출 수 있다');
  assert.equal(d.snap(p(1,1),{exclude:ex}).snapped,undefined,'움직이는 꼭짓점·이웃 구간 중점은 안 잡힌다');
  assert.deepEqual([...IA.dragSnapExclusion({kind:'object-move',ids:['a','b']}).ids],['a','b']);
  assert.match(app,/previewDrag\(snap\(target,typeof dragSnapOptions==='function'\?dragSnapOptions\(drag\):undefined\)\)/);
});

test('313 Tab 순환: 조리개 안 이름 스냅 후보를 모두 모으고, 커서가 조리개 안이면 고른 후보를 유지',()=>{
  const es=[line('a',p(2,0),p(2,40)),line('b',p(-5,6),p(30,6))];
  const c=snapper(es);const list=[];c.snap(p(0,0),{collect:list});
  const labels=list.map(x=>x.label);assert.ok(labels.includes('끝점')&&labels.includes('교차점'),labels.join());
  const cycle=c.assist.snapCycle;assert.ok(cycle.start(p(0,0),list,16)>=3);
  const first=c.snap(p(0,0));assert.equal(first.label,'끝점');
  const next=cycle.next();const held=c.snap(p(1,1));assert.equal(held.cycled,true);assert.deepEqual([held.x,held.y],[next.x,next.y]);
  assert.equal(c.snap(p(40,40)).cycled,undefined,'조리개 밖으로 나가면 순환 끝');assert.equal(cycle.anchor,null);
});

test('314 해치와 치수 보조선은 기본으로 스냅에서 빠지고, 임시 스냅(once)은 해치를 허용',()=>{
  assert.deepEqual(IA.snapIgnores(3,null),{hatch:true,extension:true});assert.deepEqual(IA.snapIgnores(3,'end'),{hatch:false,extension:true});assert.deepEqual(IA.snapIgnores(0),{hatch:false,extension:false});
  const hatch={id:'h',type:'hatch',points:[p(2,0),p(50,0),p(50,50),p(2,50)]};
  const c=snapper([hatch]);assert.equal(c.snap(p(0,0)).snapped,undefined,'해치 꼭짓점에 붙지 않음');
  c.assist.prefs.osnapOptions=0;assert.equal(c.snap(p(0,0)).snapped,true,'설정으로 되돌리기');
  const once=snapper([hatch]);once.osnapOnce='end';assert.equal(once.snap(p(0,0)).snapped,true,'임시 스냅은 해치 허용');
  const dim={id:'d',type:'dimension',mode:'aligned',points:[p(0,0),p(1000,0),p(500,300)],textHeight:100};
  const parts=G.dimensionParts(dim).filter(x=>x.type==='line');
  const ext=parts.filter(x=>IA.isDimensionExtension(dim,x.points));
  assert.equal(ext.length,2,'보조선 둘');assert.ok(parts.length>ext.length,'치수선은 보조선이 아님');
  assert.equal(IA.isDimensionExtension({type:'dimension',mode:'radius',points:[p(0,0),p(1,0)]},[p(0,0),p(0,5)]),false);
});

test('315 객체 추적: 0.1초 머물면 얻고 다시 머물면 빼며, 가로·세로선과 두 선의 교차에 붙는다',()=>{
  const timers=[];const t=new IA.ObjectTracking({setTimer:fn=>{timers.push(fn);return timers.length;},clearTimer:id=>{timers[id-1]=null;}});
  t.hover({x:0,y:0,snapped:true},null);t.hover({x:0,y:0,snapped:true},null);assert.equal(timers.filter(Boolean).length,1,'같은 점이면 다시 걸지 않음');
  timers.at(-1)();assert.equal(t.points.length,1);
  t.hover(null);t.hover({x:100,y:200,snapped:true});timers.at(-1)();assert.equal(t.points.length,2);
  const h=t.align(p(55,3),5);assert.deepEqual([h.x,h.y],[55,0]);
  const both=t.align(p(98,2),5);assert.deepEqual([both.x,both.y],[100,0],'(0,0) 가로선과 (100,200) 세로선의 교차');assert.equal(both.tracking.length,2);
  assert.equal(t.align(p(50,50),5),null);
  t.hover({x:100,y:200,snapped:true});timers.at(-1)();assert.equal(t.points.length,1,'다시 머물면 뺀다');
  const t2=new IA.ObjectTracking();t2.points=[{x:50,y:-300}];const polarLine=t2.align(p(51,49),5,{angles:[0,90],extraLines:[{base:p(0,100),angle:-45}]});assert.ok(Math.abs(polarLine.x-50)<1e-9&&Math.abs(polarLine.y-50)<1e-9,'극좌표선과 추적선 교차');
  // snap(): 객체 스냅이 없으면 추적선에 붙는다
  const c=snapper([],{checked:['osnap','snap-end','otrack']});c.assist.tracking.points=[{x:0,y:0}];
  const r=c.snap(p(300,4));assert.deepEqual([r.x,r.y],[300,0]);assert.equal(r.label,'추적');
  c.on.delete('otrack');assert.deepEqual([c.snap(p(300,4)).x,c.snap(p(300,4)).y],[300,4],'끄면 없음');
  assert.match(app,/F11:'otrack'/);assert.match(app,/assist\.tracking\.clear\(\);assist\.snapCycle\.clear\(\)/);
});

test('316 극좌표: 기본 설정이면 예전과 같은 점, 추가 각도·상대 각·거리 단위',()=>{
  assert.deepEqual(IA.polarAngleList(90,''),[0,90,180,270]);assert.deepEqual(IA.polarAngleList(90,'15; 375,abc'),[0,90,180,270,15]);
  const add=IA.polarTrack(p(0,0),p(100,27),{angles:IA.polarAngleList(90,'15'),tol:5});assert.ok(Math.abs(add.angle-15)<1e-9);
  const rel=IA.polarTrack(p(0,0),p(70,72),{angles:[0,90],tol:5,relative:45});assert.ok(Math.abs(rel.angle-45)<1e-9);
  const unit=IA.polarTrack(p(0,0),p(237,1),{angles:[0],tol:5,distanceUnit:100});assert.deepEqual([unit.x,unit.y],[200,0]);
  // app.js polarInput: 설정 기본이면 예전 계산과 같다
  const legacy=(base,raw,step,tol)=>{const d=G.sub(raw,base),target=Math.round(G.angle(d)/step)*step,along=G.polar(1,target),projected=G.add(base,G.mul(along,G.dot(d,along)));return G.dot(d,along)<=0||G.dist(projected,raw)>tol?null:projected;};
  const c=snapper([],{checked:['polar'],points:[p(10,10)]});let seed=3;const r=()=>{seed=(seed*16807)%2147483647;return seed/2147483647*200-100;};
  for(let i=0;i<300;i++){const raw=p(10+r(),10+r()),got=c.polarInput(raw,raw),want=legacy(p(10,10),raw,90,16);
    if(want){assert.ok(got.polar&&Math.abs(got.x-want.x)<1e-9&&Math.abs(got.y-want.y)<1e-9,JSON.stringify(raw));}else assert.equal(got.polar,undefined);}
  c.assist.prefs.polarRelative=true;c.points.push(p(110,110));const relHit=c.polarInput(p(200,200),p(200,200));assert.ok(Math.abs(relHit.polar.angle-45)<1e-9,'직전 선분(45°) 기준 0°');
});

test('곡선 근사 폴리선(SPLINE·가져온 곡선)은 AutoCAD 처럼 양 끝만 끝점, 중간점은 곡선 절반 하나',()=>{
  const corner=[line('a',p(0,0),p(100,0)),line('b',p(0,0),p(0,-100))];
  const wave=Array.from({length:41},(_,i)=>p(-50+i*2.5,4+Math.sin(i/3)));
  const endOnly=['osnap','snap-end','snap-intersection'];
  for(const flag of [{spline:{degree:3}},{curveApprox:true}]){
    const curve={id:'s',type:'polyline',points:wave,...flag};
    const r=snapper([...corner,curve],{checked:endOnly}).snap(p(2,2.5));assert.deepEqual([r.x,r.y,r.label],[0,0,'끝점'],'곡선 마디의 가짜 점이 모서리를 가리지 않는다');
    const end=snapper([...corner,curve],{checked:endOnly}).snap(p(48,4));assert.deepEqual([end.x,end.y],[wave.at(-1).x,wave.at(-1).y],'곡선의 진짜 끝점');
    const mid=snapper([curve],{checked:['osnap','snap-mid']}).snap(p(0,4));assert.equal(mid.label,'중점');assert.ok(Math.abs(mid.x)<3,'길이 절반 지점');
    assert.equal(snapper([curve],{checked:['osnap','snap-mid']}).snap(p(30,4)).snapped,undefined,'마디 중점은 없다');
  }
  const plain=snapper([...corner,{id:'s',type:'polyline',points:wave}],{checked:endOnly});assert.notEqual(plain.snap(p(2,2.5)).y,0,'보통 폴리선은 꼭짓점마다 끝점 그대로');
});

test('가져온 채운 면(SOLID, solidFace)은 해치 무시 설정이어도 모서리를 잡는다',()=>{
  const face={id:'f',type:'hatch',solid:true,solidFace:true,points:[p(0,0),p(10,0),p(10,10),p(0,10)]};
  const c=snapper([face]);const r=c.snap(p(1,1));assert.deepEqual([r.x,r.y,r.label],[0,0,'끝점']);
  assert.equal(snapper([{...face,solidFace:undefined}]).snap(p(1,1)).snapped,undefined,'보통 해치는 그대로 무시');
});

test('타원도 교차점·근처점을 잡는다',()=>{
  const ellipse={id:'e',type:'ellipse',center:p(0,0),majorAxis:p(100,0),ratio:.5};
  const y=50*Math.sqrt(1-.36);
  const c=snapper([ellipse,line('v',p(60,-100),p(60,100))]);const r=c.snap(p(61,y-2));
  assert.equal(r.label,'교차점');assert.ok(Math.abs(r.x-60)<.5&&Math.abs(r.y-y)<.5,JSON.stringify(r));
  const n=snapper([ellipse],{checked:['osnap','snap-nearest']}).snap(p(0,48));assert.equal(n.label,'근처점');assert.ok(Math.abs(n.y-50)<.5);
});
