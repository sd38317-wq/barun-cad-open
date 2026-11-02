// 5.0.4 안정성 검토 S3 · 화면 쪽 엔진 호출: 시간 제한, 재시작 뒤 토큰 재발급과 재시도
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineApi,ROUTE_TIMEOUT_MS,engineToken} from './studio.js';

const jsonResponse=(status,body,headers={})=>{const r={ok:status<300,status,headers:{get:name=>headers[name]??null},json:async()=>body};r.clone=()=>r;return r;};
test('refreshes the token and retries once after the engine restarts (403 or connection loss)',async()=>{
 const calls=[],toasts=[];let statusCalls=0,tokenSerial=0;
 const fetchImpl=async(url,options={})=>{
  calls.push(url);
  if(url==='/api/status'){statusCalls++;return jsonResponse(200,{token:'tok'+(++tokenSerial)},{'X-Barun-CAD':'2'});}
  if(options.headers['X-CAD-Token']==='tok1')return jsonResponse(403,{error:'이 CAD 화면에서 요청을 다시 실행하세요.'});
  return jsonResponse(200,{ok:true,token:options.headers['X-CAD-Token']});
 };
 const {api}=createEngineApi({fetch:fetchImpl,toast:t=>toasts.push(t),sleep:async()=>{},reconnectMs:100});
 const result=await api('export',{document:{}});
 assert.notEqual(result.token,'tok1');assert.ok(statusCalls>=2);   // 재시작 뒤 새 토큰으로 재시도
 assert.ok(toasts.some(t=>/다시 시작되어/.test(t)));
 let dropped=0;
 const lossy=createEngineApi({fetch:async(url,options={})=>{if(url==='/api/status')return jsonResponse(200,{token:'t'},{'X-Barun-CAD':'2'});if(dropped++===0)throw new TypeError('Failed to fetch');return jsonResponse(200,{ok:1});},sleep:async()=>{},reconnectMs:100});
 assert.deepEqual(await lossy.api('pdf',{}),{ok:1});
});
test('a 403 with a code (login required) is shown as is, keeps the token and is not resent as an engine restart',async()=>{
 let statusCalls=0,posts=0;
 const fetchImpl=async url=>{
  if(url==='/api/status'){statusCalls++;return jsonResponse(200,{token:'tok'},{'X-Barun-CAD':'2'});}
  posts++;return jsonResponse(403,{error:'로그인 필요 · [계정 연결]로 로그인하세요.',code:'ai_login_required'});
 };
 const {api}=createEngineApi({fetch:fetchImpl,toast:()=>{},sleep:async()=>{},reconnectMs:100});
 await assert.rejects(api('export',{document:{}}),e=>e.code==='ai_login_required'&&e.status===403&&/로그인 필요/.test(e.message)&&!/재시작/.test(e.message));
 assert.equal(posts,1);assert.equal(statusCalls,1);
});
test('does not resend chat messages and gives a Korean error when the engine never returns',async()=>{
 let sends=0;
 const chat=createEngineApi({fetch:async(url)=>{if(url==='/api/status')return jsonResponse(200,{token:'t'},{'X-Barun-CAD':'2'});sends++;throw new TypeError('Failed to fetch');},sleep:async()=>{},reconnectMs:50});
 await assert.rejects(chat.api('chat',{action:'send'}),/Failed to fetch/);assert.equal(sends,1);
 const dead=createEngineApi({fetch:async(url)=>{if(url==='/api/status')throw new TypeError('Failed to fetch');throw new TypeError('Failed to fetch');},sleep:async()=>{},reconnectMs:30,pollMs:5});
 await assert.rejects(dead.api('export',{}),/로컬 처리 엔진에 연결하지 못했습니다/);
});
test('every route has a timeout and an aborted request becomes a Korean timeout message',async()=>{
 assert.ok(ROUTE_TIMEOUT_MS.default>0);assert.ok(ROUTE_TIMEOUT_MS['import-path']>=ROUTE_TIMEOUT_MS.default);assert.ok(ROUTE_TIMEOUT_MS.bridge<ROUTE_TIMEOUT_MS.default);assert.ok(ROUTE_TIMEOUT_MS.chat>=200_000);   // 엔진 쪽 미리 대기 190 s 보다 길다
 const hang=createEngineApi({fetch:(url,options={})=>url==='/api/status'?Promise.resolve(jsonResponse(200,{token:'t'},{'X-Barun-CAD':'2'})):new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})))),timeouts:{default:20},sleep:async()=>{}});
 await assert.rejects(hang.api('export',{}),/응답이 0초 안에 오지 않았습니다 \(export\)/);
});

test('desktop engines hand the token over the shell IPC, never through /api/status',async()=>{
 assert.equal(await engineToken({token:'abc'}),'abc');
 let asked=0;const desktop={engineToken:async()=>{asked++;return 'from-shell';}};
 assert.equal(await engineToken({tokenPolicy:'desktop'},desktop),'from-shell');assert.equal(asked,1);
 assert.equal(await engineToken({tokenPolicy:'desktop'},undefined),null);
 assert.equal(await engineToken({},desktop),null);assert.equal(asked,1);
});

test('설계엔진 프록시 404 상태는 동기 전환에 전달되고 자동 재요청되지 않는다',async()=>{
 const routes=[];const api=createEngineApi({fetch:async url=>{routes.push(url);return url==='/api/status'?jsonResponse(200,{token:'offline'}):jsonResponse(404,{error:'지원하지 않는 API'});}}).api;
 await assert.rejects(()=>api('site-plan/jobs',{action:'submit'}),e=>e.status===404);assert.deepEqual(routes,['/api/status','/api/site-plan/jobs']);
});

test('bridge timeout reconnects and retries one pulse with a fresh token',async()=>{
 let posts=0,statuses=0;
 const fetch=async(url,options={})=>{
  if(url==='/api/status'){statuses++;return {ok:true,headers:{get:()=> '2'},json:async()=>({token:'token-'+statuses})};}
  posts++;if(posts===1)throw Object.assign(Error('timeout'),{name:'AbortError'});
  return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({requests:[]})};
 };
 const client=createEngineApi({fetch});assert.deepEqual(await client.api('bridge',{}),{requests:[]});assert.equal(posts,2);assert.ok(statuses>=2);
});
