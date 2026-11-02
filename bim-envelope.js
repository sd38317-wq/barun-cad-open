import {drainModelWork,runModelWork} from './model-work.js';
// BIM 보조 계산: 설계엔진 배치의 층별 덩어리, 정북일조 개략 검토, IFC로 보낼 자료.
// 3D 검토(review-3d.js)와 IFC 내보내기(app.js → ifc-writer.js)가 같이 쓴다. three.js 를 부르지 않는다.
import {layerLevel,storeyTable} from './storeys.js';
//
// 정북일조 기준(건축법 시행령 제86조): 높이 10m 이하 부분은 정북 인접대지경계선에서 1.5m 이상,
// 10m 를 넘는 부분은 그 높이의 1/2 이상 띄운다. 여기 값은 개략 검토이며 법규 판정이 아니다.

export function floorElevation(name,height=3000){const m=String(name).match(/(?:^|[ _-])(\d+)F(?:$|[ _-])/i);return m?Math.max(0,Number(m[1])-1)*height:0;}

/** 정북 경계선에서 d(m) 떨어진 곳의 허용 높이(m). */
export function northAllowedHeight(d){if(!(d>=1.5))return 0;return d<5?10:2*d;}

/** 점 p 에서 정북으로 곧장 올라가 대지 경계선(ring)에 닿기까지 거리(m). 위쪽 경계가 없으면 Infinity. */
export function northDistance(ring,p){
 let best=Infinity;
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length];
  if(a.x===b.x||!(a.x<=p.x&&p.x<b.x||b.x<=p.x&&p.x<a.x))continue;
  const y=a.y+(p.x-a.x)*(b.y-a.y)/(b.x-a.x);
  if(y>=p.y-1e-9)best=Math.min(best,y-p.y);
 }
 return best;
}

function inside(ring,p){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(a.y>p.y!==b.y>p.y&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
const metres=points=>points.map(p=>({x:p.x/1000,y:p.y/1000}));

/** 대지 외곽(도면 좌표 mm). 설계엔진 배치가 있으면 배치도 안의 대지 경계를 쓴다 — 배치도는 원래 지적 옆에 따로 그려진다. */
export function sitePoints(doc){
 const plan=doc.sitePlan,layerName=id=>doc.layers.find(l=>l.id===id)?.name||'';
 if(plan?.contextGeometry?.length){
  const rings=plan.contextGeometry.map(c=>doc.entities.find(e=>e.id===c.entityId)).filter(e=>e?.points?.length>=3&&!/ROAD/i.test(layerName(e.layer))).map(e=>e.points);
  if(rings.length)return rings;
 }
 return doc.entities.filter(e=>e.parcelRole==='site'&&e.closed&&e.attributes?.ring!=='hole'&&e.points?.length>=3).map(e=>e.points);
}
export function siteRings(doc){return sitePoints(doc).map(metres);}

/** 설계엔진 배치(doc.sitePlan)의 층별 외곽선과 높이. 높이는 m, 외곽선은 도면 좌표(mm).
    옥탑(계단실)은 맨 위층 위에 3m 로 얹는다 — 설계엔진도 옥탑을 정북일조 검토에 넣는다. */
export function sitePlanMasses(doc){
 const plan=doc.sitePlan;if(!plan?.bindings)return [];
 const byFloor=plan.report?.sunlight?.by_floor||[],floorHeight=Number(plan.request?.program?.floor_h)||3;
 const floors=plan.bindings.filter(b=>b.path[0]==='floors').sort((a,b)=>a.path[1]-b.path[1]);
 const out=[];let low=0;
 for(const binding of floors){
  const index=binding.path[1],entity=doc.entities.find(e=>e.id===binding.entityId);if(!entity?.points?.length)continue;
  const top=Number(byFloor.find(f=>f.floor===index+1)?.top_h)||(index+1)*floorHeight;
  out.push({floor:index+1,entityId:entity.id,points:entity.points,low,top});low=top;
 }
 const roof=plan.bindings.find(b=>b.path[0]==='rooftop_box'),roofEntity=roof&&doc.entities.find(e=>e.id===roof.entityId);
 if(out.length&&roofEntity?.points?.length)out.push({floor:'옥탑',entityId:roofEntity.id,points:roofEntity.points,low,top:low+3});
 return out;
}

function edgeSamples(ring,step){const out=[];for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/step));for(let k=0;k<n;k++)out.push({x:a.x+(b.x-a.x)*k/n,y:a.y+(b.y-a.y)*k/n});}return out;}

/** 층마다 정북일조 여유(m, 음수면 초과). 대지나 배치가 없으면 null. */
export function northCheck(doc,{step=.5}={}){
 const rings=siteRings(doc),masses=sitePlanMasses(doc),sun=doc.sitePlan?.report?.sunlight;
 if(!rings.length||!masses.length)return null;
 const credit=Number(sun?.boundary_credit_m)||0,applies=sun?.applies!==false;
 const distance=p=>Math.min(...rings.map(r=>northDistance(r,p)))+credit;
 const floors=masses.map(m=>{
  let margin=Infinity;
  if(applies)for(const p of edgeSamples(metres(m.points),step))margin=Math.min(margin,northAllowedHeight(distance(p))-m.top);
  return {...m,margin,ok:!(margin<-.02)};
 });
 return {applies,credit,floors};
}

/** 대지 위 정북일조 허용 높이 면(삼각형, m). three.js 에서 (x, h, -y) 로 그린다. */
export function northEnvelope(doc,{cells=60,cap}={}){
 const rings=siteRings(doc),sun=doc.sitePlan?.report?.sunlight;
 if(!rings.length||sun?.applies===false)return [];
 const credit=Number(sun?.boundary_credit_m)||0,all=rings.flat();
 const minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y));
 const step=Math.max(.25,Math.max(maxX-minX,maxY-minY)/cells),limit=cap??Math.max(12,...sitePlanMasses(doc).map(m=>m.top))+4;
 const height=p=>Math.min(limit,northAllowedHeight(Math.min(...rings.map(r=>northDistance(r,p)))+credit));
 const node=(x,y)=>{const p={x,y};return rings.some(r=>inside(r,p))?{x,y,h:height(p)}:null;};
 const triangles=[];
 for(let x=minX;x<maxX;x+=step)for(let y=minY;y<maxY;y+=step){
  const a=node(x,y),b=node(x+step,y),c=node(x+step,y+step),d=node(x,y+step);
  if(a&&b&&c)triangles.push([a,b,c]);if(a&&c&&d)triangles.push([a,c,d]);
 }
 return triangles;
}

/** IFC 로 보낼 자료: 벽·문·창·실·대지·배치 덩어리만 추린다(도면 전체를 보내지 않는다). 길이 mm. */
export function ifcPayload(doc,options={}){return drainModelWork(ifcPayloadSteps(doc,options));}
export function ifcPayloadAsync(doc,options={},work={}){return runModelWork(ifcPayloadSteps(doc,options,!!work.onProgress),work);}
function* ifcPayloadSteps(doc,{floorHeight=Number(doc.reviewSettings?.floorHeight)||3000}={},progress=false){
 const layerOf=id=>doc.layers.find(l=>l.id===id)||{},table=storeyTable(doc),level=id=>layerLevel(doc,layerOf(id),floorHeight,table);
 // 철거할 객체는 IFC(계획 모델)에서 뺀다. 숨김·꺼진 레이어도 뺀다.
 const shown=e=>{const l=layerOf(e.layer);return l.visible!==false&&!l.frozen&&!e.hidden&&e.renovation!=='demolish';};
 const selectedWalls=doc.entities.filter(e=>e.type==='wall'&&e.points?.length===2&&shown(e)),tags=doc.entities.filter(e=>e.roomBoundary&&shown(e));
 const walls=[],rooms=[],total=selectedWalls.length+tags.length;let done=0;
 const tick=()=>progress?{phase:'prepare',label:'IFC 도면 객체 준비',done:++done,total,unit:'개'}:undefined;
 for(const e of selectedWalls){
  const layer=layerOf(e.layer),[p0,p1]=e.points,length=Math.hypot(p1.x-p0.x,p1.y-p0.y)||1,u={x:(p1.x-p0.x)/length,y:(p1.y-p0.y)/length};
  const height=e.model3d?.height??level(e.layer).height,base=level(e.layer).base+(e.model3d?.elevation||0);
  const openings=doc.entities.filter(o=>o.hostWall===e.id&&o.position).map(o=>{
   const kind=String(o.category||o.parameters?.kind||'').toUpperCase().includes('DOOR')?'door':'window';
   return {kind,name:o.attributes?.mark||o.name||'',offset:(o.position.x-p0.x)*u.x+(o.position.y-p0.y)*u.y,width:o.openingWidth||o.parameters?.width||900,
    height:o.parameters?.height||(kind==='door'?2100:1200),sill:o.parameters?.sill??(kind==='door'?0:900)};
  });
  walls.push({id:e.id,start:p0,end:p1,thickness:e.thickness||200,height,base,layer:layer.name||'',openings});yield tick();
 }
 for(const tag of tags){
  const boundary=doc.entities.find(b=>b.id===tag.roomBoundary);if(!boundary?.points?.length){yield tick();continue;}
  rooms.push({name:tag.room?.name||String(tag.text||'').trim()||'실',points:boundary.points,base:level(boundary.layer).base,height:level(boundary.layer).height});yield tick();
 }
 const masses=sitePlanMasses(doc).map(m=>({floor:m.floor,points:m.points,base:m.low*1000,height:(m.top-m.low)*1000}));
 const pnu=doc.entities.find(e=>e.parcelRole==='site')?.attributes?.pnu||'',site=sitePoints(doc).map(points=>({points,pnu}));
 const storeys=table.map(r=>({name:r.name,elevation:r.elevation,height:r.height}));
 return {name:doc.name||'바른 CAD 도면',floorHeight,walls,rooms,masses,site,storeys};
}
