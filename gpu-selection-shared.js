import {THREE,AcCmColor} from './vendor/mlightcad.js';
// Temporary experiment: only whole-source batches may reuse all source vertices.
export function shareWholeSourceBatch(r,batch,id,width,scene,geometry,materials,borrowed){
 if(batch.dash.length||batch.clipKey||!batch.records.every(x=>x.sourceId===id))return false;
 const leaves=[];
 for(const root of batch.objects){root.updateWorldMatrix(true,true);root.traverse(c=>{if(c.geometry&&c.material)leaves.push(c);});}
 if(!leaves.length)return false;
 for(const c of leaves){
  const g=c.geometry,p=g.getAttribute('position'),a=g.getAttribute('instanceStart'),b=g.getAttribute('instanceEnd');
  if(Array.isArray(c.material)||g.groups?.length)return false;
  if(a&&b){if(a.data!==b.data||a.data.stride!==6||a.offset!==0||b.offset!==3)return false;}
  else {if(!c.isLineSegments||!p||p.itemSize!==3||p.isInterleavedBufferAttribute||!(p.array instanceof Float32Array)||p.count%2)return false;const index=g.getIndex();if(index){if(index.count!==p.count)return false;for(let i=0;i<index.count;i++)if(index.getX(i)!==i)return false;}}
 }
 for(const source of leaves){
  r.renderer.subEntityTraits.color=new AcCmColor().setRGBFromCss(batch.color);
  r.renderer.subEntityTraits.lineWeight=width*40;r.renderer.subEntityTraits.drawOrder=0;
  r.renderer.subEntityTraits.lineType={name:'Continuous',type:'Standard',pattern:[]};
  const dummy=r.renderer.lineSegments(new Float32Array([0,0,0,1,0,0]),3,new Uint16Array([0,1]));
  let target;dummy.traverse(c=>{if(c.isLineSegments2)target=c;});
  if(!target)throw Error('wide line geometry unavailable');
  const sg=source.geometry,g=target.geometry,start=sg.getAttribute('instanceStart');
  const data=start?.data||new THREE.InstancedInterleavedBuffer(sg.getAttribute('position').array,6,1);
  g.setAttribute('instanceStart',new THREE.InterleavedBufferAttribute(data,3,0));
  g.setAttribute('instanceEnd',new THREE.InterleavedBufferAttribute(data,3,3));
  g.instanceCount=start?sg.instanceCount:sg.getAttribute('position').count/2;
  g.boundingBox=sg.boundingBox?.clone()||null;g.boundingSphere=sg.boundingSphere?.clone()||null;
  target.frustumCulled=false;target.matrixAutoUpdate=false;target.matrix.copy(source.matrixWorld);target.renderOrder=source.renderOrder;
  target.material=target.material.clone();target.material.depthTest=target.material.depthWrite=true;target.material.linewidth=width;target.material.resolution.set(r.width,r.height);
  geometry.add(g);materials.add(target.material);if(start)borrowed.add(g);
  scene.add(target);
 }
 return true;
}
