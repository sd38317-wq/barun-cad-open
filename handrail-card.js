// 난간 그리기 DHR (xiDrawHandrail) · izzarder.com/94 의 대화상자 항목과 그림을 그대로 옮겼다.
// 두 점(PT1·PT2)으로 기준선(바닥)을 찍으면 그 위로 입면 난간을 그린다. 원문대로 모든 간격은 중심선 간격이다.
import * as G from './geometry.js';
import {STD_LAYERS,entitiesSvg,openCardDialog,resolveLayers} from './card-kit.js';

export const HANDRAIL_KEY='barun-handrail-card';
export const ANCHOR_MIN_EXTEND=130;// 원문: 앵커고정을 켜면 하부연장이 130 보다 작을 때 130 으로 자동 변경

/* ── 대화상자 항목. 이름·기본값은 원문 /94 의 대화상자 캡처에서 그대로 읽었다. ── */
export const DHR_FIELDS=[
 {key:'height',label:'난간전체 높이 (mm)',type:'number',def:1200,min:1,step:10,group:'난간 · 손스침',hint:'바닥(기준선)에서 난간 최상단까지'},
 {key:'capThickness',label:'손스침 두께 (mm)',type:'number',def:60,min:1,step:5,group:'난간 · 손스침',hint:'1 을 넣으면 손스침을 한 선으로 그립니다.'},
 {key:'post',label:'엄지기둥',type:'check',def:true,group:'엄지기둥'},
 {key:'postSpacing',label:'간격 (mm)',type:'number',def:900,min:1,step:10,group:'엄지기둥',when:v=>v.post,hint:'등분하지 않고 입력한 절대 간격으로만 놓입니다.'},
 {key:'postThickness',label:'두께 (mm)',type:'number',def:20,min:1,step:1,group:'엄지기둥',when:v=>v.post},
 {key:'topRail',label:'상부 칸',type:'check',def:true,group:'상부 칸'},
 {key:'topGap',label:'간격 (mm)',type:'number',def:100,min:1,step:10,group:'상부 칸',when:v=>v.topRail,hint:'손스침 아랫면에서 상부 칸 중심까지'},
 {key:'topThickness',label:'두께 (mm)',type:'number',def:20,min:1,step:1,group:'상부 칸',when:v=>v.topRail},
 {key:'bottomRail',label:'하부 칸',type:'check',def:true,group:'하부 칸'},
 {key:'bottomGap',label:'간격 (mm)',type:'number',def:100,min:1,step:10,group:'하부 칸',when:v=>v.bottomRail,hint:'기준선에서 하부 칸 중심까지'},
 {key:'bottomThickness',label:'두께 (mm)',type:'number',def:20,min:1,step:1,group:'하부 칸',when:v=>v.bottomRail},
 {key:'baluster',label:'모양',type:'select',def:'vertical',options:[['vertical','수직살'],['horizontal','수평살'],['none','없음']],group:'난간 동자'},
 {key:'vSpacing',label:'수직살 간격 (mm)',type:'number',def:100,min:1,step:10,group:'난간 동자',when:v=>v.baluster==='vertical',hint:'입력값을 최대값으로 등분하므로 실제 간격은 늘 이보다 좁습니다.'},
 {key:'vThickness',label:'수직살 두께 (mm)',type:'number',def:10,min:1,step:1,group:'난간 동자',when:v=>v.baluster==='vertical'},
 {key:'hSpacing',label:'수평살 간격 (mm)',type:'number',def:100,min:1,step:10,group:'난간 동자',when:v=>v.baluster==='horizontal'},
 {key:'hThickness',label:'수평살 두께 (mm)',type:'number',def:10,min:1,step:1,group:'난간 동자',when:v=>v.baluster==='horizontal'},
 {key:'closeEnds',label:'양끝 막음',type:'check',def:true,group:'마무리',hint:'손스침·상부 칸·하부 칸·수평살의 양쪽 끝을 선으로 막습니다.'},
 {key:'trim',label:'손스침, 엄지기둥에 가려지는 선 자르기',type:'check',def:false,group:'마무리',hint:'켜면 난간 뒤에 있는 기존 벽선·폴리선도 손스침·엄지기둥 자리에서 잘려 나갑니다(원문 기본은 켬). 기존 선을 지키려면 끈 채로 두세요.'},
 {key:'extend',label:'하부연장',type:'check',def:true,group:'마무리'},
 {key:'extendLength',label:'연장길이 (mm)',type:'number',def:100,min:0,step:10,group:'마무리',when:v=>v.extend},
 {key:'anchor',label:'앵커고정',type:'check',def:false,group:'마무리',when:v=>v.post,hint:'엄지기둥이 있을 때만. 하부연장이 130 보다 작으면 130 으로 바뀝니다.'},
];
export const DHR_SHARED_FIELDS=[
 {key:'railLayer',label:'난간 켜',type:'layer',def:STD_LAYERS.stair,group:'켜 설정'},
];

/* ── 기준선 좌표계. s 는 PT1 에서 잰 기준선 방향 거리, h 는 기준선 위 높이. ── */
export function railFrame(p1,p2){
 const d=G.sub(p2,p1),width=G.len(d);
 if(width<G.EPS)throw Error('두 점은 서로 다른 점이어야 합니다.');
 const u=G.mul(d,1/width);
 let n=G.normal(u);
 if(n.y<-1e-9)n=G.mul(n,-1);// 오른쪽→왼쪽으로 찍어도 난간은 늘 위로 선다
 return {origin:{x:p1.x,y:p1.y},u,n,width};
}
export const railToWorld=(f,s,h)=>G.add(f.origin,G.add(G.mul(f.u,s),G.mul(f.n,h)));
export const railToLocal=(f,p)=>{const v=G.sub(p,f.origin);return {s:G.dot(v,f.u),h:G.dot(v,f.n)};};

/** 앵커고정을 켜면 하부연장을 130 이상으로 올린다(원문). 엄지기둥이 없으면 앵커고정은 없는 것으로 본다. */
export function resolvedExtend(v){
 const len=v.extend?Math.max(0,Number(v.extendLength)||0):0;
 return (v.post&&v.anchor)?Math.max(ANCHOR_MIN_EXTEND,len):len;
}

/** 원문의 "입력 간격을 최대값으로 하는 등분". span 은 안쪽 순거리, thickness 는 살 두께.
 *  n = 칸 수, gap = 안목간격(살과 살의 안쪽 폭), pitch = 중심선 간격, centers 는 span 시작점에서 잰 살 중심. */
export function divideMax(span,thickness,maxPitch){
 if(!(span>0)||!(maxPitch>0))return {n:0,count:0,pitch:0,gap:0,centers:[]};
 const n=Math.max(1,Math.ceil((span+thickness)/maxPitch-1e-9)),pitch=(span+thickness)/n,gap=pitch-thickness;
 if(gap<=0)return {n,count:0,pitch,gap,centers:[]};
 return {n,count:n-1,pitch,gap,centers:Array.from({length:n-1},(_,i)=>(i+1)*pitch-thickness/2)};
}

/** 엄지기둥 중심. 원문대로 등분하지 않고 입력 간격 그대로 놓되, 남는 거리는 양 끝에 반씩 둔다. */
export function postCenters(width,spacing,thickness){
 if(!(width>0)||!(spacing>0))return [];
 const k=Math.floor(width/spacing+1e-9);
 if(k<1)return [width/2];
 const margin=(width-k*spacing)/2;
 return Array.from({length:k+1},(_,j)=>margin+j*spacing);
}

/** 수직살(난간동자) 중심. 엄지기둥이 있으면 기둥 사이 순거리를 등분한 간격을 난간 전체에 이어 쓰고,
 *  없으면 입력 간격 그대로 쓰며 남는 거리를 양 끝에 반씩 나눈다. */
export function verticalBalusterCenters(width,v,posts=[],postThickness=0){
 const t=Math.max(0,Number(v.vThickness)||0),max=Math.max(0,Number(v.vSpacing)||0);
 if(!(width>0)||!(max>0))return {centers:[],gap:0,pitch:0};
 if(!posts.length){
  const m=Math.floor((width-t)/max+1e-9)+1;
  if(m<1)return {centers:[],gap:max-t,pitch:max};
  const margin=(width-((m-1)*max+t))/2;
  return {centers:Array.from({length:m},(_,j)=>margin+t/2+j*max),gap:max-t,pitch:max};
 }
 const half=postThickness/2,d=divideMax(v.postSpacing-postThickness,t,max);
 if(!(d.gap>0))return {centers:[],gap:d.gap,pitch:d.pitch};
 const first=half+d.gap+t/2,out=[];
 const okay=c=>c-t/2>=-1e-6&&c+t/2<=width+1e-6&&posts.every(pc=>Math.abs(c-pc)>=half+t/2-1e-6);
 for(const pc of posts){
  for(let c=pc+first;c<=width+t;c+=d.pitch){if(!okay(c))break;out.push(c);}
  for(let c=pc-first;c>=-t;c-=d.pitch){if(!okay(c))break;out.push(c);}
 }
 const centers=[...new Set(out.map(c=>Math.round(c*1000)/1000))].sort((a,b)=>a-b);
 return {centers,gap:d.gap,pitch:d.pitch};
}

/** 높이 값 정리. 손스침 두께 1 이하는 한 선, 상·하부 칸은 중심 기준이다. 값이 안 맞으면 한국어로 던진다. */
export function railLevels(v){
 const H=Number(v.height),ct=Number(v.capThickness);
 if(!(H>0))throw Error('난간전체 높이는 0 보다 커야 합니다.');
 const single=ct<=1,capBottom=single?H:H-ct;
 if(capBottom<=0)throw Error('손스침 두께가 난간전체 높이보다 큽니다. 손스침 두께를 줄이세요.');
 const out={H,capTop:H,capBottom,single,ext:resolvedExtend(v)};
 if(v.topRail){
  const c=capBottom-v.topGap,t=v.topThickness;
  if(c-t/2<=0||c+t/2>capBottom+1e-9)throw Error('상부 칸이 손스침 아래에 들어가지 않습니다. 상부 칸 간격·두께를 줄이세요.');
  out.top={c,t,lo:c-t/2,hi:c+t/2};
 }
 if(v.bottomRail){
  const c=v.bottomGap,t=v.bottomThickness;
  if(c-t/2<0)throw Error('하부 칸이 기준선 아래로 내려갑니다. 하부 칸 간격을 키우세요.');
  out.bottom={c,t,lo:c-t/2,hi:c+t/2};
 }
 out.inTop=out.top?out.top.lo:capBottom;
 out.inBottom=out.bottom?out.bottom.hi:0;
 if(out.inTop-out.inBottom<=0)throw Error('상부 칸과 하부 칸 사이에 난간 동자가 들어갈 자리가 없습니다.');
 return out;
}

/* ── 가려지는 선 자르기. 손스침 띠와 엄지기둥 띠 안쪽에 든 구간을 빼낸다(기준선 좌표계에서 판정). ── */
function insideInterval(a,b,r,tol=1e-7){
 let t0=0,t1=1;
 const clip=(p,q)=>{if(Math.abs(p)<1e-12)return q>=0;const t=q/p;if(p<0){if(t>t1)return false;if(t>t0)t0=t;}else{if(t<t0)return false;if(t<t1)t1=t;}return true;};
 const ds=b.s-a.s,dh=b.h-a.h,s0=r.s0+tol,s1=r.s1-tol,h0=r.h0-tol,h1=r.h1+tol;
 if(s1<=s0)return null;
 if(!clip(-ds,a.s-s0)||!clip(ds,s1-a.s)||!clip(-dh,a.h-h0)||!clip(dh,h1-a.h))return null;
 return t1-t0<1e-9?null:[t0,t1];
}
/** 한 구간에서 살아남는 매개변수 구간 목록. 통째로 남으면 [[0,1]]. */
export function keepIntervals(a,b,rects){
 const cuts=[];
 for(const r of rects||[]){const iv=insideInterval(a,b,r);if(iv)cuts.push(iv);}
 if(!cuts.length)return [[0,1]];
 cuts.sort((x,y)=>x[0]-y[0]);
 const merged=[cuts[0].slice()];
 for(const c of cuts.slice(1)){const last=merged.at(-1);if(c[0]<=last[1]+1e-9)last[1]=Math.max(last[1],c[1]);else merged.push(c.slice());}
 const keep=[];let at=0;
 for(const [t0,t1] of merged){if(t0-at>1e-9)keep.push([at,t0]);at=Math.max(at,t1);}
 if(1-at>1e-9)keep.push([at,1]);
 return keep;
}
const lerpPt=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const lerpLocal=(a,b,t)=>({s:a.s+(b.s-a.s)*t,h:a.h+(b.h-a.h)*t});
/** 기준선 좌표계 경로를 띠로 잘라 여러 조각으로 나눈다. */
export function clipLocalPath(pts,closed,rects){
 const seq=closed?[...pts,pts[0]]:pts,pieces=[];let cur=null,touched=false;
 const flush=()=>{if(cur&&cur.length>=2)pieces.push(cur);cur=null;};
 for(let i=0;i<seq.length-1;i++){
  const A={s:seq[i][0],h:seq[i][1]},B={s:seq[i+1][0],h:seq[i+1][1]},keep=keepIntervals(A,B,rects);
  if(keep.length!==1||keep[0][0]>1e-9||keep[0][1]<1-1e-9)touched=true;
  if(!keep.length){flush();continue;}
  for(const [t0,t1] of keep){
   const P=lerpLocal(A,B,t0),Q=lerpLocal(A,B,t1);
   if(t0>1e-9)flush();
   if(!cur)cur=[[P.s,P.h]];
   cur.push([Q.s,Q.h]);
   if(t1<1-1e-9)flush();
  }
 }
 flush();
 if(closed&&!touched)return [{pts,closed:true}];
 if(closed&&pieces.length>1){
  const first=pieces[0],last=pieces.at(-1);
  if(Math.abs(first[0][0]-last.at(-1)[0])<1e-9&&Math.abs(first[0][1]-last.at(-1)[1])<1e-9){pieces.pop();pieces[0]=[...last,...first.slice(1)];}
 }
 return pieces.map(p=>({pts:p,closed:false}));
}
/** 이미 그려져 있는 객체 중 손스침·엄지기둥에 가려지는 구간을 잘라낸다. */
export function trimByBlockers(entities,f,rects){
 const removeIds=[],add=[];
 if(!rects?.length)return {removeIds,add};
 for(const e of entities||[]){
  if(!['line','polyline','rectangle'].includes(e.type)||e.hidden)continue;
  if(!Array.isArray(e.points)||e.points.length<2)continue;
  if(e.bulges?.some(b=>b))continue;
  const closed=e.type==='rectangle'||!!e.closed,seq=closed?[...e.points,e.points[0]]:e.points;
  const pieces=[];let cur=null,touched=false;
  const flush=()=>{if(cur&&cur.length>=2)pieces.push(cur);cur=null;};
  for(let i=0;i<seq.length-1;i++){
   const A=seq[i],B=seq[i+1],keep=keepIntervals(railToLocal(f,A),railToLocal(f,B),rects);
   if(keep.length!==1||keep[0][0]>1e-9||keep[0][1]<1-1e-9)touched=true;
   if(!keep.length){flush();continue;}
   for(const [t0,t1] of keep){
    const P=lerpPt(A,B,t0),Q=lerpPt(A,B,t1);
    if(t0>1e-9)flush();
    if(!cur)cur=[P];
    cur.push(Q);
    if(t1<1-1e-9)flush();
   }
  }
  flush();
  if(!touched)continue;
  removeIds.push(e.id);
  const {id,points:_p,closed:_c,type:_t,...rest}=e;
  for(const p of pieces)add.push(p.length===2?{...rest,type:'line',points:p}:{...rest,type:'polyline',closed:false,points:p});
 }
 return {removeIds,add};
}

/* ── 난간 부재 만들기(기준선 좌표계). blocker 인 부재(손스침·엄지기둥)는 자르지 않는다. ── */
export function handrailMembers(width,v){
 const W=width,lv=railLevels(v);
 if(!(W>0))throw Error('난간 길이가 0 입니다. 서로 다른 두 점을 찍으세요.');
 const pt=v.post?v.postThickness:0,posts=v.post?postCenters(W,v.postSpacing,pt):[];
 const members=[],blockers=[];
 const add=(pts,o={})=>{members.push({pts,closed:!!o.closed,blocker:!!o.blocker,kind:o.kind||'',...(o.circleRadius?{circleRadius:o.circleRadius}:{})});};
 const band=(lo,hi,kind)=>{
  add([[0,hi],[W,hi]],{kind});add([[0,lo],[W,lo]],{kind});
  if(v.closeEnds){add([[0,lo],[0,hi]],{kind});add([[W,lo],[W,hi]],{kind});}
 };
 add([[0,0],[W,0]],{kind:'base'});// 기준선(바닥). 원문 그림의 PT1–PT2 선
 if(lv.single)add([[0,lv.capTop],[W,lv.capTop]],{kind:'cap'});
 else{
  if(v.closeEnds)add([[0,lv.capBottom],[W,lv.capBottom],[W,lv.capTop],[0,lv.capTop]],{closed:true,kind:'cap',blocker:true});
  else{add([[0,lv.capTop],[W,lv.capTop]],{kind:'cap',blocker:true});add([[0,lv.capBottom],[W,lv.capBottom]],{kind:'cap',blocker:true});}
  blockers.push({s0:0,s1:W,h0:lv.capBottom,h1:lv.capTop});
 }
 const postTop=lv.capBottom,postBottom=-lv.ext;
 for(const c of posts){
  add([[c-pt/2,postTop],[c-pt/2,postBottom],[c+pt/2,postBottom],[c+pt/2,postTop]],{kind:'post',blocker:true});
  blockers.push({s0:c-pt/2,s1:c+pt/2,h0:postBottom,h1:postTop});
 }
 if(lv.top)band(lv.top.lo,lv.top.hi,'toprail');
 if(lv.bottom)band(lv.bottom.lo,lv.bottom.hi,'bottomrail');
 const info={posts:posts.length,postCenters:posts,balusters:0,gap:0,pitch:0,extend:lv.ext,levels:lv};
 if(v.baluster==='vertical'){
  const r=verticalBalusterCenters(W,v,posts,pt),t=v.vThickness;
  // 원문: 엄지기둥이 없을 때만 수직살 자체가 기준선 아래로 연장된다.
  const bottom=(!v.post&&lv.ext>0)?-lv.ext:lv.inBottom;
  for(const c of r.centers){add([[c-t/2,lv.inTop],[c-t/2,bottom]],{kind:'baluster'});add([[c+t/2,lv.inTop],[c+t/2,bottom]],{kind:'baluster'});}
  Object.assign(info,{balusters:r.centers.length,gap:r.gap,pitch:r.pitch,balusterCenters:r.centers});
 }else if(v.baluster==='horizontal'){
  const t=v.hThickness,d=divideMax(lv.inTop-lv.inBottom,t,v.hSpacing);
  for(const c of d.centers){const y=lv.inBottom+c;band(y-t/2,y+t/2,'baluster');}
  Object.assign(info,{balusters:d.centers.length,gap:d.gap,pitch:d.pitch,balusterCenters:d.centers.map(c=>lv.inBottom+c)});
 }
 if(v.post&&v.anchor)for(const c of posts)for(const m of anchorPlate(c,pt,lv.ext))add(m.pts,m);
 return {members,blockers,info,levels:lv,width:W,posts};
}
/** 앵커고정 판. 원문에 치수 칸이 없어 /94 그림(기둥 20 · 하부연장 130)에서 재어 비례로 옮겼다. */
export function anchorPlate(center,postThickness,ext){
 const half=postThickness/2+45,top=-25,bottom=-Math.max(ANCHOR_MIN_EXTEND,ext),h=top-bottom;
 const bolt=Math.max(2,h*0.07),bx=postThickness/2+22.5;
 const out=[{pts:[[center-half,top],[center+half,top],[center+half,bottom],[center-half,bottom]],closed:true,kind:'anchor'}];
 for(const sx of [-1,1])for(const k of [0.25,0.75])out.push({circle:true,center:[center+sx*bx,top-h*k],radius:bolt,kind:'anchor'});
 return out.map(m=>m.circle?{pts:[[m.center[0],m.center[1]]],closed:false,kind:'anchor',circleRadius:m.radius}:m);
}

/** 난간 객체(세계 좌표). trim 이 켜져 있으면 난간 자신의 선도 손스침·엄지기둥에서 잘린다. */
export function buildHandrail(p1,p2,v,shared){
 const f=railFrame(p1,p2),L=shared?.railLayer||STD_LAYERS.stair;
 const r=handrailMembers(f.width,v),out=[];
 for(const m of r.members){
  if(m.circleRadius){out.push({type:'circle',center:railToWorld(f,m.pts[0][0],m.pts[0][1]),radius:m.circleRadius,cardLayer:L});continue;}
  const parts=(v.trim&&!m.blocker)?clipLocalPath(m.pts,m.closed,r.blockers):[{pts:m.pts,closed:m.closed}];
  for(const part of parts){
   if(part.pts.length<2)continue;
   const pts=part.pts.map(([s,h])=>railToWorld(f,s,h));
   out.push(pts.length===2&&!part.closed?{type:'line',points:pts,cardLayer:L}:{type:'polyline',closed:!!part.closed,points:pts,cardLayer:L});
  }
 }
 return {frame:f,entities:out,blockers:r.blockers,info:r.info,levels:r.levels};
}

export function handrailPreviewSvg(v,shared,opts={}){
 const W=v.post?v.postSpacing*2+200:1800;
 let r;
 try{r=buildHandrail({x:0,y:0},{x:W,y:0},v,shared||{});}
 catch(e){return entitiesSvg([],{label:e.message,...opts});}
 const g=r.info.gap?` · 안목간격 ${r.info.gap.toFixed(2)}`:'';
 return entitiesSvg(r.entities,{label:opts.compact?'':`난간 ${v.height} · 손스침 ${v.capThickness}${v.post?` · 엄지기둥 ${r.info.posts}개(${v.postSpacing})`:''}${g}`,...opts});
}

export function installHandrailCard(ctx){
 async function draw(v,shared){
  const previewOf=(points,cursor)=>{
   const pts=cursor?[...points,cursor]:points;
   if(pts.length<2)return [];
   try{return buildHandrail(pts[0],pts[1],v,shared).entities.map(e=>({...e,previewColor:'#ffd479'}));}catch{return [];}
  };
  const path=await ctx.pickPath({prompt:'난간 입면 · ① 기준선(바닥) 첫째 점 PT1 ② 둘째 점 PT2 · Esc 중단',preview:previewOf,minPoints:2,maxPoints:2});
  if(!path)return null;
  const r=buildHandrail(path.points[0],path.points[1],v,shared);
  const cut=v.trim?trimByBlockers(ctx.entities(),r.frame,r.blockers):{removeIds:[],add:[]};
  const ids=ctx.commit({removeIds:cut.removeIds,entities:resolveLayers(ctx,[...r.entities,...cut.add])});
  const g=r.info.gap?` · 안목간격 ${r.info.gap.toFixed(2)}`:'';
  ctx.toast(`난간 ${Math.round(r.frame.width)} mm · 엄지기둥 ${r.info.posts}개 · 난간동자 ${r.info.balusters}개${g}${cut.removeIds.length?` · 가려진 선 ${cut.removeIds.length}개 정리`:''} · 방금 그린 것이 선택되어 있습니다 · Ctrl+Z 로 되돌리기`);
  return ids;
 }
 return {
  DHR:()=>openCardDialog({
   ctx,title:'난간 그리기 · DHR',storageKey:HANDRAIL_KEY,fields:DHR_FIELDS,sharedFields:DHR_SHARED_FIELDS,slots:4,fixedNames:['DHR 기본'],
   preview:(v,s,o)=>handrailPreviewSvg(v,s,o),
   validate:v=>{railLevels(v);},
   onGo:(v,s)=>draw(v,s),
   note:'두 점: ① 기준선(바닥)의 PT1 → ② PT2. 난간은 그 선 위로 입면으로 그려집니다. 모든 간격은 중심선 간격입니다. 바른 CAD 에는 그룹이 없어 원문의 무명그룹 대신 그린 직후 선택 상태로 둡니다.',
  }),
 };
}
