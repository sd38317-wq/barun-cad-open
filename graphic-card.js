// 그리기 보조명령 카드 3종(달력·태극기·QR). izzarder.com/273(CALENDAR 달력그리기) · /168(DKF 태극기 그리기) · /272(QRC QR 코드 그리기)
// 의 대화상자 항목·기본값·조작 순서를 그대로 옮겼다. 태극기 비례는 대한민국국기법 시행령 별표1(국기의 제작법)을 따르고,
// QR 부호기(바이트 모드·오류정정 M·버전 1~10)는 외부 라이브러리 없이 이 파일 안에 직접 구현했다.
import * as G from './geometry.js';
import {STD_LAYERS,entitiesSvg,openCardDialog,resolveLayers} from './card-kit.js';

export const CALENDAR_STORAGE_KEY='barun-graphic-calendar';
export const QR_STORAGE_KEY='barun-graphic-qr';
export const DKF_WIDTH_KEY='barun-graphic-dkf-width';

/* ── 공통 ── */
/** 채운 면(닫힌 solid 해치). 바른 CAD 에는 폭 있는 폴리선 채움이 없어 solid 해치로 채운다. */
export function solidFace(points,color,layerName){
 return {type:'hatch',points:points.map(p=>({x:p.x,y:p.y})),loops:[],pattern:'solid',solid:true,spacing:100,hatchScale:1,angle:0,color,cardLayer:layerName};
}
/** 미리보기용 변환. card-kit 의 entitiesSvg 는 해치를 그리지 않으므로 닫힌 폴리선으로 바꾼다. */
export function toPreviewEntities(list){
 return (list||[]).map(e=>e.type==='hatch'
  ?{type:'polyline',closed:true,points:e.points,previewColor:e.color||'#c9d1d9'}
  :{...e,previewColor:e.previewColor||e.color||undefined});
}
const arcPoints=(center,r,a0,a1,n)=>{const out=[];for(let i=0;i<=n;i++)out.push(G.add(center,G.polar(r,a0+(a1-a0)*i/n)));return out;};
const rectPoints=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];

/* ══════════════════════════════════════════════════════════════════
   1. CALENDAR · 달력그리기 (원문 izzarder.com/273, 대화상자 "달력그리기")
   원문 항목: 년도 / 한글·영어 / 가로 갯수(1·2·3·4·6·12) / 선 켜 · 주중켜 · 주말켜 /
              한달 크기 가로×세로(+화면지정) / 달간 간격 가로·세로 / 확인·취소
   ══════════════════════════════════════════════════════════════════ */
export const WEEKDAY_KO=Object.freeze(['일','월','화','수','목','금','토']);
export const WEEKDAY_EN=Object.freeze(['SUN','MON','TUE','WED','THU','FRI','SAT']);
export const MONTH_EN=Object.freeze(['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER']);
export const CALENDAR_COLUMNS=Object.freeze(['1','2','3','4','6','12']);

export const isLeapYear=y=>y%4===0&&(y%100!==0||y%400===0);
export function daysInMonth(year,month){
 if(!(month>=1&&month<=12))throw Error('달은 1~12 사이여야 합니다.');
 return [31,isLeapYear(year)?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
}
/** 그 달 1일의 요일. 0=일 … 6=토 (그레고리력, 젤러의 공식) */
export function firstWeekdayOf(year,month){
 if(!(year>=1&&year<=9999))throw Error('년도는 1~9999 사이로 적으세요.');
 let Y=year,M=month;if(M<3){M+=12;Y-=1;}
 const K=Y%100,J=Math.floor(Y/100);
 const h=(1+Math.floor(13*(M+1)/5)+K+Math.floor(K/4)+Math.floor(J/4)+5*J)%7;
 return (h+6)%7;
}
/** 주 단위 격자. 빈 칸은 0. */
export function monthWeeks(year,month){
 const first=firstWeekdayOf(year,month),last=daysInMonth(year,month),weeks=[];
 let row=new Array(7).fill(0);
 for(let d=1;d<=last;d++){
  const w=(first+d-1)%7;row[w]=d;
  if(w===6||d===last){weeks.push(row);row=new Array(7).fill(0);}
 }
 return weeks;
}
export const CALENDAR_FIELDS=[
 {key:'year',label:'년도',type:'number',def:new Date().getFullYear(),min:1,max:9999,step:1,group:'설정'},
 {key:'lang',label:'글자',type:'select',def:'ko',options:[['ko','한글'],['en','영어']],group:'설정'},
 {key:'columns',label:'가로 갯수',type:'select',def:'4',options:CALENDAR_COLUMNS.map(c=>[c,c]),group:'설정'},
 {key:'monthWidth',label:'한달 크기 가로 (mm)',type:'number',def:5000,min:100,step:100,group:'크기'},
 {key:'monthHeight',label:'한달 크기 세로 (mm)',type:'number',def:5000,min:100,step:100,group:'크기'},
 {key:'gapX',label:'달간 간격 가로 (mm)',type:'number',def:500,min:0,step:50,group:'크기'},
 {key:'gapY',label:'달간 간격 세로 (mm)',type:'number',def:500,min:0,step:50,group:'크기'},
];
export const CALENDAR_SHARED_FIELDS=[
 {key:'lineLayer',label:'선 켜',type:'layer',def:STD_LAYERS.symb,group:'켜 설정',hint:'네모 테두리와 달 이름'},
 {key:'weekdayLayer',label:'주중켜',type:'layer',def:STD_LAYERS.text,group:'켜 설정',hint:'월~금 날짜'},
 {key:'weekendLayer',label:'주말켜',type:'layer',def:STD_LAYERS.text,group:'켜 설정',hint:'일·토 날짜 · 색을 달리하려면 다른 켜 이름을 적으세요'},
];
/** 한 해 달력. origin 은 1월 네모의 좌상점. 한 달 네모는 가로 7칸 × 세로 8줄(달 이름 1 + 요일 1 + 주 6). */
export function buildCalendar(origin,v,shared){
 const cols=Math.max(1,Math.round(Number(v.columns)||4));
 const W=Number(v.monthWidth),H=Number(v.monthHeight),gx=Number(v.gapX),gy=Number(v.gapY);
 if(!(W>0&&H>0))throw Error('한달 크기 가로·세로는 0보다 커야 합니다.');
 if(!(gx>=0&&gy>=0))throw Error('달간 간격은 0 이상이어야 합니다.');
 const year=Math.round(Number(v.year));
 const cw=W/7,rh=H/8,dh=Math.min(cw,rh)*0.5,ko=v.lang!=='en';
 const names=ko?WEEKDAY_KO:WEEKDAY_EN,out=[];
 for(let m=1;m<=12;m++){
  const c=(m-1)%cols,r=Math.floor((m-1)/cols);
  const x0=origin.x+c*(W+gx),y0=origin.y-r*(H+gy);
  out.push({type:'polyline',closed:true,points:rectPoints(x0,y0,x0+W,y0-H),cardLayer:shared.lineLayer});
  const title=ko?`${m}월`:MONTH_EN[m-1];
  out.push({type:'text',position:{x:x0+W/2,y:y0-rh/2},text:title,height:Math.min(rh*0.6,W/(title.length*0.75)),rotation:0,align:'center',cardLayer:shared.lineLayer});
  names.forEach((w,i)=>out.push({type:'text',position:{x:x0+cw*(i+0.5),y:y0-rh*1.5},text:w,height:Math.min(dh,cw/(w.length*0.7)),rotation:0,align:'center',cardLayer:(i===0||i===6)?shared.weekendLayer:shared.weekdayLayer}));
  monthWeeks(year,m).forEach((week,wi)=>week.forEach((d,i)=>{
   if(!d)return;
   out.push({type:'text',position:{x:x0+cw*(i+0.5),y:y0-rh*(2.5+wi)},text:String(d),height:dh,rotation:0,align:'center',cardLayer:(i===0||i===6)?shared.weekendLayer:shared.weekdayLayer});
  }));
 }
 const rows=Math.ceil(12/cols);
 return {entities:out,columns:cols,rows,width:cols*W+(cols-1)*gx,height:rows*H+(rows-1)*gy};
}
export function calendarPreviewSvg(v,shared,opts={}){
 const r=buildCalendar({x:0,y:0},v,shared);
 return entitiesSvg(toPreviewEntities(r.entities),{label:opts.compact?'':`${Math.round(Number(v.year))}년 · 가로 ${r.columns}개 · 전체 ${Math.round(r.width)} × ${Math.round(r.height)} mm`,...opts});
}

/* ══════════════════════════════════════════════════════════════════
   2. DKF · 태극기 그리기 (원문 izzarder.com/168)
   원문에 대화상자가 없다. 명령행 순서: "태극기 좌상점 지정:" → "태극기 폭 지정 <3000>:"
   비례는 대한민국국기법 시행령 별표1: 가로:세로 = 3:2, 태극 지름 = 세로의 1/2,
   괘 길이 = 태극지름의 1/2, 괘 너비 = 태극지름의 1/3, 괘와 태극 사이 = 태극지름의 1/4,
   효 너비 = 괘 너비의 1/4, 효 사이·끊어진 효 사이 = 효 너비의 1/2.
   ══════════════════════════════════════════════════════════════════ */
export const DKF_DEFAULT_WIDTH=3000;
export const FLAG_RED='#CD2E3A',FLAG_BLUE='#0047A0',FLAG_BLACK='#000000';
/** 건(좌상) 곤(우하) 감(우상) 이(좌하). true = 이어진 효, false = 끊어진 효 */
export const GWAE_LINES=Object.freeze({geon:[true,true,true],gon:[false,false,false],gam:[false,true,false],ri:[true,false,true]});

export function flagMetrics(width){
 const w=Number(width);
 if(!(w>0))throw Error('태극기 폭은 0보다 큰 수여야 합니다.');
 const h=w*2/3;
 return {width:w,height:h,radius:h/4,diameter:h/2,
  diagonal:G.angle({x:w,y:-h}),
  gwae:{length:h/4,band:h/6,gap:h/8,bar:h/24,space:h/48,distance:11*h/24,halfBar:11*h/96}};
}
/** 태극 문양. 양(빨강)·음(파랑) 두 면의 테두리 점열을 돌려준다.
 *  axisDeg = 깃면의 좌상 → 우하 대각선 방향. 그 선 위쪽이 빨강, 아래쪽이 파랑이고,
 *  왼쪽 반지름을 지름으로 하는 반원은 선 아래로(빨강), 오른쪽 반지름의 반원은 선 위로(파랑) 그린다. */
export function taegeukRegions(center,radius,axisDeg,segments=48){
 const R=Number(radius);
 if(!(R>0))throw Error('태극 반지름은 0보다 커야 합니다.');
 const t=axisDeg,A=G.add(center,G.polar(R,t+180)),B=G.add(center,G.polar(R,t));
 const Cl=G.add(center,G.polar(R/2,t+180)),Cr=G.add(center,G.polar(R/2,t));
 const red=[...arcPoints(center,R,t,t+180,segments*2),
            ...arcPoints(Cl,R/2,t+180,t+360,segments).slice(1),
            ...arcPoints(Cr,R/2,t+180,t,segments).slice(1,-1)];
 const blue=[...arcPoints(center,R,t+180,t+360,segments*2),
             ...arcPoints(Cr,R/2,t,t+180,segments).slice(1),
             ...arcPoints(Cl,R/2,t+360,t+180,segments).slice(1,-1)];
 return {red,blue,axisEnds:[A,B],center:{x:center.x,y:center.y},radius:R,axis:t};
}
/** 괘 하나의 효(막대) 네모들. dirDeg = 중심에서 괘로 향하는 대각선 방향, 효는 그 방향과 직각. */
export function gwaeBars(center,metrics,kind,dirDeg){
 const rows=GWAE_LINES[kind];
 if(!rows)throw Error('괘 이름은 geon·gon·gam·ri 중 하나여야 합니다.');
 const g=metrics.gwae,along=G.polar(1,dirDeg),across=G.polar(1,dirDeg+90);
 const base=G.add(center,G.mul(along,g.distance)),hb=g.bar/2,out=[];
 const quad=(mid,s0,s1)=>[
  G.add(mid,G.add(G.mul(across,s0),G.mul(along,-hb))),
  G.add(mid,G.add(G.mul(across,s1),G.mul(along,-hb))),
  G.add(mid,G.add(G.mul(across,s1),G.mul(along,hb))),
  G.add(mid,G.add(G.mul(across,s0),G.mul(along,hb)))];
 rows.forEach((whole,i)=>{
  const mid=G.add(base,G.mul(along,(i-1)*(g.bar+g.space)));
  if(whole)out.push(quad(mid,-g.length/2,g.length/2));
  else{out.push(quad(mid,-g.length/2,-g.space/2));out.push(quad(mid,g.space/2,g.length/2));}
 });
 return out;
}
/** 태극기 한 장. topLeft 는 깃면의 왼쪽 위 모서리. */
export function buildKoreanFlag(topLeft,width,layerName=STD_LAYERS.symb){
 const m=flagMetrics(width);
 const x0=topLeft.x,y0=topLeft.y,center={x:x0+m.width/2,y:y0-m.height/2};
 const out=[{type:'polyline',closed:true,points:rectPoints(x0,y0,x0+m.width,y0-m.height),cardLayer:layerName}];
 const t=taegeukRegions(center,m.radius,m.diagonal);
 out.push(solidFace(t.red,FLAG_RED,layerName),solidFace(t.blue,FLAG_BLUE,layerName));
 const d1=m.diagonal,d2=-m.diagonal;
 for(const [kind,dir] of [['geon',d1+180],['gon',d1],['gam',d2],['ri',d2+180]])
  for(const q of gwaeBars(center,m,kind,dir))out.push(solidFace(q,FLAG_BLACK,layerName));
 return {entities:out,metrics:m,center,taegeuk:t};
}
export function flagPreviewSvg(topLeft,width,opts={}){
 const r=buildKoreanFlag(topLeft,width);
 return entitiesSvg(toPreviewEntities(r.entities),{label:opts.compact?'':`태극기 ${Math.round(r.metrics.width)} × ${Math.round(r.metrics.height)} mm`,...opts});
}

/* ══════════════════════════════════════════════════════════════════
   3. QRC · QR 코드 그리기 (원문 izzarder.com/272, 대화상자 "QR 그리기")
   원문 항목: 내용(URL·영문/특수문자) / 방식(블럭·그룹) / 크기(1 × 선축척) / 켜 / 확인·취소
   부호기: 바이트 모드, 오류정정 M, 버전 1~10 (ISO/IEC 18004)
   ══════════════════════════════════════════════════════════════════ */
const GF_EXP=new Uint8Array(512),GF_LOG=new Uint8Array(256);
{let x=1;for(let i=0;i<255;i++){GF_EXP[i]=x;GF_LOG[x]=i;x<<=1;if(x&0x100)x^=0x11d;}for(let i=255;i<512;i++)GF_EXP[i]=GF_EXP[i-255];}
export const gfMul=(a,b)=>(a&&b)?GF_EXP[GF_LOG[a]+GF_LOG[b]]:0;
/** 리드-솔로몬 생성 다항식(차수 높은 쪽부터) */
export function rsGenerator(degree){
 let g=[1];
 for(let i=0;i<degree;i++){
  const r=new Array(g.length+1).fill(0);
  for(let j=0;j<g.length;j++){r[j]^=g[j];r[j+1]^=gfMul(g[j],GF_EXP[i]);}
  g=r;
 }
 return g;
}
/** 자료 코드워드 → 오류정정 코드워드 */
export function rsEncode(data,ecLength){
 const g=rsGenerator(ecLength),res=[...data,...new Array(ecLength).fill(0)];
 for(let i=0;i<data.length;i++){
  const f=res[i];if(!f)continue;
  for(let j=0;j<g.length;j++)res[i+j]^=gfMul(g[j],f);
 }
 return res.slice(data.length);
}
/** 오류정정 M 의 블록 구성 [오류정정 코드워드 수, 1군 블록수, 1군 자료수, 2군 블록수, 2군 자료수] */
export const QR_M_BLOCKS=Object.freeze({
 1:[10,1,16,0,0],2:[16,1,28,0,0],3:[26,1,44,0,0],4:[18,2,32,0,0],5:[24,2,43,0,0],
 6:[16,4,27,0,0],7:[18,4,31,0,0],8:[22,2,38,2,39],9:[22,3,36,2,37],10:[26,4,43,1,44]});
export const QR_MIN_VERSION=1,QR_MAX_VERSION=10;
export const qrSize=version=>version*4+17;
export function qrDataCodewords(version){
 const b=QR_M_BLOCKS[version];
 if(!b)throw Error(`QR 버전은 ${QR_MIN_VERSION}~${QR_MAX_VERSION} 만 됩니다.`);
 return b[1]*b[2]+b[3]*b[4];
}
export const qrCountBits=version=>version<10?8:16;
export function qrCapacityBytes(version){return Math.floor((qrDataCodewords(version)*8-4-qrCountBits(version))/8);}
export function qrPickVersion(byteLength,max=QR_MAX_VERSION){
 for(let v=QR_MIN_VERSION;v<=max;v++)if(qrCapacityBytes(v)>=byteLength)return v;
 throw Error(`내용이 너무 깁니다. 이 카드의 QR 은 버전 ${max}(바이트 모드·오류정정 M)까지라 최대 ${qrCapacityBytes(max)} 바이트입니다.`);
}
export function qrTextBytes(text){return [...new TextEncoder().encode(String(text))];}
/** 바이트 모드 비트열 → 자료 코드워드(채움 코드워드 0xEC·0x11 포함) */
export function qrDataBits(bytes,version){
 const bits=[],push=(val,n)=>{for(let i=n-1;i>=0;i--)bits.push((val>>>i)&1);};
 const cap=qrDataCodewords(version)*8;
 push(4,4);push(bytes.length,qrCountBits(version));
 for(const b of bytes)push(b&0xff,8);
 if(bits.length>cap)throw Error('내용이 이 QR 버전의 용량을 넘었습니다.');
 for(let i=0;i<4&&bits.length<cap;i++)bits.push(0);
 while(bits.length%8)bits.push(0);
 const pads=[0xEC,0x11];let k=0;
 while(bits.length<cap)push(pads[k++%2],8);
 const words=[];
 for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|bits[i+j];words.push(b);}
 return words;
}
/** 블록으로 나누고 오류정정을 붙여 섞은 최종 코드워드 */
export function qrCodewords(text,version){
 const data=qrDataBits(qrTextBytes(text),version),[ec,b1,d1,b2,d2]=QR_M_BLOCKS[version];
 const blocks=[];let p=0;
 for(let i=0;i<b1;i++){blocks.push(data.slice(p,p+d1));p+=d1;}
 for(let i=0;i<b2;i++){blocks.push(data.slice(p,p+d2));p+=d2;}
 const ecs=blocks.map(b=>rsEncode(b,ec)),out=[],longest=Math.max(...blocks.map(b=>b.length));
 for(let i=0;i<longest;i++)for(const b of blocks)if(i<b.length)out.push(b[i]);
 for(let i=0;i<ec;i++)for(const e of ecs)out.push(e[i]);
 return out;
}
export function qrAlignmentPositions(version){
 if(version===1)return [];
 const count=Math.floor(version/7)+2,size=qrSize(version);
 const step=Math.ceil((version*4+4)/(count*2-2))*2,out=[6];
 for(let p=size-7;out.length<count;p-=step)out.splice(1,0,p);
 return out;
}
/** 형식 정보 15비트(오류정정 M 고정, BCH(15,5), 0x5412 로 뒤섞음) */
export function qrFormatBits(mask){
 if(!(mask>=0&&mask<=7))throw Error('마스크는 0~7 입니다.');
 const data=(0<<3)|mask;let rem=data;
 for(let i=0;i<10;i++)rem=(rem<<1)^(((rem>>>9)&1)*0x537);
 return ((data<<10|rem)^0x5412)&0x7fff;
}
/** 버전 정보 18비트(버전 7 이상, BCH(18,6)) */
export function qrVersionBits(version){
 if(version<7)return 0;
 let rem=version;
 for(let i=0;i<12;i++)rem=(rem<<1)^(((rem>>>11)&1)*0x1F25);
 return (version<<12|rem)&0x3ffff;
}
export const QR_MASKS=Object.freeze([
 (r,c)=>(r+c)%2===0,
 r=>r%2===0,
 (r,c)=>c%3===0,
 (r,c)=>(r+c)%3===0,
 (r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,
 (r,c)=>(r*c)%2+(r*c)%3===0,
 (r,c)=>((r*c)%2+(r*c)%3)%2===0,
 (r,c)=>((r+c)%2+(r*c)%3)%2===0,
]);
/** 마스크 벌점(ISO/IEC 18004 8.8.2) */
export function qrPenalty(m){
 const n=m.length;let p=0;
 const runs=get=>{for(let i=0;i<n;i++){let run=1,prev=get(i,0);
  for(let j=1;j<n;j++){const cur=get(i,j);if(cur===prev)run++;else{if(run>=5)p+=3+(run-5);run=1;prev=cur;}}
  if(run>=5)p+=3+(run-5);}};
 runs((i,j)=>m[i][j]);runs((i,j)=>m[j][i]);
 for(let r=0;r<n-1;r++)for(let c=0;c<n-1;c++){const a=m[r][c];if(a===m[r][c+1]&&a===m[r+1][c]&&a===m[r+1][c+1])p+=3;}
 // 1:1:3:1:1 무늬 앞뒤의 밝은 4칸. 기호 바깥쪽은 밝은 것으로 본다(ISO/IEC 18004).
 const finder=[true,false,true,true,true,false,true],blank=[false,false,false,false];
 const seqA=[...finder,...blank],seqB=[...blank,...finder];
 const scan=get=>{for(let i=0;i<n;i++){
  const line=[false,false,false,false,...Array.from({length:n},(_,j)=>get(i,j)),false,false,false,false];
  for(let j=0;j+11<=line.length;j++){
   let a=true,b=true;
   for(let k=0;k<11;k++){const v=line[j+k];if(v!==seqA[k])a=false;if(v!==seqB[k])b=false;}
   if(a)p+=40;if(b)p+=40;}}};
 scan((i,j)=>m[i][j]);scan((i,j)=>m[j][i]);
 let dark=0;for(const row of m)for(const v of row)if(v)dark++;
 const total=n*n;
 p+=(Math.ceil(Math.abs(dark*20-total*10)/total)-1)*10;
 return p;
}
function qrDrawFormat(m,mask){
 const size=m.length,bits=qrFormatBits(mask),bit=i=>((bits>>>i)&1)===1;
 for(let i=0;i<=5;i++)m[i][8]=bit(i);
 m[7][8]=bit(6);m[8][8]=bit(7);m[8][7]=bit(8);
 for(let i=9;i<15;i++)m[8][14-i]=bit(i);
 for(let i=0;i<8;i++)m[8][size-1-i]=bit(i);
 for(let i=8;i<15;i++)m[size-15+i][8]=bit(i);
 m[size-8][8]=true;
}
/** QR 모듈 격자. modules[행][열] = true(검은 칸). 행 0 이 위쪽. */
export function qrEncode(text,{version=null,mask=null}={}){
 const bytes=qrTextBytes(text);
 if(!bytes.length)throw Error('QR 로 만들 내용을 적으세요.');
 const v=version||qrPickVersion(bytes.length),size=qrSize(v);
 if(!QR_M_BLOCKS[v])throw Error(`QR 버전은 ${QR_MIN_VERSION}~${QR_MAX_VERSION} 만 됩니다.`);
 const base=Array.from({length:size},()=>new Array(size).fill(false));
 const fn=Array.from({length:size},()=>new Array(size).fill(false));
 const setFn=(r,c,dark)=>{if(r<0||c<0||r>=size||c>=size)return;base[r][c]=dark;fn[r][c]=true;};
 // 타이밍 먼저, 찾기무늬 나중(찾기무늬가 타이밍의 바깥쪽을 덮는다)
 for(let i=0;i<size;i++){setFn(6,i,i%2===0);setFn(i,6,i%2===0);}
 for(const [fr,fc] of [[3,3],[3,size-4],[size-4,3]])
  for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
   const d=Math.max(Math.abs(dx),Math.abs(dy));setFn(fr+dy,fc+dx,d!==2&&d!==4);}
 const pos=qrAlignmentPositions(v);
 for(let i=0;i<pos.length;i++)for(let j=0;j<pos.length;j++){
  if((i===0&&j===0)||(i===0&&j===pos.length-1)||(i===pos.length-1&&j===0))continue;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)setFn(pos[i]+dy,pos[j]+dx,Math.max(Math.abs(dx),Math.abs(dy))!==1);
 }
 for(let i=0;i<=8;i++)if(i!==6){setFn(8,i,false);setFn(i,8,false);}
 for(let i=0;i<8;i++)setFn(8,size-1-i,false);
 for(let i=0;i<7;i++)setFn(size-7+i,8,false);
 setFn(size-8,8,true);
 if(v>=7)for(let i=0;i<18;i++){const a=size-11+i%3,b=Math.floor(i/3);setFn(b,a,false);setFn(a,b,false);}
 const words=qrCodewords(text,v),bits=[];
 for(const w of words)for(let i=7;i>=0;i--)bits.push((w>>>i)&1);
 let k=0;
 for(let right=size-1;right>=1;right-=2){
  if(right===6)right=5;
  for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){
   const col=right-j,upward=((right+1)&2)===0,row=upward?size-1-vert:vert;
   if(fn[row][col])continue;
   base[row][col]=k<bits.length?bits[k++]===1:false;
  }
 }
 let best=null;
 for(const mk of (mask===null?[0,1,2,3,4,5,6,7]:[mask])){
  const grid=base.map((row,r)=>row.map((val,c)=>fn[r][c]?val:(QR_MASKS[mk](r,c)?!val:val)));
  qrDrawFormat(grid,mk);
  if(v>=7){const vb=qrVersionBits(v);
   for(let i=0;i<18;i++){const bit=((vb>>>i)&1)===1,a=size-11+i%3,b=Math.floor(i/3);grid[b][a]=bit;grid[a][b]=bit;}}
  const penalty=qrPenalty(grid);
  if(!best||penalty<best.penalty)best={mask:mk,modules:grid,penalty};
 }
 return {version:v,size,mask:best.mask,penalty:best.penalty,modules:best.modules,codewords:words,isFunction:fn};
}
/** 행마다 이어진 검은 칸을 묶는다(해치 갯수를 줄인다) */
export function qrRuns(modules){
 const out=[];
 modules.forEach((row,r)=>{let s=-1;
  for(let c=0;c<=row.length;c++){
   const dark=c<row.length&&row[c];
   if(dark&&s<0)s=c;
   if(!dark&&s>=0){out.push({row:r,from:s,to:c});s=-1;}
  }});
 return out;
}
/** QR 객체. topLeft 는 QR 왼쪽 위 칸의 좌상점, cell 은 한 칸 크기(mm). */
export function buildQrCode(topLeft,cell,modules,layerName=STD_LAYERS.symb){
 if(!(cell>0))throw Error('QR 한 칸 크기는 0보다 커야 합니다.');
 return qrRuns(modules).map(r=>{
  const x0=topLeft.x+r.from*cell,x1=topLeft.x+r.to*cell,y0=topLeft.y-r.row*cell;
  return solidFace(rectPoints(x0,y0,x1,y0-cell),FLAG_BLACK,layerName);
 });
}
export const qrCellSize=(size,lineScale)=>{
 const s=Number(size),l=Number(lineScale);
 if(!(s>0)||!(l>0))throw Error('크기와 선축척은 0보다 큰 수여야 합니다.');
 return s*l;
};
export const QR_FIELDS=[
 {key:'content',label:'내용 (필수)',type:'text',def:'',group:'설정',hint:'주소·문구를 직접 적습니다. 영문·숫자·특수문자 권장. 한글도 넣을 수 있으나 스캔하면 글자가 깨집니다.'},
 {key:'method',label:'방식',type:'select',def:'group',options:[['block','블럭'],['group','그룹']],group:'설정',hint:'바른 CAD 에는 무명그룹이 없어 [그룹]은 낱개 객체로 둡니다.'},
 {key:'size',label:'크기',type:'number',def:1,min:0.01,step:0.1,group:'설정',hint:'한 칸 크기 = 크기 × 선축척 (mm)'},
 {key:'lineScale',label:'선축척',type:'number',def:100,min:0.01,step:1,group:'설정',hint:'카드 문맥이 도면 선축척을 읽지 못해 직접 적습니다.'},
];
export const QR_SHARED_FIELDS=[
 {key:'qrLayer',label:'켜',type:'layer',def:STD_LAYERS.symb,group:'켜 설정'},
];
export function qrPreviewSvg(v,shared,opts={}){
 const r=qrEncode(v.content),cell=qrCellSize(v.size,v.lineScale);
 const es=buildQrCode({x:0,y:0},cell,r.modules,shared.qrLayer);
 return entitiesSvg(toPreviewEntities(es),{label:opts.compact?'':`버전 ${r.version} · ${r.size} × ${r.size} 칸 · 한 칸 ${Math.round(cell*100)/100} mm · 마스크 ${r.mask}`,...opts});
}

/* ══════════════════════════════════════════════════════════════════
   설치. 통합 담당이 Object.assign(cardCommands,installGraphicCards(cardContext)) 로 붙인다.
   ══════════════════════════════════════════════════════════════════ */
export function installGraphicCards(ctx){
 const fail=e=>{console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);};
 const readWidth=()=>{const n=Number(ctx.storage?.getItem(DKF_WIDTH_KEY));return Number.isFinite(n)&&n>0?n:DKF_DEFAULT_WIDTH;};
 const saveWidth=w=>{try{ctx.storage?.setItem(DKF_WIDTH_KEY,String(w));}catch{}};

 /* ── CALENDAR ── */
 async function drawCalendar(v,shared,method){
  let values=v;
  if(method==='screen'){
   const box=await ctx.pickPath({prompt:'한달 네모 크기 지정 · ① 한 모서리 ② 반대쪽 모서리 · Esc 중단',minPoints:2,maxPoints:2,
    preview:(points,cursor)=>{const a=points[0],b=cursor||points[1];if(!a||!b)return [];
     return [{type:'polyline',closed:true,points:rectPoints(a.x,a.y,b.x,b.y),previewColor:'#ffd479'}];}});
   if(!box)return null;
   const [a,b]=box.points,W=Math.abs(b.x-a.x),H=Math.abs(b.y-a.y);
   if(!(W>0&&H>0))throw Error('가로·세로가 0 이 아닌 네모를 찍으세요.');
   values={...v,monthWidth:W,monthHeight:H};
  }
  const path=await ctx.pickPath({prompt:`${Math.round(Number(values.year))}년 달력 · 왼쪽 위(1월 네모의 좌상점) 지정 · Esc 중단`,minPoints:1,maxPoints:1,
   preview:(points,cursor)=>{const p=cursor||points[0];if(!p)return [];
    try{return toPreviewEntities(buildCalendar(p,values,shared).entities);}catch{return [];}}});
  if(!path)return null;
  const r=buildCalendar(path.points[0],values,shared);
  const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities)});
  ctx.toast(`${Math.round(Number(values.year))}년 달력 12개월(가로 ${r.columns}개) · 전체 ${Math.round(r.width)} × ${Math.round(r.height)} mm · Ctrl+Z 로 되돌리기`);
  return ids;
 }
 const openCalendar=()=>openCardDialog({ctx,title:'달력그리기 · CALENDAR',storageKey:CALENDAR_STORAGE_KEY,
  fields:CALENDAR_FIELDS,sharedFields:CALENDAR_SHARED_FIELDS,slots:4,fixedNames:['CALENDAR 기본'],
  preview:(v,s,o)=>calendarPreviewSvg(v,s,o),
  methods:{legend:'한달 크기',def:'value',options:[['value','입력한 크기 사용','위의 한달 크기 가로·세로 값'],['screen','화면지정','두 모서리를 찍어 한달 네모 크기를 정합니다']]},
  validate:v=>{const y=Number(v.year);if(!Number.isFinite(y)||y<1||y>9999||Math.round(y)!==y)throw Error('년도는 1~9999 사이 정수로 적으세요.');},
  goLabel:'확인',
  onGo:(v,s,method)=>drawCalendar(v,s,method),
  note:'원문(izzarder.com/273)의 항목을 그대로 옮겼습니다. 1년 12달을 한 번에 그립니다. 원문에는 없는 삽입점 지정이 한 번 있습니다(바른 CAD 에는 기준점 개념이 없습니다).'});

 /* ── DKF ── 원문에 대화상자가 없다. 좌상점 → 폭 순서 그대로. */
 async function drawFlag(){
  const width=readWidth();
  const path=await ctx.pickPath({prompt:'태극기 좌상점 지정 · Esc 중단',minPoints:1,maxPoints:1,
   preview:(points,cursor)=>{const p=cursor||points[0];if(!p)return [];
    try{return toPreviewEntities(buildKoreanFlag(p,width).entities);}catch{return [];}}});
  if(!path)return null;
  const topLeft=path.points[0];
  ctx.askNumber({title:'태극기 그리기 · DKF',label:`태극기 폭 지정 (mm) · 기본 ${DKF_DEFAULT_WIDTH}`,value:width},async w=>{
   try{
    saveWidth(w);
    const r=buildKoreanFlag(topLeft,w);
    ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities)});
    ctx.toast(`태극기 ${Math.round(r.metrics.width)} × ${Math.round(r.metrics.height)} mm · 대한민국국기법 시행령 비례 · Ctrl+Z 로 되돌리기`);
   }catch(e){fail(e);}
  });
  return true;
 }

 /* ── QRC ── */
 async function drawQr(v,shared){
  const code=qrEncode(v.content),cell=qrCellSize(v.size,v.lineScale);
  const path=await ctx.pickPath({prompt:`QR 코드 삽입점 지정(왼쪽 위) · 버전 ${code.version} · ${code.size} × ${code.size} 칸 · Esc 중단`,minPoints:1,maxPoints:1,
   preview:(points,cursor)=>{const p=cursor||points[0];if(!p)return [];
    try{return toPreviewEntities(buildQrCode(p,cell,code.modules,shared.qrLayer));}catch{return [];}}});
  if(!path)return null;
  const topLeft=path.points[0],cells=buildQrCode(topLeft,cell,code.modules,shared.qrLayer);
  const resolved=resolveLayers(ctx,cells);
  const entities=v.method==='block'
   ?[{type:'block',name:`QR-${Date.now().toString(36)}`,position:{x:topLeft.x,y:topLeft.y},layer:resolved[0]?.layer,entities:resolved}]
   :resolved;
  const ids=ctx.commit({removeIds:[],entities});
  const side=Math.round(code.size*cell*100)/100;
  ctx.toast(`QR 코드 버전 ${code.version} · ${side} × ${side} mm · ${v.method==='block'?'블럭 하나로 묶음':'낱개 객체(바른 CAD 에는 무명그룹이 없습니다)'} · 스캔하려면 둘레에 4칸 여백을 두세요 · Ctrl+Z 로 되돌리기`);
  if(qrTextBytes(v.content).some(b=>b>0x7e||b<0x20))ctx.toast('한글·제어문자가 들어 있습니다. 원문 안내대로 스캔하면 글자가 깨질 수 있습니다.',true);
  return ids;
 }
 const openQr=()=>openCardDialog({ctx,title:'QR 그리기 · QRC',storageKey:QR_STORAGE_KEY,
  fields:QR_FIELDS,sharedFields:QR_SHARED_FIELDS,slots:4,fixedNames:['QRC 기본'],
  preview:(v,s,o)=>qrPreviewSvg(v,s,o),
  validate:v=>{const bytes=qrTextBytes(v.content);if(!bytes.length)throw Error('내용을 적으세요.');qrPickVersion(bytes.length);},
  goLabel:'확인',
  onGo:(v,s)=>drawQr(v,s),
  note:'원문(izzarder.com/272)의 항목을 그대로 옮겼습니다. 바이트 모드·오류정정 M·버전 1~10 까지 만듭니다. 스캔하려면 QR 둘레에 4칸 여백이 필요합니다.'});

 return {
  CALENDAR:()=>openCalendar(),
  DKF:()=>drawFlag().catch(fail),
  QRC:()=>openQr(),
 };
}
