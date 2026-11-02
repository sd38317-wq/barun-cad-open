// Opaque line range batching primitive. Not wired into the CAD renderer yet.
// The caller owns cohort ordering, visibility and invalidation. Original
// drawables stay authoritative for geometry, selection and spatial indexing.
import {THREE} from './vendor/mlightcad.js';

const defaultCompile=THREE.Material.prototype.onBeforeCompile;

export function opaqueLineEligible(object){
  const m=object?.material,g=object?.geometry,p=g?.attributes?.position,count=g?.index?.count??p?.count;
  if(!object?.isLineSegments||object.isBatchedMesh||Array.isArray(m)||!m?.isLineBasicMaterial||m.transparent||m.vertexColors||m.map||m.clippingPlanes?.length||m.onBeforeCompile!==defaultCompile)return false;
  if(object.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender||object.onAfterRender!==THREE.Object3D.prototype.onAfterRender)return false;
  for(let node=object;node;node=node.parent)if(node.userData?.barunClipMasks?.length)return false;
  return !!p&&p.itemSize===3&&!p.normalized&&!p.isInterleavedBufferAttribute&&p.array instanceof Float32Array&&Object.keys(g.attributes).length===1&&!Object.keys(g.morphAttributes).length&&!g.groups.length&&count>0&&count%2===0&&g.drawRange.start===0&&(g.drawRange.count===Infinity||g.drawRange.count===count);
}

/** Records: {object, active}. Mutate active before rendering, not source
 * visibility (the caller hides originals while this batch is active).
 * Require WEBGL_multi_draw at the integration boundary; the vendor's fallback
 * still draws every range and does not provide the intended CPU benefit. */
export class OpaqueLineBatch extends THREE.BatchedMesh {
  constructor(records){
    if(records.length<2||records.some(r=>!opaqueLineEligible(r.object))||records.some(r=>r.object.material!==records[0].object.material))throw Error('incompatible opaque line cohort');
    const sourceMaterial=records[0].object.material;
    const vertices=records.reduce((n,r)=>n+r.object.geometry.attributes.position.count,0);
    const indices=records.reduce((n,r)=>n+(r.object.geometry.index?.count??r.object.geometry.attributes.position.count),0);
    const material=sourceMaterial.clone();
    super(records.length,vertices,indices,material);
    // The pinned vendor chooses primitive mode before handling isBatchedMesh.
    // Leave the batch flag intact but explicitly select GL_LINES.
    this.isMesh=false;this.isLine=true;this.isLineSegments=true;
    this.type='CadOpaqueLineBatch';this.frustumCulled=false;
    this.perObjectFrustumCulled=false;this.sortObjects=false;
    this.records=records;this.sourceMaterial=sourceMaterial;this.cpuModelView=new THREE.Matrix4();
    this.instanceSlots=[];this.disposed=false;
    material.customProgramCacheKey=()=> 'cad-opaque-line-cpu-modelview-v1';
    material.onBeforeCompile=shader=>{
      if(!shader.vertexShader.includes('#include <project_vertex>'))throw Error('opaque line shader projection changed');
      // batchingMatrix is deliberately the CPU-composed modelView, not a
      // world transform. Do not multiply it by modelViewMatrix a second time.
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`vec4 mvPosition=batchingMatrix*vec4(transformed,1.0);
        gl_Position=projectionMatrix*mvPosition;`);
    };
    try{
      for(const record of records){
        const original=record.object.geometry,g=new THREE.BufferGeometry();
        g.setAttribute('position',original.attributes.position);
        g.setIndex(original.index||new THREE.BufferAttribute(Uint32Array.from({length:original.attributes.position.count},(_,i)=>i),1));
        const geometryId=this.addGeometry(g),instance=this.addInstance(geometryId);
        this.instanceSlots.push(instance);this.setVisibleAt(instance,record.active!==false);
      }
    }catch(error){this.dispose();throw error;}
  }
  onBeforeRender(renderer,scene,camera,geometry,material,group){
    this.material.linewidth=this.sourceMaterial.linewidth;
    this.records.forEach((record,i)=>{
      const instance=this.instanceSlots[i],active=record.active!==false;
      this.setVisibleAt(instance,active);
      if(active){
        this.cpuModelView.multiplyMatrices(camera.matrixWorldInverse,record.object.matrixWorld);
        this.setMatrixAt(instance,this.cpuModelView);
      }
    });
    // Native range scheduling omits invisible instances completely.
    super.onBeforeRender(renderer,scene,camera,geometry,material,group);
  }
  dispose(){if(this.disposed)return;this.disposed=true;super.dispose();this.material.dispose();}
}

/** Single-draw alternative: compact only active index ranges when spatial
 * membership changes. Call updateVisibility BEFORE renderer.render(), because
 * THREE may upload geometry before object.onBeforeRender. */
export class OpaqueMergedLineBatch extends THREE.LineSegments {
  constructor(records){
    if(records.length<2||records.some(r=>!opaqueLineEligible(r.object))||records.some(r=>r.object.material!==records[0].object.material))throw Error('incompatible opaque line cohort');
    const vertices=records.reduce((n,r)=>n+r.object.geometry.attributes.position.count,0),count=records.reduce((n,r)=>n+(r.object.geometry.index?.count??r.object.geometry.attributes.position.count),0);
    const positions=new Float32Array(vertices*3),slots=new Float32Array(vertices),baseIndices=new Uint32Array(count),ranges=[];let v=0,k=0;
    records.forEach((record,slot)=>{
      const g=record.object.geometry,p=g.attributes.position,start=k;positions.set(p.array,v*3);slots.fill(slot,v,v+p.count);
      for(let j=0;j<(g.index?.count??p.count);j++)baseIndices[k++]=v+(g.index?g.index.getX(j):j);
      ranges.push({start,count:k-start});v+=p.count;
    });
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('cadLineSlot',new THREE.BufferAttribute(slots,1));geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(count),1).setUsage(THREE.DynamicDrawUsage));
    const sourceMaterial=records[0].object.material,material=sourceMaterial.clone();super(geometry,material);
    this.records=records;this.sourceMaterial=sourceMaterial;this.baseIndices=baseIndices;this.ranges=ranges;this.activeState=null;this.frustumCulled=false;this.disposed=false;this.indexUpdates=0;
    this.cpuModelView=new THREE.Matrix4();this.matrixData=new Float32Array(records.length*16);
    this.matrixTexture=new THREE.DataTexture(this.matrixData,4,records.length,THREE.RGBAFormat,THREE.FloatType);this.matrixTexture.magFilter=THREE.NearestFilter;this.matrixTexture.minFilter=THREE.NearestFilter;this.matrixTexture.generateMipmaps=false;
    material.customProgramCacheKey=()=> 'cad-opaque-merged-active-ranges-v1';
    material.onBeforeCompile=shader=>{
      shader.uniforms.cadLineMatrices={value:this.matrixTexture};shader.uniforms.cadLineRows={value:records.length};
      shader.vertexShader=`attribute float cadLineSlot;uniform sampler2D cadLineMatrices;uniform float cadLineRows;\n${shader.vertexShader}`;
      if(!shader.vertexShader.includes('#include <project_vertex>'))throw Error('opaque line shader projection changed');
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`float row=(cadLineSlot+0.5)/cadLineRows;
        mat4 originalModelView=mat4(texture2D(cadLineMatrices,vec2(0.125,row)),texture2D(cadLineMatrices,vec2(0.375,row)),texture2D(cadLineMatrices,vec2(0.625,row)),texture2D(cadLineMatrices,vec2(0.875,row)));
        vec4 mvPosition=originalModelView*vec4(transformed,1.0);gl_Position=projectionMatrix*mvPosition;`);
    };
    this.updateVisibility();
  }
  updateVisibility(){
    const active=this.records.map(r=>r.active!==false);
    if(this.activeState&&active.every((value,i)=>value===this.activeState[i]))return false;
    let count=0;const index=this.geometry.index;
    for(let i=0;i<active.length;i++)if(active[i]){const range=this.ranges[i];index.array.set(this.baseIndices.subarray(range.start,range.start+range.count),count);count+=range.count;}
    this.geometry.setDrawRange(0,count);index.clearUpdateRanges();
    if(count){index.addUpdateRange(0,count);index.needsUpdate=true;}
    this.activeState=active;this.indexUpdates++;return true;
  }
  onBeforeRender(_renderer,_scene,camera){
    this.material.linewidth=this.sourceMaterial.linewidth;
    this.records.forEach((r,i)=>{if(this.activeState[i]){this.cpuModelView.multiplyMatrices(camera.matrixWorldInverse,r.object.matrixWorld);this.matrixData.set(this.cpuModelView.elements,i*16);}});
    this.matrixTexture.needsUpdate=true;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.geometry.dispose();this.material.dispose();this.matrixTexture.dispose();}
}
