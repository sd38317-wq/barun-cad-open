import {buildAllFloors,floorAreaM2,roomFloorAreaM2,buildPlanDxf,buildSection,buildElevations,DEFAULT_BUILDING} from './plan-layout.js';

// 평면의 개구부를 벽에 배정한다. 두 모델이 달라서 환산이 필요하다 — 평면의 개구부는 떠 있는
// 기하(중심점 at·뻗는 방향 axis·폭 width)이고, 이 CAD의 벽은 제 길이 대비 0~1 구간([t0,t1])으로
// 구멍을 기억한다(engine.js의 wall.opening과 같은 형식이라 넣은 뒤에도 손으로 고칠 수 있다).
// 지어내지 않는다: 벽에 안 닿거나 벽 밖으로 나가는 개구부는 버리고, 하나를 두 벽에 넣지 않는다.
function assignOpenings(walls,openings){
 const spans=walls.map(()=>[]);
 for(const o of openings||[]){
  if(!Array.isArray(o?.at)||!(o.width>0))continue;
  let best=-1,bestGap=Infinity,bestSpan=null;
  for(let j=0;j<walls.length;j++){
   const w=walls[j],dx=w.b[0]-w.a[0],dy=w.b[1]-w.a[1],len=Math.hypot(dx,dy);
   if(len<1)continue;
   // 개구부가 뻗는 방향과 벽이 나란해야 한다 — 직교하는 벽에 얹으면 폭이 두께 자리로 간다.
   if(o.axis==='x'&&Math.abs(dx)<Math.abs(dy))continue;
   if(o.axis==='y'&&Math.abs(dy)<Math.abs(dx))continue;
   const t=((o.at[0]-w.a[0])*dx+(o.at[1]-w.a[1])*dy)/(len*len),half=o.width/2/len;
   // 중심이 벽 몸통 안에 있어야 그 벽의 구멍이다. 나란한 옆 벽으로 건너뛰지 않게 두께로 끊는다.
   const gap=Math.hypot(o.at[0]-(w.a[0]+dx*t),o.at[1]-(w.a[1]+dy*t));
   if(gap>w.thickness/2+1||t-half<-1e-6||t+half>1+1e-6)continue;
   if(gap<bestGap){best=j;bestGap=gap;bestSpan=[Math.max(0,t-half),Math.min(1,t+half)];}
  }
  if(best>=0)spans[best].push(bestSpan);
 }
 // 한 벽에서 겹치는 구간은 벽을 두 번 끊어 토막을 남긴다 — 먼저 자리잡은 쪽만 남긴다.
 return spans.map(list=>{const out=[];for(const s2 of list.sort((x,y)=>x[0]-y[0]))if(!out.length||s2[0]>=out[out.length-1][1])out.push(s2);return out;});
}
export function connectFloors(doc,site,spec,expected){
 if(!spec?.floors?.length)return false;
 const building={...DEFAULT_BUILDING,...spec.building,core:{...DEFAULT_BUILDING.core,...spec.building?.core},floors:spec.floors};
 const plans=buildAllFloors(building);
 if(plans.length!==expected?.length||plans.some((p,i)=>Math.abs(floorAreaM2(p)-expected[i].areaM2)>.15))throw Error('층별 형상이 생성 서버의 면적과 다릅니다. 다시 생성하세요.');
 const point=p=>({x:(site.building.xMin+site.building.widthM)*1000-p[0],y:(site.building.zMin+site.building.depthM)*1000-p[1]});
 let elevation=0,complete=true;
 doc.layers.find(l=>l.id==='건물').excludeFromFAR=true;
 for(let i=0;i<plans.length;i++){
  const plan=plans[i],height=spec.floors[i].heightMm??3000,id=`floor-${i+1}`;
  doc.layers.push({id,name:`${i+1}F`,building:true,floor:i+1,height,elevation,excludeFromCoverage:true,color:'#ffff00',visible:true,locked:false});
  const spans=assignOpenings(plan.walls,plan.openings);
  plan.walls.forEach((w,j)=>doc.entities.push({id:crypto.randomUUID(),type:'wall',layer:id,points:[point(w.a),point(w.b)],thickness:w.thickness,openings:spans[j]}));
  for(const r of plan.rooms){const counted=roomFloorAreaM2(r);if(counted<=0)continue;if(r.program==='outdoor'){complete=false;continue;}doc.entities.push({id:crypto.randomUUID(),type:'polyline',closed:true,layer:id,points:r.points.map(point)});}
  elevation+=height;
 }
 return complete;
}

export function planningDxf(spec,title){
 const building={...DEFAULT_BUILDING,...spec.building,core:{...DEFAULT_BUILDING.core,...spec.building?.core},floors:spec.floors};
 const plans=buildAllFloors(building);
 return buildPlanDxf({title,parcels:[],sharedEdge:[],floors:plans,section:buildSection(building),elevations:buildElevations(building,plans),labelMode:'korean',dateLabel:new Date().toISOString().slice(0,10)});
}
