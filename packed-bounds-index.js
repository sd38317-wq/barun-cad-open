const finiteBounds = b => b && Number.isFinite(b.minX) && Number.isFinite(b.minY)
  && Number.isFinite(b.maxX) && Number.isFinite(b.maxY)
  && b.minX <= b.maxX && b.minY <= b.maxY;

// Construction is separate so query closures cannot retain temporary sort arrays.
function buildStorage(count, boundsAt) {
  const bounds = new Float64Array(count * 4), ids = [];
  for (let i = 0; i < count; i++) {
    const b = boundsAt(i);
    if (!finiteBounds(b)) continue;
    bounds.set([b.minX, b.minY, b.maxX, b.maxY], i * 4);
    ids.push(i);
  }
  const childIndices = Uint32Array.from(ids);
  // A median tree has fewer than 4*ceil(n/12) nodes at leaf capacity 12.
  const capacity = ids.length ? 4 * Math.ceil(ids.length / 12) + 1 : 0;
  const temporaryBounds = new Float64Array(capacity * 4);
  const temporaryLinks = new Int32Array(capacity * 4);
  let nodeCount = 0;
  const center=(id,axis)=>bounds[id*4+axis]/2+bounds[id*4+axis+2]/2;
  const select=(start,end,middle,axis)=>{
    let lo=start,hi=end-1,budget=2*Math.ceil(Math.log2(Math.max(2,end-start)))+8;
    while(lo<hi&&budget--){const pivot=center(childIndices[(lo+hi)>>1],axis);let i=lo,j=hi;
      while(i<=j){while(center(childIndices[i],axis)<pivot)i++;while(center(childIndices[j],axis)>pivot)j--;if(i<=j){const t=childIndices[i];childIndices[i++]=childIndices[j];childIndices[j--]=t;}}
      if(middle<=j)hi=j;else if(middle>=i)lo=i;else return;
    }
    if(lo<hi)childIndices.subarray(start,end).sort((a,b)=>center(a,axis)-center(b,axis));
  };
  function build(start, end) {
    const node = nodeCount++, o = node * 4;
    if (node >= capacity) throw new RangeError('packed bounds capacity exceeded');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = start; i < end; i++) {
      const p = childIndices[i] * 4;
      minX = Math.min(minX, bounds[p]); minY = Math.min(minY, bounds[p + 1]);
      maxX = Math.max(maxX, bounds[p + 2]); maxY = Math.max(maxY, bounds[p + 3]);
    }
    temporaryBounds.set([minX, minY, maxX, maxY], o);
    if (end - start <= 12) temporaryLinks.set([-1, -1, start, end - start], o);
    else {
      const axis = maxX - minX >= maxY - minY ? 0 : 1;
      const middle = start + Math.floor((end - start) / 2);
      select(start,end,middle,axis);
      temporaryLinks.set([build(start, middle), build(middle, end), -1, -1], o);
    }
    return node;
  }
  if (ids.length) build(0, ids.length);
  return { bounds, childIndices, nodeBounds: temporaryBounds.slice(0, nodeCount * 4), nodeLinks: temporaryLinks.slice(0, nodeCount * 4) };
}

export function createPackedBoundsIndex(count, boundsAt) {
  if (!Number.isInteger(count) || count < 0 || typeof boundsAt !== 'function') throw new TypeError('invalid packed bounds input');
  const {bounds, childIndices, nodeBounds, nodeLinks} = buildStorage(count, boundsAt);
  const overlaps = (array, o, box) => !(array[o] > box.maxX || array[o + 2] < box.minX || array[o + 1] > box.maxY || array[o + 3] < box.minY);
  return {
    byteLength: bounds.byteLength + childIndices.byteLength + nodeBounds.byteLength + nodeLinks.byteLength,
    query(box) {
      if (!finiteBounds(box) || !nodeBounds.length) return [];
      const out = [], visit = [0];
      while (visit.length) {
        const o = visit.pop() * 4;
        if (!overlaps(nodeBounds, o, box)) continue;
        const length = nodeLinks[o + 3];
        if (length < 0) visit.push(nodeLinks[o], nodeLinks[o + 1]);
        else for (let i = nodeLinks[o + 2]; i < nodeLinks[o + 2] + length; i++) {
          const id = childIndices[i];
          if (overlaps(bounds, id * 4, box)) out.push(id);
        }
      }
      return out.sort((a, b) => a - b);
    }
  };
}
