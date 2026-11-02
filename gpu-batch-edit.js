// 선 배치를 다시 만들지 않고 고치는 도구(ACAD200 104·105·120).
// buildLineBatch 는 batch.records 를 차례로 이어 붙여 정점을 올린다(gpuRecordUploads).
// 그래서 레코드 i 의 정점 시작 = 앞 레코드들 정점 수의 합이고, 올림 덩어리 k 는
// [k*UPLOAD_VERTICES, (k+1)*UPLOAD_VERTICES) 정점을 가진다. 이 표만 있으면
// 지우기는 인덱스 버퍼의 틈만 메우고(정점 버퍼는 그대로), 순서 바꾸기는 그 레코드의 z 만 고친다.
// 표는 처음 고칠 때 한 번 만든다(고치지 않는 배치는 비용 0).
export const UPLOAD_VALUES=180000;              // gpu-record-upload.js 기본 한도(값 개수)
export const UPLOAD_VERTICES=UPLOAD_VALUES/3;

// batch.recordStarts[i] = batch.records[i] 의 첫 정점 번호(배치 전체 기준).
// 이미 있으면(앞서 고친 배치) 그대로 쓴다: records 와 나란히 유지된다.
export function recordVertexStarts(batch){
  if(batch.recordStarts&&batch.recordStarts.length===batch.records.length)return batch.recordStarts;
  const starts=new Float64Array(batch.records.length);let at=0;
  for(let i=0;i<batch.records.length;i++){starts[i]=at;at+=batch.records[i].points.length/3;}
  batch.recordStarts=starts;batch.totalVertices??=at;batch.liveVertices??=at;
  return starts;
}
// 덩어리(THREE 객체) 안의 인덱스를 가진 선 지오메트리.
export function lineGeometryOf(object){
  let found=null;object.traverse?.(child=>{if(!found&&child.geometry?.index&&child.geometry.getAttribute?.('position'))found=child;});
  return found;
}

// ids 에 든 원본의 레코드를 인덱스에서만 뺀다. 정점 버퍼는 건드리지 않는다.
// 남은 레코드로 덩어리마다 인덱스를 처음부터 다시 쓰고, 남는 칸은 길이 0 선분(같은 정점 두 번)으로 채운다:
// 길이 0 선분은 그려지지 않고, 인덱스 개수가 그대로라 불투명 묶음(gpu-opaque-batches)도 그대로 받는다.
// 돌려주는 값: 뺀 레코드 목록(호출자가 원본·상세 표를 정리), 고친 덩어리 목록. 못 하면 null.
export function removeRecordsInPlace(batch,ids,{uploadVertices=UPLOAD_VERTICES}={}){
  if(batch.template||!batch.objects?.length)return null;
  const starts=recordVertexStarts(batch),geometries=batch.objects.map(lineGeometryOf);
  if(geometries.some(child=>!child))return null;
  const removed=[],keep=[],keepStarts=[],changed=new Set();
  for(let i=0;i<batch.records.length;i++){
    const r=batch.records[i];
    if(!ids.has(r.sourceId)){keep.push(r);keepStarts.push(starts[i]);continue;}
    removed.push(r);
    // 이 레코드가 걸친 덩어리들만 다시 쓴다.
    const start=starts[i],end=start+r.points.length/3;
    for(let k=Math.floor(start/uploadVertices);k<=Math.floor((end-1)/uploadVertices)&&k<geometries.length;k++)changed.add(k);
  }
  if(!removed.length)return {removed,changed:[]};
  const arrays=geometries.map(child=>child.geometry.index.array);
  for(const k of changed){
    const base=k*uploadVertices,limit=base+uploadVertices,array=arrays[k];let w=0;
    for(let i=0;i<keep.length;i++){
      const s=Math.max(keepStarts[i],base),e=Math.min(keepStarts[i]+keep[i].points.length/3,limit);
      for(let v=s;v<e;v++)array[w++]=v-base;
    }
    // 짝(선분) 단위로 채운다. 남은 레코드가 없으면 0번 정점 두 번.
    const fill=w?array[w-1]:0;array.fill(fill,w);
    const index=geometries[k].geometry.index;index.needsUpdate=true;
  }
  const removedVertices=removed.reduce((n,r)=>n+r.points.length/3,0);
  batch.records=keep;batch.recordStarts=Float64Array.from(keepStarts);
  batch.liveVertices=(batch.liveVertices??batch.totalVertices)-removedVertices;
  return {removed,changed:[...changed].map(k=>batch.objects[k])};
}
// 정점 버퍼 중 지워진(틈) 비율. 0.5 를 넘으면 배치를 다시 만드는 것이 낫다.
export const wasteRatio=batch=>batch.totalVertices?1-(batch.liveVertices??batch.totalVertices)/batch.totalVertices:0;

// 120. 원본 id 들의 레코드 z 를 새 값으로 바꾼다(레코드 점 배열과 GPU 정점 둘 다).
// depthOf(record) 가 새 z 를 준다. 고친 덩어리 목록을 돌려준다. 못 하면 null.
export function setRecordDepthInPlace(batch,ids,depthOf,{uploadVertices=UPLOAD_VERTICES}={}){
  if(batch.template||!batch.objects?.length)return null;
  const starts=recordVertexStarts(batch),geometries=batch.objects.map(lineGeometryOf);
  if(geometries.some(child=>!child))return null;
  const changed=new Set();
  for(let i=0;i<batch.records.length;i++){
    const r=batch.records[i];if(!ids.has(r.sourceId))continue;
    const z=depthOf(r);if(!Number.isFinite(z))return null;
    for(let j=2;j<r.points.length;j+=3)r.points[j]=z;
    const start=starts[i],count=r.points.length/3;
    for(let v=start;v<start+count;v++){
      const k=Math.floor(v/uploadVertices);if(k>=geometries.length)return null;
      const child=geometries[k],position=child.geometry.getAttribute('position');
      // MLightCAD 는 덩어리 중심을 빼서 올리고 그 중심을 자식 위치로 둔다: 지역 z = z - 자식 z.
      position.setZ(v-k*uploadVertices,z-child.position.z);changed.add(k);
    }
  }
  for(const k of changed)geometries[k].geometry.getAttribute('position').needsUpdate=true;
  return [...changed].map(k=>batch.objects[k]);
}
