// node --test ai-consent.test.js — 바깥 AI 첫 연결 허락 창(가짜 DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import {showConsentRequests,openConsentManager,describeProgram} from './ai-consent.js';

function fakeDocument(){
 const make=tag=>{
  const node={tagName:tag.toUpperCase(),children:[],dataset:{},className:'',textContent:'',open:false,removed:false,listeners:{},
   append(...items){for(const item of items){item.parent=node;node.children.push(item);}},
   replaceChildren(){node.children=[];},
   remove(){node.removed=true;if(node.parent)node.parent.children=node.parent.children.filter(c=>c!==node);},
   showModal(){node.open=true;},close(){node.open=false;node.listeners.close?.forEach(fn=>fn());},
   addEventListener(name,fn){(node.listeners[name]||=[]).push(fn);},
  };
  return node;
 };
 const body=make('body');
 return {body,createElement:make};
}
const text=node=>[node.textContent,...node.children.map(text)].join(' ');
const buttons=node=>node.tagName==='BUTTON'?[node]:node.children.flatMap(buttons);
const dialogs=doc=>doc.body.children.filter(c=>c.tagName==='DIALOG');
const REQUEST={id:'r1',label:'Codex',program:'codex.exe',signer:'OpenAI OpCo, LLC',path:'C:/x/codex.exe',remember:true,client:'codex-mcp-client'};

test('허락 창: 프로그램과 서명을 보여 주고, 직접 누른 [허락]만 엔진에 답한다', async()=>{
 const doc=fakeDocument(),calls=[];
 const api=async(route,data)=>{calls.push([route,data]);return {ok:true};};
 assert.equal(showConsentRequests([REQUEST],{api,doc}),1);
 const [dialog]=dialogs(doc);assert.ok(dialog.open);
 assert.match(text(dialog),/Codex이\(가\) 이 CAD를 쓰려고 합니다/);
 assert.match(text(dialog),/codex\.exe · 서명: OpenAI OpCo, LLC/);
 const allow=buttons(dialog).find(b=>b.dataset.consent==='allow');
 assert.equal(buttons(dialog).find(b=>b.autofocus)?.dataset.consent,'deny','처음 초점은 [거절]');
 await allow.onclick({isTrusted:false});
 assert.equal(calls.length,0,'스크립트가 만든 누름은 답하지 않는다');
 await allow.onclick({isTrusted:true});
 assert.deepEqual(calls,[['ai-consent',{action:'decide',id:'r1',allow:true}]]);
 assert.equal(dialogs(doc).length,0);
 assert.equal(showConsentRequests([],{api,doc}),0);
});

test('허락 창: [거절]·Esc·목록에서 빠짐', async()=>{
 const doc=fakeDocument(),calls=[];
 const api=async(route,data)=>{calls.push(data);return {ok:true};};
 showConsentRequests([{...REQUEST,id:'r2'}],{api,doc});
 await buttons(dialogs(doc)[0]).find(b=>b.dataset.consent==='deny').onclick({isTrusted:true});
 assert.deepEqual(calls,[{action:'decide',id:'r2',allow:false}]);
 showConsentRequests([{...REQUEST,id:'r3'}],{api,doc});
 const event={preventDefault(){event.prevented=true;}};dialogs(doc)[0].oncancel(event);
 assert.ok(event.prevented);assert.equal(dialogs(doc).length,0);
 showConsentRequests([{...REQUEST,id:'r3'}],{api,doc});
 assert.equal(dialogs(doc).length,0,'Esc 로 닫은 요청은 다시 띄우지 않는다');
 showConsentRequests([{...REQUEST,id:'r4'}],{api,doc});
 assert.equal(dialogs(doc).length,1);
 showConsentRequests([],{api,doc});
 assert.equal(dialogs(doc).length,0,'다른 창에서 답했거나 시간이 지나면 닫는다');
});

test('서명 없는 프로그램·기억하지 않는 프로그램은 그 사실을 알린다',()=>{
 const doc=fakeDocument();
 showConsentRequests([{id:'r5',label:'evil',program:'evil.exe',signer:null,path:'C:/tmp/evil.exe',remember:true},{id:'r6',label:'python',program:'python.exe',signer:'Python Software Foundation',remember:false}],{api:async()=>({}),doc});
 const [unsigned,generic]=dialogs(doc);
 assert.match(text(unsigned),/서명 없는 프로그램/);assert.match(text(unsigned),/C:\/tmp\/evil\.exe/);
 assert.match(text(generic),/이번 연결만 허락/);
 showConsentRequests([],{api:async()=>({}),doc});
 assert.equal(describeProgram({program:'a.exe'}),'프로그램: a.exe · 서명 없는 프로그램');
});

test('허락한 AI 관리: 목록과 [허락 취소]', async()=>{
 const doc=fakeDocument(),calls=[];
 let rows=[{key:'sig:OpenAI OpCo, LLC|codex.exe',decision:'allow',label:'Codex',program:'codex.exe',signer:'OpenAI OpCo, LLC'}];
 const api=async(route,data)=>{calls.push(data);if(data.action==='revoke')rows=[];return data.action==='list'?{entries:rows}:{ok:true};};
 const dialog=await openConsentManager({api,doc});
 assert.match(text(dialog),/Codex — 허락함/);
 await buttons(dialog).find(b=>b.textContent==='허락 취소').onclick();
 assert.deepEqual(calls,[{action:'list'},{action:'revoke',key:'sig:OpenAI OpCo, LLC|codex.exe'},{action:'list'}]);
 assert.match(text(dialog),/아직 허락하거나 거절한 AI 프로그램이 없습니다/);
 buttons(dialog).find(b=>b.textContent==='닫기').onclick();
 assert.equal(dialogs(doc).length,0);
});
