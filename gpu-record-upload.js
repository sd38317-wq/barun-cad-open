// Preserve double precision until the existing Float32 GPU conversion. Stream
// records in bounded chunks instead of flattening a whole batch twice.
export function* gpuRecordUploads(records, dashed, limit=180000) {
  if(!Number.isInteger(limit)||limit<6||limit%6)throw new RangeError('Segment-aligned upload limit required');
  let total=0;for(const record of records)total+=record.points.length;
  let ri=0,offset=0;
  for(let emitted=0;emitted<total;){
    const length=Math.min(limit,total-emitted),values=new Float64Array(length);
    const distances=dashed?new Float64Array(length/3):null;
    let at=0;
    while(at<length){
      const record=records[ri],take=Math.min(length-at,record.points.length-offset);
      values.set(record.points.subarray?record.points.subarray(offset,offset+take):record.points.slice(offset,offset+take),at);
      if(dashed)distances.set(record.distances.subarray?record.distances.subarray(offset/3,(offset+take)/3):record.distances.slice(offset/3,(offset+take)/3),at/3);
      at+=take;offset+=take;
      if(offset===record.points.length){ri++;offset=0;}
    }
    emitted+=length;yield {values,distances};
  }
}
