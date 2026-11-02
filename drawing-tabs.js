import {createChunkedRecoveryAdapter} from './recovery-chunks.js';
// The engine object stays stable; documents and undo histories belong to tabs.
export class DrawingTabs {
 constructor({capture,apply,onChange=()=>{},limit=10}){this.capture=capture;this.apply=apply;this.onChange=onChange;this.limit=limit;this.tabs=[];this.activeId=null;}
 get active(){return this.tabs.find(t=>t.id===this.activeId);}
 checkpoint(){if(this.active)Object.assign(this.active,this.capture());return this.active;}
 open(state){if(this.tabs.length>=this.limit)throw Error(`도면은 최대 ${this.limit}개까지 열 수 있습니다. 사용하지 않는 탭을 먼저 닫으세요.`);this.checkpoint();const tab={...state,id:crypto.randomUUID()};this.tabs.push(tab);this.activeId=tab.id;this.apply(tab);this.onChange();return tab;}
 select(id){if(id===this.activeId)return;const target=this.tabs.find(t=>t.id===id);if(!target)throw Error('도면 탭을 찾을 수 없습니다.');this.checkpoint();this.activeId=id;this.apply(target);this.onChange();}
 remove(id){const index=this.tabs.findIndex(t=>t.id===id);if(index<0)return;this.checkpoint();this.tabs.splice(index,1);if(this.activeId===id){const next=this.tabs[Math.min(index,this.tabs.length-1)];this.activeId=next?.id||null;if(next)this.apply(next);}this.onChange();}
 dirtyTabs(){this.checkpoint();return this.tabs.filter(t=>t.dirty);}
 snapshot(){this.checkpoint();return {version:1,savedAt:Date.now(),activeId:this.activeId,tabs:this.tabs.map(({undoStack,redoStack,recoveryUndo,...tab})=>({...tab,...(tab.dirty&&undoStack?.length?{recoveryUndo:undoStack.at(-1)}:{})}))};}
 restore(snapshot,validate){if(snapshot?.version!==1||!Array.isArray(snapshot.tabs)||!snapshot.tabs.length||snapshot.tabs.length>this.limit)throw Error('복구할 다중 도면 자료의 형식이 올바르지 않습니다.');const ids=new Set();for(const t of snapshot.tabs){if(typeof t.id!=='string'||ids.has(t.id)||typeof t.name!=='string')throw Error('복구 도면의 이름 또는 ID가 올바르지 않습니다.');ids.add(t.id);validate(t.doc);if(t.recoveryUndo)validate(t.recoveryUndo);}this.tabs=snapshot.tabs.map(({recoveryUndo,...t})=>({...t,undoStack:recoveryUndo?[structuredClone(recoveryUndo)]:[],redoStack:[]}));this.activeId=ids.has(snapshot.activeId)?snapshot.activeId:this.tabs[0].id;this.apply(this.active);this.onChange();}
}

/** 파일 열기 때만 검사한다. 파일·편집·실행 취소 기록이 있는 도면은 정리하지 않는다. */
export function isEmptyDrawingTab(tab){
 return !!tab&&!tab.filePath&&!tab.dirty&&/^새 도면(?:\s*\d+)?$/.test(tab.name||'')&&Array.isArray(tab.doc?.entities)&&tab.doc.entities.length===0&&!tab.undoStack?.length&&!tab.redoStack?.length;
}
export function drawingPathKey(value){return String(value||'').replace(/\\/g,'/').toLowerCase();}

/** 칸 자동 복원은 파일에서 열었거나 미저장 편집이 있는 탭만 포함한다. */
export function restorableDrawingWorkspace(snapshot){
 const tabs=snapshot?.tabs?.filter(tab=>tab?.dirty||tab?.filePath)||[];
 return tabs.length?{...snapshot,tabs,activeId:tabs.some(tab=>tab.id===snapshot.activeId)?snapshot.activeId:tabs[0].id}:null;
}

/** 앱 프로세스를 새로 열면 언제나 빈 도면으로 시작한다.
    복구 자료는 지우지 않고 RECOVER 명령으로만 되살린다.
    새로고침(Ctrl+R)은 같은 창이므로 현재 작업을 이어간다. */
export function startsFresh({freshLaunch}){
 return !!freshLaunch;
}

/** 복구 작업공간에 되살릴 만한 내용이 있는가(객체가 있거나 저장하지 않은 탭). */
export function workspaceHasContent(snapshot){
 return !!(snapshot&&Array.isArray(snapshot.tabs)&&snapshot.tabs.some(tab=>tab?.dirty||(tab?.doc?.entities?.length||0)>0));
}
/** 저장하지 않은 편집이 있는가(잃을 것이 있는 작업공간). 보관 세대는 이것만 만든다. */
export function workspaceIsDirty(snapshot){
 return !!(snapshot&&Array.isArray(snapshot.tabs)&&snapshot.tabs.some(tab=>tab?.dirty));
}
export const SESSION_GENERATIONS=3;
/** 218: 복구 목록 한 줄 — 도면 이름·원본 파일 경로·복구본 시각을 함께 보여 준다(같은 이름 도면이 여럿이어도 고를 수 있게). */
export function recoveryRowLabel(tab,savedAt){
 const name=String(tab?.name||'이름 없는 도면'),path=tab?.filePath?String(tab.filePath):'저장한 적 없음';
 const time=Number.isFinite(Number(savedAt))&&Number(savedAt)>0?new Date(Number(savedAt)).toLocaleString('ko-KR'):'시각 모름';
 const count=tab?.doc?.entities?.length;
 return `${name}${tab?.dirty?' (저장 안 한 편집)':''} · 원본 ${path} · 복구본 ${time}${Number.isFinite(count)?' · 객체 '+count.toLocaleString('ko-KR')+'개':''}`;
}
/** S2 · 켤 때 지난 세션을 어떻게 다룰지. 새 실행이 직전 복구본을 빈 도면으로 덮어쓰지 않도록 한다.
    keep:   저장하지 않은 편집이 있다 → 세대로 보관하고 RECOVER 로 되살림(편집이 생기기 전에는 current 도 덮어쓰지 않는다)
    offer:  정상 종료가 아니었고 저장하지 않은 편집이 있다 → 되살릴지 물어본다
    restore:같은 창 새로고침 → 예전처럼 그대로 이어간다
    none:   잃을 것이 없다(참고 파일만 열어 봄 등) → 보관하지 않는다(앞선 dirty 보관본이 살아남는다) */
export function recoveryOffer({saved,startFresh,closedCleanly,engine=null}){
 const content=workspaceHasContent(saved),dirty=workspaceIsDirty(saved);
 // 2: 엔진(대용량 복구본)이 IndexedDB 보관본보다 새롭고 저장하지 않은 편집이면 그쪽을 되살릴 대상으로 고른다.
 const engineNewer=!!(engine&&engine.dirty&&engine.kind==='large'&&Number(engine.savedAt)>Number(saved?.savedAt||0));
 if(startFresh&&engineNewer)return {action:closedCleanly?'keep':'offer',source:'engine',content:true,dirty:true,count:1,dirtyCount:1,names:['대용량 도면 (엔진 복구본 · '+new Date(engine.savedAt).toLocaleString('ko-KR')+')'],rows:[recoveryRowLabel({name:'대용량 도면 (엔진 복구본)',filePath:engine.filePath,dirty:true},engine.savedAt)]};
 if(!saved)return {action:'none',source:'none',content:false,dirty:false};
 if(!startFresh)return {action:'restore',source:'workspace',content,dirty};
 if(!dirty)return {action:'none',source:'none',content,dirty:false};
 return {action:closedCleanly?'keep':'offer',source:'workspace',content:true,dirty:true,count:saved.tabs.length,dirtyCount:saved.tabs.filter(tab=>tab.dirty).length,names:saved.tabs.map(tab=>tab.name),rows:saved.tabs.map(tab=>recoveryRowLabel(tab,saved.savedAt))};
}
/** IndexedDB 복구 저장소. current(진행 중 작업공간)와 last-session:<시각>(저장하지 않은 세션 보관본, 최신 SESSION_GENERATIONS 개) 를 둔다. */
export function openDrawingRecovery(indexedDB,adapterOptions={}){
 return new Promise((resolve,reject)=>{const request=indexedDB.open('barun-cad-drawing-tabs',1);request.onupgradeneeded=()=>request.result.createObjectStore('workspace');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;
  const get=key=>new Promise((ok,fail)=>{const transaction=db.transaction('workspace','readonly'),q=transaction.objectStore('workspace').get(key);q.onsuccess=()=>ok(q.result);q.onerror=()=>fail(q.error);});
  const keys=()=>new Promise((ok,fail)=>{const q=db.transaction('workspace','readonly').objectStore('workspace').getAllKeys();q.onsuccess=()=>ok(q.result);q.onerror=()=>fail(q.error);});
  const put=(key,value)=>new Promise((ok,fail)=>{const tx=db.transaction('workspace','readwrite');if(value===undefined)tx.objectStore('workspace').delete(key);else tx.objectStore('workspace').put(value,key);tx.oncomplete=()=>ok();tx.onabort=tx.onerror=()=>fail(tx.error||Error('도면 복구 저장 실패'));});
  resolve(createRecoveryStore(createChunkedRecoveryAdapter({get,put,keys},adapterOptions)));};});
}
/** 저장소 정책(순수 · 테스트 가능). get/put/keys 만 있으면 IndexedDB 든 메모리든 같다. */
export function createRecoveryStore({get,put,keys,alias=null,cleanup=async()=>{}},{generations=SESSION_GENERATIONS,now=()=>new Date()}={}){
 const sessionKeys=async()=>(await keys()).filter(key=>typeof key==='string'&&key.startsWith('last-session')).sort().reverse();
 // Collection is housekeeping after a durable commit. Its failure must not
 // trigger the application's synchronous emergency-storage fallback.
 const collect=async()=>{try{await cleanup();}catch{/* Retry on the next save. */}};
 return {
  read:()=>get('current'),write:async value=>{await put('current',value);await collect();},
  readLastSession:async()=>{const found=await sessionKeys();return found.length?get(found[0]):undefined;},
  listSessions:sessionKeys,
  /** 저장하지 않은 편집이 있는 세션만 시각이 붙은 세대로 남기고 최신 generations 개를 유지한다. 서로 덮어쓰지 않는다. */
  preserveLastSession:async value=>{if(!workspaceIsDirty(value))return false;const stamp=now().toISOString();await put('last-session:'+stamp,{...value,preservedAt:stamp});for(const key of (await sessionKeys()).slice(generations))await put(key,undefined);await collect();return true;},
  /** value 가 지금 current 에 든 작업공간일 때 쓴다. 청크 저장소는 같은 세대를 가리키는 목록만 새 키로 남겨 수백 MB 를 다시 쓰지 않는다. */
  preserveCurrentSession:async value=>{if(!workspaceIsDirty(value))return false;const stamp=now().toISOString();if(alias)await alias('current','last-session:'+stamp);else await put('last-session:'+stamp,{...value,preservedAt:stamp});for(const key of (await sessionKeys()).slice(generations))await put(key,undefined);await collect();return true;},
  clearCurrent:async()=>{await put('current',undefined);await collect();}};
}
/** 비정상 종료 뒤 첫 실행에서 되살릴지 묻는 창. 사용자가 고르기 전에는 아무것도 덮어쓰지 않는다. */
export function showRecoveryDialog({count,names=[],rows=null,onRecover,onFresh},doc=globalThis.document){
 const dialog=doc.createElement('dialog');dialog.className='recovery-offer-dialog';dialog.setAttribute('aria-label','지난 작업 되살리기');
 const title=doc.createElement('h2');title.textContent='지난 작업이 정상 종료되지 않았습니다';
 const body=doc.createElement('p');body.textContent=`저장하지 않은 도면 ${count}개가 남아 있습니다. 지금 되살릴까요? 새 도면으로 시작해도 이 보관본은 최근 ${SESSION_GENERATIONS}세대 안에서 유지되며 명령창에 DRAWINGRECOVERY(또는 RECOVER) 를 치면 다시 불러올 수 있습니다.`;
 const list=doc.createElement('ul');for(const name of (Array.isArray(rows)&&rows.length?rows:names).slice(0,10)){const item=doc.createElement('li');item.textContent=name;list.append(item);}
 const actions=doc.createElement('div');actions.className='dialog-actions';
 const fresh=doc.createElement('button');fresh.type='button';fresh.textContent='새 도면으로 시작';
 const recover=doc.createElement('button');recover.type='button';recover.className='primary';recover.textContent='지난 작업 되살리기';
 let decided=false;
 const finish=choice=>{if(decided)return;decided=true;try{dialog.close();}catch{}dialog.remove();if(choice==='recover')onRecover?.();else onFresh?.();};
 fresh.onclick=()=>finish('fresh');recover.onclick=()=>finish('recover');
 dialog.addEventListener('cancel',event=>{event.preventDefault();});   // Esc 로 조용히 버리지 않는다
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 actions.append(fresh,recover);dialog.append(title,body,list,actions);doc.body.append(dialog);
 if(typeof dialog.showModal==='function')dialog.showModal();
 return {dialog,choose:finish};
}
