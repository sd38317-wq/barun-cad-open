import {standardLayerForName} from './layer-standards.js';
// 4차 구조 배근·형강 카드 셋. 원문 대화상자 그림(글 안의 그룹 캡처)을 그대로 옮겼다.
//  CLI 기둥 배근도 그리기(xiColumnList) — izzarder.com/160
//  BLI 보 배근도 그리기(xiBeamList)     — izzarder.com/161
//  BE  형강 단면 그리기(xiBE)           — izzarder.com/269
// 셋 다 지금까지 기존 명령 STRUCTURE(file-workflows.js:50-56 · structure.js structuralDetail/standardHSection)로 가던
// "부분" 매핑을 대신한다. 기존 명령은 그대로 두고 이 카드가 원문 조작을 새로 만든다.
import * as G from './geometry.js';
import {entitiesSvg,openCardDialog,resolveLayers} from './card-kit.js';
import {H_BEAMS} from './reference-data.js';

/* 규칙서 6절 표준 켜. 원문 켜 이름(FIN·STEEL·S·T)은 바른 CAD 표준 이름으로 옮긴다. */
export const SC4_LAYERS=Object.freeze({column:'A-COL',beam:'A-BEAM',rebar:'A-COL',beamRebar:'A-BEAM',
 count:'A-TEXT',text:'A-TEXT',dim:'A-DIM',steel:'A-BEAM'});
export const SC4_COLORS=Object.freeze(Object.fromEntries(["A-COL","A-BEAM","A-TEXT","A-DIM","A-SYM"].map(name=>[name,standardLayerForName(name).color])));
export const colorOf=name=>SC4_COLORS[name];
const num=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d;};
const int=(v,d=0)=>{const n=Math.round(Number(v));return Number.isFinite(n)?n:d;};
const P=(x,y)=>({x,y});
const RAD=Math.PI/180;
/** 원문 [강종] 라디오 다섯. 옆의 흐린 "40" 칸(강도)은 원문에서도 비활성이라 카드에 넣지 않았다. */
export const BAR_GRADES=Object.freeze([['UHD','UHD'],['SHD','SHD'],['HD','HD'],['D','D'],['SD','SD']]);
export const barLabel=(grade,dia)=>`${String(grade||'HD')}${Math.round(num(dia,0))}`;

/* ── 두 점 → 표 셀 상자 ── */
export const boxOf=(a,b)=>({x0:Math.min(a.x,b.x),y0:Math.min(a.y,b.y),x1:Math.max(a.x,b.x),y1:Math.max(a.y,b.y)});
export const boxWidth=b=>b.x1-b.x0,boxHeight=b=>b.y1-b.y0;
export const subBox=(b,i,n)=>({x0:b.x0+boxWidth(b)*i/n,x1:b.x0+boxWidth(b)*(i+1)/n,y0:b.y0,y1:b.y1});

/** 원문 "칸을 다시 지정하면 기존 도면과 글씨가 자동으로 삭제되면서 다시 그려진다".
 *  상자 안에 완전히 들어가는 객체만 고른다(표 격자선은 상자 경계를 넘으므로 걸리지 않는다). */
export function entitiesInBox(entities,box,{textOnly=false,textByPosition=true,tol=0.5}={}){
 const ids=[];
 for(const e of entities||[]){
  if(!e||!e.id||e.hidden)continue;
  if(textOnly&&e.type!=='text')continue;
  let b=null;
  // 문자는 글자 폭이 칸을 넘칠 수 있어 기준점으로 판정한다(표 격자선은 그대로 남는다)
  if(textByPosition&&e.type==='text'&&e.position)b={minX:e.position.x,maxX:e.position.x,minY:e.position.y,maxY:e.position.y};
  else try{b=G.bounds([e]);}catch{b=null;}
  if(!b)continue;
  if(b.minX>=box.x0-tol&&b.maxX<=box.x1+tol&&b.minY>=box.y0-tol&&b.maxY<=box.y1+tol)ids.push(e.id);
 }
 return ids;
}

/* ── 모서리 처리. 원문의 [대근형태 직선형/꺽인형], [늑근의 형태 둥근 형/꺽인 형],
      [각형관, C채널의 모서리 직각]이 모두 이 한 함수로 정리된다.
      mode 'sharp'(직각) · 'round'(호) · 'chamfer'(꺾음). radius 는 숫자 또는 꼭짓점별 배열. ── */
export function cornerPolygon(points,radius,mode='round'){
 const n=points.length,rs=Array.isArray(radius)?radius:points.map(()=>radius);
 if(n<3)throw Error('모서리 처리는 꼭짓점 3개 이상이 필요합니다.');
 if(mode==='sharp')return {points:points.map(p=>P(p.x,p.y)),bulges:points.map(()=>0)};
 const out=[],bulges=[];
 for(let i=0;i<n;i++){
  const prev=points[(i-1+n)%n],cur=points[i],next=points[(i+1)%n];
  const vin=G.sub(cur,prev),vout=G.sub(next,cur),lin=G.len(vin),lout=G.len(vout);
  let r=Math.max(0,num(rs[i],0));
  if(r<=0||lin<G.EPS||lout<G.EPS){out.push(P(cur.x,cur.y));bulges.push(0);continue;}
  const uin=G.mul(vin,1/lin),uout=G.mul(vout,1/lout);
  let turn=G.normalizeAngle(G.angle(uout)-G.angle(uin));if(turn>180)turn-=360;
  if(Math.abs(turn)<1e-9||Math.abs(Math.abs(turn)-180)<1e-9){out.push(P(cur.x,cur.y));bulges.push(0);continue;}
  const half=Math.abs(turn)/2*RAD;
  let t=r*Math.tan(half);const lim=Math.min(lin,lout)/2;
  if(t>lim){t=lim;r=t/Math.tan(half);}
  if(t<G.EPS){out.push(P(cur.x,cur.y));bulges.push(0);continue;}
  const a=G.sub(cur,G.mul(uin,t)),b=G.add(cur,G.mul(uout,t));
  out.push(P(a.x,a.y));bulges.push(mode==='chamfer'?0:Math.tan(turn*RAD/4));
  out.push(P(b.x,b.y));bulges.push(0);
 }
 return {points:out,bulges};
}
const loopEntity=(loop,layerName,extra={})=>({type:'polyline',closed:true,points:loop.points,
 ...(loop.bulges.some(b=>b)?{bulges:loop.bulges}:{}),cardLayer:layerName,...extra});
const rectPoints=(cx,cy,w,h)=>[P(cx-w/2,cy-h/2),P(cx+w/2,cy-h/2),P(cx+w/2,cy+h/2),P(cx-w/2,cy+h/2)];
const txt=(t,x,y,height,layerName,align='center')=>({type:'text',text:String(t),position:P(x,y),height,rotation:0,align,cardLayer:layerName});
const hdim=(mode,a,b,at,height,layerName)=>({type:'dimension',mode,points:[P(a.x,a.y),P(b.x,b.y),P(at.x,at.y)],textHeight:height,cardLayer:layerName});

/* ══════════════════════════════════════════════════════════════════════
   CLI — 기둥 배근도 그리기 (izzarder.com/160)
   원문 대화상자: [켜설정] 기둥켜 FIN·철근켜 STEEL·철근수 S·문자켜 T (각각 [L]·cl) /
   [축척 등의 설정] 축척 1/60 · 철근지름(적당값) 30 · 기둥과 치수 간격 5 ×축척 /
   [문자 (출력 크기)] [v]문자표현 · 지름 "D=" · [v]기둥크기 문자 · 문자높이 1.5 ×축척 · 줄간격 4.2 ×축척 /
   [기둥] 가로 600 × 세로 0(0 이면 가로를 지름으로 하는 원형 기둥) /
   [주근] 강종 UHD/SHD/HD/D/SD · 지름 22 · 가로 6 × 세로 6, [대근형태] 직선형/꺽인형,
   [대근 (단부/중앙)] 강종·지름 16·@150 / 강종·지름 16·@300, [보조대근] 강종·지름 10·[ ]문자표현.
   조작: 확인 → 기둥그림이 들어갈 표 셀 영역 두 점 지정(아래 문자 영역은 제외) → 칸이 채워지고 아래 문자 자동 입력.
   ══════════════════════════════════════════════════════════════════════ */
export const CLI_STORAGE_KEY='barun-cli-card';

/** 원문 "출력 시의 크기" 규약. ×축척 칸은 모두 축척을 곱해 도면 mm 가 된다. */
export function columnSizes(v){
 const scale=num(v.scale,60);
 if(!(scale>0))throw Error('축척은 0보다 큰 수여야 합니다(1/60 이면 60).');
 const round=!!v.round,width=num(v.width,600),depth=round?width:num(v.depth,0);
 if(!(width>0))throw Error('기둥 가로는 0보다 커야 합니다.');
 if(!round&&!(depth>0))throw Error('기둥 세로는 0보다 커야 합니다(원형 기둥은 왼쪽 칸에서 고릅니다).');
 const cover=num(v.cover,40),barDia=num(v.barDisplayDia,30);
 if(cover<0)throw Error('피복은 0 이상이어야 합니다.');
 if(!(barDia>0))throw Error('철근지름(적당값)은 0보다 커야 합니다.');
 if(cover*2+barDia>=Math.min(width,depth))throw Error('피복과 철근이 기둥 단면 안에 들어가지 않습니다.');
 return {scale,round,width,depth,cover,barDia,
  dimGap:num(v.dimGap,5)*scale,textHeight:num(v.textHeight,1.5)*scale,lineGap:num(v.lineGap,4.2)*scale,
  nx:int(v.nx,6),ny:round?0:int(v.ny,6),mainDia:num(v.mainDia,22),
  tieDia:num(v.tieDia,16),subTieDia:num(v.subTieDia,10),subTies:round?0:Math.max(0,int(v.subTieCount,1))};
}
/** 대근(띠근) 중심 사각형 위의 주근 좌표. 원점은 기둥 중심. 모서리는 가로·세로가 함께 쓴다. */
export function columnBarPoints(s){
 const r=s.width/2-s.cover;
 if(s.round){
  const n=s.nx;if(n<3)throw Error('원형 기둥 주근은 3개 이상입니다.');
  return Array.from({length:n},(_,i)=>G.polar(r,90+360*i/n));
 }
 const nx=s.nx,ny=s.ny;
 if(nx<2||ny<2)throw Error('주근 가로·세로 개수는 각각 2 이상입니다.');
 const hw=s.width/2-s.cover,hh=s.depth/2-s.cover,out=[];
 for(let i=0;i<nx;i++){const x=-hw+2*hw*i/(nx-1);out.push(P(x,hh),P(x,-hh));}
 for(let j=1;j<ny-1;j++){const y=-hh+2*hh*j/(ny-1);out.push(P(-hw,y),P(hw,y));}
 return out;
}
export const columnBarCount=s=>s.round?s.nx:2*(s.nx+s.ny)-4;
/** 원문 그림의 표 아래 문자 줄. 사각 "700 x 700"·"16 - HD22"·"HD10 @150"·"HD10 @300", 원형 "D=600"·"6 - HD22". */
export function columnTexts(v){
 const s=columnSizes(v),out=[];
 if(!v.textOn)return out;
 if(v.sizeTextOn)out.push(s.round?`${String(v.diaPrefix??'')}${Math.round(s.width)}`:`${Math.round(s.width)} x ${Math.round(s.depth)}`);
 out.push(`${columnBarCount(s)} - ${barLabel(v.mainGrade,s.mainDia)}`);
 out.push(`${barLabel(v.tieGrade,s.tieDia)} @${Math.round(num(v.tieEndSpace,150))}`);
 out.push(`${barLabel(v.tieGrade,s.tieDia)} @${Math.round(num(v.tieMidSpace,300))}`);
 if(!s.round&&v.subTieTextOn&&s.subTies>0)out.push(`${barLabel(v.tieGrade,s.subTieDia)}`);
 return out;
}
/** 표 셀 상자 하나를 채우는 기둥 배근도 + 치수 + 철근수 문자 + 아래 문자. */
export function columnEntities(v,shared={},box={x0:0,y0:0,x1:3000,y1:3000}){
 const s=columnSizes(v),es=[];
 const colL=shared.columnLayer||SC4_LAYERS.column,rebL=shared.rebarLayer||SC4_LAYERS.rebar,
  cntL=shared.countLayer||SC4_LAYERS.count,txtL=shared.textLayer||SC4_LAYERS.text;
 const cx=(box.x0+box.x1)/2,cy=(box.y0+box.y1)/2;
 const hw=s.width/2,hh=(s.round?s.width:s.depth)/2;
 const at=(p)=>P(cx+p.x,cy+p.y);
 // 기둥 단면
 if(s.round)es.push({type:'circle',center:P(cx,cy),radius:hw,cardLayer:colL});
 else es.push(loopEntity(cornerPolygon(rectPoints(cx,cy,s.width,s.depth),0,'sharp'),colL));
 // 대근(띠근) — 원문 [대근형태] 직선형=직각 모서리, 꺽인형=모서리를 꺾어 그린다
 const tieMode=v.tieShape==='bent'?'chamfer':'sharp';
 if(s.round)es.push({type:'circle',center:P(cx,cy),radius:hw-s.cover,cardLayer:rebL});
 else es.push(loopEntity(cornerPolygon(rectPoints(cx,cy,s.width-2*s.cover,s.depth-2*s.cover),s.barDia,tieMode),rebL));
 // 주근
 const bars=columnBarPoints(s);
 for(const p of bars)es.push({type:'circle',center:at(p),radius:s.barDia/2,cardLayer:rebL});
 // 보조대근 — 원문 그림의 가운데 십자 띠. 갈고리는 끝에서 안쪽으로 짧게 꺾는다
 if(!s.round&&s.subTies>0){
  const ihw=hw-s.cover,ihh=hh-s.cover,hook=s.barDia*1.5;
  const picks=(n,count)=>{const inner=[];for(let i=1;i<n-1;i++)inner.push(i);
   if(!inner.length)return [];const take=Math.min(count,inner.length),out=[];
   for(let k=0;k<take;k++)out.push(inner[Math.round((inner.length-1)*(take===1?0.5:k/(take-1)))]);
   return [...new Set(out)];};
  for(const i of picks(s.nx,s.subTies)){const x=-ihw+2*ihw*i/(s.nx-1);
   es.push({type:'polyline',closed:false,cardLayer:rebL,points:[at(P(x-hook,ihh-hook)),at(P(x,ihh)),at(P(x,-ihh)),at(P(x+hook,-ihh+hook))]});}
  for(const j of picks(s.ny,s.subTies)){const y=-ihh+2*ihh*j/(s.ny-1);
   es.push({type:'polyline',closed:false,cardLayer:rebL,points:[at(P(-ihw+hook,y+hook)),at(P(-ihw,y)),at(P(ihw,y)),at(P(ihw-hook,y-hook))]});}
 }
 // 철근수 문자 — 원문 "기둥 위와 오른쪽에 들어갈 철근 숫자"(그림에서는 위 두 곳·오른쪽 두 곳)
 const g=s.textHeight*0.6;
 es.push(txt(s.nx,cx-hw+s.textHeight,cy+hh+g,s.textHeight,cntL));
 if(!s.round){
  es.push(txt(s.nx,cx+hw-s.textHeight,cy+hh+g,s.textHeight,cntL));
  es.push(txt(s.ny,cx+hw+g,cy+hh-s.textHeight,s.textHeight,cntL,'left'));
  es.push(txt(s.ny,cx+hw+g,cy-hh+s.textHeight,s.textHeight,cntL,'left'));
 }
 // 치수 — 원문 그림에서 기둥 외곽과 같은 켜(빨강)다. 간격은 "기둥과 치수 간격 ×축척"
 es.push(hdim('horizontal',P(cx-hw,cy+hh),P(cx+hw,cy+hh),P(cx-hw,cy+hh+s.dimGap),s.textHeight,SC4_LAYERS.dim));
 if(!s.round)es.push(hdim('vertical',P(cx-hw,cy-hh),P(cx-hw,cy+hh),P(cx-hw-s.dimGap,cy-hh),s.textHeight,SC4_LAYERS.dim)); // 치수는 치수 레이어(2026-10-10)
 // 아래 문자 — 줄간격만큼 내려가며 쌓는다
 columnTexts(v).forEach((t,i)=>es.push(txt(t,cx,box.y0-s.lineGap*(i+0.5),s.textHeight,txtL)));
 return es;
}
export const CLI_FIELDS=[
 {key:'round',label:'원형 기둥',type:'check',def:false,hidden:true},
 {key:'scale',label:'축척 1/',type:'number',def:60,min:.01,step:1,group:'축척 등의 설정'},
 {key:'barDisplayDia',label:'철근지름(적당값)',type:'number',def:30,min:.1,step:1,group:'축척 등의 설정',hint:'화면에 점처럼 보이는 크기'},
 {key:'dimGap',label:'기둥과 치수 간격',type:'number',def:5,min:0,step:.5,group:'축척 등의 설정',hint:'×축척'},
 {key:'width',label:'가로',type:'number',def:600,min:1,step:50,group:'기둥'},
 {key:'depth',label:'세로',type:'number',def:600,min:1,step:50,group:'기둥',when:v=>!v.round},
 {key:'cover',label:'피복',type:'number',def:40,min:0,step:5,group:'기둥',hint:'원문 대화상자에 없는 칸. 대근 위치를 정하려면 필요해 더했다'},
 {key:'mainGrade',label:'주근 강종',type:'select',def:'HD',options:BAR_GRADES,group:'철근 갯수와 종류'},
 {key:'mainDia',label:'주근 지름',type:'number',def:22,min:1,step:1,group:'철근 갯수와 종류'},
 {key:'nx',label:'주근 가로',type:'number',def:6,min:2,max:40,step:1,group:'철근 갯수와 종류'},
 {key:'ny',label:'주근 세로',type:'number',def:6,min:2,max:40,step:1,group:'철근 갯수와 종류',when:v=>!v.round},
 {key:'tieShape',label:'대근형태',type:'select',def:'bent',options:[['straight','직선형'],['bent','꺽인형']],group:'철근 갯수와 종류',when:v=>!v.round},
 {key:'tieGrade',label:'대근 강종',type:'select',def:'HD',options:BAR_GRADES,group:'대근 (단부/중앙)'},
 {key:'tieDia',label:'대근 지름',type:'number',def:16,min:1,step:1,group:'대근 (단부/중앙)'},
 {key:'tieEndSpace',label:'단부 @',type:'number',def:150,min:1,step:10,group:'대근 (단부/중앙)'},
 {key:'tieMidSpace',label:'중앙 @',type:'number',def:300,min:1,step:10,group:'대근 (단부/중앙)'},
 {key:'subTieDia',label:'보조대근 지름',type:'number',def:10,min:1,step:1,group:'보조대근',when:v=>!v.round},
 {key:'subTieCount',label:'보조대근 갯수',type:'number',def:1,min:0,max:20,step:1,group:'보조대근',when:v=>!v.round,hint:'원문에 갯수 칸이 없어 더했다(그림은 가로·세로 각 1개)'},
 {key:'subTieTextOn',label:'보조대근 문자표현',type:'check',def:false,group:'보조대근',when:v=>!v.round},
 {key:'textOn',label:'문자표현',type:'check',def:true,group:'문자 (출력 크기)'},
 {key:'sizeTextOn',label:'기둥크기 문자',type:'check',def:true,group:'문자 (출력 크기)',when:v=>v.textOn},
 {key:'diaPrefix',label:'지름 접두어',type:'text',def:'D=',group:'문자 (출력 크기)',when:v=>v.textOn&&v.round},
 {key:'textHeight',label:'문자높이',type:'number',def:1.5,min:.01,step:.1,group:'문자 (출력 크기)',when:v=>v.textOn,hint:'×축척'},
 {key:'lineGap',label:'줄간격',type:'number',def:4.2,min:.01,step:.1,group:'문자 (출력 크기)',when:v=>v.textOn,hint:'×축척'},
];
export const CLI_SHARED_FIELDS=[
 {key:'columnLayer',label:'기둥켜',type:'layer',def:SC4_LAYERS.column,group:'켜설정'},
 {key:'rebarLayer',label:'철근켜',type:'layer',def:SC4_LAYERS.rebar,group:'켜설정'},
 {key:'countLayer',label:'철근수 켜',type:'layer',def:SC4_LAYERS.count,group:'켜설정'},
 {key:'textLayer',label:'문자켜',type:'layer',def:SC4_LAYERS.text,group:'켜설정'},
];
export const cliSlotDefaults=i=>[{name:'사각 기둥',round:false,width:700,depth:700,nx:5,ny:5},
 {name:'원형 기둥',round:true,width:600,nx:6}][i]||{};
export function cliPreviewSvg(v,shared,opts={}){
 const s=columnSizes(v),w=s.width*2.4,h=(s.round?s.width:s.depth)*2.4;
 const es=columnEntities(v,shared,{x0:0,y0:0,x1:w,y1:h});
 return entitiesSvg(es,{label:opts.compact?'':`표 한 칸 · ${s.round?`원형 D${Math.round(s.width)}`:`${Math.round(s.width)}×${Math.round(s.depth)}`} · 주근 ${columnBarCount(s)}개`,colorOf:e=>colorOf(e.cardLayer),...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   BLI — 보 배근도 그리기 (izzarder.com/161)
   원문 대화상자: [늑근의 형태] 둥근 형/꺽인 형 · [단부이름 위치] 상단 칸/보 상부/보 하부/하단 칸 ·
   [축척] 1/60 · [보] 가로 600 × 세로 1000 · [강종] 주근·늑근·표피 각각 UHD/SHD/HD/D/SD ·
   [v]표피철근 표현 갯수 5 [v]보조늑근 표현 · [주열/부열의 입력] 세 칸(INT,END · CENT · EXT,END)마다
   [v]표현 · 이름 · 상단 주열 6 부열 6 · 하단 주열 6 부열 6 · 주근 22 | 늑근 10 @150 ·
   [문자] [v]보크기 문자 표현 [v]치수 표현 · 보와 치수 간격 5 ×축척 · 문자높이 1.5 ×축척 · 줄 간격 4.2 ×축척.
   조작: 확인 → 보그림 영역 두 점 지정(아래 문자 영역 제외) → 표 한 칸이 채워지고 아래 문자 자동 입력.
   "표피철근을 선택해도 높이가 900 미만인 보는 그려지지 않습니다."
   ══════════════════════════════════════════════════════════════════════ */
export const BLI_STORAGE_KEY='barun-bli-card';
export const SKIN_MIN_DEPTH=900;

export function beamSizes(shared){
 const scale=num(shared.scale,60);
 if(!(scale>0))throw Error('축척은 0보다 큰 수여야 합니다(1/60 이면 60).');
 const width=num(shared.width,600),depth=num(shared.depth,1000),cover=num(shared.cover,40);
 if(!(width>0)||!(depth>0))throw Error('보 가로·세로는 0보다 커야 합니다.');
 const mainDia=num(shared.mainDia,22),stirrupDia=num(shared.stirrupDia,10);
 if(!(mainDia>0)||!(stirrupDia>0))throw Error('주근·늑근 지름은 0보다 커야 합니다.');
 if(cover*2+mainDia*2>=Math.min(width,depth))throw Error('피복과 철근이 보 단면 안에 들어가지 않습니다.');
 return {scale,width,depth,cover,mainDia,stirrupDia,
  dimGap:num(shared.dimGap,5)*scale,textHeight:num(shared.textHeight,1.5)*scale,lineGap:num(shared.lineGap,4.2)*scale,
  skinOn:!!shared.skinOn,skinCount:Math.max(0,int(shared.skinCount,5)),
  subOn:!!shared.subOn,subCount:Math.max(0,int(shared.subCount,2)),
  stirrupShape:shared.stirrupShape==='bent'?'chamfer':'round'};
}
/** 원문 주의: 표피철근은 보 높이 900 미만이면 그리지 않는다. */
export const skinDrawn=(shared)=>!!shared.skinOn&&num(shared.depth,1000)>=SKIN_MIN_DEPTH&&Math.max(0,int(shared.skinCount,5))>0;
/** 한 줄에 n 개를 늑근 안쪽 폭에 등간격으로. n=1 이면 가운데. */
export function barRow(halfWidth,n){
 if(n<=0)return [];
 if(n===1)return [0];
 return Array.from({length:n},(_,i)=>-halfWidth+2*halfWidth*i/(n-1));
}
/** 원문 그림의 표 아래 문자 줄: 규격(W X D) · 상부근 · 하부근 · 늑근 (+ 표피철근 · 보조늑근). */
export function beamTexts(shared,col){
 const s=beamSizes(shared),out=[];
 if(!shared.sizeTextOn)return out;
 out.push(`${Math.round(s.width)}x${Math.round(s.depth)}`);
 out.push(`${int(col.topMain,0)+int(col.topSub,0)}-${barLabel(shared.mainGrade,s.mainDia)}`);
 out.push(`${int(col.botMain,0)+int(col.botSub,0)}-${barLabel(shared.mainGrade,s.mainDia)}`);
 out.push(`${barLabel(shared.stirrupGrade,s.stirrupDia)} @${Math.round(num(col.stirrupSpace,150))}`);
 // 원문: "갯수는 양쪽 중 한 쪽만 입력하고, 결과 문자는 이 숫자에 2배를 한 값으로 표시됩니다."
 if(skinDrawn(shared))out.push(`${s.skinCount*2}-${barLabel(shared.skinGrade,s.stirrupDia)}`);
 if(s.subOn&&s.subCount>0)out.push(`${barLabel(shared.stirrupGrade,s.stirrupDia)}`);
 return out;
}
/** 표 셀 상자 하나(여러 칸이면 가로로 나눈 몫)를 채우는 보 배근도. */
export function beamEntities(shared,col,box={x0:0,y0:0,x1:3000,y1:3000}){
 const s=beamSizes(shared),es=[];
 const beamL=shared.beamLayer||SC4_LAYERS.beam,rebL=shared.rebarLayer||SC4_LAYERS.beamRebar,
  txtL=shared.textLayer||SC4_LAYERS.text,dimL=SC4_LAYERS.dim;
 const cx=(box.x0+box.x1)/2,cy=(box.y0+box.y1)/2,hw=s.width/2,hh=s.depth/2;
 const at=p=>P(cx+p.x,cy+p.y);
 es.push(loopEntity(cornerPolygon(rectPoints(cx,cy,s.width,s.depth),0,'sharp'),beamL));
 // 늑근 — 원문 [늑근의 형태] 둥근 형(호) / 꺽인 형(꺾음)
 const ihw=hw-s.cover,ihh=hh-s.cover;
 es.push(loopEntity(cornerPolygon(rectPoints(cx,cy,ihw*2,ihh*2),s.stirrupDia*2,s.stirrupShape),rebL));
 // 주근 상단 주열/부열 · 하단 주열/부열
 const rowGap=s.mainDia*2,r=s.mainDia/2;
 const rows=[[int(col.topMain,0),ihh],[int(col.topSub,0),ihh-rowGap],[int(col.botMain,0),-ihh],[int(col.botSub,0),-ihh+rowGap]];
 for(const [n,y] of rows)for(const x of barRow(ihw,n))es.push({type:'circle',center:at(P(x,y)),radius:r,cardLayer:rebL});
 // 보조늑근 — 원문 그림의 안쪽 세로 띠
 if(s.subOn&&s.subCount>0)for(const x of barRow(ihw*0.6,s.subCount))
  es.push({type:'line',points:[at(P(x,ihh)),at(P(x,-ihh))],cardLayer:rebL});
 // 표피철근 — 원문 그림의 양 옆 × 표시. 높이 900 미만이면 그리지 않는다
 if(skinDrawn(shared)){
  const m=s.stirrupDia,ys=barRow(ihh*0.45,s.skinCount);
  for(const y of ys)for(const x of [-ihw,ihw]){
   es.push({type:'line',points:[at(P(x-m,y-m)),at(P(x+m,y+m))],cardLayer:rebL});
   es.push({type:'line',points:[at(P(x-m,y+m)),at(P(x+m,y-m))],cardLayer:rebL});
  }
 }
 // 치수 — 원문 "보와 치수간격"은 보 끝선에서 치수선까지(출력 후 길이)
 if(shared.dimOn){
  es.push(hdim('horizontal',P(cx-hw,cy+hh),P(cx+hw,cy+hh),P(cx-hw,cy+hh+s.dimGap),s.textHeight,dimL));
  es.push(hdim('vertical',P(cx-hw,cy-hh),P(cx-hw,cy+hh),P(cx-hw-s.dimGap,cy-hh),s.textHeight,dimL));
 }
 // 단부이름 위치 — 상단 칸 / 보 상부 / 보 하부 / 하단 칸
 const name=String(col.sectionName||'').trim();
 let firstLine=0;
 if(name){
  const place=shared.namePos||'topCell';
  if(place==='topCell')es.push(txt(name,cx,box.y1-s.lineGap*0.5,s.textHeight,txtL));
  else if(place==='beamTop')es.push(txt(name,cx,cy+hh+s.textHeight*1.2,s.textHeight,txtL));
  else if(place==='beamBottom')es.push(txt(name,cx,cy-hh-s.textHeight*1.2,s.textHeight,txtL));
  else{es.push(txt(name,cx,box.y0-s.lineGap*0.5,s.textHeight,txtL));firstLine=1;}
 }
 beamTexts(shared,col).forEach((t,i)=>es.push(txt(t,cx,box.y0-s.lineGap*(i+firstLine+0.5),s.textHeight,txtL)));
 return es;
}
export const BLI_FIELDS=[
 {key:'on',label:'표현',type:'check',def:true,group:'주열/부열의 입력'},
 {key:'sectionName',label:'이름',type:'text',def:'CENT',group:'주열/부열의 입력',when:v=>v.on},
 {key:'topMain',label:'상단 주열',type:'number',def:6,min:0,max:40,step:1,group:'주열/부열의 입력',when:v=>v.on},
 {key:'topSub',label:'상단 부열',type:'number',def:6,min:0,max:40,step:1,group:'주열/부열의 입력',when:v=>v.on},
 {key:'botMain',label:'하단 주열',type:'number',def:6,min:0,max:40,step:1,group:'주열/부열의 입력',when:v=>v.on},
 {key:'botSub',label:'하단 부열',type:'number',def:6,min:0,max:40,step:1,group:'주열/부열의 입력',when:v=>v.on},
 {key:'stirrupSpace',label:'늑근 @',type:'number',def:150,min:1,step:10,group:'주열/부열의 입력',when:v=>v.on},
];
export const BLI_SHARED_FIELDS=[
 {key:'width',label:'보 가로',type:'number',def:600,min:1,step:50,group:'보 · 축척'},
 {key:'depth',label:'보 세로',type:'number',def:1000,min:1,step:50,group:'보 · 축척'},
 {key:'cover',label:'피복',type:'number',def:40,min:0,step:5,group:'보 · 축척',hint:'원문에 없는 칸. 늑근 위치를 정하려면 필요해 더했다'},
 {key:'scale',label:'축척 1/',type:'number',def:60,min:.01,step:1,group:'보 · 축척'},
 {key:'stirrupShape',label:'늑근의 형태',type:'select',def:'round',options:[['round','둥근 형'],['bent','꺽인 형']],group:'보 · 축척'},
 {key:'namePos',label:'단부이름 위치',type:'select',def:'topCell',options:[['topCell','상단 칸'],['beamTop','보 상부'],['beamBottom','보 하부'],['bottomCell','하단 칸']],group:'보 · 축척'},
 {key:'mainGrade',label:'주근 강종',type:'select',def:'HD',options:BAR_GRADES,group:'강종'},
 {key:'mainDia',label:'주근 지름',type:'number',def:22,min:1,step:1,group:'강종'},
 {key:'stirrupGrade',label:'늑근 강종',type:'select',def:'HD',options:BAR_GRADES,group:'강종'},
 {key:'stirrupDia',label:'늑근 지름',type:'number',def:10,min:1,step:1,group:'강종'},
 {key:'skinOn',label:'표피철근 표현',type:'check',def:true,group:'표피철근 · 보조늑근'},
 {key:'skinGrade',label:'표피 강종',type:'select',def:'HD',options:BAR_GRADES,group:'표피철근 · 보조늑근',when:(v,s)=>s.skinOn},
 {key:'skinCount',label:'표피 갯수',type:'number',def:5,min:0,max:40,step:1,group:'표피철근 · 보조늑근',when:(v,s)=>s.skinOn,hint:'한 쪽만 · 문자는 2배'},
 {key:'subOn',label:'보조늑근 표현',type:'check',def:true,group:'표피철근 · 보조늑근'},
 {key:'subCount',label:'보조늑근 갯수',type:'number',def:2,min:0,max:20,step:1,group:'표피철근 · 보조늑근',when:(v,s)=>s.subOn,hint:'원문에 갯수 칸이 없어 더했다'},
 {key:'sizeTextOn',label:'보크기 문자 표현',type:'check',def:true,group:'문자'},
 {key:'dimOn',label:'치수 표현',type:'check',def:true,group:'문자'},
 {key:'dimGap',label:'보와 치수 간격',type:'number',def:5,min:0,step:.5,group:'문자',when:(v,s)=>s.dimOn,hint:'×축척'},
 {key:'textHeight',label:'문자높이',type:'number',def:1.5,min:.01,step:.1,group:'문자',hint:'×축척'},
 {key:'lineGap',label:'줄 간격',type:'number',def:4.2,min:.01,step:.1,group:'문자',hint:'×축척'},
 {key:'beamLayer',label:'보켜',type:'layer',def:SC4_LAYERS.beam,group:'켜'},
 {key:'rebarLayer',label:'철근켜',type:'layer',def:SC4_LAYERS.beamRebar,group:'켜'},
 {key:'textLayer',label:'문자켜',type:'layer',def:SC4_LAYERS.text,group:'켜'},
];
export const bliSlotDefaults=i=>[{sectionName:'INT,END'},{sectionName:'CENT'},{sectionName:'EXT,END'}][i]||{};
export const BLI_SLOT_NAMES=['첫칸 (단부)','가운데 (중앙)','끝칸 (단부)'];
export function bliPreviewSvg(v,shared,opts={}){
 const s=beamSizes(shared),es=beamEntities(shared,v,{x0:0,y0:0,x1:s.width*2.2,y1:s.depth*1.6});
 const note=skinDrawn(shared)?'':shared.skinOn?` · 표피철근은 높이 ${SKIN_MIN_DEPTH} 미만이라 안 그림`:'';
 return entitiesSvg(es,{label:opts.compact?'':`${Math.round(s.width)}×${Math.round(s.depth)} · ${String(v.sectionName||'')}${note}`,colorOf:e=>colorOf(e.cardLayer),...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   BE — 형강 단면 그리기 (izzarder.com/269)
   원문 대화상자 "형강 그리기": [형강 모양] H형강 / L형강 / ㄷ형강 / C 찬넬 / 각형 강관 / 원형 관 라디오,
   [ ]입력 후 재 순환, 켜: (edit + [L] + cl), 오른쪽 규격 목록(H · B · T1 · T2 · R · *),
   [ ]각형관, C채널의 모서리 직각.  조작: 확인 → 삽입점 지정 → 단면 작도.
   규격 목록은 원문 대화상자에 H형강 표만 실려 있다(reference-data.js 의 KS H형강 표와 행이 그대로 일치한다).
   나머지 다섯 모양은 원문에 규격표가 없으므로 지어내지 않고 치수를 직접 넣게 했다.
   ══════════════════════════════════════════════════════════════════════ */
export const BE_STORAGE_KEY='barun-be-card';
export const BE_H_SPECS=H_BEAMS.filter(s=>s.series==='KS');
const H_BY_LABEL=new Map(BE_H_SPECS.map(s=>[s.label,s]));
export const BE_H_OPTIONS=BE_H_SPECS.map(s=>[s.label,`${s.h} · ${s.b} · ${s.tw} · ${s.tf} · R${s.r}${s.starred?' *':''}`]);
export const beHSpec=label=>H_BY_LABEL.get(label)||BE_H_SPECS[0];

/** 형강 모양별 폐합 고리. 각 고리는 {points,bulges}. 원점은 단면 바깥치수의 가운데. */
export function beLoops(v){
 const shape=v.shape||'h',sq=!!v.squareCorner;
 const need=(n,name)=>{if(!(num(n,0)>0))throw Error(`${name}은(는) 0보다 커야 합니다.`);return num(n,0);};
 if(shape==='h'){
  const s=beHSpec(v.spec),hb=s.b/2,hh=s.h/2,hw=s.tw/2,tf=s.tf,r=s.r;  // 필렛 R 은 고른 규격의 R 값을 그대로 쓴다
  if(s.tw>=s.b||s.tf*2>=s.h)throw Error('형강 규격이 잘못됐습니다.');
  const pts=[P(-hb,-hh),P(hb,-hh),P(hb,-hh+tf),P(hw,-hh+tf),P(hw,hh-tf),P(hb,hh-tf),
   P(hb,hh),P(-hb,hh),P(-hb,hh-tf),P(-hw,hh-tf),P(-hw,-hh+tf),P(-hb,-hh+tf)];
  const radii=pts.map((_,i)=>[3,4,9,10].includes(i)?r:0);
  return [cornerPolygon(pts,radii,'round')];
 }
 if(shape==='l'){
  const a=need(v.secH,'세로 A'),b=need(v.secB,'가로 B'),t=need(v.secT,'두께 T'),r=Math.max(0,num(v.secR,0));
  if(t>=Math.min(a,b))throw Error('두께는 다리 길이보다 작아야 합니다.');
  const pts=[P(-b/2,-a/2),P(b/2,-a/2),P(b/2,-a/2+t),P(-b/2+t,-a/2+t),P(-b/2+t,a/2),P(-b/2,a/2)];
  return [cornerPolygon(pts,pts.map((_,i)=>i===3?r:0),'round')];
 }
 if(shape==='c'){
  const h=need(v.secH,'세로 H'),b=need(v.secB,'가로 B'),t1=need(v.secT1,'웨브두께 T1'),t2=need(v.secT2,'플랜지두께 T2'),r=Math.max(0,num(v.secR,0));
  if(t1>=b||t2*2>=h)throw Error('두께가 단면보다 큽니다.');
  const x0=-b/2,y0=-h/2;
  const pts=[P(x0,y0),P(x0+b,y0),P(x0+b,y0+t2),P(x0+t1,y0+t2),P(x0+t1,y0+h-t2),P(x0+b,y0+h-t2),P(x0+b,y0+h),P(x0,y0+h)];
  return [cornerPolygon(pts,pts.map((_,i)=>[3,4].includes(i)?r:0),'round')];
 }
 if(shape==='ch'){
  const h=need(v.secH,'세로 H'),b=need(v.secB,'가로 B'),c=need(v.secLip,'립 길이 C'),t=need(v.secT,'두께 T'),r=Math.max(0,num(v.secR,0));
  if(t*2>=Math.min(h,b)||c<=t)throw Error('두께·립 길이가 단면과 맞지 않습니다.');
  const x0=-b/2,y0=-h/2,x1=x0+b,y1=y0+h;
  const pts=[P(x0,y0),P(x1,y0),P(x1,y0+c),P(x1-t,y0+c),P(x1-t,y0+t),P(x0+t,y0+t),
   P(x0+t,y1-t),P(x1-t,y1-t),P(x1-t,y1-c),P(x1,y1-c),P(x1,y1),P(x0,y1)];
  return [cornerPolygon(pts,r,sq?'sharp':'round')];
 }
 if(shape==='box'){
  const h=need(v.secH,'세로 H'),b=need(v.secB,'가로 B'),t=need(v.secT,'두께 T'),r=Math.max(0,num(v.secR,0));
  if(t*2>=Math.min(h,b))throw Error('두께는 단면의 절반보다 작아야 합니다.');
  return [cornerPolygon(rectPoints(0,0,b,h),r,sq?'sharp':'round'),
   cornerPolygon(rectPoints(0,0,b-2*t,h-2*t),Math.max(0,r-t),sq?'sharp':'round')];
 }
 if(shape==='pipe')return [];
 throw Error('형강 모양 오류');
}
/** 형강 단면 객체. 삽입점은 단면 바깥치수의 가운데다. */
export function beEntities(v,shared={},at=P(0,0)){
 const layerName=shared.steelLayer||SC4_LAYERS.steel;
 if((v.shape||'h')==='pipe'){
  const d=num(v.secD,0),t=num(v.secT,0);
  if(!(d>0))throw Error('바깥지름 D 은(는) 0보다 커야 합니다.');
  if(!(t>0)||t*2>=d)throw Error('두께 T 는 0보다 크고 지름의 절반보다 작아야 합니다.');
  return [{type:'circle',center:P(at.x,at.y),radius:d/2,cardLayer:layerName},
   {type:'circle',center:P(at.x,at.y),radius:d/2-t,cardLayer:layerName}];
 }
 return beLoops(v).map(loop=>loopEntity({points:loop.points.map(p=>P(p.x+at.x,p.y+at.y)),bulges:loop.bulges},layerName));
}
export function beSummary(v){
 const shape=v.shape||'h';
 if(shape==='h'){const s=beHSpec(v.spec);return `H형강 ${s.label}`;}
 if(shape==='l')return `L형강 ${num(v.secH,0)}×${num(v.secB,0)}×${num(v.secT,0)}`;
 if(shape==='c')return `ㄷ형강 ${num(v.secH,0)}×${num(v.secB,0)}×${num(v.secT1,0)}×${num(v.secT2,0)}`;
 if(shape==='ch')return `C 찬넬 ${num(v.secH,0)}×${num(v.secB,0)}×${num(v.secLip,0)}×${num(v.secT,0)}`;
 if(shape==='box')return `각형 강관 ${num(v.secB,0)}×${num(v.secH,0)}×${num(v.secT,0)}`;
 return `원형 관 D${num(v.secD,0)}×${num(v.secT,0)}`;
}
const isShape=(...ks)=>v=>ks.includes(v.shape||'h');
export const BE_FIELDS=[
 {key:'shape',label:'형강 모양',type:'select',def:'h',hidden:true,
  options:[['h','H형강'],['l','L형강'],['c','ㄷ형강'],['ch','C 찬넬'],['box','각형 강관'],['pipe','원형 관']]},
 {key:'spec',label:'규격 (H·B·T1·T2·R)',type:'select',def:BE_H_SPECS[0]?.label||'',options:BE_H_OPTIONS,group:'규격',when:isShape('h'),hint:'* 는 원문 목록의 표시 그대로'},
 {key:'secD',label:'바깥지름 D',type:'number',def:216.3,min:1,step:1,group:'규격',when:isShape('pipe')},
 {key:'secH',label:'세로 H',type:'number',def:150,min:1,step:5,group:'규격',when:isShape('l','c','ch','box')},
 {key:'secB',label:'가로 B',type:'number',def:100,min:1,step:5,group:'규격',when:isShape('l','c','ch','box')},
 {key:'secLip',label:'립 길이 C',type:'number',def:25,min:1,step:1,group:'규격',when:isShape('ch')},
 {key:'secT',label:'두께 T',type:'number',def:6,min:.1,step:.5,group:'규격',when:isShape('l','ch','box','pipe')},
 {key:'secT1',label:'웨브두께 T1',type:'number',def:6.5,min:.1,step:.5,group:'규격',when:isShape('c')},
 {key:'secT2',label:'플랜지두께 T2',type:'number',def:10,min:.1,step:.5,group:'규격',when:isShape('c')},
 {key:'secR',label:'모서리·필렛 R',type:'number',def:10,min:0,step:1,group:'규격',when:isShape('l','c','ch','box'),hint:'H형강은 고른 규격의 R 을 그대로 쓴다'},
 {key:'squareCorner',label:'각형관, C채널의 모서리 직각',type:'check',def:false,group:'규격',when:isShape('ch','box')},
 {key:'recycle',label:'입력 후 재 순환',type:'check',def:true,group:'규격',hint:'끄면 한 번만 넣습니다'},
];
export const BE_SHARED_FIELDS=[{key:'steelLayer',label:'켜',type:'layer',def:SC4_LAYERS.steel,group:'켜'}];
export const beSlotDefaults=i=>[
 {name:'H형강',shape:'h'},
 {name:'L형강',shape:'l',secH:100,secB:100,secT:7,secR:10},
 {name:'ㄷ형강',shape:'c',secH:150,secB:75,secT1:6.5,secT2:10,secR:10},
 {name:'C 찬넬',shape:'ch',secH:150,secB:75,secLip:20,secT:4.5,secR:6},
 {name:'각형 강관',shape:'box',secH:150,secB:100,secT:6,secR:12},
 {name:'원형 관',shape:'pipe',secD:216.3,secT:6},
][i]||{};
export const BE_SLOT_NAMES=['H형강','L형강','ㄷ형강','C 찬넬','각형 강관','원형 관'];
export function bePreviewSvg(v,shared,opts={}){
 const es=beEntities(v,shared,P(0,0));
 return entitiesSvg(es,{label:opts.compact?'':beSummary(v),colorOf:e=>colorOf(e.cardLayer),...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   화면(대화상자·화면 입력·커밋). 순수 계산은 위쪽 export 함수에 있고 여기는 DOM 만 쓴다.
   ══════════════════════════════════════════════════════════════════════ */
export function installStructureCards4(ctx){
 const fail=e=>{console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);};
 const put=(entities,removeIds=[])=>ctx.commit({removeIds,entities:resolveLayers(ctx,entities,colorOf)});
 const tint=list=>list.map(e=>({...e,previewColor:colorOf(e.cardLayer)||'#ffd479'}));
 /** 표 셀 두 점 지정(미리보기 포함). 원문 "기둥/보 그림 영역 선택(아래 문자 영역은 제외)". */
 const pickCell=async(prompt,make)=>{
  const path=await ctx.pickPath({prompt,minPoints:2,maxPoints:2,preview:(points,cursor)=>{
   const pts=cursor?[...points,cursor]:points;
   if(pts.length<2)return [];
   try{return tint(make(boxOf(pts[0],pts[1])));}catch{return [];}
  }});
  return path?boxOf(path.points[0],path.points[1]):null;
 };
 /** 원문 "해당 칸을 다시 지정하면 기존 도면과 글씨가 자동으로 삭제되면서 새로 그려진다". */
 const staleIds=(box,lineGap,lines)=>{
  const es=ctx.entities()||[];
  const ids=new Set(entitiesInBox(es,box));
  const band={x0:box.x0,x1:box.x1,y0:box.y0-lineGap*(lines+1),y1:box.y0};
  for(const id of entitiesInBox(es,band,{textOnly:true}))ids.add(id);
  return [...ids];
 };

 /* ── CLI ── */
 async function drawCLI(v,shared){
  for(;;){
   const box=await pickCell(`CLI 기둥 배근도 [${v.name}] · 기둥그림이 들어갈 표 칸 두 모서리 (아래 문자 영역 제외) · Esc 중단`,
    b=>columnEntities(v,shared,b));
   if(!box)return null;
   const s=columnSizes(v),es=columnEntities(v,shared,box);
   put(es,staleIds(box,s.lineGap,columnTexts(v).length));
   ctx.toast(`기둥 배근도 · ${s.round?`원형 D${Math.round(s.width)}`:`${Math.round(s.width)}×${Math.round(s.depth)}`} 주근 ${columnBarCount(s)}개 · 같은 칸을 다시 지정하면 갱신됩니다 · Ctrl+Z 로 되돌리기`);
  }
 }
 const openCLI=()=>openCardDialog({ctx,title:'기둥 배근도 그리기 · CLI',storageKey:CLI_STORAGE_KEY,
  fields:CLI_FIELDS,sharedFields:CLI_SHARED_FIELDS,slots:2,fixedNames:['사각 기둥','원형 기둥'],slotDefaults:cliSlotDefaults,
  preview:(v,s,o)=>cliPreviewSvg(v,s,o),validate:(v,s)=>{columnEntities(v,s,{x0:0,y0:0,x1:3000,y1:3000});},
  onGo:(v,s)=>drawCLI({...v},s),goLabel:'칸 지정',
  note:'왼쪽에서 사각·원형을 고르고 [칸 지정] → 표의 기둥그림 칸 두 모서리를 찍습니다(아래 문자 영역 제외). 같은 칸을 다시 지정하면 그 칸의 이전 그림과 글씨를 지우고 새로 그립니다.'});

 /* ── BLI ── */
 async function drawBLI(presets,shared){
  const cols=presets.filter(p=>p.on);
  if(!cols.length)throw Error('[표현]을 켠 칸이 하나도 없습니다.');
  const make=box=>cols.flatMap((c,i)=>beamEntities(shared,c,subBox(box,i,cols.length)));
  for(;;){
   const box=await pickCell(`BLI 보 배근도 · ${cols.length}칸 · 보그림이 들어갈 표 칸 두 모서리 (아래 문자 영역 제외) · Esc 중단`,make);
   if(!box)return null;
   const s=beamSizes(shared),lines=Math.max(...cols.map(c=>beamTexts(shared,c).length),0)+1;
   put(make(box),staleIds(box,s.lineGap,lines));
   ctx.toast(`보 배근도 ${Math.round(s.width)}×${Math.round(s.depth)} · ${cols.length}칸${shared.skinOn&&!skinDrawn(shared)?` · 높이가 ${SKIN_MIN_DEPTH} 미만이라 표피철근은 그리지 않았습니다`:''} · Ctrl+Z 로 되돌리기`);
  }
 }
 const openBLI=()=>openCardDialog({ctx,title:'보 배근도 그리기 · BLI',storageKey:BLI_STORAGE_KEY,
  fields:BLI_FIELDS,sharedFields:BLI_SHARED_FIELDS,slots:3,fixedNames:BLI_SLOT_NAMES,slotDefaults:bliSlotDefaults,
  preview:(v,s,o)=>bliPreviewSvg(v,s,o),
  validate:(v,s,m)=>{beamEntities(s,v,{x0:0,y0:0,x1:3000,y1:3000});},
  onGo:(v,s,m,state)=>drawBLI(state.presets,s),goLabel:'칸 지정',
  note:'왼쪽 세 칸이 단부·중앙·단부이며 [표현]을 켠 칸만 그립니다. [칸 지정] → 표의 보그림 칸 두 모서리를 찍으면 칸 수만큼 가로로 나눠 채웁니다.'});

 /* ── BE ── */
 async function drawBE(v,shared){
  for(;;){
   const path=await ctx.pickPath({prompt:`BE 형강 단면 · ${beSummary(v)} · 삽입점 지정 · Esc 중단`,minPoints:1,maxPoints:1,
    preview:(points,cursor)=>{const p=cursor||points[0];if(!p)return [];try{return tint(beEntities(v,shared,p));}catch{return [];}}});
   if(!path)return null;
   put(beEntities(v,shared,path.points[0]));
   ctx.toast(`${beSummary(v)} 단면을 넣었습니다 · Ctrl+Z 로 되돌리기`);
   if(!v.recycle)return null;
  }
 }
 const openBE=()=>openCardDialog({ctx,title:'형강 그리기 · BE',storageKey:BE_STORAGE_KEY,
  fields:BE_FIELDS,sharedFields:BE_SHARED_FIELDS,slots:6,fixedNames:BE_SLOT_NAMES,slotDefaults:beSlotDefaults,
  preview:(v,s,o)=>bePreviewSvg(v,s,o),validate:(v,s)=>{beEntities(v,s,P(0,0));},
  onGo:(v,s)=>drawBE({...v},s),goLabel:'삽입점 지정',
  note:'왼쪽에서 형강 모양을 고르고 [삽입점 지정] → 화면에서 점을 찍으면 그 자리에 단면을 그립니다. H형강만 원문 규격 목록이 있고 나머지는 치수를 직접 넣습니다.'});

 return {
  CLI:()=>{try{openCLI();}catch(e){fail(e);}},
  BLI:()=>{try{openBLI();}catch(e){fail(e);}},
  BE:()=>{try{openBE();}catch(e){fail(e);}},
 };
}
