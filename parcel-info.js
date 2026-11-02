import {tableBlock} from './studio.js';
import * as G from './geometry.js';
import {reviewValue,formatReviewValue} from './review-model.js';
const unknownValue=v=>v&&typeof v==='object'&&Object.hasOwn(v,'value')?formatReviewValue(v):(v==null||v===''?'—':String(v));
const siteRows=(info={})=>{const c=info.siteContext||{},a=c.areas||{},d=c.deductions||{},rv=v=>unknownValue(v??reviewValue());return [['address','주소',unknownValue(info.address)],['pnu','PNU',unknownValue(info.pnu)],['recordAreaM2','공부면적',rv(a.recordAreaM2)],['polygonAreaM2','도형면적',rv(a.polygonAreaM2)],['effectiveAreaM2','산정면적',rv(a.effectiveAreaM2)],['roadWidthM','현황폭 (추정)',rv(c.road?.measuredWidthM)],['legalStatus','도로 법적 지위',({'unknown':'미확인','confirmed':'확인','not-road':'도로 아님'})[c.road?.legalStatus]||'—'],['confirmedWidthM','확인 도로폭',rv(c.road?.confirmedWidthM)],['roadDeductionM2','도로후퇴 공제',rv(d.roadSetbackM2)],['cornerDeductionM2','가각 공제',rv(d.cornerCutM2)],['zones','토지이용 지역·지구',(info.zones||[]).map(z=>`${z.name} [${z.relation||'—'}]`).join('\n')||'—'],['limits','조회 검토상한',`건폐율 ${info.limits?.bcr??'—'}% / 용적률 ${info.limits?.far??'—'}% (미확인)`],['warnings','확인사항',(info.warnings||[]).join('\n')||info.error||'—'],...(info.review?.report?.sections||[]).map((section,i)=>['report:'+i,section.title,(section.rows||[]).map(r=>`${r.label||''}: ${r.value?.v??'—'}`).concat(section.note?[section.note]:[]).join('\n')]),['massing','조회 최대 규모',`건축면적 ${info.massing?.maxBuildingAreaM2??'—'}㎡ / 연면적 ${info.massing?.maxFloorAreaM2??'—'}㎡ (미확인)`],['planChecks','배치 검토',(info.planChecks||[]).map(c=>`${c.rule}: ${c.value??'—'} / ${c.limit??'—'} (상세 확인)`).join('\n')||'—'],['suggestions','계획 조정 제안',(info.suggestions||[]).join('\n')||'—'],['scope','검토 범위',info.reviewScope||'개략 검토 · 상세 확인 필요'],['source','조회 출처',unknownValue(info.source)],['queriedAt','조회 시각',unknownValue(info.queriedAt)]];};
const wrapCell=(value,chars)=>String(value??'').split('\n').flatMap(line=>{const cs=Array.from(line);return cs.length?Array.from({length:Math.ceil(cs.length/chars)},(_,i)=>cs.slice(i*chars,(i+1)*chars).join('')):[''];});
export function wrappedTable(rows,{height=220,widths,rowHeight=480,...options}){
 const lines=rows.map(row=>row.map((v,i)=>wrapCell(v,Math.max(1,Math.floor((widths[i]-height)/height))))),heights=lines.map(row=>Math.max(rowHeight,...row.map(cell=>cell.length*height*1.5+height))),block=tableBlock(rows,{height,widths,rowHeight,...options}),offsets=[0];for(const h of heights)offsets.push(offsets.at(-1)+h);
 const yMap=y=>-offsets[Math.min(rows.length,Math.round(-y/rowHeight))];block.entities=block.entities.flatMap(e=>{if(e.type==='line')return [{...e,points:e.points.map(p=>({...p,y:yMap(p.y)}))}];const {row,column}=e.tableCell;return lines[row][column].map((text,i)=>({...e,text,siteWrappedLine:i>0,position:{x:e.position.x,y:-offsets[row]-height*1.3-i*height*1.5}}));});block.table.rowHeights=heights;return block;
}

/** 토지정보표 2단 접기(2026-10-28 시안 docs/시안-대지도면정리-2026-10-28): 표 높이가 FOLD_MIN 을 넘으면 몸통 가운데 줄에서 잘라 아래 반을 오른쪽 칸으로 올리고 머리 줄을 한 번 더 그린다.
    뒤에는 가리기(배경색, 테두리 없음)를 맨 앞에 깔아 주변 건물 선이 비치지 않게 한다. 다시 그릴 때 자리·방향은 가리기를 뺀 첫 두 선(위 테두리·머리 아래 선)에서 읽는다. */
const FOLD_MIN=20000,FOLD_GAP=1500,MASK_PAD=400;
function foldTable(block){
 const lines=block.entities.filter(e=>e.type==='line'),flat=e=>e.points[0].y===e.points[1].y,ys=[...new Set(lines.filter(flat).map(e=>e.points[0].y))].sort((a,b)=>b-a);
 const width=Math.max(...lines.map(e=>Math.max(e.points[0].x,e.points[1].x))),bottom=ys.at(-1),head=ys[1];
 const mask=(x0,y0,x1,y1)=>({type:'hatch',solid:true,wipeout:true,frame:0,points:[{x:x0-MASK_PAD,y:y0+MASK_PAD},{x:x1+MASK_PAD,y:y0+MASK_PAD},{x:x1+MASK_PAD,y:y1-MASK_PAD},{x:x0-MASK_PAD,y:y1-MASK_PAD}],spacing:100,angle:0,layer:block.layer});
 if(!(ys.length>3&&-bottom>FOLD_MIN)){block.entities.unshift(mask(0,0,width,bottom));return block;}
 const cut=ys.slice(2,-1).reduce((best,y)=>Math.abs(y-(head+bottom)/2)<Math.abs(best-(head+bottom)/2)?y:best),dx=width+FOLD_GAP,dy=head-cut;
 const at=(e,x,y)=>e.type==='line'?{...e,points:e.points.map(p=>({...p,x:p.x+x,y:p.y+y}))}:{...e,position:{...e.position,x:e.position.x+x,y:e.position.y+y}};
 const top=[],moved=[],header=[];
 for(const e of block.entities){
  if(e.type!=='line'){(e.position.y<cut?moved:top).push(e.position.y<cut?at(e,dx,dy):e);if(e.position.y>head)header.push({...at(e,dx,0),siteHeaderCopy:true});continue;}
  const [a,c]=e.points,hi=Math.max(a.y,c.y),lo=Math.min(a.y,c.y);
  if(flat(e)){if(lo>=cut)top.push(e);if(lo<cut)moved.push(at(e,dx,dy));if(lo>=head)header.push({...at(e,dx,0),siteHeaderCopy:true});continue;}
  const span=(y1,y2)=>({...e,points:[{...a,y:y1},{...c,y:y2}]});
  if(lo>=cut)top.push(e);else if(hi<=cut)moved.push(at(e,dx,dy));else{top.push(span(hi,cut));moved.push(at(span(cut,lo),dx,dy));}
  if(hi>head)header.push({...at(span(hi,Math.max(lo,head)),dx,0),siteHeaderCopy:true});
 }
 block.entities=[mask(0,0,width,cut),mask(dx,0,dx+width,bottom+dy),...top,...header,...moved];block.table.folded={cut,dx,dy};   // 가리기가 먼저 그려져야 표 선·글이 그 위에 보인다
 return block;
}
function managedTable(info,b,layer,existing,place=null){
 const notes=new Map(),keys=existing?.table?.rowKeys||[];for(const [i,row] of (existing?.table?.rows||[]).entries())notes.set(keys[i]||row[0],row[2]??'');
 for(const e of existing?.entities||[])if(e.type==='text'&&e.tableCell?.column===2&&e.tableCell.row>0&&!e.siteWrappedLine){const key=keys[e.tableCell.row],old=notes.get(key)??'',width=existing.table.widths?.[2]||3200,height=existing.table.height||220;if(e.text!==wrapCell(old,Math.max(1,Math.floor((width-height)/height)))[0])notes.set(key,e.text);}
 const values=siteRows(info),rows=[['항목','값','설계 메모'],...values.map(r=>[r[1],r[2],notes.get(r[0])??''])],widths=existing?.table?.widths||[3600,5200,3200],height=existing?.table?.height||220;
 const block=wrappedTable(rows,{height,widths,rowHeight:480,layer:existing?.layer||layer,name:'대지정보표'});block.table.rowKeys=['header',...values.map(r=>r[0])];block.siteInfoTableId=existing?.siteInfoTableId||'site-info:'+String(info.pnu);block.scheduleKind='site-info';block.siteInfoPnu=info.pnu;block.siteContext=structuredClone(info.siteContext||{});block.siteSourceContext=structuredClone(existing?.siteSourceContext||info.siteContext||{});foldTable(block);
 let transformed=block;const frame=(existing?.entities||[]).filter(e=>!e.wipeout),base=frame[0]?.points?.[0]||place||{x:(b?.maxX??0)+3000,y:b?.maxY??0};if(existing){const direction=frame[0]?.points?.[1]||G.add(base,{x:1,y:0}),next=frame[1]?.points?.[0]||G.add(base,{x:0,y:-1}),angle=G.angle(G.sub(direction,base)),reflected=G.cross(G.sub(direction,base),G.sub(next,base))>0;if(reflected)transformed=G.mirror(transformed,{x:0,y:0},{x:1,y:0});transformed=G.rotate(transformed,{x:0,y:0},angle);}transformed=G.translate(transformed,base.x,base.y);if(existing)transformed.id=existing.id;return transformed;
}
export function parcelInfoTable(info,b,layer,place=null){return [managedTable(info,b,layer,null,place)];}
export function updateParcelInfoTable(existing,info,b,layer){return managedTable(info,b,layer,existing);}
/** 검토서 줄 나누기(열 하나 = maxRows 줄). groups = [[제목, [줄…]]]. 주황(warn)은 '우선 확인사항' 묶음이거나 확인필요·위반·가정·산정 필요 글귀. */
export function sheetLines(groups,{warnTest=/확인필요|위반|산정 필요|\(가정\)/,chars=44}={}){
 const lines=[];
 for(const [title,rows] of groups){if(!rows.length)continue;lines.push({text:title,heading:true});for(const row of rows){const cs=Array.from(String(row));for(let i=0;i<cs.length;i+=chars)lines.push({text:cs.slice(i,i+chars).join(''),warn:title==='우선 확인사항'||warnTest.test(String(row))});}lines.push({text:''});}
 return lines;
}

/** 틀 있는 글 검토서 — 토지·법규 검토서 모양 그대로(제목 띠·청록 소제목·주황 확인필요·열 나란히). 아파트 검토서도 이걸 쓴다.
    opts.scale 로 큰 대지에 맞게 키운다(1 = 폭 12m). opts.origin {x,y} 를 주면 대지 오른쪽(b.maxX+3000) 대신 거기서 시작. 반환 배열에 columns 수를 붙인다. */
export function reviewSheet(title,groups,b,layer,opts={}){
 const s=opts.scale||1,result=[],height=220*s,rowH=380*s,width=12000*s,gap=700*s,pad=500*s,maxRows=opts.maxRows||39;
 const lines=sheetLines(groups,opts);
 const count=Math.max(1,Math.ceil(lines.length/maxRows));
 const line=(a,b,color)=>result.push({type:'line',points:[a,b],layer,...(color?{color}:{})});
 const ox=opts.origin?.x??(b.maxX+3000*s),top=opts.origin?.y??b.maxY;
 for(let col=0;col<count;col++){
  const x=ox+col*(width+gap),y0=top-1000*s;
  const chunk=lines.slice(col*maxRows,(col+1)*maxRows);const bottom=y0-maxRows*rowH-300*s;
  [[{x,y:top},{x:x+width,y:top}],[{x:x+width,y:top},{x:x+width,y:bottom}],[{x:x+width,y:bottom},{x,y:bottom}],[{x,y:bottom},{x,y:top}]].forEach(([a,b])=>line(a,b,'#7896a5'));
  result.push({type:'text',text:col===0?title:`검토 항목  ${col+1} / ${count}`,position:{x:x+pad,y:top-600*s},height:320*s,layer,color:'#82ded5'});
  line({x,y:top-850*s},{x:x+width,y:top-850*s},'#7896a5');
  chunk.forEach((row,i)=>{const y=y0-i*rowH-180*s;if(!row.text)return;result.push({type:'text',text:row.text,position:{x:x+pad,y},height:row.heading?250*s:height,layer,...(row.heading?{color:'#82ded5'}:row.warn?{color:'#ffb65c'}:{})});});
 }
 result.columns=count;result.width=count*(width+gap);result.bottom=top-1000*s-maxRows*rowH-300*s;
 return result;
}


export function planSuggestions(report){
 const checks=report?.checks||[],suggestions=[];
 for(const c of checks){
  if(c.ok&&!c.provisional)continue;
  if(/일조|정북/.test(c.rule))suggestions.push(c.ok?'일조 기준이 잠정입니다. 북측 인접 조건·적용 기준을 확인한 뒤 재검증하세요.':'일조 NG: 북측 이격·건물 높이·상부층 면적을 조정하는 안을 검토한 뒤 재검증하세요.');
  else if(!c.ok&&/주차|구획/.test(c.rule))suggestions.push('주차 NG: 진입 동선과 구획 배치를 조정하고 재검증하세요.');
  else if(!c.ok&&/건폐|용적|면적/.test(c.rule))suggestions.push('면적 기준 NG: 건축면적 또는 층별 면적을 줄이는 안을 검토하세요.');
 }
 return [...new Set(suggestions)];
}

export function parcelDaylightGuide(sites,layer,info){
 if(info.sunlightApplies===false)return [];
 const result=[];
 const north=sites[0]?.attributes?.northVector||[0,1],m=Math.hypot(...north)||1,n={x:north[0]/m,y:north[1]/m};
 for(const e of sites){
  if(e.attributes?.ring==='hole')continue;
  const ps=e.points,area=ps.reduce((sum,p,i)=>{const q=ps[(i+1)%ps.length];return sum+p.x*q.y-p.y*q.x;},0);
  for(let i=0;i<ps.length;i++){
   const a=ps[i],b=ps[(i+1)%ps.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(!length)continue;
   const nx=(area>0?dy:-dy)/length,ny=(area>0?-dx:dx)/length;if(nx*n.x+ny*n.y<.35)continue;
   result.push({type:'line',points:[{x:a.x+nx*400,y:a.y+ny*400},{x:b.x+nx*400,y:b.y+ny*400}],linetype:'DASHED'});
  }
 }
 const ps=sites.flatMap(e=>e.points),x=Math.min(...ps.map(p=>p.x))-1600,y=Math.max(...ps.map(p=>p.y));
 result.push({type:'line',points:[{x:x-n.x*2500,y:y-n.y*2500},{x,y}]},{type:'polyline',closed:false,points:[{x:x-n.x*600-n.y*350,y:y-n.y*600+n.x*350},{x,y},{x:x-n.x*600+n.y*350,y:y-n.y*600-n.x*350}]},
  {type:'text',text:'N · 정북 검토 방향',position:{x:x-400,y:y+600},height:230},
  {type:'text',text:'점선: 검토 방향 표시 / 법적 일조 제한선 아님',position:{x,y:y-3100},height:180});
 return result.map(e=>({...e,layer,color:'#73aebd',siteInfoPnu:info.pnu,daylightGuide:true}));
}
