// ACAD200 102·104·105·124·125: 선 배치를 다시 만들지 않는 편집과 그 뒷정리.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CadGpuRenderer} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';
import {removeRecordsInPlace,recordVertexStarts,wasteRatio,setRecordDepthInPlace,UPLOAD_VERTICES} from './gpu-batch-edit.js';

const line=(id,x=0,y=0,color='#ff0000')=>({id,type:'line',layer:'0',color,points:[{x,y},{x:x+10,y:y+10}]});
const doc=entities=>({layers:[{id:'0',name:'0',visible:true,color:'#ffffff',lineweight:.25}],entities,blocks:[],linetypeScale:1});
const copy=(previous,entities)=>({...previous,entities});
function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{},lineSegments(values,size,indices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));
    const child=new THREE.LineSegments(g,new THREE.LineBasicMaterial());const group=new THREE.Group();group.add(child);return group;
  }}});
  return r;
}
const update=(r,next,removed,added)=>{const previousDoc=r.doc,previousRevision=r.revision;r.setDocument(next,previousRevision+1,1,{previousDoc,previousRevision,lightweight:true,removed,added});};
const records=r=>[...r.lineBatches.values()].flatMap(b=>b.records);
// 지오메트리의 인덱스가 가리키는 (길이 0 이 아닌) 선분의 첫 점 x 들(도면 좌표).
const drawnStarts=batch=>batch.objects.flatMap(o=>{const out=[];o.updateMatrixWorld(true);o.traverse(c=>{if(!c.geometry?.index)return;const p=c.geometry.getAttribute('position'),ix=c.geometry.index,m=c.matrixWorld.elements;for(let i=0;i<ix.count;i+=2){const a=ix.getX(i),b=ix.getX(i+1);if(a===b)continue;out.push(Math.round(p.getX(a)+m[12]));}});return out;}).sort((a,b)=>a-b);

test('105: deleting a few lines closes index gaps without re-uploading the vertex buffer',()=>{
  const r=renderer(),lines=Array.from({length:40},(_,i)=>line('l'+i,i*20));const first=doc(lines);r.setDocument(first,1,1);
  assert.equal(r.lineBatches.size,1);const batch=[...r.lineBatches.values()][0],object=batch.objects[0],position=lineGeom(object).geometry.getAttribute('position');
  const before=drawnStarts(batch).length;
  update(r,copy(first,lines.filter((_,i)=>i!==3&&i!==17)),[lines[3],lines[17]],[]);
  assert.equal(r.stats.builds,1);assert.equal(r.lineBatches.get(batch.key),batch,'same batch kept');
  assert.equal(batch.objects[0],object,'same GPU object');assert.equal(lineGeom(object).geometry.getAttribute('position'),position,'vertex buffer untouched');
  assert.equal(r.stats.inPlaceRemovals,1);assert.equal(batch.records.length,38);assert.ok(!batch.records.some(x=>x.sourceId==='l3'||x.sourceId==='l17'));
  const drawn=drawnStarts(batch);assert.equal(drawn.length,before-2);
  const shift=r.shift.x;assert.ok(!drawn.includes(Math.round(3*20-shift))&&!drawn.includes(Math.round(17*20-shift)),'deleted segments are not drawn');
  assert.deepEqual([...r.sourceBatchesOf('l3')],[]);assert.ok(r.wastedBatches.has(batch));assert.ok(wasteRatio(batch)>0);
});
const lineGeom=o=>{let f;o.traverse(c=>{if(c.geometry?.index)f=c;});return f;};

test('105: more than half wasted, or nothing left, rebuilds the batch as before',()=>{
  const r=renderer(),lines=Array.from({length:10},(_,i)=>line('l'+i,i*20));const first=doc(lines);r.setDocument(first,1,1);
  const batch=[...r.lineBatches.values()][0];
  update(r,copy(first,lines.slice(6)),lines.slice(0,6),[]);
  assert.notEqual(r.lineBatches.get(batch.key),batch,'60% removed: rebuilt');assert.equal(records(r).length,4);assert.ok(!r.stats.inPlaceRemovals);
});

test('104: idle consolidation compacts a batch with index gaps once the view rests',()=>{
  const r=renderer(),lines=Array.from({length:40},(_,i)=>line('l'+i,i*20));const first=doc(lines);r.setDocument(first,1,1);
  update(r,copy(first,lines.slice(1)),[lines[0]],[]);
  const batch=[...r.wastedBatches][0];assert.ok(batch);
  r.lastEditAt=performance.now();r.idleTimer=1;assert.equal(r.consolidateIdle(4),false,'waits for 300 ms without edits');
  r.lastEditAt=performance.now()-1000;r.consolidateIdle(4);
  assert.equal(r.wastedBatches.size,0);assert.equal(r.stats.consolidatedBatches,1);assert.equal(wasteRatio(batch),0);
  assert.equal(batch.totalVertices,39*2);assert.equal(drawnStarts(batch).length,39);
});

test('102: an edit touching many batches syncs visible keys first and finishes before the next edit',()=>{
  const r=renderer(),colors=Array.from({length:60},(_,i)=>'#'+(0x100000+i*997).toString(16).slice(-6));
  const lines=colors.map((color,i)=>line('l'+i,i*100,0,color));const first=doc(lines);r.setDocument(first,1,1);
  r.buildBudgetMs=30;r.editSyncBudgetMs=0;r.lastViewBox={minX:-3000,maxX:-2900,minY:-100,maxY:100};
  const moved=lines.map(e=>({...e,points:e.points.map(p=>({x:p.x,y:p.y+5}))}));
  // Changed geometry (not a pure translation proof: one also changes length) forces the batch path.
  moved[0]={...moved[0],points:[{x:0,y:5},{x:50,y:50}]};
  update(r,copy(first,moved),lines,moved);
  assert.ok(r.pendingBatchSync,'later batch keys wait for the next frames');
  assert.ok(r.stats.deferredBatchKeys>0);
  const extra=line('x',9999);update(r,copy(r.doc,[...moved,extra]),[],[extra]);
  assert.equal(r.pendingBatchSync,null,'next edit finishes the pending sync first');
  assert.equal(records(r).length,61);for(const e of moved)assert.equal(records(r).filter(x=>x.sourceId===e.id).length,1);
  assert.equal(r.stats.builds,1);
});

test('124: line batches count their uploaded bytes and give them back on dispose',()=>{
  const r=renderer(),lines=Array.from({length:4},(_,i)=>line('l'+i,i*20,0,i%2?'#00ff00':'#ff0000'));r.setDocument(doc(lines),1,1);
  const total=[...r.lineBatches.values()].reduce((n,b)=>n+b.gpuBytes,0);
  assert.ok(total>0);assert.equal(r.memory.bytes,total);
  update(r,copy(r.doc,lines.slice(1)),[lines[0]],[]);
  assert.equal(r.memory.bytes,[...r.lineBatches.values()].reduce((n,b)=>n+b.gpuBytes,0),'meter matches live batches');
  r.clearScene();assert.equal(r.memory.bytes,0);
});

test('125: line chunks are centred in double precision before the Float32 upload',()=>{
  const far=4e7,r=renderer(),a=line('a',far,far),b=line('b',0,0);r.setDocument(doc([a,b]),1,1);
  // a sits ~40 km from the drawing centre: millimetre detail must survive the upload.
  const fine={id:'fine',type:'line',layer:'0',color:'#ff0000',points:[{x:far+.001,y:far},{x:far+.002,y:far}]};
  update(r,copy(r.doc,[a,b,fine]),[],[fine]);
  const batch=[...r.lineBatches.values()].find(x=>x.records.some(rec=>rec.sourceId==='fine')),object=batch.objects[0];object.updateMatrixWorld(true);
  const child=lineGeom(object),p=child.geometry.getAttribute('position');
  const worldX=i=>p.getX(i)+child.matrixWorld.elements[12]+r.shift.x;
  assert.ok(Math.abs(worldX(0)-(far+.001))<1e-4,'start '+worldX(0));assert.ok(Math.abs(worldX(1)-(far+.002))<1e-4,'end '+worldX(1));
  assert.ok(Math.abs(p.getX(0))<1,'stored relative to the chunk centre');
});

test('pure helpers: vertex starts, in-place removal and depth rewrite across upload chunks',()=>{
  const mk=(id,n)=>({sourceId:id,points:new Float64Array(n*6).fill(1)});
  const recs=[mk('a',2),mk('b',3),mk('c',1)],batch={records:recs};
  assert.deepEqual([...recordVertexStarts(batch)],[0,4,10]);
  // Two upload chunks of 6 vertices each: b straddles them.
  const geo=n=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3));g.setIndex(new THREE.BufferAttribute(Uint16Array.from({length:n},(_,i)=>i),1));const o=new THREE.LineSegments(g);return o;};
  const fresh={records:[...recs],objects:[geo(6),geo(6)]};fresh.totalVertices=fresh.liveVertices=12;
  const result=removeRecordsInPlace(fresh,new Set(['b']),{uploadVertices:6});
  assert.equal(result.removed.length,1);assert.equal(result.changed.length,2);
  assert.deepEqual([...fresh.objects[0].geometry.index.array],[0,1,2,3,3,3]);
  assert.deepEqual([...fresh.objects[1].geometry.index.array],[4,5,5,5,5,5]);
  assert.equal(fresh.liveVertices,6);assert.equal(wasteRatio(fresh),.5);
  const depths={records:[mk('a',1),mk('b',1)],objects:[geo(4)]};
  setRecordDepthInPlace(depths,new Set(['b']),()=>7,{uploadVertices:UPLOAD_VERTICES});
  assert.equal(depths.records[1].points[2],7);assert.equal(depths.objects[0].geometry.getAttribute('position').getZ(2),7);assert.equal(depths.objects[0].geometry.getAttribute('position').getZ(0),0);
});
