import {makeReviewItem,reviewValue,compareCriterion} from './review-model.js';
import * as G from './geometry.js';

export function deadEndRoadRequirement(lengthM,{nonUrbanTownship=false,terrainException=false}={}){
 const length=Number(lengthM);
 if(!Number.isFinite(length)||length<0)return {requiredWidthM:null,label:'막다른도로 길이 확인 필요'};
 if(terrainException)return {requiredWidthM:length<10?2:3,label:'지형적 조건 지정·공고 구간'};
 if(length<10)return {requiredWidthM:2,label:'길이 10m 미만'};
 if(length<35)return {requiredWidthM:3,label:'길이 10m 이상 35m 미만'};
 return {requiredWidthM:nonUrbanTownship?4:6,label:nonUrbanTownship?'35m 이상 · 비도시 읍·면':'길이 35m 이상'};
}

// 도로 필지를 넓이·둘레가 같은 직사각형으로 보고 짧은 변을 폭으로 쓴다(w = P/4 − √((P/4)² − A)).
// 예전에는 '꼭짓점↔다른 변' 최소 거리였는데, 굽은 도로는 꼭짓점이 촘촘해 옆 꼭짓점 거리(0.14m 등)를 폭으로 잡았다(A13).
export function estimatedRoadWidthM(road){
 const ps=road?.points??[];if(ps.length<3)return null;
 const area=Math.abs(G.polygonArea(ps)),perimeter=ps.reduce((sum,p,i)=>sum+G.dist(p,ps[(i+1)%ps.length]),0);
 if(!(area>0&&perimeter>0))return null;
 const q=perimeter/4,width=q*q>area?q-Math.sqrt(q*q-area):q;
 return width/1000;
}

const siteRings=entities=>entities.filter(e=>e.parcelRole==='site'&&e.attributes?.ring!=='hole'&&e.closed);
const touchesSite=(road,sites,toleranceMm)=>{const segs=G.segments(road);return sites.some(site=>G.segments(site).some(([a,b])=>{const middle=G.add(a,G.mul(G.sub(b,a),.5));return segs.some(([c,d])=>G.distanceToSegment(middle,c,d)<=toleranceMm);}));};
/** 30㎡ 미만 도로 필지는 지적도의 자투리 조각(부산시청 둘레 2.4㎡ 띠·11.7㎡ 세모 등)이라 폭 목록·해치에서 뺀다. 접도 길이에는 그대로 센다. */
export const ROAD_SLIVER_M2=30;
/** 대지에 닿은 도로(접도 판정에 쓰인 도로)만. 큰 대지는 30m 둘레 도로가 100개를 넘으니 폭·해치는 이것만 단다. */
export function frontageRoads(entities,{toleranceMm=400,minAreaM2=ROAD_SLIVER_M2}={}){
 const sites=siteRings(entities);
 return entities.filter(e=>e.parcelRole==='road'&&e.closed&&e.points?.length>=3&&G.polygonArea(e.points)/1e6>=minAreaM2&&touchesSite(e,sites,toleranceMm));
}

export function estimatedFrontageM(entities,toleranceMm=400){
 const sites=siteRings(entities),roads=entities.filter(e=>e.parcelRole==='road'&&e.closed);
 const roadSegments=roads.flatMap(road=>G.segments(road));let length=0;
 for(const site of sites)for(const [a,b] of G.segments(site)){
  const middle=G.add(a,G.mul(G.sub(b,a),.5));
  if(roadSegments.some(([c,d])=>G.distanceToSegment(middle,c,d)<=toleranceMm))length+=G.dist(a,b)/1000;
 }
 return length;
}

export function roadDisplayEntities(entities,options={}){
 const roads=frontageRoads(entities),result=[];
 const rule=options.deadEnd?deadEndRoadRequirement(options.deadEndLengthM,options):null;
 const frontage=estimatedFrontageM(entities);
 for(const [index,road] of roads.entries()){
  const width=estimatedRoadWidthM(road),center=road.points.reduce((a,p)=>({x:a.x+p.x/road.points.length,y:a.y+p.y/road.points.length}),{x:0,y:0});
  const evidence=options.roadEdges?.find(e=>e.sourceRoadPnu===road.attributes?.pnu),confirmedWidthM=evidence?.confirmedWidthM??null,legalStatus=evidence?.legalStatus??'unknown',required=rule?.requiredWidthM??null,current=reviewValue({value:confirmedWidthM==null?null:confirmedWidthM*1000,unit:'mm',sourceKind:confirmedWidthM==null?'auto_read':'designer',confirmation:confirmedWidthM==null?'unconfirmed':'confirmed',sourceRef:{raw:width,unit:'m'}}),criterion={name:'도로폭',value:required==null?null:required*1000,unit:'mm',operator:'>='},decision=legalStatus==='confirmed'?compareCriterion(current,criterion):{status:'need_input',reason:'도로 법적 지위 확인 필요'},review=makeReviewItem({field:'access',name:'도로폭 검토',current,criterion,applicability:legalStatus==='confirmed'?'applicable':legalStatus==='not-road'?'not_applicable':'unknown',progress:legalStatus==='confirmed'&&confirmedWidthM!=null&&required!=null?'done':'not_run',...decision}),status=review.status==='satisfied'?'충족':review.status==='revise'?'부족':'확인 필요';
  result.push({type:'hatch',points:road.points.map(p=>({...p})),spacing:700,angle:45,solid:false,parcelRole:'road-info',attributes:{roadDisplay:true,sourceRoadPnu:road.attributes?.pnu}});
  const pieces=[`ROAD ${index+1}`,`지적경계 추정폭 ${width?width.toFixed(2)+'m':'확인 필요'}`];
  if(index===0)pieces.push(`접도 추정 ${frontage.toFixed(2)}m · 기준 2m · 확인 필요`);
  if(rule)pieces.push(`막다른도로 ${Number(options.deadEndLengthM).toFixed(1)}m`,`${rule.label} · 필요폭 ${required??'—'}m · ${status}`);
  else pieces.push('일반도로 · 법정도로/현황폭 확인');
  pieces.push(`법적 지위 ${legalStatus==='confirmed'?'확인':legalStatus==='not-road'?'도로 아님':'미확인'} · 확인 폭 ${confirmedWidthM==null?'—':confirmedWidthM+'m'}`);
  result.push({type:'text',text:pieces.join(' · '),position:center,height:260,rotation:0,parcelRole:'road-info',color:status==='부족'?'#ff6b6b':'#9bded5',attributes:{roadDisplay:true,estimatedWidthM:width,measuredWidthM:width,confirmedWidthM,legalStatus,requiredWidthM:required,status,review}});
 }
 return result;
}

// 400mm 접도 허용오차는 후보 검색에만 쓴다.
export function roadEdgeEvidence(entities,toleranceMm=400){const sites=entities.filter(e=>e.parcelRole==='site'&&e.closed&&e.attributes?.ring!=='hole'),roads=entities.filter(e=>e.parcelRole==='road'&&e.closed),result=[];for(const [ringIdx,site] of sites.entries())for(const [index,[a,b]] of G.segments(site).entries()){const samples=[.2,.5,.8].map(t=>G.add(a,G.mul(G.sub(b,a),t)));let best=null,distance=Infinity;for(const road of roads){const segments=G.segments(road),d=Math.max(...samples.map(p=>Math.min(...segments.map(([c,d])=>G.distanceToSegment(p,c,d)))));if(d<=toleranceMm&&d<distance){best=road;distance=d;}}if(best)result.push({ringIdx,index,measuredWidthM:estimatedRoadWidthM(best),confirmedWidthM:null,legalStatus:'unknown',sourceRoadPnu:best.attributes?.pnu??null});}return result;}

export function remapRoadEvidence(entities,previous=[]){return roadEdgeEvidence(entities).map(edge=>{const old=previous.find(e=>e.ringIdx===edge.ringIdx&&e.sourceRoadPnu===edge.sourceRoadPnu);return {...edge,confirmedWidthM:old?.confirmedWidthM??null,legalStatus:old?.legalStatus??'unknown'};});}
