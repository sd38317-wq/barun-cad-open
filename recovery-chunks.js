// Small IndexedDB records, one immutable snapshot generation at a time. The
// logical key is replaced only after every page has committed successfully.
export const RECOVERY_CHUNK_PREFIX='__barun_recovery_chunks__/';
const marker='barun-recovery-chunks';
const own=(object,key,value)=>Object.defineProperty(object,key,{value,writable:true,enumerable:true,configurable:true});
const plain=value=>{if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw Error('Unsupported recovery object');};

// Geometry is immutable between engine edits. Capture the small mutable
// workspace/document headers before the first yield, including layer migration.
// Arbitrarily large extension fields stay referenced rather than cloned here.
export function captureRecoverySnapshot(value){
  if(!value||!Array.isArray(value.tabs))return value;
  plain(value);
  const seen=new WeakMap(),documents=new WeakMap(),essentialSeen=new WeakMap();let remaining=8192;
  // Layer migration mutates existing rows. This required capture must neither
  // share the optional metadata budget nor return a partially captured row.
  const essential=v=>{
    if(!v||typeof v!=='object')return v;
    plain(v);if(essentialSeen.has(v))return essentialSeen.get(v);
    const copy=Array.isArray(v)?new Array(v.length):{};essentialSeen.set(v,copy);
    for(const key in v)if(Object.hasOwn(v,key))own(copy,key,essential(v[key]));
    return copy;
  };
  const metadata=v=>{
    if(!v||typeof v!=='object')return v;
    plain(v);
    if(seen.has(v))return seen.get(v);
    if(!remaining||Array.isArray(v)&&v.length>4096)return v;
    const keys=[];for(const key in v)if(Object.hasOwn(v,key)){if(keys.length>=(Array.isArray(v)?4096:256))return v;keys.push(key);}
    remaining--;const copy=Array.isArray(v)?new Array(v.length):{};seen.set(v,copy);
    for(const key of keys)own(copy,key,metadata(v[key]));return copy;
  };
  const document=doc=>{
    if(!doc||typeof doc!=='object')return doc;
    plain(doc);
    if(documents.has(doc))return documents.get(doc);
    const copy={};documents.set(doc,copy);
    for(const key of Object.keys(doc))own(copy,key,key==='layers'?essential(doc[key]):['entities','sharedBlocks','blocks'].includes(key)?doc[key]:metadata(doc[key]));
    return copy;
  };
  const snapshot={};
  for(const key of Object.keys(value))if(key!=='tabs')own(snapshot,key,metadata(value[key]));
  snapshot.tabs=value.tabs.map(tab=>{
    plain(tab);
    const copy={};for(const key of Object.keys(tab)){
      const v=tab[key];own(copy,key,key==='doc'||key==='recoveryUndo'?document(v):key==='undoStack'||key==='redoStack'?v?.map(document):metadata(v));
    }return copy;
  });
  return snapshot;
}

const scalarBytes=value=>typeof value==='string'?16+6*value.length:24;
function leafBytes(value,limit){
  let bytes=32,count=0;
  for(const key in value)if(Object.hasOwn(value,key)){
    if(++count>32)return null;
    const child=value[key];if(child!==null&&typeof child==='object'||!['string','number','boolean','undefined'].includes(typeof child)&&child!==null)return null;
    bytes+=scalarBytes(key)+scalarBytes(child);if(bytes>limit)return null;
  }
  // A sparse giant array must never be mistaken for a tiny inline leaf.
  if(Array.isArray(value)&&value.length>32)return null;
  return bytes;
}
function immutableRoots(value){
  const roots=new WeakSet();
  const document=doc=>{for(const key of ['entities','sharedBlocks','blocks']){const v=doc?.[key];if(v&&typeof v==='object')roots.add(v);}};
  for(const tab of Array.isArray(value?.tabs)?value.tabs:[]){
    document(tab.doc);document(tab.recoveryUndo);
    for(const key of ['undoStack','redoStack'])if(Array.isArray(tab[key]))for(const doc of tab[key])document(doc);
  }
  return roots;
}
function* encode(value,maxBytes,{seen,baseline,stats}){
  const roots=immutableRoots(value);let serial=0;
  function* visit(v,immutable=false){
    if(v===null||typeof v!=='object'){
      if(!['string','number','boolean','undefined'].includes(typeof v)&&v!==null)throw Error('Unsupported recovery value');
      if(typeof v==='string'&&scalarBytes(v)>maxBytes/2){
        yield {token:['s'],bytes:16};const length=Math.max(1,Math.floor((maxBytes-160)/6));
        for(let i=0;i<v.length;i+=length){const part=v.slice(i,i+length);yield {token:['t',part],bytes:24+6*part.length};}
        yield {token:['e'],bytes:16};
      }else yield {token:['p',v],bytes:24+scalarBytes(v)};
      return;
    }
    immutable=immutable||roots.has(v);
    if(seen.has(v)){yield {token:['r',Math.floor(seen.get(v)/2)],bytes:32};return;}
    // The low bit proves this ID was encoded below an immutable geometry root.
    // Metadata sharing alone never authorizes reuse across snapshots.
    const previous=immutable?baseline?.ids.get(v):undefined;
    if(previous!==undefined&&previous%2===1){stats.references++;yield {token:['x',Math.floor(previous/2)],bytes:32};return;}
    plain(v);
    const id=serial++;seen.set(v,id*2+Number(immutable));const bytes=leafBytes(v,maxBytes/2-32);
    if(bytes!==null){yield {token:['v',id,v,immutable],bytes:40+bytes};return;}
    yield {token:Array.isArray(v)?['A',id,v.length,immutable]:['o',id,null,immutable],bytes:48};
    if(Array.isArray(v)){
      // Dense arrays retain their compact positional encoding. A key marker
      // handles holes/extra own properties without scanning a huge sparse length.
      let index=0;
      for(const key in v)if(Object.hasOwn(v,key)){
        if(key!==String(index)){yield {token:['k'],bytes:16};yield* visit(key);}
        yield* visit(v[key],immutable);
        const n=Number(key);if(Number.isInteger(n)&&n>=0&&n<v.length&&String(n)===key)index=n+1;
      }
    }
    else for(const key in v)if(Object.hasOwn(v,key)){yield* visit(key);yield* visit(v[key],immutable);}
    yield {token:['e'],bytes:16};
  }
  yield* visit(value);
}
function decoder(externalNodes=null,onNode=()=>{}){
  const nodes=new Map(),stack=[];let root,hasRoot=false;
  const attach=value=>{
    const frame=stack.at(-1);
    if(!frame){if(hasRoot)throw Error('Invalid recovery root');root=value;hasRoot=true;return;}
    if(frame.kind==='A'&&frame.property){
      if(frame.key===null){if(typeof value!=='string'||value==='length')throw Error('Invalid recovery array key');frame.key=value;}
      else{
        own(frame.value,frame.key,value);
        const n=Number(frame.key);if(Number.isInteger(n)&&n>=0&&n<frame.value.length&&String(n)===frame.key)frame.index=n+1;
        frame.key=null;frame.property=false;
      }
    }
    else if(frame.kind==='a'||frame.kind==='A'){if(frame.index>=frame.value.length)throw Error('Invalid recovery array');frame.value[frame.index++]=value;}
    else if(frame.kind==='o'){
      if(frame.key===null){if(typeof value!=='string')throw Error('Invalid recovery key');frame.key=value;}
      else{own(frame.value,frame.key,value);frame.key=null;}
    }else throw Error('Invalid recovery string');
  };
  return {
    accept(token){
      if(!Array.isArray(token))throw Error('Invalid recovery token');
      const [kind,id,payload]=token;
      if(kind==='p'){attach(id);return;}
      if(kind==='r'){if(!nodes.has(id))throw Error('Missing recovery reference');attach(nodes.get(id));return;}
      if(kind==='x'){if(!externalNodes?.has(id))throw Error('Missing recovery baseline reference');attach(externalNodes.get(id));return;}
      if(kind==='k'){const frame=stack.at(-1);if(frame?.kind!=='A'||frame.property)throw Error('Invalid recovery array key');frame.property=true;return;}
      if(kind==='s'){stack.push({kind:'s',parts:[]});return;}
      if(kind==='t'){const frame=stack.at(-1);if(frame?.kind!=='s'||typeof id!=='string')throw Error('Invalid recovery string');frame.parts.push(id);return;}
      if(kind==='e'){
        const frame=stack.pop();if(!frame||frame.kind==='o'&&frame.key!==null||frame.kind==='a'&&frame.index!==frame.value.length||frame.kind==='A'&&frame.property)throw Error('Incomplete recovery object');
        if(frame.kind==='s')attach(frame.parts.join(''));return;
      }
      if(!['a','A','o','v'].includes(kind)||!Number.isSafeInteger(id)||id<0||nodes.has(id))throw Error('Invalid recovery node');
      if((kind==='a'||kind==='A')&&(!Number.isSafeInteger(payload)||payload<0))throw Error('Invalid recovery length');
      const value=kind==='v'?payload:kind==='a'||kind==='A'?new Array(payload):{};
      if(!value||typeof value!=='object')throw Error('Invalid recovery leaf');
      nodes.set(id,value);onNode(id,value,token[3]===true);attach(value);
      if(kind!=='v')stack.push({kind,value,key:null,index:0});
    },
    finish(){if(stack.length||!hasRoot)throw Error('Incomplete recovery snapshot');return root;},
    nodes,
  };
}

export function createChunkedRecoveryAdapter(backend,{maxRecordBytes=65536,budgetMs=4,rebaseRatio=.5,maxDeltaWrites=Infinity,yield:pause=()=>new Promise(resolve=>setTimeout(resolve,0)),now=()=>performance.now(),newId=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),lock=globalThis.navigator?.locks?.request?operation=>globalThis.navigator.locks.request('barun-cad-recovery-storage',{mode:'exclusive'},operation):null}={}){
  if(maxRecordBytes<256||!Number.isFinite(maxRecordBytes))throw Error('Recovery record budget is too small');
  if(!(rebaseRatio>0)||!(maxDeltaWrites>=1))throw Error('Invalid recovery rebase policy');
  let queue=Promise.resolve(),baseline=null;
  // Reads must hold the same cross-context lock as writes and collection:
  // otherwise another window could retire pages after we read their manifest.
  const serial=operation=>{const result=queue.then(()=>lock?lock(operation):operation());queue=result.catch(()=>{});return result;};
  const internal=key=>typeof key==='string'&&key.startsWith(RECOVERY_CHUNK_PREFIX);
  const manifest=value=>value?.format===marker;
  const base=id=>RECOVERY_CHUNK_PREFIX+id+'/';
  const logicalKey=key=>{if(internal(key))throw Error('Reserved recovery key');};
  const descriptor=value=>!!value&&typeof value.generation==='string'&&/^[-a-zA-Z0-9_]+$/.test(value.generation)&&Number.isSafeInteger(value.pages)&&value.pages>0;
  async function complete(value){
    if(!descriptor(value))return null;
    const record=await backend.get(base(value.generation)+'complete');
    return manifest(record)&&record.complete===true&&record.generation===value.generation&&record.pages===value.pages&&Number.isFinite(record.bytes)&&record.bytes>0?record:null;
  }
  async function decodePages(value,externalNodes=null,onNode){
    if(!descriptor(value))throw Error('Unsupported recovery manifest');
    const decode=decoder(externalNodes,onNode);let start=now(),count=0;
    for(let i=0;i<value.pages;i++){
      const page=await backend.get(base(value.generation)+'p/'+i);
      if(page?.format!==marker||!Array.isArray(page.tokens))throw Error('Missing recovery page');
      for(const token of page.tokens){decode.accept(token);if(++count%64===0&&now()-start>=budgetMs){await pause();start=now();}}
      await pause();start=now();
    }
    return {value:decode.finish(),nodes:decode.nodes};
  }
  async function read(key){
    const value=await backend.get(key);if(!manifest(value))return value;
    if(value.version===1)return (await decodePages(value)).value;
    if(value.version!==2||!descriptor(value)||!['full','delta'].includes(value.kind))throw Error('Unsupported recovery manifest');
    const source=value.kind==='delta'?value.baseline:value,record=await complete(source);
    if(!record)throw Error('Missing recovery baseline');
    // Merge same-generation decoded identities into the existing weak index;
    // a read must not invalidate identities of the still-open drawing.
    const adopt=!baseline||baseline.generation===source.generation;
    const ids=adopt?(baseline?.ids||new WeakMap()):null;
    const decoded=await decodePages(source,null,ids?(id,node,immutable)=>ids.set(node,id*2+Number(immutable)):undefined);
    const result=value.kind==='delta'?(await decodePages(value,decoded.nodes)).value:decoded.value;
    if(adopt&&!baseline)baseline={generation:source.generation,pages:source.pages,bytes:record.bytes,ids,writes:0,rebase:false};
    return result;
  }
  async function write(key,value){
    if(value===undefined){await backend.put(key,undefined);return;}
    // Another adapter may have retired this generation since our previous
    // write. Only the complete marker, checked under the storage lock, proves
    // its pages have not begun collection. No-lock mode remains standalone.
    let previous=lock&&baseline&&!baseline.rebase&&baseline.writes<maxDeltaWrites?baseline:null;
    if(previous&&!await complete(previous))previous=null;
    const generation=newId();if(typeof generation!=='string'||!/^[-a-zA-Z0-9_]+$/.test(generation))throw Error('Invalid recovery generation');
    const prefix=base(generation),stage=prefix+'stage',dependency=previous?{generation:previous.generation,pages:previous.pages}:null;
    const seen=new WeakMap(),stats={references:0};let page=0,tokens=[],bytes=96,totalBytes=0,start=now(),count=0;
    await backend.put(stage,{format:marker,stage:true,generation,...(dependency?{baseline:dependency}:{})});
    const flush=async()=>{
      if(!tokens.length)return;
      const record={format:marker,tokens};totalBytes+=bytes;tokens=[];bytes=96;
      await backend.put(prefix+'p/'+page++,record);await pause();start=now();
    };
    try{
      for(const item of encode(value,maxRecordBytes,{seen,baseline:previous,stats})){
        if(bytes+item.bytes>maxRecordBytes)await flush();
        tokens.push(item.token);bytes+=item.bytes;
        if(++count%64===0&&now()-start>=budgetMs){await pause();start=now();}
      }
      await flush();
      // A snapshot with no external references is already a standalone full
      // generation, even when we attempted to reuse a previous drawing.
      const delta=stats.references>0;
      if(!delta)await backend.put(prefix+'complete',{format:marker,complete:true,generation,pages:page,bytes:totalBytes});
      await backend.put(key,{format:marker,version:2,kind:delta?'delta':'full',generation,pages:page,...(delta?{baseline:dependency}:{})});
      // Neither a failed page nor a failed logical commit promotes this index.
      if(delta){previous.writes++;previous.rebase=totalBytes>previous.bytes*rebaseRatio;}
      else baseline={generation,pages:page,bytes:totalBytes,ids:seen,writes:0,rebase:false};
    }catch(error){await backend.put(stage,undefined).catch(()=>{});throw error;}
    // A leftover stage is safe (cleanup retains it), so housekeeping failure
    // after the manifest commit must not report the successful save as lost.
    await backend.put(stage,undefined).catch(()=>{});
  }
  return {
    get(key){logicalKey(key);return serial(()=>read(key));},
    put(key,value){logicalKey(key);const captured=captureRecoverySnapshot(value);return serial(()=>write(key,captured));},
    keys(){return serial(async()=>(await backend.keys()).filter(key=>!internal(key)));},
    // Point another key at the same immutable generation (no page copy). Cleanup
    // treats every logical manifest, and its baseline, as a GC root.
    alias(fromKey,toKey){logicalKey(fromKey);logicalKey(toKey);return serial(async()=>{const value=await backend.get(fromKey);await backend.put(toKey,value);return value!==undefined;});},
    cleanup(){return serial(async()=>{
      // Local queues alone cannot prove that another window has finished an
      // older-generation read. Keep garbage when Web Locks are unavailable.
      if(!lock)return 0;
      const keys=await backend.keys(),live=new Set();
      // Scan every logical manifest, including current and all session keys.
      // In-progress stages from another writer are conservative GC roots.
      for(const key of keys){
        if(internal(key)&&!key.endsWith('/stage'))continue;
        const value=await backend.get(key);
        if(manifest(value)){
          if(typeof value.generation!=='string')throw Error('Cannot safely clean recovery manifests');
          live.add(value.generation);
          if(value.baseline!==undefined){if(!descriptor(value.baseline))throw Error('Cannot safely clean recovery baseline');live.add(value.baseline.generation);}
        }
      }
      let removed=0;
      const garbage=keys.filter(key=>internal(key)&&!live.has(key.slice(RECOVERY_CHUNK_PREFIX.length).split('/')[0]));
      // Invalidate baseline reuse before deleting any page. If collection is
      // interrupted, a stale adapter sees a missing marker and writes a full
      // generation, even if some arbitrary old page happens to remain.
      for(const key of [...garbage.filter(key=>key.endsWith('/complete')),...garbage.filter(key=>!key.endsWith('/complete'))]){
        const generation=key.slice(RECOVERY_CHUNK_PREFIX.length).split('/')[0];
        if(!live.has(generation)){await backend.put(key,undefined);removed++;await pause();}
      }
      return removed;
    });},
  };
}
