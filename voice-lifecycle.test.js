import test from 'node:test';
import assert from 'node:assert/strict';
import {installVoiceInput} from './chat.js';

test('denied microphone ends conversation and restores controls without sending',async()=>{
 const saved=Object.getOwnPropertyDescriptors(globalThis);
 class Element extends EventTarget{
  constructor(){super();this.children=[];this.attrs={};this.value='';}
  append(e){this.children.push(e);} before(e){elements.push(e);}
  setAttribute(k,v){this.attrs[k]=v;}
  click(){return this.onclick?.();}
 }
 const elements=[],input=new Element(),send=new Element(),controls=new Element(),dialog=new Element();
 let sent=0;send.onclick=()=>sent++;
 dialog.querySelector=s=>({'#ai-message':input,'#ai-send':send,'.ai-controls':controls})[s];
 try{
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Element()}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{speechSynthesis:{cancel(){}},addEventListener(){}}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}}}});
  installVoiceInput(dialog,()=>false);
  const talk=controls.children[0];talk.click();await new Promise(r=>setImmediate(r));
  assert.equal(talk.attrs['aria-pressed'],'false');
  assert.equal(elements[0].disabled,false);
  assert.equal(send.disabled,false);assert.equal(sent,0);
  assert.match(dialog.children[0].textContent,/허용되지/);
  let resolvePermission,stopped=0;
  navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{resolvePermission=resolve;});
  talk.click();
  dialog.dispatchEvent(new Event('voice-cancel'));
  resolvePermission({getTracks:()=>[{stop(){stopped++;}}]});
  await new Promise(r=>setImmediate(r));
  assert.equal(stopped,1,'late microphone stream must be released after cancellation');
  assert.equal(talk.attrs['aria-pressed'],'false');
  assert.equal(elements[0].disabled,false);assert.equal(sent,0);
 }finally{
  for(const key of ['document','window','navigator']){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}
 }
});

test('closing the panel without using voice does not say voice input ended (A45)',()=>{
 const saved=Object.getOwnPropertyDescriptors(globalThis);
 class Element extends EventTarget{
  constructor(){super();this.children=[];this.attrs={};this.value='';this.textContent='';}
  append(e){this.children.push(e);} before(){}
  setAttribute(k,v){this.attrs[k]=v;}
 }
 const input=new Element(),send=new Element(),controls=new Element(),dialog=new Element();
 dialog.querySelector=s=>({'#ai-message':input,'#ai-send':send,'.ai-controls':controls})[s];
 try{
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Element()}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{speechSynthesis:{cancel(){}},addEventListener(){}}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[]})}}});
  installVoiceInput(dialog,()=>false);
  dialog.dispatchEvent(new Event('voice-cancel'));
  assert.doesNotMatch(dialog.children[0].textContent,/음성 입력을 종료/);
 }finally{
  for(const key of ['document','window','navigator']){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}
 }
});
