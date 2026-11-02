// 요청할 때만 실행되는 편의시설 계획도. 그리기·선택·편집 루프에는 연결하지 않는다.
import {bounds} from './geometry.js';
import {autoSelect,placeReferences} from './drawing-details/registry.js';
import {reviewAccessPlan,normalizeAccessElements} from './access-plan-rules.js';
import {accessMarkEntities} from './access-plan-mark.js';
import {buildPPB} from './symbol-tools.js';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const point=p=>Array.isArray(p)?p.slice(0,2):p&&finite(p.x)&&finite(p.y)?[p.x,p.y]:null;
const overlap=(a,b,gap=0)=>a.minX<b.maxX+gap&&a.maxX+gap>b.minX&&a.minY<b.maxY+gap&&a.maxY+gap>b.minY;
export function accessElementPosition(element,model) {
  const e={...element,...element.props},host=model.elements?.find(h=>h.id===e.host);
  if(host?.path?.length===2&&finite(e.offset)&&finite(e.width)){
    const [a,b]=host.path,d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(d>0)return [a[0]+(b[0]-a[0])*(e.offset+e.width/2)/d,a[1]+(b[1]-a[1])*(e.offset+e.width/2)/d];
  }
  const p=point(e.at||e.position);if(p)return p;
  const pts=(e.path||e.outline||[]).map(point).filter(Boolean);
  return pts.length?[(Math.min(...pts.map(p=>p[0]))+Math.max(...pts.map(p=>p[0])))/2,(Math.min(...pts.map(p=>p[1]))+Math.max(...pts.map(p=>p[1])))/2]:null;
}
export function recognizeAccessModel(doc) {
  if(doc.units&&doc.units!=='mm')throw Error('편의시설 계획도는 mm 도면에서 실행하세요.');
  const names=new Map(doc.layers.map(l=>[l.id,l.name])),elements=[],seen=new Set();
  const patterns=[['public_phone',/공중전화|PUBLIC.*PHONE/i],['mailbox',/우체통|MAILBOX/i],['accessible_wc',/장애인.*(화장실|대변|WC)|ACCESS.*WC|ACCS.*WC/i],['urinal',/소변기|URINAL/i],['basin',/세면대|WASHBASIN|LAVATORY/i],['elevator',/승강기|ELEV|A-ELE/i],['ramp',/경사로|RAMP/i],['stair',/계단|STAIR|A-STAIR/i],['accessible_parking',/장애인.*주차|ACCESS.*PARK/i],['tactile',/점자블|TACTILE/i],['entrance',/주출입|MAIN.*ENTR/i],['door',/A-DOOR|문짝|DOOR|^DOR$/i],['corridor',/복도|CORRIDOR/i],['approach',/접근로|APPROACH/i],['counter',/접수대|COUNTER/i]];
  for(const entity of doc.entities){
    if(entity.drawingSet?.id&&doc.drawingSets?.[entity.drawingSet.id]?.kind==='access-plan')continue;
    const explicit=entity.accessFacility;
    const label=[names.get(entity.layer)||'',entity.type==='block'?entity.name:'',entity.type==='text'?entity.text:''].join(' ');
    if(entity.type==='text'&&!/^(장애인\s*(화장실|대변기|주차)|승강기|ELEV\.?|주출입구|접수대|복도|경사로|계단|공중전화|우체통|WC)$/i.test(String(entity.text).trim()))continue;
    const kind=explicit?.kind||patterns.find(([,re])=>re.test(label))?.[0];if(!kind)continue;
    // 닫힌 폴리선/블록/공간 문자만 위치 후보. 문 레이어의 낱개 선·호를 각각 문으로 세지 않는다.
    if(!explicit&&!['block','text'].includes(entity.type)&&!(entity.type==='polyline'&&entity.closed))continue;
    const b=bounds([entity]),p=point(entity.position||entity.center)||b&&[(b.minX+b.maxX)/2,(b.minY+b.maxY)/2];if(!p)continue;
    const key=kind+'|'+Math.round(p[0])+'|'+Math.round(p[1]);if(seen.has(key))continue;seen.add(key);
    // 계단·공간은 도면 생성기가 윤곽(outline)을 요구한다. 없으면 '요소 recognize-….outline 윤곽이 필요합니다'로 계획도 전체가 멈췄다(10/16 기록).
    const half=500,box=b&&b.maxX>b.minX&&b.maxY>b.minY?b:{minX:p[0]-half,minY:p[1]-half,maxX:p[0]+half,maxY:p[1]+half};
    const outline=['stair','space'].includes(kind)&&!explicit?.outline?{outline:[[box.minX,box.minY],[box.maxX,box.minY],[box.maxX,box.maxY],[box.minX,box.maxY]]}:{};
    elements.push({id:'recognize-'+entity.id,kind,story:'current',position:p,...outline,recognized:!explicit,accessible:explicit?.accessible,installed:explicit?.installed,location:'시설 후보 '+(elements.length+1),...explicit,sourceEntity:entity.id});
  }
  return {stories:[{id:'current',name:'현재 도면',elevation:0,height:3000}],elements,accessibility:{complete:false},source:{kind:'drawing-recognition'}};
}
const measure=(value,check)=>{
  if(value==null)return '?';
  if(check.field==='slope'&&finite(value)&&value>0){const inverse=1/value,integer=Math.round(inverse);return Math.abs(inverse-integer)<1e-6?'1/'+integer:(value*100).toFixed(2)+'%';}
  return String(value);
};
const wrap=(text,width,height)=>{
  const max=Math.max(4,Math.floor(width/(height*1.1))),out=[];for(const line of String(text??'').split('\n')){if(!line)out.push('');for(let i=0;i<line.length;i+=max)out.push(line.slice(i,i+max));}return out.length?out:[''];
};
export function accessReviewTable(rows,{height=120}={}) {
  const headers=['번호','항목','의무/권장','설치 여부','위치','규격(실측/기준)','적합 여부','근거 조문','고칠 방법'],widths=[height*4,height*15,height*8,height*8,height*14,height*25,height*12,height*28,height*25];
  const label={mandatory:'의무',recommended:'권장','not-required':'해당 없음',unknown:'검토필요'};
  const values=rows.map((r,i)=>[String(i+1),r.name,label[r.requirement]+(r.conditionPending?'(조건확인)':''),r.installed===true?'설치 확인':r.installed===false?'미설치':'미확인',r.location,
    [...r.checks.reduce((groups,c)=>{const text=c.name+': '+measure(c.value,c)+' / '+c.op+' '+measure(c.limit,c)+(c.field==='slope'?'':c.unit||'');groups.set(text,(groups.get(text)||0)+1);return groups;},new Map())].map(([text,count])=>text+(count>1?' ('+count+'곳)':'')).join('\n')||'상세 및 현장 확인',r.status,[...new Set([...r.basis,...r.checks.map(c=>c.basis)])].join('; '),[r.conditionNote,r.remedy].filter(Boolean).join('; ')]);
  const all=[headers,...values].map((cells,i)=>{const lines=cells.map((s,k)=>wrap(s,widths[k]-height*2,height));return {lines,height:Math.max(...lines.map(l=>l.length))*height*1.5+height*2,row:i?rows[i-1]:null};});
  return {widths,rows:all,width:widths.reduce((a,b)=>a+b,0),height:all.reduce((a,b)=>a+b.height,0)};
}
export function placeAccessLabels(anchors,occupied,{radius=240,gap=120}={}) {
  const boxes=[...occupied],placed=[];
  for(const a of anchors){let found=null;
    for(let ring=0;ring<200&&!found;ring++)for(const [dx,dy] of [[0,1],[1,0],[0,-1],[-1,0],[1,1],[-1,1],[-1,-1],[1,-1]]){
      const p=[a.at[0]+dx*ring*(radius*2+gap),a.at[1]+dy*ring*(radius*2+gap)],b={minX:p[0]-radius,minY:p[1]-radius,maxX:p[0]+radius,maxY:p[1]+radius};
      if(!boxes.some(o=>overlap(b,o,gap))){found={...a,position:p,box:b};boxes.push(b);break;}
    }
    if(!found)throw Error('편의시설 기호를 놓을 빈 공간이 없습니다.');placed.push(found);
  }return placed;
}
export function placeAccessNote(text,at,occupied,{height=120,gap=120}={}) {
  const width=Math.max(height,String(text).length*height*1.2),extent=height*1.5;
  for(let ring=0;ring<200;ring++)for(const [dx,dy] of [[0,1],[1,0],[0,-1],[-1,0],[1,1],[-1,1],[-1,-1],[1,-1]]){
    const p=[at[0]+dx*ring*(width+gap),at[1]+dy*ring*(extent+gap)],box={minX:p[0],maxX:p[0]+width,minY:p[1]-height*.3,maxY:p[1]+extent};
    if(!occupied.some(b=>overlap(box,b,gap))){occupied.push(box);return {text,position:p,box};}
  }
  throw Error('주기를 놓을 빈 공간이 없습니다.');
}
// 검증된 접근로/복도 중심선만 사용. 미지의 공간을 직선으로 가로질러 접근로라고 그리지 않는다.
export function accessRoutes(model) {
  const explicit=model.accessibility?.routes||[];
  const routes=[...explicit,...(model.elements||[]).filter(e=>['approach','corridor'].includes(e.kind)&&e.accessible===true&&e.path?.length>1).map(e=>({id:e.id,path:e.path,verified:e.routeVerified===true,width:e.width}))]
    .map(r=>({...r,path:(r.path||[]).map(point)})).filter(r=>r.path.length>1&&r.path.every(p=>p&&p.every(finite)));
  const walls=(model.elements||[]).filter(e=>e.kind==='wall'&&e.path?.length===2);
  const cross=(a,b,c,d)=>{const u=[b[0]-a[0],b[1]-a[1]],v=[d[0]-c[0],d[1]-c[1]],den=u[0]*v[1]-u[1]*v[0];if(Math.abs(den)<1e-9)return null;const w=[c[0]-a[0],c[1]-a[1]],t=(w[0]*v[1]-w[1]*v[0])/den,q=(w[0]*u[1]-w[1]*u[0])/den;return t>=0&&t<=1&&q>=0&&q<=1?q:null;};
  return routes.map(r=>{
    const blocked=[];
    for(let i=1;i<r.path.length;i++)for(const wall of walls){
      const [a,b]=wall.path,q=cross(r.path[i-1],r.path[i],a,b);if(q===null)continue;
      const offset=q*Math.hypot(b[0]-a[0],b[1]-a[1]);
      const opening=(model.elements||[]).some(e=>e.kind==='door'&&e.host===wall.id&&finite(e.offset)&&finite(e.width)&&offset>=e.offset&&offset<=e.offset+e.width);
      if(!opening)blocked.push(wall.id);
    }
    const problems=[...new Set(blocked)];return {...r,verified:r.verified===true&&finite(r.width)&&r.width>0&&!problems.length,blocked:problems};
  });
}
export async function drawAccessPlan(pen,{model,facility,standard,details,story,origin={x:0,y:0}},sourceDoc) {
  const knowledge=details?.access;if(!knowledge?.planRules)throw Error('한국 편의시설 계획도 기준을 열 수 없습니다.');
  if(!facility)throw Error('용도·면적·신축/용도변경·기준일을 입력하세요.');
  if(sourceDoc.units&&sourceDoc.units!=='mm')throw Error('mm 도면에서 계획도를 생성하세요.');
  if(![origin.x,origin.y].every(finite))throw Error('계획도 원점이 잘못되었습니다.');
  if(!sourceDoc.entities.length&&!model.elements?.some(e=>e.kind==='wall'))throw Error('계획도를 표기할 평면을 열거나 벽이 있는 설계 JSON을 주세요.');
  const selectedStory=story||model.stories?.[0]?.id;
  if(story&&!model.stories?.some(s=>s.id===story))throw Error('계획도 대상 층이 없습니다: '+story);
  const byId=new Map((model.elements||[]).map(e=>[e.id,e]));
  const local={...model,drawingDate:facility.date,elements:normalizeAccessElements(model).filter(e=>!selectedStory||!e.story&&!e.host||(e.story||byId.get(e.host)?.story)===selectedStory)};
  const review=reviewAccessPlan(local,facility,knowledge), layer=standard.accessPlan?.layer;
  if(!layer?.startsWith('A-'))throw Error('A- 편의시설 표기 레이어 기준이 필요합니다.');
  const h=standard.accessPlan.textHeight||120,g=pen.at(origin.x,origin.y),P=p=>[p[0]+origin.x,p[1]+origin.y];
  const sourceBox=bounds(sourceDoc.entities),modelPoints=local.elements.map(e=>accessElementPosition(e,local)).filter(Boolean);
  const floorBox=sourceBox||{minX:Math.min(0,...modelPoints.map(p=>p[0]))+origin.x,maxX:Math.max(0,...modelPoints.map(p=>p[0]))+origin.x,minY:Math.min(0,...modelPoints.map(p=>p[1]))+origin.y,maxY:Math.max(0,...modelPoints.map(p=>p[1]))+origin.y};
  const occupied=sourceDoc.entities.filter(e=>e.type==='text'||e.type==='dimension').map(e=>bounds([e])).filter(Boolean);
  const anchors=review.rows.flatMap((r,i)=>r.targets.map(id=>{const e=local.elements.find(e=>e.id===id),at=e&&accessElementPosition(e,local);return at?{at:P(at),row:i+1,element:e,code:r.code,violation:r.violation}:null;}).filter(Boolean));
  if(anchors.length>2000)throw Error('인식 후보가 2,000개를 넘습니다. 대상 평면만 선택하거나 설계 JSON으로 실행하세요.');
  const beforeDimensions=new Set(pen.engine.doc.entities.map(e=>e.id));
  for(const a of anchors){
    const e={...a.element,...a.element.props},at=accessElementPosition(e,local);
    if(e.kind==='door'&&finite(e.clearWidth)){
      const host=local.elements.find(w=>w.id===e.host),hostPath=host?.path;
      const angle=hostPath?.length===2?Math.atan2(hostPath[1][1]-hostPath[0][1],hostPath[1][0]-hostPath[0][0]):(e.rotation||0)*Math.PI/180;
      const endpoints=e.clearPoints?.map(point),u=[Math.cos(angle),Math.sin(angle)];
      const ds=endpoints?.length===2?endpoints:[at.map((v,i)=>v-u[i]*e.clearWidth/2),at.map((v,i)=>v+u[i]*e.clearWidth/2)];
      // DQ 축 정렬 치수: 사선 문은 실측 주기로 남겨 투영 폭을 유효폭으로 표시하지 않는다.
      if(Math.abs(ds[0][0]-ds[1][0])<1e-5||Math.abs(ds[0][1]-ds[1][1])<1e-5){const vertical=Math.abs(ds[0][0]-ds[1][0])<1e-5;await g.dim(ds[0],ds[1],vertical?[ds[0][0]-h*5,0]:[0,ds[0][1]-h*5],vertical?'vertical':'horizontal',standard.annotation.dimensionLayer,h);}
    }
  }
  occupied.push(...pen.engine.doc.entities.filter(e=>!beforeDimensions.has(e.id)).map(e=>bounds([e])).filter(Boolean));
  const labels=placeAccessLabels(anchors,occupied,{radius:h*2,gap:h});
  const noteOccupied=[...occupied,...labels.map(a=>a.box)],notes=[];
  // Reuse command geometry directly; used records the drawing operations without repeated command snapshots.
  const note=async(text,at,color)=>{const placed=placeAccessNote(text,at,noteOccupied,{height:h,gap:h});notes.push(placed);if(!pen.used.includes('ACCNOTE'))pen.used.push('ACCNOTE'); for(const entity of [{type:'text',position:{x:placed.position[0],y:placed.position[1]},text:String(text),height:h,color,layer:pen.layer(layer)}])pen.add(entity);};
  for(const a of labels){
    if(!pen.used.includes('ACCMARK'))pen.used.push('ACCMARK'); for(const entity of accessMarkEntities(a.position,{number:String(a.row),code:a.code,size:h*2,color:a.violation?standard.accessPlan.errorColor:standard.accessPlan.color}))pen.add({...entity,layer:pen.layer(layer)});
    if(a.position.some((v,i)=>v!==a.at[i]))g.line([a.at[0]-origin.x,a.at[1]-origin.y],[a.position[0]-origin.x,a.position[1]-origin.y],layer);
    const e={...a.element,...a.element.props},at=accessElementPosition(e,local);
    if(e.kind==='door'&&finite(e.clearWidth)){
      const host=local.elements.find(w=>w.id===e.host),hostPath=host?.path;
      const angle=hostPath?.length===2?Math.atan2(hostPath[1][1]-hostPath[0][1],hostPath[1][0]-hostPath[0][0]):(e.rotation||0)*Math.PI/180;
      const endpoints=e.clearPoints?.map(point),u=[Math.cos(angle),Math.sin(angle)];
      const ds=endpoints?.length===2?endpoints:[at.map((v,i)=>v-u[i]*e.clearWidth/2),at.map((v,i)=>v+u[i]*e.clearWidth/2)];
      // DQ 축 정렬 치수: 사선 문은 실측 주기로 남겨 투영 폭을 유효폭으로 표시하지 않는다.
      if(!(Math.abs(ds[0][0]-ds[1][0])<1e-5||Math.abs(ds[0][1]-ds[1][1])<1e-5)) await note('문 통과유효폭 '+e.clearWidth+'mm',[a.position[0]+h*3,a.position[1]],a.violation?standard.accessPlan.errorColor:standard.accessPlan.color);
    }
    if(e.kind==='ramp'&&(finite(e.slope)||finite(e.run)&&e.run>0&&finite(e.rise))){await note('경사 '+(Math.abs(finite(e.slope)?e.slope:e.rise/e.run)*100).toFixed(2)+'%',[a.position[0]+h*3,a.position[1]],a.violation?standard.accessPlan.errorColor:standard.accessPlan.color);}
    if(e.kind==='accessible_wc'){
      const law=knowledge.laws.find(l=>l.id==='A_WC_NEW');
      if(law&&law.effective<=facility.date){if(!pen.used.includes('ACCTURN'))pen.used.push('ACCTURN'); const center=P(point(e.turnAt)||at); const width=law.values.turnWidth,depth=law.values.turnDepth; pen.add({type:'circle',center:{x:center[0],y:center[1]},radius:Math.min(width,depth)/2,layer:pen.layer(layer),linetype:'DASHED'}); pen.add({type:'polyline',points:[[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]].map(([x,y])=>({x:center[0]+x,y:center[1]+y})),closed:true,layer:pen.layer(layer),linetype:'DASHED'});}
    }
  }
  const routes=accessRoutes(local);
  for(const r of routes){
    const color=r.verified?standard.accessPlan.color:standard.accessPlan.errorColor;
    if(!pen.used.includes('ACCROUTE'))pen.used.push('ACCROUTE'); pen.add({type:'polyline',points:r.path.map(p=>{const q=P(p);return {x:q[0],y:q[1]};}),closed:false,layer:pen.layer(layer),color,linetype:'DASHED'});
    const a=r.path[0],b=r.path[1],at=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    await note((finite(r.width)?'경로 유효폭 '+r.width+'mm':'경로 유효폭 미확인')+(r.blocked.length?' · 벽 교차: 통로 재설정':''),P([at[0]+h*3,at[1]+h*3]),color);
  }
  const sx=Math.max(floorBox.maxX,...noteOccupied.map(b=>b.maxX))-origin.x+(standard.accessPlan.gap||2000),top=floorBox.maxY-origin.y;
  let y=top;
  g.text([sx,y],'장애인시설 계획도 · '+review.decision.name,h*2,layer);y-=h*4;
  for(const t of [facility.work==='new'?'신축':'용도변경',String(facility.areaM2)+'㎡ · 기준일 '+facility.date,review.decision.status,...(review.decision.scopeReview||[]),'범례: 원 안 번호 = 검토표 행 / 영문 = 시설 종류','실측 미확인은 적합 판정하지 않음 · 권장 미달은 의무 위반과 구분','화장실 원은 보조표시; 법정 활동공간은 사각 경계 확인',routes.length?'접근 경로: 파랑=확인 / 빨강=경로·폭 현장 확인':'접근 경로 미확인: 접근로/복도 중심선 또는 routes 입력 필요']){g.text([sx,y],t,h,layer);y-=h*2;}
  const referenceTargets=new Set(review.rows.filter(r=>['mandatory','recommended'].includes(r.requirement)).flatMap(r=>r.targets));
  const referenceModel={...local,accessibility:{...local.accessibility,required:review.decision.applies===true},elements:local.elements.map(e=>referenceTargets.has(e.id)&&e.accessible==null?{...e,accessible:true}:e)};
  const numbered=autoSelect(referenceModel,{group:'access',details:{access:knowledge},date:facility.date,sheetRef:standard.details?.sheetRef||'A-501'}),refs=placeReferences(referenceModel,numbered);
  // 자동 상세 번호와 동일한 번호를 별도 열로 기록한다. 현장 위치 기호와 상세 번호는 서로 구별한다.
  const detailReferences=[];
  if(refs.length){g.text([sx,y],'참고 상세 번호: 미확인 후보는 설치 제안 참조',h,layer);y-=h*2;}
  for(const ref of refs){const p=ref.at.slice(0,2);const corners=[P([sx-h*10,y-h]),P([sx-h*9,y])].map(p=>({x:p[0],y:p[1]}));for(const entity of buildPPB(...corners,String(ref.number),ref.sheetRef,h*3,h))pen.add({...entity,layer:pen.layer(entity.type==='text'?'A-TEXT':'A-SYM')});if(!pen.used.includes('PPB'))pen.used.push('PPB');g.line(p,[sx-h*10,y-h],layer);const target=local.elements.find(e=>e.id===ref.elementId);g.text([sx,y],ref.detail+' · '+(target?.location||target?.name||ref.elementId),h,layer);detailReferences.push(ref);y-=h*3;}
  for(const row of review.rows){g.text([sx,y],row.code+' '+row.name,h,layer);y-=h*2;}
  y-=h*2;const table=accessReviewTable(review.rows,{height:h});let yy=y;
  const xs=[sx];table.widths.forEach(w=>xs.push(xs.at(-1)+w));
  for(const tr of table.rows){tr.lines.forEach((lines,k)=>lines.forEach((t,n)=>g.text([xs[k]+h,yy-h*2-n*h*1.5],t,h,layer,tr.row?.violation?{color:standard.accessPlan.errorColor}:{})));g.line([sx,yy],[xs.at(-1),yy],layer);yy-=tr.height;}
  g.line([sx,yy],[xs.at(-1),yy],layer);for(const x of xs)g.line([x,y],[x,yy],layer);
  return {review,plan:{kind:'access-plan',decision:review.decision,rows:review.rows,labels,notes,routeCount:routes.length,routes,detailReferences,tableBox:{minX:sx+origin.x,maxX:xs.at(-1)+origin.x,minY:yy+origin.y,maxY:y+origin.y}},sheets:1};
}
