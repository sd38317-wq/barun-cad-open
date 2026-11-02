import * as G from './geometry.js';
import {architecture,measure} from './architecture.js';
import {distributeDimensions} from './dim-tools-4.js';

// Native replacements for the four drafting utilities; edits use one engine batch.
export function nativeDraftingEdits(command,entities,options={}){
 const update=(e,changes)=>({type:'update',ids:[e.id],changes});
 if(command==='PC'){
  const targets=entities.filter(e=>e.type==='polyline'&&!e.closed);
  if(!targets.length)throw Error('열린 폴리선을 선택하세요.');
  // 2점 폴리선은 닫을 수 없으므로 그것만 건너뛴다 — 하나 섞였다고 선택 전체를 거부하면 안내문과 동작이 어긋난다.
  const closable=targets.filter(e=>e.points.length>=3);
  if(!closable.length)throw Error('닫을 폴리선에는 세 점 이상 필요합니다. 2점 선은 그대로 유지합니다.');
  return closable.map(e=>update(e,{closed:true}));
 }
 if(command==='TALIGN'){
  const axis=String(options.axis||'X').toLowerCase(),value=Number(options.value);
  if(!['x','y'].includes(axis)||!Number.isFinite(value))throw Error('정렬 축과 기준 좌표를 확인하세요.');
  const targets=entities.filter(e=>e.type==='text');if(!targets.length)throw Error('정렬할 문자를 선택하세요.');
  return targets.map(e=>update(e,{position:{...e.position,[axis]:value}}));
 }
 if(command==='DIMCLEAN'){
  const gap=Number(options.gap);if(!Number.isFinite(gap)||gap<0)throw Error('치수 간격은 0(자동) 또는 양수여야 합니다.');
  // 간격 0 = 자동(ACAD200 517): 평행한 치수끼리 첫·끝을 지키고 사이를 고르게. 겹치지 않는 치수는 같은 줄.
  if(gap===0)return distributeDimensionEdits(entities,update);
  const targets=entities.filter(e=>e.type==='dimension'&&['horizontal','vertical','aligned'].includes(e.mode));
  if(!targets.length)throw Error('수평·수직·정렬 치수를 선택하세요.');
  const placed=[],edits=[];
  for(const e of targets){
   const [a,b,p]=e.points;
   let u=['horizontal','vertical'].includes(e.mode)?G.polar(1,e.axisAngle??(e.mode==='horizontal'?0:90)):G.unit(G.sub(b,a));
   if(u.x<-G.EPS||(Math.abs(u.x)<G.EPS&&u.y<0))u=G.mul(u,-1);
   const n=G.normal(u),lo=Math.min(G.dot(a,u),G.dot(b,u)),hi=Math.max(G.dot(a,u),G.dot(b,u));
   const baseline=(G.dot(a,n)+G.dot(b,n))/2,original=G.dot(p,n),side=original<baseline?-1:1;
   let offset=original;
   const neighbors=placed.filter(q=>Math.abs(G.cross(u,q.u))<1e-6&&Math.min(hi,q.hi)>=Math.max(lo,q.lo)-G.EPS);
   // Each pass moves beyond a conflicting line; bounded by the number of neighbors.
   for(let pass=0;pass<=neighbors.length;pass++){
    const conflict=neighbors.find(q=>Math.abs(offset-q.offset)<gap-1e-7);
    if(!conflict)break;offset=conflict.offset+side*gap;
   }
   placed.push({u,lo,hi,offset});
   if(Math.abs(offset-original)>G.EPS)edits.push(update(e,{points:[a,b,G.add(p,G.mul(n,offset-original))]}));
  }
  return edits;
 }
 throw Error('지원하지 않는 자체 작도 명령입니다.');
}
function distributeDimensionEdits(entities,update){
 const targets=entities.filter(e=>e.type==='dimension'&&['horizontal','vertical','aligned'].includes(e.mode));
 if(!targets.length)throw Error('수평·수직·정렬 치수를 선택하세요.');
 const axis=e=>{const [a,b]=e.points;let u=['horizontal','vertical'].includes(e.mode)?G.polar(1,e.axisAngle??(e.mode==='horizontal'?0:90)):G.unit(G.sub(b,a));if(u.x<-G.EPS||(Math.abs(u.x)<G.EPS&&u.y<0))u=G.mul(u,-1);return u;};
 const groups=[];
 for(const e of targets){const u=axis(e),group=groups.find(g=>Math.abs(G.cross(g.u,u))<1e-6);if(group)group.dims.push(e);else groups.push({u,dims:[e]});}
 const edits=[];
 for(const {dims} of groups){if(dims.length<2)continue;distributeDimensions(dims).forEach((next,i)=>{if(G.dist(next.points[2],dims[i].points[2])>G.EPS)edits.push(update(dims[i],{points:next.points}));});}
 return edits;
}
export function nativeLength(entities){
 const targets=entities.filter(e=>['line','polyline','rectangle','circle','arc','ellipse'].includes(e.type));
 if(!targets.length)throw Error('길이를 합산할 선·폴리선·원·호·타원을 선택하세요.');
 return {count:targets.length,ignored:entities.length-targets.length,length:targets.reduce((sum,e)=>sum+measure(e).length,0),approximate:targets.some(e=>e.type==='ellipse')};
}
const p=(x,y)=>({x,y});
const n=(key,label,value,min=0)=>({name:key,label,value,type:'number',min});
const c=(key,label,value,options)=>({name:key,label,value,options});
const t=(key,label,value)=>({name:key,label,value});
const width=n('width','폭 (mm)',1200,1),depth=n('depth','깊이 (mm)',200,1),textHeight=n('textHeight','문자 높이 (mm)',150,1);
export const ARCH_LINKS={WAD:'WALL',PL2:'PLINE',CLN:'PLINE',R4:'ROOM',TSD:'ARCHLIB',TSD2:'ARCHLIB',DRAW:'ARCHLIB',WCT:'WALLJOIN'};
export function parallelWallPair(entities){
 if(entities.length!==2||entities.some(e=>e.type!=='line'||e.points?.length!==2))throw Error('평행한 벽선 두 개를 선택하세요.');
 const [a,b]=entities,[start,end]=a.points,u=G.unit(G.sub(end,start)),length=G.dist(start,end);if(length<G.EPS||Math.abs(G.cross(u,G.unit(G.sub(b.points[1],b.points[0]))))>1e-6)throw Error('서로 평행한 직선만 선택하세요.');
 const normal=G.normal(u),offset=G.dot(G.sub(b.points[0],start),normal),projections=b.points.map(q=>G.dot(G.sub(q,start),u)),lo=Math.max(0,Math.min(...projections)),hi=Math.min(length,Math.max(...projections));if(Math.abs(offset)<G.EPS||hi<=lo)throw Error('벽 두께와 겹치는 길이가 필요합니다.');
 return {u,normal,offset,lo,hi,start,center:[G.add(start,G.add(G.mul(u,lo),G.mul(normal,offset/2))),G.add(start,G.add(G.mul(u,hi),G.mul(normal,offset/2)))]};
}
export function wallLineOpening(entities,offset,width){
 const wall=parallelWallPair(entities);if(!Number.isFinite(offset)||!Number.isFinite(width)||offset<0||width<=0||offset+width>wall.hi-wall.lo)throw Error('개구부가 두 벽선의 공통 길이 안에 있어야 합니다.');
 const lo=wall.lo+offset,hi=lo+width,result=[];for(const e of entities){const [a,b]=e.points,pa=G.dot(G.sub(a,wall.start),wall.u),pb=G.dot(G.sub(b,wall.start),wall.u),low=Math.min(pa,pb),high=Math.max(pa,pb),base=pa<pb?a:b,point=v=>G.add(base,G.mul(wall.u,v-low));for(const [s,t]of [[low,lo],[hi,high]])if(t-s>G.EPS){const {id,...part}=e;result.push({...part,points:[point(s),point(t)]});}}
 const style=entities[0];for(const at of [lo,hi]){const a=G.add(wall.start,G.mul(wall.u,at));result.push({type:'line',layer:style.layer,...(style.color?{color:style.color}:{}),points:[a,G.add(a,G.mul(wall.normal,wall.offset))]});}
 return result;
}
export function architecturalCounts(entities,mode){
 const groups=new Map(),add=key=>{if(String(key).trim())groups.set(String(key).trim(),(groups.get(String(key).trim())||0)+1);};
 if(mode==='BLIST')for(const e of entities.filter(e=>e.type==='block'&&!e.table))add(e.attributes?.mark||e.name);
 if(mode==='TLIST')for(const e of entities.filter(e=>!e.table).flatMap(G.primitives).filter(e=>e.type==='text'))add(e.text);
 if(mode==='WLIST'){
  const standalone=entities.filter(e=>e.type!=='block'),texts=standalone.filter(e=>e.type==='text'),used=new Set();
  for(const e of entities.filter(e=>e.type==='block'&&['DOOR','WINDOW','OPENINGTAG'].includes(e.category)))add(e.attributes?.mark||e.parameters?.mark||e.name);
  for(const frame of standalone.filter(e=>['circle','ellipse','rectangle'].includes(e.type)||e.type==='polyline'&&e.closed)){
   const inside=q=>frame.type==='circle'?G.dist(frame.center,q)<frame.radius:G.inside(q,G.vertices(frame));const matches=texts.filter(e=>!used.has(e)&&inside(e.position)).sort((a,b)=>b.position.y-a.position.y||a.position.x-b.position.x);if(matches.length){add(matches.map(e=>e.text.trim()).join('|'));for(const e of matches)used.add(e);}
  }
 }
 return [['기호 / 이름','수량'],...[...groups].sort(([a],[b])=>a.localeCompare(b,'ko',{numeric:true}))];
}
/* 2026-09-21 4차: SCB·CDT·SECLINE·TBOX 는 바른 CAD 리습 카드 SCB·CM·SSL·TX 가 같은 기능으로 대체해 여기서 뺐다(중복 카드 금지). */
export const ARCH_LIBRARY={
 EED:{label:'에너지 입면 전개',fields:[t('positions','수직선 위치 mm (쉼표 구분)','0,900,2100,3000,4200,6000'),n('height','전체 높이',3000,1),t('levels','중간 수평선 높이 mm','900,2400'),c('dimensions','치수선','yes',[['yes','표시'],['no','없음']]),textHeight]},
 DOD:{label:'문 상세',kind:'DOOR',fields:[width,depth,c('style','문 형태','single',[['single','외여닫이'],['double','양개'],['unequal','비대칭 양개'],['sliding','미닫이'],['doubleSliding','양쪽 미닫이'],['pocket','포켓도어'],['folding','접이문']]),n('leafThickness','문짝 두께',40,1),n('openingAngle','열림 각도',90,1),n('frameWidth','문틀 폭',40,1),c('hand','경첩','left',[['left','왼쪽'],['right','오른쪽']]),c('side','열림 방향','positive',[['positive','기준선 왼쪽'],['negative','기준선 오른쪽']]),c('threshold','문턱','none',[['none','없음'],['sill','있음']]),n('height','문 높이',2100,1)]},
 WID:{label:'창문 상세',kind:'WINDOW',fields:[width,depth,c('style','창 형태','sliding',[['fixed','고정'],['sliding','미닫이'],['casement','여닫이'],['awning','프로젝트창'],['tiltTurn','틸트앤턴']]),n('frameWidth','창틀 폭',50,1),n('height','창 높이',1500,1),n('sill','창 하부 높이',900)]},
 STD:{label:'계단 평면',kind:'STAIR',fields:[width,n('floorHeight','층고',3000,1),n('targetRiser','목표 단높이',170,1),n('run','디딤판 깊이',280,1),c('layout','형태','u',[['straight','직선'],['l','ㄱ자'],['u','ㄷ자']]),n('landing','참 깊이',1200,1),n('gap','중앙 간격',100),n('nosing','논슬립 폭',30),c('rails','난간','both',[['both','양쪽'],['left','첫째 측'],['right','반대 측'],['none','없음']])]},
 STDC:{label:'곡선 계단 평면',kind:'CURVESTAIR',fields:[width,n('radius','내측 반지름',1500,1),n('sweep','회전각',180,1),n('count','디딤판 수',18,2)]},
 STSD:{label:'계단 단면',fields:[n('floorHeight','층고',3000,1),n('count','단수',18,2),n('run','디딤판 깊이',280,1),n('waist','계단판 두께',150,1),n('landing','상부 참 길이',1200,1),n('railHeight','난간 높이 (0: 없음)',900),n('nosing','코 돌출',30),textHeight]},
 PKD:{label:'주차구획',fields:[n('width','구획 폭',2500,1),n('depth','구획 길이',5000,1),n('count','구획 수',5,1),n('parkingAngle','주차 각도 (30~90도)',90,30),n('startNumber','시작 번호',1),c('stopper','스토퍼','yes',[['yes','표시'],['no','없음']]),textHeight]},
 PID:{label:'기초 파일 평면',fields:[n('diameter','파일 외경',500,1),n('wall','관벽 두께',80,1),n('rows','행 수',2,1),n('columns','열 수',3,1),n('spacingX','가로 간격',1500,1),n('spacingY','세로 간격',1500,1),t('mark','번호 접두어','P'),textHeight]},
 DECK:{label:'데크플레이트 단면',fields:[n('length','전체 길이',3000,1),n('pitch','반복 피치',300,1),n('height','골 높이',75,1),n('top','상부 평탄 폭',100,1),n('bottom','하부 평탄 폭',100,1),n('thickness','판 두께',1.2,0.1)]},
 JAD:{label:'잡석 단면 표현',fields:[n('length','길이',3000,1),n('depth','두께',300,1),n('pitch','입자 간격',120,1)]},
 GRD:{label:'지반 단면 표현',fields:[n('length','길이',3000,1),n('depth','표현 깊이',300,1),n('pitch','선 간격',150,1)]},
 COND:{label:'콘크리트 단면 표현',fields:[n('length','길이',3000,1),n('depth','두께',300,1),n('pitch','무늬 간격',180,1)]},
 KD:{label:'여닫이 열림 표시',fields:[width,n('depth','높이',1200,1)]},
 XD:{label:'개구부 대각 표시',fields:[width,n('depth','높이',1200,1)]},
 VD:{label:'미닫이 방향 표시',fields:[width,n('depth','높이',1200,1)]},
 OD:{label:'개구부 테두리',fields:[width,n('depth','높이',1200,1)]},
 SBD:{label:'보·슬래브 단면',fields:[n('width','보 폭',400,1),n('depth','보 전체 춤',600,1),n('slab','슬래브 두께',150,1),n('span','표시할 슬래브 폭',2400,1),textHeight]},
 SLD:{label:'경사로 완화구간 단면',fields:[n('length','수평 총 길이',12000,1),n('rise','상승 높이',1500,1),n('transition','양끝 완화구간 수평 길이',2000),n('thickness','판 두께',200,1),textHeight]},
 COD:{label:'기둥 평면',kind:'COLUMN',fields:[width,n('depth','깊이',1200,1),c('shape','형태','rectangle',[['rectangle','사각'],['circle','원형']]),t('mark','기둥 번호','C1'),textHeight]},
 ELD:{label:'엘리베이터 평면',kind:'ELEVATOR',fields:[n('width','승강로 폭',2200,301),n('depth','승강로 깊이',2200,401),n('carWidth','카 폭',1600,1),n('carDepth','카 깊이',1500,1),n('doorWidth','출입문 폭',900,1),t('mark','번호','EV1'),textHeight]},
 WST:{label:'창호 기호',kind:'OPENINGTAG',fields:[n('width','기호 폭',600,1),c('tagShape','테두리','circle',[['circle','원'],['ellipse','타원'],['rectangle','사각']]),t('mark','창호 번호','W1'),textHeight]},
 TIT:{label:'도면 타이틀',kind:'TITLE',fields:[n('width','밑줄 길이',3000,1),t('mark','제목','평면도'),textHeight]},
 ARR:{label:'화살표',kind:'ARROW',fields:[n('width','길이',1000,1)]},
};
export function detailDefaults(command){return Object.fromEntries(ARCH_LIBRARY[command].fields.map(f=>[f.name,f.value]));}
export function architecturalDetail(command,values,layer='default'){
 const spec=ARCH_LIBRARY[command];if(!spec)throw Error('건축 작도 종류를 확인하세요.');const o={...detailDefaults(command),...values};
 for(const f of spec.fields){if(f.type==='number'){if(!Number.isFinite(o[f.name])||o[f.name]<f.min)throw Error(f.label+' 입력값을 확인하세요.');}else if(f.options&&!f.options.some(([v])=>v===o[f.name]))throw Error(f.label+' 선택값을 확인하세요.');}
 for(const key of ['count','rows','columns','divisions'])if(o[key]!==undefined&&(!Number.isInteger(o[key])||o[key]<1||o[key]>500))throw Error('개수는 1~500 정수입니다.');
 for(const key of ['x','y','rotation'])if(o[key]!==undefined&&!Number.isFinite(o[key]))throw Error('위치·회전 입력값을 확인하세요.');
 if(spec.kind){const entity=architecture(spec.kind,o,layer);return {...entity,libraryCommand:command};}
 const entities=[],line=(a,b)=>entities.push({type:'line',layer,points:[a,b]}),poly=(points,closed=false)=>entities.push({type:'polyline',layer,points,closed}),rect=(x,y,w,h)=>poly(G.rectangle(p(x,y),p(x+w,y+h)),true),text=(value,x,y)=>entities.push({type:'text',layer,position:p(x,y),text:String(value),height:o.textHeight||150,align:'center'}),circle=(x,y,r)=>entities.push({type:'circle',layer,center:p(x,y),radius:r});
 if(command==='EED'){
  const parse=s=>[...new Set(String(s).split(/[,/]/).map(x=>Number(x.trim())))].sort((a,b)=>a-b),xs=parse(o.positions),ys=parse(o.levels);if(xs.length<2||xs.length>200||ys.length>100||[...xs,...ys].some(v=>!Number.isFinite(v))||ys.some(v=>v<0||v>o.height))throw Error('위치·높이 목록을 확인하세요.');const first=xs[0],last=xs.at(-1);for(const x of xs)line(p(x-first,0),p(x-first,o.height));for(const y of [...new Set([0,...ys,o.height])])line(p(0,y),p(last-first,y));
  if(o.dimensions==='yes')for(let i=1;i<xs.length;i++)entities.push({type:'dimension',mode:'horizontal',layer,points:[p(xs[i-1]-first,0),p(xs[i]-first,0),p(xs[i-1]-first,-o.textHeight*3)],textHeight:o.textHeight});
 }else if(command==='STSD'){
  const r=o.floorHeight/o.count,run=o.run,top=[];for(let i=0;i<o.count;i++){top.push(p(i*run,i*r),p(i*run,(i+1)*r));if(i<o.count-1)top.push(p((i+1)*run,(i+1)*r));}
  const end=(o.count-1)*run;top.push(p(end+o.landing,o.floorHeight),p(end+o.landing,o.floorHeight-o.waist),p(end,o.floorHeight-r-o.waist*Math.hypot(1,r/run)),p(0,-o.waist*Math.hypot(1,r/run)));poly(top,true);
  for(let i=1;i<o.count;i++)if(o.nosing)line(p(i*run-o.nosing,(i+1)*r),p(i*run,(i+1)*r));
  if(o.railHeight){line(p(0,r+o.railHeight),p(end,o.floorHeight+o.railHeight));line(p(end,o.floorHeight+o.railHeight),p(end+o.landing,o.floorHeight+o.railHeight));for(let i=0;i<o.count;i+=3)line(p(i*run,(i+1)*r),p(i*run,(i+1)*r+o.railHeight));}
  text(`${o.count}단 · 단높이 ${r.toFixed(1)} · 디딤판 ${run}`,end/2,-o.waist-o.textHeight*2);
 }else if(command==='PKD'){
  if(o.parkingAngle>90)throw Error('주차 각도는 30~90도입니다.');const a=o.parkingAngle*Math.PI/180,step=o.width/Math.sin(a),v=p(o.depth*Math.cos(a),o.depth*Math.sin(a));
  for(let i=0;i<o.count;i++){const a=p(i*step,0),b=p((i+1)*step,0);poly([a,b,G.add(b,v),G.add(a,v)],true);text(i+o.startNumber,(a.x+b.x+v.x)/2,v.y*.4);if(o.stopper==='yes'){const x=(a.x+b.x)/2+v.x*.9,y=v.y*.9;const angle=o.parkingAngle*Math.PI/180,across=p(Math.sin(angle),-Math.cos(angle)),along=p(Math.cos(angle),Math.sin(angle)),center=p(x,y);poly([[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>G.add(center,G.add(G.mul(across,a*o.width*.2),G.mul(along,b*60)))),true);}}
 }else if(command==='PID'){
  if(o.wall*2>=o.diameter||o.rows*o.columns>500)throw Error('파일 관벽 두께 또는 배열 수를 확인하세요.');let i=1;for(let row=0;row<o.rows;row++)for(let col=0;col<o.columns;col++){const x=col*o.spacingX,y=row*o.spacingY,r=o.diameter/2;circle(x,y,r);circle(x,y,r-o.wall);line(p(x-r*1.2,y),p(x+r*1.2,y));line(p(x,y-r*1.2),p(x,y+r*1.2));text(o.mark+i++,x,y-r-o.textHeight*1.5);}
 }else if(command==='DECK'){
  if(o.top+o.bottom>=o.pitch||o.length/o.pitch>1000)throw Error('피치는 상·하부 평탄 폭의 합보다 커야 하며 반복은 1000개 이하입니다.');const slope=(o.pitch-o.top-o.bottom)/2,points=[p(0,0)];
  for(let x=0;x<o.length;x+=o.pitch){for(const q of [p(x+o.bottom,0),p(x+o.bottom+slope,o.height),p(x+o.bottom+slope+o.top,o.height),p(x+o.pitch,0)]){const last=points.at(-1);if(q.x>o.length){points.push(p(o.length,last.y+(q.y-last.y)*(o.length-last.x)/(q.x-last.x)));break;}points.push(q);}}
  poly(points);poly(points.map(q=>p(q.x,q.y-o.thickness)));
 }else if(['JAD','GRD','COND'].includes(command)){
  if(Math.ceil(o.length/o.pitch)*Math.ceil(o.depth/o.pitch)>5000)throw Error('무늬가 너무 많습니다. 간격을 늘리세요.');rect(0,-o.depth,o.length,o.depth);
  for(let x=0;x<o.length;x+=o.pitch)for(let y=-o.depth;y<0;y+=o.pitch){const size=Math.min(o.pitch*.65,o.length-x,-y);if(size<=0)continue;if(command==='GRD'){line(p(x,y),p(x+size,y+size));}else if(command==='JAD'){poly([p(x+size*.1,y+size*.4),p(x+size*.3,y+size*.8),p(x+size*.8,y+size*.7),p(x+size*.9,y+size*.2),p(x+size*.4,y+size*.1)],true);}else{poly([p(x,y),p(x+size*.3,y+size*.7),p(x+size*.7,y+size*.1)],true);circle(x+size*.8,y+size*.8,size*.035);}}
 }else if(['KD','XD','VD','OD'].includes(command)){
  rect(0,0,o.width,o.depth);if(command==='XD'){line(p(0,0),p(o.width,o.depth));line(p(0,o.depth),p(o.width,0));}if(command==='KD')poly([p(0,0),p(o.width,o.depth/2),p(0,o.depth)]);if(command==='VD'){const y=o.depth/2;line(p(o.width*.2,y),p(o.width*.8,y));line(p(o.width*.8,y),p(o.width*.65,y+o.depth*.1));line(p(o.width*.8,y),p(o.width*.65,y-o.depth*.1));}
 }else if(command==='SCB'){
  for(let i=0;i<o.divisions;i++){const x=i*o.length/o.divisions,w=o.length/o.divisions;rect(x,0,w,o.height);if(i%2===0)entities.push({type:'hatch',layer,points:G.rectangle(p(x,0),p(x+w,o.height)),solid:true,spacing:100,angle:45});text((x/1000).toFixed(2).replace(/\.00$/,''),x,-o.textHeight*1.5);}text(o.length/1000+' m',o.length,-o.textHeight*1.5);
 }else if(command==='CDT'){
  const ring=G.rectangle(p(0,0),p(o.width,o.depth));if((o.width+o.depth)*2/o.pitch>1000)throw Error('구름 간격을 늘리세요.');for(const [a,b]of G.segments({points:ring,closed:true})){const count=Math.max(1,Math.ceil(G.dist(a,b)/o.pitch));for(let i=0;i<count;i++){const s=G.add(a,G.mul(G.sub(b,a),i/count)),e=G.add(a,G.mul(G.sub(b,a),(i+1)/count)),center=G.mul(G.add(s,e),.5),angle=G.angle(G.sub(e,s));entities.push({type:'arc',layer,center,radius:G.dist(s,e)/2,startAngle:angle+180,endAngle:angle+360});}}text(o.mark,o.width/2,o.depth+o.textHeight*1.5);
 }else if(command==='SBD'){
  if(o.slab>=o.depth||o.span<o.width)throw Error('보 춤은 슬래브 두께보다 크고 표시 폭은 보 폭 이상이어야 합니다.');const x=(o.span-o.width)/2;poly([p(0,0),p(o.span,0),p(o.span,-o.slab),p(x+o.width,-o.slab),p(x+o.width,-o.depth),p(x,-o.depth),p(x,-o.slab),p(0,-o.slab)],true);text(`보 ${o.width}×${o.depth} / 슬래브 ${o.slab}`,o.span/2,o.textHeight*2);
 }else if(command==='SLD'){
  if(o.transition*2>=o.length)throw Error('양끝 완화구간 합은 전체 길이보다 짧아야 합니다.');const slope=o.rise/(o.length-o.transition),t=o.transition,points=t?[p(0,0),p(t,slope*t/2),p(o.length-t,o.rise-slope*t/2),p(o.length,o.rise)]:[p(0,0),p(o.length,o.rise)];poly(points);poly(points.map(q=>p(q.x,q.y-o.thickness)));text(`중앙 경사 ${(slope*100).toFixed(2)}%`,o.length/2,-o.textHeight*2);
 }
 const rotation=o.rotation||0,position=p(o.x||0,o.y||0),transformed=entities.map(e=>G.translate(G.rotate(o.reflected?G.mirror(e,p(0,0),p(1,0)):e,p(0,0),rotation),position.x,position.y));
 return {type:'block',name:spec.label,category:command,libraryCommand:command,layer,position,parameters:{...o,kind:command},entities:transformed};
}
