import * as G from './geometry.js';

export const WALL_DETECT_COLORS=Object.freeze({wall:'#9bdec7',low:'#ffd479',unresolved:'#ff4545',column:'#91b4c9'});
export function wallDetectionSummary(result){
 const {walls,unresolved,columns}=result,average=walls.length?walls.reduce((sum,w)=>sum+w.thickness,0)/walls.length:0;
 return `벽 ${walls.length}개(평균 두께 ${average.toFixed(1)}mm), 확인 필요 ${walls.filter(w=>w.confidence<.6).length+unresolved.length}개, 기둥 ${columns.length}개`;
}

// 한 조각씩 준비한다. 미리보기 동안만 공간 인덱스를 두고 팬·줌은 보이는 후보만 그린다.
export async function wallDetectionPreview(result){
 const chunks=[];let entities=[];
 const flush=async()=>{
  if(!entities.length)return;
  const index=G.spatialIndex(entities);index.bounds=G.bounds(entities);
  // 도면 전체를 축소해서 봐도 벽마다 Canvas save/stroke 를 반복하지 않는다.
  if(typeof Path2D!=='undefined'){
   const groups=new Map();
   for(const e of entities){
    const key=e.color+(e.linetype||''),group=groups.get(key)||{color:e.color,dashed:!!e.linetype,stroke:new Path2D(),fill:new Path2D()};groups.set(key,group);
    const append=path=>{e.points.forEach((p,i)=>i?path.lineTo(p.x,p.y):path.moveTo(p.x,p.y));if(e.closed||e.solid)path.closePath();};
    append(group.stroke);if(e.solid)append(group.fill);
   }
   index.paths=[...groups.values()];
  }
  chunks.push(index);entities=[];await new Promise(resolve=>setTimeout(resolve,0));
 };
 for(const w of result.walls){
  const n=G.mul(G.normal(G.unit(G.sub(w.end,w.start))),w.thickness/2),color=w.confidence<.6?WALL_DETECT_COLORS.low:WALL_DETECT_COLORS.wall;
  entities.push({type:'hatch',solid:true,color,points:[G.add(w.start,n),G.add(w.end,n),G.sub(w.end,n),G.sub(w.start,n)]},{type:'line',color,points:[w.start,w.end]});
  if(entities.length>=4000)await flush();
 }
 for(const s of result.unresolved){entities.push({type:'line',points:[s.start,s.end],color:WALL_DETECT_COLORS.unresolved,linetype:'DASHED'});if(entities.length>=4000)await flush();}
 for(const c of result.columns){entities.push({type:'polyline',closed:true,points:c.points,color:WALL_DETECT_COLORS.column,linetype:'DASHED'});if(entities.length>=4000)await flush();}
 await flush();return chunks;
}

export function installWallDetect(ctx){
 return {WALLDETECT:async()=>{
  const source=ctx.doc(),selected=ctx.selected(),document=selected.length?{...source,entities:selected}:source;
  const result=ctx.detectWallDocument?await ctx.detectWallDocument(document):await import('./compute-client.js').then(m=>m.detectWalls(document));   // 화면 없는 실행: 바른 서버에서
  const check=()=>{if(ctx.doc()!==source)throw Error('도면이 변경되었습니다. 벽 찾기를 다시 실행하세요.');};
  const draw=()=>{
   check();if(!result.walls.length)return;
   const existing=ctx.layers().find(l=>l.name==='A-WALL-C');
   if(existing&&(existing.locked||existing.visible===false||existing.frozen))throw Error('A-WALL-C 레이어가 숨김/잠금 상태입니다.');
   const layer=existing?.id||crypto.randomUUID();
   const ids=ctx.execute({type:'batch',commands:[...(!existing?[{type:'layer.add',id:layer,name:'A-WALL-C',color:'#91b4c9',linetype:'CENTER'}]:[]),{type:'addMany',entities:result.walls.map(w=>({type:'line',layer,linetype:'CENTER',points:[w.start,w.end]}))}]});
   ctx.setSelected(ids);ctx.refresh();
  };
  const select=()=>{check();ctx.setSelected([...new Set([...result.walls,...result.unresolved,...result.columns].flatMap(w=>w.sourceIds))]);ctx.refresh();};
  const summary=wallDetectionSummary(result);
  if(ctx.wallDetectResult)await ctx.wallDetectResult(result,{summary,draw,select});
  else ctx.form('벽 찾기',[{name:'summary',label:'결과',value:summary,readonly:true},{name:'action',label:'결과 처리',value:'close',options:[['close','닫기'],['draw','벽 중심선 그리기'],['select','원본 선 선택']]}],v=>{if(v.action==='draw')draw();else if(v.action==='select')select();});
  return result;
 }};
}
