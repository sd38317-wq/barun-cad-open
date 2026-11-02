// 미리 그림 보기(2026-10-30 시안-미리그림보기): 답 아래 그림 칸·크게 보기·저장. 작은 가짜 DOM 으로 실제 installChatImages 를 돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chatImageFileName,installChatImages} from './chat.js';

class El{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parent=null;this.attributes={};this.listeners={};this.className='';this.textContent='';this.open=false;}
 append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
 replaceWith(n){const i=this.parent.children.indexOf(this);n.parent=this.parent;this.parent.children[i]=n;}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}removeAttribute(k){delete this.attributes[k];if(k==='src')delete this.src;}
 addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
 dispatch(type,event={}){for(const fn of this.listeners[type]||[])fn({target:this,stopPropagation(){},...event});}
 all(){return this.children.flatMap(c=>[c,...c.all()]);}
 find(match){return this.all().filter(n=>n.className.split(' ').includes(match)||n.tagName===match.toUpperCase());}
 focus(){globalThis.document.activeElement=this;}
 click(){this.onclick?.();}
 showModal(){this.open=true;}close(){this.open=false;this.dispatch('close');}
}
const PNG=Buffer.from('\x89PNG fixture').toString('base64');
function setup({missing=new Set(),drawing='/Users/me/도면/상가주택.dxf'}={}){
 globalThis.document={body:new El('body'),activeElement:null,createElement:tag=>new El(tag)};
 const calls=[],saved=[],toasts=[];
 const studio={api:async(route,payload)=>{calls.push([route,payload]);return missing.has(payload.id)?{id:payload.id,missing:true}:{id:payload.id,mimeType:'image/png',data:PNG};},
  output:async(...args)=>{saved.push(args);return '/saved.png';},context:{getDrawingPath:()=>drawing,toast:(...a)=>toasts.push(a)}};
 return {images:installChatImages(studio),calls,saved,toasts};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const IMAGES=[{id:'a'.repeat(32),caption:'건물 전체'},{id:'b'.repeat(32),caption:'1F 실내'},{id:'c'.repeat(32),caption:'4F 실내'}];

test('save name: drawing name, caption, time; unsafe characters replaced; unsaved drawing uses 미리그림',()=>{
 const date=new Date(2026,9,30,14,5);
 assert.equal(chatImageFileName('/Users/me/도면/상가주택.dxf','4F 실내','image/png',date),'상가주택_4F 실내_20261030-1405.png');
 assert.equal(chatImageFileName('C:\\도면\\a.dwg','풍동 · 북/서','image/png',date),'a_풍동 · 북_서_20261030-1405.png');
 assert.equal(chatImageFileName('','현장 사진','image/jpeg',date),'미리그림_현장 사진_20261030-1405.jpg');
});

test('answer images render as a 3-per-row strip with captions, alt text and focusable buttons',async()=>{
 const {images,calls}=setup();const box=images.strip(IMAGES);await tick();await tick();
 assert.equal(box.className,'ai-images');assert.equal(box.find('ai-image-grid').length,1);
 const buttons=box.find('ai-image');assert.equal(buttons.length,3);
 assert.deepEqual(buttons.map(b=>b.children[1].textContent),['건물 전체','1F 실내','4F 실내']);
 assert.deepEqual(buttons.map(b=>b.children[0].alt),['건물 전체','1F 실내','4F 실내']);
 assert.ok(buttons.every(b=>b.tagName==='BUTTON'&&b.type==='button'&&b.getAttribute('aria-label').endsWith('크게 보기')));
 assert.ok(buttons.every(b=>String(b.children[0].src).startsWith('blob:')),'thumbnail loaded from the engine by id');
 assert.deepEqual(calls.map(c=>c[1]),IMAGES.map(i=>({action:'image',id:i.id})));
 assert.equal(box.find('ai-image-actions')[0].children[1].textContent,'그림 저장');
});

test('a deleted image file shows a placeholder instead of a broken image',async()=>{
 const {images}=setup({missing:new Set([IMAGES[1].id])});const box=images.strip(IMAGES);await tick();await tick();
 const missing=box.find('ai-image-missing');assert.equal(missing.length,1);
 assert.equal(missing[0].textContent,'그림 없음');assert.equal(missing[0].getAttribute('role'),'img');
 assert.equal(box.find('ai-image')[1].disabled,true);
});

test('click opens the large view; close button, backdrop and image click close it and focus returns',async()=>{
 const {images}=setup();const box=images.strip(IMAGES);await tick();await tick();
 const thumb=box.find('ai-image')[2];thumb.click();await tick();await tick();
 const viewer=document.body.find('ai-image-viewer')[0];
 assert.ok(viewer.open);assert.equal(viewer.find('h2')[0].textContent,'4F 실내');
 const big=viewer.find('img')[0];assert.equal(big.alt,'4F 실내');assert.ok(String(big.src).startsWith('blob:'));
 assert.equal(document.activeElement,viewer.find('ai-image-close')[0],'focus moves into the viewer');
 viewer.find('ai-image-close')[0].click();assert.equal(viewer.open,false);assert.equal(document.activeElement,thumb,'focus returns to thumbnail');
 thumb.click();viewer.dispatch('click',{target:viewer});assert.equal(viewer.open,false,'backdrop click closes');
 thumb.click();viewer.dispatch('click',{target:big});assert.equal(viewer.open,false,'image click closes');
 let stopped=false;viewer.dispatch('keydown',{key:'Escape',stopPropagation(){stopped=true;}});assert.ok(stopped,'keys stay inside the viewer (Esc is the dialog close)');
});

test('save goes through studio.output (the desktop safe save path) next to the drawing',async()=>{
 const {images,saved}=setup();const box=images.strip(IMAGES.slice(0,1));
 box.find('ai-image-actions')[0].children[1].click();await tick();await tick();
 assert.equal(saved.length,1);const [data,name,mime,target]=saved[0];
 assert.equal(data,PNG);assert.match(name,/^상가주택_건물 전체_\d{8}-\d{4}\.png$/);assert.equal(mime,'image/png');assert.equal(target,'/Users/me/도면/상가주택.dxf');
 const unsaved=setup({drawing:''});await unsaved.images.save(IMAGES[0]);assert.equal(unsaved.saved[0][3],'','unsaved drawing: shell picks Downloads');
 const gone=setup({missing:new Set([IMAGES[0].id])});const strip=gone.images.strip(IMAGES.slice(0,1));strip.find('ai-image-actions')[0].children[1].click();await tick();await tick();
 assert.equal(gone.saved.length,0);assert.match(gone.toasts[0][0],/지워져/);
});
