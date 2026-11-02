/** S1 · 대용량 도면 스트림(양방향).
    엔진(import_stream.py)은 결과를 한 덩어리 JSON 대신 줄 단위 NDJSON(gzip)으로 보내고, 화면도 큰 문서를
    같은 형식으로 보낸다(저장·내보내기·대용량 복구). 줄마다 따로 해석하므로 100 MB 급 DXF(결과 JSON 600 MB+)도
    V8 문자열 한도(약 512M 문자)에 걸리지 않는다. end 줄의 lines/bytes/counts 로 빠진 페이지를 잡아낸다. */
export const SAFE_LINE_BYTES=32*1024*1024;
export const HARD_LINE_BYTES=256*1024*1024;   // 객체 하나가 이보다 크면 전송 불가(그 아래는 경고만)
export const LARGE_FILE_WARNING_BYTES=50*1024*1024;
export const LARGE_ENTITY_WARNING=100000;
export const LARGE_DOCUMENT_ENTITIES=50000;    // 이보다 크면 요청 본문도 줄 단위로 보낸다(app.js 자동 복구 기준과 같다)
/** 문서의 실제 무게(객체 수): 최상위 객체 + 블록·공유 블록 안의 객체. DWG/DXF 는 최상위가 4만이어도 블록 안에
    십수만 개가 들어 있어(온천 도면 21만) 최상위 수만 보면 전체 전송·복구 복사를 편집마다 하게 된다.
    cap 을 넘으면 거기서 센다(판정에는 그걸로 충분하고 큰 도면에서도 싸다). */
export function documentWeight(doc,cap=Infinity){
 let n=0;
 const add=list=>{if(!Array.isArray(list))return;n+=list.length;if(n>cap)return;for(const e of list){if(Array.isArray(e?.entities)){add(e.entities);if(n>cap)return;}}};
 add(doc?.entities);if(n>cap)return n;
 const blocks=doc?.blocks;for(const b of Array.isArray(blocks)?blocks:blocks&&typeof blocks==='object'?Object.values(blocks):[]){n++;add(b?.entities);if(n>cap)return n;}
 const shared=doc?.sharedBlocks;if(shared&&typeof shared==='object')for(const b of Object.values(shared)){add(b?.entities);if(n>cap)return n;}
 return n;
}
export const isHeavyDocument=(doc,limit=LARGE_DOCUMENT_ENTITIES)=>documentWeight(doc,limit)>limit;
export const REQUEST_CONTENT_TYPE='application/x-ndjson; charset=utf-8';
const BIG_KEYS=['entities','blocks','sharedBlocks','dxfPreservation'];
const PAGE_ITEMS=2000,PRESERVATION_PART_CHARS=8*1024*1024;

/** 파일 크기·객체 수에 따른 안내 문구. 큰 도면은 열기 전에 알린다. */
export function importSizeNotice({bytes=0,entities=0}={}){
 const mb=bytes/1048576;
 if(bytes>=LARGE_FILE_WARNING_BYTES)return `대용량 도면 ${mb.toFixed(0)} MB · 여는 데 몇 분 걸릴 수 있습니다.`;
 if(entities>=LARGE_ENTITY_WARNING)return `객체 ${entities.toLocaleString()}개 · 작업 중 수시로 저장하세요.`;
 return '';
}

/** ACAD200-801: 엔진이 객체보다 먼저 보내는 색인 줄(레이어·종류별 개수, 대략 범위, 8x8 격자 분포)을 한 줄 안내로. */
export function indexSummary(index){
 if(!index||typeof index!=='object')return '';
 const layers=Object.keys(index.layers||{}).length,b=index.bounds;
 const size=Array.isArray(b)&&b.length===4?` · 범위 약 ${Math.round((b[2]-b[0])/1000).toLocaleString()} × ${Math.round((b[3]-b[1])/1000).toLocaleString()} m`:'';
 return `객체 ${Number(index.entities||0).toLocaleString()}개 · 레이어 ${layers}개${size}`;
}
/** 줄 단위 조립기. push(Uint8Array) 로 바이트를 넣고 finish() 로 {document,report,stats} 를 받는다.
    hooks.onIndex(index): 색인 줄이 오면 객체를 받기 전에 바로 부른다(없는 옛 엔진·캐시도 그대로 받는다). */
export function createImportAssembler(hooks={},onIndex=hooks.onIndex){
 let document=null,report=null,end=null,lines=0,bytes=0,maxLine=0,preservationMeta=null,counts=null,index=null;
 const entities=[],blocks=[],shared=new Map(),preservationParts=[];
 const pending=[];let pendingBytes=0;
 const decoder=new TextDecoder('utf-8');
 function record(value,size){
  if(value.kind!=='end'){lines++;bytes+=size+1;}
  switch(value.kind){
   case 'header':document={...value.document};report=value.report;counts=value.counts||null;if(hooks.onHeader)try{hooks.onHeader(document);}catch{}break;
   case 'index':index=value;try{onIndex?.(value);}catch{}break;
   case 'entities':for(const item of value.items)entities.push(item);if(hooks.onEntities)try{hooks.onEntities(value.items,entities.length,value.items.length);}catch{}break;
   case 'blocks':for(const item of value.items)blocks.push(item);break;
   case 'sharedBlock':{let definition=shared.get(value.name);if(!definition){definition={};for(const [key,item] of Object.entries(value))if(!['kind','name','part','last','entities'].includes(key))definition[key]=item;definition.entities=[];shared.set(value.name,definition);}for(const item of value.entities||[])definition.entities.push(item);break;}
   case 'preservationMeta':preservationMeta={};for(const [key,item] of Object.entries(value))if(key!=='kind')preservationMeta[key]=item;break;
   case 'preservation':preservationParts.push(String(value.data||''));break;
   case 'end':end=value;break;
   default:throw Error('도면 엔진 응답 형식을 알 수 없습니다.');
  }
 }
 function line(raw){
  if(raw.length>HARD_LINE_BYTES)throw Error('도면 엔진 응답 한 줄이 허용 크기를 초과했습니다.');
  if(!raw.length)return;
  maxLine=Math.max(maxLine,raw.length);
  let value;try{value=JSON.parse(decoder.decode(raw));}catch{throw Error('도면 엔진 응답이 중간에 끊겼거나 형식이 손상되었습니다.');}
  record(value,raw.length);
 }
 function concat(parts){const total=parts.reduce((sum,part)=>sum+part.length,0),out=new Uint8Array(total);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;}
 return {
  push(chunk){
   let start=0;
   for(let index=0;index<chunk.length;index++){
    if(chunk[index]!==0x0a)continue;
    const piece=chunk.subarray(start,index);
    if(pending.length){pending.push(piece);line(concat(pending));pending.length=0;pendingBytes=0;}
    else line(piece);
    start=index+1;
   }
   if(start<chunk.length){const rest=chunk.slice(start);pendingBytes+=rest.length;if(pendingBytes>HARD_LINE_BYTES)throw Error('도면 엔진 응답 한 줄이 허용 크기를 초과했습니다.');pending.push(rest);}
  },
  finish(){
   if(pending.length){line(concat(pending));pending.length=0;}
   if(!document||!end)throw Error('도면 엔진 응답이 중간에 끊겼습니다.');
   // 무결성: end 줄의 줄 수·바이트·개수와 대조해 빠진 페이지를 잡는다.
   const got={entities:entities.length,blocks:blocks.length,sharedBlocks:shared.size,preservationParts:preservationParts.length};
   for(const [key,expected] of Object.entries(end.counts||{}))if(key in got&&got[key]!==expected)throw Error(`전송된 도면 자료가 불완전합니다 (${key} ${got[key].toLocaleString()}/${Number(expected).toLocaleString()}). 다시 여세요.`);
   if(Number.isFinite(end.lines)&&end.lines!==lines)throw Error(`전송된 도면 자료가 불완전합니다 (줄 ${lines}/${end.lines}). 다시 여세요.`);
   if(Number.isFinite(end.bytes)&&end.bytes!==bytes)throw Error('전송된 도면 자료가 불완전합니다 (크기 불일치). 다시 여세요.');
   document.entities=entities;document.blocks=blocks;
   if(shared.size)document.sharedBlocks=Object.fromEntries(shared);
   if(preservationMeta)document.dxfPreservation={...preservationMeta,data:preservationParts.join('')};
   return {document,report,index,stats:{lines,maxLineBytes:maxLine,entities:entities.length,oversizedLines:maxLine>SAFE_LINE_BYTES}};
  },
  get progress(){return {entities:entities.length,expected:counts?.entities??null,lines,maxLineBytes:maxLine,index:index?indexSummary(index):''};}
 };
}

/** fetch 응답을 받아 {document,report} 로 조립한다. NDJSON 이 아니면(오류 JSON 등) 예전처럼 한 번에 읽는다. */
export async function receiveImportStream(response,options={}){
 const {onProgress,onIndex}=options;
 const type=response.headers.get('Content-Type')||'';
 if(!/x-ndjson/i.test(type)||!response.body){
  const text=await response.text();
  if(!text.trim())throw Error('도면 엔진 응답이 중간에 끊겼습니다.');
  const result=JSON.parse(text);if(options.onEntities&&result.document?.entities)try{options.onEntities(result.document.entities,result.document.entities.length,result.document.entities.length);}catch{}return result;
 }
 let received=0;
 // 색인이 오면 기다리지 않고 바로 알린다: 큰 도면도 첫 줄 몇 KB 만에 객체 수·레이어·범위를 보여 준다.
 const assembler=createImportAssembler(options,index=>{onIndex?.(index);const p=assembler?.progress;onProgress?.({stage:'도면 색인을 받았습니다 · '+indexSummary(index),received,entities:0,expected:index.entities??p?.expected??null,percent:0});}),reader=response.body.getReader();
 let lastReport=0;
 for(;;){
  const {done,value}=await reader.read();
  if(done)break;
  received+=value.length;assembler.push(value);
  const now=Date.now();
  if(onProgress&&now-lastReport>=120){lastReport=now;const p=assembler.progress;onProgress({stage:'도면 객체를 화면에 전달하고 있습니다.',received,entities:p.entities,expected:p.expected,percent:p.expected?p.entities/p.expected:null});}
 }
 const result=assembler.finish();
 onProgress?.({stage:'객체 목록을 정리하고 있습니다.',received,entities:result.stats.entities,expected:result.stats.entities,percent:1});
 if(result.report)result.report.transfer={format:'ndjson',lines:result.stats.lines,maxLineBytes:result.stats.maxLineBytes,indexed:!!result.index};
 return {document:result.document,report:result.report};
}

/** 화면 → 엔진 요청 본문. 문서가 크면 줄 단위 NDJSON Blob(문자열 하나를 만들지 않는다), 아니면 예전 JSON 문자열.
    반환 {body, contentType, streamed}. 서버(import_stream.read_request)는 header.report 를 나머지 필드로, document 를 조립해 돌려준다. */
export function documentRequestBody(payload,{limit=LARGE_DOCUMENT_ENTITIES}={}){
 const document=payload?.document;
 if(!document||!isHeavyDocument(document,limit))return {body:JSON.stringify(payload),contentType:'application/json',streamed:false};
 const encoder=new TextEncoder();const parts=[];let lines=0,bytes=0;
 const emit=text=>{const encoded=encoder.encode(text+'\n');parts.push(encoded);lines++;bytes+=encoded.length;};
 const report={};for(const [key,value] of Object.entries(payload))if(key!=='document')report[key]=value;
 const header={};for(const [key,value] of Object.entries(document))if(!BIG_KEYS.includes(key))header[key]=value;
 const entities=document.entities||[],blocks=document.blocks||[],shared=document.sharedBlocks||null,preservation=document.dxfPreservation||null;
 const preservationData=preservation?String(preservation.data||''):'';
 const counts={entities:entities.length,blocks:blocks.length,sharedBlocks:shared?Object.keys(shared).length:0,preservationParts:preservation?Math.max(1,Math.ceil(preservationData.length/PRESERVATION_PART_CHARS)):0};
 emit(JSON.stringify({kind:'header',version:1,report,document:header,counts:{entities:counts.entities,blocks:counts.blocks,sharedBlocks:counts.sharedBlocks},preservation:!!preservation}));
 for(let start=0;start<entities.length;start+=PAGE_ITEMS)emit(JSON.stringify({kind:'entities',items:entities.slice(start,start+PAGE_ITEMS)}));
 if(!entities.length)emit(JSON.stringify({kind:'entities',items:[]}));
 for(let start=0;start<blocks.length;start+=PAGE_ITEMS)emit(JSON.stringify({kind:'blocks',items:blocks.slice(start,start+PAGE_ITEMS)}));
 if(shared)for(const [name,definition] of Object.entries(shared)){const children=definition.entities||[];const meta={};for(const [key,value] of Object.entries(definition))if(key!=='entities')meta[key]=value;const pages=Math.max(1,Math.ceil(children.length/PAGE_ITEMS));for(let page=0;page<pages;page++)emit(JSON.stringify({kind:'sharedBlock',name,...meta,part:page,last:page===pages-1,entities:children.slice(page*PAGE_ITEMS,(page+1)*PAGE_ITEMS)}));}
 if(preservation){const meta={};for(const [key,value] of Object.entries(preservation))if(key!=='data')meta[key]=value;emit(JSON.stringify({kind:'preservationMeta',...meta}));if(!preservationData)emit(JSON.stringify({kind:'preservation',data:''}));for(let start=0;start<preservationData.length;start+=PRESERVATION_PART_CHARS)emit(JSON.stringify({kind:'preservation',data:preservationData.slice(start,start+PRESERVATION_PART_CHARS)}));}
 const end=encoder.encode(JSON.stringify({kind:'end',lines,bytes,counts})+'\n');parts.push(end);
 return {body:new Blob(parts,{type:REQUEST_CONTENT_TYPE}),contentType:REQUEST_CONTENT_TYPE,streamed:true,lines:lines+1,bytes:bytes+end.length};
}

/** N2: 같은 결과를 페이지마다 이벤트 루프에 양보하면서 만든다(2분마다 화면이 4초 멈추지 않게).
    작은 문서는 즉시 JSON 문자열을 돌려준다. */
export async function buildDocumentRequestBody(payload,{limit=LARGE_DOCUMENT_ENTITIES,yieldEvery=1,yieldFn=()=>new Promise(resolve=>setTimeout(resolve,0)),onProgress}={}){
 const document=payload?.document;
 if(!document||!isHeavyDocument(document,limit))return {body:JSON.stringify(payload),contentType:'application/json',streamed:false,yields:0};
 const encoder=new TextEncoder();const parts=[];let lines=0,bytes=0,yields=0,sinceYield=0;
 const pause=async()=>{sinceYield++;if(sinceYield>=yieldEvery){sinceYield=0;yields++;await yieldFn();onProgress?.({lines,bytes});}};
 const emit=text=>{const encoded=encoder.encode(text+'\n');parts.push(encoded);lines++;bytes+=encoded.length;};
 const report={};for(const [key,value] of Object.entries(payload))if(key!=='document')report[key]=value;
 const header={};for(const [key,value] of Object.entries(document))if(!BIG_KEYS.includes(key))header[key]=value;
 const entities=document.entities||[],blocks=document.blocks||[],shared=document.sharedBlocks||null,preservation=document.dxfPreservation||null;
 const preservationData=preservation?String(preservation.data||''):'';
 const counts={entities:entities.length,blocks:blocks.length,sharedBlocks:shared?Object.keys(shared).length:0,preservationParts:preservation?Math.max(1,Math.ceil(preservationData.length/PRESERVATION_PART_CHARS)):0};
 emit(JSON.stringify({kind:'header',version:1,report,document:header,counts:{entities:counts.entities,blocks:counts.blocks,sharedBlocks:counts.sharedBlocks},preservation:!!preservation}));
 for(let start=0;start<entities.length;start+=PAGE_ITEMS){emit(JSON.stringify({kind:'entities',items:entities.slice(start,start+PAGE_ITEMS)}));await pause();}
 if(!entities.length)emit(JSON.stringify({kind:'entities',items:[]}));
 for(let start=0;start<blocks.length;start+=PAGE_ITEMS){emit(JSON.stringify({kind:'blocks',items:blocks.slice(start,start+PAGE_ITEMS)}));await pause();}
 if(shared)for(const [name,definition] of Object.entries(shared)){const children=definition.entities||[];const meta={};for(const [key,value] of Object.entries(definition))if(key!=='entities')meta[key]=value;const pages=Math.max(1,Math.ceil(children.length/PAGE_ITEMS));for(let page=0;page<pages;page++){emit(JSON.stringify({kind:'sharedBlock',name,...meta,part:page,last:page===pages-1,entities:children.slice(page*PAGE_ITEMS,(page+1)*PAGE_ITEMS)}));await pause();}}
 if(preservation){const meta={};for(const [key,value] of Object.entries(preservation))if(key!=='data')meta[key]=value;emit(JSON.stringify({kind:'preservationMeta',...meta}));if(!preservationData)emit(JSON.stringify({kind:'preservation',data:''}));for(let start=0;start<preservationData.length;start+=PRESERVATION_PART_CHARS){emit(JSON.stringify({kind:'preservation',data:preservationData.slice(start,start+PRESERVATION_PART_CHARS)}));await pause();}}
 const end=encoder.encode(JSON.stringify({kind:'end',lines,bytes,counts})+'\n');parts.push(end);
 return {body:new Blob(parts,{type:REQUEST_CONTENT_TYPE}),contentType:REQUEST_CONTENT_TYPE,streamed:true,lines:lines+1,bytes:bytes+end.length,yields};
}

/** 서버 전체 변환 현황. 전역 개수만으로 현재 요청의 대기 여부를 판단하지 않는다. */
export function watchImportQueue({fetch:fetchImpl=(...args)=>globalThis.fetch(...args),onProgress,intervalMs=1000}={}){
 let stopped=false,timer=null;
 const tick=async()=>{
  if(stopped)return;
  try{const r=await fetchImpl('/api/status',{signal:AbortSignal.timeout(2000)});const status=await r.json();const q=status.importQueue;
   if(!stopped&&q&&(q.waiting>0||q.active>0))onProgress?.({stage:q.waiting>0?`도면을 읽고 변환하고 있습니다 (서버 전체 처리 중 ${q.active}건 · 대기 ${q.waiting}건).`:'도면을 읽고 변환하고 있습니다.',queue:q});
  }catch{}
  if(!stopped)timer=setTimeout(tick,intervalMs);
 };
 timer=setTimeout(tick,intervalMs);
 return ()=>{stopped=true;clearTimeout(timer);};
}
