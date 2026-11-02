import * as G from './geometry.js';
import {createOutputObservers} from './output-requests.js';
import {prepareDimensionExport} from './dimension-export.js';
import {CALS_LAYERS,A1_TEXT_HEIGHTS} from './reference-data.js';
import {sortSheets,sheetFrameUpdates,renumberSheets,setSheetScale,alignSheetPlan,duplicateSheet,clippedSheetDocument,applyDrawingBatchEdit} from './sheet-tools.js';
import {technicalErrorMessage,userErrorMessage} from './user-error.js';
import {buildDocumentRequestBody,receiveImportStream,LARGE_DOCUMENT_ENTITIES,isHeavyDocument} from './import-stream.js';
export const LARGE_SAVE_CHARS=50_000_000;   // base64 가 이보다 길면 IPC 로 바이트를 넘긴다(문자열 한도·1e8 제한 회피)
/** 5만 객체를 넘는 문서: 요청도 응답도 문자열 하나로 만들지 않는 길(줄 단위 요청 + 엔진이 경로에 직접 저장)을 쓴다. */
export const isLargeDocument=doc=>isHeavyDocument(doc,LARGE_DOCUMENT_ENTITIES);
/** 1/N1: 대용량 저장. 셸의 저장 대화상자가 경로를 검사해 엔진에 일회용 토큰으로 등록하고, 엔진이 그 경로에 직접 쓴다(base64 응답 없음). */
export async function saveLargeDocument({document,name,format='dxf',dwgVersion='2018',dxfVersion='2018',targetPath='',thumbnail='',saveOptions={},timings_ms={},api,toast=()=>{},desktop=globalThis.window?.cadDesktop}){
  const started=performance.now();
  if(!desktop?.pickSaveTarget)throw Error('객체 5만 개를 넘는 도면은 바른 CAD 데스크톱 앱에서만 저장할 수 있습니다(브라우저 모드는 지원하지 않습니다).');
  const target=await desktop.pickSaveTarget({name,format,...(targetPath?{targetPath}:{}),...saveOptions});
  if(target?.canceled)throw Error('저장을 취소했습니다. 도면은 열어둡니다.');
  if(!target?.saveToken)throw Error(target?.error||'저장 위치를 확인하지 못했습니다.');
  toast('대용량 도면을 저장하고 있습니다. 몇 분이 걸릴 수 있습니다: '+target.path);
  const result=await api('export',{document,format,version:format==='dxf'?'R'+dxfVersion:'R2018',...(format==='dwg'?{dwgVersion}:{}),...(format==='dxf'&&thumbnail?{thumbnail}:{}),saveToken:target.saveToken,...saveOptions});
  Object.assign(timings_ms,target.timings_ms||{},result.timings_ms||{},{client_large_save:Math.round(performance.now()-started)});
  result.timings_ms=timings_ms;
  // 세부 안내(선종류 대체 등)는 화면에 늘어놓지 않는다. 빠진 객체나 고른 DXF 버전으로 저장되지 않은 경우·담지 못한 특수 문자는 경고.
  if(result.warnings?.length)console.info('저장 세부 안내',result.warnings);
  const versionWarning=format==='dxf'?result.warnings?.filter(w=>w.includes('IMAGE')||w.includes('고른 버전으로 저장되지 않았습니다')||w.startsWith('2000·2004 DXF 에는 일부 특수 문자(')).join(' '):'';
  const downgradeNotice=format==='dxf'?result.warnings?.filter(w=>w.startsWith('구버전(')).join(' '):'';
  const lost=result.dwg?.lost;
  toast('파일을 저장했습니다: '+result.path+(lost?` · 일부 객체(${lost}개)를 담지 못했습니다.`:'')+(versionWarning?' '+versionWarning:'')+(downgradeNotice?' '+downgradeNotice:''),!!(lost||versionWarning));
  return result;
}

export const defaults={paper:'A3',denominator:100,textHeight:250,paperTextHeight:2.5,colorMode:'mono',projectName:'',author:'',layerStandard:[]};
/* S3 · 로컬 엔진 호출 공통부. 경로별 대기 시간, 엔진 재시작(403·연결 끊김) 뒤 토큰 재발급과 한 번 재시도. */
export const ROUTE_TIMEOUT_MS={default:120_000,import:1_500_000,'import-path':1_500_000,export:900_000,pdf:900_000,convert:1_200_000,'convert-file':1_200_000,excel:300_000,shp:300_000,'plan-import':300_000,'pdf-import':300_000,'auto-plan':240_000,'site-plan/generate':300_000,'site-plan/validate':300_000,bridge:20_000,recovery:600_000,restore:600_000,chat:240_000 /* 엔진 쪽 미리 대기 190 s 보다 길게 */,realtime:60_000,tablet:15_000,project:60_000,lisp:300_000};
/* 엔진 재시작·연결 끊김 뒤 자동으로 다시 보내도 되는(멱등) 경로만 적는다. 문자 발송·로그인·리습 실행·필지 조회 과금 등은 두 번 보내지 않는다. */
export const RETRY_ROUTES=new Set(['restore','recovery','bridge','export','pdf','import','import-path','plot-style','hatch-boundary','regions','site-plan/validate','plan-import','excel','shp']);
/* 데스크톱 엔진은 /api/status 로 토큰을 주지 않는다(tokenPolicy:'desktop'). 그때는 셸의 IPC 로 받는다. */
export async function engineToken(status,desktop=globalThis.window?.cadDesktop){
  if(typeof status?.token==='string'&&status.token)return status.token;
  if(status?.tokenPolicy==='desktop'&&typeof desktop?.engineToken==='function')return await desktop.engineToken();
  return null;
}
/* 엔진의 403 을 오류로 바꾼다. 엔진이 code 를 붙인 403(AI 로그인 필요 등)은 그 안내를 그대로, code 없는 403(토큰 불일치)은
   엔진 재시작으로 본다(code ENGINE_RESTARTED → 부르는 쪽이 토큰을 다시 받는다). 화면 쪽 두 호출 길이 같이 쓴다(10/19). */
export async function forbiddenError(response){
  const body=await response?.clone?.().json().catch(()=>null);
  if(body?.code)return Object.assign(Error(body.error||'로그인 필요 · [계정 연결]로 로그인한 뒤 다시 실행하세요.'),{status:403,code:body.code});
  return Object.assign(Error('로컬 엔진이 재시작되었습니다. 다시 실행하세요.'),{status:403,code:'ENGINE_RESTARTED'});
}
export function createEngineApi({fetch:fetchImpl=(...args)=>globalThis.fetch(...args),toast=()=>{},timeouts=ROUTE_TIMEOUT_MS,reconnectMs=20_000,pollMs=500,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),prepare=async(route,data)=>data,encode=buildDocumentRequestBody,receive=receiveImportStream,observeOutput=null}={}){
  let apiToken=null;
  const timeoutFor=route=>timeouts[route]??timeouts.default;
  const withTimeout=async(run,ms,route)=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);try{return await run(controller.signal);}catch(error){if(error?.name==='AbortError')throw Object.assign(Error(`로컬 엔진 응답이 ${Math.round(ms/1000)}초 안에 오지 않았습니다 (${route}). 엔진 상태를 확인한 뒤 다시 시도하세요.`),{code:'TIMEOUT'});throw error;}finally{clearTimeout(timer);}};
  const isConnectionFailure=error=>error?.code!=='TIMEOUT'&&(error instanceof TypeError||/Failed to fetch|NetworkError|ECONNREFUSED|ECONNRESET|Load failed|network/i.test(String(error?.message||'')));
  async function fetchToken(){const r=await withTimeout(signal=>fetchImpl('/api/status',{signal}),10_000,'status');if(!r.ok)throw Error('로컬 엔진 상태를 읽지 못했습니다. 엔진을 다시 시작하세요.');const status=await r.json();const token=await engineToken(status);if(!token)throw Error('로컬 엔진 토큰이 없습니다. 엔진을 다시 시작하세요.');return token;}
  async function waitForEngine(limitMs=reconnectMs){const deadline=Date.now()+limitMs;for(;;){try{const r=await withTimeout(signal=>fetchImpl('/api/status',{signal}),3_000,'status');if(r.ok&&r.headers?.get?.('X-Barun-CAD')==='2')return true;}catch{}if(Date.now()>=deadline)return false;await sleep(pollMs);}}
  async function attempt(route,data){
    if(!apiToken)apiToken=await fetchToken();
    // S1: 5만 객체를 넘는 문서는 줄 단위 Blob 으로 보낸다(문자열 하나를 만들지 않는다).
    const observer=observeOutput?.(route,data);
    try{
    const measureSave=route==='export'&&!!data?.document,encodeStarted=measureSave?performance.now():0;
    const encoded=await encode(data);   // N2: 큰 문서는 페이지마다 양보하며 만든다
    const clientSerialize=measureSave?performance.now()-encodeStarted:0;
    const r=await withTimeout(signal=>{const options={method:'POST',headers:{'Content-Type':encoded.contentType,'X-CAD-Token':apiToken},body:encoded.body,signal};return observer?observer.send('/api/'+route,options,fetchImpl):fetchImpl('/api/'+route,options);},timeoutFor(route),route);
    if(r.status===403){const error=await forbiddenError(r);if(error.code==='ENGINE_RESTARTED')apiToken=null;throw error;}
    if(/x-ndjson/i.test(r.headers?.get?.('Content-Type')||'')){const assembled=await receive(r);return {...(assembled.report||{}),document:assembled.document};}   // 대용량 복구본
    const result=await r.json();if(!r.ok||result.error)throw Object.assign(Error(result.error||'요청 실패'),{status:r.status});if(measureSave)result.timings_ms={...(result.timings_ms||{}),client_serialize:clientSerialize};observer?.received(result);return result;
    }catch(error){observer?.fail(error);throw error;}
  }
  async function api(route,data,{prepare:runPrepare=true}={}){
    if(runPrepare)data=await prepare(route,data);
    if(route==='export'&&data?.document&&data.format!=='bcad')data={...data,document:prepareDimensionExport(data.document)};
    try{return await attempt(route,data);}
    catch(error){
      const restarted=error?.code==='ENGINE_RESTARTED',lost=isConnectionFailure(error)||(route==='bridge'&&error?.code==='TIMEOUT');
      if(!(restarted||lost)||!RETRY_ROUTES.has(route))throw error;
      apiToken=null;
      if(!(await waitForEngine()))throw Error('로컬 처리 엔진에 연결하지 못했습니다. 엔진이 다시 시작되면 자동으로 이어집니다. 잠시 후 다시 시도하세요.');
      if(route!=='bridge')toast('로컬 엔진이 다시 시작되어 요청을 다시 보냅니다.');
      return attempt(route,data);
    }
  }
  return {api,waitForEngine,resetToken:()=>{apiToken=null;},get token(){return apiToken;}};
}
export const num=(v,label='값')=>{const n=Number(v);if(!Number.isFinite(n))throw Error(label+'에 숫자를 입력하세요.');return n;};
export const positive=(v,label)=>{const n=num(v,label);if(n<=0)throw Error(label+'은 양수입니다.');return n;};
export function flatten(doc,entities=doc.entities){
  const out=[];
  function visit(e,inherited={}){
    const l=doc.layers.find(l=>l.id===e.layer);
    if(e.hidden || !l?.visible || l.frozen)return;
    const style={color:e.color||inherited.color||l.color,lineweight:e.lineweight??inherited.lineweight??l.lineweight??.25,linetype:e.linetype||inherited.linetype||l.linetype};
    if(e.type==='block'&&e.clip?.enabled){const children=flatten(doc,e.entities);if(children.length)out.push({...e,...style,entities:children});}
    else if(e.type==='block')e.entities.forEach(p=>visit(p,style));
    else if(['wall','dimension'].includes(e.type))G.primitives(e).forEach(p=>visit(p,style));
    else out.push({...e,...style});
  }
  entities.forEach(e=>visit(e));return out;
}
export function sheetJob(doc,sheets,settings={}){
  const entities=flatten(doc,doc.entities.filter(e=>!e.sheetDecoration));
  if(!entities.length)throw Error('출력할 객체가 없습니다.');
  return {action:'render',sheets:sortSheets(sheets.map(s=>({...defaults,...settings,...s,bounds:s.bounds||G.bounds(entities),entities})))};
}
export function tableBlock(rows,{x=0,y=0,height=150,widths=null,rowHeight=null,align='left',merges=[],name='표',layer='default'}={}){
  if(!Array.isArray(rows)||!rows.length)throw Error('표에 행이 없습니다.');
  const columns=Math.max(...rows.map(r=>Array.isArray(r)?r.length:0));if(!columns)throw Error('표에 열이 없습니다.');
  rowHeight=rowHeight??height*2.2;if(!(Number.isFinite(height)&&height>0&&Number.isFinite(rowHeight)&&rowHeight>=height*1.2))throw Error('표 문자 높이와 행 높이를 확인하세요.');
  widths=widths?widths.map(Number):Array.from({length:columns},(_,i)=>Math.max(6,...rows.map(r=>String(r[i]??'').length))*height*.8+height*2);
  if(widths.length!==columns||widths.some(w=>!Number.isFinite(w)||w<height*2))throw Error('표 열 너비를 확인하세요.');
  if(!['left','center','right'].includes(align))throw Error('표 문자 정렬 오류');
  const occupied=new Set(),normalizedMerges=merges.map(m=>({r1:Number(m.r1),c1:Number(m.c1),r2:Number(m.r2),c2:Number(m.c2)}));
  for(const m of normalizedMerges){if(![m.r1,m.c1,m.r2,m.c2].every(Number.isInteger)||m.r1<0||m.c1<0||m.r2<m.r1||m.c2<m.c1||m.r2>=rows.length||m.c2>=columns||(m.r1===m.r2&&m.c1===m.c2))throw Error('병합 셀 범위를 확인하세요.');for(let r=m.r1;r<=m.r2;r++)for(let c=m.c1;c<=m.c2;c++){const key=r+':'+c;if(occupied.has(key))throw Error('병합 셀 범위가 겹칩니다.');occupied.add(key);}}
  const xs=[x];for(const width of widths)xs.push(xs.at(-1)+width);const total=xs.at(-1)-x,entities=[];
  const horizontalBlocked=(r,c)=>normalizedMerges.some(m=>m.r1<r&&m.r2>=r&&c>=m.c1&&c<=m.c2),verticalBlocked=(r,c)=>normalizedMerges.some(m=>m.c1<c&&m.c2>=c&&r>=m.r1&&r<=m.r2);
  for(let r=0;r<=rows.length;r++){const yy=y-r*rowHeight;if(r===0||r===rows.length)entities.push({type:'line',layer,points:[{x,y:yy},{x:x+total,y:yy}]});else for(let c=0;c<columns;c++)if(!horizontalBlocked(r,c))entities.push({type:'line',layer,points:[{x:xs[c],y:yy},{x:xs[c+1],y:yy}]});}
  for(let c=0;c<=columns;c++){if(c===0||c===columns)entities.push({type:'line',layer,points:[{x:xs[c],y},{x:xs[c],y:y-rows.length*rowHeight}]});else for(let r=0;r<rows.length;r++)if(!verticalBlocked(r,c))entities.push({type:'line',layer,points:[{x:xs[c],y:y-r*rowHeight},{x:xs[c],y:y-(r+1)*rowHeight}]});}
  const covering=(r,c)=>normalizedMerges.find(m=>r>=m.r1&&r<=m.r2&&c>=m.c1&&c<=m.c2);
  for(let r=0;r<rows.length;r++)for(let c=0;c<columns;c++){
    const merge=covering(r,c);if(merge&&(r!==merge.r1||c!==merge.c1))continue;const c2=merge?.c2??c,r2=merge?.r2??r,left=xs[c],right=xs[c2+1],position={x:align==='left'?left+height*.5:align==='right'?right-height*.5:(left+right)/2,y:y-(r+r2+1)*rowHeight/2-height*.35};
    entities.push({type:'text',layer,position,height,text:String(rows[r][c]??''),align,tableCell:{row:r,column:c}});
  }
  return {type:'block',layer,name,entities,table:{rows:structuredClone(rows),height,widths,rowHeight,align,merges:normalizedMerges}};
}

export function createStudio(ctx){
  const {engine,form,execute,selected,activeLayer,toast,download,refresh,fit}=ctx;
  // The unfinished project-folder mode was removed. Clear its old automatic
  // connection so a folder selected in an earlier build cannot capture saves.
  let folder='',settings={...defaults};
  localStorage.removeItem('barun-cad-project-folder');
  try{Object.assign(settings,JSON.parse(localStorage.getItem('barun-cad-global')||'{}'));}catch{}
  const getSettings=()=>({...settings});
  const outputObservers=createOutputObservers({begin:ctx.beginOutputWait});
  const engineApi=createEngineApi({toast,observeOutput:outputObservers.observe,prepare:async(route,data)=>{if(route==='export'&&data?.document&&window.cadLiveCheck)return {...data,document:await window.cadLiveCheck.prepareExport(data.document)};return data;}});
  const api=engineApi.api;
  // S3: 셸(desktop.cjs)이 엔진을 다시 띄우면 토큰이 바뀐다. 알림을 받고 토큰을 버린 뒤 사용자에게 알린다.
  if(typeof window!=='undefined')window.cadDesktop?.onEngineStatus?.(status=>{engineApi.resetToken();if(status?.portChanged){toast(status.message||`기본 포트(${status.basePort})를 다른 프로그램이 써서 예비 포트 ${status.port}로 실행 중입니다. 이 실행에서는 이전 설정·대화 기록·자동 복구본이 보이지 않을 수 있습니다(복구본은 RECOVER 로 기본 포트 것을 찾습니다).`,true);return;}if(status?.state==='restarting')toast(status.message||'로컬 도면 엔진이 종료되어 다시 시작합니다.',true);else if(status?.state==='ready'&&status.restarted)toast(status.message||'로컬 도면 엔진을 다시 시작했습니다. 진행 중이던 작업은 다시 실행하세요.');else if(status?.state==='failed')toast(status.message||'로컬 도면 엔진을 다시 시작하지 못했습니다. 바른 CAD를 다시 실행하세요.',true);});
  const bytes=b64=>Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
  const b64=async file=>{const a=new Uint8Array(await file.arrayBuffer());let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s);};
  const text64=value=>{const a=new TextEncoder().encode(value);let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s);};
  async function output(encoded,name,type,targetPath='',options={}){const wait=outputObservers.consume(encoded),started=performance.now();try{if(window.cadDesktop){
      // S1: 큰 결과(예: 240 MB DXF)는 base64 문자열 대신 바이트로 넘긴다.
      const payload={...(encoded.length>LARGE_SAVE_CHARS?{bytes:bytes(encoded),name}:{data:encoded,name}),...(targetPath?{targetPath}:{}),...(options.aiRequestEpoch===undefined?{}:{aiRequestEpoch:options.aiRequestEpoch,aiExpiresAt:options.aiExpiresAt}),...(options.aiRequestId?{aiRequestId:options.aiRequestId,aiRecipient:options.aiRecipient,aiExpiresAt:options.aiExpiresAt}:{})};
      const r=await window.cadDesktop.saveFile(payload);if(options.saveResult)Object.assign(options.saveResult,{backup_method:r.backup_method,replace_attempts:r.replace_attempts});if(options.timings_ms)Object.assign(options.timings_ms,r.timings_ms||{}, {desktop_save:Math.round(performance.now()-started)});if(!r.saved)throw Error('저장을 취소했습니다. 도면은 열어둡니다.');toast('파일 저장 완료: '+r.path);wait?.finish(r.path);return r.path;}else{download(bytes(encoded),name,type);wait?.finish(name);}}catch(error){wait?.fail(error);console.error('[바른 CAD 파일 저장 오류]',technicalErrorMessage(error));throw Error(userErrorMessage(error,'파일을 저장하지 못했습니다. 저장 위치와 권한을 확인하세요.'));}}
  const field=(name,label,value,type='text',options)=>({name,label,value,type,options});
  const paperField=()=>field('paper','용지',getSettings().paper,'text',[['A1','A1 841 × 594'],['A3','A3 420 × 297'],['A4','A4 297 × 210']]);
  const pointFields=(x=0,y=0)=>[field('x','기준점 X (mm)',x,'number'),field('y','기준점 Y (mm)',y,'number')];
  const ids=()=>[...selected()];
  const chosen=()=>engine.doc.entities.filter(e=>selected().has(e.id));
  const add=entities=>execute({type:'addMany',entities:entities.map(e=>({layer:activeLayer(),...e}))});
  const change=changes=>execute(changes.sheets?{type:'batch',commands:[...sheetFrameUpdates(engine.doc,changes.sheets),{type:'document.update',changes}]}:{type:'document.update',changes});
  const load=doc=>{execute({type:'load',document:doc});selected().clear();refresh();fit();};
  const pickFiles=(accept,multiple,handler)=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.hidden=true;document.body.append(input);input.onchange=()=>Promise.resolve(handler([...input.files])).catch(e=>toast(e.message,true)).finally(()=>input.remove());input.oncancel=()=>input.remove();input.click();};
  const requireSheets=()=>{const sheets=engine.doc.sheets||[];if(!sheets.length)throw Error('SHEET 또는 PLOTBOX로 도곽을 먼저 지정하세요.');return sheets;};
  async function exportSheetDxfs(sheets,ai={}){const entities=flatten(engine.doc,engine.doc.entities.filter(entity=>!entity.sheetDecoration));for(const sheet of sortSheets(sheets)){const r=await api('export',{document:clippedSheetDocument(engine.doc,sheet,undefined,entities)});await ai.commit?.(()=>{});await output(r.data,sheet.number+'.dxf','application/dxf','',ai.saveOptions||{});}toast('도곽 '+sheets.length+'장을 번호순 DXF로 분리했습니다.');}
  async function exportSheetPdf(sheets,title,colorMode=getSettings().colorMode){const job=sheetJob(engine.doc,sheets,{...getSettings(),colorMode});const result=await api('pdf',job);await output(result.data,title+'.pdf','application/pdf');toast('PDF '+sheets.length+'장 출력 완료');}
  function applySettings(){
    document.getElementById('text-height').value=getSettings().textHeight;
    const commands=[];
    for(const standard of getSettings().layerStandard||[]){const existing=engine.doc.layers.find(l=>l.name===standard.name);if(existing){const changes={color:standard.color,lineweight:standard.lineweight,linetype:standard.linetype||'CONTINUOUS'};if(Object.keys(changes).some(k=>existing[k]!==changes[k]))commands.push({type:'layer.update',id:existing.id,changes});}else commands.push({type:'layer.add',name:standard.name,color:standard.color,lineweight:standard.lineweight});}
    if(commands.length)execute({type:'batch',commands});
  }
  const aiForm=(ai,title,fields,apply)=>{
    if(!ai.commit)return form(title,fields,apply);
    let execution=null,settled=false;
    const commit=ai.commit;ai.commit=change=>commit(()=>{if(settled)throw Error('닫히거나 완료된 AI 설정창입니다.');return change();});
    return new Promise((resolve,reject)=>form(title,fields,values=>{
      if(execution)return execution;
      if(settled)return Promise.reject(Error('닫힌 AI 설정창입니다.'));
      execution=(async()=>{
        try{await apply(values);settled=true;const result={completed:true};resolve(result);return result;}
        catch(error){settled=true;reject(error);throw error;}
      })();
      return execution;
    },()=>{if(!settled){settled=true;resolve({cancelled:true});}}));
  };
  const handlers={
    HATCHB(){
      const hatches=ids().map(id=>engine.doc.entities.find(e=>e.id===id)).filter(e=>e&&e.type==='hatch');
      if(!hatches.length)throw Error('경계선을 뽑을 해치를 선택하세요.');
      // 해치는 바깥 경계를 points, 안쪽 구멍을 loops 로 갖는다. 둘 다 닫힌 폴리선으로 만든다.
      const entities=[];
      for(const h of hatches)
        for(const ring of [h.points,...(h.loops||[])])
          if(ring&&ring.length>=3)
            entities.push({type:'polyline',closed:true,points:ring.map(q=>({x:q.x,y:q.y})),layer:activeLayer()});
      if(!entities.length)throw Error('해치에서 쓸 수 있는 경계를 찾지 못했습니다.');
      execute({type:'addMany',entities});
      toast('경계 폴리선 '+entities.length+'개를 현재 레이어에 만들었습니다.');
    },
    LAYOFF(){
      // FREEZE 는 현재 레이어만 다룬다. 이쪽은 도면에서 집은 객체의 레이어를 끈다.
      const target=[...new Set(ids().map(id=>engine.doc.entities.find(e=>e.id===id)?.layer).filter(Boolean))];
      if(!target.length)throw Error('레이어를 끌 객체를 먼저 선택하세요.');
      execute({type:'batch',commands:target.map(id=>({type:'layer.update',id,changes:{visible:false}}))});
      selected().clear();refresh();
      toast('레이어 '+target.length+'개를 껐습니다. 되돌리려면 LAYON.');
    },
    LAYLOCK(){
      const target=[...new Set(ids().map(id=>engine.doc.entities.find(e=>e.id===id)?.layer).filter(Boolean))];
      if(!target.length)throw Error('레이어를 잠글 객체를 먼저 선택하세요.');
      execute({type:'batch',commands:target.map(id=>({type:'layer.update',id,changes:{locked:true}}))});
      selected().clear();refresh();
      toast('레이어 '+target.length+'개를 잠갔습니다. 되돌리려면 LAYUNLOCK.');
    },
    LAYUNLOCK(){
      const locked=engine.doc.layers.filter(l=>l.locked);
      if(!locked.length){toast('잠긴 레이어가 없습니다.');return;}
      execute({type:'batch',commands:locked.map(l=>({type:'layer.update',id:l.id,changes:{locked:false}}))});
      refresh();
      toast('레이어 '+locked.length+'개의 잠금을 풀었습니다.');
    },
    HIDE(){if(!ids().length)throw Error('숨길 객체를 선택하세요.');execute({type:'visibility',ids:ids(),hidden:true});selected().clear();refresh();},
    SHOWALL(){execute({type:'visibility',hidden:false});},
    // 오토캐드 ISOLATEOBJECTS: 고른 객체만 남기고 나머지를 숨긴다. 되돌리기는 SHOWALL(객체 모두 표시).
    ISOLATEOBJECTS(){const keep=new Set(ids());if(!keep.size)throw Error('남길 객체를 선택하세요.');const hide=engine.doc.entities.filter(e=>!keep.has(e.id)&&!e.hidden).map(e=>e.id);if(hide.length)execute({type:'visibility',ids:hide,hidden:true});refresh();toast('선택한 '+keep.size+'개만 보입니다. SHOWALL 로 모두 다시 보이기.');},
    // 오토캐드 LAYFRZ 처럼 고른 객체의 레이어를 동결한다. 현재 레이어는 동결할 수 없다(예전에는 현재 레이어를 동결했다).
    FREEZE(){
      const current=activeLayer(),target=[...new Set(chosen().map(e=>e.layer).filter(Boolean))];
      if(!target.length)throw Error('동결할 레이어의 객체를 먼저 선택하세요.');
      const allowed=target.filter(id=>id!==current);
      if(!allowed.length)throw Error('현재 레이어는 동결할 수 없습니다. 다른 레이어를 현재로 바꾼 뒤 하세요.');
      execute({type:'batch',commands:allowed.map(id=>({type:'layer.update',id,changes:{frozen:true}}))});selected().clear();refresh();
      toast(`레이어 ${allowed.length}개를 동결했습니다.`+(allowed.length<target.length?' 현재 레이어는 동결하지 않았습니다.':''));
    },
    THAW(){execute({type:'batch',commands:engine.doc.layers.map(l=>({type:'layer.update',id:l.id,changes:{frozen:false}}))});},
    GLOBAL(){const s=getSettings();form('전역 설정',[paperField(),field('denominator','기본 축척 1:',s.denominator,'number'),field('textHeight','모형 문자 높이 (mm)',s.textHeight,'number'),field('paperTextHeight','용지 치수 글자 높이 (mm)',s.paperTextHeight,'number'),field('colorMode','출력 색상',s.colorMode,'text',[['mono','모노'],['color','컬러']]),field('projectName','프로젝트명',s.projectName),field('author','설계자',s.author),field('textPreset','표준 글자 높이 (A1 기준)','keep','text',[['keep','위에 적은 값 그대로'],...A1_TEXT_HEIGHTS.map(t=>[t.key,t.paperHeight+'mm · '+t.note])]),field('standard','레이어 표준','keep','text',[['keep','기존 표준 유지'],['save','현재 도면 레이어를 표준으로 저장'],['cals','건설 CALS 표준 레이어 '+CALS_LAYERS.length+'개로 바꾸기'],['none','레이어 표준 쓰지 않기']])],async v=>{
      for(const k of ['denominator','textHeight','paperTextHeight'])v[k]=positive(v[k],k);
      /* 표준 글자 높이는 A1 용지 기준이다. 축척 분모를 곱해야 모형 공간 높이가 된다. */
      const preset=A1_TEXT_HEIGHTS.find(t=>t.key===v.textPreset);
      if(preset){v.paperTextHeight=preset.paperHeight;v.textHeight=preset.paperHeight*v.denominator;}
      delete v.textPreset;
      v.layerStandard=v.standard==='save'?engine.doc.layers.map(l=>({name:l.name,color:l.color,lineweight:l.lineweight||.25,linetype:l.linetype||'CONTINUOUS'}))
        :v.standard==='cals'?CALS_LAYERS.map(l=>({name:l.name,color:l.color,lineweight:.25,linetype:l.linetype}))
        :v.standard==='none'?[]:s.layerStandard;delete v.standard;
      settings={...settings,...v};localStorage.setItem('barun-cad-global',JSON.stringify(settings));
      change({projectSettings:v});applySettings();toast('전역 설정 저장 완료');
    });},
    PDF(ai={}){const sheets=engine.doc.sheets||[];return aiForm(ai,'PDF 출력 · 실제 용지 크기',[paperField(),field('denominator','축척 1:',getSettings().denominator,'number'),field('scope','출력 범위','all','text',[['all','현재 도면 한 장'],['sheets','모든 도곽 번호순'],...sheets.map(s=>[s.id,s.number+' '+s.title])]),field('title','도면명',getSettings().projectName||'건축 도면'),field('colorMode','색상',getSettings().colorMode,'text',[['mono','모노'],['color','컬러']])],async v=>{
      const list=v.scope==='all'?[{paper:v.paper,denominator:positive(v.denominator,'축척'),title:v.title}]:v.scope==='sheets'?sheets:sheets.filter(s=>s.id===v.scope);
      const job=sheetJob(engine.doc,list,{...getSettings(),colorMode:v.colorMode});const result=await api('pdf',job);await ai.commit?.(()=>{});await output(result.data,v.title+'.pdf','application/pdf','',ai.saveOptions||{});toast('PDF '+list.length+'장 출력 완료');
    });},
    SHEET(ai={}){const b=G.bounds(chosen());return aiForm(ai,'선택 영역을 도곽으로 지정 · 선택이 없으면 좌표 입력',[field('number','도면 번호','A-'+String((engine.doc.sheets?.length||0)+1).padStart(3,'0')),field('title','도면명','평면도'),paperField(),field('denominator','축척 1:',getSettings().denominator,'number'),field('minX','영역 최소 X',b?.minX||0,'number'),field('minY','영역 최소 Y',b?.minY||0,'number'),field('maxX','영역 최대 X',b?.maxX||10000,'number'),field('maxY','영역 최대 Y',b?.maxY||7000,'number')],async v=>{
      const sheets=structuredClone(engine.doc.sheets||[]);if(sheets.some(s=>s.number===v.number))throw Error('도면 번호가 중복됩니다.');
      const bounds=Object.fromEntries(['minX','minY','maxX','maxY'].map(k=>[k,num(v[k])]));if(bounds.maxX<=bounds.minX||bounds.maxY<=bounds.minY)throw Error('도곽 영역이 올바르지 않습니다.');
      sheets.push({id:crypto.randomUUID(),number:v.number,title:v.title,paper:v.paper,denominator:positive(v.denominator,'축척'),bounds});if(ai.commit)await ai.commit(()=>change({sheets}));else change({sheets});toast('도곽 지정 완료. SHEETS에서 표제란/파일 분리를 실행하세요.');
    });},
    SHEETS(ai={}){const sheets=engine.doc.sheets||[];if(!sheets.length)throw Error('SHEET로 도곽을 먼저 지정하세요.');return aiForm(ai,'도곽 관리',[field('id','도곽',sheets[0].id,'text',sheets.map(s=>[s.id,s.number+' '+s.title])),field('action','작업','title','text',[['title','도곽과 표제란 작성/갱신'],['export','도곽별 DXF 파일 분리'],['align','모든 도곽을 X 방향으로 정렬'],['delete','선택 도곽 해제']]),field('title','변경 도면명 (빈칸 유지)',''),field('number','변경 도면 번호 (빈칸 유지)','')],async v=>{
      let updated=structuredClone(sheets),s=updated.find(s=>s.id===v.id);if(v.title)s.title=v.title;if(v.number)s.number=v.number;
      if(new Set(updated.map(s=>s.number)).size!==updated.length)throw Error('도면 번호 중복');
      if(v.action==='delete')updated=sheets.filter(s=>s.id!==v.id);
      if(v.action==='export'){await exportSheetDxfs(updated,ai);return;}
      if(v.action==='align'){
        const plan=alignSheetPlan(engine.doc,updated,{direction:'horizontal',gap:1000}),commands=[...sheetFrameUpdates(engine.doc,updated),...plan.moves.map(move=>({type:'move',...move}))];commands.push({type:'document.update',changes:{sheets:plan.sheets}});if(ai.commit)await ai.commit(()=>execute({type:'batch',commands}));else execute({type:'batch',commands});fit();return;
      }
      if(v.action==='title'&&engine.doc.entities.some(e=>e.sheetFrame&&e.sheetId===s.id)){if(ai.commit)await ai.commit(()=>change({sheets:updated}));else change({sheets:updated});toast('도곽 속성을 갱신했습니다.');return;}
      if(v.action==='title'){
        const b=s.bounds,h=getSettings().paperTextHeight*s.denominator,layer=activeLayer();
        const old=engine.doc.entities.filter(e=>e.sheetId===s.id&&e.sheetDecoration).map(e=>e.id);
        const border={type:'rectangle',layer,points:G.rectangle({x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY})};
        const tb=tableBlock([[s.number,s.title,'1:'+s.denominator],[getSettings().projectName,getSettings().author,s.paper]],{x:b.minX,y:b.minY-h,height:h,layer,name:'표제란'});
        const entities=[border,tb].map(e=>({...e,sheetId:s.id,sheetDecoration:true}));
        const command={type:'batch',commands:[...(old.length?[{type:'delete',ids:old}]:[]),{type:'addMany',entities},{type:'document.update',changes:{sheets:updated}}]};if(ai.commit)await ai.commit(()=>execute(command));else execute(command);
      }else if(ai.commit)await ai.commit(()=>change({sheets:updated}));else change({sheets:updated});toast('도곽 작업 완료');
    });},
    SHEETNUMBER(){const sheets=requireSheets();form('도곽 번호 일괄 변경',[field('prefix','번호 앞 문자','A-'),field('start','시작 번호',1,'number'),field('step','증가값',1,'number'),field('digits','숫자 자리수',3,'number'),field('order','번호 순서','number','text',[['number','현재 번호순'],['position','도곽 위치순(왼쪽부터)']])],v=>{change({sheets:renumberSheets(sheets,v)});toast('도곽 '+sheets.length+'장의 번호를 변경했습니다.');});},
    SHEETSCALE(){const sheets=requireSheets();form('도곽 축척·용지 일괄 변경',[field('id','대상','all','text',[['all','모든 도곽'],...sheets.map(s=>[s.id,s.number+' '+s.title])]),field('denominator','축척 1:',getSettings().denominator,'number'),field('paper','용지','keep','text',[['keep','기존 용지 유지'],['A1','A1'],['A3','A3'],['A4','A4']])],v=>{change({sheets:setSheetScale(sheets,v)});toast('도곽 축척을 변경했습니다. 표제란은 SHEETS에서 갱신하세요.');});},
    SHEETALIGN(){const sheets=requireSheets();form('도곽 번호순 정렬',[field('direction','방향','horizontal','text',[['horizontal','가로 한 줄'],['vertical','세로 한 줄']]),field('gap','도곽 사이 간격 mm',1000,'number')],v=>{const plan=alignSheetPlan(engine.doc,sheets,v),commands=plan.moves.map(move=>({type:'move',...move}));commands.push({type:'document.update',changes:{sheets:plan.sheets}});execute({type:'batch',commands});fit();toast('도곽과 내부 객체를 번호순으로 정렬했습니다.');});},
    SHEETCOPY(){const sheets=requireSheets(),source=sheets[0],width=source.bounds.maxX-source.bounds.minX;form('도곽과 내부 객체 복사',[field('id','원본 도곽',source.id,'text',sheets.map(s=>[s.id,s.number+' '+s.title])),field('number','새 도면 번호','A-'+String(sheets.length+1).padStart(3,'0')),field('title','새 도면명',source.title),field('dx','X 복사 거리 mm',width+1000,'number'),field('dy','Y 복사 거리 mm',0,'number')],v=>{if(sheets.some(sheet=>sheet.number===v.number))throw Error('도면 번호가 중복됩니다.');const result=duplicateSheet(engine.doc,sheets.find(sheet=>sheet.id===v.id),v);execute({type:'batch',commands:[{type:'addMany',entities:result.entities},{type:'document.update',changes:{sheets:[...sheets,result.sheet]}}]});fit();toast('도곽과 내부 객체를 복사했습니다.');});},
    PLOTBOX(){const b=G.bounds(chosen());form('출력 박스 지정 · 박스선은 출력하지 않음',[field('number','도면 번호','P-'+String((engine.doc.sheets?.length||0)+1).padStart(3,'0')),field('title','도면명','출력 도면'),paperField(),field('denominator','축척 1:',getSettings().denominator,'number'),field('minX','영역 최소 X',b?.minX||0,'number'),field('minY','영역 최소 Y',b?.minY||0,'number'),field('maxX','영역 최대 X',b?.maxX||10000,'number'),field('maxY','영역 최대 Y',b?.maxY||7000,'number')],v=>{const sheets=structuredClone(engine.doc.sheets||[]);if(sheets.some(sheet=>sheet.number===v.number))throw Error('도면 번호가 중복됩니다.');const bounds=Object.fromEntries(['minX','minY','maxX','maxY'].map(key=>[key,num(v[key])]));if(bounds.maxX<=bounds.minX||bounds.maxY<=bounds.minY)throw Error('출력 영역이 올바르지 않습니다.');const sheet={id:crypto.randomUUID(),number:v.number,title:v.title,paper:v.paper,denominator:positive(v.denominator,'축척'),bounds,plotBox:true},border={type:'rectangle',layer:activeLayer(),points:G.rectangle({x:bounds.minX,y:bounds.minY},{x:bounds.maxX,y:bounds.maxY}),sheetId:sheet.id,sheetDecoration:true,plotBox:true};execute({type:'batch',commands:[{type:'add',entity:border},{type:'document.update',changes:{sheets:[...sheets,sheet]}}]});toast('출력 박스를 지정했습니다.');});},
    SHEETPDF(){const sheets=requireSheets();form('모든 도곽 번호순 PDF',[field('title','PDF 파일명',getSettings().projectName||'도면집'),field('colorMode','색상',getSettings().colorMode,'text',[['mono','모노'],['color','컬러']])],v=>exportSheetPdf(sheets,v.title,v.colorMode));},
    SHEETDXF(){return exportSheetDxfs(requireSheets());},
    MULTIFILEEDIT(){pickFiles('.dxf,.dwg,.bcad',true,files=>{if(!files.length)throw Error('편집할 도면 파일을 선택하세요.');form('여러 도면 문자·블록·레이어 일괄 편집 · 원본은 유지',[field('action','작업','text','text',[['text','문자 찾아 바꾸기'],['block','블록 이름 바꾸기'],['layer','레이어 이름·색·선굵기 바꾸기']]),field('find','찾을 문자',''),field('replace','바꿀 문자',''),field('from','기존 블록/레이어 이름',''),field('to','새 블록/레이어 이름',''),field('color','레이어 색상 (선택, #RRGGBB)',''),field('lineweight','레이어 선굵기 (선택)','')],async v=>{let total=0;for(const file of files){const extension=file.name.slice(file.name.lastIndexOf('.')).toLowerCase();let doc;if(extension==='.bcad')doc=JSON.parse(new TextDecoder().decode(new Uint8Array(await file.arrayBuffer())));else {const imported=await api('import',{data:await b64(file),extension});if(imported.report?.unitless)throw Error(file.name+': 단위 없는 도면은 일괄 편집하지 않았습니다.');doc=imported.document;}const edited=applyDrawingBatchEdit(doc,v);total+=edited.changed;const stem=file.name.replace(/\.[^.]+$/,'')+'_일괄수정';if(extension==='.bcad')await output(text64(JSON.stringify(edited.document,null,2)),stem+'.bcad','application/json');else {const exported=await api('export',{document:edited.document});await output(exported.data,stem+'.dxf','application/dxf');}}toast('원본을 유지하고 '+files.length+'개 사본에서 '+total+'곳을 수정했습니다.');});});},
    SHEETLIST(){const sheets=engine.doc.sheets||[];if(!sheets.length)throw Error('도곽이 없습니다.');form('도면목록표 삽입',pointFields(),v=>add([tableBlock([['번호','도면명','축척','용지'],...sheets.toSorted((a,b)=>a.number.localeCompare(b.number,'ko',{numeric:true})).map(s=>[s.number,s.title,'1:'+s.denominator,s.paper])],{x:num(v.x),y:num(v.y),height:getSettings().textHeight,layer:activeLayer(),name:'도면목록표'})]));},
    PDFMERGE(){pickFiles('.pdf',true,async files=>{if(files.length<2)throw Error('PDF를 두 개 이상 선택하세요. 파일명 순서로 합칩니다.');files.sort((a,b)=>a.name.localeCompare(b.name,'ko',{numeric:true}));const r=await api('pdf',{action:'merge',files:await Promise.all(files.map(b64))});await output(r.data,'합친도면.pdf','application/pdf');});},
    PDFSPLIT(){pickFiles('.pdf',false,async files=>{const r=await api('pdf',{action:'split',data:await b64(files[0])});for(let i=0;i<r.files.length;i++)await output(r.files[i],files[0].name.replace(/\.pdf$/i,'')+'_'+String(i+1).padStart(3,'0')+'.pdf','application/pdf');});},
  };
  const projectReady=Promise.resolve(applySettings());
  return {projectReady,run(name){if(!handlers[name])return false;Promise.resolve().then(()=>handlers[name]()).catch(e=>toast(e.message,true));return true;},api,requestOutput:(route,data)=>engineApi.api(route,data,{prepare:false}),output,b64,pickFiles,handlers,isLargeDocument,saveLargeDocument:(document,name,format,options={})=>saveLargeDocument({...options,document,name,format,api,toast}),context:{...ctx,field,pointFields,chosen,add,change,load,getSettings,api,output,pickFiles,b64,bytes},getProjectState:()=>({folder:'',settings:structuredClone(settings)}),setProjectState:value=>{folder='';settings=structuredClone(value?.settings||defaults);},getFolder:()=>ctx.getDrawingFolder?.()||folder};
}
