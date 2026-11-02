// 커튼월 창호 그리기 카드 CW(xiCWALL). izzarder.com/164 의 대화상자 항목·조작 순서·그림을 그대로 옮겼다.
// 조작: ① 시작점(외부에서 볼 때 왼쪽) ② 끝점 ③ 호의 중간 임의점(Enter 로 생략하면 직선) → 등분 간격 확인 → 작도.
// 원문대로 벽체는 자동으로 자르지 않는다(창호가 들어갈 자리는 사용자가 미리 만들어 둔다).
import * as G from './geometry.js';
import {STD_LAYERS,entitiesSvg,openCardDialog,loadCardState,saveCardState,resolveLayers,normalizeValues} from './card-kit.js';

export const CURTAINWALL_STORAGE_KEY='barun-curtainwall-card';
export const CURTAINWALL_SLOTS=4;
export const CURTAINWALL_FIXED_NAMES=['CW 커튼월','CW 고정창'];

export const CURTAINWALL_FIELDS=[
 {key:'runMode',label:'실행 방식',type:'select',def:'dialog',options:[['dialog','대화상자 먼저'],['command','명령입력 먼저 (창 없이 등분 갯수만 묻고 점 입력)']],group:'실행 방식'},
 {key:'kind',label:'창호 형식',type:'select',def:'curtain',options:[['curtain','커튼월'],['fixed','고정창']],group:'창호 형식'},
 {key:'divisions',label:'전체 길이 등분 갯수',type:'number',def:6,min:1,max:200,step:1,group:'창호 형식',hint:'크게 넣어도 점을 찍은 뒤 간격을 보여주며 다시 물어봅니다.'},
 {key:'barBase',label:'바 삽입 기준',type:'select',def:'inside',options:[['inside','선택 점 안쪽에 삽입'],['on','선택 점에 삽입 (찍은 점에 바 중간)']],group:'창호 형식'},
 {key:'barWidth',label:'바 크기 · 가로 (mm)',type:'number',def:60,min:5,step:5,group:'바 크기 · CAP 크기'},
 {key:'barDepth',label:'바 크기 · 세로 (mm)',type:'number',def:150,min:10,step:5,group:'바 크기 · CAP 크기'},
 {key:'cap',label:'CAP 표현 있음 (커튼월에서만 작동)',type:'check',def:true,group:'바 크기 · CAP 크기',when:v=>v.kind==='curtain'},
 {key:'capWidth',label:'CAP 크기 · 가로 (mm)',type:'number',def:60,min:1,step:5,group:'바 크기 · CAP 크기',when:v=>v.kind==='curtain'&&v.cap},
 {key:'capDepth',label:'CAP 크기 · 세로 (mm)',type:'number',def:30,min:1,step:5,group:'바 크기 · CAP 크기',when:v=>v.kind==='curtain'&&v.cap},
 {key:'glass',label:'유리 두께 (mm · 0 이면 유리 미표현)',type:'number',def:24,min:0,step:1,group:'유리 · 곡면 · 반복'},
 {key:'curveGlassStraight',label:'곡면일 때 유리는 직선으로 표현',type:'check',def:false,group:'유리 · 곡면 · 반복'},
 {key:'curveBarStraight',label:'곡면일 때 바도 직선으로 표현',type:'check',def:false,group:'유리 · 곡면 · 반복',hint:'바 사이를 잇는 입면선을 호 대신 직선(현)으로 긋습니다.'},
 {key:'recycle',label:'입력 후 재 순환 (Esc 까지 계속 그리기)',type:'check',def:false,group:'유리 · 곡면 · 반복'},
];
export const CURTAINWALL_SHARED_FIELDS=[
 {key:'barLayer',label:'바 켜 (원문 WINBAR)',type:'layer',def:STD_LAYERS.glaz,group:'켜 설정 (칸 공통)'},
 {key:'glassLayer',label:'유리 켜 (원문 WINGLASS)',type:'layer',def:STD_LAYERS.glaz,group:'켜 설정 (칸 공통)'},
 {key:'elevLayer',label:'입면선 켜 (원문 WINELE)',type:'layer',def:STD_LAYERS.glaz,group:'켜 설정 (칸 공통)'},
];
export const curtainSlotDefaults=i=>i===1?{kind:'fixed',cap:false,divisions:4}:{};

const near=(a,b)=>Math.abs(a[0]-b[0])<1e-9&&Math.abs(a[1]-b[1])<1e-9;
/** 이어진 같은 점 지우기(유리 두께 0 처럼 단면이 겹칠 때 생긴다). */
export function dedupe(points){
 const out=[];for(const p of points)if(!out.length||!near(out[out.length-1],p))out.push(p);
 while(out.length>1&&near(out[0],out[out.length-1]))out.pop();
 return out;
}

/** 바 단면. 바 중간을 원점으로 한 국부 좌표 [s(벽 방향), d(실내측 면 0 → 실외 쪽)] 닫힌 윤곽.
 *  커튼월 바는 유리가 물리는 자리에서 목이 좁아지고, CAP 을 켜면 유리 바깥에 캡 바가 붙는다(원문 그림). */
export function barProfile(v){
 const w=v.barWidth/2,D=v.barDepth,g=Math.max(0,v.glass);
 if(v.kind==='fixed')return dedupe([[-w,0],[w,0],[w,D],[-w,D]]);
 const dg1=Math.max(0,D-g),dg0=Math.max(0,D-2*g),n=g>0?Math.min(w,v.barWidth/6):w,cw=Math.max(.5,v.capWidth/2);
 const pts=[[-w,0],[w,0],[w,dg0],[n,dg0],[n,dg1]];
 if(v.cap)pts.push([cw,dg1],[cw,dg1+v.capDepth],[-cw,dg1+v.capDepth],[-cw,dg1]);
 else pts.push([w,dg1],[w,D],[-w,D],[-w,dg1]);
 pts.push([-n,dg1],[-n,dg0],[-w,dg0]);
 return dedupe(pts);
}
/** 유리 두 면의 깊이 [안쪽,바깥쪽]. 유리 두께 0 이면 null.
 *  커튼월은 바 바깥면 쪽에 물리고(원문 그림에서 잰 자리), 고정창은 두께 한가운데다. */
export function glassBand(v){
 const g=Math.max(0,v.glass),D=v.barDepth;
 if(g<=0)return null;
 return v.kind==='fixed'?[D/2-g/2,D/2+g/2]:[Math.max(0,D-2*g),Math.max(0,D-g)];
}
/** 바 중간의 위치(시작점에서 잰 길이). 바 삽입 기준이 "선택 점 안쪽"이면 양끝 바를 반 폭씩 안으로 넣는다. */
export function barCenters(v,length){
 const n=Math.max(1,Math.round(v.divisions));
 if(!(length>0))throw Error('시작점과 끝점이 같습니다. 서로 다른 두 점을 찍으세요.');
 const step=length/n;
 if(step<=v.barWidth)throw Error(`등분 간격 ${Math.round(step)}mm 가 바 가로 ${v.barWidth}mm 보다 좁습니다. 등분 갯수를 줄이세요.`);
 const centers=[];for(let i=0;i<=n;i++)centers.push(i*step);
 if(v.barBase==='inside'){centers[0]+=v.barWidth/2;centers[n]-=v.barWidth/2;}
 return {centers,step,divisions:n};
}
/** 길게 이어 긋는 선(입면선·유리)의 마디. 고정창은 양끝 바 안쪽면에서, 커튼월 유리는 양끝 바 중간에서 시작한다. */
export function runStations(v,centers,role){
 const w=v.barWidth/2,s=[...centers];
 if(role==='elev'||v.kind==='fixed'){s[0]+=w;s[s.length-1]-=w;}
 return s;
}

/** 직선 커튼월. p1 시작점(외부에서 볼 때 왼쪽) · p2 끝점. 실외는 p1→p2 의 오른쪽(시계반대방향 원칙). */
export function buildStraightCurtainWall(p1,p2,v,shared){
 const length=G.dist(p1,p2),{centers,step,divisions}=barCenters(v,length);
 const u=G.unit(G.sub(p2,p1)),ne=G.mul(G.normal(u),-1),P=(s,d)=>G.add(p1,G.add(G.mul(u,s),G.mul(ne,d)));
 const entities=barEntities(v,shared,centers,(c,s,d)=>P(c+s,d)),band=glassBand(v);
 const run=(role,d,layer,color)=>{const s=runStations(v,centers,role);entities.push({type:'line',points:[P(s[0],d),P(s[s.length-1],d)],cardLayer:layer,previewColor:color});};
 if(band)for(const d of band)run('glass',d,shared.glassLayer,'#7ee787');
 for(const d of v.kind==='fixed'?[0,v.barDepth]:[0])run('elev',d,shared.elevLayer,'#d0d0d0');
 return {entities,length,step,divisions,curved:false};
}

/** 세 점으로 만든 호의 진행 정보. sign 은 실외가 원 바깥(+1)인지 안(−1)인지다. */
export function arcRun(p1,m,p2){
 const arc=G.arcThrough(p1,m,p2),C=arc.center,R=arc.radius;
 const a1=G.angle(G.sub(p1,C)),a2=G.angle(G.sub(p2,C)),am=G.angle(G.sub(m,C));
 const ccw=G.normalizeAngle(am-a1)<G.normalizeAngle(a2-a1);
 const sweep=ccw?G.normalizeAngle(a2-a1):-G.normalizeAngle(a1-a2);
 if(!sweep)throw Error('시작점과 끝점이 같습니다. 서로 다른 두 점을 찍으세요.');
 const dir=Math.sign(sweep),r0=G.polar(1,a1),t0=G.mul(G.normal(r0),dir);
 const sign=G.dot({x:t0.y,y:-t0.x},r0)>0?1:-1;
 return {center:C,radius:R,a1,sweep,sign,length:Math.abs(sweep)*Math.PI/180*R};
}
/** 곡면 커튼월. 세번째 점 m 은 호의 중간점이다(원문). 바는 언제나 곧은 막대이고 호를 따라 방사로 선다. */
export function buildCurvedCurtainWall(p1,p2,m,v,shared){
 const run=arcRun(p1,m,p2),{centers,step,divisions}=barCenters(v,run.length);
 const deep=v.barDepth+(v.kind==='curtain'&&v.cap?v.capDepth:0);
 if(run.sign<0&&run.radius<=deep)throw Error('호의 반지름이 창호 깊이보다 작습니다. 더 완만한 호를 지정하세요.');
 const dir=Math.sign(run.sweep),ang=s=>run.a1+run.sweep*(s/run.length);
 const frame=s=>{const r=G.polar(1,ang(s));return {o:G.add(run.center,G.mul(r,run.radius)),u:G.mul(G.normal(r),dir),n:G.mul(r,run.sign)};};
 const at=(c,s,d)=>{const f=frame(c);return G.add(f.o,G.add(G.mul(f.u,s),G.mul(f.n,d)));};
 const entities=barEntities(v,shared,centers,at),band=glassBand(v);
 const chord=(s,d)=>at(s,0,d);
 const run1=(role,d,layer,color,straight)=>{
  const st=runStations(v,centers,role);
  if(straight){for(let i=0;i<st.length-1;i++)entities.push({type:'line',points:[chord(st[i],d),chord(st[i+1],d)],cardLayer:layer,previewColor:color});return;}
  const rr=run.radius+run.sign*d,ta=ang(st[0]),tb=ang(st[st.length-1]);
  entities.push({type:'arc',center:run.center,radius:rr,startAngle:G.normalizeAngle(dir>0?ta:tb),endAngle:G.normalizeAngle(dir>0?tb:ta),cardLayer:layer,previewColor:color});
 };
 if(band)for(const d of band)run1('glass',d,shared.glassLayer,'#7ee787',v.curveGlassStraight);
 for(const d of v.kind==='fixed'?[0,v.barDepth]:[0])run1('elev',d,shared.elevLayer,'#d0d0d0',v.curveBarStraight);
 return {entities,length:run.length,step,divisions,curved:true,radius:run.radius,center:run.center};
}
function barEntities(v,shared,centers,at){
 const prof=barProfile(v);
 return centers.map(c=>({type:'polyline',closed:true,points:prof.map(([s,d])=>at(c,s,d)),cardLayer:shared.barLayer,previewColor:'#6ec6ff'}));
}
/** 찍은 점으로 커튼월을 만든다. 점이 둘이면 직선, 셋이면 곡면(셋째가 호의 중간점). */
export function buildCurtainWall(points,v,shared){
 if(!points||points.length<2)throw Error('시작점과 끝점을 찍으세요.');
 return points.length>=3?buildCurvedCurtainWall(points[0],points[1],points[2],v,shared):buildStraightCurtainWall(points[0],points[1],v,shared);
}

export function curtainWallPreviewSvg(v,shared,opts={}){
 const n=Math.max(1,Math.round(v.divisions)),L=n*Math.max(800,v.barWidth*3);
 const r=buildStraightCurtainWall({x:0,y:0},{x:L,y:0},v,shared);
 const stub=Math.max(300,L*.1),D=v.barDepth;
 const wall=[[-stub,0],[L,L+stub]].flatMap(([a,b])=>[0,D].map(d=>({type:'line',points:[{x:a,y:-d},{x:b,y:-d}],cardLayer:'A-WALL',previewColor:'#6b7280'})));
 const label=`${v.kind==='fixed'?'고정창':'커튼월'} ${n}등분 · 바 ${v.barWidth}×${v.barDepth}${v.kind==='curtain'&&v.cap?` · CAP ${v.capWidth}×${v.capDepth}`:''} · 유리 ${v.glass||'없음'} · 아래가 실외 · 벽체는 자르지 않습니다`;
 return entitiesSvg([...wall,...r.entities],{label:opts.compact?'':label,...opts});
}

export function installCurtainWallCard(ctx){
 /** 원문의 "<n등분 간격 : 717.21mm> / 새 등분수 입력 <엔터=확정>" 자리. 창을 닫으면 명령을 그만둔다. */
 const askDivisions=(n,step)=>new Promise(resolve=>{
  let done=false;const settle=x=>{if(done)return;done=true;resolve(x);};
  ctx.askNumber({title:`${n}등분 간격 : ${Math.round(step*100)/100}mm`,label:'새 등분수 입력 · 그대로 두고 [적용] 하면 확정'},x=>settle(Math.max(1,Math.round(x))));
  const dialog=typeof document!=='undefined'?document.getElementById('form-dialog'):null;
  if(dialog){
   const input=dialog.querySelector('#form-fields input');if(input)input.value=String(n);
   dialog.addEventListener('close',()=>setTimeout(()=>settle(null),0),{once:true});
  }
 });
 async function draw(values,shared){
  let v=values;
  for(;;){
   const previewOf=(points,cursor)=>{
    const pts=cursor?[...points,cursor]:points;
    if(pts.length<2)return [];
    try{return buildCurtainWall(pts.slice(0,3),v,shared).entities;}
    catch{return [{type:'line',points:[pts[0],pts[1]],previewColor:'#6ec6ff'}];}
   };
   const path=await ctx.pickPath({prompt:`커튼월 [${v.name}] ${v.divisions}등분 · ① 시작점 (외부에서 볼 때 왼쪽) ② 끝점 ③ 호의 중간 임의점 · Enter = 셋째 점 생략(직선) · Esc 중단`,preview:previewOf,minPoints:2,maxPoints:3});
   if(!path)return null;
   let built;
   try{built=buildCurtainWall(path.points,v,shared);}
   catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);if(v.recycle)continue;return null;}
   const n=await askDivisions(built.divisions,built.step);
   if(n===null)return null;
   try{
    if(n!==built.divisions){v={...v,divisions:n};built=buildCurtainWall(path.points,v,shared);}
    const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,built.entities)});
    ctx.toast(`${built.curved?'곡면 ':''}${v.kind==='fixed'?'고정창':'커튼월'} [${v.name}] ${built.divisions}등분 · 한 칸 ${Math.round(built.step*100)/100}mm · 객체 ${ids.length}개 · Ctrl+Z 로 되돌리기`);
    if(!v.recycle)return ids;
   }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);if(!v.recycle)return null;}
  }
 }
 function open({forceDialog=false}={}){
  const cfg={fields:CURTAINWALL_FIELDS,sharedFields:CURTAINWALL_SHARED_FIELDS,slots:CURTAINWALL_SLOTS,fixedNames:CURTAINWALL_FIXED_NAMES,slotDefaults:curtainSlotDefaults};
  const state=loadCardState(ctx.storage,CURTAINWALL_STORAGE_KEY,cfg),select=state.selected,preset=state.presets[select];
  if(!forceDialog&&preset.runMode==='command'){
   ctx.askNumber({title:`${preset.name} · 전체 길이 등분 갯수`,label:'등분 갯수 · Enter 로 진행',value:preset.divisions,settings:()=>open({forceDialog:true})},async d=>{
    const v=normalizeValues(CURTAINWALL_FIELDS,{...preset,divisions:Math.max(1,Math.round(d))},preset.name);
    state.presets[select]=v;saveCardState(ctx.storage,CURTAINWALL_STORAGE_KEY,state);
    try{await draw(v,state.shared);}catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
   });
   return;
  }
  openCardDialog({ctx,title:'커튼월 창호 그리기 · CW (계획도면)',storageKey:CURTAINWALL_STORAGE_KEY,...cfg,select,
   preview:(v,shared,o)=>curtainWallPreviewSvg(v,shared,o),
   validate:v=>{
    if(v.kind==='curtain'&&v.cap&&v.capDepth<=0)throw Error('CAP 세로는 0 보다 커야 합니다.');
    if(v.kind==='curtain'&&v.glass*2>v.barDepth)throw Error('유리 두께의 두 배가 바 세로보다 큽니다. 바 세로를 키우거나 유리를 얇게 하세요.');
   },
   onGo:(v,shared)=>draw(v,shared),
   note:'점 순서: ① 시작점(외부에서 볼 때 왼쪽) → ② 끝점 → ③ 호의 중간 임의점. 셋째 점을 Enter 로 생략하면 직선, 찍으면 곡면 커튼월입니다. 내외부를 구분하는 명령이라 바른 CAD 리습 와 같이 시계반대방향으로 찍습니다. 벽체는 자르지 않으니 창호가 들어갈 자리는 미리 만들어 두세요.'});
 }
 return {CW:()=>open()};
}
