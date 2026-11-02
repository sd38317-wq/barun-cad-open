import {STANDARD_LAYERS,TEMPLATE_LAYERS,SITE_PLAN_LAYERS,standardLayerForLabel,standardLayerForName} from './layer-standards.js';
import * as G from './geometry.js';
import {symbol} from './symbols.js';
import {buildDoor,doorExtents} from './door-card.js';
import {buildWindow} from './window-card.js';
import {wallFrame,capLines,cardOpeningStyle} from './card-kit.js';
import {classifyByLayerKnowledge} from './layer-knowledge.js';
import {rankLayerCandidates} from './layer-ranking.js';
import {layerNameLabel} from './layer-knowledge.js';
import {layerFamilyKey,layerExactKey} from './layer-name-groups.js';
import {PLANSET_DEFAULTS} from './planset-shared.js';
const P=(x,y)=>({x,y});
const positive=(v,label)=>{if(!Number.isFinite(v)||v<=0)throw Error(label+'은 양수입니다.');return v;};
export function insulationPath(source, thickness, side='center', closed=false, layer='default', waveSign=1) {
  positive(thickness,'단열재 두께');
  if(!['center','left','right'].includes(side))throw Error('단열재 방향을 확인하세요.');
  const path=[];
  for(const p of source||[]){
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw Error('경로 좌표를 확인하세요.');
    if(!path.length||G.dist(path.at(-1),p)>1e-7)path.push({x:p.x,y:p.y});
  }
  if(path.length>2&&G.dist(path[0],path.at(-1))<1e-7){path.pop();closed=true;}
  if(path.length<2)throw Error('단열재 경로에 두 점 이상 필요합니다.');
  if(closed&&path.length<3)throw Error('닫힌 경로에 세 점 이상 필요합니다.');
  const count=closed?path.length:path.length-1;
  const lengths=Array.from({length:count},(_,i)=>G.dist(path[i],path[(i+1)%path.length]));
  const normals=lengths.map((_,i)=>G.normal(G.unit(G.sub(path[(i+1)%path.length],path[i]))));
  const joins=path.map((_,i)=>{
    if(!closed&&i===0)return normals[0];
    if(!closed&&i===path.length-1)return normals.at(-1);
    const a=normals[(i-1+count)%count],b=normals[i%count],sum=G.add(a,b),den=G.dot(sum,b);
    if(den<0.05)throw Error('경로가 급하게 되꺾입니다. 모서리를 나누거나 둥글게 수정하세요.');
    return G.mul(sum,Math.min(1/den,2/Math.hypot(sum.x,sum.y)));
  });
  const total=lengths.reduce((a,b)=>a+b,0),cycles=Math.max(1,Math.round(total/thickness));
  if(cycles>3000||path.length>10000)throw Error('경로가 너무 깁니다. 구간을 나눠 그리세요.');
  const shift=side==='left'?thickness/2:side==='right'?-thickness/2:0,result=[];
  let distance=0;
  for(let i=0;i<count;i++){
    const a=path[i],b=path[(i+1)%path.length],steps=Math.max(1,Math.ceil(lengths[i]/total*cycles*24));
    for(let j=i?1:0;j<=steps;j++){
      const t=j/steps,base=G.add(a,G.mul(G.sub(b,a),t));
      const blend=Math.min(thickness,lengths[i]/2),wa=Math.max(0,1-t*lengths[i]/blend),wb=Math.max(0,1-(1-t)*lengths[i]/blend);
      const normal=G.add(G.mul(normals[i],1-wa-wb),G.add(G.mul(joins[i],wa),G.mul(joins[(i+1)%path.length],wb)));
      const offset=shift+waveSign*thickness/2*Math.sin(2*Math.PI*cycles*(distance+t*lengths[i])/total);
      result.push(G.add(base,G.mul(normal,offset)));
    }
    distance+=lengths[i];
  }
  if(closed)result.pop();
  return {type:'block',layer,name:'단열재',category:'INSULATION',position:{...path[0]},parameters:{kind:'INSULATION',path,depth:thickness,side,closed,waveSign},entities:[{type:'polyline',layer,points:result,closed}]};
}
export function insulationSourcePath(entity, thickness=100){
  if(['line','polyline','rectangle'].includes(entity.type))return {points:entity.points,closed:!!entity.closed||entity.type==='rectangle'};
  if(['arc','circle'].includes(entity.type)){
    const closed=entity.type==='circle',start=closed?0:entity.startAngle,sweep=closed?360:G.normalizeAngle(entity.endAngle-start);
    const count=Math.max(8,Math.ceil(entity.radius*sweep*Math.PI/180/(thickness/4)));
    if(count>10000)throw Error('곡선이 너무 깁니다. 구간을 나눠 선택하세요.');
    return {points:Array.from({length:count+(closed?0:1)},(_,i)=>G.add(entity.center,G.polar(entity.radius,start+sweep*i/count))),closed};
  }
  throw Error('선·폴리선·사각형·호·원을 선택하세요.');
}
export function architecture(kind,o,layer='default'){
  if(['DOOR','WINDOW'].includes(kind))o={frameWidth:kind==='DOOR'?40:50,...(kind==='DOOR'?{leafThickness:40,openingAngle:90}:{}),...o};
  if(kind==='STAIR')o={nosing:30,railWidth:38,gap:100,...o};
  if(kind==='STAIR'&&o.floorHeight){
    const floorHeight=positive(Number(o.floorHeight),'층고'),target=positive(Number(o.targetRiser??170),'목표 단높이'),count=Math.ceil(floorHeight/target);
    if(count<2||count>100)throw Error('계단 단수는 2~100 범위여야 합니다.');
    o={...o,count,riser:floorHeight/count};
  }
  if(kind==='INSULATION'&&o.path)return insulationPath(o.path,o.depth||100,o.side||'center',!!o.closed,layer);
  const es=[],line=(a,b)=>es.push({type:'line',points:[a,b],layer}),rect=(x,y,w,h)=>es.push({type:'rectangle',points:G.rectangle(P(x,y),P(x+w,y+h)),layer}),text=(s,x,y,h=o.textHeight||150)=>es.push({type:'text',text:s,position:P(x,y),height:h,layer}),circle=(x,y,r)=>es.push({type:'circle',center:P(x,y),radius:r,layer});
  const w=positive(o.width||1000,'폭'),d=positive(o.depth||1000,'깊이'),n=o.count||12;
  if(['DOOR','WINDOW','STAIR'].includes(kind))es.push(...symbol(kind,{...o,width:w,depth:d,count:n,run:o.run||280},P(0,0),0,layer).entities);
  else if(kind==='COLUMN'){if(o.shape==='circle')circle(0,0,w/2);else rect(-w/2,-d/2,w,d);line(P(-w*.7,0),P(w*.7,0));line(P(0,-d*.7),P(0,d*.7));text(o.mark||'C1',w*.6,d*.6);}
  else if(kind==='ELEVATOR'){const cw=o.carWidth??w-300,cd=o.carDepth??d-400,dw=o.doorWidth??Math.min(900,cw*.6);if(!(cw>0&&cd>0&&cw<w&&cd<d&&dw>0&&dw<cw))throw Error('카는 승강로보다 작고 출입문 폭은 카 폭보다 작아야 합니다.');const x=(w-cw)/2,y=(d-cd)/2,left=(w-dw)/2,right=(w+dw)/2;line(P(0,0),P(0,d));line(P(0,d),P(w,d));line(P(w,d),P(w,0));line(P(0,0),P(left,0));line(P(right,0),P(w,0));line(P(x,y),P(x,y+cd));line(P(x,y+cd),P(x+cw,y+cd));line(P(x+cw,y+cd),P(x+cw,y));line(P(x,y),P(left,y));line(P(right,y),P(x+cw,y));rect(left,y-30,dw/2,30);rect(w/2,y-60,dw/2,30);line(P(left,0),P(left,y));line(P(right,0),P(right,y));text(o.mark||'EV',w*.35,d*.45);}
  else if(kind==='CURVESTAIR'){
    if(!Number.isInteger(n)||n<2||n>100)throw Error('단수는 2~100 정수입니다.');
    const r=positive(o.radius||1500,'안쪽 반지름'),sweep=positive(o.sweep||180,'회전각');if(sweep>360)throw Error('회전각은 360도 이하입니다.');
    for(const radius of [r,r+w])es.push({type:'arc',center:P(0,0),radius,startAngle:0,endAngle:sweep,layer});
    for(let i=0;i<=n;i++){const a=sweep*i/n;line(G.polar(r,a),G.polar(r+w,a));}text('UP',r+w*.4,100);
  }else if(kind==='INSULATION'){
    es.push(...insulationPath([P(0,0),P(w,0)],d,o.side||'center',false,layer).entities);
  }else if(kind==='RAMP'){
    rect(0,0,w,d);line(P(w/2,0),P(w/2,d));line(P(w/2,d),P(w/2-100,d-200));line(P(w/2,d),P(w/2+100,d-200));
    const count=Math.min(200,Math.ceil(d/300));for(let i=1;i<count;i++)line(P(0,i*d/count),P(w,i*d/count));text(o.rise==null?'경사 — (높이 입력 필요)':'경사 '+Number((positive(o.rise,'높이')/d*100).toFixed(2))+'%',w+100,d/2);
  }else if(kind==='LEVEL'){line(P(0,0),P(w,0));line(P(0,0),P(w*.2,w*.15));line(P(w*.2,w*.15),P(w*.2,-w*.15));line(P(w*.2,-w*.15),P(0,0));text(o.mark||'±0.000',w*.3,100);}
  else if(kind==='SECTION'){circle(0,0,w/3);line(P(-w/3,0),P(w/3,0));line(P(0,-w/3),P(0,-d));line(P(0,-d),P(w/5,-d+w/3));text(o.mark||'A',-w/10,w/10);text(o.reference||'A-101',-w/4,-w/4,w/8);}
  else if(kind==='ARROW'){line(P(0,0),P(w,0));line(P(w,0),P(w-200,100));line(P(w,0),P(w-200,-100));}
  else if(kind==='BREAKSYMBOL'){const ps=[P(0,0),P(w*.35,0),P(w*.45,d*.15),P(w*.55,-d*.15),P(w*.65,0),P(w,0)];es.push({type:'polyline',points:ps,closed:false,layer});}
  else if(kind==='OPENINGTAG'&&o.tagShape){const h=o.textHeight||150;es.push({type:'text',layer,text:o.mark||'W1',position:P(0,-h*.35),height:h,align:'center'});if(o.tagShape==='circle')circle(0,0,w/2);else if(o.tagShape==='ellipse')es.push({type:'ellipse',layer,center:P(0,0),majorAxis:P(w/2,0),ratio:.65,startParam:0,endParam:Math.PI*2});else rect(-w/2,-Math.max(h,w*.3),w,Math.max(h,w*.3)*2);}
  else if(['TITLE','TEXTBOX','ROOMTAG','OPENINGTAG'].includes(kind)){
    const h=o.textHeight||150,s=o.mark||'이름';text(s,0,0,h);
    if(kind==='TITLE')line(P(0,-h*.5),P(Math.max(w,s.length*h),-h*.5));
    else rect(-h*.5,-h*.5,Math.max(w,s.length*h),h*2);
  }else throw Error('지원하지 않는 건축 요소');
  const height=o.height??(kind==='DOOR'?2100:kind==='WINDOW'?1500:0),sill=o.sill??(kind==='WINDOW'?900:0);
  if(['DOOR','WINDOW'].includes(kind)&&(!Number.isFinite(height)||height<=0||!Number.isFinite(sill)||sill<0))throw Error('창호 높이는 양수, 하부 높이는 0 이상이어야 합니다.');
  return {type:'block',layer,...(kind==='RAMP'?{reviewInput:{riseMm:o.rise??null}}:{}),name:o.mark||kind,category:kind,position:P(o.x||0,o.y||0),attributes:{...o.attributes,mark:o.mark||'',width:w,depth:d,height,sill,count:n,style:o.style||''},parameters:{...o,width:w,depth:d,height,sill,count:n,kind},entities:es.map(e=>G.translate(G.rotate(o.reflected?G.mirror(e,P(0,0),P(1,0)):e,P(0,0),o.rotation||0),o.x||0,o.y||0))};
}
export function rebuildArchitecture(entity,changes,walls=[]){
  const kind=entity.category||entity.parameters?.kind;if(!['DOOR','WINDOW','STAIR'].includes(kind))throw Error('매개변수 문·창·계단을 선택하세요.');
  const o={...entity.parameters,...changes,x:entity.position.x,y:entity.position.y};
  for(const key of ['width','depth','frameWidth','floorHeight','targetRiser','run','landing',...(kind==='STAIR'?[]:['height'])])if(o[key]!==undefined&&(!Number.isFinite(o[key])||o[key]<=0))throw Error('치수는 양수여야 합니다.');
  const wall=walls.find(w=>w.id===entity.hostWall);
  if(wall&&entity.cardOpening){
    const card=entity.cardOpening,v={...card.values,width:o.width,offset:0},u=G.unit(G.sub(wall.points[1],wall.points[0])),n=G.normal(u);
    const width=kind==='DOOR'?v.width+2*(v.frameWidth+v.gap):v.width+2*v.gap,style=cardOpeningStyle(kind,v);
    const linked=wallOpening(kind,{...o,width},wall,entity.position,entity.layer);
    const origin=G.add(G.add(linked.position,G.mul(u,card.direction<0?width:0)),G.mul(n,card.face*wall.thickness/2));
    const f=wallFrame(origin,G.add(origin,G.mul(u,card.direction)),G.sub(origin,G.mul(n,card.face*wall.thickness)));
    const built=kind==='DOOR'?buildDoor(f,v,card.shared):buildWindow(f,v,card.shared);
    const ext=kind==='DOOR'?doorExtents(f,v,built.dL):null;
    const caps=capLines(f,built.capPositions,[{d:0,layer:wall.layer},{d:f.t,layer:wall.layer}],v.wallCap,{dLo:ext?.capLo??Math.min(0,built.dLo??0),dHi:ext?.capHi??Math.max(f.t,built.dHi??f.t)});
    const layerIds=new Map(entity.entities.filter(e=>e.cardOpeningLayer).map(e=>[e.cardOpeningLayer,e.layer]));
    const entities=[...built.entities,...caps].map(({cardLayer,...e})=>({...e,...(cardLayer?{cardOpeningLayer:cardLayer}:{}),layer:e.layer||layerIds.get(cardLayer)||entity.layer}));
    return {...entity,position:linked.position,hostOffset:linked.hostOffset,openingWidth:width,entities,
      cardOpening:{...card,values:v},parameters:{...o,depth:wall.thickness,rotation:G.angle(u),style},attributes:{...entity.attributes,width:o.width,height:o.height,sill:o.sill,style}};
  }
  const rebuilt=wall?wallOpening(kind,o,wall,entity.position,entity.layer):architecture(kind,o,entity.layer);
  return {...entity,...rebuilt,id:entity.id,attributes:{...entity.attributes,...rebuilt.attributes}};
}
export function architectureSolids(e){
 const o=e.parameters;if(!o||!e.position)return [];const parts=[],w=o.width,d=o.depth||200;
 const rect=(x,y,width,depth,z,height)=>{if(height>0)parts.push({points:G.rectangle(P(x,y),P(x+width,y+depth)),z,height});};
 if(['DOOR','WINDOW'].includes(o.kind)){
   const h=o.height||(o.kind==='DOOR'?2100:1500),s=o.sill||0,f=o.frameWidth||40;
   rect(0,-d/2,f,d,s,h);rect(w-f,-d/2,f,d,s,h);rect(f,-d/2,w-2*f,d,s+h-f,f);
   if(o.kind==='WINDOW'){rect(f,-d/2,w-2*f,d,s,f);rect(f,-10,w-2*f,20,s+f,h-2*f);parts.at(-1).glass=true;}
   if(o.kind==='WINDOW'&&o.style==='sliding')rect(w/2-f/2,-d/2,f,d,s,h);
   if(o.kind==='DOOR'){const leafStart=parts.length;
     const side=o.side==='negative'?-1:1,t=o.leafThickness??40,angle=o.openingAngle??90;
     const leaf=(x,length,right=false)=>{const a=right?180-angle:angle,u=G.polar(1,a),normal=G.normal(u),base=P(x,0),tip=G.add(base,G.mul(u,length));let points=[G.add(base,G.mul(normal,-t/2)),G.add(tip,G.mul(normal,-t/2)),G.add(tip,G.mul(normal,t/2)),G.add(base,G.mul(normal,t/2))];points=points.map(p=>P(o.hand==='right'?w-p.x:p.x,p.y*side));parts.push({points,z:s,height:h-f});};
     if(['sliding','doubleSliding'].includes(o.style)){const ratio=o.style==='doubleSliding'?.5:.55;rect(0,-d*.15,w*ratio,t,s,h-f);rect(w*(1-ratio),d*.15,w*ratio,t,s,h-f);}
     else if(['double','unequal'].includes(o.style)){const ratio=o.style==='unequal'?(o.leafRatio??.7):.5;leaf(0,w*ratio);leaf(w,w*(1-ratio),true);}
     else leaf(0,w);
     for(let i=leafStart;i<parts.length;i++)parts[i].role='leaf';   // 문짝(3D 에서 나무색)
   }
 }else if(o.kind==='STAIR'&&o.floorHeight){
   const n=o.count,r=o.riser||o.floorHeight/n,run=o.run||280,layout=o.layout||'straight',first=layout==='straight'?n:Math.ceil(n/2),second=n-first,n1=Math.max(1,first-1),length=n1*run,landing=o.landing||w,gap=o.gap??100;
   for(let i=0;i<n1;i++)rect(0,i*run,w,run,0,(i+1)*r);
   if(layout!=='straight')rect(0,length,layout==='u'?w*2+gap:landing,landing,first*r-150,150);
   for(let i=0;i<second-1;i++)if(layout==='l')rect(landing+i*run,length,run,w,0,(first+i+1)*r);else rect(w+gap,length-(i+1)*run,w,run,0,(first+i+1)*r);
 }
 const transform=p=>G.add(e.position,G.polar(G.len(p),G.angle(o.reflected?{x:p.x,y:-p.y}:p)+(o.rotation||0)));
 // role: 3D 재료(틀·유리·문짝·계단). 그림 모양은 그대로.
 return parts.map(part=>({...part,role:part.role||(part.glass?'glass':o.kind==='STAIR'?'stair':'frame'),points:part.points.map(transform)}));
}
/* 가구·위생·주방 블록의 3D 상자(인테리어 1단계): 블록 자기 좌표계로 잰 평면 경계 × 높이. 제품 모양이 아니라 상자.
   높이·바닥 높이·색·재료는 model3d 가 있으면 그 값, 없으면 품목별 기본값. 회전된 블록도 회전된 상자로 나온다. */
const FURNITURE_HEIGHTS=[[/^bed-/,450,'#E7DCCB'],[/^sofa-/,800,'#9CA3AF'],[/^(dining-|desk)/,750,'#B58C65'],[/^wardrobe-/,2100,'#EEE7DD'],[/^closet/,2400,'#EEE7DD'],
 [/^toilet/,800,'#F4F4F2'],[/^basin/,850,'#F4F4F2'],[/^bathtub/,550,'#F4F4F2'],[/^shower/,40,'#BFDBFE'],[/^urinal/,600,'#F4F4F2'],[/^(sink|range|dishwasher)/,850,'#E5E7EB'],[/^fridge/,1800,'#D4D4D8']];
const FURNITURE_LAYER=/^A-(FURN|SANR|SANI|KTCH)(?:$|-)/i;
export function furnitureSpec(e,layerName=''){
 if(e?.type!=='block'||e.parameters?.kind)return null;
 const id=e.category==='LIBRARY'?String(e.attributes?.libraryId||''):'',hit=FURNITURE_HEIGHTS.find(([r])=>r.test(id));
 if(hit)return {libraryId:id,height:hit[1],color:hit[2]};
 return FURNITURE_LAYER.test(layerName)?{libraryId:id||null,height:750,color:'#B58C65'}:null;
}
// 블록이 아닌 닫힌 윤곽 가구(남의 도면 A-FURN 사각형 등)는 사람이 3D 높이를 준 것만(model3d) 도면 묶음 3D 에도 얹는다.
export function furnitureOutline(e,layerName=''){
 if(!e?.model3d||!FURNITURE_LAYER.test(layerName)||!(e.type==='rectangle'||e.type==='rect'||e.type==='polyline'&&e.closed)||!(e.points?.length>=3))return [];
 const m=e.model3d;return [{points:e.points,z:m.elevation||0,height:m.height??200,role:'solid',color:m.color||null,material:m.material||null,furniture:true}];
}
export function furnitureSolids(e,source=e,layerName=''){
 const spec=furnitureSpec(e,layerName);if(!spec)return [];
 const o=e.position||{x:0,y:0},a=(e.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 const add=p=>{const dx=p.x-o.x,dy=p.y-o.y,x=dx*c+dy*s,y=-dx*s+dy*c;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);};
 const walk=list=>{for(const child of list||[]){if(child.entities){walk(child.entities);continue;}if(/text|dimension|hatch/i.test(child.type))continue;
  for(const p of G.primitives(child)){if(p.points)p.points.forEach(add);
   else if(p.type==='ellipse')G.ellipsePoints(p,64).forEach(add);   // 양변기 등 타원 외곽
   else if(p.type==='circle'&&p.radius){const r=p.radius;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])add({x:p.center.x+(dx*c-dy*s)*r,y:p.center.y+(dx*s+dy*c)*r});}   // 블록 좌표축 방향 끝점(회전해도 정확)
   else if(p.type==='arc'&&p.radius){const start=p.startAngle||0,sweep=G.normalizeAngle(p.endAngle-start)||360;for(let i=0;i<=64;i++)add(G.add(p.center,G.polar(p.radius,start+sweep*i/64)));}}}};
 walk(source.entities);
 if(!(x1-x0>1&&y1-y0>1))return [];
 const world=(x,y)=>({x:o.x+x*c-y*s,y:o.y+x*s+y*c}),m=e.model3d||{};
 return [{points:[world(x0,y0),world(x1,y0),world(x1,y1),world(x0,y1)],z:m.elevation||0,height:m.height??spec.height,role:'solid',color:m.color||(m.material?null:spec.color),material:m.material||null,furniture:spec.libraryId||true}];
}
export function wallOpening(kind,options,wall,position,layer='default'){
  if(!['DOOR','WINDOW'].includes(kind)||wall?.type!=='wall')throw Error('문·창과 벽을 선택하세요.');
  const width=positive(Number(options.width),'창호 폭'),length=G.dist(...wall.points);
  if(width>length)throw Error('창호 폭이 선택한 벽 길이보다 큽니다.');
  const direction=G.unit(G.sub(wall.points[1],wall.points[0]));
  const offset=Math.max(0,Math.min(length-width,G.dot(G.sub(position,wall.points[0]),direction)));
  const base=G.add(wall.points[0],G.mul(direction,offset));
  return {...architecture(kind,{...options,x:base.x,y:base.y,depth:wall.thickness,rotation:G.angle(direction)},layer),hostWall:wall.id,hostOffset:offset/length,openingWidth:width};
}
export function measure(e){
  if(e.type==='circle')return {area:Math.PI*e.radius**2,length:Math.PI*2*e.radius};
  if(e.type==='arc')return {area:0,length:e.radius*G.normalizeAngle(e.endAngle-e.startAngle)*Math.PI/180};
  if(e.type==='ellipse'){const ps=G.ellipsePoints(e,512);return {area:Math.abs(G.polygonArea(ps)),length:ps.slice(1).reduce((s,p,i)=>s+G.dist(ps[i],p),0)};}
  if(e.type==='wall')return {area:G.wallPolygons(e).reduce((s,p)=>s+Math.abs(G.polygonArea(p)),0),length:G.dist(...e.points)};
  const ps=e.points||[],closed=e.closed||['rectangle','hatch'].includes(e.type);
  const area=e.type==='hatch'?G.hatchArea(e):closed?Math.abs(G.polygonArea(ps))-(e.loops||[]).reduce((s,p)=>s+Math.abs(G.polygonArea(p)),0):0;
  const length=G.segments(e).reduce((s,[a,b])=>s+G.dist(a,b),0);
  return {area,length};
}
export function formwork({length,height,allowance=0,rise=0,run=0,steps=0,tread=0,riser=0,stairWidth=0,openings=0,stairMode='developed',stairSides=0}){
  for(const [k,v]of Object.entries({length,height,allowance,rise,run,steps,tread,riser,stairWidth,openings,stairSides}))if(!Number.isFinite(v)||v<0)throw Error(k+'는 0 이상의 수입니다.');
  if(length>0&&height<=0)throw Error('벽 길이가 있으면 높이는 양수입니다.');
  if(length===0&&steps===0)throw Error('벽 또는 계단 물량을 입력하세요.');
  if(rise>0&&run<=0)throw Error('경사 높이를 입력하면 수평길이도 입력하세요.');
  if(!Number.isInteger(steps))throw Error('계단 단수는 정수입니다.');
  const slope=run>0?Math.hypot(run,rise)/run:1;
  const wall=length*height*slope;
  const soffit=Math.hypot(steps*tread,steps*riser)*stairWidth;
  if(!['developed','soffit','soffitRisers'].includes(stairMode))throw Error('계단 산정 방식 오류');
  const stair=(stairMode==='developed'?steps*(tread+riser)*stairWidth:soffit+(stairMode==='soffitRisers'?steps*riser*stairWidth:0))+stairSides;
  if(openings>wall+stair)throw Error('공제 면적이 전체 면적보다 큽니다.');
  const stairFormula=stairMode==='developed'?'단수×(디딤판+챌판)×폭':stairMode==='soffit'?'√((단수×디딤판)²+(단수×챌판)²)×폭':'√((단수×디딤판)²+(단수×챌판)²)×폭+단수×챌판×폭';
  return {wall,stair,soffit,gross:wall+stair,openings,net:wall+stair-openings,total:(wall+stair-openings)*(1+allowance/100),slope,stairFormula,formula:'(벽면+계단면(측면 포함)−개구부)×(1+할증/100)'};
}
export function simplify(points,tolerance){
  positive(tolerance,'허용 오차');if(points.length<=2)return points;
  let max=0,index=0;for(let i=1;i<points.length-1;i++){const d=G.distanceToSegment(points[i],points[0],points.at(-1));if(d>max){max=d;index=i;}}
  return max>tolerance?[...simplify(points.slice(0,index+1),tolerance).slice(0,-1),...simplify(points.slice(index),tolerance)]:[points[0],points.at(-1)];
}
// 표준 이름·사양은 rules/knowledge/generation-layer-standards.json 한 곳에서 관리한다.
export {standardLayerForLabel,SITE_PLAN_LAYERS,ON_DEMAND_LAYERS} from './layer-standards.js';
export const BARUN_LAYERS=TEMPLATE_LAYERS;
export const barunLayerNames=()=>new Set(STANDARD_LAYERS.map(layer=>layer.name));
// 설계엔진·지적 조회가 쓰는 옛 이름 → 대지·계획 표준 이름
export const SITE_PLAN_LAYER_ALIASES={'A-SITE-BND':'A-SITE-BND','A-DIM':'A-DIM','A-TEXT':'A-TEXT','A-SYM':'A-SYM','A-NOTE-REVIEW':'A-NOTE','C-SITE-BND':'A-SITE-BND','C-SITE-ROAD':'A-SITE-ROAD','C-SITE-PARCEL':'A-SITE-PARCEL','C-SITE-TEXT':'A-SITE-TEXT'};
// 대지 가져오기 역할→표준 레이어 중앙 대응표
export const SITE_ROLE_LAYERS=Object.freeze({boundary:'A-SITE-BND',originalBoundary:'A-SITE-PARCEL',road:'A-SITE-ROAD',dimensions:'A-DIM',review:'A-REVIEW',siteInfo:'A-SITE-TEXT',adjacentParcels:'A-SITE-PARCEL',roadHatch:'A-SITE-ROAD',sunline:'A-ENV-SUN-SECTION'});
export {SITE_LEGACY_LAYER_NAMES} from './layer-migration.js';
export const inferArchitectureLayer=entity=>entity?.parcelRole?SITE_ROLE_LAYERS[{site:'boundary',road:'road','road-info':'review',neighbor:'adjacentParcels',label:'siteInfo','site-dimension':'dimensions','site-original':'originalBoundary','corner-cut':'review'}[entity.parcelRole]]||null:null;
export const sitePlanLayer=name=>{const standard=SITE_PLAN_LAYER_ALIASES[name]||name;return SITE_PLAN_LAYERS.find(l=>l.name===standard)||{name:standard};};
export {LEGACY_LAYER_NAMES,migrateLegacyLayerNames} from './layer-migration.js';
import {legacyStandardName} from './layer-migration.js';

// 새 도면은 항상 이 표준 레이어 한 벌을 갖고 시작한다(오토캐드의 템플릿 도면에 해당).
export const standardLayers = () => BARUN_LAYERS.map(layer => ({
 ...layer,
 id: crypto.randomUUID(),
 visible: true,
 locked: false,
}));

// Geometric concept candidates only; no zoning or parking compliance implied.
export function layoutCandidates(site,{width,depth,clearance=0}){
 if(!Array.isArray(site)||site.length<3||site.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error('닫힌 대지 경계가 필요합니다.');
 if(!Number.isFinite(width)||!Number.isFinite(depth)||width<=0||depth<=0||!Number.isFinite(clearance)||clearance<0)throw Error('건물 크기와 경계 여유 거리를 확인하세요.');
 const inside=p=>{let result=false;for(let i=0,j=site.length-1;i<site.length;j=i++){
  const a=site[i],b=site[j];if(G.distanceToSegment(p,a,b)<1e-6)return true;
  if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)result=!result;
 }return result;};
 const orient=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 const crosses=(a,b,c,d)=>orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0;
 const b={minX:Math.min(...site.map(p=>p.x)),maxX:Math.max(...site.map(p=>p.x)),minY:Math.min(...site.map(p=>p.y)),maxY:Math.max(...site.map(p=>p.y))};
 const candidates=[];
 for(let iy=0;iy<=24;iy++)for(let ix=0;ix<=24;ix++){
  const x=b.minX+clearance+(b.maxX-b.minX-width-2*clearance)*ix/24,y=b.minY+clearance+(b.maxY-b.minY-depth-2*clearance)*iy/24;
  const points=[{x,y},{x:x+width,y},{x:x+width,y:y+depth},{x,y:y+depth}];
  if(!points.every(inside))continue;
  let valid=true;
  for(let i=0;i<4&&valid;i++)for(let j=0;j<site.length;j++){
   const a=points[i],c=points[(i+1)%4],p=site[j],q=site[(j+1)%site.length];
   // A concave boundary vertex may enter the rectangle without a strict crossing.
   const vertexInside=p.x>x+1e-6&&p.x<x+width-1e-6&&p.y>y+1e-6&&p.y<y+depth-1e-6;
   if(vertexInside||crosses(a,c,p,q)||!inside({x:(a.x+c.x)/2,y:(a.y+c.y)/2})||Math.min(G.distanceToSegment(a,p,q),G.distanceToSegment(c,p,q),G.distanceToSegment(p,a,c),G.distanceToSegment(q,a,c))<clearance-1e-6){valid=false;break;}
  }
  if(valid)candidates.push(points);
 }
 if(!candidates.length)throw Error('입력한 크기로 배치 가능한 후보를 찾지 못했습니다. 크기나 여유 거리를 조정하세요.');
 const first=candidates[0],last=candidates.reduce((best,p)=>G.dist(p[0],first[0])>G.dist(best[0],first[0])?p:best,first);
 return [first,...(G.dist(first[0],last[0])>1e-6?[last]:[])].map((points,i)=>({name:i?'B안':'A안',points,area:width*depth/1e6,checks:'기하 경계 확인만 완료 · 법규/주차/도로 연결 미검토'}));
}

export function classifyLayer(entity, name='') {
 const type=entity.type.toLowerCase(), n=name.toUpperCase();
 const detail={DOOR:'문',WINDOW:'창호',COLUMN:'기둥',STAIR:'계단',INSULATION:'단열재',ELEVATOR:'승강기'}[entity.parameters?.kind];if(detail)return detail;
 if(entity.parcelRole==='site')return '대지';
 if(entity.parcelRole==='road')return '도로';
 if(entity.parcelRole==='corner-cut')return '가각전제';
 if(entity.parcelRole==='site-original')return '원대지경계';
 if(type==='wall')return '벽체';
 if(type==='door')return '문';
 if(type==='window')return '창호';
 if(type.includes('dimension')||type.startsWith('dim'))return '치수';
 if(type.includes('text'))return '문자';
 if(type==='hatch')return '해치';
 const standard=standardLayerForName(n);if(standard)return standard.label;
 for(const [label,pattern] of [
  ['창호',/창|WINDOW|GLAZ|(^|[-_])WIN($|[-_])/],['문',/DOOR|출입문/],
  ['기둥',/기둥|COLUMN|(^|[-_])COL($|[-_])/],['가구',/가구|FURN|FUR[-_]/],
  ['치수',/치수|DIM/],['문자',/문자|TEXT|ANNO/],['해치',/해치|HATCH/],
  ['중심선',/중심|CENTER|AXIS/],['조적',/조적|MASON|BRICK/],
  ['대지',/대지|SITE|BOUNDARY/],['도로',/도로|ROAD/],['벽체',/벽|WALL/]
 ])if(pattern.test(n))return label;
 return '검토필요';
}

export function organizeBarunLayers(doc) {
 let changed=0,review=0,skipped=0;
 for(const layer of BARUN_LAYERS){const old=doc.layers.find(l=>l.name===layer.name||legacyStandardName(l.name)===layer.name);if(!old)doc.layers.push({...layer,id:crypto.randomUUID(),visible:true,locked:false,linetype:layer.linetype});else if(!old.locked){Object.assign(old,layer);delete old.aci;delete old.colorMode;}}
  const visit=entities=>{for(const e of entities){
   const source=doc.layers.find(l=>l.id===e.layer);
   if(e.designGroup||e.designAlternative&&source?.name==='배치_'+e.designAlternative){continue;}
   // Keep hidden/frozen sources intact instead of revealing them by merging.
   if(source?.locked||source?.visible===false||source?.frozen){skipped++;continue;}
   if(/^A-SITE(?:-|$)/.test(source?.name||'')&&!e.parcelRole){if(e.entities)visit(e.entities);continue;}
   const label=classifyLayer(e,source?.name);
   const name=inferArchitectureLayer(e)||(/^A-SITE(?:-|$)/.test(source?.name||'')?source.name:null)||legacyStandardName(source?.name)||standardLayerForLabel(label)?.name;
   const target=doc.layers.find(l=>l.name===name);
   if(!target||target.locked||target.visible===false||target.frozen){skipped++;continue;}
   if(e.layer!==target.id){e.layer=target.id;changed++;if(name==='A-REVIEW')review++;}
   if(name!=='A-REVIEW'){delete e.color;delete e.aci;delete e.colorMode;}
   if(e.entities)visit(e.entities);
  }};
 visit(doc.entities);
 for(const block of doc.blocks||[])visit(block.entities);
 return {changed,review,skipped};
}


// Conservative geometric proposals. Analysis never changes the drawing.
export function analyzeDrawingLayers(doc){
 const layers=new Map(doc.layers.map(l=>[l.id,l]));
 const eligible=doc.entities.filter(e=>layerKnowledgeEligible(e,layers.get(e.layer)));
 const proposals=new Map(),geometryEvidence=new Map();
 function offer(e,label,confidence,reason){
  if(confidence<1){const perLabel=geometryEvidence.get(e.id)||new Map(),old=perLabel.get(label);if(!old||confidence>old.confidence)perLabel.set(label,{label,confidence,reason});geometryEvidence.set(e.id,perLabel);}
  const old=proposals.get(e.id);if(!old||confidence>old.confidence)proposals.set(e.id,{id:e.id,label,confidence,reason,accepted:confidence>=.9});}
 for(const e of eligible){
  const category={WINDOW:'창호',DOOR:'문',COLUMN:'기둥',STAIR:'계단',CURVESTAIR:'계단',INSULATION:'단열재',ELEVATOR:'승강기',RAMP:'경사로'}[e.category];if(category)offer(e,category,1,'건축 요소 종류');if(e.name==='DXF 치수(분해형)')offer(e,'치수',1,'외부 파일의 치수 블록');
  const intrinsic={wall:'벽체',door:'문',window:'창호',hatch:'해치',text:'문자',mtext:'문자'}[e.type];
  if(intrinsic)offer(e,intrinsic,1,'객체 자체의 형식');
  else if(/^(dimension|dim)/i.test(e.type))offer(e,'치수',1,'치수 객체');
  else if(['line','polyline'].includes(e.type)){
   const layer=layers.get(e.layer),own=String(e.linetype||'').toUpperCase(),lt=!own||/^(BYLAYER|BYBLOCK)$/.test(own)?String(layer.linetype||'').toUpperCase():own;
   if(/CENTER|CENTRE|AXIS|CHAIN|일점쇄|일점쇄선|중심/.test(lt))offer(e,'중심선',.98,'중심선 선종류 (레이어 상속 포함)');
   else if(/중심|중앙선|기준선|통심|CENTER|CENTRE|AXIS|GRID|(^|[-_ ])CEN($|[-_ ])/i.test(layer.name))offer(e,'중심선',.94,'기준축 레이어 이름');
  }
 }

 // Axis bubbles and a crossing grid distinguish long axes from paired walls.
 const axisLines=eligible.filter(e=>e.type==='line'&&e.points?.length===2&&G.dist(...e.points)>=1500);
 const bubbles=eligible.filter(e=>e.type==='circle'&&e.radius>=50&&e.radius<=1000);
 const texts=eligible.filter(e=>/^(text|mtext)$/.test(e.type)&&/^(?:[XY]?\d{1,2}|[A-Z](?:\d{1,2})?)$/i.test(String(e.text||'').trim()));
 const tagged=new Set();
 for(const line of axisLines){
  const bubble=bubbles.find(b=>line.points.some(p=>G.dist(p,b.center)<=b.radius*1.6)&&texts.some(t=>t.position&&G.dist(t.position,b.center)<=b.radius*1.8));
  if(bubble){tagged.add(line.id);offer(line,'중심선',.97,'선 끝의 원형 축 번호와 연결된 기준선');}
 }
 const intersection=(a,b)=>{const p=a.points[0],q=b.points[0],u=G.sub(a.points[1],p),v=G.sub(b.points[1],q),den=G.cross(u,v);if(Math.abs(den)<1e-8)return null;const w=G.sub(q,p),t=G.cross(w,v)/den,z=G.cross(w,u)/den;return t>.04&&t<.96&&z>.04&&z<.96?{t,z}:null;};
 for(const a of axisLines){if(tagged.has(a.id))continue;const u=G.sub(a.points[1],a.points[0]),len=G.len(u);
  const cross=axisLines.filter(b=>b!==a&&Math.abs(G.dot(u,G.sub(b.points[1],b.points[0]))/(len*G.dist(...b.points)))<.03&&intersection(a,b));
  if(cross.filter(b=>tagged.has(b.id)).length>=2)offer(a,'중심선',.95,'번호가 확인된 기준축 두 개 이상을 가로지르는 선');
  else if(cross.length>=3&&len>=4000){
   // Dense parallel pairs are likely wall outlines, not grid axes.
   const paired=axisLines.some(b=>{if(b===a)return false;const v=G.sub(b.points[1],b.points[0]);if(Math.abs(G.cross(u,v))/(len*G.len(v))>.005)return false;const gap=Math.abs(G.cross(G.sub(b.points[0],a.points[0]),u))/len;return gap>=40&&gap<=500&&G.entityDistance(b,a.points[0])<600;});
   if(!paired)offer(a,'중심선',.84,'긴 직교 기준선망 · 축 번호가 없어 확인 필요');
  }
 }
 // Parallel lines bucketed by direction, with bounded comparisons.
 const buckets=new Map(),lines=eligible.filter(e=>e.type==='line'&&e.points?.length===2);
 for(const e of lines){const [a,b]=e.points,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length<300)continue;let angle=Math.atan2(dy,dx);if(angle<0)angle+=Math.PI;const key=Math.round(angle*180/Math.PI)%180;const list=buckets.get(key)||[];list.push({e,a,b,dx:dx/length,dy:dy/length,length});buckets.set(key,list);}
 for(const list of buckets.values())for(let i=0;i<list.length;i++)for(let j=i+1;j<Math.min(list.length,i+301);j++){
  const a=list[i],b=list[j];if(Math.abs(a.dx*b.dy-a.dy*b.dx)>.005)continue;
  const gap=Math.abs((b.a.x-a.a.x)*a.dy-(b.a.y-a.a.y)*a.dx);
  const t1=(b.a.x-a.a.x)*a.dx+(b.a.y-a.a.y)*a.dy,t2=(b.b.x-a.a.x)*a.dx+(b.b.y-a.a.y)*a.dy;
  const overlap=Math.min(a.length,Math.max(t1,t2))-Math.max(0,Math.min(t1,t2));
  if(gap<60||gap>500||overlap<600||overlap/Math.min(a.length,b.length)<.8)continue;
  for(const item of [a,b])offer(item.e,'벽체',.72,'60~500mm 간격의 평행선과 긴 중첩 구간 · 벽/가구 구분 확인 필요');
  if(gap<=250&&list.length<150){
   const between=list.filter(c=>c!==a&&c!==b&&Math.abs(c.dx*a.dy-c.dy*a.dx)<.005).find(c=>{const d=(c.a.x-a.a.x)*a.dy-(c.a.y-a.a.y)*a.dx,side=(b.a.x-a.a.x)*a.dy-(b.a.y-a.a.y)*a.dx;return d*side>0&&Math.abs(d)<gap&&Math.abs((c.a.x-a.a.x)*a.dx+(c.a.y-a.a.y)*a.dy)<100&&Math.abs(c.length-a.length)<100;});
   if(between)for(const item of [a,b,between])offer(item.e,'창호',.8,'좁은 폭 안의 3중 평행선 · 창호 후보');
  }
 }

 // A long line equidistant between two wall faces is a center-axis candidate.
 for(const list of buckets.values())for(const mid of list){
  if(mid.length<2500)continue;
  const neighbors=[];
  for(const face of list){if(face===mid||Math.abs(mid.dx*face.dy-mid.dy*face.dx)>.005)continue;
   const offset=(face.a.x-mid.a.x)*(-mid.dy)+(face.a.y-mid.a.y)*mid.dx;
   if(Math.abs(offset)<30||Math.abs(offset)>250)continue;
   const t1=(face.a.x-mid.a.x)*mid.dx+(face.a.y-mid.a.y)*mid.dy,t2=(face.b.x-mid.a.x)*mid.dx+(face.b.y-mid.a.y)*mid.dy;
   const low=Math.min(t1,t2),high=Math.max(t1,t2),overlap=Math.min(mid.length,high)-Math.max(0,low);
   if(overlap>=2000&&overlap/Math.min(mid.length,face.length)>=.85)neighbors.push({face,offset,low,high});
   if(neighbors.length>=80)break;
  }
  let pair=null;for(const a of neighbors){const b=neighbors.find(b=>a.offset*b.offset<0&&Math.abs(a.offset+b.offset)<=Math.max(5,Math.abs(a.offset)*.08)&&Math.min(a.high,b.high)-Math.max(a.low,b.low)>=2000);if(b){pair=[a,b];break;}}
  if(!pair)continue;
  const extendsBoth=pair.every(f=>f.low>=100&&f.high<=mid.length-100);
  offer(mid.e,'중심선',extendsBoth?.96:.88,extendsBoth?'벽 양면의 정중앙이며 벽 끝보다 양쪽으로 연장된 선':'벽 양면과 등거리인 긴 가운데 선 · 창틀 여부 확인');
  for(const side of pair)offer(side.face.e,'벽체',.87,'긴 가운데 선을 양쪽에서 감싸는 벽면 후보');
 }
 // A quarter-circle swing with a radial leaf is a door candidate.
 for(const arc of eligible.filter(e=>e.type==='arc'&&e.radius>=400&&e.radius<=1800)){
  const sweep=((arc.endAngle-arc.startAngle)%360+360)%360;if(Math.abs(sweep-90)>3)continue;
  const endpoints=[arc.startAngle,arc.endAngle].map(a=>({x:arc.center.x+arc.radius*Math.cos(a*Math.PI/180),y:arc.center.y+arc.radius*Math.sin(a*Math.PI/180)}));
  const leaf=lines.find(l=>l.points.some(p=>G.dist(p,arc.center)<20)&&l.points.some(p=>endpoints.some(q=>G.dist(p,q)<20)));
  if(leaf){offer(arc,'문',.93,'90도 개폐 호와 중심에 연결된 문짝 선');offer(leaf,'문',.93,'개폐 호에 연결된 문짝 선');}
 }
 return eligible.map(e=>{
  const semantic=classifyByLayerKnowledge(e,layers.get(e.layer));
  const geometric=proposals.get(e.id);
  const decision=semantic||(geometric?{...geometric,evidenceKind:'heuristic',ruleIds:['legacy.geometry']}:{id:e.id,label:null,confidence:0,reason:'형상 근거 부족 · 원본 유지',accepted:false,evidenceKind:'unknown',ruleIds:[]});
  return {...decision,geometricCandidates:[...(geometryEvidence.get(e.id)?.values()||[])]};
 });
}
/* 레이어 자동정리(사용자 결정 2026-10-09, 실제 평면도 시험 뒤):
   - 모양으로 벽·문·창을 가리는 것은 하지 않는다. 실제 사무소 평면도 10장에서 모양 규칙이 '벽'이라 한 것 중 9%, '창' 중 25% 만 맞았다
     (가구·마감·타일 선도 나란한 두 줄이다). 틀리게 옮기느니 옮기지 않는다.
   - 레이어 단위로 옮긴다: 레이어 이름(또는 사무소가 전에 정해 둔 이름)이 분류 하나를 가리키면 그 레이어를 통째로(DIM 안 글자도 치수).
   - 이름으로 모르는 섞인 레이어('0' 등)에서는 종류가 확실한 글자·치수·해치만 따로 옮기고 나머지는 그대로 둔다.
   - 사람이 정해 준 레이어는 사무소 사전(dictionary: 정리한 레이어 이름 → 분류)에 기억해 다음 도면에 쓴다(app.js). */
export function analyzeRankedDrawingLayers(doc,{dictionary={}}={}){
 const layers=new Map(doc.layers.map(l=>[l.id,l]));
 const eligible=doc.entities.filter(e=>layerKnowledgeEligible(e,layers.get(e.layer)));
 return layerUnitDecisions(doc,eligible.map(e=>({...rankLayerCandidates(e,layers.get(e.layer),[],false),geometryEvaluated:false})),dictionary);
}
/** 레이어 이름 비교용: 외부 참조를 묶어 붙은 이름(평면도$0$WALL, 주동$1$WALL, 도면|WALL)은 원래 이름(WALL)으로. */
export function layerDictionaryKey(name){return String(name||'').normalize('NFKC').toUpperCase().trim().split(/\$\d+\$|\|/).pop();}
const NATIVE_LABEL=e=>{const t=String(e.type||'').toLowerCase();return t==='text'||t==='mtext'?'문자':/^dim/.test(t)||t.includes('dimension')?'치수':t==='hatch'?'해치':null;};
export function layerUnitDecisions(doc,decisions,dictionary={}){
 const standards=new Set(STANDARD_LAYERS.map(l=>l.label)),entities=new Map(doc.entities.map(e=>[e.id,e])),layers=new Map(doc.layers.map(l=>[l.id,l])),groups=new Map();
 for(const d of decisions){const layer=entities.get(d.id)?.layer;if(!groups.has(layer))groups.set(layer,[]);groups.get(layer).push(d);}
 const out=new Map();
 for(const [id,group] of groups){
  // 사무소 사전: 이 이름 그대로(WALL1) 또는 직원이 이름 묶음으로 확인한 것(WALL# → WALL1·WALL2·WALL3 모두)
  const layer=layers.get(id),key=layerDictionaryKey(layer?.name),remembered=dictionary[key]??dictionary[layerExactKey(layer?.name)]??dictionary[layerFamilyKey(layer?.name)+'#'],named=layerNameLabel({name:key});
  const label=standards.has(remembered)?remembered:standards.has(named)?named:null;
  const reason=label===remembered&&remembered?`사무소에서 정해 둔 '${layer.name}' → ${label} · 레이어 통째로`:`레이어 이름 '${layer?.name}' → ${label} · 레이어 통째로`;
  for(const d of group){
   if(label&&label!=='검토필요'){out.set(d.id,{...d,label,accepted:true,layerUnit:true,reason});continue;}
   // 객체 자체에 확실한 표시가 있으면(바른 CAD 벽·문 객체, 대지선, 출처 있는 주석 분류 등 strong 근거) 섞인 레이어에서도 옮긴다. 이름·모양 추측은 아니다.
   const native=NATIVE_LABEL(entities.get(d.id))||(d.accepted&&d.label&&d.evidence?.some(e=>e.strong&&e.label===d.label)?d.label:null);
   out.set(d.id,native&&standards.has(native)?{...d,label:native,accepted:true,layerUnit:false,reason:`'${layer?.name}' 은 이름으로 알 수 없어, 객체 자체로 확실한 ${native}만 따로`}
    :{...d,label:d.label,accepted:false,layerUnit:false,reason:`'${layer?.name}' 은 이름으로 알 수 없어 그대로 · 직접 정하면 다음부터 기억`});
  }
 }
 return decisions.map(d=>out.get(d.id)||d);
}
/** 적용한 결정에서 사무소 사전에 남길 것: 레이어 안 대상 객체가 모두 같은 분류로 옮겨진 레이어만(이름 → 분류). */
export function layerDictionaryFromDecisions(doc,decisions){
 const entities=new Map(doc.entities.map(e=>[e.id,e])),layers=new Map(doc.layers.map(l=>[l.id,l])),byLayer=new Map();
 for(const d of decisions){const id=entities.get(d.id)?.layer;if(!byLayer.has(id))byLayer.set(id,[]);byLayer.get(id).push(d);}
 const dictionary={};
 for(const [id,group] of byLayer){const labels=new Set(group.map(d=>d.accepted?d.label:null));if(labels.size!==1||labels.has(null))continue;const name=layers.get(id)?.name;if(!name||/^0$|^DEFPOINTS$/i.test(name))continue;dictionary[layerDictionaryKey(name)]=[...labels][0];}
 return dictionary;
}
export function autoOrganizeDrawingLayers(doc){
 const decisions=analyzeRankedDrawingLayers(doc);
 const result=applyDrawingLayerReview(doc,decisions);
 return {...result,review:decisions.filter(d=>!d.accepted).length,excluded:doc.entities.length-decisions.length,decisions};
}
export function layerKnowledgeEligible(e,l){return l&&!l.locked&&l.visible!==false&&!l.frozen&&!e.hidden&&!e.referenceOnly&&!e.xref&&!e.designGroup&&!/^(?:A-SITE(?:-|$)|SITE(?:-|$)|CHECK-)/i.test(l.name);}
export function applyDrawingLayerReview(doc,decisions,{outline=null,zone=''}={}){
 let changed=0;
 const entitiesById=new Map(doc.entities.map(e=>[e.id,e])),layersById=new Map(doc.layers.map(l=>[l.id,l])),layersByName=new Map(doc.layers.map(l=>[l.name,l]));
 for(const d of decisions){if(!d.accepted||!d.label)continue;const standard=standardLayerForLabel(d.label);if(!standard||d.label==='검토필요')throw Error('지원하지 않는 분류');
  const e=entitiesById.get(d.id);if(!e)throw Error('분석 이후 객체가 변경되었습니다. 다시 분석하세요.');const source=layersById.get(e.layer);
  if(!source||source.locked||source.visible===false||source.frozen||e.hidden)throw Error('잠금 또는 숨김 객체는 변경할 수 없습니다.');
  let target=layersByName.get(standard.name);if(target&&(target.locked||target.visible===false||target.frozen))throw Error('대상 레이어가 잠기거나 숨겨져 있습니다.');
  if(!target){target={...standard,id:crypto.randomUUID(),visible:true,locked:false,linetype:standard.linetype};doc.layers.push(target);layersByName.set(target.name,target);layersById.set(target.id,target);}
  // 레이어만 옮긴다. 객체에 따로 준 색·선 굵기는 그대로 둔다(출력 모양이 바뀌지 않게). 이미 있는 표준 레이어의 설정도 덮지 않는다.
  e.layer=target.id;changed++;
 }
 // 도면 확인(2026-10-22): 벽 둘레로 만든 건물 외곽(법규 검토가 읽는 닫힌 선)과 직원이 고른 용도지역을 같은 되돌리기 한 번에 남긴다.
 if(outline?.length>=3){const standard=standardLayerForLabel('건물 1층 외곽');let target=layersByName.get(standard.name);
  if(!target){target={...standard,id:crypto.randomUUID(),visible:true,locked:false,linetype:standard.linetype};doc.layers.push(target);layersByName.set(target.name,target);}
  if(target.locked)throw Error('건물 외곽 레이어가 잠겨 있습니다.');
  doc.entities.push({id:crypto.randomUUID(),type:'polyline',layer:target.id,closed:true,points:outline.map(p=>({x:p.x,y:p.y})),attributes:{source:'도면 확인: 벽 둘레로 만듦'}});}
 if(zone)doc.reviewSettings={...doc.reviewSettings,manualZone:zone};
 return {changed};
}

/** 도면 확인(로그인 상태) 적용: 남의 도면 읽기 결과를 바른 객체로 더한다 — 원본 선은 그대로(레이어도 안 옮김).
    벽 객체(A-WALL-CONC)·벽 구멍(창 A-GLAZ·문 A-DOOR, 벽 ID 를 같은 자리에서 이어 붙임)·실(A-AREA)·계단(A-STAIR)·실 이름 글자·
    벽 중심선 외곽(A-BLDG-L1, 법규 검토가 읽음)·확인 안 한 실 밖 공간 [확인] 표시·용도지역을 한 번에(되돌리기 한 번). additions = drawing-check.foreignAdditions */
export function applyForeignDrawing(doc,additions,{zone=''}={}){
 const layerOf=label=>{const standard=standardLayerForLabel(label);let l=doc.layers.find(x=>x.name===standard.name);
  if(l&&(l.locked||l.visible===false||l.frozen))throw Error(standard.name+' 레이어가 숨김/잠금 상태입니다.');
  if(!l){l={...standard,id:crypto.randomUUID(),visible:true,locked:false,linetype:standard.linetype};doc.layers.push(l);}return l.id;};
 const L={wall:layerOf('콘크리트벽'),window:layerOf('창호'),door:layerOf('문'),area:layerOf('면적'),stair:layerOf('계단'),text:layerOf('문자'),building:layerOf('건물 1층 외곽')};
 const added=[],push=e=>{const x={...e,id:crypto.randomUUID()};doc.entities.push(x);added.push(x.id);return x;},pt=p=>({x:p.x,y:p.y});
 const m2=a=>(a/1e6).toFixed(2),mid=ps=>({x:ps.reduce((s,p)=>s+p.x,0)/ps.length,y:ps.reduce((s,p)=>s+p.y,0)/ps.length});
 const walls=additions.walls.map(w=>push({type:'wall',layer:L.wall,thickness:w.thickness,points:w.points.map(pt),openings:[]}));
 for(const o of additions.openings){const wall=walls[o.wall];if(!wall)continue;const at=G.add(wall.points[0],G.mul(G.unit(G.sub(wall.points[1],wall.points[0])),o.offset));
  try{push(wallOpening(o.kind,o.kind==='DOOR'?{width:o.width,height:PLANSET_DEFAULTS.doorHeight}:{width:o.width,height:PLANSET_DEFAULTS.windowHeight,sill:PLANSET_DEFAULTS.sill},wall,at,o.kind==='DOOR'?L.door:L.window));}catch{}}   // 벽보다 넓은 구멍 등은 건너뜀(FOREIGNREAD 와 같음)
 for(const r of additions.rooms){push({type:'polyline',closed:true,points:r.points.map(pt),layer:r.stair?L.stair:L.area});
  push({type:'text',position:mid(r.points),text:`${r.name} ${m2(r.area)}㎡`,height:200,rotation:0,layer:L.text});}
 for(const o of additions.outlines){push({type:'polyline',closed:true,points:o.points.map(pt),layer:L.building,attributes:{source:'도면 확인: 벽 중심선 외곽(남의 도면 읽기)'}});
  const b=G.bounds([{type:'polyline',points:o.points}]);push({type:'text',position:{x:b.minX,y:b.minY-800},text:`${o.label} 바닥면적 ${m2(o.area)}㎡ (벽 중심선)`.trim(),height:300,rotation:0,layer:L.text});}
 for(const c of additions.outdoor){push({type:'polyline',closed:true,points:c.points.map(pt),layer:L.area});
  push({type:'text',position:mid(c.points),text:`[확인] 실 밖 공간 ${m2(c.area)}㎡ — 바깥 발코니면 바닥면적에서 뺄 것`,height:200,rotation:0,layer:L.text});}
 if(zone)doc.reviewSettings={...doc.reviewSettings,manualZone:zone};
 return {added,walls:walls.map(w=>w.id),changed:added.length};
}
