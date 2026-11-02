// Isolated experiment: coordinates are independent segment pairs.
export function splitDashRecords(records, pattern, scale, {maxSegments=100000}={}) {
  if(!Array.isArray(records)||!Array.isArray(pattern)||!Number.isFinite(scale)||scale<=0||!Number.isSafeInteger(maxSegments)||maxSegments<=0)throw new TypeError('invalid dash input');
  if(!pattern.length||pattern.some(x=>!Number.isFinite(x)||x<0)||!pattern.some(x=>x>0))throw new RangeError('invalid dash pattern');
  const css=pattern.length%2?pattern.concat(pattern):pattern;
  const dash=css.map(x=>x/scale),cycle=dash.reduce((a,b)=>a+b,0);
  if(!Number.isFinite(cycle)||cycle<=0||dash.some((x,i)=>css[i]>0&&x===0))throw new RangeError('unrepresentable dash pattern');
  const out=[];let steps=0;
  for(const record of records){
    const p=record.points,d=record.distances;
    if(!(p instanceof Float64Array)||!(d instanceof Float64Array)||p.length%6||d.length!==p.length/3||p.some(x=>!Number.isFinite(x)))throw new TypeError('invalid retained record');
    for(let i=0;i<d.length;i+=2){
      const start=d[i],end=d[i+1],length=end-start;
      if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(length)||length<0)throw new RangeError('nonmonotonic segment distance');
      if(!length)continue;
      let phase=start%cycle;if(phase<0)phase+=cycle;
      let j=0;
      while(j<dash.length-1&&phase>=dash[j])phase-=dash[j++];
      let remaining=dash[j]-phase,at=0;
      while(at<length){
        if(++steps>maxSegments*4+records.length*css.length+100)throw new RangeError('dash step cap exceeded');
        if(remaining<=0){j=(j+1)%dash.length;remaining=dash[j];continue;}
        const take=Math.min(remaining,length-at),next=at+take;
        if(!(next>at))throw new RangeError('dash precision exhausted');
        if(j%2===0){
          if(out.length>=maxSegments)throw new RangeError('dash segment cap exceeded');
          const points=new Float64Array(6);
          for(let k=0;k<3;k++){const a=p[i*3+k],delta=p[(i+1)*3+k]-a;points[k]=a+delta*(at/length);points[k+3]=a+delta*(next/length);}
          out.push({...record,points,distances:new Float64Array([start+at,start+next])});
        }
        at=next;remaining-=take;
      }
    }
  }
  return out;
}
