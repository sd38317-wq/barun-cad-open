const EPS=1e-9;
const p=(x,y)=>({x,y});
const add=(a,b)=>p(a.x+b.x,a.y+b.y);
const sub=(a,b)=>p(a.x-b.x,a.y-b.y);
const mul=(a,k)=>p(a.x*k,a.y*k);
const cross=(a,b)=>a.x*b.y-a.y*b.x;
const len=a=>Math.hypot(a.x,a.y);
const unit=a=>{const value=len(a);if(value<EPS)throw Error('길이가 0인 변입니다.');return mul(a,1/value);};
const normal=a=>p(-a.y,a.x);
const positive=(value,label)=>{value=Number(value);if(!(Number.isFinite(value)&&value>0))throw Error(label+'은 양수입니다.');return value;};
const nonnegative=(value,label)=>{value=Number(value);if(!Number.isFinite(value)||value<0)throw Error(label+'은 0 이상입니다.');return value;};
const same=(a,b)=>Math.abs(a.x-b.x)<EPS&&Math.abs(a.y-b.y)<EPS;
const orient=(a,b,c)=>cross(sub(b,a),sub(c,a));
const onSegment=(a,b,q)=>Math.abs(orient(a,b,q))<EPS&&q.x>=Math.min(a.x,b.x)-EPS&&q.x<=Math.max(a.x,b.x)+EPS&&q.y>=Math.min(a.y,b.y)-EPS&&q.y<=Math.max(a.y,b.y)+EPS;
const intersects=(a,b,c,d)=>{const ab1=orient(a,b,c),ab2=orient(a,b,d),cd1=orient(c,d,a),cd2=orient(c,d,b);if(((ab1>EPS&&ab2<-EPS)||(ab1<-EPS&&ab2>EPS))&&((cd1>EPS&&cd2<-EPS)||(cd1<-EPS&&cd2>EPS)))return true;return onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);};
const signedArea=points=>points.reduce((sum,value,index)=>sum+value.x*points[(index+1)%points.length].y-points[(index+1)%points.length].x*value.y,0)/2;
const polygon=(input,label='경계')=>{if(!Array.isArray(input))throw Error(label+' 좌표가 필요합니다.');const points=input.map((value,index)=>{if(!value||!Number.isFinite(value.x)||!Number.isFinite(value.y))throw Error(`${label} ${index+1}번 좌표를 확인하세요.`);return p(value.x,value.y);});if(points.length>1&&same(points[0],points.at(-1)))points.pop();if(points.length<3)throw Error(label+'는 점이 세 개 이상이어야 합니다.');for(let index=0;index<points.length;index++)if(same(points[index],points[(index+1)%points.length]))throw Error(label+'에 길이 0인 변이 있습니다.');for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){if(j===i+1||i===0&&j===points.length-1)continue;if(intersects(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length]))throw Error(label+'가 자기 교차합니다.');}if(Math.abs(signedArea(points))<EPS)throw Error(label+' 면적이 0입니다.');return points;};
const inside=(point,points)=>{let result=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if(onSegment(a,b,point))return true;if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;}return result;};
const polygonsOverlap=(a,b)=>{for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)if(intersects(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]))return true;return inside(a[0],b)||inside(b[0],a);};
const validateHoles=(outer,holes,label)=>{for(const [index,hole] of holes.entries()){if(hole.some(value=>!inside(value,outer)))throw Error(`${label} 공제 경계 ${index+1}이 외곽선 밖에 있습니다.`);for(let other=0;other<index;other++)if(polygonsOverlap(hole,holes[other]))throw Error(`${label} 공제 경계가 서로 겹칩니다.`);}};
const measure=(boundary,holes=[],label='경계')=>{const outer=polygon(boundary,label),inner=(holes||[]).map((value,index)=>polygon(value,`${label} 공제 ${index+1}`));validateHoles(outer,inner,label);const gross=Math.abs(signedArea(outer)),deduction=inner.reduce((sum,value)=>sum+Math.abs(signedArea(value)),0);if(deduction>=gross-EPS)throw Error(label+' 공제면적이 전체 면적보다 큽니다.');return {outer,holes:inner,grossSqm:gross/1e6,deductionSqm:deduction/1e6,netSqm:(gross-deduction)/1e6};};
const entity=(points,layer,role)=>({type:'polyline',layer,points,closed:true,role});

export function siteArea({boundary,exclusions=[],layer='default'}={}){
 const result=measure(boundary,exclusions,'대지 경계');return {type:'siteArea',grossArea:result.grossSqm,excludedArea:result.deductionSqm,netArea:result.netSqm,unit:'m²',entities:[entity(result.outer,layer,'site-boundary'),...result.holes.map(points=>entity(points,layer,'site-exclusion'))],note:'입력 경계의 기하 면적. 지적·측량·법정 대지면적 확정 아님'};
}

export function buildingAreaSummary(buildings,{layer='default'}={}){
 if(!Array.isArray(buildings)||!buildings.length)throw Error('건축물 외곽선 입력이 없습니다.');const seen=new Set(),rows=buildings.map((item,index)=>{const id=String(item.id??`B${index+1}`);if(seen.has(id))throw Error('건축물 ID가 중복됩니다: '+id);seen.add(id);const result=measure(item.boundary,item.voids||[],`건축물 ${id}`);return {id,name:String(item.name??id),area:result.netSqm,grossArea:result.grossSqm,voidArea:result.deductionSqm,boundary:result.outer,voids:result.holes};});return {type:'buildingAreaSummary',rows,totalArea:rows.reduce((sum,item)=>sum+item.area,0),unit:'m²',entities:rows.flatMap(item=>[entity(item.boundary,layer,'building-footprint'),...item.voids.map(points=>entity(points,layer,'building-void'))]),note:'입력 투영 경계의 합계. 법정 건축면적 산입·불산입 판정 아님'};
}

export function grossFloorArea(floors){
 if(!Array.isArray(floors)||!floors.length)throw Error('층별 면적 입력이 없습니다.');const seen=new Set(),rows=floors.map((item,index)=>{const id=String(item.id??`F${index+1}`);if(seen.has(id))throw Error('층 ID가 중복됩니다: '+id);seen.add(id);const area=item.boundary?measure(item.boundary,item.voids||[],`층 ${id}`).netSqm:positive(item.area,'층 면적'),excluded=nonnegative(item.excludedArea||0,'산입 제외 면적');if(excluded>area+EPS)throw Error('산입 제외 면적이 층 면적보다 큽니다.');const counted=item.farIncluded===false?0:area-excluded;return {id,name:String(item.name??id),floor:String(item.floor??id),area,excludedArea:excluded,countedArea:counted,farIncluded:item.farIncluded!==false};});return {type:'grossFloorArea',rows,totalGrossArea:rows.reduce((sum,item)=>sum+item.area,0),totalExcludedArea:rows.reduce((sum,item)=>sum+item.excludedArea+(item.farIncluded?0:item.area-item.excludedArea),0),farCountedArea:rows.reduce((sum,item)=>sum+item.countedArea,0),unit:'m²',note:'사용자가 지정한 산입 여부의 집계. 법정 연면적·용적률 산입 기준 판정 아님'};
}

export function coverageRatio({buildingArea,siteArea,limit=0}={}){
 buildingArea=nonnegative(buildingArea,'건축면적');siteArea=positive(siteArea,'대지면적');limit=nonnegative(limit,'사용자 건폐율 기준');const ratio=buildingArea/siteArea*100;return {type:'coverageRatio',buildingArea,siteArea,ratio,limit,passesUserCriterion:limit>0?ratio<=limit+EPS:null,note:'사용자 입력 면적과 기준의 산술 비교. 법정 건폐율 판정 아님'};
}

export function floorAreaRatio({countedFloorArea,siteArea,limit=0}={}){
 countedFloorArea=nonnegative(countedFloorArea,'용적률 산입 연면적');siteArea=positive(siteArea,'대지면적');limit=nonnegative(limit,'사용자 용적률 기준');const ratio=countedFloorArea/siteArea*100;return {type:'floorAreaRatio',countedFloorArea,siteArea,ratio,limit,passesUserCriterion:limit>0?ratio<=limit+EPS:null,note:'사용자 지정 산입면적과 기준의 비교. 법정 용적률 판정 아님'};
}

export function landscapeArea({zones,siteArea,targetRatio=0,layer='default'}={}){
 if(!Array.isArray(zones)||!zones.length)throw Error('조경 구역 입력이 없습니다.');siteArea=positive(siteArea,'대지면적');targetRatio=nonnegative(targetRatio,'사용자 조경비율 기준');const rows=zones.map((item,index)=>{const boundary=Array.isArray(item)?item:item.boundary,result=measure(boundary,Array.isArray(item)?[]:item.exclusions||[],`조경 구역 ${index+1}`);return {id:String(item.id??index+1),area:result.netSqm,boundary:result.outer,holes:result.holes};}),area=rows.reduce((sum,item)=>sum+item.area,0),ratio=area/siteArea*100;return {type:'landscapeArea',rows,area,siteArea,ratio,targetRatio,passesUserCriterion:targetRatio>0?ratio+EPS>=targetRatio:null,entities:rows.flatMap(item=>[entity(item.boundary,layer,'landscape-zone'),...item.holes.map(points=>entity(points,layer,'landscape-exclusion'))]),note:'입력 구역 합계와 사용자 기준 비교. 법정 조경면적 인정 여부 판정 아님'};
}

const centroid=points=>{const area=signedArea(points);let x=0,y=0;for(let index=0;index<points.length;index++){const a=points[index],b=points[(index+1)%points.length],factor=a.x*b.y-b.x*a.y;x+=(a.x+b.x)*factor;y+=(a.y+b.y)*factor;}return Math.abs(area)<EPS?mul(points.reduce((sum,value)=>add(sum,value),p(0,0)),1/points.length):p(x/(6*area),y/(6*area));};
export function roomTag({id,name,floor='미지정',use='미지정',boundary,holes=[],position,precision=2,layer='default',textHeight=150}={}){
 id=String(id??'').trim();name=String(name??'').trim();if(!id||!name)throw Error('실 ID와 실명이 필요합니다.');precision=Number(precision);if(!Number.isInteger(precision)||precision<0||precision>4)throw Error('면적 소수 자릿수는 0~4입니다.');textHeight=positive(textHeight,'문자 높이');const result=measure(boundary,holes,`실 ${id}`),tagPosition=position?polygon([position,add(position,p(1,0)),add(position,p(0,1))],'태그 위치')[0]:centroid(result.outer),text=`${name}\n${result.netSqm.toFixed(precision)} ㎡`;return {type:'roomTag',room:{id,name,floor:String(floor),use:String(use),area:result.netSqm,boundary:result.outer,holes:result.holes},entity:{type:'text',layer,position:tagPosition,height:textHeight,text,align:'center',role:'room-tag',roomId:id}};
}

const roomRow=(item,index)=>{const id=String(item.id??`R${index+1}`),name=String(item.name??id),floor=String(item.floor??'미지정'),use=String(item.use??'미지정'),area=item.area===undefined?measure(item.boundary,item.holes||[],`실 ${id}`).netSqm:positive(item.area,'실 면적');return {id,name,floor,use,area};};
export function roomAreaSchedule(rooms,{groupBy='floor'}={}){
 if(!Array.isArray(rooms)||!rooms.length)throw Error('실 정보가 없습니다.');if(!['floor','use','none'].includes(groupBy))throw Error('면적표 그룹 기준 오류');const seen=new Set(),rows=rooms.map(roomRow);for(const row of rows){if(seen.has(row.id))throw Error('실 ID가 중복됩니다: '+row.id);seen.add(row.id);}rows.sort((a,b)=>a.floor.localeCompare(b.floor,'ko')||a.name.localeCompare(b.name,'ko'));const groups={};for(const row of rows){const key=groupBy==='none'?'전체':row[groupBy];groups[key]=(groups[key]||0)+row.area;}return {type:'roomAreaSchedule',groupBy,rows,groups,totalArea:rows.reduce((sum,item)=>sum+item.area,0),unit:'m²'};
}

export function syncRoomAreaSchedule(existing,rooms,{groupBy='floor'}={}){
 const before=Array.isArray(existing)?existing:existing?.rows;if(!Array.isArray(before))throw Error('기존 면적표 행이 필요합니다.');const next=roomAreaSchedule(rooms,{groupBy}),oldMap=new Map(before.map(item=>[String(item.id),item])),newMap=new Map(next.rows.map(item=>[item.id,item])),added=next.rows.filter(item=>!oldMap.has(item.id)),removed=before.filter(item=>!newMap.has(String(item.id))),updated=next.rows.filter(item=>{const old=oldMap.get(item.id);return old&&['name','floor','use','area'].some(key=>String(old[key])!==String(item[key]));});return {type:'roomAreaScheduleSync',schedule:next,changes:{added,updated,removed},changed:!!(added.length||updated.length||removed.length),note:'실 ID를 기준으로 변경안을 생성하며 원본 표는 직접 수정하지 않음'};
}

const lineIntersection=(a,u,b,v)=>{const denominator=cross(u,v);if(Math.abs(denominator)<EPS)throw Error('평행한 변으로 이격 경계를 만들 수 없습니다.');return add(a,mul(u,cross(sub(b,a),v)/denominator));};
export function setbackEnvelope({boundary,distance,layer='default'}={}){
 const outer=polygon(boundary,'대지 경계');distance=positive(distance,'이격 거리');const direction=Math.sign(signedArea(outer));for(let index=0;index<outer.length;index++){const value=orient(outer[index],outer[(index+1)%outer.length],outer[(index+2)%outer.length]);if(value*direction<=EPS)throw Error('사용자 이격선은 볼록 경계에서만 지원합니다.');}const shifted=outer.map((value,index)=>{const u=unit(sub(outer[(index+1)%outer.length],value)),inward=mul(normal(u),direction),point=add(value,mul(inward,distance));return {point,u};}),envelope=shifted.map((current,index)=>{const previous=shifted[(index-1+shifted.length)%shifted.length];return lineIntersection(previous.point,previous.u,current.point,current.u);});const originalArea=Math.abs(signedArea(outer))/1e6,setbackArea=Math.abs(signedArea(envelope))/1e6;if(setbackArea<EPS||setbackArea>=originalArea-EPS||envelope.some(value=>!inside(value,outer)))throw Error('이격 거리가 경계 크기에 비해 너무 큽니다.');return {type:'setbackEnvelope',distance,boundary:outer,envelope,originalArea,setbackArea,entities:[entity(outer,layer,'site-boundary'),entity(envelope,layer,'user-setback')],note:'사용자 입력 거리의 기하 이격선. 도로·인접대지·지역별 법정 이격 판정 아님'};
}
