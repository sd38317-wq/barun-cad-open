import * as G from './geometry.js';

const clonePoint=point=>({x:Number(point.x),y:Number(point.y)});
const signedArea=points=>points.reduce((sum,point,index)=>{const next=points[(index+1)%points.length];return sum+point.x*next.y-next.x*point.y;},0)/2;
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const pointInTriangle=(p,a,b,c)=>{const x=cross(a,b,p),y=cross(b,c,p),z=cross(c,a,p);return !(x< -G.EPS||y< -G.EPS||z< -G.EPS);};

export function normalizeTakeoffBoundary(points){
 if(!Array.isArray(points))throw Error('구적 경계점을 확인할 수 없습니다.');
 const clean=[];
 for(const raw of points){
  const point=clonePoint(raw);
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('구적 경계 좌표가 올바르지 않습니다.');
  if(!clean.length||G.dist(clean.at(-1),point)>G.EPS)clean.push(point);
 }
 if(clean.length>1&&G.dist(clean[0],clean.at(-1))<=G.EPS)clean.pop();
 let changed=true;
 while(changed&&clean.length>3){
  changed=false;
  for(let index=0;index<clean.length;index++){
   const before=clean[(index-1+clean.length)%clean.length],point=clean[index],after=clean[(index+1)%clean.length];
   if(Math.abs(cross(before,point,after))<=G.EPS*Math.max(1,G.dist(before,point)+G.dist(point,after))){clean.splice(index,1);changed=true;break;}
  }
 }
 if(clean.length<3)throw Error('구적 경계에는 서로 다른 점이 3개 이상 필요합니다.');
 if(!G.simpleClipPolygon(clean))throw Error('경계선이 서로 교차합니다. 겹치지 않는 폐합 경계를 지정하세요.');
 if(G.polygonArea(clean)<=G.EPS)throw Error('면적이 있는 구적 경계를 지정하세요.');
 return signedArea(clean)<0?clean.reverse():clean;
}

export function takeoffBoundary(entity){
 if(!entity)throw Error('구적할 폐합 객체를 선택하세요.');
 if(entity.type==='rectangle'||entity.type==='hatch')return normalizeTakeoffBoundary(entity.points);
 if(entity.type==='polyline'&&entity.closed)return normalizeTakeoffBoundary(entity.points);
 throw Error('닫힌 폴리선·사각형·해치 경계만 객체 선택으로 구적할 수 있습니다.');
}

export function triangulatePolygon(points){
 const boundary=normalizeTakeoffBoundary(points),indices=boundary.map((_,index)=>index),triangles=[];
 let guard=boundary.length*boundary.length;
 while(indices.length>3&&guard-->0){
  let clipped=false;
  for(let index=0;index<indices.length;index++){
   const ia=indices[(index-1+indices.length)%indices.length],ib=indices[index],ic=indices[(index+1)%indices.length];
   const a=boundary[ia],b=boundary[ib],c=boundary[ic];
   if(cross(a,b,c)<=G.EPS)continue;
   if(indices.some(candidate=>candidate!==ia&&candidate!==ib&&candidate!==ic&&pointInTriangle(boundary[candidate],a,b,c)))continue;
   triangles.push([clonePoint(a),clonePoint(b),clonePoint(c)]);indices.splice(index,1);clipped=true;break;
  }
  if(!clipped)break;
 }
 if(indices.length===3)triangles.push(indices.map(index=>clonePoint(boundary[index])));
 if(triangles.length!==boundary.length-2)throw Error('이 경계는 삼각형으로 안전하게 분할할 수 없습니다. 경계를 정리해 다시 시도하세요.');
 const area=G.polygonArea(boundary),sum=triangles.reduce((total,triangle)=>total+G.polygonArea(triangle),0);
 if(Math.abs(area-sum)>Math.max(1,area)*1e-8)throw Error('삼각 분할 면적 검산에 실패했습니다. 경계를 확인하세요.');
 return triangles;
}

const format=(number,precision)=>Number(number).toLocaleString('ko-KR',{minimumFractionDigits:precision,maximumFractionDigits:precision});
function triangleMeasurement(triangle){
 const edges=triangle.map((point,index)=>({a:point,b:triangle[(index+1)%3],length:G.dist(point,triangle[(index+1)%3])})).sort((a,b)=>b.length-a.length);
 const base=edges[0].length,area=G.polygonArea(triangle),height=2*area/base;
 return {base,height,area,centroid:{x:triangle.reduce((sum,p)=>sum+p.x,0)/3,y:triangle.reduce((sum,p)=>sum+p.y,0)/3}};
}

export function areaTakeoffEntities(points,{layer='default',textHeight=150,precision=3}={}){
 const boundary=normalizeTakeoffBoundary(points),triangles=triangulatePolygon(boundary);
 if(!Number.isInteger(precision)||precision<0||precision>6)throw Error('구적 결과 소수 자릿수는 0~6이어야 합니다.');
 const height=Math.max(10,Number(textHeight)||150),measurements=triangles.map(triangleMeasurement),box=G.bounds([{type:'polyline',closed:true,points:boundary}]);
 const entities=[{type:'polyline',closed:true,points:boundary.map(clonePoint),layer,areaTakeoff:true,color:'#d9e7ea'}];
 const edgeKeys=new Set(boundary.map((point,index)=>[point,boundary[(index+1)%boundary.length]].map(p=>`${p.x},${p.y}`).sort().join('|')));
 for(const [index,triangle] of triangles.entries()){
  for(let i=0;i<3;i++){
   const a=triangle[i],b=triangle[(i+1)%3],key=[a,b].map(p=>`${p.x},${p.y}`).sort().join('|');
   if(edgeKeys.has(key))continue;
   edgeKeys.add(key);entities.push({type:'line',points:[clonePoint(a),clonePoint(b)],layer,linetype:'DASHED',color:'#b995ff',areaTakeoff:true});
  }
  entities.push({type:'text',text:`T${index+1}`,position:measurements[index].centroid,height:height*.8,align:'center',layer,color:'#b995ff',areaTakeoff:true});
 }
 const width=box.maxX-box.minX,margin=Math.max(height*5,width*.08,500),x=box.maxX+margin,row=height*1.8;
 const areaMm2=measurements.reduce((sum,item)=>sum+item.area,0),areaM2=areaMm2/1e6,py=areaM2*121/400;
 const rows=['구적도 계산',...measurements.map((item,index)=>`T${index+1}  ${format(item.base/1000,precision)} × ${format(item.height/1000,precision)} ÷ 2 = ${format(item.area/1e6,precision)} ㎡`),`합계  ${format(areaM2,precision)} ㎡  /  ${format(py,precision)} 평`];
 const top=box.maxY;
 rows.forEach((text,index)=>entities.push({type:'text',text,position:{x,y:top-index*row},height:index===0||index===rows.length-1?height*1.15:height,align:'left',layer,color:index===rows.length-1?'#c5e56f':'#d9e7ea',areaTakeoff:true,areaTakeoffSummary:index===rows.length-1}));
 return {entities,triangles,areaMm2,areaM2,py,rows};
}
