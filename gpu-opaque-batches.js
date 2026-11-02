// Retained opaque submissions. Source objects remain authoritative for edits.
import {THREE} from './vendor/mlightcad.js';
import {buildPatternParameterTable} from './gpu-pattern-parameters.js';

const defaultCompile=THREE.Material.prototype.onBeforeCompile;
const fields=['side','depthTest','depthWrite','depthFunc','blending','blendSrc','blendDst','blendEquation','blendSrcAlpha','blendDstAlpha','blendEquationAlpha','premultipliedAlpha','alphaHash','alphaToCoverage','colorWrite','polygonOffset','polygonOffsetFactor','polygonOffsetUnits','stencilWrite','stencilWriteMask','stencilFunc','stencilRef','stencilFuncMask','stencilFail','stencilZFail','stencilZPass','toneMapped','fog','dithering','wireframe','clipping','precision','glslVersion','lights','forceSinglePass'];
const equal=(a,b)=>a?.length===b?.length&&a.every((v,i)=>v===b[i]);
const exact=v=>{
 if(v==null||typeof v==='boolean'||typeof v==='string')return v;
 if(typeof v==='number'){if(!Number.isFinite(v))throw Error('nonfinite opaque uniform');return v;}
 if(v.isColor)return ['color',v.r,v.g,v.b];
 if(Array.isArray(v)||ArrayBuffer.isView(v))return Array.from(v,exact);
 if(v.isVector2||v.isVector3||v.isVector4)return ['vector',...v.toArray()];
 if(Object.getPrototypeOf(v)===Object.prototype)return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,exact(x)]));
 throw Error('unsupported opaque uniform');
};
const attributeStamp=a=>a?[a,a.array,a.version,a.count,a.itemSize]:[null];
const sort=(a,b)=>a.groupOrder-b.groupOrder||a.renderOrder-b.renderOrder||a.material.id-b.material.id||a.z-b.z||a.object.id-b.object.id;

function candidate(item,cad,ordinal){
 const o=item.object,m=item.material,g=item.geometry,p=g?.attributes.position,n=g?.index?.count??p?.count;
 const kind=o.isLineSegments&&m.isLineBasicMaterial?'line':o.isMesh&&m.isShaderMaterial&&['u_patternLines','u_patternAngle','u_color','u_cameraZoom'].every(k=>m.uniforms?.[k])?'pattern':null;
 const clip=cad.clipMaterials?.get(m);
 if(!kind||o.children.length||o.isInstancedMesh||o.isSkinnedMesh||o.isBatchedMesh||m.vertexColors||m.map||m.clippingPlanes?.length||m.onBeforeCompile!==defaultCompile&&!clip?.baseDefault)return null;
 for(let node=o;node;node=node.parent)if(node.userData?.barunClipMasks?.length&&!clip)return null;
 if(o.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender||o.onAfterRender!==THREE.Object3D.prototype.onAfterRender)return null;
 if(!p||p.itemSize!==3||p.normalized||p.isInterleavedBufferAttribute||!(p.array instanceof Float32Array)||Object.keys(g.attributes).length!==1||Object.keys(g.morphAttributes).length||g.groups.length||!n||n%(kind==='line'?2:3)||g.drawRange.start!==0||(g.drawRange.count!==Infinity&&g.drawRange.count!==n))return null;
 if(kind==='pattern'){
  const a=o.matrixWorld.elements;
  if([0,1,2,3,4,5,6,7,8,9,10,11,15].some(j=>a[j]!==([0,5,10,15].includes(j)?1:0)))return null;
  if(!m.vertexShader.includes('#include <project_vertex>')||Object.values(m.uniforms).some(u=>u.value?.isTexture))return null;
 }
 const clipKey=clip?.asset.texture.id??null;
 const key=kind==='line'?JSON.stringify(['line',clip?.baseMaterialId??m.id,clipKey,m.linewidth,m.color.r,m.color.g,m.color.b,m.opacity,fields.map(k=>m[k])]):
  JSON.stringify(['pattern',clipKey,m.vertexShader,m.fragmentShader,m.defines,m.extensions,fields.map(k=>m[k]),Object.entries(m.uniforms).filter(([k])=>!['u_color','u_patternAngle','u_patternLines'].includes(k)).map(([k,u])=>[k,exact(u.value)])]);
 return {item,object:o,material:m,geometry:g,kind,key,ordinal,active:false,clip,
  fingerprint:[g,...attributeStamp(p),...attributeStamp(g.index),m,m.version,key,kind==='pattern'?JSON.stringify(Object.entries(m.uniforms).filter(([k])=>k!=='u_cameraZoom').map(([k,u])=>[k,exact(u.value)])):null]};
}

function estimateBytes(records){
 const vertices=records.reduce((n,r)=>n+r.geometry.attributes.position.count,0),indices=records.reduce((n,r)=>n+(r.geometry.index?.count??r.geometry.attributes.position.count),0),m=records[0].material;
 const table=records[0].kind==='pattern'?Math.ceil((4+m.uniforms.u_patternLines.value.length*(6+m.defines.MAX_PATTERN_SEGMENT_COUNT))/4)*4*records.length*4:0;
 // CPU and GPU positions/slots, CPU base+active indices and GPU indices,
 // matrix+parameter tables on both sides. Covers old+new batches at rebuild.
 return vertices*32+indices*12+records.length*128+table*2;
}
function build(records,maxTextureSize){
 const vertices=records.reduce((n,r)=>n+r.geometry.attributes.position.count,0),count=records.reduce((n,r)=>n+(r.geometry.index?.count??r.geometry.attributes.position.count),0);
 const positions=new Float32Array(vertices*3),slots=new Float32Array(vertices),baseIndices=new Uint32Array(count),ranges=[];
 let v=0,k=0;
 records.forEach((r,slot)=>{const p=r.geometry.attributes.position,ix=r.geometry.index,start=k;positions.set(p.array,v*3);slots.fill(slot,v,v+p.count);
  for(let j=0;j<(ix?.count??p.count);j++)baseIndices[k++]=v+(ix?ix.getX(j):j);
  ranges.push({start,count:k-start});v+=p.count;
 });
 let geometry,material,matrices,parameters;
 try{
  geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('cadLineSlot',new THREE.BufferAttribute(slots,1));geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(count),1).setUsage(THREE.DynamicDrawUsage));
  const data=new Float32Array(records.length*16);matrices=new THREE.DataTexture(data,4,records.length,THREE.RGBAFormat,THREE.FloatType);matrices.magFilter=THREE.NearestFilter;matrices.minFilter=THREE.NearestFilter;matrices.generateMipmaps=false;
  // Row counts reach the shader only through uniforms. Keeping them out of the
  // program key lets rebuilt batches of any size share one linked program.
  const first=records[0];parameters=first.kind==='pattern'?buildPatternParameterTable(records):null;
  if(parameters){if(parameters.width>maxTextureSize)throw Error('opaque parameter texture capacity');parameters.install({uniforms:{},vertexShader:'attribute float cadLineSlot;\n'+first.material.vertexShader,fragmentShader:first.material.fragmentShader});}
  material=first.material.clone();const programKey=`cad-retained-opaque-v2:${first.kind}:${parameters?parameters.width:0}:${!!first.clip}:${first.material.customProgramCacheKey()}`;material.customProgramCacheKey=()=>programKey;
  material.onBeforeCompile=(shader,renderer)=>{
   first.material.onBeforeCompile.call(material,shader,renderer);
   shader.uniforms.cadLineMatrices={value:matrices};shader.uniforms.cadLineRows={value:records.length};
   shader.vertexShader=`attribute float cadLineSlot;uniform sampler2D cadLineMatrices;uniform float cadLineRows;\n${shader.vertexShader}`;
   parameters?.install(shader);
   if(!shader.vertexShader.includes('#include <project_vertex>'))throw Error('opaque projection shader changed');
   shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`float row=(cadLineSlot+0.5)/cadLineRows;
    mat4 originalModelView=mat4(texture2D(cadLineMatrices,vec2(0.125,row)),texture2D(cadLineMatrices,vec2(0.375,row)),texture2D(cadLineMatrices,vec2(0.625,row)),texture2D(cadLineMatrices,vec2(0.875,row)));
    vec4 mvPosition=originalModelView*vec4(transformed,1.0);gl_Position=projectionMatrix*mvPosition;`);
  };
  const mesh=first.kind==='line'?new THREE.LineSegments(geometry,material):new THREE.Mesh(geometry,material),mv=new THREE.Matrix4();mesh.frustumCulled=false;
  const batch={mesh,records,vertices,bytes:estimateBytes(records),baseIndices,ranges,activeState:null,geometry,material,matrices,parameters,data,disposed:false,validated:false,programKey};
  mesh.onBeforeRender=(_renderer,_scene,camera)=>{
   if(first.kind==='pattern')material.uniforms.u_cameraZoom.value=first.material.uniforms.u_cameraZoom.value;
   else material.linewidth=first.material.linewidth;
   batch.records.forEach((r,i)=>{if(r.active){mv.multiplyMatrices(camera.matrixWorldInverse,r.object.matrixWorld);data.set(mv.elements,i*16);}});matrices.needsUpdate=true;
  };
  return batch;
 }catch(error){geometry?.dispose();material?.dispose();matrices?.dispose();parameters?.texture.dispose();throw error;}
}
function dispose(b){
 if(b.disposed)return;b.disposed=true;b.mesh.removeFromParent();b.geometry.dispose();b.material.dispose();b.matrices.dispose();b.parameters?.texture.dispose();
 // dispose releases GL allocations, but retained planning records can keep
 // copied CPU arrays alive. Drop only batch-owned buffers and closures here.
 b.geometry.deleteAttribute('position');b.geometry.deleteAttribute('cadLineSlot');b.geometry.setIndex(null);
 b.matrices.image.data=null;if(b.parameters)b.parameters.texture.image.data=null;
 b.baseIndices=null;b.data=null;b.parameters=null;b.activeState=null;
 b.mesh.onBeforeRender=()=>{};b.material.onBeforeCompile=()=>{};b.material.customProgramCacheKey=()=>'';
}
function updateIndices(b){
 const active=b.records.map(r=>r.active);
 if(equal(active,b.activeState))return;
 const index=b.geometry.index;let count=0;
 for(let i=0;i<active.length;i++)if(active[i]){const range=b.ranges[i];index.array.set(b.baseIndices.subarray(range.start,range.start+range.count),count);count+=range.count;}
 b.geometry.setDrawRange(0,count);index.clearUpdateRanges();if(count){index.addUpdateRange(0,count);index.needsUpdate=true;}b.activeState=active;
}

export class OpaqueBatchRegistry {
 constructor(cad,{maxObjects=256,maxVertices=262144,maxBytes=256*1024*1024}={}){
  this.cad=cad;this.maxObjects=Math.min(maxObjects,cad.gl.capabilities?.maxTextureSize||256);this.maxVertices=maxVertices;this.maxBytes=maxBytes;this.enabled=true;this.batches=[];this.originals=[];this.retained=null;this.ordinals=new Map();this.disposed=false;
  this.stats={active:false,builds:0,reused:0,fastFrames:0,verticesUploaded:0,savedSubmissions:0,patches:0};this.resetPending();this.validatedPrograms=new Set();
  this.compare=(a,b)=>{const x=this.ordinals.get(a.object),y=this.ordinals.get(b.object);if(x==null||y==null)throw Error('opaque draw changed outside retained cohort');return x-y;};
 }
 suspend(){for(const r of this.originals)r.object.visible=r.visible;this.originals=[];for(const b of this.batches)b.mesh.removeFromParent();if(this.stats.active)this.cad.gl.setOpaqueSort(null);this.stats.active=false;}
 clear(){this.suspend();for(const b of this.batches)dispose(b);this.batches=[];this.retained=null;this.pendingPlans=null;this.resetPending();this.ordinals.clear();Object.assign(this.stats,{savedSubmissions:0,retainedBytes:0,pendingValidation:0});}
 dispose(){this.clear();this.disposed=true;}
 collect(){
  const {cad}=this,scene=cad.scene,camera=cad.camera;camera.updateMatrixWorld();
  const c=camera.matrixWorldInverse.elements,p=camera.projectionMatrix.elements;
  if(!camera.isOrthographicCamera||c[2]!==0||c[6]!==0||c[10]!==1||p[2]!==0||p[6]!==0||cad.gl.sortObjects===false||scene.overrideMaterial)throw Error('unsupported opaque camera or sorting');
  const projection=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),point=new THREE.Vector3(),visited=new Set(),list=[];
  const walk=(o,root,groupOrder)=>{
   if(visited.has(o)||!o.visible)return;visited.add(o);
   const layers=o.layers.test(camera.layers);if(o.isGroup&&layers)groupOrder=o.renderOrder;
   if(layers&&(o.isMesh||o.isLine||o.isPoints||o.isSprite)){
    if(Array.isArray(o.material))throw Error('opaque multimaterial draw unsupported');
    const m=o.material,g=o.geometry;
    if(m?.visible&&!m.transparent&&!(m.transmission>0)){
     if(o.isSprite)point.setFromMatrixPosition(o.matrixWorld);
     else if(o.boundingSphere!==undefined){if(o.boundingSphere===null)o.computeBoundingSphere();point.copy(o.boundingSphere.center).applyMatrix4(o.matrixWorld);}
     else{if(!g.boundingSphere)g.computeBoundingSphere();point.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);}
     point.applyMatrix4(projection);list.push({object:o,root,geometry:g,material:m,groupOrder,renderOrder:o.renderOrder,z:point.z});
    }
   }
   for(const child of o.children)walk(child,root,groupOrder);
  };
  const roots=new Set([...scene.children,...cad.spatialObjects.keys()]);
  for(const root of roots){let top=root;while(top.parent&&top.parent!==scene)top=top.parent;if(visited.has(top))continue;top.updateWorldMatrix(true,true);walk(top,top,0);}
  list.sort(sort);return list;
 }
 // The owning renderer reports every drawable root it registers or removes;
 // see TransparentBatchRegistry. Only an exact journal may patch the cohort.
 noteAdded(object){const p=this.pending;if(!p.removed.delete(object))p.added.add(object);}
 noteRemoved(object){const p=this.pending;if(!p.added.delete(object))p.removed.add(object);}
 noteChanged(){this.pending.exact=false;}
 // ACAD200 104/105: a root whose own buffers were edited in place (index gaps,
 // depth). Patched like a removal plus an addition of the same root.
 noteReplaced(object){const p=this.pending;if(!p.added.has(object))p.replaced.add(object);}
 resetPending(){this.pending={added:new Set(),removed:new Set(),replaced:new Set(),exact:true};}
 patchedCohort(){
  const {cad}=this,scene=cad.scene,camera=cad.camera,{added,removed,replaced}=this.pending,old=this.retained;camera.updateMatrixWorld();
  const topOf=o=>{while(o.parent&&o.parent!==scene)o=o.parent;return o;};
  const kept=[],keptRecords=[];
  old.list.forEach((item,i)=>{if(!removed.has(item.root)&&!removed.has(topOf(item.object))&&!replaced?.has(item.root)&&!replaced?.has(topOf(item.object))){kept.push(item);keptRecords.push(old.records[i]);}});
  const projection=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),point=new THREE.Vector3(),visited=new Set(kept.map(item=>item.object)),fresh=[];
  const walk=(o,root,groupOrder)=>{
   if(visited.has(o)||!o.visible)return;visited.add(o);
   const layers=o.layers.test(camera.layers);if(o.isGroup&&layers)groupOrder=o.renderOrder;
   if(layers&&(o.isMesh||o.isLine||o.isPoints||o.isSprite)){
    if(Array.isArray(o.material))throw Error('opaque multimaterial draw unsupported');
    const m=o.material,g=o.geometry;
    if(m?.visible&&!m.transparent&&!(m.transmission>0)){
     if(o.isSprite)point.setFromMatrixPosition(o.matrixWorld);
     else if(o.boundingSphere!==undefined){if(o.boundingSphere===null)o.computeBoundingSphere();point.copy(o.boundingSphere.center).applyMatrix4(o.matrixWorld);}
     else{if(!g.boundingSphere)g.computeBoundingSphere();point.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);}
     point.applyMatrix4(projection);fresh.push({object:o,root,geometry:g,material:m,groupOrder,renderOrder:o.renderOrder,z:point.z});
    }
   }
   for(const child of o.children)walk(child,root,groupOrder);
  };
  for(const root of replaced?.size?[...added,...replaced]:added){
   if(!cad.spatialObjects?.has(root)&&root.parent!==scene)continue;
   const top=topOf(root);if(removed.has(top))continue;top.updateWorldMatrix(true,true);walk(top,top,0);
  }
  fresh.sort(sort);
  const list=[],records=[];let i=0,j=0;
  while(i<kept.length||j<fresh.length){
   if(j>=fresh.length||i<kept.length&&sort(kept[i],fresh[j])<=0){list.push(kept[i]);records.push(keptRecords[i]);i++;}
   else{list.push(fresh[j]);records.push(candidate(fresh[j],cad,list.length-1));j++;}
  }
  records.forEach((r,ordinal)=>{if(r)r.ordinal=ordinal;});
  return {list,records,fresh:fresh.length,removed:old.list.length-kept.length};
 }
 // patchable: the caller guarantees that only noteAdded/noteRemoved roots
 // changed since the retained sync (same document and revision).
 // buildBudgetMs: merged buffers are built for at most this long per frame;
 // the remaining plans stay as original draws and are built by the next
 // frames' fast path (a full-plan overview built them all at once, 100-150 ms).
 sync({retainedToken=null,patchable=false,buildBudgetMs=Infinity}={}){
  this.suspend();if(this.disposed||!this.enabled){this.resetPending();return false;}
  if(retainedToken&&this.retained&&equal(retainedToken,this.retained.token)){this.resetPending();if(this.pendingPlans&&equal(retainedToken,this.pendingPlans.token))this.buildPending(buildBudgetMs);this.activate(this.retained.list);this.stats.fastFrames++;return true;}
  if(patchable&&retainedToken&&this.retained?.records&&this.pending.exact&&retainedToken[0]===this.retained.token[0]&&retainedToken[1]===this.retained.token[1]){
   let patched=null;try{patched=this.patchedCohort();}catch(error){patched=null;}
   this.resetPending();
   if(patched){const done=this.assemble(patched.list,patched.records,retainedToken,buildBudgetMs);if(done){this.stats.patches++;Object.assign(this.stats,{patchAdded:patched.fresh,patchRemoved:patched.removed});}return done;}
  }
  this.retained=null;this.resetPending();let list,records;
  try{list=this.collect();records=list.map((item,i)=>candidate(item,this.cad,i));}catch(error){this.stats.reason=error.message;return false;}
  return this.assemble(list,records,retainedToken,buildBudgetMs);
 }
 assemble(list,records,retainedToken,buildBudgetMs=Infinity){
  this.retained=null;this.pendingPlans=null;
  const old=this.batches,next=[],created=[],plans=[],byFirst=new Map(old.map(b=>[b.records[0].object,b]));let peakBytes=0,budgetSkips=0;
  const reusable=i=>{const b=records[i]&&byFirst.get(records[i].object);return b&&b.records.every((r,j)=>records[i+j]?.object===r.object&&equal(records[i+j].fingerprint,r.fingerprint))?b:null;};
  try{
   let i=0;
   while(i<records.length){
    if(!records[i]){i++;continue;}
    const reuse=reusable(i);if(reuse){plans.push({records:records.slice(i,i+reuse.records.length),reuse,bytes:reuse.bytes});i+=reuse.records.length;continue;}
    const run=[];let vertices=0;
    while(i<records.length&&records[i]){const r=records[i],n=r.geometry.attributes.position.count;
     if(run.length&&(reusable(i)||run[0].key!==r.key||run.length>=this.maxObjects||vertices+n>this.maxVertices))break;
     run.push(r);vertices+=n;i++;
    }
    if(run.length>1)plans.push({records:run,bytes:estimateBytes(run),reuse:null});
   }
   // Large refined polylines can consume the entire allowance while saving
   // only one draw. Prioritize submissions saved per retained byte instead.
   plans.sort((a,b)=>(b.records.length-1)/b.bytes-(a.records.length-1)/a.bytes||a.records[0].ordinal-b.records[0].ordinal);
   const chosen=[];let bytes=0;
   for(const plan of plans){if(bytes+plan.bytes>this.maxBytes){budgetSkips++;continue;}chosen.push(plan);bytes+=plan.bytes;}
   const keep=new Set(chosen.map(p=>p.reuse).filter(Boolean));
   // Free obsolete optimization buffers before allocating replacements;
   // original CAD resources stay intact and can always draw the next frame.
   for(const b of old)if(!keep.has(b))dispose(b);
   this.batches=old.filter(b=>keep.has(b));peakBytes=this.batches.reduce((n,b)=>n+b.bytes,0);
   const buildStart=performance.now(),deferred=[];
   for(const plan of chosen){
    if(plan.reuse){plan.reuse.records=plan.records;next.push(plan.reuse);this.stats.reused++;continue;}
    if(created.length&&performance.now()-buildStart>=buildBudgetMs){deferred.push(plan);continue;}
    const b=build(plan.records,this.cad.gl.capabilities?.maxTextureSize||4096);peakBytes+=b.bytes;next.push(b);created.push(b);this.stats.builds++;this.stats.verticesUploaded+=b.vertices;
   }
   if(deferred.length&&retainedToken)this.pendingPlans={token:[...retainedToken],plans:deferred};
   this.stats.deferredPlans=deferred.length;
  }catch(error){for(const b of created)dispose(b);this.clear();this.stats.reason=error.message;return false;}
  const nextSet=new Set(next);for(const b of old)if(!nextSet.has(b))dispose(b);this.batches=next;
  Object.assign(this.stats,{retainedBytes:next.reduce((n,b)=>n+b.bytes,0),peakBytes,budgetSkips});
  this.activate(list);if(retainedToken)this.retained={token:[...retainedToken],list,records};return true;
 }
 buildPending(buildBudgetMs=Infinity){
  const pending=this.pendingPlans,start=performance.now(),created=[];
  try{
   while(pending.plans.length){
    if(created.length&&performance.now()-start>=buildBudgetMs)break;
    const plan=pending.plans.shift(),b=build(plan.records,this.cad.gl.capabilities?.maxTextureSize||4096);
    this.batches.push(b);created.push(b);this.stats.builds++;this.stats.verticesUploaded+=b.vertices;
   }
  }catch(error){for(const b of created){dispose(b);this.batches.splice(this.batches.indexOf(b),1);}this.pendingPlans=null;this.stats.reason=error.message;return;}
  if(!pending.plans.length)this.pendingPlans=null;
  Object.assign(this.stats,{retainedBytes:this.batches.reduce((n,b)=>n+b.bytes,0),deferredPlans:pending.plans.length});
 }
 activate(list){
  const {cad}=this,projection=new THREE.Matrix4().multiplyMatrices(cad.camera.projectionMatrix,cad.camera.matrixWorldInverse),frustum=new THREE.Frustum().setFromProjectionMatrix(projection);
  this.ordinals.clear();
  for(let i=0;i<list.length;i++)this.ordinals.set(list[i].object,i);
  let saved=0,activeBatches=0;
  for(const b of this.batches){
   for(const r of b.records){let top=r.object,visible=true;while(top&&top!==cad.scene){visible&&=top.visible;top=top.parent;}
    r.active=visible&&top===cad.scene&&r.object.layers.test(cad.camera.layers)&&(!r.object.frustumCulled||frustum.intersectsObject(r.object));
   }
   updateIndices(b);const active=b.records.filter(r=>r.active).length;
   if(!active)continue;
   for(const r of b.records){this.originals.push({object:r.object,visible:r.object.visible});r.object.visible=false;}
   this.ordinals.set(b.mesh,b.records[0].ordinal);cad.scene.add(b.mesh);b.mesh.updateWorldMatrix(true,true);saved+=active-1;activeBatches++;
  }
  if(activeBatches)cad.gl.setOpaqueSort(this.compare);
  // A merged draw is validated once per linked program (GL getError is a
  // full GPU round trip). Batches of a proven program differ only in buffers
  // this module sizes itself, so they inherit that proof.
  for(const b of this.batches)if(!b.validated&&this.validatedPrograms.has(b.programKey))b.validated=true;
  Object.assign(this.stats,{active:activeBatches>0,reason:null,batches:this.batches.length,activeBatches,savedSubmissions:saved,pendingValidation:this.batches.filter(b=>b.mesh.parent===cad.scene&&!b.validated).length});
 }
 validateActive(){for(const b of this.batches)if(b.mesh.parent===this.cad.scene){b.validated=true;this.validatedPrograms.add(b.programKey);}this.stats.pendingValidation=0;}
}
