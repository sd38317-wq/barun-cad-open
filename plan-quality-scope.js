// 자동 배치 품질 검사가 보는 도면 범위: 배치 결과가 만든 객체·연결된 원본 경계·건물/주차/조경 경계 레이어만.
// 화면(plan-quality-client.js)은 이 범위만 서버로 보내고, 서버(compute/plan-quality.js)는 같은 함수로 같은 범위를 다시 고른다.
export const boundaryLayer=name=>/^A-(BLDG|PARK|LAND)(?:-|$)/.test(name||'');

/** current: 편집 중인 도면, result: 저장된 sitePlan. 고른 객체·쓰는 공유 블록·레이어만 담은 문서와 고르는 함수. */
export function qualityScope(current,result){
 const watched=new Set([...(result.bindings||[]),...(result.contextGeometry||[]),...(result.sourceParcelGeometry||[])].map(b=>b.entityId));
 const layers=new Map(current.layers.map(l=>[l.id,l.name]));
 const relevant=e=>!e.sunlightDrawing&&!e.buildingOverview&&(e.sitePlanId===result.id||watched.has(e.id)||(!e.sitePlanId&&boundaryLayer(layers.get(e.layer))));
 const doc={version:current.version,units:current.units,layers:current.layers,entities:current.entities.filter(relevant),blocks:[],sharedBlocks:{},sitePlan:result};
 const layerIds=new Set(),definitions=e=>{layerIds.add(e.layer);if(e.sharedBlock&&!Object.hasOwn(doc.sharedBlocks,e.sharedBlock)){const def=current.sharedBlocks?.[e.sharedBlock];if(def){doc.sharedBlocks[e.sharedBlock]=def;for(const child of def.entities||[])definitions(child);}}for(const child of e.entities||[])definitions(child);};
 for(const e of doc.entities)definitions(e);doc.layers=current.layers.filter(l=>layerIds.has(l.id)||boundaryLayer(l.name));
 return {doc,relevant};
}
