// Bounds are in the renderer's local, double-precision coordinate frame.
export function positionBounds(values, stride=3) {
  const b={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(let i=0;i<values.length;i+=stride){b.minX=Math.min(b.minX,values[i]);b.maxX=Math.max(b.maxX,values[i]);b.minY=Math.min(b.minY,values[i+1]);b.maxY=Math.max(b.maxY,values[i+1]);}
  return b;
}
export function unionBounds(entries) {
  const b={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(const e of entries){const a=e.bounds;b.minX=Math.min(b.minX,a.minX);b.maxX=Math.max(b.maxX,a.maxX);b.minY=Math.min(b.minY,a.minY);b.maxY=Math.max(b.maxY,a.maxY);}
  return b;
}
const overlaps=(a,b)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minY<=b.maxY&&a.maxY>=b.minY;
// Median split by quickselect along the longer axis: linear per level, so a
// 500k-record scene chunks in O(n log n) instead of re-sorting every level.
// Only which half a record lands in matters; each record keeps its own depth.
const centre=(e,axis)=>axis?e.bounds.minY+e.bounds.maxY:e.bounds.minX+e.bounds.maxX;
function select(xs,k,axis){let lo=0,hi=xs.length-1;while(hi>lo){const pivot=centre(xs[(lo+hi)>>1],axis);let i=lo,j=hi;while(i<=j){while(centre(xs[i],axis)<pivot)i++;while(centre(xs[j],axis)>pivot)j--;if(i<=j){const t=xs[i];xs[i]=xs[j];xs[j]=t;i++;j--;}}if(k<=j)hi=j;else if(k>=i)lo=i;else return;}}
function split(entries,b){
  const axis=b.maxX-b.minX>=b.maxY-b.minY?0:1,xs=entries.slice(),middle=xs.length>>1;
  select(xs,middle,axis);return [xs.slice(0,middle),xs.slice(middle)];
}
// ACAD200 107: binned surface-area heuristic (2D: half perimeter). Each node
// compares 2 axes x 16 bins of expected query cost (box size x entry count)
// and cuts at the cheapest place: long site lines no longer stretch the boxes
// of a dense plan beside them. Linear per node like the median split; small
// nodes, non-finite bounds or a cut no better than the median use the median.
export const SAH_MIN_ENTRIES=64;
export function splitSah(entries,b,bins=16){
  const n=entries.length;if(n<SAH_MIN_ENTRIES)return split(entries,b);
  // One pass: centres (doubled, as centre() gives) and their ranges.
  const cx=new Float64Array(n),cy=new Float64Array(n);let lx=Infinity,hx=-Infinity,ly=Infinity,hy=-Infinity;
  for(let i=0;i<n;i++){const a=entries[i].bounds,x=a.minX+a.maxX,y=a.minY+a.maxY;cx[i]=x;cy[i]=y;if(x<lx)lx=x;if(x>hx)hx=x;if(y<ly)ly=y;if(y>hy)hy=y;}
  const box=new Float64Array(bins*4),count=new Int32Array(bins),left=new Float64Array(bins),right=new Float64Array(bins),bin=new Uint8Array(n);
  let best=null;
  for(let axis=0;axis<2;axis++){
    const c=axis?cy:cx,lo=axis?ly:lx,span=(axis?hy:hx)-lo;if(!(span>0)||!Number.isFinite(span))continue;
    for(let k=0;k<bins;k++){box[k*4]=box[k*4+1]=Infinity;box[k*4+2]=box[k*4+3]=-Infinity;}count.fill(0);
    const factor=bins/span;
    for(let i=0;i<n;i++){
      const k=Math.min(bins-1,(c[i]-lo)*factor|0),o=k*4,a=entries[i].bounds;count[k]++;
      if(a.minX<box[o])box[o]=a.minX;if(a.minY<box[o+1])box[o+1]=a.minY;if(a.maxX>box[o+2])box[o+2]=a.maxX;if(a.maxY>box[o+3])box[o+3]=a.maxY;
    }
    // Prefix/suffix half perimeters of the union of bins.
    let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;
    for(let k=0;k<bins;k++){const o=k*4;if(count[k]){mnx=Math.min(mnx,box[o]);mny=Math.min(mny,box[o+1]);mxx=Math.max(mxx,box[o+2]);mxy=Math.max(mxy,box[o+3]);}left[k]=Math.max(0,mxx-mnx)+Math.max(0,mxy-mny);}
    mnx=Infinity;mny=Infinity;mxx=-Infinity;mxy=-Infinity;
    for(let k=bins-1;k>=0;k--){const o=k*4;if(count[k]){mnx=Math.min(mnx,box[o]);mny=Math.min(mny,box[o+1]);mxx=Math.max(mxx,box[o+2]);mxy=Math.max(mxy,box[o+3]);}right[k]=Math.max(0,mxx-mnx)+Math.max(0,mxy-mny);}
    let nl=0;
    for(let k=1;k<bins;k++){
      nl+=count[k-1];if(!nl||nl===n)continue;
      const cost=left[k-1]*nl+right[k]*(n-nl);
      if(Number.isFinite(cost)&&(!best||cost<best.cost))best={cost,axis,k,lo,factor};
    }
  }
  if(!best)return split(entries,b);
  // The balanced median cut (its expected cost from the same bins: half the
  // entries each side) is the reference: SAH must expect a cheaper query.
  const c=best.axis?cy:cx,a=[],d=[];
  for(let i=0;i<n;i++)(Math.min(bins-1,(c[i]-best.lo)*best.factor|0)<best.k?a:d).push(entries[i]);
  // A very lopsided cut of evenly spread entries is left to the median (it
  // keeps the tree shallow); a lopsided cut that isolates a cheap group stays.
  if(!a.length||!d.length)return split(entries,b);
  return [a,d];
}
// ACAD200 106: spatial cell (line batch leaf) capacity in segments. 512 is the
// measured default; BARUN_GPU_CELL_CAPACITY (e.g. 1024 like AutoCAD) overrides it.
export function gpuCellCapacity(){const n=Number(globalThis.BARUN_GPU_CELL_CAPACITY);return Number.isInteger(n)&&n>=64&&n<=65536?n:512;}
// Split by position, not input order. A source polyline's retained fragments
// keep their original dash distances and depth through this permutation.
export function spatialChunks(entries,maxWeight=512,weight=e=>e.points.length/6) {
  const chunks=[];
  function visit(xs){if(!xs.length)return;const n=xs.reduce((sum,e)=>sum+weight(e),0);if(n<=maxWeight||xs.length===1){chunks.push(xs);return;}for(const half of split(xs,unionBounds(xs)))visit(half);}
  visit(entries);return chunks;
}
// Mutable, height-balanced BVH. Each edit touches one small leaf and its
// ancestor path; moving one curve must not rebuild the drawing-wide index.
export function createViewportIndex(entries,options) {
  const steps=createViewportIndexSteps(entries,0,options);let step;do step=steps.next();while(!step.done);return step.value;
}
// The same index, built a few hundred nodes per step. A sliced scene build
// yields between steps so a million-detail index never holds one frame.
export function* createViewportIndexSteps(entries,stepNodes=256,{sah=false}={}) {
  const cut=sah?splitSah:split;
  const locations=new Map();let pixelMargin=0,worldMargin=0,mutationNodes=0;
  const margin=e=>{pixelMargin=Math.max(pixelMargin,e.pixelMargin||0);worldMargin=Math.max(worldMargin,e.worldMargin||0);};
  const refit=n=>{n.bounds=unionBounds(n.entries||[n.left,n.right]);n.height=n.entries?0:1+Math.max(n.left.height,n.right.height);};
  function build(xs,parent=null){
    if(!xs.length)return null;
    const n={parent,bounds:unionBounds(xs),height:0};
    if(xs.length<=8){n.entries=xs.slice();for(const e of xs){locations.set(e,n);margin(e);}}
    else{const [a,b]=cut(xs,n.bounds);n.left=build(a,n);n.right=build(b,n);refit(n);}return n;
  }
  // Same tree as build(): the same median split at every node, with heights set
  // bottom-up afterwards. An explicit stack lets the construction pause.
  function* buildSteps(xs){
    if(!xs.length)return null;
    const root={parent:null,bounds:unionBounds(xs),height:0},stack=[[root,xs]],order=[];let count=0;
    while(stack.length){
      const [n,items]=stack.pop();order.push(n);
      if(items.length<=8){n.entries=items.slice();for(const e of items){locations.set(e,n);margin(e);}}
      else{const [a,b]=cut(items,n.bounds);n.left={parent:n,bounds:unionBounds(a),height:0};n.right={parent:n,bounds:unionBounds(b),height:0};stack.push([n.right,b],[n.left,a]);}
      if(stepNodes&&++count%stepNodes===0)yield;
    }
    for(let i=order.length-1;i>=0;i--){const n=order[i];if(!n.entries)n.height=1+Math.max(n.left.height,n.right.height);}
    return root;
  }
  let root=yield* buildSteps(entries);
  const replace=(old,next)=>{const p=old.parent;if(!p)root=next;else if(p.left===old)p.left=next;else p.right=next;if(next)next.parent=p;};
  const rotateLeft=n=>{const b=n.right,t=b.left;replace(n,b);b.left=n;n.parent=b;n.right=t;t.parent=n;refit(n);refit(b);return b;};
  const rotateRight=n=>{const b=n.left,t=b.right;replace(n,b);b.right=n;n.parent=b;n.left=t;t.parent=n;refit(n);refit(b);return b;};
  function repair(n){while(n){mutationNodes++;refit(n);if(!n.entries){
    if(n.left.height-n.right.height>1){if(n.left.left.height<n.left.right.height)rotateLeft(n.left);n=rotateRight(n);}
    else if(n.right.height-n.left.height>1){if(n.right.right.height<n.right.left.height)rotateRight(n.right);n=rotateLeft(n);}
  }n=n.parent;}}
  const area=b=>Math.max(0,b.maxX-b.minX)*Math.max(0,b.maxY-b.minY);
  const growth=(n,e)=>{const value=area(unionBounds([n,e]))-area(n.bounds);return Number.isFinite(value)?value:Number.MAX_VALUE;};
  function remove(e){
    const leaf=locations.get(e);if(!leaf)return false;locations.delete(e);leaf.entries.splice(leaf.entries.indexOf(e),1);
    if(leaf.entries.length)repair(leaf);
    else if(!leaf.parent)root=null;
    else{const p=leaf.parent,sibling=p.left===leaf?p.right:p.left;replace(p,sibling);repair(sibling.parent);}return true;
  }
  function insert(e){
    if(locations.has(e))remove(e);margin(e);
    if(!root){root={parent:null,bounds:{...e.bounds},height:0,entries:[e]};locations.set(e,root);return;}
    let leaf=root;
    while(!leaf.entries){mutationNodes++;const a=growth(leaf.left,e),b=growth(leaf.right,e);leaf=a<b?leaf.left:b<a?leaf.right:leaf.left.height<=leaf.right.height?leaf.left:leaf.right;}
    leaf.entries.push(e);locations.set(e,leaf);
    if(leaf.entries.length>8){const [a,b]=split(leaf.entries,unionBounds(leaf.entries));delete leaf.entries;leaf.left=build(a,leaf);leaf.right=build(b,leaf);}
    repair(leaf);
  }
  return {
    insert(e){mutationNodes=0;insert(e);},
    remove(e){mutationNodes=0;return remove(e);},
    update(e){mutationNodes=0;remove(e);insert(e);},
    get size(){return locations.size;},
    get height(){return root?.height||0;},
    get mutationNodes(){return mutationNodes;},
    query(box,scale=1,stats){
      const margin=worldMargin+pixelMargin/Math.max(scale,1e-12),q={minX:box.minX-margin,maxX:box.maxX+margin,minY:box.minY-margin,maxY:box.maxY+margin},found=[];
      function visit(node){if(!node)return;if(stats)stats.nodes=(stats.nodes||0)+1;if(!overlaps(node.bounds,q))return;if(node.entries){for(const e of node.entries){if(stats)stats.entries=(stats.entries||0)+1;const m=(e.worldMargin||0)+(e.pixelMargin||0)/Math.max(scale,1e-12);if(overlaps(e.bounds,{minX:box.minX-m,maxX:box.maxX+m,minY:box.minY-m,maxY:box.maxY+m}))found.push(e);}}else{visit(node.left);visit(node.right);}}
      visit(root);return found;
    },
  };
}
