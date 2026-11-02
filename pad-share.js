// 현장 패드(밖에서 보기) 사무실 PC 쪽: 링크·QR·기간·회수, 현장에서 온 표시·메모 받기.
// 도면은 이 PC 에서 잠가 올리고(열쇠는 링크 # 뒤), 현장이 보낸 표시·메모는 받아서 풀고 도면 그 자리에 바로 겹쳐 보인다.
// 7.0 결정: 현장에서는 도면을 못 고친다. 남길 것만 [메모로 남기기](되돌리기 한 단계), 나머지는 [지우기].
// 받으면 곧바로 "사무실 받음"을 같은 암호로 돌려보낸다(서버는 내용을 모른다).
import {sealPadJson,sealPadBytes,openPadJson,openPadBytes,newPadSessionId,randomToken,sha256Hex,padLink,fromBase64Url,toBase64Url} from './pad-crypto.js';
import {packDrawing,encodePadPack,decodePadPack,encodePadSession,decodePadSession,packSegments} from './pad-pack.js';
import {buildPadSnapshot,entityFingerprint,normalizePadBatch,planPadOps,describePadOp,isPadAck,padAck,isPadReply,padReply,measureText,PAD_PROTOCOL_VERSION,PAD_CAPABILITIES,PAD_PIN_STATES} from './pad-ops.js';
import {recordTarget,sameTarget,chunkEvents,photoJobs,linkFile,linkEvent,shouldLogReply,sessionsToMove,bytesToBase64,createOutbox,isRejected,opEvents} from './pad-records-log.js';

const STORE_KEY='barun-pad-sessions-v1',RELAY='/api/public/cad-pad/sessions',REMOTE_ORIGIN='https://barunarc.co.kr';
const PAD_UPLOAD_LIMIT=12*1024*1024; // 서버 cadPad.ts maxDrawingBytes 와 같게
// 이보다 큰 도면은 파일 창고로 보낸다(서버 메모리를 안 거친다). 작은 도면은 예전 길 그대로 — 창고에 문제가 생겨도 영향이 작게.
const PAD_STORE_OVER=4*1024*1024,PAD_STORE_LIMIT=64*1024*1024;
const POLL_MS=5000,HOURS=[[1,'1시간'],[24,'24시간'],[72,'3일'],[168,'7일']];
// 링크 목록은 도면 창(칸)끼리 같이 쓴다(공용 설정). 받기 위치는 저장하지 않는다 — 다시 켜거나 다른 창이 받아도
// 처음부터 다시 받고 이미 처리한 것(handled)만 건너뛴다. 예전에는 받기 위치를 저장해 껐다 켜면 못 고른 표시를 잃었다.
const load=()=>{try{const saved=JSON.parse(localStorage.getItem(STORE_KEY)||'[]');return Array.isArray(saved)?saved.filter(s=>s&&Date.parse(s.expiresAt)>Date.now()).map(({after,...s})=>({...s,handled:Array.isArray(s.handled)?s.handled:[]})):[];}catch{return [];}};
// 시간이 다 된 링크는 load() 가 거른다. 목록을 저장할 때 빠지는 그런 링크를 onExpired 로 먼저 알린다(현장 기록 장부에 link.expired).
let onExpired=null;
const rawSessions=()=>{try{const saved=JSON.parse(localStorage.getItem(STORE_KEY)||'[]');return Array.isArray(saved)?saved.filter(Boolean):[];}catch{return [];}};
const save=sessions=>{try{for(const s of rawSessions())if(!(Date.parse(s.expiresAt)>Date.now())&&!sessions.some(x=>x.id===s.id))onExpired?.(s);localStorage.setItem(STORE_KEY,JSON.stringify(sessions));}catch{}};
const el=(tag,props={},...children)=>{const node=Object.assign(document.createElement(tag),props);node.append(...children);return node;};

/**
 * @param {{engine,execute,toast,api,viewBox:()=>object,drawingName:()=>string,setOverlay:(entities:object[])=>void,active?:()=>boolean}} host
 */
/** 위 막대의 패드 단추(사무실에서 보기·밖에서 보기·현장 기록·현장 기록 폴더)를 [패드 ▾] 하나로 묶는다(사장님 10/21).
    원래 단추를 그대로 옮겨 담으므로 동작과 숫자 표시(현장 메모 n건 등)는 그대로이고, 새 소식이 있으면 [패드 ●]로 알린다. */
export const PAD_MENU_ITEMS=Object.freeze([
 ['pad-office','같은 Wi-Fi 패드로 이 PC 화면을 보고 조작'],
 ['pad-outside','현장 패드·휴대폰에 도면 링크(QR) 보내기, 받은 메모 고르기'],
 ['pad-records','현장에서 온 핀·실측·사진 목록과 답'],
 ['pad-records-folder','이 도면 옆 현장 기록 폴더(사진·장부) 열기'],
]);
export function installPadMenu({doc=document,items=PAD_MENU_ITEMS}={}){
 const header=doc.querySelector('header .file-actions');if(!header)return null;
 const found=items.map(([id,hint])=>[doc.getElementById(id),hint]).filter(([button])=>button);
 if(!found.length)return null;
 const wrap=doc.createElement('div');wrap.className='pad-menu';
 const main=doc.createElement('button');main.type='button';main.className='pad-menu-button';main.textContent='패드 ▾';
 main.setAttribute('aria-haspopup','menu');main.setAttribute('aria-expanded','false');main.title='사무실에서 보기 · 밖에서 보기 · 현장 기록';
 const list=doc.createElement('div');list.className='pad-menu-list';list.setAttribute('role','menu');list.hidden=true;
 // 위 막대가 넘치는 부분을 잘라 내므로 목록은 화면 기준(fixed)으로 단추 바로 아래에 띄운다.
 const setOpen=open=>{
  if(open){const r=main.getBoundingClientRect(),w=doc.defaultView?.innerWidth||1280;list.style.top=Math.round(r.bottom+6)+'px';list.style.left=Math.round(Math.max(8,Math.min(r.left,w-308)))+'px';}
  list.hidden=!open;main.setAttribute('aria-expanded',String(open));if(open)list.querySelector('button')?.focus();
 };
 for(const [button,hint] of found){
  const row=doc.createElement('div');row.className='pad-menu-row';
  const note=doc.createElement('small');note.textContent=hint;
  button.setAttribute('role','menuitem');button.classList.remove('pad-records-more');
  // 고르면 메뉴를 먼저 닫고 원래 단추의 일(대화상자 열기 등)은 그대로 한다.
  button.addEventListener('click',()=>setOpen(false));
  row.append(button,note);list.append(row);
 }
 header.insertBefore(wrap,found[0][0].parentNode===header?found[0][0]:null);wrap.append(main,list);
 // 하위 단추 중 하나라도 새 소식(pad-has-changes)이면 위 단추에 점.
 const sync=()=>{const fresh=found.some(([button])=>button.classList.contains('pad-has-changes')),connected=found.some(([button])=>button.dataset?.padState==='connected'),count=found.reduce((n,[button])=>n+(Number(button.dataset?.padCount)||0),0);main.textContent=connected?(fresh?'패드 연결됨 ● ▾':'패드 연결됨 ▾'):(fresh?'패드 ● ▾':'패드 ▾');main.classList.toggle('pad-has-changes',fresh);main.classList.toggle('connected',connected);main.setAttribute('data-pad-count',String(count));main.title=(connected?'사무실 패드 연결됨 · ':'')+(count?`현장 메모·기록 ${count}건`:'사무실에서 보기 · 밖에서 보기 · 현장 기록');};
 new MutationObserver(sync).observe(list,{subtree:true,attributes:true,attributeFilter:['class','data-pad-state','data-pad-count','data-pad-sessions'],childList:true,characterData:true});sync();
 main.onclick=()=>setOpen(list.hidden);
 doc.addEventListener('pointerdown',event=>{if(!list.hidden&&!wrap.contains(event.target))setOpen(false);});
 // 앱 단축키 처리가 Esc 를 먼저 가져가므로 잡는 단계(capture)에서 닫는다.
 (doc.defaultView||doc).addEventListener('keydown',event=>{if(event.key==='Escape'&&!list.hidden){event.stopPropagation();setOpen(false);main.focus();}},true);
 return {wrap,main,list,setOpen,sync};
}

export function installPadShare(host){
 const RECORDS_KEY='barun-pad-records';
 const loadRecords=()=>{try{const value=JSON.parse(localStorage.getItem(RECORDS_KEY)||'{}');const keep=Date.now()-30*864e5;
  return Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).filter(([,book])=>book&&Date.parse(book.expiresAt||0)>keep));}catch{return {};}};
 let records=loadRecords();
 const saveRecords=()=>{try{localStorage.setItem(RECORDS_KEY,JSON.stringify(records));}catch{}};
 let sessions=load(),relayKind=null;const pending=new Map(),baselines=new Map(),cursors=new Map(),acked=new Map();
 const active=()=>host.active?.()??true;
 // ── 현장 기록함: 받은 것·사무실이 한 일을 도면 옆 `<도면>_현장기록` 폴더 장부에 덧붙인다(field_records.py). ──
 // 링크가 끝나면 서버는 사진까지 지우므로, 사진은 받는 즉시 폴더에 저장한다. 이 PC 의 localStorage 기록은 화면용 사본일 뿐이다.
 // 폴더에 못 쓰면(NAS 끊김·디스크) 엔진이 대기 폴더에 받아 두고 스스로 다시 쓴다. 여기 줄은 엔진에 닿지 못할 때만 다시 보낸다.
 const SAVED_PHOTOS_KEY='barun-pad-photos-saved-v1',UNSEEN_KEY='barun-pad-records-unseen',PHOTO_MAX_TRIES=5;
 const loadSaved=()=>{try{const value=JSON.parse(localStorage.getItem(SAVED_PHOTOS_KEY)||'{}');return value&&typeof value==='object'?value:{};}catch{return {};}};
 const rememberPhoto=(id,info)=>{try{localStorage.setItem(SAVED_PHOTOS_KEY,JSON.stringify({...loadSaved(),[id]:info}));}catch{}};
 const fr=(action,body)=>host.api('field-records',{action,...body});
 // 문서 칸 id(탭 uuid): 창마다 다르고 복구해도 그대로라, 저장 안 한 도면의 대체 폴더를 나누고 처음 저장할 때 찾는 열쇠가 된다.
 const docKey=()=>host.docKey?.()||'';
 const currentTarget=()=>recordTarget({drawingPath:host.filePath?.()||'',name:host.drawingName(),docKey:docKey()});
 const dropped=(job,error)=>{console.warn('현장 기록을 폴더에 남기지 못했습니다:',error?.message,job);host.toast(`현장 기록 하나를 폴더에 남기지 못했습니다: ${error?.message||error}`,true);};
 // 기록 줄: 장부 사건·링크 파일·폴더 옮기기(순서대로)
 const outbox=createOutbox(async job=>{
  if(job.move)return fr('move',job.move);
  if(job.events)return fr('append',{...job.target,events:job.events});
  return fr('link',{...job.target,link:job.link});
 },{onDrop:dropped});
 // 사진 줄: 사진마다 따로(하나가 안 받아져도 다른 사진·기록은 계속). 서버에서 받기·풀기 실패는 횟수를 세고, 엔진 연결 끊김·429 는 계속 다시.
 const photoQueue=createOutbox(async job=>{
  const {session,pin,photo,at}=job.photo;
  let bytes;try{bytes=await photoBytes(session,photo);}catch(error){throw Object.assign(error,{photoFetch:true});}
  const saved=await fr('photo',{...job.target,id:photo.id,link:session.id,pinId:pin.id,pinNo:pin.no,pinKind:pin.kind,takenAt:at,data:bytesToBase64(bytes)});
  rememberPhoto(photo.id,job.target);if(!saved.existed)bumpUnseen();
 },{ordered:false,maxTries:PHOTO_MAX_TRIES,permanent:error=>error?.status===429?false:error?.photoFetch||isRejected(error),onDrop:dropped});
 const flushRecords=()=>Promise.all([outbox.flush(),photoQueue.flush()]);
 const log=(session,events)=>{const target=recordTarget(session);for(const part of chunkEvents(events))outbox.add(`${session.id}:${part[0].id}:${part.length}:${part[part.length-1].id}`,{target,events:part});};
 const logLink=(session,kind)=>{log(session,[linkEvent(session,kind)]);outbox.add(`linkfile:${session.id}:${kind}`,{target:recordTarget(session),link:linkFile(session)});};
 onExpired=session=>logLink({...session,endedAt:session.expiresAt},'expired');
 const unseen=()=>{try{return Number(localStorage.getItem(UNSEEN_KEY))||0;}catch{return 0;}};
 const refreshRecordsButton=()=>{const n=unseen();recordsButton.textContent=n?`현장 기록 폴더 · 새 ${n}`:'현장 기록 폴더';recordsButton.dataset.padCount=String(n);recordsButton.classList.toggle('pad-has-changes',n>0);};
 const setUnseen=n=>{try{localStorage.setItem(UNSEEN_KEY,String(n));}catch{}refreshRecordsButton();};
 const bumpUnseen=()=>setUnseen(unseen()+1);
 const button=el('button',{type:'button',id:'pad-outside',textContent:'밖에서 보기',title:'현장 패드·휴대폰에서 이 도면을 보고 표시·메모를 보내는 링크'});
 // 현장 기록: 누르면 이 도면의 `<도면>_현장기록` 폴더(사진·기록 장부)를 탐색기로 연다. ▾ 는 기록 창.
 const recordsButton=el('button',{type:'button',id:'pad-records-folder',textContent:'현장 기록 폴더',title:'이 도면의 현장 기록 폴더(사진·기록 장부)를 탐색기로 엽니다'});
 const recordsMore=el('button',{type:'button',id:'pad-records',className:'pad-records-more',textContent:'현장 기록',title:'현장 기록 창(핀 목록·상태·답)',ariaLabel:'현장 기록 창 열기'});
 button.dataset.padRole='field';recordsButton.dataset.padRole='records';recordsMore.dataset.padRole='records-more';
 document.querySelector('header .file-actions')?.append(button,recordsButton,recordsMore);

 // 개발 모드(BARUN_PAD_MOCK=1)에서는 이 바른 CAD 서버가 같은 규약의 모의 중계를 연다. 아니면 barunarc.co.kr 중계(배포 후).
 async function relay(){
  if(relayKind)return relayKind;
  try{const r=await fetch(`${RELAY}/${'0'.repeat(22)}`,{cache:'no-store'});relayKind=(r.headers.get('content-type')||'').includes('json')?'mock':'remote';}catch{relayKind='remote';}
  return relayKind;
 }
 async function call(path,{method='GET',body,token}={}){
  if(await relay()!=='mock'){
   // 설치본: barunarc.co.kr 중계에는 CORS 가 없어 바른 CAD 엔진(pad_relay.py)이 대신 보낸다. 세션 만들기에는 계정 토큰이 붙는다.
   const r=await host.api('pad-relay',{method,path,...(body?{body}:{}),...(token?{token}:{})});
   if(r.status===204)return null;
   if(r.status>=400){const error=Error(r.data?.error||`바른 서버 오류(${r.status})`);error.status=r.status;error.code=r.data?.code;throw error;}
   return r.data;
  }
  const response=await fetch(RELAY+path,{method,cache:'no-store',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{'x-pad-token':token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(response.status===204)return null;
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=Error(data.error||`중계 서버 오류(${response.status})`);error.status=response.status;throw error;}
  return data;
 }
 const origin=async()=>await relay()==='mock'?location.origin:REMOTE_ORIGIN;
 const pendingCount=()=>[...pending.values()].reduce((sum,list)=>sum+list.length,0);
 const refreshButton=()=>{const n=pendingCount();button.textContent=n?`현장 메모 ${n}건`:sessions.length?`밖에서 보기 · ${sessions.length}`:'밖에서 보기';button.dataset.padCount=String(n);button.dataset.padSessions=String(sessions.length);button.classList.toggle('pad-has-changes',n>0);};

 // ── 링크 만들기 ──
 const shareDialog=el('dialog',{className:'pad-share-dialog'});
 const scope=el('select',{},el('option',{value:'view',textContent:'지금 화면에 보이는 부분'}),el('option',{value:'all',textContent:'도면 전체'}));
 const hours=el('select',{},...HOURS.map(([value,label])=>el('option',{value,textContent:label,selected:value===24})));
 const createButton=el('button',{type:'button',className:'primary',textContent:'링크 만들기'});
 const result=el('div',{className:'pad-share-result'}),list=el('div',{className:'pad-share-list'}),note=el('p',{className:'pad-share-note',role:'status'});
 shareDialog.append(el('div',{className:'dialog-header'},el('h2',{textContent:'밖에서 보기 · 현장 패드'}),el('button',{type:'button',textContent:'닫기',onclick:()=>shareDialog.close()})),
  el('p',{className:'muted',textContent:'링크를 가진 사람은 로그인 없이 도면을 보고, 펜 표시·메모를 사무실로 보냅니다. 현장에서는 도면을 고칠 수 없습니다. 도면은 이 PC 에서 잠가 보내므로 서버는 내용을 못 읽습니다. 기간이 지나거나 [회수]하면 지워집니다.'}),
  el('label',{},'범위 ',scope),el('label',{},' 기간 ',hours),' ',createButton,el('button',{type:'button',textContent:'현장 기록',onclick:()=>{shareDialog.close();openRecords();}}),note,result,el('h3',{textContent:'열려 있는 링크'}),list);
 document.body.append(shareDialog);

 function renderList(){
  list.replaceChildren(...(sessions.length?sessions.map(session=>{
   const n=pending.get(session.id)?.length||0;
   return el('div',{className:'pad-share-row'},el('span',{textContent:`${session.name} · ${session.scope==='view'?'화면 범위':'전체'} · ${new Date(session.expiresAt).toLocaleString('ko-KR')}까지${n?` · 새 표시·메모 ${n}건`:''}`}),
    el('button',{type:'button',textContent:'링크 다시 보기',onclick:()=>showLink(session)}),
    el('button',{type:'button',textContent:'회수',onclick:()=>revoke(session)}));
  }):[el('p',{className:'muted',textContent:'없음'})]));
 }
 // 링크 칸: 한 줄로 잘라 보이고(열쇠 부분은 안 보여도 됨), 칸을 누르면 전체가 복사된다. [링크 복사]는 칸 끝에 붙는다(B7).
 async function showLink(session){
  const link=padLink(await origin(),session.id,session.key,session.writeToken);
  const copyLink=async()=>{try{await navigator.clipboard.writeText(link);note.textContent='링크를 복사했습니다. 열쇠가 들어 있으니 받을 사람에게만 보내세요.';}catch{input.select();note.textContent='복사하지 못했습니다. 선택된 링크를 Ctrl+C 로 복사하세요.';}};
  const input=el('input',{readOnly:true,value:link,className:'pad-share-link',title:'누르면 링크 전체가 복사됩니다',onclick:()=>{input.select();copyLink();}});
  const copy=el('button',{type:'button',className:'primary pad-share-copy',textContent:'링크 복사',onclick:copyLink});
  const qr=el('img',{alt:'패드 링크 QR',width:180,height:180});
  host.api('pad-qr',{text:link}).then(r=>{qr.src=r.qr;}).catch(()=>qr.remove());
  result.replaceChildren(el('div',{className:'pad-share-linkrow'},input,copy),qr);
 }
 createButton.onclick=async()=>{
  createButton.disabled=true;note.textContent='도면을 잠그는 중…';
  try{
   const doc=host.engine.doc,id=newPadSessionId(),key=randomToken(32),writeToken=randomToken(24);
   const {snapshot,baseline}=buildPadSnapshot(doc,{box:scope.value==='view'?host.viewBox():null,name:host.drawingName(),revision:id});
   if(!snapshot.entities.length)throw Error('보낼 객체가 없습니다. 범위를 [도면 전체]로 바꾸거나 화면을 옮기세요.');
   // 도면을 한 번 구워(곡선·해치·블록을 GPU 용 선으로) 보낸다 — 패드는 그대로 그리기만 한다(pad-pack.js).
   note.textContent=`객체 ${snapshot.entities.length.toLocaleString('ko-KR')}개를 굽는 중…`;await new Promise(resolve=>setTimeout(resolve,0));
   const packed=encodePadPack(packDrawing(snapshot,{name:snapshot.name,revision:id}));
   const meta={v:PAD_PROTOCOL_VERSION,name:snapshot.name,revision:id,units:snapshot.units,createdAt:snapshot.createdAt,capabilities:[...PAD_CAPABILITIES],...(snapshot.box?{box:snapshot.box}:{})};
   const ciphertext=await sealPadBytes(encodePadSession(meta,packed),key,id);
   const rawBytes=ciphertext.length*3/4,writeTokenHash=await sha256Hex(writeToken);
   if(rawBytes>PAD_STORE_LIMIT)throw Error(`도면 묶음이 ${(rawBytes/1048576).toFixed(1)}MB 라 너무 큽니다. 화면을 확대해 [지금 화면] 범위로 보내세요.`);
   let created=null;
   if(rawBytes>PAD_STORE_OVER){
    note.textContent=`도면 ${(rawBytes/1048576).toFixed(1)}MB 를 파일 창고에 올리는 중…`;
    created=await uploadStored(id,ciphertext,Number(hours.value),writeTokenHash).catch(error=>{if(rawBytes>PAD_UPLOAD_LIMIT)throw error;return null;});
   }
   if(!created){
    if(rawBytes>PAD_UPLOAD_LIMIT)throw Error(`도면 묶음이 ${(rawBytes/1048576).toFixed(1)}MB 라 서버 한도(12MB)를 넘습니다. 화면을 확대해 [지금 화면] 범위로 보내세요.`);
    created=await call('',{method:'POST',body:{id,ciphertext,expiresInHours:Number(hours.value),writeTokenHash}});
   }
   // drawingPath: 기록 폴더 자리(도면 옆). 저장 안 한 도면이면 빈 값 → 대체 폴더, 처음 저장할 때 docKey 로 찾아 옮긴다.
   const session={id,key,writeToken,ownerToken:created.ownerToken,expiresAt:created.expiresAt,name:snapshot.name,scope:scope.value,handled:[],
    drawingPath:host.filePath?.()||'',docKey:docKey(),createdAt:new Date().toISOString(),hours:Number(hours.value)};
   sessions=[...load().filter(s=>s.id!==id),session];save(sessions);baselines.set(id,baseline);
   logLink(session,'created');flushRecords();
   note.textContent=`객체 ${snapshot.entities.length.toLocaleString('ko-KR')}개를 보냈습니다.`;await showLink(session);renderList();refreshButton();
  }catch(error){note.textContent=error.message;}
  finally{createButton.disabled=false;}
 };
 // 파일 창고 길: 자리 받기 → 잠근 바이트 올리기 → 확인. 서버가 창고를 아직 안 열었으면(STORE_OFF·모르는 요청) 던진다.
 async function uploadStored(id,ciphertext,hoursValue,writeTokenHash){
  const bytes=fromBase64Url(ciphertext),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const made=await call('',{method:'POST',body:{id,storage:true,bytes:bytes.length,sha256,expiresInHours:hoursValue,writeTokenHash}});
  if(!made?.uploadUrl)throw Error('서버가 파일 창고 길을 모릅니다.');
  await storePut(made.uploadUrl,bytes,ciphertext);
  await call(`/${id}/ready`,{method:'POST',token:made.ownerToken,body:{}});
  return made;
 }
 async function storePut(url,bytes,b64){
  if(await relay()==='mock'){const r=await fetch(url,{method:'PUT',body:bytes});if(!r.ok)throw Error(`창고 올리기 실패(${r.status})`);return;}
  const r=await host.api('pad-relay',{store:'put',url,b64});if(r.status>=400)throw Error(r.data?.error||`창고 올리기 실패(${r.status})`);
 }
 async function storeGet(url){
  if(await relay()==='mock'){const r=await fetch(url);if(!r.ok)throw Object.assign(Error(`창고 받기 실패(${r.status})`),{status:r.status});return toBase64Url(new Uint8Array(await r.arrayBuffer()));}
  const r=await host.api('pad-relay',{store:'get',url});if(r.status>=400)throw Object.assign(Error(r.data?.error||`창고 받기 실패(${r.status})`),{status:r.status});return r.data.b64;
 }
 const photoUrls=new Map();
 async function photoBytes(session,photo){
  const {downloadUrl}=await call(`/${session.id}/blobs/${photo.id}`,{token:session.ownerToken});
  return openPadBytes(await storeGet(downloadUrl),session.key,session.id);
 }
 // 기록 폴더에 저장한 사진을 먼저 쓴다(링크가 끝나 서버에서 지워져도 보인다). 없으면 서버에서 받는다.
 async function photoUrl(session,photo){
  const key=photo.id;if(photoUrls.has(key))return photoUrls.get(key);
  // 사진 id 로 찾는다(폴더를 합치며 파일 이름이 바뀌어도 맞는 사진). 이 PC 가 저장한 자리, 없으면 링크의 기록 폴더(다른 PC 가 저장했을 수 있다).
  const saved=loadSaved()[photo.id],where=saved||(session?recordTarget(session):null);let jpeg=null;
  if(where){try{jpeg=Uint8Array.from(atob((await fr('photo-get',{...where,id:photo.id})).data),c=>c.charCodeAt(0));}catch{}}
  if(!jpeg){if(!session)throw Error('링크가 끝났고 기록 폴더에도 없습니다.');jpeg=await photoBytes(session,photo);}
  const url=URL.createObjectURL(new Blob([jpeg],{type:'image/jpeg'}));photoUrls.set(key,url);return url;
 }
 async function revoke(session){
  // 회수하면 서버의 사진도 지워진다 — 아직 폴더에 못 옮긴 사진이 있으면 먼저 보내 보고, 그래도 남으면 묻는다.
  await flushRecords();
  const left=photoQueue.pending(job=>job.photo?.session?.id===session.id);
  if(left&&!confirm(`사진 ${left}장을 아직 현장 기록 폴더에 저장하지 못했습니다${photoQueue.lastError?`(${photoQueue.lastError.message})`:''}. 지금 회수하면 그 사진은 사라집니다. 그래도 회수할까요?`))return;
  if(!confirm(`'${session.name}' 링크를 회수할까요? 서버의 도면과 아직 고르지 않은 현장 표시·메모가 지워집니다. (현장 기록 폴더에 받은 기록·사진은 남습니다)`))return;
  try{await call('/'+session.id,{method:'DELETE',token:session.ownerToken});}catch(error){if(error.status!==404){note.textContent=error.message;return;}}
  logLink({...session,revokedAt:new Date().toISOString()},'revoked');
  forget(session.id);note.textContent='회수했습니다.';result.replaceChildren();flushRecords();
 }
 function forget(id){sessions=load().filter(s=>s.id!==id);save(sessions);pending.delete(id);baselines.delete(id);cursors.delete(id);renderList();refreshButton();showPending();}
 const persist=session=>{const all=load(),i=all.findIndex(s=>s.id===session.id);if(i>=0){all[i]={...all[i],handled:[...new Set([...all[i].handled,...session.handled])]};save(all);}};

 // ── 받기: 지금 보고 있는 도면 창 하나만 5초마다 받는다(창마다 받으면 같은 표시가 겹친다). ──
 let polling=false;
 async function poll(){
  if(polling||!active())return;polling=true;sessions=load();save(sessions);const startCount=pendingCount();
  try{
   for(const session of sessions){
    const ended=()=>{logLink({...session,endedAt:new Date().toISOString()},'expired');forget(session.id);};
    if(Date.parse(session.expiresAt)<=Date.now()){ended();continue;}
    const events=[];
    let after=cursors.get(session.id)||0,newest=0,data;
    try{data=await call(`/${session.id}/ops?after=${after}`,{token:session.ownerToken});}catch(error){if(error.status===404){ended();host.toast(`'${session.name}' 현장 링크가 끝났습니다. 받은 기록·사진은 현장 기록 폴더에 남아 있습니다.`);}continue;}
    const list=pending.get(session.id)||[];
    for(const item of data.ops||[]){
     after=Math.max(after,item.seq);
     try{const value=await openPadJson(item.ciphertext,session.key,session.id);if(isPadAck(value)||isPadReply(value))continue;newest=item.seq;
      const batch=normalizePadBatch(value);batch.ops.forEach(op=>remember(session,op,item.createdAt));
      batch.ops.forEach((op,index)=>{events.push(...opEvents(session,op,item.seq,index,item.createdAt));for(const job of photoJobs(session,op,item.createdAt,loadSaved()))photoQueue.add('photo:'+job.photo.id,{target:recordTarget(session),photo:job});});batch.ops.forEach((op,index)=>{const key=`${item.seq}:${index}`;if(!session.handled.includes(key)&&!list.some(e=>e.seq===item.seq&&e.index===index))list.push({seq:item.seq,index,op,at:item.createdAt});});}
     catch(error){list.push({seq:item.seq,index:0,op:{type:'invalid'},error:error.message});newest=item.seq;}
    }
    cursors.set(session.id,after);pending.set(session.id,list);log(session,events);   // 한 번 받은 것은 한 요청으로(다시 켜서 처음부터 다시 받을 때 엔진이 장부를 한 번만 읽게)
    // 사무실 받음 알림: 새로 받은 묶음이 있을 때만(알림 자체는 다시 알리지 않는다)
    if(newest>(acked.get(session.id)||0)&&session.writeToken){
     try{await call(`/${session.id}/ops`,{method:'POST',body:{writeToken:session.writeToken,ciphertext:await sealPadJson(padAck(newest),session.key,session.id)}});acked.set(session.id,newest);}catch{}
    }
   }
   if(pendingCount()>startCount)host.toast(`현장에서 표시·메모 ${pendingCount()-startCount}건이 왔습니다. 도면에 겹쳐 보입니다. [현장 메모]를 눌러 남기거나 지우세요.`);
  }finally{polling=false;refreshButton();if(shareDialog.open)renderList();flushRecords();
   if(reviewDialog.open&&reviewSession)renderReview();else showPending();}
 }
 setInterval(poll,POLL_MS);relay().then(()=>poll());
 // 이 창이 다시 앞에 오면 다른 창이 바꾼 링크 목록·처리 기록을 다시 읽는다.
 function activated(){sessions=load();for(const [id,list] of pending){const s=sessions.find(x=>x.id===id);if(!s){pending.delete(id);continue;}pending.set(id,list.filter(e=>!s.handled.includes(`${e.seq}:${e.index}`)));}refreshButton();showPending();poll();}

 // ── 받은 것을 도면 그 자리에(B3): 고르는 창이 닫혀 있어도 모든 표시·메모를 겹쳐 둔다 ──
 const planFor=(session,keys=null)=>planPadOps(host.engine.doc,(pending.get(session.id)||[]).filter(entry=>entry.op.type!=='invalid'),{baseline:baselines.get(session.id)||new Map(),force:keys||new Set(),chosen:keys});
 // 바뀐 게 없으면 다시 그리지 않는다 — 5초마다 큰 도면 전체를 다시 그리면 끊긴다
 let shownKey='';
 function showPending(){if(reviewDialog.open)return;const list=active()?sessions.flatMap(session=>planFor(session).filter(item=>item.status==='ready'||item.status==='conflict').flatMap(item=>item.preview)):[],key=list.map(e=>e.id).join('|');if(key===shownKey)return;shownKey=key;host.setOverlay(list);}

 // ── 고르기: 남길 것은 [메모로 남기기], 필요 없는 것은 [지우기] ──
 const reviewDialog=el('dialog',{className:'pad-review-dialog'});
 const reviewList=el('div',{className:'pad-review-list'}),reviewNote=el('p',{className:'pad-review-note',role:'status'});
 const applyButton=el('button',{type:'button',className:'primary',textContent:'고른 것 메모로 남기기'}),ignoreButton=el('button',{type:'button',textContent:'고른 것 지우기'});
 reviewDialog.append(el('div',{className:'dialog-header'},el('h2',{textContent:'현장에서 온 표시·메모'}),el('button',{type:'button',textContent:'닫기',onclick:()=>reviewDialog.close()})),
  el('p',{className:'muted',textContent:'고른 것이 도면에 겹쳐 보입니다. 남기면 PAD-표시 레이어에 들어가고(되돌리기 한 번으로 취소), 지우면 이 PC 에서만 사라집니다. 도면 수정은 표시를 보고 사무실에서 직접 하거나 AI 에 시키세요.'}),
  reviewList,reviewNote,el('div',{className:'dialog-actions'},el('button',{type:'button',textContent:'현장 기록',onclick:()=>{reviewDialog.close();openRecords();}}),el('button',{type:'button',textContent:'링크 관리',onclick:()=>{reviewDialog.close();note.textContent='';result.replaceChildren();renderList();shareDialog.showModal();}}),ignoreButton,applyButton));
 reviewDialog.addEventListener('close',()=>{host.setOverlay([]);shownKey='';showPending();});
 document.body.append(reviewDialog);
 let reviewSession=null,checks=new Map();
 // 옛 링크(6.x)로 온 도면 수정 작업의 충돌 기준: 보낼 때 지문. 다시 켜서 기억이 없으면 서버의 잠긴 도면으로 다시 계산한다.
 async function baselineFor(session){
  if(baselines.has(session.id))return baselines.get(session.id);
  const {ciphertext}=await call('/'+session.id),opened=await openPadBytes(ciphertext,session.key,session.id);
  // 구운 상자(BPS1)에는 객체 지문이 없다 — 새 패드는 도면을 고치는 작업을 보내지 않으므로 빈 기준으로 둔다.
  const snapshot=decodePadSession(opened)?{entities:[]}:JSON.parse(new TextDecoder().decode(opened));
  const baseline=new Map(snapshot.entities.map(entity=>[entity.id,entityFingerprint(entity)]));baselines.set(session.id,baseline);return baseline;
 }
 function renderReview(){
  const items=planFor(reviewSession),invalid=(pending.get(reviewSession.id)||[]).filter(entry=>entry.op.type==='invalid');
  reviewList.replaceChildren(el('p',{className:'muted',textContent:`${reviewSession.name}${reviewSession.name!==host.drawingName()?` · 지금 도면(${host.drawingName()})과 이름이 다릅니다 — 다른 도면이면 자리가 맞지 않습니다.`:''}`}));
  for(const item of items){
   if(!checks.has(item.key))checks.set(item.key,item.status==='ready');
   const box=el('input',{type:'checkbox',checked:checks.get(item.key),disabled:!['ready','conflict'].includes(item.status),onchange:()=>{checks.set(item.key,box.checked);preview();}});
   const badge={ready:'',conflict:'충돌',missing:'객체 없음',locked:'잠김',invalid:'오류'}[item.status];
   reviewList.append(el('label',{className:`pad-review-row ${item.status}`},box,el('span',{textContent:describePadOp(item.op)}),badge?el('em',{textContent:badge}):'',item.reason?el('small',{textContent:item.reason}):''));
  }
  for(const entry of invalid)reviewList.append(el('p',{className:'pad-review-row invalid',textContent:`묶음 ${entry.seq}: ${entry.error}`}));
  if(!items.length&&!invalid.length)reviewList.append(el('p',{className:'muted',textContent:'새로 온 표시·메모가 없습니다.'}));
  preview();
 }
 const chosenKeys=()=>new Set([...checks].filter(([,on])=>on).map(([key])=>key));
 function preview(){const keys=chosenKeys();host.setOverlay(planFor(reviewSession,keys).filter(item=>keys.has(item.key)&&item.status==='ready').flatMap(item=>item.preview));}
 function markHandled(keys){
  reviewSession.handled.push(...keys);persist(reviewSession);
  pending.set(reviewSession.id,(pending.get(reviewSession.id)||[]).filter(entry=>!keys.includes(`${entry.seq}:${entry.index}`)&&!(entry.op.type==='invalid'&&keys.includes(`${entry.seq}:0`))));
  for(const key of keys)checks.delete(key);refreshButton();
 }
 // 사무실 지우기(ERASE)로 겹쳐 보이는 현장 표시를 찍으면 그 건을 [고른 것 지우기]처럼 이 PC 에서 지운다(대표 11/2).
 function discard(entityId){
  for(const session of sessions){
   const item=planFor(session).find(item=>item.preview.some(entity=>entity.id===entityId));if(!item)continue;
   const was=reviewSession;reviewSession=session;markHandled([item.key]);reviewSession=was;
   if(reviewDialog.open&&reviewSession)renderReview();else{shownKey='';showPending();}
   return describePadOp(item.op);
  }
  return null;
 }
 applyButton.onclick=()=>{
  const keys=chosenKeys(),items=planFor(reviewSession,keys).filter(item=>keys.has(item.key)&&item.status==='ready');
  if(!items.length){reviewNote.textContent='남길 것을 고르세요.';return;}
  try{host.execute({type:'batch',commands:items.flatMap(item=>item.commands)});}
  catch(error){reviewNote.textContent='남기지 못했습니다: '+error.message;return;}
  markHandled(items.map(item=>item.key));reviewNote.textContent=`${items.length}건을 남겼습니다. 되돌리기 한 번으로 취소할 수 있습니다.`;
  const at=new Date().toISOString();
  log(reviewSession,items.map(item=>({id:`${reviewSession.id}:applied:${item.key}`,kind:'drawing.applied',link:reviewSession.id,at,by:'사무실',...(item.op?.id?{pin:item.op.id}:{}),what:describePadOp(item.op)})));flushRecords();
  renderReview();
 };
 ignoreButton.onclick=()=>{const keys=[...chosenKeys()];if(!keys.length){reviewNote.textContent='지울 것을 고르세요.';return;}markHandled(keys);reviewNote.textContent=`${keys.length}건을 지웠습니다.`;renderReview();};

 async function openReview(session){
  reviewSession=session;checks=new Map();reviewNote.textContent='';
  if((pending.get(session.id)||[]).some(entry=>!['mark','memo','pin','measure','invalid'].includes(entry.op.type))){
   try{await baselineFor(session);}catch(error){reviewNote.textContent='충돌 기준을 받지 못해 충돌 확인 없이 보여 줍니다: '+error.message;baselines.set(session.id,new Map());}
  }
  renderReview();if(!reviewDialog.open)reviewDialog.show();
 }
 button.onclick=()=>{
  const withChanges=sessions.find(session=>pending.get(session.id)?.length);
  if(withChanges){openReview(withChanges);return;}
  note.textContent='';result.replaceChildren();renderList();shareDialog.showModal();
 };
 // ── 현장 기록(사무실 판): 받은 핀·실측을 링크별로 모아 두고, 상태를 바꾸고 현장에 답한다 ──
 // 기록은 이 PC 에 남는다(링크가 끝나도 30일 — 펀치리스트를 뽑을 수 있게). 답은 링크가 살아 있을 때만 현장에 간다.
 function remember(session,op,at){
  if(op.type!=='pin'&&op.type!=='measure')return;
  const book=records[session.id]||(records[session.id]={name:session.name,expiresAt:session.expiresAt,drawingPath:session.drawingPath||'',docKey:session.docKey||'',items:{}}),prev=book.items[op.id]||{};
  if(!book.items[op.id])bumpUnseen();
  book.items[op.id]={...prev,...op,receivedAt:at||new Date().toISOString(),firstAt:prev.firstAt||at||new Date().toISOString()};saveRecords();
 }
 const statusOf=item=>item.officeAt&&item.officeAt>(item.receivedAt||'')?item.officeStatus:item.status;
 const STATE_COLOR={'미해결':'#f08a3e','진행 중':'#9dcbe0','확인 요청':'#e6c35a','해결':'#7fcf95'};
 const recordsDialog=el('dialog',{className:'pad-records-dialog'});
 const recordsList=el('div',{className:'pad-records-list'}),recordsDetail=el('div',{className:'pad-records-detail'}),recordsNote=el('p',{className:'pad-review-note',role:'status'});
 const recordsFilter=el('div',{className:'pad-records-filter',role:'group',ariaLabel:'상태로 거르기'});
 recordsDialog.append(el('div',{className:'dialog-header'},el('h2',{textContent:'현장 기록'}),el('button',{type:'button',textContent:'폴더 열기',title:'이 도면의 현장 기록 폴더(사진·기록 장부)',onclick:()=>openRecordsFolder()}),el('button',{type:'button',textContent:'닫기',onclick:()=>recordsDialog.close()})),
  recordsFilter,recordsList,recordsDetail,recordsNote,el('div',{className:'dialog-actions'},el('button',{type:'button',className:'primary',textContent:'펀치리스트 PDF',onclick:()=>punchList()})));
 document.body.append(recordsDialog);
 let recordsState={filter:null,selected:null};
 const allRecords=()=>Object.entries(records).flatMap(([sid,book])=>Object.values(book.items).map(item=>({...item,sid,book})))
  .sort((a,b)=>(a.type===b.type?0:a.type==='pin'?-1:1)||(a.no||0)-(b.no||0));
 function renderRecords(){
  const all=allRecords(),pins=all.filter(i=>i.type==='pin');
  recordsFilter.replaceChildren(...[null,...PAD_PIN_STATES].map(s=>el('button',{type:'button',className:recordsState.filter===s?'primary':'',ariaPressed:String(recordsState.filter===s),textContent:s?`${s} ${pins.filter(p=>statusOf(p)===s).length}`:`전체 ${all.length}`,onclick:()=>{recordsState.filter=s;renderRecords();}})));
  const shown=all.filter(i=>!recordsState.filter||(i.type==='pin'&&statusOf(i)===recordsState.filter));
  recordsList.replaceChildren(...(shown.length?shown.map(i=>{
   const label=i.type==='pin'?`${i.no||''}. [${i.kind}·${i.prio}] ${i.title||'(제목 없음)'}`:`실측 · ${measureText(i)}`;
   const meta=[i.book.name,i.type==='pin'&&statusOf(i),i.assignee,i.due&&`기한 ${i.due}`,i.reply&&'답함'].filter(Boolean).join(' · ');
   const row=el('button',{type:'button',className:`pad-records-row${recordsState.selected===i.sid+':'+i.id?' selected':''}`,onclick:()=>{recordsState.selected=i.sid+':'+i.id;renderRecords();host.focus?.(i.type==='pin'?i.at:{x:(i.a.x+i.b.x)/2,y:(i.a.y+i.b.y)/2});}},
    el('i',{className:'pad-records-dot',style:`background:${i.type==='pin'?STATE_COLOR[statusOf(i)]||'#9dcbe0':'#a3a9b2'}`}),el('span',{textContent:label}),el('small',{textContent:meta}));
   return row;
  }):[el('p',{className:'muted',textContent:'아직 받은 핀·실측이 없습니다.'})]));
  const pick=all.find(i=>i.sid+':'+i.id===recordsState.selected);
  recordsDetail.replaceChildren();if(!pick)return;
  const session=sessions.find(s=>s.id===pick.sid),alive=!!session&&Date.parse(session.expiresAt)>Date.now();
  if(pick.type==='measure'){recordsDetail.append(el('p',{textContent:measureText(pick)}),el('p',{className:'muted',textContent:`${pick.book.name} · 받은 시각 ${new Date(pick.receivedAt).toLocaleString('ko-KR')}`}));return;}
  const status=el('select',{},...PAD_PIN_STATES.map(s=>el('option',{value:s,textContent:s,selected:s===statusOf(pick)})));
  const reply=el('textarea',{rows:3,placeholder:'현장에 보낼 답',value:pick.reply||''});
  const save=el('button',{type:'button',className:'primary',textContent:alive?'답 저장하고 패드로 보내기':'답 저장(링크 끝남)'});
  save.onclick=async()=>{
   const book=records[pick.sid],item=book.items[pick.id],at=new Date().toISOString(),before=statusOf(item),text=reply.value.trim(),beforeReply=item.reply||'';
   Object.assign(item,{officeStatus:status.value,officeAt:at,reply:text,repliedAt:at});saveRecords();
   // 장부에는 보내기 전에 먼저 남긴다(보내는 사이 창이 닫혀도 상태·답은 남는다). 현장에 닿으면 reply.delivered 를 덧붙인다.
   const stamp=`${pick.sid}:office:${pick.id}:${at}`,target=session||{id:pick.sid,name:book.name,drawingPath:book.drawingPath||'',docKey:book.docKey||''};
   const sending=!!(alive&&session.writeToken&&text),replyId=stamp+':reply';
   log(target,[...(before!==status.value?[{id:stamp+':status',kind:'pin.status',link:pick.sid,at,by:'사무실',pin:pick.id,from:before,to:status.value}]:[]),
    ...(shouldLogReply(beforeReply,text,sending)?[{id:replyId,kind:'reply.sent',link:pick.sid,at,by:'사무실',pin:pick.id,text,delivered:false}]:[])]);flushRecords();
   if(alive&&session.writeToken){
    try{await call(`/${session.id}/ops`,{method:'POST',body:{writeToken:session.writeToken,ciphertext:await sealPadJson(padReply([{id:pick.id,status:status.value,text,at}]),session.key,session.id)}});recordsNote.textContent='현장 패드로 보냈습니다. 패드가 다음에 열거나 확인할 때 보입니다.';
     if(sending)log(target,[{id:replyId+':delivered',kind:'reply.delivered',link:pick.sid,at:new Date().toISOString(),by:'사무실',pin:pick.id,ref:replyId,delivered:true}]);flushRecords();}
    catch(error){recordsNote.textContent='저장했지만 보내지 못했습니다: '+error.message;}
   }else recordsNote.textContent='이 PC 에 저장했습니다(링크가 끝나 현장으로는 못 보냅니다).';
   renderRecords();
  };
  recordsDetail.append(
   el('h3',{textContent:`핀 ${pick.no||''} · ${pick.title||'(제목 없음)'}`}),
   el('p',{className:'muted',textContent:[pick.kind,pick.prio,pick.assignee&&`담당 ${pick.assignee}`,pick.due&&`기한 ${pick.due}`,pick.book.name].filter(Boolean).join(' · ')}),
   pick.note?el('p',{textContent:pick.note}):'',
   pick.photos?.length?photoStrip(pick,session):'',
   el('label',{},'상태 ',status),reply,
   el('div',{className:'dialog-actions'},el('button',{type:'button',textContent:'도면에서 보기',onclick:()=>host.focus?.(pick.at)}),save));
 }
 function photoStrip(pick,session){
  const strip=el('div',{className:'pad-records-photos'});
  const saved=loadSaved();
  if(!session&&!pick.photos.some(photo=>saved[photo.id])){strip.append(el('p',{className:'muted',textContent:`사진 ${pick.photos.length}장 — 링크가 끝났고 현장 기록 폴더에도 없습니다.`}));return strip;}
  for(const photo of pick.photos){
   const box=el('a',{className:'pad-records-photo',textContent:'받는 중…',target:'_blank',rel:'noopener'});strip.append(box);
   photoUrl(session,photo).then(url=>{box.textContent='';box.href=url;box.append(el('img',{src:url,alt:`현장 사진 ${pick.title||''}`}));}).catch(error=>{box.textContent='사진을 받지 못했습니다: '+error.message;});
  }
  return strip;
 }
 // ── 펀치리스트 PDF: 지금 걸러 보는 핀들(+실측) · 핀 둘레 실제 도면 선 · 사진 ──
 async function punchList(){
  const all=allRecords(),pins=all.filter(i=>i.type==='pin'&&(!recordsState.filter||statusOf(i)===recordsState.filter)),measures=all.filter(i=>i.type==='measure');
  if(!pins.length&&!measures.length){recordsNote.textContent='보고서에 넣을 핀이 없습니다.';return;}
  recordsNote.textContent='보고서를 만드는 중… (사진을 받는 중)';
  try{
   const points=[...pins.map(p=>p.at),...measures.flatMap(m=>[m.a,m.b])].filter(Boolean);
   let box=null,segments=[];
   if(points.length){
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys),pad=Math.max(3000,Math.max(w,h)*0.25);
    box=[Math.min(...xs)-pad,Math.min(...ys)-pad,Math.max(...xs)+pad,Math.max(...ys)+pad];
    // 위치도: 그 범위의 도면을 패드와 같은 굽기로 선으로 바꾼다(블록·곡선·치수 포함).
    const {snapshot}=buildPadSnapshot(host.engine.doc,{box:{minX:box[0],minY:box[1],maxX:box[2],maxY:box[3]}});
    segments=packSegments(decodePadPack(encodePadPack(packDrawing(snapshot))),{limit:60000});
   }
   const sessionOf=id=>sessions.find(s=>s.id===id);
   const toB64=async url=>{const bytes=new Uint8Array(await (await fetch(url)).arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);};
   const pinData=[];
   for(const p of pins){
    const session=sessionOf(p.sid),photos=[];
    for(const photo of (p.photos||[]).slice(0,4)){try{photos.push(await toB64(await photoUrl(session,photo)));}catch{}}   // 링크가 끝났어도 기록 폴더의 사진
    pinData.push({no:p.no,title:p.title,kind:p.kind,status:statusOf(p),prio:p.prio,assignee:p.assignee,due:p.due,note:p.note,reply:p.reply,at:p.at,photos});
   }
   const result=await host.api('pad-report',{action:'punch',title:'펀치리스트',drawing:host.drawingName(),date:new Date().toISOString().slice(0,10),
    pins:pinData,measures:measures.map(m=>({text:measureText(m),over:m.actual!=null&&Math.abs(m.actual-m.drawn)>(m.tolerance??20)})),plan:{box,segments}});
   await host.output(result.data,`${host.drawingName()}_펀치리스트.pdf`,'application/pdf');
   // 기록 폴더의 펀치리스트\ 에도 한 부(장부에 report.made). 실패해도 사용자가 고른 곳에는 이미 저장됐다.
   // 지금 도면의 기록만 담긴 보고서일 때만(다른 도면 핀이 섞이면 이 도면 폴더에 넣지 않는다)
   const here=currentTarget(),ownOnly=[...pins,...measures].every(i=>sameTarget(recordTarget({drawingPath:i.book.drawingPath,name:i.book.name,docKey:i.book.docKey}),here));
   let kept='';if(ownOnly)try{kept=(await fr('report',{...here,name:`${new Date().toISOString().slice(0,10)}_펀치리스트`,data:result.data})).file||'';}catch{}
   recordsNote.textContent=`펀치리스트 PDF 를 저장했습니다(핀 ${pins.length}개)${kept?' · 현장 기록 폴더에도 한 부':''}.`;
  }catch(error){recordsNote.textContent='보고서를 만들지 못했습니다: '+error.message;}
 }
 function openRecords(){
  records=loadRecords();recordsNote.textContent='';renderRecords();setUnseen(0);
  if(!recordsDialog.open)recordsDialog.show();
 }
 // 지금 도면의 기록 폴더를 만들고 탐색기로 연다. 브라우저(설치본 아님)에서는 기록 창에 경로만 알려 준다.
 async function openRecordsFolder(){
  setUnseen(0);
  try{
   await flushRecords();
   const {folder}=await fr('folder',currentTarget());
   if(window.cadDesktop?.openFolder){await window.cadDesktop.openFolder(folder,{mustExist:true});host.toast('현장 기록 폴더를 열었습니다: '+folder);}
   else{openRecords();recordsNote.textContent=`현장 기록 폴더: ${folder} (탐색기 열기는 Windows 설치본에서만 됩니다)`;}
  }catch(error){host.toast('현장 기록 폴더를 열지 못했습니다: '+error.message,true);}
 }
 recordsButton.onclick=()=>openRecordsFolder();
 recordsMore.onclick=()=>openRecords();
 refreshRecordsButton();
 // 도면을 저장했을 때(app.js): 예전 경로(저장 안 한 도면이면 빈 값)의 기록 폴더를 새 자리로 옮긴다 — 다른 이름으로 저장해도 따라간다.
 function drawingSaved(prevPath,newPath){
  if(!newPath||prevPath===newPath)return;
  const key=docKey(),all=load(),moving=sessionsToMove(all,prevPath,key);
  const books=Object.values(records=loadRecords()).filter(book=>prevPath?book.drawingPath===prevPath:!book.drawingPath&&!!book.docKey&&book.docKey===key);
  // 저장한 적 있는 도면은 링크·기록이 이 PC 에 없어도(지웠거나 다른 PC) 옛 폴더가 있으면 옮긴다. 새 도면은 이 칸에서 만든 링크가 있을 때만.
  if(!prevPath&&!moving.length&&!books.length)return;
  const fromName=moving[0]?.name||books[0]?.name||host.drawingName();
  const from=prevPath?{drawingPath:prevPath,drawingName:fromName}:{drawingPath:'',drawingName:fromName,draftKey:key};
  const to={drawingPath:newPath,drawingName:host.drawingName()};
  // 이미 저장한 사진의 자리도 새 폴더로(사진은 id 로 찾으므로 합치며 이름이 바뀌어도 맞다). 옮기는 사이 옛 자리로 가는 일은 엔진이 10분 넘겨준다.
  const saved=loadSaved();let changed=false;
  for(const [id,where] of Object.entries(saved))if(sameTarget(where,from)){saved[id]=to;changed=true;}
  if(changed)try{localStorage.setItem(SAVED_PHOTOS_KEY,JSON.stringify(saved));}catch{}
  for(const session of moving)session.drawingPath=newPath;
  if(moving.length){save(all);sessions=load();}
  for(const book of books)book.drawingPath=newPath;
  if(books.length)saveRecords();
  outbox.add(`move:${prevPath||key}>${newPath}:${Date.now()}`,{move:{fromPath:prevPath,fromName,...(prevPath?{}:{fromDraftKey:key}),toPath:newPath,toName:to.drawingName}});flushRecords();
 }

 return {poll,activated,discard,get sessions(){return sessions;},openReview,openRecords,openRecordsFolder,drawingSaved};
}
