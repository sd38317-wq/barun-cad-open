// 그리기 카드 3종. izzarder.com 원문을 근거로 옮겼다.
// CTR 차량 궤적 그리기(/88) · DDB 배수판 그리기(/580) · HGRID 바닥난방 XL파이프 그리기(/289).
// 조작은 모두 "그림 선택창 → 화면에서 점 입력(미리보기) → 커밋(Ctrl+Z 한 번)".
import * as G from './geometry.js';
import {STD_LAYERS,builder,wallFrame,entitiesSvg,openCardDialog,resolveLayers,saveCardState} from './card-kit.js';

const R2D=180/Math.PI,EPSP=1e-6;
/** 이 묶음이 쓰는 표준 켜. 근거는 보고서 참조. */
export const SITE_LAYERS=Object.freeze({body:'A-SITE',track:'A-SITE-ROAD',symb:STD_LAYERS.symb,text:STD_LAYERS.text,board:'A-WALL-FNSH',pipe:'A-PLMB'});
const near=(a,b)=>G.dist(a,b)<EPSP;
/** 이어진 같은 점을 지운 점 목록 */
export function dedupePoints(points){
 const out=[];for(const p of points||[])if(!out.length||!near(out.at(-1),p))out.push({x:p.x,y:p.y});return out;
}

/* ══════════════════ CTR · 차량 궤적 그리기 (원문 https://izzarder.com/88) ══════════════════
   원문 대화상자: [이름] · [차량 제원 단위(mm)] 전장·전폭·축간거리·윤거 앞·뒤오버행·최소반경·사용자 ·
   [등록/삭제] 차량 목록 + [수정/추가]/[삭제] · [제원쓰기] · [이동조건] 전후진거리·회전 각도·차를 따라 이동보기. */
export const CTR_STORAGE_KEY='barun-ctr-card';
export const CTR_SLOTS=8;
/** 원문(/88)에 제원 숫자가 실제로 실린 차량만 담았다. 나머지 차량은 [차량 수정/추가]로 등록한다. */
export const CTR_VEHICLES=Object.freeze([
 {name:'기아 K5',carLength:4905,carWidth:1860,wheelbase:2850,frontTrack:1618,rearOverhang:1035,minRadius:5780,userRadius:5780},
 {name:'현대코나',carLength:3392,carWidth:1475,wheelbase:2340,frontTrack:1300,rearOverhang:520,minRadius:5400,userRadius:5400},
]);
export const CTR_FIELDS=[
 {key:'carLength',label:'전 장',type:'number',def:4905,min:1000,step:1,group:'차량 제원 단위(mm)'},
 {key:'carWidth',label:'전 폭',type:'number',def:1860,min:500,step:1,group:'차량 제원 단위(mm)'},
 {key:'wheelbase',label:'축간거리',type:'number',def:2850,min:500,step:1,group:'차량 제원 단위(mm)'},
 {key:'frontTrack',label:'윤거 앞',type:'number',def:1618,min:300,step:1,group:'차량 제원 단위(mm)'},
 {key:'rearOverhang',label:'뒤오버행',type:'number',def:1035,min:0,step:1,group:'차량 제원 단위(mm)'},
 {key:'minRadius',label:'최소반경',type:'number',def:5780,min:1000,step:10,group:'차량 제원 단위(mm)',hint:'차량의 최소 회전 반경. 이 이하로는 회전하지 않습니다.'},
 {key:'userRadius',label:'사용자',type:'number',def:5780,min:1000,step:10,group:'차량 제원 단위(mm)',hint:'따로 정하는 회전반경. 최소반경보다 작을 수 없습니다.'},
 {key:'writeSpec',label:'제원쓰기',type:'check',def:false,group:'제원쓰기'},
 {key:'moveStep',label:'전후진거리',type:'number',def:800,min:1,step:10,group:'이동조건',hint:'한 번 움직이는 거리'},
 {key:'turnAngle',label:'회전 각도',type:'number',def:5,min:.1,max:90,step:.1,group:'이동조건',hint:'회전할 때 한 번에 도는 각도'},
 {key:'followCar',label:'차를 따라 이동보기',type:'check',def:false,group:'이동조건'},
 {key:'inputMode',label:'입력 방식',type:'select',def:'path',options:[['path','경로 점 찍기'],['keys','운전 키 순서']],group:'입력',hint:'원문의 화면 그리기(폴리선 따라가기)와 키보드 입력에 해당합니다.'},
 {key:'driveKeys',label:'운전 키 순서',type:'text',def:'WWWQQQWWW',group:'입력',when:v=>v.inputMode==='keys',hint:'7 8 9 4 5 6 1 3 0 P M U · Q W E A S D Z C'},
];
export const CTR_SHARED_FIELDS=[
 {key:'bodyLayer',label:'차체 켜',type:'layer',def:SITE_LAYERS.body,group:'켜 설정'},
 {key:'trackLayer',label:'궤적 켜',type:'layer',def:SITE_LAYERS.track,group:'켜 설정'},
 {key:'tableLayer',label:'제원표 켜',type:'layer',def:SITE_LAYERS.symb,group:'켜 설정',when:v=>v.writeSpec},
 {key:'tableTextLayer',label:'제원표 문자 켜',type:'layer',def:SITE_LAYERS.text,group:'켜 설정',when:v=>v.writeSpec},
];
export const ctrSlotDefaults=i=>CTR_VEHICLES[i]||{name:`사용자 차량 ${i-CTR_VEHICLES.length+1}`};

/** 뒤축 중심을 원점, 차 앞쪽을 +s 로 본 차체 치수 */
export function carShape(v){
 if(!(v.wheelbase>0))throw Error('축간거리는 0보다 커야 합니다.');
 const rear=-v.rearOverhang,front=v.carLength-v.rearOverhang;
 if(front<=v.wheelbase)throw Error(`전장(${v.carLength})은 축간거리(${v.wheelbase})와 뒤오버행(${v.rearOverhang})을 더한 값보다 커야 합니다.`);
 if(!(v.carWidth>0))throw Error('전폭은 0보다 커야 합니다.');
 return {rear,front,half:v.carWidth/2,wheelbase:v.wheelbase,track:v.frontTrack,frontOverhang:front-v.wheelbase};
}
/** 차 좌표(s 앞쪽, d 왼쪽)를 도면 좌표로 */
export function poseWorld(pose,s,d){const a=pose.h/R2D,c=Math.cos(a),n=Math.sin(a);return {x:pose.x+s*c-d*n,y:pose.y+s*n+d*c};}
/** 차체 네 모서리: 뒤우 → 앞우 → 앞좌 → 뒤좌 */
export function bodyCorners(v,pose){const g=carShape(v);return [poseWorld(pose,g.rear,-g.half),poseWorld(pose,g.front,-g.half),poseWorld(pose,g.front,g.half),poseWorld(pose,g.rear,g.half)];}
/** 바퀴 네 곳. 원문 제원에 윤거 뒤가 없어 앞뒤 모두 [윤거 앞]을 쓴다. */
export function wheelPoints(v,pose){const g=carShape(v),t=g.track/2;return {fl:poseWorld(pose,g.wheelbase,t),fr:poseWorld(pose,g.wheelbase,-t),rl:poseWorld(pose,0,t),rr:poseWorld(pose,0,-t)};}
/** 자전거 모형 한 걸음. distance 음수면 후진, steer +1 좌조향 / -1 우조향 / 0 직진. */
export function driveStep(pose,distance,radius,steer){
 const h=G.normalizeAngle(pose.h);
 if(!steer)return {x:pose.x+distance*Math.cos(h/R2D),y:pose.y+distance*Math.sin(h/R2D),h};
 if(!(radius>0))throw Error('회전반경은 0보다 커야 합니다.');
 const dt=steer*distance/radius*R2D,c=G.add(pose,G.mul(G.normal(G.polar(1,h)),steer*radius)),phi=G.angle(G.sub(pose,c)),p=G.add(c,G.polar(radius,phi+dt));
 return {x:p.x,y:p.y,h:G.normalizeAngle(h+dt)};
}

/** 원문 키보드 입력표(숫자패드 / 영문자) */
export const CTR_KEYS=Object.freeze({'7':'전좌','Q':'전좌','8':'전진','W':'전진','9':'전우','E':'전우',
 '4':'후좌','A':'후좌','5':'후진','S':'후진','6':'후우','D':'후우',
 '1':'제원반경','Z':'제원반경','3':'사용자반경','C':'사용자반경',
 'P':'사용자반경+100','+':'사용자반경+100','M':'사용자반경-100','-':'사용자반경-100',
 '0':'되돌리기','U':'되돌리기'});
export function parseDriveKeys(text){
 const out=[];
 for(const ch of String(text||'').toUpperCase()){
  if(/[\s,]/.test(ch))continue;
  const act=CTR_KEYS[ch];
  if(!act)throw Error(`운전 키 "${ch}" 는 쓸 수 없습니다. 쓸 수 있는 키는 7 8 9 4 5 6 1 3 0 P M U 와 Q W E A S D Z C 입니다.`);
  out.push(act);
 }
 if(!out.length)throw Error('운전 키 순서를 입력하세요. 보기: WWWQQQWWW');
 return out;
}
/** 운전 키 순서대로 뒤축 중심의 자세 목록을 만든다. */
export function posesFromKeys(v,start,heading,text){
 carShape(v);
 const acts=parseDriveKeys(text),min=v.minRadius;
 if(v.userRadius<min)throw Error(`사용자 회전반경(${v.userRadius})은 최소반경(${min})보다 작을 수 없습니다.`);
 let user=v.userRadius,R=min;
 const poses=[{x:start.x,y:start.y,h:G.normalizeAngle(heading)}],turn=()=>R*(v.turnAngle/R2D);
 const step=(dist,steer)=>poses.push(driveStep(poses.at(-1),dist,R,steer));
 for(const a of acts){
  if(a==='전진')step(v.moveStep,0);
  else if(a==='후진')step(-v.moveStep,0);
  else if(a==='전좌')step(turn(),1);
  else if(a==='전우')step(turn(),-1);
  else if(a==='후좌')step(-turn(),1);
  else if(a==='후우')step(-turn(),-1);
  else if(a==='제원반경')R=min;
  else if(a==='사용자반경')R=user;
  else if(a==='사용자반경+100'){user+=100;R=user;}
  else if(a==='사용자반경-100'){user=Math.max(min,user-100);R=user;}
  else if(a==='되돌리기'&&poses.length>1)poses.pop();
 }
 return {poses,radius:R,userRadius:user};
}

/** 찍은 경로를 회전반경에 맞춰 직선+원호로 고친다. 고쳐도 반경이 안 나오면 그 꼭짓점에서 멈춘다(원문). */
export function fitPathArcs(points,radius){
 const pts=dedupePoints(points);
 if(pts.length<2)throw Error('경로는 서로 다른 점이 둘 이상이어야 합니다.');
 if(!(radius>0))throw Error('회전반경은 0보다 커야 합니다.');
 const segs=[];let cur=pts[0],stopped=null,used=0;
 for(let i=1;i<pts.length-1;i++){
  const a=pts[i-1],b=pts[i],c=pts[i+1],u1=G.unit(G.sub(b,a)),u2=G.unit(G.sub(c,b));
  const turn=Math.atan2(G.cross(u1,u2),G.dot(u1,u2));
  if(Math.abs(turn)<1e-9){used=Math.max(0,used-G.dist(a,b));continue;}
  if(Math.abs(turn)>Math.PI-1e-6){stopped=i;break;}
  const t=radius*Math.abs(Math.tan(turn/2));
  if(t>G.dist(a,b)-used+EPSP||t>G.dist(b,c)+EPSP){stopped=i;break;}
  const T1=G.add(b,G.mul(u1,-t)),T2=G.add(b,G.mul(u2,t)),side=turn>0?1:-1;
  const center=G.add(T1,G.mul(G.normal(u1),side*radius));
  if(!near(cur,T1))segs.push({type:'line',a:cur,b:T1});
  segs.push({type:'arc',center,radius,start:G.angle(G.sub(T1,center)),sweep:turn*R2D,side});
  cur=T2;used=t;
 }
 const end=stopped===null?pts.at(-1):pts[stopped];
 if(!near(cur,end))segs.push({type:'line',a:cur,b:end});
 if(!segs.length)throw Error('경로가 너무 짧아 궤적을 그릴 수 없습니다.');
 return {segments:segs,stopped};
}
/** 직선은 전후진거리마다, 원호는 회전각도마다 자세를 뽑는다. */
export function posesAlongSegments(segs,moveStep,turnAngle){
 if(!(moveStep>0))throw Error('전후진거리는 0보다 커야 합니다.');
 if(!(turnAngle>0))throw Error('회전 각도는 0보다 커야 합니다.');
 const out=[],push=(p,h)=>{const n={x:p.x,y:p.y,h:G.normalizeAngle(h)},l=out.at(-1);if(!l||!near(l,n)||Math.abs(l.h-n.h)>EPSP)out.push(n);};
 for(const s of segs){
  if(s.type==='line'){
   const L=G.dist(s.a,s.b),u=G.unit(G.sub(s.b,s.a)),h=G.angle(u);
   for(let k=0;k*moveStep<L-EPSP;k++)push(G.add(s.a,G.mul(u,k*moveStep)),h);
   push(s.b,h);
  }else{
   const total=Math.abs(s.sweep),dir=s.sweep>=0?1:-1;
   for(let k=0;k*turnAngle<total-EPSP;k++){const phi=s.start+dir*k*turnAngle;push(G.add(s.center,G.polar(s.radius,phi)),phi+90*s.side);}
   const phi=s.start+s.sweep;push(G.add(s.center,G.polar(s.radius,phi)),phi+90*s.side);
  }
 }
 return out;
}
export function posesAlongPath(v,points,radius){
 const fit=fitPathArcs(points,radius);
 return {poses:posesAlongSegments(fit.segments,v.moveStep,v.turnAngle),stopped:fit.stopped};
}
/** 궤적 객체: 자세마다 차체 외곽 + 바퀴 4줄 + 차체 모서리 4줄(외곽 스윕) */
export function buildTrajectory(v,shared,poses){
 if(!Array.isArray(poses)||poses.length<2)throw Error('움직임이 둘 이상 있어야 궤적을 그립니다.');
 const ents=[],corner=[[],[],[],[]],fl=[],fr=[],rl=[],rr=[];
 for(const p of poses){
  const cs=bodyCorners(v,p);
  ents.push({type:'polyline',closed:true,points:cs,cardLayer:shared.bodyLayer});
  cs.forEach((c,i)=>corner[i].push(c));
  const w=wheelPoints(v,p);fl.push(w.fl);fr.push(w.fr);rl.push(w.rl);rr.push(w.rr);
 }
 const poly=pts=>({type:'polyline',closed:false,points:pts,cardLayer:shared.trackLayer});
 const tracks=[poly(fl),poly(fr),poly(rl),poly(rr),...corner.map(poly)];
 ents.push(...tracks);
 return {entities:ents,bodies:poses.length,tracks:tracks.length};
}
/** 제원쓰기 문자표(원문 항목 이름 그대로) */
export function specTableRows(v,name){
 return [['이름',String(name||'')],['전체길이',String(v.carLength)],['전체폭',String(v.carWidth)],['앞뒤바퀴간격',String(v.wheelbase)],
  ['앞바퀴간격',String(v.frontTrack)],['뒤오버행',String(v.rearOverhang)],['최소회전반경',String(v.minRadius)]];
}
export function specTableEntities(v,shared,origin,name,height){
 const rows=specTableRows(v,name),h=height>0?height:Math.max(100,v.carWidth/8),rowH=h*1.8,w0=h*7,w1=h*6,W=w0+w1,H=rowH*rows.length,x=origin.x,y=origin.y;
 const out=[],L=(x1,y1,x2,y2)=>out.push({type:'line',points:[{x:x1,y:y1},{x:x2,y:y2}],cardLayer:shared.tableLayer});
 for(let i=0;i<=rows.length;i++)L(x,y-rowH*i,x+W,y-rowH*i);
 for(const cx of [x,x+w0,x+W])L(cx,y,cx,y-H);
 rows.forEach(([k,val],i)=>{
  const cy=y-rowH*(i+.5);
  out.push({type:'text',position:{x:x+h*.4,y:cy},text:k,height:h,rotation:0,align:'left',cardLayer:shared.tableTextLayer});
  out.push({type:'text',position:{x:x+W-h*.4,y:cy},text:val,height:h,rotation:0,align:'right',cardLayer:shared.tableTextLayer});
 });
 return {entities:out,width:W,height:H,textHeight:h};
}
/** 미리보기용 본보기 경로(차 길이에 맞춰 ㄱ 자로 꺾는다) */
export function ctrSampleTrajectory(v,shared){
 const R=Math.max(v.minRadius,v.userRadius),L=R*1.8;
 const pts=[{x:0,y:0},{x:L,y:0},{x:L,y:L}];
 const {poses}=posesAlongPath(v,pts,R);
 return buildTrajectory(v,shared,poses);
}
export function ctrPreviewSvg(v,shared,opts={}){
 let ents=[];
 try{ents=ctrSampleTrajectory(v,shared).entities;}catch{ents=[];}
 return entitiesSvg(ents,{label:opts.compact?'':`${v.name||'차량'} · 전장 ${v.carLength} · 최소반경 ${v.minRadius}`,...opts});
}

/* ══════════════════ DDB · 배수판 그리기 (원문 https://izzarder.com/580) ══════════════════
   원문 설정: [켜] · [전체높이] · [화면에서 높이지정] · [길이에 맞춰 절단] ·
   구분표 5줄(배수판·데크1·데크2·골판1·골판2) × 상판길이·경사길이·하판길이·판두께. 두께 0 이면 단선.
   조작: 설정(S)/시작점 지정 → 끝 점 지정 → 방향 지정 (단열재그리기 INS 와 같은 체계). */
export const DDB_STORAGE_KEY='barun-ddb-card';
export const DDB_NAMES=Object.freeze(['배수판','데크1','데크2','골판1','골판2']);
export const DDB_PRESETS=Object.freeze([
 {topLength:20,slopeLength:10,bottomLength:20,plateThickness:2},
 {topLength:10,slopeLength:10,bottomLength:600,plateThickness:1},
 {topLength:30,slopeLength:30,bottomLength:900,plateThickness:1},
 {topLength:60,slopeLength:30,bottomLength:60,plateThickness:1},
 {topLength:100,slopeLength:30,bottomLength:100,plateThickness:1},
]);
export const DDB_FIELDS=[
 {key:'topLength',label:'상판길이',type:'number',def:20,min:0,step:1,group:'구분'},
 {key:'slopeLength',label:'경사길이',type:'number',def:10,min:0,step:1,group:'구분'},
 {key:'bottomLength',label:'하판길이',type:'number',def:20,min:0,step:1,group:'구분'},
 {key:'plateThickness',label:'판두께',type:'number',def:2,min:0,step:.1,group:'구분',hint:'0 이면 단선으로 그립니다.'},
];
export const DDB_SHARED_FIELDS=[
 {key:'boardLayer',label:'켜',type:'layer',def:SITE_LAYERS.board,group:'설정'},
 {key:'totalHeight',label:'전체높이',type:'number',def:50,min:1,step:1,group:'설정'},
 {key:'screenHeight',label:'화면에서 높이지정',type:'check',def:false,group:'설정',hint:'켜면 셋째 점(방향)까지의 거리를 전체높이로 씁니다.'},
 {key:'cutToLength',label:'길이에 맞춰 절단',type:'check',def:true,group:'설정'},
];
export const ddbSlotDefaults=i=>DDB_PRESETS[i]||{};

/** 배수판 단면 바깥선. 하판(d=0)에서 시작해 경사 → 상판(d=height) → 경사 → 하판을 되풀이한다. */
export function drainProfile(v,length,height,cutToLength){
 const {topLength:tp,slopeLength:sl,bottomLength:bt}=v,period=bt+sl+tp+sl;
 if(!(period>0))throw Error('상판·경사·하판 길이를 모두 0 으로 둘 수는 없습니다.');
 if(!(length>0))throw Error('시작점과 끝점이 서로 달라야 합니다.');
 if(!(height>0))throw Error('전체높이는 0보다 커야 합니다.');
 const limit=cutToLength?length:Math.max(period,Math.floor(length/period+EPSP)*period);
 const pts=[[0,0]],step=(ds,d)=>{const s=pts.at(-1)[0]+ds;pts.push([s,d]);};
 while(pts.at(-1)[0]<limit-EPSP){step(bt,0);step(sl,height);step(tp,height);step(sl,0);}
 // limit 를 넘은 구간은 잘라낸다(길이에 맞춰 절단).
 while(pts.length>1&&pts.at(-2)[0]>=limit-EPSP)pts.pop();
 const last=pts.at(-1),prev=pts.at(-2);
 if(prev&&last[0]>limit+EPSP){const t=(limit-prev[0])/(last[0]-prev[0]);pts[pts.length-1]=[limit,prev[1]+(last[1]-prev[1])*t];}
 return dedupeLocal(pts);
}
const dedupeLocal=pts=>{const o=[];for(const p of pts)if(!o.length||Math.abs(o.at(-1)[0]-p[0])>EPSP||Math.abs(o.at(-1)[1]-p[1])>EPSP)o.push([p[0],p[1]]);return o;};
/** 꺾은선을 두께만큼 평행 이동(모서리는 각 이등분선). delta 가 양수면 진행 방향의 왼쪽(+d). */
export function offsetProfile(pts,delta){
 if(pts.length<2)throw Error('꺾은선은 점이 둘 이상이어야 합니다.');
 const nL=i=>{const a=pts[i],b=pts[i+1],dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy);if(L<EPSP)throw Error('같은 점이 이어져 있습니다.');return [-dy/L,dx/L];};
 return pts.map((p,i)=>{
  if(i===0){const n=nL(0);return [p[0]+delta*n[0],p[1]+delta*n[1]];}
  if(i===pts.length-1){const n=nL(i-1);return [p[0]+delta*n[0],p[1]+delta*n[1]];}
  const a=nL(i-1),b=nL(i),k=1+a[0]*b[0]+a[1]*b[1];
  if(Math.abs(k)<1e-9)throw Error('꺾인 각이 너무 날카로워 두께를 줄 수 없습니다.');
  return [p[0]+delta*(a[0]+b[0])/k,p[1]+delta*(a[1]+b[1])/k];
 });
}
/** 배수판 객체. f 는 세 점 벽 좌표계(p1·p2 기준선, p3 방향). */
export function buildDrainBoard(f,length,v,shared){
 const height=shared.screenHeight?f.t:shared.totalHeight;
 const outer=drainProfile(v,length,height,!!shared.cutToLength),b=builder(f,shared.boardLayer);
 if(!(v.plateThickness>0)){b.poly(outer,false);return {entities:b.list,height,single:true,period:v.bottomLength+v.slopeLength+v.topLength+v.slopeLength};}
 const inner=offsetProfile(outer,-v.plateThickness);
 b.poly([...outer,...inner.slice().reverse()],true);
 return {entities:b.list,height,single:false,period:v.bottomLength+v.slopeLength+v.topLength+v.slopeLength};
}
export function ddbPreviewSvg(v,shared,opts={}){
 const period=v.bottomLength+v.slopeLength+v.topLength+v.slopeLength,L=Math.max(period*4,1),h=shared.totalHeight;
 const f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:1});
 let ents=[];
 try{ents=buildDrainBoard(f,L,v,{...shared,screenHeight:false}).entities;}catch{ents=[];}
 const base=[{type:'line',points:[{x:0,y:0},{x:L,y:0}],previewColor:'#ff9f68'}];
 return entitiesSvg([...ents,...base],{label:opts.compact?'':`${v.name||''} 상판 ${v.topLength} · 경사 ${v.slopeLength} · 하판 ${v.bottomLength} · 두께 ${v.plateThickness} · 높이 ${h}`,...opts});
}

/* ══════════════════ HGRID · 바닥난방 XL파이프 그리기 (원문 https://izzarder.com/289) ══════════════════
   원문: 대화상자 없이 닫혀진 사각형을 선택하거나 사각의 두 점을 지정하면 난방 파이프를 그린다.
   파이프의 시작위치는 사각형을 그린 순서(1번 점)를 따라간다. 모양은 되돌림(왕복) 나선이다. */
export const HGRID_STORAGE_KEY='barun-hgrid-card';
export const HGRID_FIELDS=[
 {key:'spacing',label:'파이프 간격 (mm)',type:'number',def:200,min:20,step:10,group:'배관',hint:'원문에는 없는 값입니다. 바른 CAD 에는 환경설정 명령(BRSETUP)이 없어 카드에서 받습니다.'},
 {key:'inputMode',label:'입력 방식',type:'select',def:'two',options:[['two','사각의 두 점 지정'],['pick','닫힌 사각형 선택']],group:'배관'},
];
export const HGRID_SHARED_FIELDS=[
 {key:'pipeLayer',label:'파이프 켜',type:'layer',def:SITE_LAYERS.pipe,group:'켜 설정'},
];
/** 사각 나선 한 줄. inset 만큼 안쪽에서 시작해 pitch 씩 줄여 간다. 시작 모서리는 (inset,inset). */
export function squareSpiral(width,depth,pitch,inset=0){
 if(!(width>0&&depth>0))throw Error('사각형의 가로·세로가 0보다 커야 합니다.');
 if(!(pitch>0))throw Error('파이프 간격은 0보다 커야 합니다.');
 let s0=inset,s1=width-inset,d0=inset,d1=depth-inset;
 const pts=[];
 if(s1-s0<EPSP||d1-d0<EPSP)return pts;
 pts.push([s0,d0]);
 for(let guard=0;guard<2000;guard++){
  pts.push([s1,d0]);d0+=pitch;if(d1-d0<EPSP)break;
  pts.push([s1,d1]);s1-=pitch;if(s1-s0<EPSP)break;
  pts.push([s0,d1]);d1-=pitch;if(d1-d0<EPSP)break;
  pts.push([s0,d0]);s0+=pitch;if(s1-s0<EPSP)break;
 }
 return dedupeLocal(pts);
}
/** 되돌림 나선(왕복 배관). 들어가는 줄과 나오는 줄이 서로 한 칸씩 엇갈려 감기고 가운데에서 되돌아 나온다. */
export function heatCoil(width,depth,spacing){
 if(!(spacing>0))throw Error('파이프 간격은 0보다 커야 합니다.');
 if(!(width>=spacing*2&&depth>=spacing*2))throw Error(`사각형(${Math.round(width)} × ${Math.round(depth)})이 파이프 간격 ${spacing} 에 비해 너무 작습니다.`);
 const inward=squareSpiral(width,depth,spacing*2,0),outward=squareSpiral(width,depth,spacing*2,spacing);
 if(!inward.length)throw Error('사각형이 파이프 간격보다 작습니다.');
 if(!outward.length)return inward;
 return dedupeLocal([...inward,...outward.slice().reverse()]);
}
/** 꺾인 곳을 반지름 r 로 둥글린 점 목록. 이은 선으로만 그리므로 steps 개로 나눠 담는다. */
export function roundCorners(pts,r,steps=6){
 if(!(r>0)||pts.length<3)return pts.map(p=>[p[0],p[1]]);
 const out=[[pts[0][0],pts[0][1]]];
 for(let i=1;i<pts.length-1;i++){
  const a=pts[i-1],b=pts[i],c=pts[i+1];
  const v1=[b[0]-a[0],b[1]-a[1]],v2=[c[0]-b[0],c[1]-b[1]],L1=Math.hypot(...v1),L2=Math.hypot(...v2);
  if(L1<EPSP||L2<EPSP)continue;
  const u1=[v1[0]/L1,v1[1]/L1],u2=[v2[0]/L2,v2[1]/L2],turn=Math.atan2(u1[0]*u2[1]-u1[1]*u2[0],u1[0]*u2[0]+u1[1]*u2[1]);
  if(Math.abs(turn)<1e-9||Math.abs(turn)>Math.PI-1e-9){out.push([b[0],b[1]]);continue;}
  const t=Math.min(r*Math.abs(Math.tan(turn/2)),L1/2,L2/2),rr=t/Math.abs(Math.tan(turn/2));
  const T1=[b[0]-u1[0]*t,b[1]-u1[1]*t],side=turn>0?1:-1,cen=[T1[0]-u1[1]*side*rr,T1[1]+u1[0]*side*rr];
  const a0=Math.atan2(T1[1]-cen[1],T1[0]-cen[0]);
  out.push(T1);
  for(let k=1;k<=steps;k++){const ang=a0+turn*k/steps;out.push([cen[0]+rr*Math.cos(ang),cen[1]+rr*Math.sin(ang)]);}
 }
 out.push([pts.at(-1)[0],pts.at(-1)[1]]);
 return dedupeLocal(out);
}
/** 두 점(대각)으로 파이프 좌표계를 만든다. 1번 점이 시작 모서리가 된다(원문). */
export function cornerFrame(p1,p2){
 const dx=p2.x-p1.x,dy=p2.y-p1.y;
 if(Math.abs(dx)<EPSP||Math.abs(dy)<EPSP)throw Error('두 점이 사각형의 마주 보는 모서리여야 합니다.');
 const u={x:Math.sign(dx),y:0},n={x:0,y:Math.sign(dy)};
 return {frame:{origin:{x:p1.x,y:p1.y},u,n,t:Math.abs(dy),angle:G.angle(u),flip:G.cross(u,n)<0?-1:1},width:Math.abs(dx),depth:Math.abs(dy)};
}
export function buildHeatGrid(p1,p2,v,shared){
 const {frame,width,depth}=cornerFrame(p1,p2);
 const coil=roundCorners(heatCoil(width,depth,v.spacing),v.spacing/2);
 const b=builder(frame,shared.pipeLayer);
 b.poly(coil,false);
 return {entities:b.list,width,depth,points:coil.length,loops:Math.floor(Math.min(width,depth)/(v.spacing*2))};
}
export function hgridPreviewSvg(v,shared,opts={}){
 let ents=[];
 try{ents=buildHeatGrid({x:0,y:0},{x:v.spacing*22,y:v.spacing*16},v,shared).entities;}catch{ents=[];}
 return entitiesSvg(ents,{label:opts.compact?'':`간격 ${v.spacing} · 1번 점 모서리에서 감아 들어가 되돌아 나옵니다`,...opts});
}

/* ══════════════════ 설치 ══════════════════ */
export function installSiteDrawCards(ctx){
 const fail=e=>{console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);};

 /* ── CTR ── */
 async function ctrVehicleForm(state){
  const v=state.presets[state.selected];
  ctx.form('차량 수정/추가 · CTR',[
   {name:'name',label:'이름 (바꾸면 새 차량으로 등록, 같으면 그 차량의 제원이 바뀝니다)',type:'text',value:v.name||''},
   {name:'carLength',label:'전 장 (mm)',type:'number',value:v.carLength},
   {name:'carWidth',label:'전 폭 (mm)',type:'number',value:v.carWidth},
   {name:'wheelbase',label:'축간거리 (mm)',type:'number',value:v.wheelbase},
   {name:'frontTrack',label:'윤거 앞 (mm)',type:'number',value:v.frontTrack},
   {name:'rearOverhang',label:'뒤오버행 (mm)',type:'number',value:v.rearOverhang},
   {name:'minRadius',label:'최소반경 (mm)',type:'number',value:v.minRadius},
  ],async values=>{
   const name=String(values.name||'').trim();
   if(!name)throw Error('차량 이름을 적으세요.');
   const num=(k,label)=>{const n=Number(values[k]);if(!Number.isFinite(n)||n<0)throw Error(`${label} 은(는) 0 이상 숫자여야 합니다.`);return n;};
   const spec={carLength:num('carLength','전 장'),carWidth:num('carWidth','전 폭'),wheelbase:num('wheelbase','축간거리'),
    frontTrack:num('frontTrack','윤거 앞'),rearOverhang:num('rearOverhang','뒤오버행'),minRadius:num('minRadius','최소반경')};
   carShape(spec);
   let slot=state.presets.findIndex(p=>p.name===name);
   if(slot<0)slot=state.selected;
   state.presets[slot]={...state.presets[slot],...spec,name,userRadius:Math.max(spec.minRadius,state.presets[slot].userRadius)};
   state.selected=slot;saveCardState(ctx.storage,CTR_STORAGE_KEY,state);
   ctx.toast(`차량 "${name}" 제원을 ${slot+1}번 칸에 저장했습니다.`);
   setTimeout(()=>openCtr(slot),0);
  });
 }
 async function ctrDraw(v,shared,state){
  if(v.userRadius<v.minRadius)throw Error(`사용자 회전반경(${v.userRadius})은 최소반경(${v.minRadius})보다 작을 수 없습니다.`);
  if(v.followCar)ctx.toast('바른 CAD 카드에는 화면이 차를 따라가는 기능이 없어 [차를 따라 이동보기]는 적용하지 않습니다.');
  const R=Math.max(v.minRadius,v.userRadius);
  let poses=null,stopped=null,start=null;
  if(v.inputMode==='keys'){
   const pv=(points,cursor)=>{const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];
    try{const {poses:ps}=posesFromKeys(v,pts[0],G.angle(G.sub(pts[1],pts[0])),v.driveKeys);return buildTrajectory(v,shared,ps).entities.map(e=>({...e,previewColor:'#b5e48c'}));}catch{return [];}};
   const pts=(await ctx.pickPath({prompt:`차량 궤적 ${v.name||''} · ① 뒤축 중심 시작점 ② 차가 향할 방향 · Esc 중단`,preview:pv,minPoints:2,maxPoints:2}))?.points;
   if(!pts)return null;
   start=pts[0];poses=posesFromKeys(v,pts[0],G.angle(G.sub(pts[1],pts[0])),v.driveKeys).poses;
  }else{
   const pv=(points,cursor)=>{const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];
    try{return buildTrajectory(v,shared,posesAlongPath(v,pts,R).poses).entities.map(e=>({...e,previewColor:'#b5e48c'}));}catch{return [];}};
   const path=await ctx.pickPath({prompt:`차량 궤적 ${v.name||''} · 지나갈 경로를 이어 찍으세요(회전반경 ${Math.round(R)} 에 맞춰 고칩니다) · Enter 완료 · Esc 중단`,preview:pv,minPoints:2});
   if(!path)return null;
   start=path.points[0];
   const r=posesAlongPath(v,path.points,R);poses=r.poses;stopped=r.stopped;
  }
  const built=buildTrajectory(v,shared,poses),entities=[...built.entities];
  let table=null;
  if(v.writeSpec){
   table=specTableEntities(v,shared,{x:start.x,y:start.y+v.carLength},v.name,Math.max(100,v.carWidth/8));
   entities.push(...table.entities);
  }
  const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,entities)});
  const stopNote=stopped===null?'':` · ${stopped+1}번째 꺾인 점에서 회전반경이 안 나와 멈췄습니다`;
  ctx.toast(`차량 궤적 ${built.bodies}컷 · 궤적선 ${built.tracks}줄${table?' · 제원표 1개':''}${stopNote} · Ctrl+Z 로 되돌리기`);
  return ids;
 }
 function openCtr(select){
  return openCardDialog({ctx,title:'차량 궤적 그리기 · CTR',storageKey:CTR_STORAGE_KEY,fields:CTR_FIELDS,sharedFields:CTR_SHARED_FIELDS,
   slots:CTR_SLOTS,slotDefaults:ctrSlotDefaults,select,preview:(v,s,o)=>ctrPreviewSvg(v,s,o),goLabel:'실행',
   methods:{legend:'실행할 일',def:'draw',options:[['draw','궤적 그리기','경로를 찍거나 운전 키 순서대로 차를 움직입니다.'],['edit','차량 수정/추가','이름과 제원을 고쳐 차량을 등록하거나 바꿉니다.']]},
   copyLabel:'차량 복사',pasteLabel:'차량 붙여넣기',
   validate:(v,s,method)=>{if(method==='edit')return;carShape(v);if(v.userRadius<v.minRadius)throw Error('[사용자]는 [최소반경]보다 작을 수 없습니다.');if(v.inputMode==='keys')parseDriveKeys(v.driveKeys);},
   onGo:(v,s,method,state)=>method==='edit'?ctrVehicleForm(state):ctrDraw(v,s,state),
   note:'왼쪽 칸이 차량 목록입니다. 원문에 제원 숫자가 실린 차량은 기아 K5·현대코나 둘뿐이라 나머지 칸은 [차량 수정/추가]로 등록해 쓰세요. 키보드로 실시간 운전하는 화면은 없고, 같은 키 순서를 적어 한 번에 움직입니다.'});
 }

 /* ── DDB ── */
 async function ddbDraw(v,shared){
  const pv=(points,cursor)=>{const pts=cursor?[...points,cursor]:points;if(pts.length<3)return [];
   try{const f=wallFrame(pts[0],pts[1],pts[2]);return buildDrainBoard(f,G.dist(pts[0],pts[1]),v,shared).entities.map(e=>({...e,previewColor:'#b5e48c'}));}catch{return [];}};
  const heightNote=shared.screenHeight?'셋째 점까지의 거리가 전체높이':`전체높이 ${shared.totalHeight}`;
  const pts=(await ctx.pickPath({prompt:`배수판 ${v.name||''} · ① 시작점 ② 끝 점 ③ 방향(${heightNote}) · Esc 중단`,preview:pv,minPoints:3,maxPoints:3}))?.points;
  if(!pts)return null;
  const f=wallFrame(pts[0],pts[1],pts[2]),r=buildDrainBoard(f,G.dist(pts[0],pts[1]),v,shared);
  const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities)});
  ctx.toast(`배수판 ${v.name||''} 길이 ${Math.round(G.dist(pts[0],pts[1]))} · 높이 ${Math.round(r.height)} · ${r.single?'단선':'판두께 '+v.plateThickness} · Ctrl+Z 로 되돌리기`);
  return ids;
 }

 /* ── HGRID ── */
 async function hgridDraw(v,shared){
  let p1=null,p2=null;
  if(v.inputMode==='pick'){
   const e=await ctx.pickEntity({prompt:'바닥난방을 채울 닫힌 사각형을 고르세요 · Esc 중단',types:['rectangle','polyline']});
   if(!e)return null;
   const pts=e.points||[];
   if(pts.length<4)throw Error('닫힌 사각형(꼭짓점 4개)을 고르세요.');
   const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
   // 시작 위치는 사각형을 그린 순서를 따라간다(원문): 첫 꼭짓점이 1번 점, 그 대각이 2번 점.
   p1={x:Math.abs(pts[0].x-minX)<Math.abs(pts[0].x-maxX)?minX:maxX,y:Math.abs(pts[0].y-minY)<Math.abs(pts[0].y-maxY)?minY:maxY};
   p2={x:p1.x===minX?maxX:minX,y:p1.y===minY?maxY:minY};
  }else{
   const pv=(points,cursor)=>{const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];
    try{return buildHeatGrid(pts[0],pts[1],v,shared).entities.map(e=>({...e,previewColor:'#b5e48c'}));}catch{return [];}};
   const got=(await ctx.pickPath({prompt:`바닥난방 XL파이프 간격 ${v.spacing} · ① 시작 모서리 ② 마주 보는 모서리 · Esc 중단`,preview:pv,minPoints:2,maxPoints:2}))?.points;
   if(!got)return null;
   p1=got[0];p2=got[1];
  }
  const r=buildHeatGrid(p1,p2,v,shared);
  const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities)});
  ctx.toast(`바닥난방 파이프 ${Math.round(r.width)} × ${Math.round(r.depth)} · 간격 ${v.spacing} · Ctrl+Z 로 되돌리기`);
  return ids;
 }

 return {
  CTR:()=>{try{return openCtr();}catch(e){fail(e);}},
  DDB:()=>openCardDialog({ctx,title:'배수판 그리기 · DDB',storageKey:DDB_STORAGE_KEY,fields:DDB_FIELDS,sharedFields:DDB_SHARED_FIELDS,
   slots:DDB_PRESETS.length,fixedNames:[...DDB_NAMES],slotDefaults:ddbSlotDefaults,preview:(v,s,o)=>ddbPreviewSvg(v,s,o),
   validate:(v,s)=>{if(!(v.bottomLength+v.slopeLength+v.topLength+v.slopeLength>0))throw Error('상판·경사·하판 길이를 모두 0 으로 둘 수는 없습니다.');if(!s.screenHeight&&!(s.totalHeight>0))throw Error('전체높이는 0보다 커야 합니다.');},
   onGo:(v,s)=>ddbDraw(v,s),
   note:'시작점 → 끝 점 → 방향 순서로 세 점을 찍습니다(단열재그리기와 같은 체계). 길이는 5칸에 저장해 두고 골라 씁니다. 판두께 0 이면 단선으로 그립니다.'}),
  HGRID:()=>openCardDialog({ctx,title:'바닥난방 XL파이프 그리기 · HGRID',storageKey:HGRID_STORAGE_KEY,fields:HGRID_FIELDS,sharedFields:HGRID_SHARED_FIELDS,
   slots:3,fixedNames:['간격 200','간격 250','간격 300'],slotDefaults:i=>({spacing:[200,250,300][i]||200}),preview:(v,s,o)=>hgridPreviewSvg(v,s,o),
   onGo:(v,s)=>hgridDraw(v,s),
   note:'닫힌 사각형을 고르거나 마주 보는 두 점을 찍습니다. 파이프는 1번 점 모서리에서 감아 들어가 가운데에서 되돌아 나옵니다. 원문에는 간격을 묻는 칸이 없어(설정에서 읽음) 카드에서 받습니다.'}),
 };
}
