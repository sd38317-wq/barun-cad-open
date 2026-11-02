// Retained transparent submission batches. Original drawables remain authoritative.
import {THREE} from './vendor/mlightcad.js';

const stateFields=['depthTest','depthFunc','blending','blendSrc','blendDst','blendEquation','blendSrcAlpha','blendDstAlpha','blendEquationAlpha','premultipliedAlpha','alphaHash','alphaToCoverage','colorWrite','polygonOffset','polygonOffsetFactor','polygonOffsetUnits','stencilWrite','stencilWriteMask','stencilFunc','stencilRef','stencilFuncMask','stencilFail','stencilZFail','stencilZPass','toneMapped','fog','dithering','wireframe'];
const extraMaps=['lightMap','aoMap','specularMap','alphaMap','envMap'];
const defaultCompile=THREE.Material.prototype.onBeforeCompile;
const clipped=object=>{for(let node=object;node;node=node.parent)if(node.userData?.barunClipMasks?.length)return true;return false;};
const rangeOf=item=>{
  const g=item.geometry,p=g?.getAttribute('position');
  if(!p)return null;
  const start=Math.max(g.drawRange.start,item.group?.start||0),end=Math.min(g.index?.count??p.count,g.drawRange.start+g.drawRange.count,item.group?item.group.start+item.group.count:Infinity);
  return {p,start,end};
};

function candidate(item,ordinal,solidOwners,textOwners,reject) {
    const o=item.object,m=item.material,g=item.geometry,r=rangeOf(item),text=textOwners.has(o),solid=solidOwners.has(o)&&!m.map&&m.opacity===.22;
    if(!text&&!solid)return reject('not owned text or solid');
    // THREE flips front-face winding for reflected original meshes. A merged
    // positive-determinant mesh cannot reproduce that with a shared discard.
    if(solid&&o.matrixWorld.determinant()<0)return reject('reflected solid');
    if(!o.isMesh||!m.isMeshBasicMaterial||m.vertexColors||m.clippingPlanes?.length||clipped(o)||m.onBeforeCompile!==defaultCompile||extraMaps.some(k=>m[k])||m.alphaHash||m.alphaToCoverage||m.wireframe)return reject('custom material or clipping');
    if(text&&(!m.map||m.side!==THREE.DoubleSide||!m.forceSinglePass||m.alphaTest!==.01||!m.depthWrite)||solid&&(m.side!==THREE.FrontSide||m.depthWrite||m.alphaTest!==0))return reject('unsupported side/alpha/depth combination');
    if(item.group||g.groups.length||!r||r.start%3||(r.end-r.start)%3||r.p.itemSize!==3||r.p.isInterleavedBufferAttribute||!(r.p.array instanceof Float32Array)||r.p.normalized||Object.keys(g.morphAttributes).length)return reject('unsupported geometry');
    if(text&&(!g.attributes.uv||g.attributes.uv.itemSize!==2))return reject('missing UV');
    if(m.map){if(m.map.channel!==0)return reject('unsupported UV channel');if(m.map.matrixAutoUpdate)m.map.updateMatrix();if(!m.map.matrix.equals(new THREE.Matrix3()))return reject('transformed UV');}
    // These states remain actual draw barriers; only the intentionally unified
    // side, opacity, texture, alpha-test and depth-write fields are excluded.
    const key=JSON.stringify([item.groupOrder,stateFields.map(k=>m[k]),m.defines||null]);
    return {item,object:o,material:m,geometry:g,range:r,text,ordinal,key,texture:m.map||null,count:r.end-r.start};
}
function buildChunk(run) {
    const count=run.reduce((n,r)=>n+r.count,0),positions=new Float32Array(count*3),uvs=new Float32Array(count*2),colors=new Float32Array(count*4),modes=new Float32Array(count),slots=new Float32Array(count);
    let vertex=0;
    run.forEach((record,slot)=>{
      const {geometry:g,range:r,material:m}=record;
      for(let j=r.start;j<r.end;j++,vertex++){
        const k=g.index?g.index.getX(j):j;
        positions[vertex*3]=r.p.getX(k);positions[vertex*3+1]=r.p.getY(k);positions[vertex*3+2]=r.p.getZ(k);
        if(record.text){uvs[vertex*2]=g.attributes.uv.getX(k);uvs[vertex*2+1]=g.attributes.uv.getY(k);}
        colors[vertex*4]=m.color.r;colors[vertex*4+1]=m.color.g;colors[vertex*4+2]=m.color.b;colors[vertex*4+3]=m.opacity;
        modes[vertex]=record.text?1:0;slots[vertex]=slot;
      }
    });
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.setAttribute('prototypeRGBA',new THREE.BufferAttribute(colors,4));geometry.setAttribute('prototypeMode',new THREE.BufferAttribute(modes,1));geometry.setAttribute('prototypeSlot',new THREE.BufferAttribute(slots,1));
    const matrixData=new Float32Array(run.length*16),matrices=new THREE.DataTexture(matrixData,4,run.length,THREE.RGBAFormat,THREE.FloatType);
    matrices.magFilter=THREE.NearestFilter;matrices.minFilter=THREE.NearestFilter;matrices.generateMipmaps=false;matrices.needsUpdate=true;
    const texture=run.find(r=>r.texture)?.texture||null;
    const material=run[0].material.clone();material.color.setRGB(1,1,1);material.opacity=1;material.map=texture;material.depthWrite=false;material.side=THREE.DoubleSide;material.forceSinglePass=true;material.alphaTest=0;
    material.customProgramCacheKey=()=>`cad-unified-transparent-prototype-v1:${!!texture}`;
    material.onBeforeCompile=shader=>{
      shader.uniforms.prototypeMatrices={value:matrices};shader.uniforms.prototypeRows={value:run.length};
      shader.vertexShader=`attribute vec4 prototypeRGBA; attribute float prototypeMode; attribute float prototypeSlot; varying vec4 vPrototypeRGBA; varying float vPrototypeMode; uniform sampler2D prototypeMatrices; uniform float prototypeRows;\n${shader.vertexShader}`;
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`vPrototypeRGBA=prototypeRGBA; vPrototypeMode=prototypeMode;
        float row=(prototypeSlot+0.5)/prototypeRows;
        mat4 originalModelView=mat4(texture2D(prototypeMatrices,vec2(0.125,row)),texture2D(prototypeMatrices,vec2(0.375,row)),texture2D(prototypeMatrices,vec2(0.625,row)),texture2D(prototypeMatrices,vec2(0.875,row)));
        vec4 mvPosition=originalModelView*vec4(transformed,1.0);
        gl_Position=projectionMatrix*mvPosition;`);
      shader.fragmentShader=`varying vec4 vPrototypeRGBA; varying float vPrototypeMode;\n${shader.fragmentShader}`;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`if(vPrototypeMode>0.5){\n#include <map_fragment>\n}`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`diffuseColor*=vPrototypeRGBA;
        if(vPrototypeMode>0.5){if(diffuseColor.a<0.01)discard;}else if(!gl_FrontFacing)discard;`);
    };
    const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=run[0].ordinal;
    const modelView=new THREE.Matrix4();
    const batch={geometry,material,matrices,records:run,matrixData,vertices:count};
    mesh.onBeforeRender=(_renderer,_scene,camera)=>{
      batch.records.forEach((r,i)=>{
        if(r.active){modelView.multiplyMatrices(camera.matrixWorldInverse,r.object.matrixWorld);matrixData.set(modelView.elements,i*16);}
        else {matrixData.fill(0,i*16,i*16+16);matrixData[i*16+15]=1;}
      });matrices.needsUpdate=true;
    };
    // Preserve inherited Group renderOrder used by THREE's transparent sort.
    const root=new THREE.Group();root.renderOrder=run[0].item.groupOrder;root.add(mesh);
    batch.mesh=root;batch.drawMesh=mesh;return batch;
}

const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const order=(a,b)=>a.groupOrder-b.groupOrder||a.renderOrder-b.renderOrder||b.z-a.z||a.object.id-b.object.id;
const attributeStamp=a=>a?[a,a.array,a.data,a.data?.array,a.version,a.data?.version,a.count,a.itemSize,a.stride,a.offset,a.data?.stride,a.data?.offset,a.normalized]:[null];
const geometryStamp=r=>[r.geometry,...attributeStamp(r.geometry.attributes.position),...attributeStamp(r.geometry.index),r.geometry.drawRange.start,r.geometry.drawRange.count];
const fingerprint=r=>[...geometryStamp(r),...attributeStamp(r.geometry.attributes.uv),r.material,r.material.version,r.key,r.material.color.r,r.material.color.g,r.material.color.b,r.material.opacity,r.texture,r.text,r.range.start,r.range.end];
const disposeChunk=b=>{b.mesh.removeFromParent();b.geometry.dispose();b.material.dispose();b.matrices.dispose();};

/** Call suspend before renderer mutations; sync immediately before the draw.
 * clear must precede atlas/scene resource disposal. Batches never own original
 * geometry or atlas textures. Buffer versions are the mutation contract. */
export class TransparentBatchRegistry {
  constructor(cad,{maxObjects=256,maxVertices=262144}={}) {
    this.cad=cad;this.maxObjects=maxObjects;this.maxVertices=maxVertices;
    this.enabled=true;this.batches=[];this.originals=[];this.depthCache=new WeakMap();this.disposed=false;
    this.stats={builds:0,reused:0,verticesUploaded:0,uploadedVertices:0,active:false,batches:0,savedSubmissions:0,proofFailures:0,proofVertices:0,patches:0};
    this.resetPending();
  }
  suspend(){
    for(const r of this.originals){r.object.visible=r.visible;r.object.renderOrder=r.renderOrder;}
    this.originals=[];for(const b of this.batches)b.mesh.removeFromParent();this.stats.active=false;
  }
  clear({preserveDepthCache=false}={}){this.retained=null;this.resetPending();this.suspend();for(const b of this.batches)disposeChunk(b);this.batches=[];if(!preserveDepthCache)this.depthCache=new WeakMap();this.stats.batches=0;this.stats.savedSubmissions=0;}
  dispose(){this.clear();this.disposed=true;}
  collect(){
    const cad=this.cad,scene=cad.scene,list=[],visited=new Set(),solidOwners=new Set(),textOwners=new Set((cad.textMeshes||[]).map(t=>t.mesh));
    for(const roots of cad.sourceHatches?.values()||[])for(const root of roots)root.traverse(o=>{if(o.isMesh)solidOwners.add(o);});
    const roots=new Set([...scene.children,...cad.spatialObjects?.keys()||[],...[...cad.sourceHatches?.values()||[]].flatMap(s=>[...s]),...textOwners]);
    const projection=new THREE.Matrix4().multiplyMatrices(cad.camera.projectionMatrix,cad.camera.matrixWorldInverse),position=new THREE.Vector3();
    const walk=(o,groupOrder,active,visible)=>{
      if(visited.has(o))return;visited.add(o);visible=visible&&o.visible;
      if(o.isGroup)groupOrder=o.renderOrder;
      if(visible&&o.material&&o.geometry){
        if(Array.isArray(o.material)){if(o.material.some(m=>m.transparent&&m.visible))throw Error('multiple-material draw');}
        else if(o.material.transparent&&o.material.visible&&o.layers.test(cad.camera.layers)){
          const g=o.geometry;
          if(!g.boundingSphere)g.computeBoundingSphere();
          position.copy(g.boundingSphere?.center||new THREE.Vector3()).applyMatrix4(o.matrixWorld).applyMatrix4(projection);
          list.push({object:o,root:walkRoot,geometry:g,material:o.material,group:null,groupOrder,renderOrder:o.renderOrder,z:position.z,active:active&&visible});
        }
      }
      for(const child of o.children)walk(child,groupOrder,active,visible);
    };
    let walkRoot=null;
    for(const root of roots){
      if(visited.has(root))continue;
      let top=root;while(top.parent&&top.parent!==scene)top=top.parent;
      let active=top.parent===scene,visible=true,groupOrder=0,groupFound=false;
      for(let p=root.parent;p&&p!==scene;p=p.parent){visible&&=p.visible;if(p.isGroup&&!groupFound){groupOrder=p.renderOrder;groupFound=true;}}
      walkRoot=root;root.updateWorldMatrix(true,true);walk(root,groupOrder,active,visible);
    }
    list.sort(order);
    return {list,solidOwners,textOwners};
  }
  owners(){
    const cad=this.cad,solidOwners=new Set(),textOwners=new Set((cad.textMeshes||[]).map(t=>t.mesh));
    for(const roots of cad.sourceHatches?.values()||[])for(const root of roots)root.traverse(o=>{if(o.isMesh)solidOwners.add(o);});
    return {solidOwners,textOwners};
  }
  // The owning renderer reports every drawable root it registers or removes.
  // Between two syncs of an unchanged document these are the only scene
  // mutations, so the retained cohort can be patched instead of re-collected.
  noteAdded(object){const p=this.pending;if(!p.removed.delete(object))p.added.add(object);}
  noteRemoved(object){const p=this.pending;if(!p.added.delete(object))p.removed.add(object);}
  noteChanged(){this.pending.exact=false;}
  // ACAD200 104/105: a root whose own buffers changed in place is re-walked.
  noteReplaced(object){const p=this.pending;if(!p.added.has(object))p.replaced.add(object);}
  resetPending(){this.pending={added:new Set(),removed:new Set(),replaced:new Set(),exact:true};}
  // Retained items minus removed roots, plus freshly walked added roots, in the
  // same total order collect() produces. Camera extents never enter the sort
  // key (orthographic depth depends on world z only), so retained z is exact.
  patchedCohort(){
    const cad=this.cad,scene=cad.scene,{added,removed,replaced}=this.pending,old=this.retained;
    const topOf=o=>{while(o.parent&&o.parent!==scene)o=o.parent;return o;};
    const gone=item=>removed.has(item.root)||removed.has(topOf(item.object))||!!replaced?.size&&(replaced.has(item.root)||replaced.has(topOf(item.object)));
    const kept=[],keptRecords=[];
    old.list.forEach((item,i)=>{if(!gone(item)){kept.push(item);keptRecords.push(old.records[i]);}});
    const projection=new THREE.Matrix4().multiplyMatrices(cad.camera.projectionMatrix,cad.camera.matrixWorldInverse),position=new THREE.Vector3(),fresh=[],seen=new Set(kept.map(item=>item.object));
    for(const root of replaced?.size?[...added,...replaced]:added){
      if(!cad.spatialObjects?.has(root)&&root.parent!==scene)continue;
      let top=root;while(top.parent&&top.parent!==scene)top=top.parent;
      let active=top.parent===scene,visible=true,groupOrder=0,groupFound=false;
      for(let p=root.parent;p&&p!==scene;p=p.parent){visible&&=p.visible;if(p.isGroup&&!groupFound){groupOrder=p.renderOrder;groupFound=true;}}
      root.updateWorldMatrix(true,true);
      const walk=(o,groupOrder,active,visible)=>{
        if(seen.has(o))return;seen.add(o);visible=visible&&o.visible;
        if(o.isGroup)groupOrder=o.renderOrder;
        if(visible&&o.material&&o.geometry){
          if(Array.isArray(o.material)){if(o.material.some(m=>m.transparent&&m.visible))throw Error('multiple-material draw');}
          else if(o.material.transparent&&o.material.visible&&o.layers.test(cad.camera.layers)){
            const g=o.geometry;if(!g.boundingSphere)g.computeBoundingSphere();
            position.copy(g.boundingSphere?.center||new THREE.Vector3()).applyMatrix4(o.matrixWorld).applyMatrix4(projection);
            fresh.push({object:o,root,geometry:g,material:o.material,group:null,groupOrder,renderOrder:o.renderOrder,z:position.z,active:active&&visible});
          }
        }
        for(const child of o.children)walk(child,groupOrder,active,visible);
      };
      walk(root,groupOrder,active,visible);
    }
    fresh.sort(order);
    const {solidOwners,textOwners}=this.owners(),rejections={},list=[],records=[];
    const freshRecord=item=>{const r=candidate(item,0,solidOwners,textOwners,key=>{rejections[key]=(rejections[key]||0)+1;return null;});if(r){r.active=item.active;r.fingerprint=fingerprint(r);}return r;};
    let i=0,j=0;
    while(i<kept.length||j<fresh.length){
      if(j>=fresh.length||i<kept.length&&order(kept[i],fresh[j])<=0){list.push(kept[i]);records.push(keptRecords[i]);i++;}
      else{list.push(fresh[j]);records.push(freshRecord(fresh[j]));j++;}
    }
    records.forEach((r,ordinal)=>{if(r)r.ordinal=ordinal;});
    return {list,records,rejections,trusted:new Set(kept.map(item=>item.object)),fresh:fresh.length,removed:old.list.length-kept.length};
  }
  // trusted: objects of a patched cohort whose geometry, material and matrix
  // the renderer guarantees unchanged since they were proven; their cached
  // depth intervals are reused, and only the global order is re-checked.
  // A bounded proof stops after budgetMs of fresh depth scans and reports so;
  // proven objects stay in depthCache, and the next frame's sync continues from
  // there. Proving every hatch vertex of a full plan in one frame held it 0.9 s.
  prove(list,trusted=null,budgetMs=Infinity){
    const cad=this.cad,camera=cad.camera,a=camera.matrixWorldInverse.elements,start=performance.now();let fresh=0;
    if(!camera.isOrthographicCamera||a[2]!==0||a[6]!==0||a[10]!==1||cad.gl?.sortObjects===false||cad.scene.overrideMaterial)return 'unsupported camera or draw sorting';
    let previousMax=-Infinity;
    for(const item of list){
      const known=trusted?.has(item.object)&&this.depthCache.get(item.object);
      if(known){if(known.min<previousMax)return 'overlapping depth intervals';if(known.max!==-Infinity)previousMax=known.max;continue;}
      const m=item.material,r=rangeOf(item),matrix=item.object.matrixWorld.elements;
      const knownClip=clipped(item.object)&&m.customProgramCacheKey()===defaultCompile.toString()+'|barun-xclip-v1';
      if(!r||!item.object.isMesh||item.object.isSkinnedMesh||item.object.isInstancedMesh||item.object.isBatchedMesh||Object.keys(item.geometry.morphAttributes).length||!m.isMeshBasicMaterial||!m.depthTest||m.depthFunc!==THREE.LessEqualDepth||m.polygonOffset||m.stencilWrite||m.onBeforeCompile!==defaultCompile&&!knownClip||r.start%3||(r.end-r.start)%3||item.geometry.groups.length)return 'unsupported transparent depth state';
      const stamp=[...geometryStamp(item),matrix[2],matrix[6],matrix[10],matrix[14]],cached=this.depthCache.get(item.object);
      let depth=cached&&equal(cached.stamp,stamp)?cached:null;
      if(!depth){
        let min=Infinity,max=-Infinity,triangleZ=null,previousTriangleZ=-Infinity;
        for(let j=r.start;j<r.end;j++){
          const k=item.geometry.index?item.geometry.index.getX(j):j;
          const z=matrix[2]*r.p.getX(k)+matrix[6]*r.p.getY(k)+matrix[10]*r.p.getZ(k)+matrix[14];this.stats.proofVertices++;
          if(!Number.isFinite(z))return 'nonfinite vertex depth';
          if((j-r.start)%3===0){if(z<previousTriangleZ)return 'nonmonotonic triangles';triangleZ=z;previousTriangleZ=z;}
          else if(z!==triangleZ)return 'nonplanar triangle depth';
          min=Math.min(min,z);max=Math.max(max,z);
        }
        depth={stamp,min,max};this.depthCache.set(item.object,depth);
        if(++fresh%8===0&&performance.now()-start>=budgetMs)return 'proof continues next frame';
      }
      if(depth.min<previousMax)return 'overlapping depth intervals';
      if(depth.max!==-Infinity)previousMax=depth.max;
    }
    return null;
  }
  // Only the owning CAD renderer supplies this token. It must change on
  // geometry, hierarchy, material, text-atlas or depth mutations. Camera extents
  // and spatial attachment alone may change without invalidating the proof.
  // patchable: the caller guarantees that only noteAdded/noteRemoved roots
  // changed since the retained sync (same document and revision).
  sync({retainedToken=null,patchable=false,proofBudgetMs=Infinity}={}){
    this.suspend();if(this.disposed||!this.enabled){this.resetPending();return false;}
    if(retainedToken&&this.retained&&equal(retainedToken,this.retained.token)){this.resetPending();
      const list=this.retained.list;
      for(const item of list){
        let root=item.object,visible=true;
        while(root&&root!==this.cad.scene){visible&&=root.visible;root=root.parent;}
        item.active=visible&&root===this.cad.scene;
      }
      for(const b of this.batches)for(const r of b.records)r.active=r.item.active;
      this.activate(list);this.stats.fastFrames=(this.stats.fastFrames||0)+1;
      this.stats.reused+=this.batches.length;return true;
    }
    if(patchable&&retainedToken&&this.retained?.records&&this.pending.exact&&retainedToken[0]===this.retained.token[0]&&retainedToken[1]===this.retained.token[1]){
      let patched=null,reason;
      try{patched=this.patchedCohort();reason=this.prove(patched.list,patched.trusted,proofBudgetMs);}catch(error){reason=error.message;}
      if(!reason){
        for(const item of patched.list){let root=item.object,visible=true;while(root&&root!==this.cad.scene){visible&&=root.visible;root=root.parent;}item.active=visible&&root===this.cad.scene;}
        for(const r of patched.records)if(r)r.active=r.item.active;
        this.resetPending();
        if(this.assemble(patched.list,patched.records,retainedToken,patched.rejections)){this.stats.patches++;Object.assign(this.stats,{patchAdded:patched.fresh,patchRemoved:patched.removed});return true;}
        return false;
      }
    }
    this.retained=null;this.resetPending();
    let cohort,reason;
    try{cohort=this.collect();reason=this.prove(cohort.list,null,proofBudgetMs);}catch(error){reason=error.message;}
    if(reason){this.stats.proofFailures++;this.stats.reason=reason;return false;}
    const {list,solidOwners,textOwners}=cohort,rejections={};
    const records=list.map((item,ordinal)=>{
      const r=candidate(item,ordinal,solidOwners,textOwners,key=>{rejections[key]=(rejections[key]||0)+1;return null;});
      if(r){r.active=item.active;r.fingerprint=fingerprint(r);}return r;
    });
    return this.assemble(list,records,retainedToken,rejections);
  }
  assemble(list,records,retainedToken,rejections){
    this.retained=null;
    const old=this.batches,next=[],created=[],oldByFirst=new Map(old.map(b=>[b.records[0].object,b]));
    const reusable=i=>{
      const b=records[i]&&oldByFirst.get(records[i].object);
      return b&&b.records.every((r,j)=>records[i+j]?.object===r.object&&equal(records[i+j].fingerprint,r.fingerprint))?b:null;
    };
    try{
      let i=0;
      while(i<records.length){
        if(!records[i]){i++;continue;}
        const reuse=reusable(i);
        if(reuse){reuse.records=records.slice(i,i+reuse.records.length);next.push(reuse);this.stats.reused++;i+=reuse.records.length;continue;}
        const run=[],start=i;let vertices=0,texture=null;
        while(i<records.length&&records[i]){
          const r=records[i];
          if(run.length&&(reusable(i)||run[0].key!==r.key||run.length>=this.maxObjects||vertices+r.count>this.maxVertices||texture&&r.texture&&texture!==r.texture))break;
          run.push(r);vertices+=r.count;texture ||= r.texture;i++;
        }
        if(run.length>1){const b=buildChunk(run);next.push(b);created.push(b);this.stats.builds++;this.stats.verticesUploaded+=b.vertices;this.stats.uploadedVertices=this.stats.verticesUploaded;}
        if(i===start)i++;
      }
    }catch(error){for(const b of created)disposeChunk(b);this.stats.reason=error.message;return false;}
    const kept=new Set(next);for(const b of old)if(!kept.has(b))disposeChunk(b);this.batches=next;
    this.activate(list);
    if(retainedToken)this.retained={token:[...retainedToken],list,records};
    Object.assign(this.stats,{reason:null,rejections});
    return true;
  }
  activate(list){
    const next=this.batches;
    this.originals=list.map(item=>({object:item.object,visible:item.object.visible,renderOrder:item.object.renderOrder}));
    for(let i=0;i<list.length;i++)list[i].object.renderOrder=i;
    for(const b of next){
      b.drawMesh.renderOrder=b.records[0].ordinal;b.mesh.renderOrder=b.records[0].item.groupOrder;
      for(const r of b.records)r.object.visible=false;
      if(b.records.some(r=>r.active))this.cad.scene.add(b.mesh);
    }
    Object.assign(this.stats,{active:true,reason:null,batches:next.length,savedSubmissions:next.reduce((n,b)=>n+b.records.length-1,0)});
    return true;
  }
}
