// Cache only ID -> ordinal data. Every reuse still verifies every ID, so a
// caller mutating an array or an entity ID cannot make a stale index trusted.
// New append layers never mutate an index still used by the current proof.
class AppendedIndex {
  constructor(base,extra){this.base=base;this.extra=extra;this.size=base.size+extra.size;}
  get(id){const index=this.extra.get(id);return index===undefined?this.base.get(id):index;}
  has(id){return this.extra.has(id)||this.base.has(id);}
}
export class GpuOrderIndexCache {
  clear(){this.entry=null;}
  get(entities){
    const e=this.entry;
    if(e?.array.deref()===entities&&e.ids.length===entities.length&&e.ids.every((id,i)=>id===entities[i].id))return e.index;
    const index=new Map(),ids=new Array(entities.length);
    for(let i=0;i<entities.length;i++){const id=entities[i].id;ids[i]=id;index.set(id,i);if(index.size!==i+1){this.clear();return null;}}
    this.entry={array:new WeakRef(entities),ids,index,depth:0};return index;
  }
  // Called only after complete membership/order/depth validation succeeds.
  rememberAfter(before,after,index){
    const e=this.entry;
    if(!e||e.index!==index||e.array.deref()!==before||after.length<before.length){this.clear();return;}
    for(let i=0;i<before.length;i++)if(after[i].id!==e.ids[i]){this.clear();return;}
    const ids=after.map(entity=>entity.id);let next=index,depth=e.depth;
    if(after.length>before.length){
      if(depth>=8){next=new Map(ids.map((id,i)=>[id,i]));depth=0;}
      else {const extra=new Map();for(let i=before.length;i<after.length;i++)extra.set(ids[i],i);next=new AppendedIndex(index,extra);depth++;}
    }
    this.entry={array:new WeakRef(after),ids,index:next,depth};
  }
}
