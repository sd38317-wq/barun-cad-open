const PAPER={A1:{width:841,height:594},A3:{width:420,height:297},A4:{width:297,height:210}};
const clone=value=>structuredClone(value);
const validBounds=b=>b&&['minX','minY','maxX','maxY'].every(key=>Number.isFinite(Number(b[key])))&&Number(b.maxX)>Number(b.minX)&&Number(b.maxY)>Number(b.minY);
const bounds=b=>({minX:Number(b.minX),minY:Number(b.minY),maxX:Number(b.maxX),maxY:Number(b.maxY)});
const center=b=>({x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2});

export const emptyLayoutState=()=>({version:1,currentSpace:{kind:'model'},layouts:[]});

export function createLayout(state,{name,paper='A3',orientation='landscape',idFactory=()=>crypto.randomUUID()}={}){
 const next=clone(state),label=String(name||'').trim();if(!label)throw Error('배치 이름을 입력하세요.');if(next.layouts.some(layout=>layout.name===label))throw Error('같은 이름의 배치가 있습니다.');if(!PAPER[paper])throw Error('지원 용지는 A1/A3/A4입니다.');if(!['landscape','portrait'].includes(orientation))throw Error('용지 방향 오류');
 const size=PAPER[paper],layout={id:idFactory(),name:label,paper,orientation,width:orientation==='landscape'?size.width:size.height,height:orientation==='landscape'?size.height:size.width,viewports:[]};next.layouts.push(layout);next.currentSpace={kind:'paper',layoutId:layout.id};return next;
}

export function updateLayout(state,id,changes={}){
 const next=clone(state),layout=next.layouts.find(item=>item.id===id);if(!layout)throw Error('배치를 찾지 못했습니다.');
 if(changes.name!==undefined){const name=String(changes.name).trim();if(!name||next.layouts.some(item=>item.id!==id&&item.name===name))throw Error('배치 이름이 비었거나 중복됩니다.');layout.name=name;}
 if(changes.paper!==undefined||changes.orientation!==undefined){const paper=changes.paper??layout.paper,orientation=changes.orientation??layout.orientation;if(!PAPER[paper]||!['landscape','portrait'].includes(orientation))throw Error('용지 설정 오류');const size=PAPER[paper];Object.assign(layout,{paper,orientation,width:orientation==='landscape'?size.width:size.height,height:orientation==='landscape'?size.height:size.width});}
 return next;
}

export function removeLayout(state,id){const next=clone(state),index=next.layouts.findIndex(item=>item.id===id);if(index<0)throw Error('배치를 찾지 못했습니다.');next.layouts.splice(index,1);if(next.currentSpace.layoutId===id)next.currentSpace={kind:'model'};return next;}

export function createViewport(state,{layoutId,name='뷰포트',modelWindow,paperWindow,denominator=100,hiddenLayerIds=[],idFactory=()=>crypto.randomUUID()}={}){
 const next=clone(state),layout=next.layouts.find(item=>item.id===layoutId);if(!layout)throw Error('배치를 찾지 못했습니다.');if(!validBounds(modelWindow)||!validBounds(paperWindow))throw Error('모형/용지 영역을 확인하세요.');denominator=Number(denominator);if(!(denominator>0))throw Error('뷰포트 축척은 양수입니다.');
 const viewport={id:idFactory(),name:String(name||'뷰포트'),modelWindow:bounds(modelWindow),paperWindow:bounds(paperWindow),denominator,hiddenLayerIds:[...new Set(hiddenLayerIds.map(String))],locked:true};layout.viewports.push(viewport);return next;
}

const findViewport=(state,layoutId,viewportId)=>{const layout=state.layouts.find(item=>item.id===layoutId),viewport=layout?.viewports.find(item=>item.id===viewportId);if(!layout||!viewport)throw Error('배치 또는 뷰포트를 찾지 못했습니다.');return {layout,viewport};};
export function setViewportScale(state,layoutId,viewportId,denominator){denominator=Number(denominator);if(!(denominator>0))throw Error('뷰포트 축척은 양수입니다.');const next=clone(state);findViewport(next,layoutId,viewportId).viewport.denominator=denominator;return next;}
export function setViewportLayers(state,layoutId,viewportId,hiddenLayerIds){const next=clone(state);findViewport(next,layoutId,viewportId).viewport.hiddenLayerIds=[...new Set(hiddenLayerIds.map(String))];return next;}

export function modelToPaperPoint(point,viewport){const model=center(viewport.modelWindow),paper=center(viewport.paperWindow),scale=1/viewport.denominator;return {x:paper.x+(point.x-model.x)*scale,y:paper.y+(point.y-model.y)*scale};}
export function paperToModelPoint(point,viewport){const model=center(viewport.modelWindow),paper=center(viewport.paperWindow);return {x:model.x+(point.x-paper.x)*viewport.denominator,y:model.y+(point.y-paper.y)*viewport.denominator};}

const mapEntity=(entity,map,scale,metadata)=>{
 const copy=clone(entity);delete copy.id;if(copy.position)copy.position=map(copy.position);if(copy.center)copy.center=map(copy.center);if(copy.points)copy.points=copy.points.map(map);if(copy.majorAxis)copy.majorAxis={x:copy.majorAxis.x*scale,y:copy.majorAxis.y*scale};for(const key of ['radius','height','textHeight','thickness','spacing','arrowSize','extensionOffset','extensionOvershoot','textGap'])if(Number.isFinite(copy[key]))copy[key]*=scale;if(copy.entities)copy.entities=copy.entities.map(child=>mapEntity(child,map,scale,metadata));return {...copy,...metadata};
};
export function modelEntitiesToPaper(entities,viewport,layoutId){const hidden=new Set(viewport.hiddenLayerIds),scale=1/viewport.denominator,map=point=>modelToPaperPoint(point,viewport);return entities.filter(entity=>!hidden.has(String(entity.layer))).map(entity=>mapEntity(entity,map,scale,{paperSpace:true,layoutId,sourceEntityId:entity.id}));}
export function paperEntitiesToModel(entities,viewport){const scale=viewport.denominator,map=point=>paperToModelPoint(point,viewport);return entities.map(entity=>{const copy=mapEntity(entity,map,scale,{paperSpace:false});delete copy.layoutId;delete copy.sourceEntityId;return copy;});}
