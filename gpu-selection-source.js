import {shareWholeSourceBatch} from './gpu-selection-shared.js';
import {templateBatchMatrix} from './gpu-selection-transform.js';
// Isolated prototype. Never owns shared source geometry or atlas textures.
import {THREE,AcCmColor} from './vendor/mlightcad.js';
import {splitDashRecords} from './gpu-selection-dashes.js';
import {gpuRecordUploads} from './gpu-record-upload.js';
import {drawingDisplayColor} from './view.js';
export function createSourceSelection(r,id,scale,reuse=true){
 const start=performance.now(),scene=new THREE.Scene(),geometry=new Set(),materials=new Set(),borrowed=new Set();
 const counts={records:0,segments:0,detailRecords:0,dashedRecords:0,clippedBatches:0,hatches:0,textRecords:0,points:0};
 const pointDetails=new Map();
 for(const detailId of r.sourceDetails.get(id)||[]){const detail=r.details.get(detailId);if(detail?.item.type==='point')pointDetails.set(detailId,detail);}
 const phases=counts.preparePhases={filter:0,dash:0,pack:0,geometry:0,decorate:0,hatch:0,text:0};
 const measured=(key,fn)=>{const t=performance.now();try{return fn();}finally{phases[key]+=performance.now()-t;}};
 const applyOwnedClip=(object,item)=>{try{r.applyClip(object,item);}finally{object.traverse(child=>{for(const m of Array.isArray(child.material)?child.material:child.material?[child.material]:[])materials.add(m);});}};
 function* uploads(records){const iterator=gpuRecordUploads(records,false);while(true){const next=measured('pack',()=>iterator.next());if(next.done)return;yield next.value;}}
 const cloneMaterial=m=>{const c=m.clone();if(c.fragmentShader?.includes('offsetX = samplePos.y * offset.x / offset.y;')){c.fragmentShader=c.fragmentShader.replace('offsetX = samplePos.y * offset.x / offset.y;','offsetX = floor(samplePos.y / offset.y + 0.5) * offset.x;');counts.hatchPhaseMaterials=(counts.hatchPhaseMaterials||0)+1;}c.onBeforeCompile=m.onBeforeCompile;c.customProgramCacheKey=m.customProgramCacheKey;materials.add(c);return c;};
 const cloneDrawable=node=>{
  // CAD area subclasses require constructor arguments; clone only the retained
  // THREE draw tree instead of calling those source constructors again.
  const copy=node.isMesh?new THREE.Mesh():node.isLineSegments?new THREE.LineSegments():node.isLine?new THREE.Line():node.isPoints?new THREE.Points():new THREE.Group();
  copy.copy(node,false);copy.frustumCulled=false;copy.onBeforeRender=node.onBeforeRender;
  if(node.material)copy.material=Array.isArray(node.material)?node.material.map(cloneMaterial):cloneMaterial(node.material);
  for(const child of node.children)copy.add(cloneDrawable(child));return copy;
 };
 const force=r.renderer.forceShowLineWeight;
 const dispose=()=>{for(const g of borrowed){g.deleteAttribute('instanceStart');g.deleteAttribute('instanceEnd');}for(const g of geometry)g.dispose();for(const m of materials)m.dispose();scene.clear();};
 r.transparentBatches?.suspend();r.opaqueBatches?.suspend();
 try{
  r.renderer.forceShowLineWeight=true;
  for(const batch of r.sourceBatchesOf?.(id)??r.sourceBatches.get(id)??[]){
   const records=measured('filter',()=>batch.records.filter(x=>x.sourceId===id&&!pointDetails.has(x.detailId)));if(!records.length)continue;
   counts.records+=records.length;counts.detailRecords+=records.filter(x=>x.detailId).length;
   if(batch.dash.length)counts.dashedRecords+=records.length;if(batch.clipKey)counts.clippedBatches++;
   const width=batch.constantWidth?Math.max(.5,batch.constantWidth*scale):2.3;
   if(reuse&&!batch.records.some(x=>pointDetails.has(x.detailId))&&measured('geometry',()=>shareWholeSourceBatch(r,batch,id,width,scene,geometry,materials,borrowed))){counts.sharedBatches=(counts.sharedBatches||0)+1;counts.segments+=records.reduce((n,x)=>n+x.points.length/6,0);continue;}
   // Template records keep source-local coordinates after COPY/MOVE. Preserve
   // the same world transform when rebuilding their selection geometry.
   if(batch.template)for(const root of batch.objects)root.updateWorldMatrix(true,false);
   const templateMatrix=templateBatchMatrix(batch);
   for(const {values,distances}of uploads(batch.dash.length?measured('dash',()=>splitDashRecords(records,batch.dash,scale)):records)){
    counts.segments+=values.length/6;
    r.renderer.subEntityTraits.color=new AcCmColor().setRGBFromCss(batch.color);
    r.renderer.subEntityTraits.lineWeight=width*40;r.renderer.subEntityTraits.drawOrder=0;
    r.renderer.subEntityTraits.lineType={name:JSON.stringify(batch.dash),type:'Standard',pattern:[]};
    const o=measured('geometry',()=>r.renderer.lineSegments(new Float32Array(values),3,Uint16Array.from({length:values.length/3},(_,i)=>i)));
    const decorateStarted=performance.now();
    o.traverse(c=>{c.frustumCulled=false;if(c.geometry){geometry.add(c.geometry);if(distances){const a=c.geometry.getAttribute('lineDistance');if(a)c.geometry.setAttribute('lineDistance',new THREE.Float32BufferAttribute(distances,1));const b=c.geometry.getAttribute('instanceDistanceStart'),e=c.geometry.getAttribute('instanceDistanceEnd');if(b&&e){for(let j=0;j<b.count;j++){b.setX(j,distances[2*j]);e.setX(j,distances[2*j+1]);}b.needsUpdate=e.needsUpdate=true;}}}if(c.material){c.material=cloneMaterial(c.material);c.material.depthTest=c.material.depthWrite=true;if(c.material.isLineMaterial){c.material.linewidth=width;c.material.resolution.set(r.width,r.height);}}});
    if(templateMatrix){o.matrixAutoUpdate=false;o.matrix.fromArray(templateMatrix);}
    applyOwnedClip(o,batch);scene.add(o);phases.decorate+=performance.now()-decorateStarted;
   }
  }
  for(const {item,z} of pointDetails.values()){
   const g=new THREE.PlaneGeometry(2/scale,2/scale);geometry.add(g);
   const m=new THREE.MeshBasicMaterial({color:drawingDisplayColor(item.color),depthTest:true,depthWrite:true});materials.add(m);
   const o=new THREE.Mesh(g,m);o.position.set(item.position.x,item.position.y,z);o.frustumCulled=false;
   applyOwnedClip(o,item);scene.add(o);counts.points++;
  }
  for(const source of r.sourceHatches.get(id)||[]){
   const o=measured('hatch',()=>cloneDrawable(source));o.visible=true;scene.add(o);counts.hatches++;
  }
  for(const entry of r.sourceTextMeshes.get(id)||[]){
   const records=entry.records.filter(x=>x.sourceId===id);if(!records.length)continue;
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(records.flatMap(x=>x.positions),3));if(!entry.greek)g.setAttribute('uv',new THREE.Float32BufferAttribute(records.flatMap(x=>x.uv),2));geometry.add(g);
   // ACAD200 112: a greeked label (pale box, no atlas page) keeps its box material.
   const o=new THREE.Mesh(g,cloneMaterial(entry.greek?entry.mesh.material:records[0].page.material));o.renderOrder=records[0].z*1e6;o.frustumCulled=false;applyOwnedClip(o,records[0]);scene.add(o);counts.textRecords+=records.length;
  }
 }catch(error){dispose();throw error;}finally{r.renderer.forceShowLineWeight=force;}
 scene.updateMatrixWorld(true);
 return {scene,counts,prepareMs:performance.now()-start,dispose};
}
