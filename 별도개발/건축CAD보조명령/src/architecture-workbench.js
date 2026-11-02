const EPS=1e-9,clone=value=>structuredClone(value),point=(x,y)=>({x,y}),add=(a,b)=>point(a.x+b.x,a.y+b.y),sub=(a,b)=>point(a.x-b.x,a.y-b.y),mul=(a,k)=>point(a.x*k,a.y*k),length=a=>Math.hypot(a.x,a.y),unit=a=>{const value=length(a);if(value<EPS)throw Error('길이가 0인 방향입니다.');return mul(a,1/value);},normal=a=>point(-a.y,a.x),polar=degrees=>point(Math.cos(degrees*Math.PI/180),Math.sin(degrees*Math.PI/180));
const positive=(value,label)=>{value=Number(value);if(!(Number.isFinite(value)&&value>0))throw Error(label+'은 양수입니다.');return value;};
const integer=(value,label,min=1,max=10000)=>{value=Number(value);if(!Number.isInteger(value)||value<min||value>max)throw Error(label+`은 ${min}~${max}의 정수입니다.`);return value;};
const line=(a,b,layer,role)=>({type:'line',layer,points:[a,b],role});
const polyline=(points,layer,role,closed=false)=>({type:'polyline',layer,points,closed,role});

export function vehicleTurningPath({start=point(0,0),heading=0,wheelbase=2700,width=1800,frontOverhang=900,rearOverhang=900,steeringAngle=35,turnAngle=90,direction='left',samples=48,layer='default'}={}){
 wheelbase=positive(wheelbase,'축거');width=positive(width,'차량 폭');frontOverhang=positive(frontOverhang,'앞 오버행');rearOverhang=positive(rearOverhang,'뒤 오버행');steeringAngle=positive(Math.abs(steeringAngle),'조향각');turnAngle=positive(Math.abs(turnAngle),'회전각');samples=integer(samples,'분할 수',8,720);if(steeringAngle>=80||turnAngle>360)throw Error('조향각 또는 회전각 범위를 확인하세요.');if(!['left','right'].includes(direction))throw Error('회전 방향 오류');
 const sign=direction==='left'?1:-1,radius=wheelbase/Math.tan(steeringAngle*Math.PI/180),initial=polar(heading),centre=add(start,mul(normal(initial),radius*sign)),corners=[[],[],[],[]],rearAxle=[];
 for(let index=0;index<=samples;index++){
  const angle=heading+sign*turnAngle*index/samples,tangent=polar(angle),side=normal(tangent),rear=add(centre,mul(side,-radius*sign));rearAxle.push(rear);
  const front=add(rear,mul(tangent,wheelbase+frontOverhang)),back=add(rear,mul(tangent,-rearOverhang)),half=width/2;
  corners[0].push(add(front,mul(side,half)));corners[1].push(add(front,mul(side,-half)));corners[2].push(add(back,mul(side,half)));corners[3].push(add(back,mul(side,-half)));
 }
 const startOutline=[corners[0][0],corners[1][0],corners[3][0],corners[2][0]],endOutline=[corners[0].at(-1),corners[1].at(-1),corners[3].at(-1),corners[2].at(-1)];
 return {type:'vehicleTurningPath',parameters:{start:clone(start),heading,wheelbase,width,frontOverhang,rearOverhang,steeringAngle,turnAngle,direction,samples,radius},entities:[polyline(rearAxle,layer,'rear-axle-path'),...corners.map((points,index)=>polyline(points,layer,'corner-sweep-'+(index+1))),polyline(startOutline,layer,'vehicle-start',true),polyline(endOutline,layer,'vehicle-end',true)]};
}

export function curtainWallElevation({start=point(0,0),end=point(6000,0),height=3000,panelWidth=1200,transomSpacing=1500,layer='default'}={}){
 height=positive(height,'커튼월 높이');panelWidth=positive(panelWidth,'패널 폭');transomSpacing=positive(transomSpacing,'수평바 간격');const axis=sub(end,start),span=length(axis);if(span<EPS)throw Error('커튼월 길이가 0입니다.');const u=unit(axis),v=normal(u),columns=Math.ceil(span/panelWidth),rows=Math.ceil(height/transomSpacing),columnWidth=span/columns,rowHeight=height/rows,entities=[];
 for(let column=0;column<=columns;column++){const base=add(start,mul(u,column*columnWidth));entities.push(line(base,add(base,mul(v,height)),layer,'mullion'));}
 for(let row=0;row<=rows;row++){const base=add(start,mul(v,row*rowHeight));entities.push(line(base,add(base,axis),layer,'transom'));}
 for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){const origin=add(start,add(mul(u,column*columnWidth),mul(v,row*rowHeight)));entities.push(polyline([origin,add(origin,mul(u,columnWidth)),add(origin,add(mul(u,columnWidth),mul(v,rowHeight))),add(origin,mul(v,rowHeight))],layer,'glass-panel',true));}
 return {type:'curtainWallElevation',parameters:{start:clone(start),end:clone(end),height,panelWidth:columnWidth,transomSpacing:rowHeight,columns,rows},entities};
}

export function escalatorPlan({start=point(0,0),angle=0,length:runLength=8000,width=1200,rise=4500,stepRun=400,layer='default',textHeight=200}={}){
 runLength=positive(runLength,'에스컬레이터 길이');width=positive(width,'폭');rise=positive(rise,'상승 높이');stepRun=positive(stepRun,'디딤 간격');textHeight=positive(textHeight,'문자 높이');const u=polar(angle),v=normal(u),half=width/2,a=add(start,mul(v,half)),b=add(start,mul(v,-half)),end=add(start,mul(u,runLength)),c=add(end,mul(v,-half)),d=add(end,mul(v,half)),steps=Math.max(2,Math.floor(runLength/stepRun)),entities=[polyline([a,b,c,d],layer,'escalator-outline',true),line(start,end,layer,'travel-axis')];
 for(let index=1;index<steps;index++){const centre=add(start,mul(u,runLength*index/steps));entities.push(line(add(centre,mul(v,half)),add(centre,mul(v,-half)),layer,'step'));}
 const arrowBase=add(start,mul(u,runLength*.72)),arrowTip=add(start,mul(u,runLength*.82));entities.push(line(arrowBase,arrowTip,layer,'up-arrow'));entities.push(line(arrowTip,add(arrowTip,add(mul(u,-textHeight),mul(v,textHeight*.5))),layer,'up-arrow'));entities.push(line(arrowTip,add(arrowTip,add(mul(u,-textHeight),mul(v,-textHeight*.5))),layer,'up-arrow'));
 entities.push({type:'text',layer,position:add(start,mul(u,runLength*.45)),height:textHeight,text:`에스컬레이터 ↑ H=${rise}`,align:'center',rotation:angle,role:'label'});return {type:'escalatorPlan',parameters:{start:clone(start),angle,length:runLength,width,rise,stepRun:runLength/steps,steps},entities};
}

const polygonArea=points=>Math.abs(points.reduce((sum,current,index)=>{const next=points[(index+1)%points.length];return sum+current.x*next.y-next.x*current.y;},0))/2;
const perimeter=points=>points.reduce((sum,current,index)=>sum+length(sub(points[(index+1)%points.length],current)),0);
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const crossing=(a,b,c,d)=>{const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);return ab1*ab2<-EPS&&cd1*cd2<-EPS;};
const simplePolygon=points=>{const count=points.length;for(let first=0;first<count;first++)for(let second=first+1;second<count;second++){if(second===first||second===(first+1)%count||first===(second+1)%count)continue;if(crossing(points[first],points[(first+1)%count],points[second],points[(second+1)%count]))return false;}return true;};
export function areaLedger(items,{pyeongFactor=3.305785}={}){
 if(!Array.isArray(items)||!items.length)throw Error('구적 대상이 없습니다.');pyeongFactor=positive(pyeongFactor,'평 환산계수');const details=items.map((item,index)=>{if(!Array.isArray(item.points)||item.points.length<3)throw Error((index+1)+'번째 경계의 점이 부족합니다.');if(item.points.some(value=>!Number.isFinite(value?.x)||!Number.isFinite(value?.y)))throw Error((index+1)+'번째 경계 좌표 오류');if(!simplePolygon(item.points))throw Error((index+1)+'번째 경계가 자기교차합니다.');const areaMm2=polygonArea(item.points);if(areaMm2<EPS)throw Error((index+1)+'번째 경계 면적이 0입니다.');const areaM2=areaMm2/1e6;return {id:item.id??String(index+1),floor:String(item.floor??''),use:String(item.use??item.name??'미지정'),name:String(item.name??item.use??'영역 '+(index+1)),areaMm2,areaM2,pyeong:areaM2/pyeongFactor,perimeterM:perimeter(item.points)/1000};}),groups=new Map();
 for(const detail of details){const key=detail.floor+'\u0000'+detail.use,current=groups.get(key)||{floor:detail.floor,use:detail.use,areaM2:0,pyeong:0,count:0};current.areaM2+=detail.areaM2;current.pyeong+=detail.pyeong;current.count++;groups.set(key,current);}
 const total=details.reduce((sum,item)=>sum+item.areaM2,0);return {details,groups:[...groups.values()].sort((a,b)=>a.floor.localeCompare(b.floor,'ko',{numeric:true})||a.use.localeCompare(b.use,'ko')),totalM2:total,totalPyeong:total/pyeongFactor,rows:[['층','용도/구분','명칭','면적 ㎡','평','둘레 m'],...details.map(item=>[item.floor,item.use,item.name,Number(item.areaM2.toFixed(3)),Number(item.pyeong.toFixed(3)),Number(item.perimeterM.toFixed(3))]),['','합계','',Number(total.toFixed(3)),Number((total/pyeongFactor).toFixed(3)),'']]};
}

export function beamRebarDetail({position=point(0,0),width=400,depth=600,cover=40,barDiameter=22,topBars=4,bottomBars=4,stirrupDiameter=10,stirrupSpacing=200,layer='default',textHeight=120,mark='B1'}={}){
 width=positive(width,'보 폭');depth=positive(depth,'보 깊이');cover=positive(cover,'피복');barDiameter=positive(barDiameter,'주근 지름');stirrupDiameter=positive(stirrupDiameter,'스터럽 지름');stirrupSpacing=positive(stirrupSpacing,'스터럽 간격');textHeight=positive(textHeight,'문자 높이');topBars=integer(topBars,'상부근 개수',2,50);bottomBars=integer(bottomBars,'하부근 개수',2,50);if(cover*2+barDiameter>=Math.min(width,depth))throw Error('피복과 철근 지름이 단면보다 큽니다.');
 const x=position.x,y=position.y,left=x-width/2,right=x+width/2,bottom=y-depth/2,top=y+depth/2,barRadius=barDiameter/2,barLeft=left+cover+stirrupDiameter+barRadius,barRight=right-cover-stirrupDiameter-barRadius,barTop=top-cover-stirrupDiameter-barRadius,barBottom=bottom+cover+stirrupDiameter+barRadius;
 const available=barRight-barLeft,minClear=Math.max(25,barDiameter);for(const [label,count] of [['상부근',topBars],['하부근',bottomBars]])if(available/(count-1)-barDiameter<minClear)throw Error(label+'이 단면 폭 안에 배치되지 않습니다. 철근 수나 지름을 줄이세요.');
 const bars=(count,yy,role)=>Array.from({length:count},(_,index)=>({type:'circle',layer,center:point(barLeft+(barRight-barLeft)*(count===1?.5:index/(count-1)),yy),radius:barRadius,role}));
 const entities=[polyline([point(left,bottom),point(right,bottom),point(right,top),point(left,top)],layer,'concrete',true),polyline([point(left+cover,bottom+cover),point(right-cover,bottom+cover),point(right-cover,top-cover),point(left+cover,top-cover)],layer,'stirrup',true),...bars(topBars,barTop,'top-bar'),...bars(bottomBars,barBottom,'bottom-bar'),{type:'text',layer,position:point(x,top+textHeight*1.4),height:textHeight,text:`${mark} ${width}×${depth}  상${topBars}-D${barDiameter} 하${bottomBars}-D${barDiameter}  D${stirrupDiameter}@${stirrupSpacing}`,align:'center',role:'label'}];
 return {type:'block',name:'보 배근 상세 '+mark,layer,entities,structural:{kind:'beam',mark,width,depth,cover,barDiameter,topBars,bottomBars,stirrupDiameter,stirrupSpacing,designChecked:false,note:'사용자 입력 작도. 구조 안전·정착·이음 자동 검토 아님'}};
}
