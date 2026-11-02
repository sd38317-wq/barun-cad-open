import { THREE, AcTrRenderer, AcTrCamera, AcCmColor } from './vendor/mlightcad.js';
import { compileGpuScene, gpuCurveSegments, gpuCurveNextScale } from './gpu-scene.js';
import { createGpuHatch } from './gpu-fills.js';
import { fontFamilyFor } from './text-fonts.js';
import { drawingDisplayColor, linetypeDashPattern, dashWorldPerPattern, getCanvasPalette, screenLineweightPx, linetypeGeneration } from './view.js';
// 가리기(WIPEOUT, ACAD200-411)는 해치 한 종류로 저장하고 화면 바탕색으로 꽉 칠한다(테두리는 frame 0 이면 숨김).
const hatchFillColor=item=>item.entity?.wipeout?getCanvasPalette(globalThis.document?.documentElement?.dataset?.theme??'dark').background:drawingDisplayColor(item.color);
const hatchOutline=item=>!!item.entity.solid&&!(item.entity.wipeout&&item.entity.frame===0);
const ATLAS_FULL=new Error('문자 아틀라스 한도 초과');
import * as G from './geometry.js';
import { positionBounds, unionBounds, spatialChunks, createViewportIndex, createViewportIndexSteps, gpuCellCapacity } from './gpu-spatial.js';
import { detectGpuTranslations } from './gpu-edit-translation.js';
import { GpuCompileClient } from './gpu-compile-client.js';
import { compileGpuJob, gpuJobDocument, isHeavyGpuJob } from './gpu-compile-job.js';
import {gpuPolylineBounds,simplifyGpuPolyline} from './gpu-polyline-lod.js';
import {alignRasterView} from './gpu-render-protocol.js';
import {TransparentBatchRegistry} from './gpu-transparent-batches.js';
import {SceneMatrixCache} from './gpu-scene-matrices.js';
import {OpaqueBatchRegistry} from './gpu-opaque-batches.js';
import {gpuRecordUploads} from './gpu-record-upload.js';
import {GpuOrderIndexCache} from './gpu-order-index.js';
import {removeRecordsInPlace,setRecordDepthInPlace} from './gpu-batch-edit.js';
import {colorOnlyPairs} from './gpu-edit-mask.js';
import {proveDrawOrderMove,drawOrderOffsets} from './gpu-draw-order.js';
import {dashRescale,scalePatternUniforms} from './gpu-linetype-scale.js';
import {GpuRegenQueue,regenPriority,centreDistance2,orderRefineUnits} from './gpu-regen-queue.js';
import {needsCoarserCurve,curvePixelTolerance,toleranceScale} from './gpu-tessellation-range.js';
import {GpuMemoryMeter,lineUploadBytes} from './gpu-memory-meter.js';
import {displayAlpha,alphaKey} from './gpu-transparency.js';
import './gpu-lod-policy.js';
import {regenInterrupt} from './regen-interrupt.js';
const orderIndexCaches=new WeakMap();

// Only the app's complete, full-resolution visible-layer cache may cross this
// boundary. Cropped/LOD caches must omit this descriptor. Document identity and
// revision prevent an older display from being compiled after an edit.
// `display` may be a function: the app resolves it only when a complete
// build actually needs it, never on the per-frame render path.
export function compileCompleteGpuDisplay(doc,revision,scale,display) {
  if(typeof display==='function')display=display();
  if(!display||display.doc!==doc||display.revision!==revision||!Array.isArray(display.entities))return null;
  const start=performance.now(),bounds=G.bounds(display.entities);
  const origin=bounds?{x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2}:{x:0,y:0};
  return {compiled:compileGpuScene(display.entities,{scale,origin}),origin,scale,compileMs:performance.now()-start};
}

// Large imported styles contain millions of immutable segments. A 512-segment
// leaf creates tens of thousands of driver calls even at full-drawing zoom.
// Their initial upload, bulk edits and zoom refinement use larger spatial
// leaves; small refinements and local edits keep the 512-segment budget.
function initialGpuChunkWeight(records) {
  // ACAD200 106: the cell capacity is a setting (default 512 = the former constant).
  const cell=gpuCellCapacity(),large=cell*16;
  let segments=0;for(const record of records){segments+=record.points.length/6;if(segments>=large)break;}
  return segments>=large?cell*8:cell;
}
// The highest quality (power of two, conservative) at which a curve drawn
// with `segments` segments still needs no more. Power-of-two keys keep the
// per-scale bookkeeping maps small however many curves settle.
function curveSettledScale(curve,segments,atLeast){
  const next=gpuCurveNextScale(curve,segments);
  return Math.max(atLeast,next===Infinity?Infinity:2**Math.floor(Math.log2(Math.max(next,1e-300))));
}
export function initialGpuChunks(records) {
  return spatialChunks(records,initialGpuChunkWeight(records));
}
// lodCount marks an LOD polyline without reading lodPoints, which may recompute.
const hasLod=item=>!!(item.lodCount||item.lodPoints),lodLength=item=>item.lodCount??item.lodPoints?.length??0;
const staticTemplateItem=item=>item.type==='polyline'&&!item.curve&&!hasLod(item)&&!item.detailId&&!item.clipKey&&!item.clipMasks?.length;
const translatedBounds=(b,dx,dy)=>({minX:b.minX+dx,maxX:b.maxX+dx,minY:b.minY+dy,maxY:b.maxY+dy});
function templateDepthTransform(source,target){
  if(!source.length||source.length!==target.length)return null;
  const scale=source.length===1?1:(target.at(-1)-target[0])/(source.at(-1)-source[0]),offset=target[0]-source[0]*scale;
  if(!(scale>0)||!Number.isFinite(scale)||!Number.isFinite(offset))return null;
  for(let i=0;i<source.length;i++)if(Math.abs(source[i]*scale+offset-target[i])>1e-9)return null;
  return {scale,offset};
}

// Pointer-only proof for the common commit shapes: retained entities keep
// their relative order, a removed entity is dropped or replaced in place by an
// added entity with the same id, a restored (retired) entity may return at its
// old position, and brand-new entities follow at the tail. Ids are consulted
// only for the changed objects (idIndex: id -> entity of `before`), so a commit
// on a 200k-object drawing costs one pointer pass instead of a per-entity hash
// scan. Painter depth needs checking only around restored entities: every
// retained neighbour pair was already proven monotone when it was accepted.
// Any other shape returns null and takes the complete proof below.
// A layer table change is part of an edit when every kept object whose
// display reads a changed layer is displayed again by it (removed and added).
export function editCoversLayerChanges(previous,doc,added){
  if(previous.layers===doc.layers)return true;
  const changed=G.changedDisplayLayers(previous.layers,doc.layers);if(!changed.size)return true;
  const fresh=new Set(added);
  for(const entity of doc.entities)if(!fresh.has(entity)&&G.entityUsesLayers(doc.sharedBlocks,entity,changed))return false;
  return true;
}
// Below this many changed primitives an edit is always installed in place.
const GPU_MASS_EDIT_PRIMITIVES=100000;
// ACAD200 102: from this many changed batch keys an edit syncs visible-first.
const BATCH_SYNC_DEFER_KEYS=48;
// ACAD200 107: below this many drawables the median index is already cheap.
const SAH_INDEX_MIN_OBJECTS=2048;
export function fastGpuEditMembership(before,after,removed,added,idIndex,depthContext=null) {
  if(!idIndex||removed.length+added.length>4096||after.length!==before.length-removed.length+added.length)return null;
  const removedSet=new Set(removed),addedSet=new Set(added),removedIds=new Set(),newById=new Map();
  for(const entity of removed){if(removedIds.has(entity.id)||idIndex.get(entity.id)!==entity)return null;removedIds.add(entity.id);}
  for(const entity of added){if(newById.has(entity.id)||!removedIds.has(entity.id)&&idIndex.has(entity.id))return null;newById.set(entity.id,entity);}
  const retired=depthContext?.retiredSourceDepths;
  const firstDepth=id=>depthContext?.sourceZ?.get(id),lastDepth=id=>depthContext?.sourcePrimitiveDepths?.get(id)?.at(-1)??firstDepth(id);
  let i=0,placed=0,appended=false,previousId=null,ceiling=-Infinity,restoredBefore=false;
  // Depth of the nearest preceding kept source (retained, replaced or restored).
  let priorKnown=true,prior=-Infinity;
  const priorDepth=()=>{if(!priorKnown){priorKnown=true;prior=previousId==null?-Infinity:(lastDepth(previousId)??prior);}return prior;};
  const keep=entity=>{
    // A kept source after a restoration must lie above the restored slots.
    if(depthContext&&restoredBefore){const z=firstDepth(entity.id);if(z!==undefined){if(z<=ceiling)return false;restoredBefore=false;}}
    previousId=entity.id;priorKnown=false;return true;
  };
  for(let j=0;j<after.length;j++){
    const entity=after[j];
    while(i<before.length&&removedSet.has(before[i])&&!(addedSet.has(entity)&&entity.id===before[i].id))i++;
    // An object both removed and added is displayed again in place (a changed
    // layer it reads): handled as a replacement below.
    if(i<before.length&&before[i]===entity&&!removedSet.has(entity)){if(appended||!keep(entity))return null;i++;continue;}
    if(i<before.length&&removedSet.has(before[i])&&addedSet.has(entity)&&entity.id===before[i].id){
      // In-place replacement keeps the id's slots.
      if(appended||!keep(entity))return null;placed++;i++;continue;
    }
    if(addedSet.has(entity)&&!removedIds.has(entity.id)){
      if(retired?.has(entity)){
        if(appended)return null;
        const depths=retired.get(entity);
        if(depths?.length){if(depths[0]<=priorDepth())return null;prior=depths.at(-1);priorKnown=true;ceiling=Math.max(ceiling,prior);restoredBefore=true;}
        previousId=null;placed++;continue;
      }
      appended=true;placed++;continue;
    }
    return null;
  }
  for(;i<before.length;i++)if(!removedSet.has(before[i]))return null;
  if(placed!==added.length)return null;
  return {oldOrder:{has:id=>idIndex.has(id),get:id=>idIndex.get(id)},newById,orderIndices:null,removedIds,fast:true};
}

// Validate the complete COW membership delta with two linear scans. Keep only
// one full-document index; compilation needs entity lookups only for additions.
export function validateGpuEditMembership(before,after,removed,added,depthContext=null) {
  let orderCache=null;if(depthContext){orderCache=orderIndexCaches.get(depthContext);if(!orderCache){orderCache=new GpuOrderIndexCache();orderIndexCaches.set(depthContext,orderCache);}}
  const oldOrder=orderCache?orderCache.get(before):new Map(),newById=new Map(),removedIds=new Set();
  if(!oldOrder)return null;
  if(!orderCache)for(let i=0;i<before.length;i++){
    oldOrder.set(before[i].id,i);if(oldOrder.size!==i+1)return null;
  }
  for(const entity of removed){
    const index=oldOrder.get(entity.id);
    if(index===undefined||before[index]!==entity||removedIds.has(entity.id))return null;
    removedIds.add(entity.id);
  }
  for(const entity of added){if(newById.has(entity.id))return null;newById.set(entity.id,entity);}
  // Existing IDs already have dense order indices. Avoid another full string
  // hash set on every command; additions need only a small separate set.
  const seen=depthContext?null:new Uint8Array(before.length),addedSeen=new Set(),orderIndices=depthContext?null:new Int32Array(after.length);let retained=0,additions=0;
  let oldIndex=-1,appended=false,priorDepth=-Infinity;
  for(let i=0;i<after.length;i++){
    const entity=after[i];
    const id=entity.id;
    const index=before[i]===entity?i:oldOrder.get(id);if(orderIndices)orderIndices[i]=index===undefined?-1:index;
    // The renderer needs both membership and painter-order proof. Validate
    // them together; standalone callers may still inspect arbitrary ordering.
    if(depthContext){
      if(index===undefined){
        if(depthContext.retiredSourceDepths.has(entity)){
          if(appended)return null;
          const depths=depthContext.retiredSourceDepths.get(entity),depth=depths?.[0];
          if(depth!==undefined){if(depth<=priorDepth)return null;priorDepth=depths.at(-1);}
        }else appended=true;
      }else{
        if(appended||index<=oldIndex)return null;oldIndex=index;
        const depth=depthContext.sourceZ.get(id);
        if(depth!==undefined){if(depth<=priorDepth)return null;priorDepth=depthContext.sourcePrimitiveDepths.get(id)?.at(-1)??depth;}
      }
    }
    if(newById.has(id)){if(addedSeen.has(id)||newById.get(id)!==entity)return null;addedSeen.add(id);additions++;continue;}
    if(index===undefined||before[index]!==entity||removedIds.has(id)||seen?.[index])return null;
    if(seen)seen[index]=1;retained++;
  }
  if(retained!==before.length-removed.length||additions!==added.length)return null;
  // Replacements must declare removal even if their ID is reused.
  for(const entity of added){const index=oldOrder.get(entity.id);if(index!==undefined&&!removedIds.has(entity.id)&&before[index]!==entity)return null;}
  orderCache?.rememberAfter(before,after,oldOrder);
  return {oldOrder,newById,orderIndices,removedIds};
}

const RETAINABLE_PROGRAM_KEY=/,(cad-retained-opaque-v2:(line|pattern):\d+:(true|false):)?onBeforeCompile\(\)\{\}(\|barun-xclip-v1)?$|,cad-unified-transparent-prototype-v1:(true|false)$/;
export const retainableProgramKey=key=>typeof key==='string'&&RETAINABLE_PROGRAM_KEY.test(key);

// The edit model stays in double precision. Only coordinates relative to the
// drawing centre are converted to GPU floats. No DXF export/reimport is involved.
// Continuous lines have no path distances; one frozen array instead of one per record.
const NO_DISTANCES=Object.freeze([]);
export class CadGpuRenderer {
  constructor({onChange=()=>{},canvasFactory=null,compileWorker=true,buildBudgetMs=typeof document==='undefined'?Infinity:30}={}) {
    this.canvasFactory=canvasFactory;this.onChange=onChange;
    this.buildBudgetMs=buildBudgetMs;
    this.canvas=this.createCanvas();
    this.gl=new THREE.WebGLRenderer({canvas:this.canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
    this.renderer=new AcTrRenderer(this.gl);
    this.renderer.setClearColor(0,0);
    this.camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,100);
    this.camera.position.z=10;
    this.wrappedCamera=new AcTrCamera(this.camera);
    this.scene=new THREE.Scene();
    this.stats={backend:'MLightCAD',builds:0,frames:0};
    this.transparentBatches=new TransparentBatchRegistry(this);
    this.opaqueBatches=new OpaqueBatchRegistry(this);
    this.sceneMatrices=new SceneMatrixCache();
    this.compileClient=compileWorker&&typeof Worker==='function'?new GpuCompileClient({onReady:onChange}):null;
    this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.failed='GPU 컨텍스트 손실';});
  }
  createCanvas(){return this.canvasFactory?this.canvasFactory():document.createElement('canvas');}
  clearScene() {
    orderIndexCaches.delete(this);
    // A pending build is cancelled by an outside reset, not by its own clear.
    if(!this.buildStepping)this.buildTask=null;
    this.opaqueBatches?.clear();
    this.transparentBatches?.clear();
    this.sceneMatrices?.clear();
    this.renderSnapshot=null;this.textPreparedEntries=null;
    this.compiledSourceCache=new Map();
    this.compileClient?.cancel();
    this.doc=null;this.revision=null;this.lineBatches=new Map();this.sourceZ=new Map();this.nextTopZ=1;this.appendBatchKeys=new Map();this.deltaSerial=0;
    this.details=new Map();this.detailBatches=new Map();this.detailIndex=null;this.detailIndexDirty=true;this.nextDetailId=0;this.textMeshes=[];this.refinePlan=null;this.qualityPending=false;this.textGeneration=null;this.textPending=false;
    this.detailQualityScales=new Map();this.pointDetailScales=new Map();this.polylineDetailScales=new Map();this.curveBuiltScales=new Map();
    this.sourceBatches=new Map();this.sourceTextMeshes=new Map();this.sourceHatches=new Map();this.sourceDetails=new Map();
    this.sourcePrimitiveDepths=new Map();this.retiredSourceDepths=new WeakMap();this.textAssets=new Map();this.textPages=[];this.textEntryCount=0;this.nextTextEntryId=0;
    // Culled objects are detached from THREE.Scene, but remain owned here.
    const roots=new Set([...this.scene.children,...(this.spatialObjects?.keys()||[]),...[...(this.sourceTemplates?.values()||[])].flatMap(t=>t.chunks.flatMap(c=>c.roots.map(r=>r.object)))]),geometries=new Set(),materials=new Set();
    for(const root of roots)root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.userData?.barunOwnedMaterial)materials.add(m);});
    for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
    this.sourceTemplates=new Map();this.staticTemplateSources=new Set();
    for(const t of this.textures||[])t.dispose();
    for(const m of this.ownedMaterials||[])m.dispose();
    for(const mask of this.clipAssets?.values()||[])mask.texture.dispose();
    this.clipAssets=new Map();this.clippedSources=new Set();this.clipMaterials=new WeakMap();
    this.clipView={value:new THREE.Vector4()};this.clipResolution={value:new THREE.Vector2(1,1)};
    this.managedText=false;this.textSources=new Map();this.textSourceCount=0;this.textViewportIndex=null;this.textViewportCache=null;this.textBoundsMeasure=null;this.textBoundsWidths=new Map();
    this.textures=[];this.ownedMaterials=[];this.dashMaterials=new Map();this.widthMaterials=[];this.scene.clear();
    this.spatialObjects=new Map();this.viewportIndex=null;this.spatialDirty=true;this.activeObjects=new Set();
    // ACAD200: 제자리 편집(105)·나중 정리(104)·미룬 배치 동기화(102)·GPU 메모리(124)·뒤로 보내기 깊이(120).
    this.wastedBatches=new Set();this.pendingBatchSync=null;this.nextBottomZ=0;this.lastEditAt=0;this.cullIndexTask=null;this.cullIndexImproved=false;clearTimeout(this.cullIndexTimer);this.cullIndexTimer=null;
    (this.memory??=new GpuMemoryMeter()).reset();
  }
  setDocument(doc,revision,scale,edit,completeDisplay) {
    this.compileClient?.select(doc,revision);
    // A scene kept aside for a drawing tab (gpu-controller.js) returns for the
    // very document object it displays; switching tabs only renumbered it.
    if(this.restoredScene){this.restoredScene=false;if(this.doc===doc&&!this.buildTask){this.revision=revision;this.renderSnapshot=null;this.stats.workerPending=false;this.stats.restoredScenes=(this.stats.restoredScenes||0)+1;return;}}
    this.stats.workerPending=false;
    if(this.doc===doc&&this.revision===revision)return;
    if(this.buildTask){
      if(this.buildTask.doc===doc&&this.buildTask.revision===revision){this.stepBuildTask();return;}
      this.buildTask=null;   // a newer document replaces the one being built
    }
    this.refinePlan=null;this.textGeneration=null;
    this.opaqueBatches?.suspend();this.transparentBatches?.suspend();
    if(this.doc===doc&&edit?.lightweight&&edit.previousDoc===doc&&edit.previousRevision===this.revision&&!edit.removed?.length&&!edit.added?.length){this.revision=revision;return;}
    if(this.compileClient?.pending?.kind!=='full'&&this.tryEdit(doc,revision,scale,edit))return;
    const start=performance.now();
    // ACAD200 114: VIEWRES (doc.viewres, default 1000) scales the curve tolerance.
    this.viewresFactor=toleranceScale(1,curvePixelTolerance(doc.viewres));
    let detailScale=Math.max(scale,1e-9)*(this.renderPixelRatio||1)*2*this.viewresFactor;
    let job;const getJob=()=>job??={doc:gpuJobDocument(doc),scale:detailScale};
    const prepared=this.doc&&edit?.lightweight&&isHeavyGpuJob(doc.entities)?this.compileClient?.request(doc,revision,'full',this.compileWaiting(doc,revision,'full')?null:getJob()):null;
    if(prepared?.pending){this.stats.workerPending=true;return;}
    // A heavy complete build is a resumable task: each frame works it off for
    // a bounded time, so opening a 200k-object drawing never freezes input.
    // Small drawings and synchronous callers (tests) run the same steps at once.
    // Worker compilation bounds CPU preparation, not scene installation. A
    // rejected ARRAY can have only a few roots but tens of thousands of
    // compiled children; installing that result must still yield between frames.
    const sliced=Number.isFinite(this.buildBudgetMs)&&(doc.entities.length>=5000||
      (prepared?.result?.compiled.items.length??this.stats.items??0)>=5000||
      !!edit?.lightweight&&isHeavyGpuJob(doc.entities,5000));
    (this.stats.buildLog??=[]).push({revision,sliced,at:Math.round(performance.now()),entities:doc.entities.length});if(this.stats.buildLog.length>8)this.stats.buildLog.shift();
    const task={doc,revision,progress:{phase:'prepare',done:0,total:0},gen:null};
    task.gen=this.sceneBuildSteps(doc,revision,scale,prepared,getJob,completeDisplay,start,detailScale,sliced,task.progress);
    this.buildTask=task;this.stepBuildTask(sliced?this.buildBudgetMs:Infinity);
  }
  // Runs the pending build for up to budgetMs; true once the scene is complete.
  stepBuildTask(budgetMs=this.buildBudgetMs??Infinity) {
    const task=this.buildTask;if(!task)return true;
    const start=performance.now();
    this.buildStepping=true;
    try{
      for(;;){
        if(task.gen.next().done){if(this.buildTask===task)this.buildTask=null;this.stats.workerPending=false;this.stats.buildProgress=null;return true;}
        // ACAD200 117: new input ends this slice early (checked at most every 100 ms).
        if(performance.now()-start>=budgetMs||Number.isFinite(budgetMs)&&regenInterrupt.inputPending())break;
      }
    }catch(error){if(this.buildTask===task)this.buildTask=null;this.stats.buildProgress=null;throw error;}
    finally{this.buildStepping=false;}
    this.stats.workerPending=true;this.stats.buildProgress={...task.progress};
    if(!this.buildFrameRequested){this.buildFrameRequested=true;setTimeout(()=>{this.buildFrameRequested=false;this.onChange();},0);}
    return false;
  }
  *sceneBuildSteps(doc,revision,scale,prepared,getJob,completeDisplay,start,detailScale,sliced,progress) {
    let resolved=null,result=prepared?.result||null;
    if(!result&&sliced){
      // Same inputs as compileCompleteGpuDisplay/compileGpuJob, compiled in
      // entity runs so no single step blocks input. compileGpuScene visits each
      // top-level entity independently, so the concatenation is identical.
      const compileStart=performance.now(),display=typeof completeDisplay==='function'?completeDisplay():completeDisplay;
      const usable=display&&display.doc===doc&&display.revision===revision&&Array.isArray(display.entities);
      let entities=usable?display.entities:null;
      if(!entities){const jobDoc=gpuJobDocument(doc);entities=[];for(let i=0;i<jobDoc.entities.length;i+=2000){for(const entity of G.visibleEntities(jobDoc,{inPlace:true,lodScale:0,viewBox:null,entities:jobDoc.entities.slice(i,i+2000)}))entities.push(entity);progress.phase='prepare';progress.done=i;progress.total=jobDoc.entities.length;yield;}}
      let b=null;
      for(let i=0;i<entities.length;i+=4000){const part=G.bounds(entities.slice(i,i+4000));if(part)b=b?{minX:Math.min(b.minX,part.minX),minY:Math.min(b.minY,part.minY),maxX:Math.max(b.maxX,part.maxX),maxY:Math.max(b.maxY,part.maxY)}:part;progress.phase='prepare';progress.done=i;progress.total=entities.length;yield;}
      const origin=b?{x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2}:{x:0,y:0},items=[],unsupported=[];
      for(let i=0;i<entities.length;i+=2000){const part=compileGpuScene(entities.slice(i,i+2000),{scale:detailScale,origin});for(const item of part.items)items.push(item);for(const entry of part.unsupported)unsupported.push(entry);progress.phase='compile';progress.done=i;progress.total=entities.length;yield;}
      result={compiled:{items,unsupported},origin,scale:detailScale,compileMs:performance.now()-compileStart};if(usable)resolved=result;
    }
    if(!result)resolved=compileCompleteGpuDisplay(doc,revision,detailScale,completeDisplay);
    const buildStage={};let buildMark=performance.now();const stamp=name=>{const t=performance.now();buildStage[name]=Math.round(t-buildMark);buildMark=t;};
    result||=resolved||compileGpuJob(getJob());const {compiled,origin:shift}=result;stamp('compile');
    detailScale=result.scale;
    this.compileClient?.consume();
    Object.assign(this.stats,{compileMs:result.compileMs,workerBuilds:(this.stats.workerBuilds||0)+(prepared?.result?1:0),completeDisplayBuilds:(this.stats.completeDisplayBuilds||0)+(resolved?1:0)});
    // Objects the canvas cannot draw either (unknown types, broken point lists, degenerate clips) are skipped; one of them must not
    // move the whole drawing to the slow renderer.
    this.stats.skippedObjects=compiled.unsupported.length;this.stats.skippedObjectSamples=compiled.unsupported.slice(0,5).map(x=>x.type+'('+x.reason+')');
    this.clearScene();this.shift=shift;this.detailScale=detailScale;stamp('clear');
    // A sliced build shows nothing half made: the canvas is cleared once.
    if(sliced)this.gl.clear(true,true,true);
    this.rememberCompiledSources(doc,compiled.items,result.scale,true);stamp('remember');
    for(const [entity,cached] of this.compiledSourceCache)if(cached.items.filter(staticTemplateItem).length>=128)this.staticTemplateSources.add(entity.id);
    const batches=new Map(), textItems=[];let textRun=-1;
    const total=Math.max(1,compiled.items.length);
    const addSegments=(item,points,closed,z)=>this.addSegments(batches,item,points,closed,z,scale);
    progress.phase='items';progress.total=compiled.items.length;
    for(let index=0;index<compiled.items.length;index++){
      const item=compiled.items[index];
      if(sliced&&index%512===0){progress.done=index;yield;}
      const z=index/total;
      if(!this.sourceZ.has(item.sourceId))this.sourceZ.set(item.sourceId,z);
      // [z], not [] then push: pushing into an empty array reserves 16 slots, which
      // for 1.86M one-primitive sources held ~300 MB of unused depth storage.
      const depths=this.sourcePrimitiveDepths.get(item.sourceId);if(depths)depths.push(z);else this.sourcePrimitiveDepths.set(item.sourceId,[z]);
      this.registerDetail(item,z,detailScale,scale);
      if(item.type==='polyline')addSegments(item,item.points,item.closed,z);
      else if(item.type==='point'){
        const p=item.position||item.point;const r=1/scale;
        addSegments({...item,lineweight:.5},[{x:p.x-r,y:p.y},{x:p.x+r,y:p.y}],false,z);
      }else if(item.type==='text')textItems.push({item,z,order:textRun});
      else if(item.type==='hatch'){
        this.renderer.subEntityTraits.color=new AcCmColor().setRGBFromCss(hatchFillColor(item));
        const o=createGpuHatch(this.renderer,item.entity,shift,index);
        if(!o.userData.barunEmpty){
        o.traverse(child=>{
          if(child.isGroup)child.renderOrder=0;
          if(child.material){child.material.depthTest=true;child.material.depthWrite=false;child.renderOrder=z*1e6;}
        });
        o.position.z=z;this.applyClip(o,item);this.scene.add(o);
        if(!this.sourceHatches.has(item.sourceId))this.sourceHatches.set(item.sourceId,new Set());this.sourceHatches.get(item.sourceId).add(o);
        // The generated fill includes bulged boundaries and nested loops;
        // the source vertices alone are not a conservative hatch bound.
        o.updateMatrixWorld(true);const hb=new THREE.Box3().setFromObject(o);
        this.registerSpatial(o,{minX:hb.min.x,maxX:hb.max.x,minY:hb.min.y,maxY:hb.max.y});
        }
        if(hatchOutline(item))for(const loop of [item.entity.points,...(item.entity.loops||[])])addSegments(item,loop.map(p=>({x:p.x-shift.x,y:p.y-shift.y})),true,z+0.1/total);
        textRun=index+1;
      }
    }
    stamp('items');
    // A shared colour must never form one drawing-wide GPU buffer. Partition
    // each style into spatial leaves, with bounded upload cost per leaf.
    this.lineBatches=new Map();
    progress.phase='lines';progress.done=0;progress.total=batches.size;
    for(const [style,batch] of batches){
      for(const records of initialGpuChunks(batch.records)){
        const chunk={...batch,records,maxWeight:initialGpuChunkWeight(batch.records),objects:[]};this.buildLineBatch(chunk);
        const key=style+'|leaf'+this.lineBatches.size;chunk.key=key;this.lineBatches.set(key,chunk);
        if(sliced)yield;
      }
      progress.done++;
    }
    stamp('lineBatches');progress.phase='finish';if(sliced)yield;this.captureSourceTemplates(doc);stamp('templates');
    // The former zoom rebuild reached this same 128px ceiling. Build that
    // quality once; the atlas remains valid at every camera scale thereafter.
    this.managedText=textItems.length>512||textItems.reduce((n,e)=>n+String(e.item.entity.text).length,0)>32768;
    this.acceptText(textItems,total);stamp('text');if(sliced)yield;
    // Build the view-quality indexes with the scene. Built lazily they cost
    // hundreds of milliseconds on the first still frame after the first zoom.
    const indexStart=performance.now();
    // A sliced build grows each index a few hundred nodes per step; a million
    // details took 0.75 s in one piece. The cull index is built here too, not
    // by the first frame's updateViewport.
    const buildIndex=function*(entries,options){return sliced?yield* createViewportIndexSteps(entries,512,options):createViewportIndex(entries,options);};
    if(this.details.size){this.detailIndex=yield* buildIndex([...this.details.values()]);this.detailIndexDirty=false;}
    if(this.managedText&&!this.textViewportIndex)this.textViewportIndex=yield* buildIndex([...this.textSources.values()].flat());
    if(this.spatialDirty){this.viewportIndex=yield* buildIndex([...this.spatialObjects.values()]);this.spatialDirty=false;}
    // The edit proof's id table, built with the scene rather than in the first commit.
    this.entityIds={entities:doc.entities,map:new Map(doc.entities.map(entity=>[entity.id,entity]))};
    this.stats.qualityIndexMs=performance.now()-indexStart;stamp('indexes');this.stats.buildStage=buildStage;
    // Programs otherwise link inside the first draw: 2.4 s for 30+ programs on a
    // full plan. Link them before the first frame; a driver with
    // KHR_parallel_shader_compile links off the main thread while we wait.
    if(sliced&&typeof this.gl.compile==='function'){
      const objects=[...this.spatialObjects.keys()].map(key=>key?.isObject3D?key:key?.object).filter(object=>object?.isObject3D);
      const probe=new THREE.Scene();probe.children=objects;
      // compile() links every program; isReady() polls COMPLETION_STATUS_KHR
      // synchronously, so a caller stepping the build without turning the event
      // loop (the packaged verifier) still completes it.
      let materials=null;const linkStart=performance.now();
      try{materials=this.gl.compile(probe,this.camera);}catch{materials=null;}
      const linked=()=>{try{for(const material of materials||[]){const program=this.gl.properties?.get(material)?.currentProgram;if(program&&typeof program.isReady==='function'&&!program.isReady())return false;}return true;}catch{return true;}};
      progress.phase='finish';
      while(materials&&!linked()&&performance.now()-linkStart<4000)yield;
      stamp('programs');
      // Geometry and texture buffers are otherwise uploaded by the first draw
      // (0.5 s of bufferData on a full plan). Draw the objects in slices through
      // an empty scissor with an all-covering camera so they upload here.
      try{
        const gl=this.gl,autoClear=gl.autoClear,wide=new THREE.OrthographicCamera(-1e15,1e15,1e15,-1e15,-1e15,1e15);wide.updateProjectionMatrix();
        for(let i=0;i<objects.length;i+=256){
          gl.autoClear=false;gl.setScissorTest(true);gl.setScissor(0,0,0,0);
          try{probe.children=objects.slice(i,i+256);gl.render(probe,wide);}
          finally{probe.children=[];gl.setScissorTest(false);gl.autoClear=autoClear;}
          // Restore GL state before yielding: a newer revision or outside
          // reset may discard this generator without ever resuming it.
          yield;
        }
      }catch(error){this.stats.uploadWarmupError=String(error?.message||error);}
      stamp('uploads');this.stats.buildStage=buildStage;
    }
    this.doc=doc;this.revision=revision;
    Object.assign(this.stats,{builds:this.stats.builds+1,buildMs:performance.now()-start,items:compiled.items.length,unsupported:0,lineChunks:this.lineBatches.size,hatchObjects:[...this.sourceHatches.values()].reduce((n,s)=>n+s.size,0)});
    const lod=compiled.items.filter(hasLod);Object.assign(this.stats,{initialLodPolylines:lod.length,initialLodSourcePoints:lod.reduce((n,item)=>n+lodLength(item),0),initialLodDisplayPoints:lod.reduce((n,item)=>n+item.points.length,0)});
  }
  captureSourceTemplates(doc){
    for(const [entity,cached] of this.compiledSourceCache){
      if(!this.staticTemplateSources.has(entity.id))continue;
      const batches=[...this.sourceBatchesOf(entity.id)].filter(batch=>batch.templateSourceId===entity.id);
      if(!batches.length||batches.some(batch=>batch.objects.some(o=>typeof o.fastDeepClone!=='function')))continue;
      const dynamicItems=[];cached.items.forEach((item,ordinal)=>{if(!staticTemplateItem(item))dynamicItems.push({item,ordinal});});
      const template={entity,cached,dynamicItems,primitiveCount:cached.items.length,definitions:doc.sharedBlocks,depths:[...this.sourcePrimitiveDepths.get(entity.id)],chunks:[],refs:0};
      for(const batch of batches){
        template.chunks.push({...batch,roots:batch.objects.map(object=>({object,position:object.position.clone(),scale:object.scale.clone(),...this.spatialObjects.get(object)}))});
        batch.template=template;template.refs++;
      }
      this.sourceTemplates.set(entity,template);
    }
    Object.assign(this.stats,{sourceTemplates:this.sourceTemplates.size,templateStaticItems:[...this.sourceTemplates.values()].reduce((n,t)=>n+t.cached.items.filter(staticTemplateItem).length,0)});
  }
  reuseTemplateCopies(doc,removed,added,compactCopies=false){
    if(removed.length||!added.length||!this.sourceTemplates?.size)return null;
    const plans=[];
    for(const entity of added){
      if(!entity.sharedBlock||entity.entities?.length)return null;
      let found;
      for(const [source,template] of this.sourceTemplates){
        if(template.definitions!==doc.sharedBlocks||source.sharedBlock!==entity.sharedBlock)continue;
        const delta=source===entity?{dx:0,dy:0}:detectGpuTranslations([source],[{...entity,id:source.id}])?.get(source.id);
        if(delta){found={template,entity,...delta};break;}
      }
      if(!found)return null;plans.push(found);
    }
    const start=performance.now(),items=[];
    if(compactCopies)for(const plan of plans){
      plan.dynamicItems=plan.template.dynamicItems.map(({item,ordinal})=>({item:this.translateCompiledItem(item,plan.entity.id,plan.dx,plan.dy),ordinal}));
      for(const entry of plan.dynamicItems)items.push(entry.item);
    }
    else for(const plan of plans)for(const original of plan.template.cached.items){
      if(staticTemplateItem(original)){items.push({type:'template',sourceId:plan.entity.id});continue;}
      items.push(this.translateCompiledItem(original,plan.entity.id,plan.dx,plan.dy));
    }
    return {compiled:{items,unsupported:[]},compactCopies,primitiveCount:compactCopies?plans.reduce((n,p)=>n+p.template.primitiveCount,0):items.length,origin:this.shift,scale:Math.min(...plans.map(p=>p.template.cached.scale)),compileMs:performance.now()-start,reusedSources:plans.length,templatePlans:plans};
  }
  installTemplateCopies(plans){
    for(const {template,entity,dx,dy,depthTransform} of plans)for(const chunk of template.chunks){
      const key=chunk.style+'|instance'+(++this.deltaSerial),batch={...chunk,key,template,templateSourceId:entity.id,records:chunk.records.map(record=>({...record,sourceId:entity.id})),objects:[],gpuBytes:0};delete batch.roots;
      for(const root of chunk.roots){
        const object=root.object.fastDeepClone(true);
        object.position.set(root.position.x+dx,root.position.y+dy,root.position.z*depthTransform.scale+depthTransform.offset);
        object.scale.copy(root.scale);object.scale.z*=depthTransform.scale;
        this.scene.add(object);batch.objects.push(object);
        this.registerSpatial(object,translatedBounds(root.bounds,dx,dy),root.pixelMargin,root.worldMargin);
      }
      this.lineBatches.set(key,batch);this.addSourceBatch(entity.id,batch);template.refs++;
    }
    this.stats.templateCopySources=(this.stats.templateCopySources||0)+plans.length;
  }
  translateCompiledItem(original,sourceId,dx,dy){
    const item={...original,sourceId};delete item.detailId;
    const point=p=>({x:p.x+dx,y:p.y+dy});
    if(item.points)item.points=item.points.map(point);
    if(hasLod(item)){item.lodPoints=item.lodPoints.map(point);if(item.lodBounds)item.lodBounds={minX:item.lodBounds.minX+dx,minY:item.lodBounds.minY+dy,maxX:item.lodBounds.maxX+dx,maxY:item.lodBounds.maxY+dy};}
    if(item.position)item.position=point(item.position);
    if(item.curve)item.curve=G.translate(item.curve,dx,dy);
    if(item.entity)item.entity=G.translate(item.entity,dx,dy);
    return item;
  }
  rememberCompiledSources(doc,items,scale,initial=false,entities=doc.entities) {
    // Retain only a few compact shared sources, not a second complete scene.
    // Immutable entity identity and definitions are the cache's edit boundary.
    const sources=new Map(entities.filter(e=>e.sharedBlock&&!e.entities?.length).map(e=>[e.id,e])),groups=new Map();
    for(const item of items){
      const entity=sources.get(item.sourceId);if(!entity)continue;
      let group=groups.get(entity);if(!group)groups.set(entity,group={entity,items:[],points:0,valid:true});
      group.items.push(item);group.points+=(item.points?.length||0)+lodLength(item);
      if(item.entity)group.points+=(item.entity.points?.length||0)+(item.entity.loops||[]).reduce((n,loop)=>n+loop.length,0);
      if(!['polyline','hatch'].includes(item.type)||item.clipKey||item.clipMasks?.length)group.valid=false;
    }
    const eligible=[...groups.values()].filter(g=>g.valid&&g.items.length&&g.items.length<=100000&&g.points<=500000);
    if(initial)eligible.sort((a,b)=>b.items.length-a.items.length);
    for(const group of eligible){
      const cache=this.compiledSourceCache;
      const totals=()=>[...cache.values()].reduce((n,c)=>({items:n.items+c.items.length,points:n.points+c.points}),{items:0,points:0});
      if(initial){const used=totals();if(cache.size>=4||used.items+group.items.length>100000||used.points+group.points>500000)continue;}
      cache.delete(group.entity);
      cache.set(group.entity,{...group,scale,definitions:doc.sharedBlocks});
      let used=totals();
      while(cache.size>4||used.items>100000||used.points>500000){cache.delete(cache.keys().next().value);used=totals();}
    }
  }
  reuseCompiledCopies(doc,removed,added) {
    if(removed.length||!added.length||!this.compiledSourceCache?.size)return null;
    const plans=[];
    for(const entity of added){
      if(!entity.sharedBlock||entity.entities?.length)return null;
      let found=null;
      for(const [source,cached] of this.compiledSourceCache){
        if(cached.definitions!==doc.sharedBlocks||source.sharedBlock!==entity.sharedBlock)continue;
        if(source===entity){found={cached,entity,dx:0,dy:0};break;}
        const delta=detectGpuTranslations([source],[{...entity,id:source.id}])?.get(source.id);
        if(delta){found={cached,entity,...delta};break;}
      }
      if(!found)return null;plans.push(found);
    }
    const start=performance.now(),items=[];
    for(const {cached,entity,dx,dy} of plans)for(const original of cached.items){
      // Feed ordinary incoming-item handling: new depth slots, owned buffers,
      // hatch meshes and refinement registrations stay on the proven path.
      items.push(this.translateCompiledItem(original,entity.id,dx,dy));
    }
    return {compiled:{items,unsupported:[]},origin:this.shift,scale:Math.min(...plans.map(p=>p.cached.scale)),compileMs:performance.now()-start,reusedSources:plans.length};
  }
  // One style description per (colour, width, linetype, scale, constant width):
  // building it per primitive (a JSON key and a dash array) was a large share
  // of the first-frame build of a 500k-primitive drawing.
  lineStyle(color,width,linetype,linetypeScale,constantWidth) {
    const id=color+'\u0000'+width+'\u0000'+linetype+'\u0000'+linetypeScale+'\u0000'+constantWidth;
    // ACAD200 720: 선종류 무늬 원천(.lin/예전/도면 정의)이 바뀌면 무늬 캐시를 비운다(정수 비교 한 번).
    if(this.lineStylesGeneration!==linetypeGeneration()){this.lineStyles=new Map();this.lineStylesGeneration=linetypeGeneration();}
    const cache=this.lineStyles??=new Map();let style=cache.get(id);
    if(!style){const dash=linetypeDashPattern(linetype,linetypeScale);style={dash,key:JSON.stringify([color,width,dash,constantWidth])};cache.set(id,style);}
    return style;
  }
  addSegments(batches,item,points,closed,z,scale) {
    const color=drawingDisplayColor(item.color);
    const width=item.constantWidth>0?Math.max(.5,item.constantWidth*scale):screenLineweightPx(item.lineweight??.25);   // ACAD200 718 LWDISPLAY
    const style=this.lineStyle(color,width,item.linetype,item.linetypeScale||1,item.constantWidth||0),dash=style.dash;
    // Curves and screen-size points have mutable detail; never let refining
    // them invalidate otherwise static line/polyline buffers of the same style.
    const templateSourceId=this.staticTemplateSources.has(item.sourceId)&&staticTemplateItem(item)?item.sourceId:undefined;
    // ACAD200 121: 투명한 선은 알파별 배치(투명 재질)로 간다. 투명도가 없는 항목은 키가 예전과 같다.
    const alpha=item.transparency?alphaKey(displayAlpha(item.transparency)):1;
    const key=style.key+(alpha<1?'|a'+alpha:'')+(item.detailId?'|detail':'')+(item.clipKey?'|clip'+item.clipKey:'')+(templateSourceId?'|template'+templateSourceId:'');
    let batch=batches.get(key);
    if(!batch)batches.set(key,batch={style:key,color,width,dash,constantWidth:item.constantWidth||0,clipMasks:item.clipMasks,clipKey:item.clipKey,templateSourceId,records:[],objects:[],...(alpha<1?{alpha}:{}),...(dash.length?{linetype:item.linetype,linetypeScale:item.linetypeScale||1}:{})});
    // Records hold at most 32 segments. Fill exactly sized typed arrays
    // directly instead of growing plain arrays and copying them.
    const dashed=dash.length>0,end=points.length+(closed?1:0);
    let values=null,distances=null,used=0,distance=0,left=end-1;
    const flush=()=>{
      if(!used)return;
      const segments=used/6,pts=used===values.length?values:values.slice(0,used);
      const record={sourceId:item.sourceId,detailId:item.detailId,points:pts,distances:dashed?(distances.length===segments*2?distances:distances.slice(0,segments*2)):NO_DISTANCES,bounds:positionBounds(pts)};
      batch.records.push(record);values=null;distances=null;used=0;
    };
    for(let i=1;i<end;i++,left--){
      const a=points[i-1],b=points[i%points.length];if(!a||!b)continue;
      if(!values){const capacity=Math.min(32,left);values=new Float64Array(capacity*6);if(dashed)distances=new Float64Array(capacity*2);}
      values[used]=a.x;values[used+1]=a.y;values[used+2]=z;values[used+3]=b.x;values[used+4]=b.y;values[used+5]=z;
      // Only dashed shaders consume path distance. Keeping it for continuous
      // lines duplicates millions of unused numbers in large drawings.
      if(dashed){const at=used/3,next=distance+Math.hypot(b.x-a.x,b.y-a.y);distances[at]=distance;distances[at+1]=next;distance=next;}
      used+=6;
      if(used===values.length)flush();
    }
    flush();
    return key;
  }
  // sourceBatches maps a source id to its one line batch, or to a Set when its
  // records span several batches. A Set per source was 1.86M Sets (~130 MB and
  // as many objects for every major GC) on a 1.9M-line drawing.
  addSourceBatch(id,batch){const current=this.sourceBatches.get(id);if(!current)this.sourceBatches.set(id,batch);else if(current instanceof Set)current.add(batch);else if(current!==batch)this.sourceBatches.set(id,new Set([current,batch]));}
  removeSourceBatch(id,batch){const current=this.sourceBatches.get(id);if(current===batch)this.sourceBatches.delete(id);else if(current instanceof Set){current.delete(batch);if(current.size===1)this.sourceBatches.set(id,current.values().next().value);else if(!current.size)this.sourceBatches.delete(id);}}
  sourceBatchesOf(id){const current=this.sourceBatches.get(id);return !current?[]:current instanceof Set?current:[current];}
  buildLineBatch(batch) {
    for(const record of batch.records)this.addSourceBatch(record.sourceId,batch);
    for(const record of batch.records)if(record.detailId){let set=this.detailBatches.get(record.detailId);if(!set)this.detailBatches.set(record.detailId,set=new Set());set.add(batch);}
    // A fresh build has no index gaps (ACAD200 105): forget the in-place edit table.
    // Copies ({...batch}) carry the source's counters: this object is not counted yet.
    delete batch.recordStarts;batch.gpuBytes=0;let vertices=0;
    const meter=this.memory??=new GpuMemoryMeter(),translucent=batch.alpha>0&&batch.alpha<1;
      // Uint16 indices have a hard 65535-vertex limit; split before uploading.
      for(const {values,distances} of gpuRecordUploads(batch.records,batch.dash.length>0)){
        const indices=Uint16Array.from({length:values.length/3},(_,i)=>i);
        this.renderer.subEntityTraits.color=new AcCmColor().setRGBFromCss(batch.color);
        this.renderer.subEntityTraits.lineWeight=batch.width*40;
        this.renderer.subEntityTraits.drawOrder=0;
        this.renderer.subEntityTraits.lineType={name:JSON.stringify(batch.dash),type:'Standard',pattern:batch.dash.map((n,i)=>({elementLength:i%2?-n:n,elementTypeFlag:0}))};
        // ACAD200 125: subtract the chunk centre in double precision before the
        // Float32 conversion and carry it in the object position. A leaf spans a
        // small area, so a TM-coordinate site keeps sub-millimetre vertices at
        // any zoom. Template batches keep their position = copy offset contract.
        const bounds=positionBounds(values),centred=!batch.templateSourceId&&Number.isFinite(bounds.minX)&&Number.isFinite(bounds.minY);
        const cx=centred?(bounds.minX+bounds.maxX)/2:0,cy=centred?(bounds.minY+bounds.maxY)/2:0;
        if(centred)for(let i=0;i<values.length;i+=3){values[i]-=cx;values[i+1]-=cy;}
        const o=this.renderer.lineSegments(new Float32Array(values),3,indices);
        if(centred){o.position.x+=cx;o.position.y+=cy;}
        this.applyClip(o,batch);
        if(batch.dash.length)o.traverse(child=>{if(child.geometry?.getAttribute('lineDistance'))child.geometry.setAttribute('lineDistance',new THREE.Float32BufferAttribute(distances,1));});
        o.traverse(child=>{if(child.material){if((batch.constantWidth||translucent)&&!child.material.userData.barunOwnedMaterial){child.material=child.material.clone();child.material.userData.barunOwnedMaterial=true;}child.material.depthTest=true;child.material.depthWrite=!translucent;if(translucent){child.material.transparent=true;child.material.opacity=batch.alpha;}if(batch.dash.length)this.dashMaterials.set(child.material,batch.linetypeScale);if(batch.constantWidth)this.widthMaterials.push([child.material,batch.constantWidth]);}});
        this.scene.add(o);batch.objects.push(o);
        this.registerSpatial(o,bounds,batch.width/2+2,batch.constantWidth/2);
        meter.add(batch,lineUploadBytes(values.length,batch.dash.length>0));vertices+=values.length/3;
      }
    batch.totalVertices=batch.liveVertices=vertices;
    // Retain per-source records, not a second copy of all numeric arrays.
    delete batch.points;delete batch.distances;
  }
  // ACAD200 104·105: tell the retained draw registries that this root's buffers
  // changed in place (index gaps, depth), so only it is re-walked and re-merged.
  noteObjectReplaced(object){
    this.batchSceneEpoch=(this.batchSceneEpoch||0)+1;
    this.transparentBatches?.noteReplaced?this.transparentBatches.noteReplaced(object):this.transparentBatches?.noteChanged();
    this.opaqueBatches?.noteReplaced?this.opaqueBatches.noteReplaced(object):this.opaqueBatches?.noteChanged();
  }
  // ACAD200 105: drop removed sources' records from a line batch by closing the
  // gaps in its index buffers only. Vertex buffers stay; the batch is rebuilt
  // (compacted) later when idle (consolidateIdle) or at once when half wasted.
  removeBatchRecordsInPlace(batch,ids){
    if(batch.template||!batch.totalVertices)return false;
    let removedVertices=0,kept=0;
    for(const record of batch.records)if(ids.has(record.sourceId))removedVertices+=record.points.length/3;else kept++;
    if(!removedVertices||!kept)return false;
    if(((batch.liveVertices??batch.totalVertices)-removedVertices)/batch.totalVertices<.5)return false;
    const result=removeRecordsInPlace(batch,ids);if(!result)return false;
    for(const record of result.removed){
      this.removeSourceBatch(record.sourceId,batch);
      if(record.detailId){const set=this.detailBatches.get(record.detailId);set?.delete(batch);if(!set?.size)this.detailBatches.delete(record.detailId);}
    }
    for(const object of result.changed)this.noteObjectReplaced(object);
    (this.wastedBatches??=new Set()).add(batch);
    this.stats.inPlaceRemovals=(this.stats.inPlaceRemovals||0)+1;
    return true;
  }
  // ACAD200 104: in idle frames (no edit for 300 ms, view at rest) rebuild the
  // batches left with index gaps, nearest the view first, within a budget.
  consolidateIdle(budgetMs=4){
    if(!this.wastedBatches?.size)return false;
    const wait=300-(performance.now()-(this.lastEditAt||0));
    if(wait>0){if(!this.idleTimer){this.idleTimer=setTimeout(()=>{this.idleTimer=null;this.renderSnapshot=null;this.onChange();},Math.ceil(wait));}return false;}
    const view=this.lastViewBox,centre=view&&{x:(view.minX+view.maxX)/2,y:(view.minY+view.maxY)/2};
    const queue=new GpuRegenQueue({run:({batch})=>{
      this.wastedBatches.delete(batch);if(this.lineBatches.get(batch.key)!==batch)return;
      this.disposeLineBatch(batch);this.buildLineBatch(batch);this.stats.consolidatedBatches=(this.stats.consolidatedBatches||0)+1;
    }});
    for(const batch of this.wastedBatches){const bounds=unionBounds(batch.records);queue.enqueue({key:batch.key,batch,distance:centre?centreDistance2(bounds,centre):0},regenPriority(bounds,view));}
    queue.pump(budgetMs);
    this.refreshLineMaterials();
    return this.wastedBatches.size>0;
  }
  // ACAD200 107: the scene opens with the fast median-cut cull index (open time
  // unchanged); idle frames then build a cost-cut (SAH) copy in small slices and
  // swap it in. Any scene change meanwhile abandons the copy (retried later).
  // Runs on its own timer slices (no extra frames are drawn: the swapped index
  // answers every query exactly like the old one). True while unfinished.
  improveCullIndex(budgetMs=4){
    if(this.cullIndexImproved||this.spatialDirty||!this.viewportIndex||(this.spatialObjects?.size||0)<SAH_INDEX_MIN_OBJECTS){this.cullIndexTask=null;return false;}
    let task=this.cullIndexTask;
    if(task&&task.epoch!==this.batchSceneEpoch)task=null;
    if(!task)task=this.cullIndexTask={epoch:this.batchSceneEpoch,gen:createViewportIndexSteps([...this.spatialObjects.values()],256,{sah:true})};
    const start=performance.now();
    for(;;){
      const step=task.gen.next();
      if(step.done){this.cullIndexTask=null;this.viewportIndex=step.value;this.cullIndexImproved=true;this.stats.cullIndexImproved=(this.stats.cullIndexImproved||0)+1;return false;}
      if(performance.now()-start>=budgetMs||regenInterrupt.inputPending())return true;
    }
  }
  scheduleCullIndexImprovement(){
    if(this.cullIndexImproved||this.cullIndexTimer||(this.spatialObjects?.size||0)<SAH_INDEX_MIN_OBJECTS||!Number.isFinite(this.buildBudgetMs))return;
    const tick=()=>{
      this.cullIndexTimer=null;
      // Not while editing or building: wait for 300 ms without edits.
      if(this.buildTask||this.pendingBatchSync||performance.now()-(this.lastEditAt||0)<300){this.cullIndexTimer=setTimeout(tick,300);return;}
      if(this.improveCullIndex(4))this.cullIndexTimer=setTimeout(tick,0);
    };
    this.cullIndexTimer=setTimeout(tick,0);
  }
  // ACAD200 102: a large edit synchronises its batches visible-first. Batch
  // keys left over continue in the next frames; every other scene mutation
  // completes them first (flushBatchSync), so no path sees a half-applied edit.
  flushBatchSync(budgetMs=Infinity){
    const queue=this.pendingBatchSync;if(!queue)return true;
    queue.pump(budgetMs);
    if(queue.size)return false;
    this.pendingBatchSync=null;this.refreshLineMaterials();return true;
  }
  syncBatchKey(key,next){
    const old=this.lineBatches.get(key);if(old)this.disposeLineBatch(old);
    this.lineBatches.delete(key);
    for(const [index,records] of spatialChunks(next.records,next.maxWeight||512).entries()){
      const chunkKey=index?key+'|split'+index:key,chunk={...next,key:chunkKey,records,objects:[]};this.buildLineBatch(chunk);
      this.lineBatches.set(chunkKey,chunk);
    }
  }
  disposeLineBatch(batch) {
    this.memory?.remove(batch);this.wastedBatches?.delete(batch);
    for(const record of batch.records)this.removeSourceBatch(record.sourceId,batch);
    for(const record of batch.records)if(record.detailId){const set=this.detailBatches.get(record.detailId);set?.delete(batch);if(!set?.size)this.detailBatches.delete(record.detailId);}
    for(const o of batch.objects){
      this.scene.remove(o);
      this.removeSpatial(o);
      if(!batch.template)o.traverse(child=>{child.geometry?.dispose();for(const m of Array.isArray(child.material)?child.material:[child.material])if(m?.userData?.barunOwnedMaterial)m.dispose();});
    }
    if(batch.template)batch.template.refs--;
    batch.objects=[];
  }
  applyClip(object,item) {
    if(!item.clipMasks?.length)return;
    const key=item.clipKey||JSON.stringify(item.clipMasks);
    let asset=this.clipAssets.get(key);
    if(!asset){
      const edges=item.clipMasks.flatMap(mask=>mask.points.map((a,i)=>({a,b:mask.points[(i+1)%mask.points.length],end:i===mask.points.length-1?(mask.inverted?-1:1):0})));
      const width=Math.min(this.gl.capabilities.maxTextureSize,edges.length),height=Math.ceil(edges.length/width)*2;
      if(height>this.gl.capabilities.maxTextureSize)throw Error('GPU clip mask exceeds texture capacity');
      const data=new Float32Array(width*height*4),half=width*height/2;
      edges.forEach((e,i)=>{data.set([e.a.x,e.a.y,e.b.x,e.b.y],i*4);data[(half+i)*4]=e.end;});
      const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);texture.needsUpdate=true;
      asset={texture,refs:0,uniforms:{barunClipTexture:{value:texture},barunClipTextureSize:{value:new THREE.Vector2(width,height)},barunClipEdges:{value:edges.length},barunClipView:this.clipView,barunClipResolution:this.clipResolution}};
      this.clipAssets.set(key,asset);
    }
    object.userData.barunClipMasks=item.clipMasks;
    object.traverse(child=>{
      if(!child.material)return;
      const materials=Array.isArray(child.material)?child.material:[child.material];
      const clipped=materials.map(original=>{
        const material=original.clone(),before=original.onBeforeCompile,cache=original.customProgramCacheKey();
        // The style manager shares its materials; masking one block must never
        // change another block using the same colour/linetype/text atlas.
        material.userData={...material.userData,barunOwnedMaterial:true};
        this.clipMaterials?.set(material,{asset,baseMaterialId:original.id,baseDefault:original.onBeforeCompile===THREE.Material.prototype.onBeforeCompile});
        asset.refs++;let disposed=false;
        material.addEventListener('dispose',()=>{if(disposed)return;disposed=true;if(--asset.refs===0){asset.texture.dispose();if(this.clipAssets.get(key)===asset)this.clipAssets.delete(key);}});
        if(original.userData.barunOwnedMaterial)original.dispose();
        material.onBeforeCompile=(shader,renderer)=>{
          before?.call(material,shader,renderer);Object.assign(shader.uniforms,asset.uniforms);
          const code=`
uniform sampler2D barunClipTexture;
uniform vec2 barunClipTextureSize;
uniform int barunClipEdges;
uniform vec4 barunClipView;
uniform vec2 barunClipResolution;
vec4 barunClipTexel(float index) {
 return texture2D(barunClipTexture,(vec2(mod(index,barunClipTextureSize.x),floor(index/barunClipTextureSize.x))+0.5)/barunClipTextureSize);
}
bool barunClipVisible() {
 vec2 p=barunClipView.xy+gl_FragCoord.xy/barunClipResolution*barunClipView.zw;
 bool inside=false;bool boundary=false;
 for(int i=0;i<barunClipEdges;i++) {
  vec4 edge=barunClipTexel(float(i));vec2 a=edge.xy;vec2 b=edge.zw;
  vec2 ab=b-a;float len2=dot(ab,ab);
  vec2 nearest=a+ab*clamp(dot(p-a,ab)/max(len2,1e-20),0.0,1.0);
  boundary=boundary||distance(p,nearest)<1e-5;
  if((a.y>p.y)!=(b.y>p.y))if(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  float end=barunClipTexel(float(i)+barunClipTextureSize.x*barunClipTextureSize.y*0.5).r;
  if(end!=0.0) {
   if(!boundary&&((end>0.0&&!inside)||(end<0.0&&inside)))return false;
   inside=false;boundary=false;
  }
 }
 return true;
}
`;
          shader.fragmentShader=code+shader.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/,match=>match+'\nif(!barunClipVisible())discard;\n');
        };
        material.customProgramCacheKey=()=>cache+'|barun-xclip-v1';
        return material;
      });
      child.material=Array.isArray(child.material)?clipped:clipped[0];
    });
  }
  registerSpatial(object,bounds,pixelMargin=2,worldMargin=0) {
    this.batchSceneEpoch=(this.batchSceneEpoch||0)+1;this.transparentBatches?.noteAdded(object);this.opaqueBatches?.noteAdded(object);
    for(const mask of object.userData.barunClipMasks||[])if(!mask.inverted){
      const xs=mask.points.map(p=>p.x),ys=mask.points.map(p=>p.y);
      const clipped={minX:Math.max(bounds.minX,Math.min(...xs)),maxX:Math.min(bounds.maxX,Math.max(...xs)),minY:Math.max(bounds.minY,Math.min(...ys)),maxY:Math.min(bounds.maxY,Math.max(...ys))};
      // A stroke whose centreline misses the mask can still overlap it. Keep
      // its conservative bound and viewport width margins; the shader clips
      // actual fragments. Never hide geometry solely by centreline bounds.
      if(clipped.minX<=clipped.maxX&&clipped.minY<=clipped.maxY)bounds=clipped;
    }
    // Shader-expanded line widths exceed THREE's unexpanded geometry sphere.
    // Our conservative 2D index is authoritative for these drawables.
    object.traverse(child=>{child.frustumCulled=false;});
    // Unknown custom geometry must remain visible rather than poisoning a
    // tree node with NaN/empty bounds and hiding otherwise valid neighbours.
    if(!Object.values(bounds).every(Number.isFinite)||bounds.minX>bounds.maxX||bounds.minY>bounds.maxY)bounds={minX:-Infinity,minY:-Infinity,maxX:Infinity,maxY:Infinity};
    const entry={object,bounds,pixelMargin,worldMargin};this.spatialObjects.set(object,entry);
    if(this.viewportIndex&&!this.spatialDirty)this.viewportIndex.insert(entry);
    this.activeObjects.add(object);
  }
  removeSpatial(object) {
    this.batchSceneEpoch=(this.batchSceneEpoch||0)+1;this.transparentBatches?.noteRemoved(object);this.opaqueBatches?.noteRemoved(object);
    const entry=this.spatialObjects.get(object);
    if(entry&&this.viewportIndex&&!this.spatialDirty)this.viewportIndex.remove(entry);
    this.activeObjects.delete(object);this.spatialObjects.delete(object);
  }
  updateSpatialBounds(object,bounds) {
    // Bounds move only with in-place geometry edits: never patch across them.
    this.batchSceneEpoch=(this.batchSceneEpoch||0)+1;this.transparentBatches?.noteChanged();this.opaqueBatches?.noteChanged();
    const entry=this.spatialObjects.get(object);entry.bounds=bounds;
    if(this.viewportIndex&&!this.spatialDirty)this.viewportIndex.update(entry);
  }
  updateViewport(box,scale) {
    const start=performance.now();
    if(this.spatialDirty){this.viewportIndex=createViewportIndex([...this.spatialObjects.values()]);this.spatialDirty=false;}
    const queryStats={},entries=this.viewportIndex.query(box,scale,queryStats),next=new Set(entries.map(e=>e.object));
    // Detaching avoids THREE walking every hidden leaf on every frame.
    for(const object of this.activeObjects)if(!next.has(object))this.scene.remove(object);
    for(const object of next)if(!this.activeObjects.has(object)){
      this.scene.add(object);
      // A culled root may never have belonged to a rendered frame. Initialize
      // its world matrices when it enters the view; unchanged roots are cached.
      object.updateWorldMatrix(true,true);
    }
    this.activeObjects=next;
    Object.assign(this.stats,{spatialChunks:this.spatialObjects.size,visibleChunks:next.size,culledChunks:this.spatialObjects.size-next.size,cullMs:performance.now()-start,cullVisitedEntries:queryStats.entries||0});
  }
  registerDetail(item,z,detailScale,pointScale) {
    if(item.clipKey)this.clippedSources.add(item.sourceId);
    const lod=hasLod(item);
    if(!item.curve&&!lod&&item.type!=='point')return;
    item.detailId='detail'+(++this.nextDetailId);
    const e=item.curve,p=e?{x:e.center.x-this.shift.x,y:e.center.y-this.shift.y}:item.position;
    // A full containing circle is conservative for partial arcs and rotated
    // ellipses, unlike bounds of their current coarse chord approximation.
    const radius=e?(e.type==='ellipse'?Math.hypot(e.majorAxis.x,e.majorAxis.y)*Math.max(1,Math.abs(e.ratio||0)):Math.abs(e.radius)):0;
    const bounds=lod?(item.lodBounds||gpuPolylineBounds(item.lodPoints)):{minX:p.x-radius,maxX:p.x+radius,minY:p.y-radius,maxY:p.y+radius};
    const builtScale=e||lod?detailScale:pointScale;
    this.details.set(item.detailId,{id:item.detailId,item,z,scale:builtScale,builtScale,initialScale:builtScale,lodComplete:lod&&item.points.length>=lodLength(item),bounds,pixelMargin:3,worldMargin:Math.max(0,item.constantWidth||0)/2});
    this.trackDetailScale(this.details.get(item.detailId),1);
    if(!this.sourceDetails.has(item.sourceId))this.sourceDetails.set(item.sourceId,new Set());this.sourceDetails.get(item.sourceId).add(item.detailId);
    if(this.detailIndex&&!this.detailIndexDirty)this.detailIndex.insert(this.details.get(item.detailId));
  }
  trackDetailScale(detail,delta) {
    this.detailQualityScales??=new Map();this.pointDetailScales??=new Map();this.polylineDetailScales??=new Map();
    const map=detail.item.type==='point'?this.pointDetailScales:this.detailQualityScales;
    const count=(map.get(detail.scale)||0)+delta;if(count>0)map.set(detail.scale,count);else map.delete(detail.scale);
    if(hasLod(detail.item)){const n=(this.polylineDetailScales.get(detail.scale)||0)+delta;if(n>0)this.polylineDetailScales.set(detail.scale,n);else this.polylineDetailScales.delete(detail.scale);}
    // Only curves split finely enough to be coarsened later are counted (ACAD200 115).
    if(detail.item.curve&&detail.builtScale>detail.initialScale){const map=this.curveBuiltScales??=new Map(),n=(map.get(detail.builtScale)||0)+delta;if(n>0)map.set(detail.builtScale,n);else map.delete(detail.builtScale);}
  }
  refreshLineMaterials() {
    this.dashMaterials=new Map();this.widthMaterials=[];
    for(const batch of this.lineBatches.values())for(const o of batch.objects)o.traverse(child=>{if(child.material){if(batch.dash.length)this.dashMaterials.set(child.material,batch.linetypeScale);if(batch.constantWidth)this.widthMaterials.push([child.material,batch.constantWidth]);}});
  }
  refineViewport(box,scale,pixelRatio=1,budgetMs=Infinity) {
    this.qualityPending=false;
    if(!this.details?.size)return;
    const qualityScale=scale*pixelRatio*(this.viewresFactor||1);
    // A plan made for this exact view keeps being worked off across frames;
    // re-querying and re-classifying every candidate per slice cost more than
    // the slice itself on a full-drawing view.
    const plan=this.refinePlan;
    if(plan&&plan.qualityScale===qualityScale&&plan.scale===scale&&plan.box.minX===box.minX&&plan.box.maxX===box.maxX&&plan.box.minY===box.minY&&plan.box.maxY===box.maxY){
      if(plan.units)this.workRefinePlan(plan,budgetMs);else this.classifyRefinePlan(plan,budgetMs);return;
    }
    this.refinePlan=null;
    // If every stored curve already meets this quality, a PAN cannot expose
    // under-detailed geometry. Keep querying after a local zoom while any
    // offscreen curve retains lower quality, so moving into it still refines.
    if(this.detailQualityScales&&this.pointDetailScales&&
      [...this.detailQualityScales.keys()].every(s=>qualityScale<=s)&&
      [...(this.polylineDetailScales?.keys()||[])].every(s=>qualityScale>=s/16)&&
      [...(this.curveBuiltScales?.keys()||[])].every(s=>qualityScale>=s/16)&&
      [...this.pointDetailScales.keys()].every(s=>scale===s)){
      Object.assign(this.stats,{detailVisited:0,detailCandidates:0,refinedCurves:0,detailQuerySkips:(this.stats.detailQuerySkips||0)+1});return;
    }
    if(this.detailIndexDirty){this.detailIndex=createViewportIndex([...this.details.values()]);this.detailIndexDirty=false;}
    const planStart=performance.now(),queryStats={},candidates=this.detailIndex.query(box,scale,queryStats);this.stats.planQueryMs=performance.now()-planStart;
    Object.assign(this.stats,{detailVisited:queryStats.entries||0,detailCandidates:candidates.length,refinedCurves:0,settledDetails:0,planClassifyMs:0});
    // Classification is worked off across frames like the rebuild units: a
    // full-drawing view holds hundreds of thousands of candidates, and
    // classifying them in one frame held each wheel pause for up to a second.
    // ACAD200 124: near the GPU memory budget no detail grows finer (coarsening still runs).
    this.refinePlan={qualityScale,scale,box:{...box},candidates,cursor:0,pending:[],settled:[],units:null,next:0,start:planStart,noFiner:(this.memory?.pressure||0)>=.9};
    this.classifyRefinePlan(this.refinePlan,budgetMs);
  }
  classifyRefinePlan(plan,budgetMs){
    const start=performance.now(),{candidates,pending,settled,qualityScale,scale}=plan;
    // Rebuild only what would actually change on screen: a curve whose segment
    // count grows at this quality, or an LOD polyline that has not yet reached
    // its full vertex set. Everything else just records the quality it meets.
    // Coarsening on zoom-out saves vertices but changes no pixels, so it waits
    // for a large ratio instead of churning every batch on each wheel pause.
    // A bounded frame still classifies a useful slice; an unbounded call finishes.
    const limit=Number.isFinite(budgetMs)?Math.max(budgetMs,12):Infinity;
    while(plan.cursor<candidates.length){
      const d=candidates[plan.cursor++];
      if(hasLod(d.item)){
        if(qualityScale>d.scale&&!d.lodComplete||qualityScale<d.scale/16)pending.push(d);
        else if(qualityScale>d.scale)settled.push(d);
      }else if(d.item.curve){
        if(qualityScale>d.scale){
          const built=gpuCurveSegments(d.item.curve,d.builtScale??d.scale);
          if(gpuCurveSegments(d.item.curve,qualityScale)>built&&!plan.noFiner)pending.push(d);else{d.settledScale=curveSettledScale(d.item.curve,built,qualityScale);settled.push(d);}
        }
        // ACAD200 115: a curve split for a deep zoom gives its vertices back far out.
        else if(needsCoarserCurve(d,qualityScale))pending.push(d);
      }else if(scale!==d.scale)pending.push(d);
      if((plan.cursor&511)===0&&(performance.now()-start>=limit||Number.isFinite(limit)&&regenInterrupt.shouldYield()))break;
    }
    this.stats.planClassifyMs+=performance.now()-start;
    if(plan.cursor<candidates.length){this.qualityPending=true;return;}
    for(const d of settled){this.trackDetailScale(d,-1);d.scale=d.settledScale??qualityScale;d.settledScale=undefined;this.trackDetailScale(d,1);}
    this.stats.settledDetails=settled.length;
    plan.candidates=null;plan.settled=null;
    if(!pending.length){this.refinePlan=null;return;}
    // Details that share a line batch must be rebuilt together, so work is
    // grouped into batch-connected units. Each unit is committed atomically
    // (old records disposed and replacements registered in the same call), and
    // at most budgetMs of units run per frame; the rest continue next frame.
    // Union-find over batches (path halving, union by size) keeps grouping
    // linear; merging detail arrays eagerly was quadratic for large pendings.
    const parent=new Map(),size=new Map();
    const find=b=>{while(parent.get(b)!==b){const up=parent.get(parent.get(b));parent.set(b,up);b=up;}return b;};
    const union=(a,b)=>{a=find(a);b=find(b);if(a===b)return;if(size.get(a)<size.get(b))[a,b]=[b,a];parent.set(b,a);size.set(a,size.get(a)+size.get(b));};
    const loose=[];
    for(const d of pending){
      let first=null;
      for(const batch of this.detailBatches.get(d.id)||[]){if(!parent.has(batch)){parent.set(batch,batch);size.set(batch,1);}if(first)union(first,batch);else first=batch;}
      d.planBatch=first;if(!first)loose.push(d);
    }
    const byRoot=new Map();
    for(const d of pending){
      if(!d.planBatch)continue;const root=find(d.planBatch);d.planBatch=undefined;
      let unit=byRoot.get(root);if(!unit)byRoot.set(root,unit={details:[],batches:new Set()});unit.details.push(d);
    }
    for(const batch of parent.keys())byRoot.get(find(batch))?.batches.add(batch);
    let live=[...byRoot.values()];if(loose.length)live.push({details:loose,batches:new Set()});
    // An unbounded call keeps the original single rebuild, which re-chunks all
    // affected styles together and so restores the initial batch budget.
    if(!Number.isFinite(budgetMs)&&live.length>1)live=[{details:live.flatMap(unit=>unit.details),batches:new Set(live.flatMap(unit=>[...unit.batches]))}];
    // ACAD200 116: a bounded refinement sharpens the units nearest the view centre first.
    else if(live.length>1)live=orderRefineUnits(live,plan.box);
    plan.units=live;plan.next=0;plan.pending=null;plan.start=performance.now();
    this.workRefinePlan(plan,budgetMs);
  }
  workRefinePlan(plan,budgetMs){
    const start=performance.now();let done=0,refined=0,rebuilt=0;
    while(plan.next<plan.units.length){
      if(done&&(performance.now()-start>=budgetMs||Number.isFinite(budgetMs)&&regenInterrupt.inputPending()))break;
      const unit=plan.units[plan.next++];
      // A unit is valid only while every batch it was planned against is still
      // the displayed one; otherwise another path replaced them already.
      if([...unit.batches].some(batch=>this.lineBatches.get(batch.key)!==batch))continue;
      rebuilt+=this.refineUnit(unit.details,plan.qualityScale,plan.scale);refined+=unit.details.length;done++;
    }
    this.qualityPending=plan.next<plan.units.length;
    if(!this.qualityPending){this.refinePlan=null;this.refreshLineMaterials();}
    if(done)this.stats.detailRefinements=(this.stats.detailRefinements||0)+1;
    Object.assign(this.stats,{refinedCurves:refined,refinedBatches:rebuilt,refineUnits:done,refinePendingUnits:plan.units.length-plan.next,refineMs:performance.now()-start});
  }
  refineUnit(pending,qualityScale,scale) {
    const ids=new Set(pending.map(d=>d.id)),affected=new Set(),replacements=new Map(),replacementLengths=new Map();
    // Precompute first: an unsupported curve must not leave a partially
    // updated scene. Only spatial candidates are retessellated on this path.
    for(const d of pending){
      const refined=d.item.curve&&compileGpuScene([d.item.curve],{scale:qualityScale*2,origin:this.shift}).items[0];
      const item=refined?{...d.item,points:refined.points,closed:refined.closed}:hasLod(d.item)?{...d.item,points:simplifyGpuPolyline(d.item.lodPoints,qualityScale*2)}:d.item;
      replacementLengths.set(d.id,item.points?.length||0);
      if(item.type==='point'){
        const p=item.position,r=1/scale;
        this.addSegments(replacements,{...item,lineweight:.5},[{x:p.x-r,y:p.y},{x:p.x+r,y:p.y}],false,d.z,scale);
      }else this.addSegments(replacements,item,item.points,item.closed,d.z,scale);
      for(const batch of this.detailBatches.get(d.id)||[])affected.add(batch);
    }
    for(const batch of affected){
      const keep=batch.records.filter(record=>!ids.has(record.detailId));
      let next=replacements.get(batch.style);
      if(!next)replacements.set(batch.style,next={...batch,records:[],objects:[]});
      next.records.push(...keep);
    }
    for(const batch of affected){this.disposeLineBatch(batch);this.lineBatches.delete(batch.key);}
    for(const [style,batch] of replacements)for(const records of initialGpuChunks(batch.records)){
      const key=style+'|refine'+(++this.deltaSerial),chunk={...batch,key,records,maxWeight:initialGpuChunkWeight(batch.records),objects:[]};
      this.buildLineBatch(chunk);this.lineBatches.set(key,chunk);
    }
    for(const d of pending){this.trackDetailScale(d,-1);d.scale=d.builtScale=d.item.curve||hasLod(d.item)?qualityScale*2:scale;if(d.item.curve)d.scale=curveSettledScale(d.item.curve,gpuCurveSegments(d.item.curve,d.builtScale),d.builtScale);if(hasLod(d.item))d.lodComplete=replacementLengths.get(d.id)>=lodLength(d.item);this.trackDetailScale(d,1);}
    return affected.size;
  }
  translateSources(doc,revision,translations) {
    this.flushBatchSync(Infinity);this.lastEditAt=performance.now();
    const start=performance.now(),batches=new Set(),texts=new Set();
    const shiftBounds=(b,{dx,dy})=>({minX:b.minX+dx,maxX:b.maxX+dx,minY:b.minY+dy,maxY:b.maxY+dy});
    const shiftPoints=(points,{dx,dy})=>{for(let i=0;i<points.length;i+=3){points[i]+=dx;points[i+1]+=dy;}};
    for(const [id,delta] of translations){
      for(const entry of this.textSources.get(id)||[]){
        const e=entry.item.entity;entry.item={...entry.item,entity:{...e,position:{x:e.position.x+delta.dx,y:e.position.y+delta.dy}}};
        entry.bounds=shiftBounds(entry.bounds,delta);this.textViewportIndex?.update(entry);
      }
      for(const batch of this.sourceBatchesOf(id))batches.add(batch);
      for(const text of this.sourceTextMeshes.get(id)||[])texts.add(text);
      for(const object of this.sourceHatches.get(id)||[]){
        object.position.x+=delta.dx;object.position.y+=delta.dy;
        const entry=this.spatialObjects.get(object);this.updateSpatialBounds(object,shiftBounds(entry.bounds,delta));
      }
      for(const detailId of this.sourceDetails.get(id)||[]){
        const d=this.details.get(detailId);if(!d)continue;
        if(hasLod(d.item))d.item={...d.item,lodPoints:d.item.lodPoints.map(p=>({x:p.x+delta.dx,y:p.y+delta.dy})),...(d.item.lodBounds?{lodBounds:{minX:d.item.lodBounds.minX+delta.dx,minY:d.item.lodBounds.minY+delta.dy,maxX:d.item.lodBounds.maxX+delta.dx,maxY:d.item.lodBounds.maxY+delta.dy}}:{})};
        else if(d.item.curve)d.item={...d.item,curve:{...d.item.curve,center:{...d.item.curve.center,x:d.item.curve.center.x+delta.dx,y:d.item.curve.center.y+delta.dy}}};
        else d.item={...d.item,position:{x:d.item.position.x+delta.dx,y:d.item.position.y+delta.dy}};
        d.bounds=shiftBounds(d.bounds,delta);if(this.detailIndex&&!this.detailIndexDirty)this.detailIndex.update(d);
      }
    }
    for(const batch of batches){
      if(batch.template){
        const delta=translations.get(batch.templateSourceId);
        if(delta)for(const object of batch.objects){
          object.position.x+=delta.dx;object.position.y+=delta.dy;
          this.updateSpatialBounds(object,shiftBounds(this.spatialObjects.get(object).bounds,delta));
        }
        continue;
      }
      for(const record of batch.records){const delta=translations.get(record.sourceId);if(delta){shiftPoints(record.points,delta);record.bounds=shiftBounds(record.bounds,delta);}}
      this.disposeLineBatch(batch);this.buildLineBatch(batch);
    }
    for(const text of texts){
      const attribute=text.mesh.geometry.getAttribute('position');
      text.records.forEach((record,index)=>{const delta=translations.get(record.sourceId);if(delta){shiftPoints(record.positions,delta);record.bounds=shiftBounds(record.bounds,delta);attribute.array.set(record.positions,index*18);}});
      attribute.needsUpdate=true;this.updateSpatialBounds(text.mesh,unionBounds(text.records));
    }
    this.refreshLineMaterials();this.doc=doc;this.revision=revision;
    Object.assign(this.stats,{incrementalBuilds:(this.stats.incrementalBuilds||0)+1,translatedSources:translations.size,updatedBatches:batches.size,buildMs:performance.now()-start});
    return true;
  }
  removeSourceDecorations(ids) {
    const texts=new Set(),removedTextEntries=new Set();
    for(const id of ids){
      const pending=this.textSources.get(id);
      if(pending){this.textSourceCount-=pending.length;for(const entry of pending)this.textViewportIndex?.remove(entry);this.textSources.delete(id);this.textViewportCache=null;}
      for(const text of this.sourceTextMeshes.get(id)||[])texts.add(text);
      for(const object of this.sourceHatches.get(id)||[]){this.scene.remove(object);this.removeSpatial(object);object.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.userData?.barunOwnedMaterial)m.dispose();});}
      this.sourceHatches.delete(id);
    }
    for(const text of texts){
      for(const record of text.records)this.sourceTextMeshes.get(record.sourceId)?.delete(text);
      for(const record of text.records)if(ids.has(record.sourceId))removedTextEntries.add(record.textEntryId);
      text.records=text.records.filter(record=>!ids.has(record.sourceId));
      if(!text.records.length){this.scene.remove(text.mesh);this.removeSpatial(text.mesh);text.mesh.geometry.dispose();if(text.mesh.material.userData.barunOwnedMaterial)text.mesh.material.dispose();this.textMeshes=this.textMeshes.filter(x=>x!==text);}
      else{
        text.mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute(text.records.flatMap(r=>r.positions),3));
        if(!text.greek)text.mesh.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(text.records.flatMap(r=>r.uv),2));
        text.mesh.renderOrder=text.records[0].z*1e6;this.updateSpatialBounds(text.mesh,unionBounds(text.records));
        for(const record of text.records)this.sourceTextMeshes.get(record.sourceId).add(text);
      }
    }
    this.textEntryCount-=removedTextEntries.size;
    for(const id of ids)this.sourceTextMeshes.delete(id);
  }
  addHatchItem(item,z) {
    this.renderer.subEntityTraits.color=new AcCmColor().setRGBFromCss(hatchFillColor(item));
    const object=createGpuHatch(this.renderer,item.entity,this.shift,z*1e6);
    if(object.userData.barunEmpty)return;   // unusable boundary: nothing to draw or index
    object.traverse(child=>{if(child.isGroup)child.renderOrder=0;if(child.material){child.material.depthTest=true;child.material.depthWrite=false;child.renderOrder=z*1e6;}});
    object.position.z=z;this.applyClip(object,item);this.scene.add(object);object.updateMatrixWorld(true);
    const b=new THREE.Box3().setFromObject(object);this.registerSpatial(object,{minX:b.min.x,maxX:b.max.x,minY:b.min.y,maxY:b.max.y});
    if(!this.sourceHatches.has(item.sourceId))this.sourceHatches.set(item.sourceId,new Set());this.sourceHatches.get(item.sourceId).add(object);
  }
  // A worker job for this document is already on its way: asking again only
  // polls it, so the (whole-drawing) job need not be rebuilt every frame.
  compileWaiting(doc,revision,kind){const pending=this.compileClient?.pending;return !!pending&&!pending.result&&pending.doc===doc&&pending.revision===revision&&pending.kind===kind;}
  // Why the last edit took the complete build (stats.editReject).
  rejectEdit(reason){this.stats.editReject=reason;this.stats.editRejects=(this.stats.editRejects||0)+1;return false;}
  tryEdit(doc,revision,scale,edit) {
    // Entity reference comparisons are sound ONLY for the engine's proven COW
    // path. A missed revision, mutable import, layer/style edit or block edit
    // falls back to the complete build above.
    if(!edit?.lightweight||doc===this.doc||this.doc!==edit.previousDoc||this.revision!==edit.previousRevision)return false;
    // ACAD200 102: a previous edit still synchronising its batches finishes first.
    this.flushBatchSync(Infinity);
    const previous=this.doc;
    const removed=edit.removed||[],added=edit.added||[];
    const keys=new Set([...Object.keys(previous),...Object.keys(doc)]);
    const ltscaleOnly=previous.linetypeScale!==doc.linetypeScale&&!removed.length&&!added.length;
    for(const key of keys){
      if(key==='entities'||ltscaleOnly&&key==='linetypeScale')continue;
      // A layer change is part of the edit when every kept object whose
      // display reads a changed layer is displayed again by it.
      if(key==='layers'){if(!editCoversLayerChanges(previous,doc,added))return this.rejectEdit('layers');}
      // Block definitions (BLOCK) are not displayed; references carry their own children.
      else if(key!=='blocks'&&previous[key]!==doc[key])return this.rejectEdit('key:'+key);
    }
    // ACAD200 119: only the drawing LTSCALE changed (same objects, nothing added or
    // removed): rescale the dash uniforms instead of rebuilding the scene.
    if(previous.linetypeScale!==doc.linetypeScale&&!removed.length&&!added.length&&!edit.drawOrder)return this.applyLinetypeScale(doc,revision)||this.rejectEdit('key:linetypeScale');
    // ACAD200 120: DRAWORDER front/back of the same objects changes depths only.
    if(edit.drawOrder)return this.applyDrawOrder(doc,revision,edit)||this.rejectEdit('draworder');
    if(added.some(e=>e.type==='text'&&(!Number.isFinite(e.position?.x)||!Number.isFinite(e.position?.y)||!(e.height>0))))return false;
    if(this.entityIds?.entities!==previous.entities)this.entityIds={entities:previous.entities,map:new Map(previous.entities.map(entity=>[entity.id,entity]))};
    const membership=fastGpuEditMembership(previous.entities,doc.entities,removed,added,this.entityIds.map,this)||validateGpuEditMembership(previous.entities,doc.entities,removed,added,this);
    if(!membership)return this.rejectEdit('membership');
    this.stats.fastEditProofs=(this.stats.fastEditProofs||0)+Number(!!membership.fast);
    const {oldOrder,newById,removedIds}=membership,oldById=oldOrder,addedIds=newById;
    // Existing entities must keep painter order; newly appended entities may
    // only follow them. Replacements retain their old source depth.
    // An object displayed again (a layer it reads changed) is recompiled, never translated in place.
    const again=removed.length&&added.length?new Set(added):null;
    const translations=again&&removed.some(e=>again.has(e))?null:detectGpuTranslations(removed,added);
    // A clipped source's mask must move together with its geometry.
    if(translations&&![...translations.keys()].some(id=>this.clippedSources.has(id)||this.managedText&&this.textSources.has(id))){
      const moved=this.translateSources(doc,revision,translations);
      if(moved&&this.entityIds?.entities===previous.entities){for(const [id,entity] of addedIds)this.entityIds.map.set(id,entity);this.entityIds.entities=doc.entities;}
      return moved;
    }
    // ACAD200 103: a colour-only change keeps its geometry records; they move to
    // the batch of the new colour without recompiling the source.
    if(!translations&&removed.length){
      const pairs=colorOnlyPairs(removed,added);
      if(pairs&&this.restyleSources(doc,revision,pairs,scale)){
        if(this.entityIds?.entities===previous.entities){for(const [id,entity] of addedIds)this.entityIds.map.set(id,entity);this.entityIds.entities=doc.entities;}
        return true;
      }
    }
    const newSources=added.filter(e=>!oldById.has(e.id)&&!this.retiredSourceDepths.has(e)).length;
    let appendTop=this.nextTopZ;for(const e of added){const last=this.retiredSourceDepths.get(e)?.at(-1);if(last!==undefined)appendTop=Math.max(appendTop,last);}
    if(appendTop+newSources*1e-5>=2)return false;
    const start=performance.now();
    // Fresh append copies need the same depth slots, but not one throwaway
    // compiled placeholder per retained static primitive. Restorations and
    // non-tail edits retain the original per-item path below.
    const compactCopies=!removed.length&&added.length>0&&added.every((e,i)=>!oldById.has(e.id)&&!this.retiredSourceDepths.has(e)&&doc.entities[doc.entities.length-added.length+i]===e);
    const reused=this.reuseTemplateCopies(doc,removed,added,compactCopies)||this.reuseCompiledCopies(doc,removed,added);
    let job=null;const makeJob=()=>job??={doc:gpuJobDocument(doc,added),scale:Math.max(this.detailScale,scale*(this.renderPixelRatio||1)*2*(this.viewresFactor||1)),origin:this.shift};
    const prepared=!reused&&isHeavyGpuJob(added)?this.compileClient?.request(doc,revision,'edit',this.compileWaiting(doc,revision,'edit')?null:makeJob()):null;
    if(prepared?.pending){this.stats.workerPending=true;return true;}
    const result=reused||prepared?.result||compileGpuJob(makeJob()),{compiled}=result;
    this.compileClient?.consume();
    Object.assign(this.stats,{compileMs:result.compileMs,workerBuilds:(this.stats.workerBuilds||0)+(prepared?.result?1:0)});
    if(compiled.unsupported.length||compiled.items.some(item=>!['polyline','point','text','hatch',...(reused?.templatePlans?['template']:[])].includes(item.type)))return false;
    const primitiveCount=reused?.compactCopies?reused.primitiveCount:compiled.items.length;
    // This edit installs in one frame. Per primitive that costs about three
    // times a complete build, so an edit replacing a large share of the scene
    // (a whole-plan colour/layer change, MOVE of everything) takes the
    // complete build instead: one 11 s frame was measured for 1M primitives.
    const removedPrimitives=removed.reduce((n,e)=>n+(this.sourcePrimitiveDepths.get(e.id)?.length||0),0);
    if(primitiveCount+removedPrimitives>Math.max(GPU_MASS_EDIT_PRIMITIVES,(this.stats.items||0)*.25))return this.rejectEdit('mass');
    const newItems=reused?.compactCopies?primitiveCount:compiled.items.reduce((n,item)=>n+Number(!oldById.has(item.sourceId)&&!this.retiredSourceDepths.has(newById.get(item.sourceId))),0);
    if(appendTop+newItems*1e-5>=2)return false;
    // A formerly hidden source has no retained depth slot. Rebuild to place
    // it at its actual document order rather than incorrectly appending it.
    // A kept object shown again (its layer turned back on) returns to the
    // slots it had when it was hidden through an edit.
    if(compiled.items.some(item=>oldById.has(item.sourceId)&&!this.sourceZ.has(item.sourceId)&&!this.retiredSourceDepths.get(newById.get(item.sourceId))?.length))return this.rejectEdit('hidden');
    // Preserve every primitive's painter-depth slot for composite replacements.
    // A topology change needs a full build; rotation/scale keep these slots.
    const counts=new Map();
    if(reused?.compactCopies)for(const plan of reused.templatePlans)counts.set(plan.entity.id,plan.template.primitiveCount);
    else for(const item of compiled.items)counts.set(item.sourceId,(counts.get(item.sourceId)||0)+1);
    // A replacement with fewer primitives (a block whose children on a hidden
    // layer drop out) takes the leading slots, which keeps its order; the
    // remaining slots stay reserved for the primitives coming back.
    for(const [id,count] of counts){
      const retired=this.retiredSourceDepths.get(newById.get(id));
      if(!removedIds.has(id)){if(retired?.length&&retired.length<count)return this.rejectEdit('restore');continue;}
      const slots=this.sourceZ.has(id)?this.sourcePrimitiveDepths.get(id):retired;
      if(!(slots?.length>=count))return this.rejectEdit('slots');
    }
    const replacementDepths=new Map([...removedIds].map(id=>[id,this.sourcePrimitiveDepths.get(id)]));
    const compactItemDepths=new Map();
    if(reused?.templatePlans){
      let top=appendTop;
      for(const plan of reused.templatePlans){
        if(plan.template.chunks.some(chunk=>chunk.roots.some(root=>typeof root.object.fastDeepClone!=='function')))return false;
        const depths=this.retiredSourceDepths.get(plan.entity)||replacementDepths.get(plan.entity.id)||plan.template.depths.map(()=>top+=1e-5);
        plan.depthTransform=templateDepthTransform(plan.template.depths,depths);
        if(!plan.depthTransform)return false;
        if(reused.compactCopies){plan.depths=depths;for(const {item,ordinal} of plan.dynamicItems)compactItemDepths.set(item,depths[ordinal]);}
      }
    }
    // Only incoming source IDs can read the previous depth below. Avoid a
    // full-drawing Map copy for a one-object edit; preserve every depth check.
    const replacement=new Map(),affected=new Set(),pushed=new Set(),previousZ=new Map([...counts.keys()].map(id=>[id,this.sourceZ.get(id)])),incoming=new Map();
    this.nextTopZ=appendTop;
    const removedItemCount=removed.reduce((n,e)=>n+(this.sourceZ.has(e.id)?this.sourcePrimitiveDepths.get(e.id)?.length||0:0),0),depthOffsets=new Map(),textItems=[];
    // A hidden object (no slots) keeps the slots it was retired with.
    for(const e of removed){const depths=this.sourcePrimitiveDepths.get(e.id);if(depths||!this.retiredSourceDepths.has(e))this.retiredSourceDepths.set(e,depths||[]);this.sourcePrimitiveDepths.delete(e.id);}
    this.removeSourceDecorations(removedIds);
    for(const id of removedIds){for(const detailId of this.sourceDetails.get(id)||[]){const detail=this.details.get(detailId);if(detail){this.trackDetailScale(detail,-1);if(this.detailIndex&&!this.detailIndexDirty)this.detailIndex.remove(detail);}this.details.delete(detailId);}this.sourceDetails.delete(id);}
    for(const id of removedIds)this.sourceZ.delete(id);
    const removedBatches=new Set();for(const id of removedIds)for(const batch of this.sourceBatchesOf(id))removedBatches.add(batch);
    for(const batch of removedBatches){const key=batch.key;affected.add(key);replacement.set(key,{...batch,records:batch.records.filter(record=>!removedIds.has(record.sourceId)),objects:[]});}
    if(reused?.compactCopies)for(const plan of reused.templatePlans){
      this.sourceZ.set(plan.entity.id,plan.depths[0]);this.sourcePrimitiveDepths.set(plan.entity.id,plan.depths);this.nextTopZ=plan.depths.at(-1);
    }
    for(const item of compiled.items){
      let z;
      if(reused?.compactCopies)z=compactItemDepths.get(item);
      else{
      const offset=depthOffsets.get(item.sourceId)||0;depthOffsets.set(item.sourceId,offset+1);
      const restoredDepths=this.retiredSourceDepths.get(newById.get(item.sourceId))||replacementDepths.get(item.sourceId),restored=!!restoredDepths;
      z=restored?restoredDepths[offset]:previousZ.get(item.sourceId);
      if(z===undefined)z=this.nextTopZ+=1e-5;
      if(!offset){this.sourceZ.set(item.sourceId,z);this.sourcePrimitiveDepths.set(item.sourceId,restored?restoredDepths:[z]);}
      else if(!restored)this.sourcePrimitiveDepths.get(item.sourceId).push(z);
      }
      this.registerDetail(item,z,result.scale,scale);
      // Get the style key without mutating an existing batch. Merge retained
      // records only once if the new item shares an unaffected style.
      const temporary=incoming;
      if(item.type==='polyline')this.addSegments(temporary,item,item.points,item.closed,z,scale);
      else if(item.type==='point'){const p=item.position,r=1/scale;this.addSegments(temporary,{...item,lineweight:.5},[{x:p.x-r,y:p.y},{x:p.x+r,y:p.y}],false,z,scale);}
      else if(item.type==='text')textItems.push({item,z,order:z*1e6});
      else if(item.type==='hatch'){
        this.addHatchItem(item,z);
        if(hatchOutline(item))for(const loop of [item.entity.points,...(item.entity.loops||[])])this.addSegments(temporary,item,loop.map(p=>({x:p.x-this.shift.x,y:p.y-this.shift.y})),true,z+1e-7,scale);
      }
    }
    if(reused?.templatePlans)this.installTemplateCopies(reused.templatePlans);
    // Partition all changed primitives together. Per-primitive insertion made
    // a rotated block with thousands of narrow lines turn into thousands of
    // draw calls, even though its geometry fit in a handful of spatial leaves.
    for(const [styleKey,group] of incoming){
      const maxWeight=initialGpuChunkWeight(group.records);
      for(const records of spatialChunks(group.records,maxWeight)){
        const batch={...group,records,maxWeight};
        // Appended geometry has its own small batch; adding a line must not
        // re-upload the hospital drawing's entire shared line style buffer.
        let key=this.appendBatchKeys.get(styleKey);
        let target=key&&(replacement.get(key)||this.lineBatches.get(key));
        const combined=target&&[...target.records,...batch.records];
        const cb=combined&&unionBounds(combined),tb=target&&unionBounds(target.records);
        // Keep repeated local appends together, but do not let a far-away
        // addition turn a small leaf into a drawing-wide bounding box.
        const near=tb&&cb&&(cb.maxX-cb.minX<=Math.max(1,tb.maxX-tb.minX)*2)&&(cb.maxY-cb.minY<=Math.max(1,tb.maxY-tb.minY)*2);
        if(!target||(target.maxWeight||512)!==maxWeight||combined.reduce((n,r)=>n+r.points.length/6,0)>maxWeight||!near){key=styleKey+'|delta'+(++this.deltaSerial);this.appendBatchKeys.set(styleKey,key);target=null;}
        if(!replacement.has(key))replacement.set(key,{...batch,records:[...(target?.records||[])],objects:[]});
        replacement.get(key).records.push(...batch.records);affected.add(key);pushed.add(key);
      }
    }
    this.acceptText(textItems,primitiveCount);
    // ACAD200 105: a batch that only loses records keeps its vertex buffers;
    // the gaps are closed in its index buffer (no re-upload of the vertices).
    for(const key of affected){
      if(pushed.has(key))continue;
      const old=this.lineBatches.get(key);
      if(old&&removedBatches.has(old)&&this.removeBatchRecordsInPlace(old,removedIds))affected.delete(key);
    }
    // ACAD200 102: many batch keys are synchronised visible-first; in an
    // interactive renderer the rest continue over the next frames.
    const deferred=Number.isFinite(this.buildBudgetMs)&&affected.size>=BATCH_SYNC_DEFER_KEYS;
    if(deferred){
      const view=this.lastViewBox,centre=view&&{x:(view.minX+view.maxX)/2,y:(view.minY+view.maxY)/2};
      const queue=new GpuRegenQueue({run:({key,next})=>this.syncBatchKey(key,next)});
      for(const key of affected){const next=replacement.get(key),bounds=next.records.length?unionBounds(next.records):this.lineBatches.get(key)?unionBounds(this.lineBatches.get(key).records):null;queue.enqueue({key,next,distance:bounds&&centre?centreDistance2(bounds,centre):0},regenPriority(bounds,view));}
      this.pendingBatchSync=queue;this.flushBatchSync(this.editSyncBudgetMs??8);
      this.stats.deferredBatchKeys=queue.size;
    }else for(const key of affected)this.syncBatchKey(key,replacement.get(key));
    // Shared shader materials can be referenced by several retained batches.
    // Recollect them instead of deleting a shared material from the set.
    this.refreshLineMaterials();
    for(const id of removedIds)if(!addedIds.has(id))this.sourceZ.delete(id);
    if(this.entityIds?.entities===previous.entities){const map=this.entityIds.map;for(const id of removedIds)map.delete(id);for(const [id,entity] of addedIds)map.set(id,entity);this.entityIds.entities=doc.entities;}
    if(removed.length||added.some(entity=>this.retiredSourceDepths.has(entity))){
      // Reclaim only the unused append tail. Repeated COPY/UNDO must not burn
      // painter-depth space and eventually rebuild the whole drawing. Existing
      // and retired primitive slots never move; the interval guard above rejects
      // an arbitrary restoration whose old slots overlap a newer live source.
      // The live maximum changes only when a removed source held the top slot
      // or a restored one sits above it; otherwise skip the whole-scene scan
      // (it ran on every MOVE/ERASE of a 200k-object drawing).
      let topMoved=false;
      for(const entity of removed){const depths=this.retiredSourceDepths.get(entity);if(!depths||depths.length&&depths.at(-1)>=this.nextTopZ)topMoved=true;}
      for(const entity of added){const last=this.retiredSourceDepths.get(entity)?.at(-1);if(last!==undefined&&last>this.nextTopZ)topMoved=true;}
      if(topMoved){let top=1;for(const depths of this.sourcePrimitiveDepths.values())if(depths.length)top=Math.max(top,depths.at(-1));this.nextTopZ=top;}
    }
    this.doc=doc;this.revision=revision;
    // Composite sources have multiple primitives; count their retained slots.
    this.stats.items=(this.stats.items||0)-removedItemCount+primitiveCount;
    if(reused?.compactCopies)this.stats.compactTemplateCopies=(this.stats.compactTemplateCopies||0)+reused.templatePlans.length;
    if(!reused?.templatePlans)this.rememberCompiledSources(doc,compiled.items,result.scale,false,added);
    if(reused)this.stats.reusedCopySources=(this.stats.reusedCopySources||0)+reused.reusedSources;
    Object.assign(this.stats,{incrementalBuilds:(this.stats.incrementalBuilds||0)+1,buildMs:performance.now()-start,updatedBatches:affected.size});
    this.lastEditAt=performance.now();
    return true;
  }
  // ACAD200 103: colour-only edits. The edited sources' records (their point
  // arrays, depths and dash distances) are reused as they are: they leave the old
  // colour's batches through index gaps (105) and join a delta batch of the new
  // colour. Nothing is recompiled; only those few batches are touched.
  restyleSources(doc,revision,pairs,scale){
    const kinds=new Set(['line','polyline','rectangle','circle','arc','ellipse']),ids=new Set(pairs.keys());
    for(const [id,{after}] of pairs){
      if(!kinds.has(after.type)||after.sharedBlock||after.entities?.length||after.constantWidth>0)return false;
      if(this.textSources.has(id)||this.sourceTextMeshes.get(id)?.size||this.sourceHatches.get(id)?.size||this.clippedSources.has(id)||this.staticTemplateSources.has(id)||!this.sourceZ.has(id))return false;
      const batches=[...this.sourceBatchesOf(id)];
      if(!batches.length||batches.some(b=>b.template||b.alpha||b.clipKey||b.constantWidth))return false;
    }
    const shown=G.visibleEntities(gpuJobDocument(doc,[...pairs.values()].map(p=>p.after)),{inPlace:true,lodScale:0,viewBox:null});
    if(shown.length!==pairs.size||shown.some(e=>!ids.has(e.id)||e.transparency))return false;
    const start=performance.now(),raw=new Map(shown.map(e=>[e.id,e._displayColor??e.color])),incoming=new Map(),touched=new Set();
    const styleKeyOf=(color,b)=>JSON.stringify([color,b.width,b.dash,b.constantWidth]);
    for(const id of ids){
      const color=drawingDisplayColor(raw.get(id));
      for(const batch of this.sourceBatchesOf(id)){
        const oldKey=styleKeyOf(batch.color,batch);if(!batch.style.startsWith(oldKey))return false;
        const style=styleKeyOf(color,batch)+batch.style.slice(oldKey.length);
        let group=incoming.get(style);if(!group)incoming.set(style,group={...batch,style,color,records:[],objects:[]});
        for(const record of batch.records)if(record.sourceId===id)group.records.push(record);
        touched.add(batch);
      }
    }
    // Leave the old colour: index gaps where possible, otherwise rebuild that batch.
    for(const batch of touched)if(!this.removeBatchRecordsInPlace(batch,ids))this.syncBatchKey(batch.key,{...batch,records:batch.records.filter(r=>!ids.has(r.sourceId))});
    for(const [style,group] of incoming){
      const maxWeight=initialGpuChunkWeight(group.records);
      for(const records of spatialChunks(group.records,maxWeight)){
        let key=this.appendBatchKeys.get(style),target=key&&this.lineBatches.get(key);
        const combined=target?[...target.records,...records]:records,tb=target&&unionBounds(target.records),cb=unionBounds(combined);
        const near=tb&&(cb.maxX-cb.minX<=Math.max(1,tb.maxX-tb.minX)*2)&&(cb.maxY-cb.minY<=Math.max(1,tb.maxY-tb.minY)*2);
        if(!target||target.template||(target.maxWeight||512)!==maxWeight||combined.reduce((n,r)=>n+r.points.length/6,0)>maxWeight||!near){key=style+'|delta'+(++this.deltaSerial);this.appendBatchKeys.set(style,key);target=null;}
        this.syncBatchKey(key,{...group,key,records:target?combined:records,maxWeight});
      }
    }
    for(const id of ids)for(const detailId of this.sourceDetails.get(id)||[]){const d=this.details.get(detailId);if(d)d.item={...d.item,color:raw.get(id)};}
    this.refreshLineMaterials();this.doc=doc;this.revision=revision;this.lastEditAt=performance.now();
    Object.assign(this.stats,{incrementalBuilds:(this.stats.incrementalBuilds||0)+1,restyledSources:(this.stats.restyledSources||0)+ids.size,buildMs:performance.now()-start,updatedBatches:touched.size+incoming.size});
    return true;
  }
  // ACAD200 120: DRAWORDER front/back. The proof is one pointer pass; only the
  // moved sources' depths change (record z, vertex z, hatch order, detail z).
  applyDrawOrder(doc,revision,edit){
    const {ids:list,position}=edit.drawOrder||{},previous=this.doc;
    if(!Array.isArray(list)||!list.length||edit.removed?.length||edit.added?.length)return false;
    const ids=new Set(list);
    if(!proveDrawOrderMove(previous.entities,doc.entities,ids,position))return false;
    const ordered=(position==='front'?doc.entities.slice(-ids.size):doc.entities.slice(0,ids.size)).map(e=>e.id),spans=[];
    let primitives=0;
    for(const id of ordered){
      const depths=this.sourcePrimitiveDepths.get(id);if(!depths?.length)continue;
      if(this.textSources.has(id)||this.sourceTextMeshes.get(id)?.size)return false;
      // Solid hatch outlines sit just above their fill (+0.1/total or +1e-7):
      // the span is measured from the records themselves (batch-local scan).
      let last=depths.at(-1);
      for(const batch of this.sourceBatchesOf(id)){if(batch.template)return false;for(const record of batch.records)if(record.sourceId===id)last=Math.max(last,record.points[2]);}
      for(const object of this.sourceHatches.get(id)||[])last=Math.max(last,object.position.z);
      spans.push({id,first:depths[0],last});primitives+=depths.length;
    }
    if(primitives>GPU_MASS_EDIT_PRIMITIVES)return false;
    const plan=drawOrderOffsets(spans,position,{top:this.nextTopZ??1,bottom:this.nextBottomZ??0});
    if(!plan)return false;
    const start=performance.now(),{offsets}=plan,batches=new Set();
    for(const {id} of spans)for(const batch of this.sourceBatchesOf(id))batches.add(batch);
    for(const batch of batches){
      const changed=setRecordDepthInPlace(batch,ids,record=>record.points[2]+offsets.get(record.sourceId));
      if(!changed)return false;   // checked above: only non-template batches reach here
      for(const object of changed)this.noteObjectReplaced(object);
    }
    for(const {id} of spans){
      const offset=offsets.get(id),depths=this.sourcePrimitiveDepths.get(id).map(z=>z+offset);
      this.sourcePrimitiveDepths.set(id,depths);this.sourceZ.set(id,depths[0]);
      for(const object of this.sourceHatches.get(id)||[]){
        object.position.z+=offset;object.traverse(child=>{if(child.material)child.renderOrder=object.position.z*1e6;});
        this.noteObjectReplaced(object);
      }
      for(const detailId of this.sourceDetails.get(id)||[]){const d=this.details.get(detailId);if(d)d.z+=offset;}
    }
    this.nextTopZ=plan.top;this.nextBottomZ=plan.bottom;
    orderIndexCaches.delete(this);
    if(this.entityIds?.entities===previous.entities)this.entityIds.entities=doc.entities;
    this.doc=doc;this.revision=revision;this.lastEditAt=performance.now();this.renderSnapshot=null;
    Object.assign(this.stats,{incrementalBuilds:(this.stats.incrementalBuilds||0)+1,drawOrderSources:spans.length,drawOrderBatches:batches.size,buildMs:performance.now()-start});
    return true;
  }
  applyLinetypeScale(doc,revision){
    const previous=this.doc,k=(Number(doc.linetypeScale)||1)/(Number(previous.linetypeScale)||1);
    if(!(k>0)||!Number.isFinite(k)||previous.entities.length!==doc.entities.length)return false;
    for(let i=0;i<doc.entities.length;i++)if(doc.entities[i]!==previous.entities[i])return false;
    const plans=[];
    for(const batch of this.lineBatches.values()){
      if(!batch.dash?.length)continue;
      if(batch.clipKey)return false;   // clip materials own their dispose bookkeeping
      const plan=dashRescale(batch,k);if(!plan)return false;plans.push([batch,plan]);
    }
    const start=performance.now(),clones=new Map();
    // Shared style-manager materials are never edited: later batches of the old
    // pattern would read the new lengths. Each distinct (material, ratio) gets one clone.
    for(const [batch,{ratio,dash}] of plans){
      for(const object of batch.objects){
        object.traverse(child=>{
          const m=child.material;if(!m?.uniforms?.pattern)return;
          const key=m.id+'|'+ratio;let clone=clones.get(key);
          if(!clone){clone=m.clone();clone.onBeforeCompile=m.onBeforeCompile;clone.customProgramCacheKey=m.customProgramCacheKey;clone.userData={...m.userData,barunOwnedMaterial:true};scalePatternUniforms(clone,ratio);clones.set(key,clone);if(m.userData?.barunOwnedMaterial&&!batch.template)m.dispose();}
          child.material=clone;
        });
        this.noteObjectReplaced(object);
      }
      batch.dash=dash;batch.linetypeScale*=k;
    }
    for(const template of this.sourceTemplates?.values()||[])for(const chunk of template.chunks)if(chunk.dash?.length){const plan=dashRescale(chunk,k);if(plan){chunk.dash=plan.dash;chunk.linetypeScale*=k;}}
    for(const d of this.details.values())if(d.item.linetype)d.item={...d.item,linetypeScale:(Number(d.item.linetypeScale)||1)*k};
    this.compiledSourceCache=new Map();this.refreshLineMaterials();
    this.doc=doc;this.revision=revision;this.renderSnapshot=null;
    Object.assign(this.stats,{incrementalBuilds:(this.stats.incrementalBuilds||0)+1,linetypeScaleRescales:(this.stats.linetypeScaleRescales||0)+1,rescaledDashBatches:plans.length,buildMs:performance.now()-start});
    return true;
  }
  acceptText(entries,total) {
    if(!entries.length){if(!this.managedText)this.addText(entries,this.shift,Infinity,total);return;}
    this.textBoundsMeasure??=this.createCanvas().getContext('2d');
    for(const entry of entries){
      const e=entry.item.entity,lines=String(e.text).split('\n'),font=`115px ${fontFamilyFor(e)}`;
      const key=JSON.stringify([font,e.text]);let width=this.textBoundsWidths.get(key);
      if(width===undefined){this.textBoundsMeasure.font=font;width=Math.max(1,...lines.map(t=>this.textBoundsMeasure.measureText(t).width))/100;this.textBoundsWidths.set(key,width);}
      width*=e.height;const left=e.align==='center'?-width/2:e.align==='right'?-width:0;
      const angle=(e.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),wf=Math.max(.01,e.widthFactor||1);
      const points=[];
      // Use measured glyph width and conservative ascent/descent, including
      // multiline layout. Fixed pixel padding is added by the spatial query.
      for(const x of [left,left+width])for(const y of [-e.height*(.6+(lines.length-1)*1.35),e.height*1.6])points.push(e.position.x-this.shift.x+x*wf*c-y*s,e.position.y-this.shift.y+x*wf*s+y*c,0);
      const record={...entry,bounds:positionBounds(points),pixelMargin:16,worldMargin:0};
      let source=this.textSources.get(entry.item.sourceId);if(!source)this.textSources.set(entry.item.sourceId,source=[]);source.push(record);
      this.textViewportIndex?.insert(record);
    }
    if(entries.length)this.textViewportCache=null;
    this.textSourceCount+=entries.length;this.stats.textSourceCount=this.textSourceCount;
    if(!this.managedText){
      try{this.addText(entries,this.shift,Infinity,total);}
      catch(error){
        if(error.message!=='문자 아틀라스 한도 초과')throw error;
        // Catch the planning limit before it can disable the entire GPU scene.
        // All source entries, including prior edits, remain in the text index.
        this.managedText=true;this.resetTextAtlas();this.textViewportCache=null;
      }
    }
  }
  resetTextAtlas() {
    // Atlas turnover replaces text meshes, not stable hatch geometry. The
    // retired meshes are reported through removeSpatial, so the next sync drops
    // every batch that copied them (and its atlas reference) before drawing.
    this.transparentBatches?.suspend();
    for(const text of this.textMeshes){
      this.scene.remove(text.mesh);this.removeSpatial(text.mesh);text.mesh.geometry.dispose();
      if(text.mesh.material.userData.barunOwnedMaterial)text.mesh.material.dispose();
    }
    for(const texture of this.textures)texture.dispose();
    for(const material of this.ownedMaterials)material.dispose();
    this.textMeshes=[];this.sourceTextMeshes=new Map();this.textAssets=new Map();this.textPages=[];this.textures=[];this.ownedMaterials=[];this.textEntryCount=0;
  }
  updateTextViewport(box,scale,pixelRatio=1,budgetMs=Infinity) {
    this.textPending=false;
    if(!this.managedText)return;
    const qualityScale=2**Math.ceil(Math.log2(Math.max(scale*pixelRatio,1e-12))),greek=this.textGreekPx||0,cache=this.textViewportCache?.greek===greek?this.textViewportCache:null;
    const inside=b=>box.minX>=b.minX&&box.maxX<=b.maxX&&box.minY>=b.minY&&box.maxY<=b.maxY;
    if(cache&&cache.qualityScale===qualityScale&&inside(cache.box)){this.textGeneration=null;return;}
    // Keep painting the generation already started for this view.
    const pending=this.textGeneration;
    if(pending&&pending.qualityScale===qualityScale&&pending.greek===greek&&inside(pending.box)){this.advanceTextGeneration(pending,budgetMs);return;}
    this.textGeneration=null;
    const start=performance.now(),dx=(box.maxX-box.minX)*.25,dy=(box.maxY-box.minY)*.25;
    const buffered={minX:box.minX-dx,maxX:box.maxX+dx,minY:box.minY-dy,maxY:box.maxY+dy};
    if(cache&&cache.qualityScale===qualityScale&&this.textPreparedEntries?.size===this.textSourceCount){this.textViewportCache={qualityScale,box:buffered,greek};return;}
    this.textViewportIndex??=createViewportIndex([...this.textSources.values()].flat());
    const queryStats={},entries=this.textViewportIndex.query(buffered,scale,queryStats).sort((a,b)=>a.z-b.z);
    if(cache&&cache.qualityScale===qualityScale&&entries.every(entry=>this.textPreparedEntries?.has(entry))){this.textViewportCache={qualityScale,box:buffered,greek};return;}
    // Atlas generations own their textures. Retiring just the text generation
    // keeps line/hatch buffers and source draw order, while bounding GPU memory
    // over a long pan session through many distinct labels.
    const gen={entries,qualityScale,greek,box:buffered,shift:this.shift,cursor:0,start,visited:queryStats.entries||0,state:this.textAtlasState([],new Map(),this.nextTextEntryId??0)};gen.state.greekPx=greek;
    this.textGeneration=gen;
    // With nothing on screen yet there is no older generation to keep showing.
    // Labels already on screen keep showing while the new set is planned in
    // budgeted slices (an edit drops the cache but not the atlas: 0.9 s at
    // overview when this ran unbounded). With nothing on screen yet the set is
    // built at once, so a single frame shows the labels of a fresh drawing.
    const showing=!!cache||this.textEntryCount>0;
    this.advanceTextGeneration(gen,showing?budgetMs:Infinity);
  }
  advanceTextGeneration(gen,budgetMs){
    if(!this.stepTextGeneration(gen,budgetMs)){this.textPending=true;return;}
    this.textGeneration=null;const commitStart=performance.now();this.commitTextGeneration(gen);this.stats.textCommitMs=performance.now()-commitStart;
    this.textPreparedEntries=new Set(gen.entries);
    this.textViewportCache={qualityScale:gen.qualityScale,box:gen.box,greek:gen.greek};
    Object.assign(this.stats,{textSourceCount:this.textSourceCount,textViewportCandidates:gen.entries.length,textViewportVisited:gen.visited,textViewportBuilds:(this.stats.textViewportBuilds||0)+1,textViewportMs:performance.now()-gen.start});
  }
  addText(entries,shift,scale,total) {
    this.textEntryCount??=0;this.nextTextEntryId??=0;
    if(!entries.length){Object.assign(this.stats,{textEntries:this.textEntryCount,uniqueTextRasters:this.textAssets?.size||0,textAtlasPages:this.textures.length});return;}
    // Identical labels share their pixels even when their position, rotation or
    // width factor differs. Long labels are tiled, never shrunk or truncated.
    // Plan before allocating any large canvas so the 32-page budget is strict.
    const state=this.textAtlasState(this.textPages??=[],this.textAssets??=new Map(),this.nextTextEntryId);
    for(const entry of entries)this.planTextEntry(state,entry,shift,scale);
    this.nextTextEntryId=state.nextId;
    for(const [p,tiles] of state.pendingTiles){this.paintTextTiles(p,tiles);this.ensureTextPageTexture(p);}
    this.installTextPlacements(state.placements);
    this.textEntryCount+=entries.length-(state.dropped||0);
    Object.assign(this.stats,{textEntries:this.textEntryCount,uniqueTextRasters:state.assets.size,textAtlasPages:this.textures.length,textAtlasTiles:[...state.assets.values()].reduce((n,a)=>n+a.tiles.length,0),textLabelsDropped:state.dropped||0});
  }
  textAtlasState(pages,assets,nextId){
    const size=2048,gutter=4;
    return {size,gutter,core:size-2*gutter,pages,assets,placements:[],pendingTiles:new Map(),measure:this.createCanvas().getContext('2d'),page:pages.at(-1),nextId};
  }
  // Plans one label into an atlas state: one raster per unique font/text/colour,
  // packed as tiles onto pages, plus the quads that place it in the drawing.
  planTextEntry(state,{item,z,order},shift,scale){
    const {size,gutter,core,pages,assets,placements,pendingTiles,measure}=state;
    const newPage=()=>{
      if(pages.length>=32)throw ATLAS_FULL;
      const p={x:0,y:0,row:0,tiles:[]};pages.push(p);return p;
    };
      const textEntryId=++state.nextId;
      const e=item.entity;
      // ACAD200 112: a label smaller than the greeking size becomes a pale box
      // (no raster, no atlas space). Over budget a label is greeked, never dropped.
      if(state.greekPx>0&&e.height*scale<state.greekPx){this.planGreekEntry(state,{item,z,order},shift,textEntryId);return;}
      const h=Math.max(this.managedText?1:16,Math.min(128,e.height*scale)),factor=h/e.height,pad=4;
      const text=String(e.text),font=`${h*1.15}px ${fontFamilyFor(e)}`,color=drawingDisplayColor(item.color);
      const alignKey=e.align==='center'||e.align==='right'?e.align:'left';
      const lineAlign=alignKey!=='left'&&text.includes('\n')?alignKey:'left';
      // A text mask (canvas view.js: backgroundMask) is a background rectangle painted
      // behind the label: same size estimate and padding, in the canvas background colour.
      const masked=!!e.backgroundMask,maskPad=masked?(e.maskPadding??e.height*.25)*factor:0,maskColor=masked?getCanvasPalette(globalThis.document?.documentElement?.dataset?.theme??'dark').background:'';
      const key=JSON.stringify(masked?[font,text,color,alignKey,'mask',Math.round(maskPad*100),maskColor]:lineAlign==='left'?[font,text,color]:[font,text,color,lineAlign]);
      let asset=assets.get(key);
      if(!asset){
        const lines=text.split('\n');measure.font=font;
        const lineWidths=lines.map(t=>measure.measureText(t).width);
        const textW=Math.ceil(Math.max(1,...lineWidths)+pad*2),textH=Math.ceil(h*1.6+Math.max(0,lines.length-1)*h*1.35+pad*2);
        let w=textW,height=textH,ox=0,oy=0,mask=null;
        if(masked){
          // Everything below is in raster pixels relative to the label anchor (x right, y down from the baseline).
          const rawText=textW-pad*2,alignOff=alignKey==='center'?-rawText/2:alignKey==='right'?-rawText:0;
          const maskRaw=Math.round(Math.max(.65,...lines.map(line=>G.textUnits(e,line)))*1e9)/1e9*h,maskLeft=alignKey==='center'?-maskRaw/2:alignKey==='right'?-maskRaw:0;
          const mx0=maskLeft-maskPad,mx1=maskLeft+maskRaw+maskPad,my0=-h*1.15-maskPad,my1=(lines.length-1)*h*1.35+h*.25+maskPad;
          const tx0=alignOff-pad,tx1=tx0+textW,ty0=-(pad+h*1.15),ty1=ty0+textH;
          ox=Math.max(0,Math.ceil(tx0-mx0));oy=Math.max(0,Math.ceil(ty0-my0));
          w=textW+ox+Math.max(0,Math.ceil(mx1-tx1));height=textH+oy+Math.max(0,Math.ceil(my1-ty1));
          mask={color:maskColor,x:mx0-tx0+ox,y:my0-ty0+oy,w:mx1-mx0,h:my1-my0};
        }
        asset={font,color,lines,lineWidths,lineAlign,h,w,height,ox,oy,mask,rawW:textW-pad*2,tiles:[]};assets.set(key,asset);
        const cursor={len:pages.length,page:state.page,x:state.page?.x,y:state.page?.y,row:state.page?.row};
        try{
        for(let top=0;top<height;top+=core)for(let left=0;left<w;left+=core){
          const width=Math.min(core,w-left),heightPart=Math.min(core,height-top),packedW=width+2*gutter,packedH=heightPart+2*gutter;
          state.page??=newPage();
          if(state.page.x+packedW>size){state.page.x=0;state.page.y+=state.page.row;state.page.row=0;}
          if(state.page.y+packedH>size)state.page=newPage();
          const page=state.page,tile={asset,page,left,top,width,height:heightPart,x:page.x,y:page.y,packedW,packedH};
          asset.tiles.push(tile);page.tiles.push(tile);if(!pendingTiles.has(page))pendingTiles.set(page,[]);pendingTiles.get(page).push(tile);
          page.x+=packedW;page.row=Math.max(page.row,packedH);
        }
        }catch(error){
          if(error!==ATLAS_FULL)throw error;
          // The page budget is spent: leave out only this label (and undo its partial tiles).
          assets.delete(key);
          for(const p of pages.splice(cursor.len))pendingTiles.delete(p);
          state.page=cursor.page;if(cursor.page){cursor.page.x=cursor.x;cursor.page.y=cursor.y;cursor.page.row=cursor.row;}
          for(const tile of asset.tiles){tile.page.tiles=tile.page.tiles.filter(t=>t!==tile);const pending=pendingTiles.get(tile.page);if(pending)pendingTiles.set(tile.page,pending.filter(t=>t!==tile));}
          if(this.managedText){this.planGreekEntry(state,{item,z,order},shift,textEntryId);state.greekedOverBudget=(state.greekedOverBudget||0)+1;return;}
          state.dropped=(state.dropped||0)+1;
          return;
        }
      }
      // Canvas aligns every line of a multiline label separately (textAlign at x=0);
      // the bitmap offsets each line inside the widest line's box (see paintTextTiles).
      const rawW=asset.rawW,align=e.align==='center'?-rawW/2:e.align==='right'?-rawW:0;
      const left=(align-pad-asset.ox)/factor,top=(pad+h*1.15+asset.oy)/factor;
      const a=(e.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),wf=Math.max(.01,e.widthFactor||1);
      const point=(u,v)=>[e.position.x-shift.x+u*wf*c-v*s,e.position.y-shift.y+u*wf*s+v*c,z];
      for(const tile of asset.tiles){
        const l=left+tile.left/factor,r=l+tile.width/factor,t=top-tile.top/factor,b=t-tile.height/factor;
        const positions=[point(l,t),point(l,b),point(r,b),point(l,t),point(r,b),point(r,t)].flat();
        const u=(tile.x+gutter)/size,v=1-(tile.y+gutter)/size,U=u+tile.width/size,V=v-tile.height/size;
        placements.push({sourceId:item.sourceId,clipMasks:item.clipMasks,clipKey:item.clipKey,textEntryId,page:tile.page,order,z,positions,bounds:positionBounds(positions),uv:[u,v,u,V,U,V,u,v,U,V,U,v]});
      }
    
  }
  // ACAD200 112: greeked label = measured width x cap height box, rotated like
  // the label. Width comes from the bounds measure acceptText already cached.
  planGreekEntry(state,{item,z,order},shift,textEntryId){
    const e=item.entity,lines=String(e.text).split('\n'),font=`115px ${fontFamilyFor(e)}`;
    const width=(this.textBoundsWidths?.get(JSON.stringify([font,e.text]))??Math.max(1,...lines.map(t=>t.length))*.65)*e.height;
    const left=e.align==='center'?-width/2:e.align==='right'?-width:0,bottom=-(lines.length-1)*1.35*e.height,top=.7*e.height;
    const a=(e.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),wf=Math.max(.01,e.widthFactor||1);
    const point=(u,v)=>[e.position.x-shift.x+u*wf*c-v*s,e.position.y-shift.y+u*wf*s+v*c,z];
    const positions=[point(left,top),point(left,bottom),point(left+width,bottom),point(left,top),point(left+width,bottom),point(left+width,top)].flat();
    (state.greek??=[]).push({sourceId:item.sourceId,clipMasks:item.clipMasks,clipKey:item.clipKey,textEntryId,order,z,color:drawingDisplayColor(item.color),positions,bounds:positionBounds(positions),uv:[]});
    state.greeked=(state.greeked||0)+1;
  }
  installGreekPlacements(records){
    const background=new THREE.Color(getCanvasPalette(globalThis.document?.documentElement?.dataset?.theme??'dark').background),groups=new Map();
    for(const record of records){const key=record.color+'|'+(record.clipKey||'');let list=groups.get(key);if(!list)groups.set(key,list=[]);list.push(record);}
    for(const run of groups.values()){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(run.flatMap(r=>r.positions),3));
      // Opaque 30 % tint of the text colour over the background: no blending, so
      // the retained transparent text batches are never interleaved with it.
      const material=new THREE.MeshBasicMaterial({color:background.clone().lerp(new THREE.Color(run[0].color),.3),depthTest:true,depthWrite:true,side:THREE.DoubleSide});
      material.userData.barunOwnedMaterial=true;
      const mesh=new THREE.Mesh(geometry,material);this.applyClip(mesh,run[0]);
      mesh.renderOrder=run[0].z*1e6;this.scene.add(mesh);this.registerSpatial(mesh,unionBounds(run));
      const textMesh={mesh,records:run,greek:true};(this.textMeshes??=[]).push(textMesh);
      for(const record of run){if(!this.sourceTextMeshes.has(record.sourceId))this.sourceTextMeshes.set(record.sourceId,new Set());this.sourceTextMeshes.get(record.sourceId).add(textMesh);}
    }
  }
  paintTextTiles(p,tiles){
    const size=2048,gutter=4;
    const canvas=p.canvas??this.createCanvas();
    if(!p.canvas){canvas.width=canvas.height=size;p.canvas=canvas;if(p.texture)tiles=p.tiles;}   // released page: its tiles include the new ones
    const ctx=canvas.getContext('2d');
    for(const tile of tiles){
      const a=tile.asset;
      // Paint the whole shaped string behind a tile-sized clip. Gutters hold
      // adjacent pixels, avoiding seams at tile edges under linear sampling.
      ctx.save();ctx.beginPath();ctx.rect(tile.x,tile.y,tile.packedW,tile.packedH);ctx.clip();
      if(a.mask){ctx.fillStyle=a.mask.color;ctx.fillRect(tile.x+gutter-tile.left+a.mask.x,tile.y+gutter-tile.top+a.mask.y,a.mask.w,a.mask.h);}
      ctx.font=a.font;ctx.fillStyle=a.color;ctx.textBaseline='alphabetic';
      const rawW=a.rawW;
      a.lines.forEach((line,i)=>{const lw=a.lineWidths?.[i]??rawW,dx=a.lineAlign==='center'?(rawW-lw)/2:a.lineAlign==='right'?rawW-lw:0;ctx.fillText(line,tile.x+gutter-tile.left+4+a.ox+dx,tile.y+gutter-tile.top+4+a.oy+a.h*1.15+i*a.h*1.35);});
      ctx.restore();
    }
  }
  ensureTextPageTexture(p){
    if(p.texture){p.texture.image=p.canvas;p.texture.needsUpdate=true;return;}
    const texture=new THREE.CanvasTexture(p.canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=true;
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.01,depthTest:true,depthWrite:true,side:THREE.DoubleSide});
    // Glyph quads are planar. Drawing back and front in two transparent
    // passes adds no geometry coverage; keep both viewing directions in one.
    material.forceSinglePass=true;
    p.texture=texture;p.material=material;this.textures.push(texture);this.ownedMaterials.push(material);
  }
  installTextPlacements(placements){
    // Reused textures may recur later in painter order. Never group those
    // noncontiguous placements into one draw before an intervening label.
    let run=[];
    const flush=()=>{
      if(!run.length)return;
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(run.flatMap(r=>r.positions),3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(run.flatMap(r=>r.uv),2));
      const mesh=new THREE.Mesh(geometry,run[0].page.material);this.applyClip(mesh,run[0]);
      mesh.renderOrder=run[0].z*1e6;this.scene.add(mesh);this.registerSpatial(mesh,unionBounds(run));
      const textMesh={mesh,records:run};(this.textMeshes??=[]).push(textMesh);
      this.sourceTextMeshes??=new Map();
      for(const record of run){if(!this.sourceTextMeshes.has(record.sourceId))this.sourceTextMeshes.set(record.sourceId,new Set());this.sourceTextMeshes.get(record.sourceId).add(textMesh);}run=[];
    };
    for(const record of placements){
      if(run.length&&(run.length>=64||run[0].page!==record.page||run[0].order!==record.order||run[0].clipKey!==record.clipKey))flush();
      run.push(record);
    }
    flush();
  }
  // A managed-text atlas generation is planned and painted into its own pages
  // across frames while the previous generation stays on screen. Only the
  // final commit touches the scene, so every drawn frame shows one complete
  // generation.
  stepTextGeneration(gen,budgetMs){
    const start=performance.now(),state=gen.state;
    while(gen.cursor<gen.entries.length){
      this.planTextEntry(state,gen.entries[gen.cursor++],gen.shift,gen.qualityScale);
      if(gen.cursor%16===0||gen.cursor===gen.entries.length){
        for(const [p,tiles] of state.pendingTiles)this.paintTextTiles(p,tiles);state.pendingTiles.clear();
        if(performance.now()-start>=budgetMs)break;
      }
    }
    return gen.cursor>=gen.entries.length;
  }
  commitTextGeneration(gen){
    this.resetTextAtlas();
    const state=gen.state;this.textPages=state.pages;this.textAssets=state.assets;this.nextTextEntryId=state.nextId;
    for(const p of state.pages)this.ensureTextPageTexture(p);
    this.installTextPlacements(state.placements);
    if(state.greek?.length)this.installGreekPlacements(state.greek);
    this.textEntryCount=gen.entries.length-(state.dropped||0);
    Object.assign(this.stats,{textEntries:this.textEntryCount,uniqueTextRasters:state.assets.size,textAtlasPages:this.textures.length,textAtlasTiles:[...state.assets.values()].reduce((n,a)=>n+a.tiles.length,0),textLabelsDropped:state.dropped||0,textGreeked:state.greeked||0,textGreekedOverBudget:state.greekedOverBudget||0});
  }
  // Temporarily collapse only this source's text triangles. Atlas batches may
  // contain other labels: hiding the whole mesh would hide those labels too.
  withoutTextSource(sourceId,draw) {
    const changed=[];
    try{
      if(sourceId!=null)for(const text of this.sourceTextMeshes?.get(sourceId)||[]){
        const attribute=text.mesh.geometry.getAttribute('position');
        text.records.forEach((record,index)=>{
          if(record.sourceId!==sourceId)return;
          const offset=index*18,original=attribute.array.slice(offset,offset+18);
          changed.push({attribute,offset,original});
          for(let i=0;i<18;i+=3)attribute.array.set(original.subarray(0,3),offset+i);
        });
        attribute.needsUpdate=true;
      }
      return draw();
    }finally{
      for(const {attribute,offset,original} of changed){attribute.array.set(original,offset);attribute.needsUpdate=true;}
    }
  }
  render({doc,revision,width,height,scale,origin,pixelRatio=1,edit,hiddenTextId=null,completeDisplay=null,moving=false,lod=null}) {
    const renderStart=performance.now();try{return this.renderFrame({doc,revision,width,height,scale,origin,pixelRatio,edit,hiddenTextId,completeDisplay,moving,lod});}finally{this.stats.renderTotalMs=performance.now()-renderStart;}
  }
  renderFrame({doc,revision,width,height,scale,origin,pixelRatio=1,edit,hiddenTextId=null,completeDisplay=null,moving=false,lod=null}) {
    const frameStart=performance.now();
    if(this.failed)throw new Error(this.failed);
    ({width,height}=alignRasterView({width,height,pixelRatio}));
    this.renderPixelRatio=pixelRatio;
    this.setDocument(doc,revision,scale,edit,completeDisplay);
    if(this.buildTask){this.renderSnapshot=null;return this.canvas;}
    // Cursor/command overlays live on the main canvas. If the applied scene
    // and camera are unchanged, retain these exact pixels instead of querying
    // and submitting thousands of unchanged GPU objects on every mouse move.
    // setDocument runs first so a finished worker edit cannot be hidden by it.
    // While the camera is moving, quality refinement waits; the first still
    // frame at the same camera must therefore not reuse the moving frame.
    const deferQuality=!!moving&&!!this.textViewportCache;
    // ACAD200 109·112·124: the frame's LOD strategy (gpu-lod-policy.js) sets the quality
    // budgets and the text greeking size; GPU memory pressure raises greeking.
    this.textGreekPx=lod?Math.max(0,Number(lod.textGreekPx)||0)*((this.memory?.pressure||0)>=.8?2:1):0;
    const snapshot={doc:this.doc,revision:this.revision,width,height,scale,x:origin.x,y:origin.y,pixelRatio,hiddenTextId,deferQuality,greek:this.textGreekPx};
    if(this.renderSnapshot&&Object.keys(snapshot).every(key=>snapshot[key]===this.renderSnapshot[key])){
      this.stats.reusedFrames=(this.stats.reusedFrames||0)+1;return this.canvas;
    }
    this.opaqueBatches?.suspend();this.transparentBatches?.suspend();
    if(this.width!==width||this.height!==height||this.dpr!==pixelRatio){this.gl.setPixelRatio(pixelRatio);this.renderer.setSize(width,height);this.width=width;this.height=height;this.dpr=pixelRatio;}
    const s=this.shift,c=this.camera;
    c.left=-origin.x/scale-s.x;c.right=(width-origin.x)/scale-s.x;c.top=origin.y/scale-s.y;c.bottom=(origin.y-height)/scale-s.y;c.updateProjectionMatrix();
    const viewBox={minX:c.left,maxX:c.right,minY:c.bottom,maxY:c.top};this.lastViewBox=viewBox;
    // View motion is a camera change only. Rebuilding text rasters, curve
    // tessellation and LOD polylines would invalidate every batch registry and
    // stall the input thread for hundreds of milliseconds per wheel step; the
    // retained geometry is displayed until the view comes to rest.
    const stage={pre:performance.now()-frameStart},mark=(name,t)=>{stage[name]=performance.now()-t;};let t0=performance.now();
    // ACAD200 102: an edit still synchronising batches continues first; refinement
    // (which rebuilds batches too) waits until it has finished.
    const syncing=!this.flushBatchSync(this.editSyncBudgetMs??8);if(syncing)this.stats.batchSyncFrames=(this.stats.batchSyncFrames||0)+1;
    const textBudget=lod?.textMs>0?lod.textMs:this.textBudgetMs??8,refineBudget=lod?.refineMs>0?lod.refineMs:this.refineBudgetMs??8;
    if(deferQuality)this.stats.deferredQualityFrames=(this.stats.deferredQualityFrames||0)+1;
    else{this.updateTextViewport(viewBox,scale,pixelRatio,textBudget);mark('text',t0);t0=performance.now();if(syncing)this.qualityPending=true;else this.refineViewport(viewBox,scale,pixelRatio,refineBudget);mark('refine',t0);}
    // ACAD200 104: idle frames compact batches left with index gaps.
    if(!moving&&!syncing&&!this.refinePlan&&this.wastedBatches?.size&&this.consolidateIdle(4))this.qualityPending=true;
    // ACAD200 107: then the cull index is rebuilt by query cost (SAH) in idle slices.
    else if(!moving&&!syncing&&!this.refinePlan&&!this.qualityPending&&!this.textPending)this.scheduleCullIndexImprovement();
    t0=performance.now();this.updateViewport(viewBox,scale);mark('cull',t0);t0=performance.now();
    this.renderer.syncCameraZoom(scale);
    for(const [m,linetypeScale] of this.dashMaterials)m.uniforms.u_viewportScale.value=dashWorldPerPattern(scale,linetypeScale);
    for(const [m,w] of this.widthMaterials){m.linewidth=Math.max(.5,w*scale);m.resolution?.set(width,height);}
    // The public wrapper resets zoom to camera.zoom. Our orthographic extents
    // already encode scale, so render after explicitly syncing shader zoom.
    if(this.clipAssets?.size){this.clipView.value.set(c.left,c.bottom,c.right-c.left,c.top-c.bottom);this.gl.getDrawingBufferSize(this.clipResolution.value);}
    // Small visible cohorts already submit cheaply. Avoid registry work while
    // editing a zoomed-in detail of an otherwise large drawing.
    if(this.transparentBatches&&hiddenTextId==null&&this.activeObjects.size>=512)this.transparentBatches.sync({retainedToken:[this.doc,this.revision,this.batchSceneEpoch,this.stats.textViewportBuilds,this.stats.detailRefinements],patchable:true,proofBudgetMs:this.proofBudgetMs??16});
    if(this.transparentBatches)Object.assign(this.stats,{transparentBatchActive:this.transparentBatches.stats.active,transparentBatchFastFrames:this.transparentBatches.stats.fastFrames||0,transparentBatchBuilds:this.transparentBatches.stats.builds,transparentBatchReused:this.transparentBatches.stats.reused,transparentBatchVertices:this.transparentBatches.stats.verticesUploaded,transparentBatchSaved:this.transparentBatches.stats.savedSubmissions,transparentBatchReason:this.transparentBatches.stats.reason});
    mark('transparent',t0);t0=performance.now();
    if(this.opaqueBatches&&this.activeObjects.size>=512)this.opaqueBatches.sync({retainedToken:[this.doc,this.revision,this.batchSceneEpoch,this.stats.detailRefinements],patchable:true,buildBudgetMs:this.batchBuildBudgetMs??12});
    if(this.opaqueBatches)Object.assign(this.stats,{opaqueBatchActive:this.opaqueBatches.stats.active,opaqueBatchBuilds:this.opaqueBatches.stats.builds,opaqueBatchFastFrames:this.opaqueBatches.stats.fastFrames,opaqueBatchSaved:this.opaqueBatches.stats.savedSubmissions,opaqueBatchReason:this.opaqueBatches.stats.reason});
    mark('opaque',t0);
    const start=performance.now();
    const draw=()=>this.withoutTextSource(hiddenTextId,()=>this.sceneMatrices.render(this.gl,this.scene,this.camera,[this.doc,this.revision,this.batchSceneEpoch,this.stats.textViewportBuilds,this.stats.detailRefinements,this.transparentBatches?.stats.builds,this.opaqueBatches?.stats.builds]));
    const debug=this.gl.debug,previousShaderError=debug?.onShaderError,previousShaderCheck=debug?.checkShaderErrors;
    const opaqueActive=this.opaqueBatches?.stats.active,validateOpaque=opaqueActive&&this.opaqueBatches.stats.pendingValidation>0;
    let opaqueShaderFailed=false;
    const restoreShaderDebug=()=>{if(opaqueActive&&debug){debug.onShaderError=previousShaderError;debug.checkShaderErrors=previousShaderCheck;}};
    // Let THREE finish unwinding its render stacks before retrying originals.
    if(opaqueActive&&debug){debug.checkShaderErrors=true;debug.onShaderError=()=>{opaqueShaderFailed=true;};}
    try{
      draw();
      if(opaqueShaderFailed)throw Error('GPU opaque shader compilation failed');
      if(validateOpaque){const context=this.gl.getContext(),error=context.getError();if(error!==context.NO_ERROR)throw Error('GPU opaque draw error '+error);this.opaqueBatches.validateActive();}
    }catch(error){
      if(!this.opaqueBatches?.stats.active)throw error;
      this.opaqueBatches.clear();this.opaqueBatches.enabled=false;this.opaqueBatches.stats.reason=error.message;
      restoreShaderDebug();this.sceneMatrices.clear();this.stats.opaqueBatchReason=error.message;this.stats.opaqueBatchActive=false;draw();
    }finally{restoreShaderDebug();}
    mark('draw',start);this.stats.stageMs=stage;
    this.retainPrograms();
    Object.assign(this.stats,{sceneMatrixRefreshes:this.sceneMatrices.refreshes,sceneMatrixReuses:this.sceneMatrices.reuses});
    this.stats.fullFrames=(this.stats.fullFrames||0)+1;this.stats.drawCalls=this.gl.info.render.calls;
    // Unfinished refinement must not let the next still frame reuse this one.
    const qualityWork=(this.qualityPending||this.textPending)&&!deferQuality;
    this.renderSnapshot=qualityWork?null:snapshot;
    if(qualityWork&&!this.qualityFrameRequested){this.qualityFrameRequested=true;setTimeout(()=>{this.qualityFrameRequested=false;this.onChange();},0);}
    Object.assign(this.stats,{frames:this.stats.frames+1,renderMs:performance.now()-start,appliedRevision:this.revision,gpuLineBytes:this.memory?.bytes||0,gpuMemoryPressure:this.memory?.pressure||0,lodStrategy:lod?.name||null,textGreekPx:this.textGreekPx});
    return this.canvas;
  }
  // THREE deletes a GPU program as soon as its last material is disposed, and
  // relinks it synchronously (getProgramInfoLog) when a rebuilt batch asks for
  // the same key. Program keys are a small fixed set here, so keep each linked
  // program for the renderer's lifetime; gl.dispose() still releases them all.
  //
  // Only programs whose cache key fully determines their code may be kept: a
  // material whose onBeforeCompile closure injects per-material code under
  // THREE's default key (the function's source text) would otherwise be handed
  // another material's program. Churn used to hide that; keep just the default
  // materials, our clip variant and our own batch materials, whose keys we own.
  retainPrograms(){
    const programs=this.gl.info?.programs;if(!programs)return;
    for(const program of programs)if(!program.barunRetained&&retainableProgramKey(program.cacheKey)){program.barunRetained=true;program.usedTimes++;}
    this.stats.gpuPrograms=programs.length;
  }
  // A hidden or parked scene keeps its geometry, text atlas and programs but not
  // the window-sized drawing buffer (antialias + preserveDrawingBuffer: about
  // 0.3 GB of GPU memory at 4K) nor the 2D staging canvases of uploaded atlas
  // pages (about 57 MB each in the GPU process, 2026-10-13). The next render()
  // resizes the buffer; a released page is repainted from its tiles only if a
  // later label joins it (paintTextTiles).
  releaseSurface(){
    for(const p of this.textPages||[])if(p.canvas&&p.texture&&this.gl.properties.get(p.texture).__version===p.texture.version){p.canvas.width=p.canvas.height=0;p.canvas=null;}
    if(!this.width)return;this.gl.setPixelRatio(1);this.gl.setSize(1,1,false);this.width=this.height=this.dpr=0;this.renderSnapshot=null;
  }
  dispose(){this.clearScene();this.compileClient?.dispose();this.renderer.dispose();this.gl.dispose();}
}
