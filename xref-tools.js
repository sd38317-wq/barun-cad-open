// 617·618·224 외부참조 도우미.
// AutoCAD: 외부참조 레이어는 "파일명|레이어" 의존 레이어로 들어오고, 겹치기(Overlay)는 중첩에서 따라가지 않으며, 순환은 그래프로 막는다.
//   갱신은 XREFNOTIFY 로 파일 변경을 알리고, 정의 교체 한 번으로 모든 삽입본이 바뀐다.
// 우리: 같은 규칙에 더해
//   - 레이어를 하나로 뭉개지 않고 원본 레이어별 끄기·색을 지킨다(예전: 모든 객체를 현재 레이어 하나로).
//   - 큰 참조는 공유 정의(sharedBlocks)로 둔다: 되돌리기 기록 100단계에 도형이 복사되지 않고(문서 밖 불변 정의), 갱신은 정의 교체 한 번.
//   - 바뀜 비교는 문서 직렬화(JSON 두 번, 큰 도면에서 수 초) 대신 문서 객체·되돌리기 깊이 비교(즉시).
//   - 단위 없는 원본은 거부하지 않고 기본 원본 단위로 환산하면서 알려 준다.
// 순수 함수(파일 읽기·실행은 file-workflows.js).

export const xrefFileStem=name=>String(name||'참조').split(/[\\/]/).pop().replace(/\.(dwg|dxf|bcad)$/i,'');
export const xrefKey=ref=>'xref:'+(ref.relative?'rel:':'')+String(ref.folder||'').replace(/\\/g,'/').replace(/\/+$/,'')+'/'+String(ref.name||'');
export const xrefPath=ref=>(String(ref.folder||'').replace(/\\/g,'/').replace(/\/+$/,'')+'/'+String(ref.name||'')).toLowerCase();

/** 원본 레이어 → 이 도면의 의존 레이어("파일명|레이어", xref 표시). 이미 같은 이름이 있으면 그 레이어를 쓴다(갱신 때 끄기·색 유지). */
export function dependentLayers(sourceLayers,stem,targetLayers,newId=()=>crypto.randomUUID()){
  const byName=new Map((targetLayers||[]).map(layer=>[layer.name,layer])),map=new Map(),add=[];
  for(const layer of sourceLayers||[]){
    const name=`${stem}|${layer.name}`,existing=byName.get(name);
    if(existing){map.set(layer.id,existing.id);continue;}
    const created={id:newId(),name,color:/^#[0-9a-f]{6}$/i.test(layer.color||'')?layer.color:'#ffffff',visible:layer.visible!==false,locked:false,lineweight:Number.isFinite(layer.lineweight)?layer.lineweight:0.25,linetype:layer.linetype||'CONTINUOUS',xref:true};
    if(layer.frozen)created.frozen=true;
    byName.set(name,created);map.set(layer.id,created.id);add.push(created);
  }
  return {map,add};
}
export function relayer(entity,map,fallback){
  const copy={...entity,layer:map.get(entity.layer)??fallback};
  if(entity.entities)copy.entities=entity.entities.map(child=>relayer(child,map,fallback));
  return copy;
}
/** 읽은 도면 안의 외부참조: 겹치기(overlay)는 따라가지 않고, 이미 지나온 파일(순환)은 빼고 알린다. 연결(attach)은 그대로 담는다. */
export function nestedXrefFilter(entities,{path,stack=[]}={}){
  const visiting=new Set([...stack,path].filter(Boolean).map(p=>String(p).toLowerCase())),skipped=[],cycles=[];
  const kept=(entities||[]).filter(entity=>{
    if(!entity?.xref)return true;
    if(entity.xref.mode==='overlay'){skipped.push(entity.xref.name||entity.name);return false;}
    const nested=xrefPath(entity.xref);
    if(visiting.has(nested)){cycles.push([...stack,path,nested].filter(Boolean).join(' → '));return false;}
    return true;
  });
  return {entities:kept,skipped,cycles};
}
const nestedCount=entity=>1+(entity.entities||[]).reduce((n,child)=>n+nestedCount(child),0);
/** 저장 방식: auto 는 객체가 많으면(기본 2,000개) 공유 정의, 적으면 도면 안 사본. */
export function chooseXrefStorage(requested,entities,limit=2000){
  if(requested==='shared'||requested==='embedded')return requested;
  let total=0;for(const entity of entities||[]){total+=nestedCount(entity);if(total>limit)return 'shared';}
  return 'embedded';
}
/** 읽는 동안 도면이 바뀌었는지: 문서 객체와 되돌리기 깊이(편집마다 새 문서 객체). 직렬화 비교 없이 즉시. */
export const documentMark=engine=>({doc:engine.doc,depth:engine.undoStack?.length??0});
export const documentChanged=(engine,mark)=>engine.doc!==mark.doc||(engine.undoStack?.length??0)!==mark.depth;

/** 618 XREFNOTIFY: 파일 지문(크기·수정 시각)이 연결 때와 다른 참조. stat(ref) → {fingerprint} 또는 오류. */
export async function staleXrefs(refs,stat){
  const out=[];
  for(const ref of refs){
    try{const info=await stat(ref.xref);if(info?.fingerprint&&ref.xref.fingerprint&&info.fingerprint!==ref.xref.fingerprint)out.push({ref,fingerprint:info.fingerprint});}
    catch{out.push({ref,missing:true});}
  }
  return out;
}
/** 주기 감시(브라우저에서만 켠다). 같은 파일은 한 번만 알린다. 돌려준 함수로 멈춘다. */
export function watchXrefs(refs,stat,onStale,ms=30000,timers={setInterval:(f,t)=>setInterval(f,t),clearInterval:h=>clearInterval(h)}){   // 브라우저는 window 를 this 로 불러야 한다(Illegal invocation)
  const told=new Set();let running=false;
  const tick=async()=>{
    if(running)return;running=true;
    try{for(const item of await staleXrefs(refs(),stat)){const key=xrefPath(item.ref.xref)+'|'+(item.fingerprint||'missing');if(told.has(key))continue;told.add(key);onStale(item);}}
    finally{running=false;}
  };
  const handle=timers.setInterval(tick,ms);handle?.unref?.();
  return Object.assign(()=>timers.clearInterval(handle),{tick});
}
