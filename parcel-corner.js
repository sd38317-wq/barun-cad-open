import * as G from './geometry.js';

const roadEdges=road=>G.segments({points:road.points,closed:true});
const edgeRoad=(a,b,roads,tolerance)=>{
  const samples=[.2,.5,.8].map(t=>G.add(a,G.mul(G.sub(b,a),t)));
  let best=null;
  for(const road of roads){
    const edges=roadEdges(road);
    const distance=Math.max(...samples.map(p=>Math.min(...edges.map(([c,d])=>G.distanceToSegment(p,c,d)))));
    if(distance<=tolerance&&(!best||distance<best.distance))best={road,distance};
  }
  return best?.road??null;
};

/** Find a site vertex whose two boundary legs adjoin two distinct cadastral road parcels. */
export function detectCornerCuts(entities,{toleranceMm=350}={}){
  const sites=entities.filter(e=>e.parcelRole==='site'&&e.attributes?.ring!=='hole'&&e.closed&&e.points?.length>=3);
  const roads=entities.filter(e=>e.parcelRole==='road'&&e.closed&&e.points?.length>=3);
  const result=[];
  for(const site of sites)for(let index=0;index<site.points.length;index++){
    const points=site.points,vertex=points[index],previous=points[(index-1+points.length)%points.length],next=points[(index+1)%points.length];
    const before=edgeRoad(previous,vertex,roads,toleranceMm),after=edgeRoad(vertex,next,roads,toleranceMm);
    if(!before||!after||before===after||before.attributes?.pnu&&before.attributes.pnu===after.attributes?.pnu)continue;
    const u=G.unit(G.sub(previous,vertex)),v=G.unit(G.sub(next,vertex));
    const angleDeg=Math.acos(Math.max(-1,Math.min(1,G.dot(u,v))))*180/Math.PI;
    if(angleDeg>=120-.01)continue;
    result.push({id:`${site.id??site.attributes?.pnu}:${index}`,site,index,vertex:{...vertex},previous:{...previous},next:{...next},angleDeg,
      roads:[before,after],roadLabels:[before.attributes?.jibun||'도로 1',after.attributes?.jibun||'도로 2']});
  }
  return result;
}

export function statutoryCornerDistance(widthA,widthB,angleDeg){
  const widths=[Number(widthA),Number(widthB)];
  if(widths.some(w=>!Number.isFinite(w)||w<4))return {distanceM:null,status:'도로폭 4m 이상 여부 확인 필요'};
  if(widths.some(w=>w>=8))return {distanceM:null,status:'8m 이상 도로 포함 · 시행령 표 대상 아님'};
  if(!(angleDeg<120))return {distanceM:null,status:'교차각 120° 이상 · 시행령 표 대상 아님'};
  const wide=widths.filter(w=>w>=6).length;
  return {distanceM:angleDeg<90?(wide===2?4:wide===1?3:2):(wide===2?3:2),status:'가각전제 후보'};
}

export function applyApprovedCornerCuts(entities,approvals){
  const approved=new Map(approvals.filter(a=>a.approved&&a.distanceM>0).map(a=>[a.id,a]));
  if(!approved.size)return {entities,applied:0,areaM2:0};
  const output=[],bySite=new Map();
  for(const a of approved.values()){const list=bySite.get(a.site)||[];list.push(a);bySite.set(a.site,list);}
  let applied=0,areaM2=0;
  for(const entity of entities){
    const cuts=bySite.get(entity);
    if(!cuts){output.push(entity);continue;}
    output.push({...structuredClone(entity),parcelRole:'site-original',attributes:{...structuredClone(entity.attributes),reference:'가각전제 전 원대지경계'}});
    const cutByIndex=new Map(cuts.map(c=>[c.index,c])),points=[];
    for(let index=0;index<entity.points.length;index++){
      const cut=cutByIndex.get(index);
      if(!cut){points.push({...entity.points[index]});continue;}
      const vertex=entity.points[index],previous=entity.points[(index-1+entity.points.length)%entity.points.length],next=entity.points[(index+1)%entity.points.length];
      const distance=cut.distanceM*1000;
      const a=G.add(vertex,G.mul(G.unit(G.sub(previous,vertex)),Math.min(distance,G.dist(vertex,previous)*.49)));
      const b=G.add(vertex,G.mul(G.unit(G.sub(next,vertex)),Math.min(distance,G.dist(vertex,next)*.49)));
      points.push(a,b);applied++;areaM2+=Math.abs(G.polygonArea([vertex,a,b]))/1e6;
      output.push({type:'polyline',closed:true,points:[vertex,a,b],parcelRole:'corner-cut',attributes:{source:'건축법 시행령 제31조 후보 · 사용자 승인',distanceM:cut.distanceM,angleDeg:cut.angleDeg,roadWidthsM:cut.widths}});
      output.push({type:'hatch',points:[vertex,a,b],spacing:250,angle:45,solid:false,parcelRole:'corner-cut',attributes:{source:'가각전제 승인 영역 해치',distanceM:cut.distanceM}});
    }
    output.push({...entity,points,attributes:{...entity.attributes,cornerCutApproved:true}});
  }
  return {entities:output,applied,areaM2};
}
