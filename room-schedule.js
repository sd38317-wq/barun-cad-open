import * as G from './geometry.js';
import {tableBlock} from './studio.js';

const area=ps=>Math.abs(G.polygonArea(ps));
const signed=ps=>ps.reduce((s,p,i)=>{const q=ps[(i+1)%ps.length];return s+p.x*q.y-q.x*p.y;},0)/2;
const key=p=>`${Math.round(p.x*1000)},${Math.round(p.y*1000)}`;
const edgeKey=(a,b)=>[key(a),key(b)].sort().join('|');
function canonical(ps){const ks=ps.map(key);return ks.map((_,i)=>ks.slice(i).concat(ks.slice(0,i)).join('|')).concat([...ks].reverse().map((_,i,a)=>a.slice(i).concat(a.slice(0,i)).join('|'))).sort()[0];}
const on=(p,a,b)=>G.distanceToSegment(p,a,b)<.001;
const contains=(ps,p)=>G.inside(p,ps)||ps.some((a,i)=>on(p,a,ps[(i+1)%ps.length]));
const strictInside=(ps,p)=>G.inside(p,ps)&&!ps.some((a,i)=>on(p,a,ps[(i+1)%ps.length]));
const samples=ps=>ps.flatMap((p,i)=>[p,{x:(p.x+ps[(i+1)%ps.length].x)/2,y:(p.y+ps[(i+1)%ps.length].y)/2}]);
function crossing(a,b,c,d){const u={x:b.x-a.x,y:b.y-a.y},v={x:d.x-c.x,y:d.y-c.y},den=u.x*v.y-u.y*v.x;if(Math.abs(den)<1e-9)return null;const w={x:c.x-a.x,y:c.y-a.y},t=(w.x*v.y-w.y*v.x)/den,s=(w.x*u.y-w.y*u.x)/den;return t>=0&&t<=1&&s>=0&&s<=1?{x:a.x+t*u.x,y:a.y+t*u.y}:null;}
export function contained(inner,outer){
 if(!inner.every(p=>contains(outer,p)))return false;
 return inner.every((a,i)=>{const b=inner[(i+1)%inner.length],cuts=[a,b];for(let j=0;j<outer.length;j++){const p=crossing(a,b,outer[j],outer[(j+1)%outer.length]);if(p)cuts.push(p);}cuts.sort((p,q)=>G.dist(a,p)-G.dist(a,q));return cuts.slice(1).every((p,j)=>contains(outer,{x:(p.x+cuts[j].x)/2,y:(p.y+cuts[j].y)/2}));});
}
function polygon(ps){let points=ps.map(p=>({...p}));if(points.length>1&&key(points[0])===key(points.at(-1)))points.pop();if(points.length<3||area(points)<.001)throw Error('면적이 없는 경계가 있습니다.');for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){if(j===i+1||(i===0&&j===points.length-1))continue;if(crossing(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length]))throw Error('자기 교차 경계를 먼저 정리하세요.');}return points;}

// Polygonize straight-line arrangements. Split intersections, deduplicate edges,
// then walk the left face of each directed edge. Open chains form no room.
export function lineRooms(entities){
 const lines=entities.flatMap(e=>e.type==='line'?[e.points.slice(0,2)]:e.type==='polyline'&&!e.closed?e.points.slice(1).map((p,i)=>[e.points[i],p]):[]);
 if(lines.length>1500)throw Error('경계선 1,500개 이하로 구역을 나누어 선택하세요.');
 const cuts=lines.map(([a,b])=>[a,b]);
 for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
  const [a,b]=lines[i],[c,d]=lines[j],p=crossing(a,b,c,d);if(p){cuts[i].push(p);cuts[j].push(p);}else {for(const p of [a,b])if(on(p,c,d))cuts[j].push(p);for(const p of [c,d])if(on(p,a,b))cuts[i].push(p);}
 }
 const nodes=new Map(),edges=new Set();
 for(let i=0;i<cuts.length;i++){const ps=[...new Map(cuts[i].map(p=>[key(p),p])).values()].sort((a,b)=>G.dist(lines[i][0],a)-G.dist(lines[i][0],b));for(let j=1;j<ps.length;j++){const a=ps[j-1],b=ps[j],ka=key(a),kb=key(b),ek=edgeKey(a,b);if(ka===kb||edges.has(ek))continue;edges.add(ek);for(const [k,p,n] of [[ka,a,kb],[kb,b,ka]]){if(!nodes.has(k))nodes.set(k,{p,adj:[]});nodes.get(k).adj.push(n);}}}
 for(const node of nodes.values())node.adj.sort((a,b)=>Math.atan2(nodes.get(a).p.y-node.p.y,nodes.get(a).p.x-node.p.x)-Math.atan2(nodes.get(b).p.y-node.p.y,nodes.get(b).p.x-node.p.x));
 const visited=new Set(),rooms=[];
 for(const [a,node] of nodes)for(const b of node.adj){const first=a+'>'+b;if(visited.has(first))continue;let u=a,v=b;const ps=[];for(let n=0;n<=edges.size*2;n++){const ek=u+'>'+v;if(visited.has(ek))break;visited.add(ek);ps.push(nodes.get(u).p);const next=nodes.get(v),idx=next.adj.indexOf(u),w=next.adj[(idx-1+next.adj.length)%next.adj.length];u=v;v=w;if(u===a&&v===b){if(signed(ps)>.001&&new Set(ps.map(key)).size===ps.length)rooms.push(polygon(ps));break;}}}
 return rooms;
}

export function buildRoomSchedule(doc,options={}){
 if(doc.units!=='mm')throw Error('실별 면적표는 mm 도면에서 실행하세요.');
 const {ids=[],floor='미지정',holeLayers=[],layer=doc.layers[0]?.id,height=250}=options;
 if(!Array.isArray(ids)||ids.some(id=>!doc.entities.some(e=>e.id===id)))throw Error('집계할 선택 객체를 찾을 수 없습니다.');
 if(typeof floor!=='string'||!floor.trim()||!Array.isArray(holeLayers)||holeLayers.some(n=>typeof n!=='string')||!Number.isFinite(height)||height<=0)throw Error('층·공제 레이어·문자 크기를 확인하세요.');
 const outputLayer=doc.layers.find(l=>l.id===layer||l.name===layer);if(!outputLayer||outputLayer.locked||!outputLayer.visible||outputLayer.frozen)throw Error('표를 넣을 레이어를 켜고 잠금을 해제하세요.');
 for(const name of holeLayers){const l=doc.layers.find(l=>l.id===name||l.name===name);if(!l||!l.visible||l.frozen)throw Error('공제 레이어 이름과 켜짐 상태를 확인하세요.');}
 const visible=e=>{const l=doc.layers.find(l=>l.id===e.layer);return l?.visible&&!l.frozen&&!e.hidden;};
 const all=doc.entities.filter(e=>visible(e)&&!e.roomSchedule&&!e.roomBoundary&&!e.table&&!e.sheetDecoration);
 const chosen=ids.length?all.filter(e=>ids.includes(e.id)):all;
 if(ids.length&&chosen.length!==ids.length)throw Error('숨긴 객체나 기존 표는 집계 선택에서 제외하세요.');
 const scope=ids.length&&chosen.every(e=>e.type==='text')?all:chosen;
 for(const name of holeLayers)if(!scope.some(e=>e.layer===name||doc.layers.find(l=>l.id===e.layer)?.name===name))throw Error('공제 레이어의 경계도 함께 선택하세요.');
 const isHole=e=>holeLayers.includes(e.layer)||holeLayers.includes(doc.layers.find(l=>l.id===e.layer)?.name);
 const unsupported=scope.filter(e=>['arc','circle','ellipse','wall','block'].includes(e.type));
 if(scope.some(e=>e.bulges?.some(Boolean)))throw Error('곡선 경계는 직선 폴리선으로 확인한 뒤 집계하세요.');
 const candidates=[],seen=new Set();
 const add=(points,e,loops=[])=>{const ps=polygon(points),k=canonical(ps);if(seen.has(k))return;seen.add(k);candidates.push({points:ps,loops:loops.map(polygon),sourceId:e?.id,room:e?.room,labels:[]});};
 for(const e of scope.filter(e=>!isHole(e)))if(e.type==='rectangle'||e.type==='hatch'||e.type==='polyline'&&e.closed){if(e.bulges?.some(Boolean))throw Error('곡선 경계는 직선 폴리선으로 확인한 뒤 집계하세요.');add(e.points,e,e.loops||[]);}
 for(const ps of lineRooms(scope.filter(e=>!isHole(e))))add(ps);
 const holes=scope.filter(isHole).map(e=>{if(!(e.type==='rectangle'||e.type==='polyline'&&e.closed))throw Error('공제 경계는 닫힌 직선 폴리선이어야 합니다.');return polygon(e.points);});
 for(const h of holes){const parents=candidates.filter(c=>contained(h,c.points));if(!parents.length)throw Error('공제 경계가 실 밖으로 나갑니다.');for(const c of parents)c.loops.push(h);}
 const issues=[];
 const labels=(ids.length&&chosen.every(e=>e.type==='text')?chosen:all.filter(e=>e.type==='text')).filter(e=>e.text?.trim()&&!e.text.includes('㎡'));
 for(const t of labels){const matches=candidates.filter(c=>contains(c.points,t.position)&&!c.loops.some(h=>contains(h,t.position))).sort((a,b)=>area(a.points)-area(b.points));if(matches.length){const c=matches[0];if(c.points.some((p,i)=>on(t.position,p,c.points[(i+1)%c.points.length]))){issues.push(`${t.text}: 실명이 경계선 위에 있습니다.`);continue;}c.labels.push(t);}else if(ids.includes(t.id))issues.push(`${t.text}: 닫힌 경계를 찾지 못했습니다.`);}
 const rooms=[];
 for(const c of candidates){if(!c.room&&!c.labels.length)continue;if(c.labels.length>1&&!c.room){issues.push(`${c.labels.map(t=>t.text).join(', ')}: 한 경계에 실명이 여러 개입니다.`);continue;}
  const holes=[...new Map(c.loops.map(h=>[canonical(h),h])).values()];
  for(let i=0;i<holes.length;i++){if(!contained(holes[i],c.points))throw Error('공제 경계가 실 밖으로 나갑니다.');for(let j=i+1;j<holes.length;j++)if(overlap(holes[i],holes[j]))throw Error('공제 경계끼리 겹칩니다.');}
  const a=area(c.points)-holes.reduce((s,h)=>s+area(h),0);if(a<=0)throw Error('공제 후 면적이 0 이하입니다.');
  rooms.push({name:c.room?.name||c.labels[0].text.trim(),floor:c.room?.floor||floor,areaM2:a/1e6,sourceId:c.sourceId||null,labelId:c.labels[0]?.id||null,points:c.points,holes});
 }
 for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++)if(rooms[i].floor===rooms[j].floor&&overlap(rooms[i].points,rooms[j].points))throw Error('실 경계가 겹칩니다. 공제 구역 또는 집계 범위를 확인하세요.');
 if(unsupported.length)issues.push(`선택 범위에 곡선·벽·블록 ${unsupported.length}개가 있습니다. 집계할 닫힌 직선 경계만 선택하세요.`);
 if(issues.length)throw Error(issues.slice(0,6).join('\n'));
 if(!rooms.length)throw Error('실명 문자와 닫힌 경계를 함께 선택하세요. 선 도면은 틈 없이 연결되어야 합니다.');
 const grouped=new Map();for(const r of rooms){const k=JSON.stringify([r.floor,r.name]);if(!grouped.has(k))grouped.set(k,{floor:r.floor,name:r.name,count:0,area:0});const g=grouped.get(k);g.count++;g.area+=r.areaM2;}
 const groups=[...grouped.values()].sort((a,b)=>a.floor.localeCompare(b.floor,'ko',{numeric:true})||a.name.localeCompare(b.name,'ko',{numeric:true}));
 const round=a=>Math.round((a+Number.EPSILON*Math.max(1,Math.abs(a)))*1000)/1000,rows=[['층','실명','개소','면적 (㎡)','면적 (평)']];let total=0;
 for(const f of [...new Set(groups.map(g=>g.floor))]){let subtotal=0,count=0;for(const g of groups.filter(g=>g.floor===f)){rows.push([f,g.name,g.count,round(g.area),round(g.area*.3025)]);subtotal+=g.area;count+=g.count;}rows.push([f,'소계',count,round(subtotal),round(subtotal*.3025)]);total+=subtotal;}
 rows.push(['전체','합계',rooms.length,round(total),round(total*.3025)]);
 const b=G.bounds(rooms.map(r=>({type:'polyline',points:r.points}))),position=options.position||{x:b.maxX+height*8,y:b.maxY};if(!Number.isFinite(position.x)||!Number.isFinite(position.y))throw Error('표 위치가 올바르지 않습니다.');
 const widths=rows[0].map((_,i)=>Math.max(6,...rows.map(r=>[...String(r[i])].reduce((s,ch)=>s+(/[^\x00-\x7f]/.test(ch)?1:.65),0)))*height+height*2);
 const entity=tableBlock(rows,{...position,height,widths,layer:outputLayer.id,name:'실별 면적표'});
 const sourceIds=scope.map(e=>e.id);
 entity.roomSchedule={version:1,sourceIds,rooms,options:{floor,holeLayers,height,position},rounding:'원시 면적 합산 후 소수 셋째 자리 표시',
  fingerprint:roomScheduleFingerprint(sourceIds,new Map(doc.entities.map(e=>[e.id,e])),doc.layers)};
 return {entity,rooms,totalM2:total,summary:`${rooms.length}개 실 · ${round(total)}㎡ 면적표를 만들었습니다.`};
}
export function overlap(a,b){if(samples(a).some(p=>strictInside(b,p))||samples(b).some(p=>strictInside(a,p)))return true;for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){const p=crossing(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]);if(p&&![a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]].some(q=>G.dist(p,q)<.001))return true;}return canonical(a)===canonical(b);}

// ── 살아 있는 실별 면적표 ──
// 표가 만들어질 때의 범위(sourceIds)에서 경계·실명·레이어 표시가 바뀌면 다시 계산한다. 엔진 동기화 때 불리므로
// 바뀌지 않았으면 지문 비교만 하고 끝낸다. 지문은 점·문자·실 속성·숨김·레이어 켜짐을 묶은 32비트 FNV-1a.
export function roomScheduleFingerprint(sourceIds,byId,layers=[]){
 const shownLayer=new Map(layers.map(l=>[l.id,l.visible!==false&&!l.frozen]));let h=0x811c9dc5;
 const mix=text=>{for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}};
 for(const id of sourceIds||[]){const e=byId.get(id);mix(id);if(!e){mix('~');continue;}
  mix((e.hidden?'h':'')+(shownLayer.get(e.layer)===false?'o':'')+e.type+(e.closed?'c':''));mix(JSON.stringify(e.points||e.position||null));if(e.text)mix(e.text);if(e.room)mix(JSON.stringify(e.room));}
 return (h>>>0).toString(16);
}
/** 바뀌었으면 새 표 엔티티(같은 id), 그대로면 null. 다시 만들 수 없으면 기존 값을 두고 stale 에 이유를 적는다. */
export function refreshRoomSchedule(doc,table,byId=new Map(doc.entities.map(e=>[e.id,e]))){
 const meta=table.roomSchedule;if(!Array.isArray(meta?.sourceIds))return null;
 const fingerprint=roomScheduleFingerprint(meta.sourceIds,byId,doc.layers);
 if(meta.fingerprint===fingerprint)return null;
 // 예전 판에서 만든 표는 지문이 없다. 처음에는 지문만 남기고 다음 변경부터 갱신한다(열자마자 표가 바뀌지 않게).
 if(meta.fingerprint===undefined)return {...table,roomSchedule:{...meta,fingerprint}};
 const shown=id=>{const e=byId.get(id),l=e&&doc.layers.find(x=>x.id===e.layer);return e&&!e.hidden&&l?.visible!==false&&!l?.frozen;};
 const b=G.bounds(table.entities||[]),options=meta.options||{};
 try{
  const {entity}=buildRoomSchedule(doc,{ids:meta.sourceIds.filter(shown),floor:options.floor||'미지정',holeLayers:options.holeLayers||[],layer:table.layer,
   height:options.height||table.table?.height||250,position:options.position||(b?{x:b.minX,y:b.maxY}:undefined)});
  return {...entity,id:table.id,roomSchedule:{...entity.roomSchedule,sourceIds:meta.sourceIds,fingerprint}};
 }catch(error){return {...table,roomSchedule:{...meta,fingerprint,stale:String(error?.message||error).slice(0,200)}};}
}
