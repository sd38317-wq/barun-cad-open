import test from 'node:test';
import assert from 'node:assert/strict';
import { mountWaitStage } from './wait-stage.js';

class FakeElement {
  constructor(document, tag = 'div') { this.ownerDocument = document; this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.dataset = {}; this.hidden = false; this.clientWidth = 640; this.listeners = {}; this.className = ''; this.textContent = ''; }
  appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
  replaceChildren(...nodes) { this.children = []; nodes.forEach((node) => this.appendChild(node)); }
  setAttribute() {}
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== fn); }
  dispatch(type) { (this.listeners[type] || []).forEach((fn) => fn({ target: this })); }
  querySelector(selector) {
    if (selector.startsWith('.')) {
      const wanted = selector.slice(1);
      if (this.className === wanted) return this;
      for (const child of this.children) { const match = child.querySelector(selector); if (match) return match; }
    }
    return null;
  }
  set innerHTML(value) {
    const classes = ['barun-wait-stage__main','barun-wait-stage__title','barun-wait-stage__phases','barun-wait-stage__compact','barun-wait-stage__info','barun-wait-stage__elapsed','barun-wait-stage__progress','barun-wait-stage__skip','barun-wait-stage__detail','barun-wait-stage__note'];
    this.children = [];
    for (const className of classes) { const node = new FakeElement(this.ownerDocument, className.includes('skip') ? 'button' : 'span'); node.className = className; this.appendChild(node); }
  }
}
class FakeDocument {
  constructor() { this.hidden = false; this.head = new FakeElement(this, 'head'); this.root = new FakeElement(this); this.listeners = {}; }
  createElement(tag) { return new FakeElement(this, tag); }
  getElementById() { return null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== fn); }
  dispatch(type) { (this.listeners[type] || []).forEach((fn) => fn()); }
  get documentElement() { return this.root; }
}
test('wait stage renders compact phases, progress, and source detail', () => {
  const document = new FakeDocument(); const viewport = new FakeElement(document); viewport.clientWidth = 640;
  const stage = mountWaitStage(viewport);
  stage.setPhases([{ key: 'base', label: '기준선' }, { key: 'text', label: '문자' }]);
  stage.push({ phase: 'text', label: '문자 배치', source: 'derived' });
  const phases = stage.element.querySelector('.barun-wait-stage__phases');
  assert.equal(stage.element.querySelector('.barun-wait-stage__compact').textContent, '문자 2/2');
  assert.equal(phases.children[0].dataset.state, 'done');
  assert.equal(phases.children[1].dataset.state, 'current');
  assert.equal(stage.element.querySelector('.barun-wait-stage__detail').textContent, '문자 배치');
  stage.setProgress(2, 4);
  assert.equal(stage.element.querySelector('.barun-wait-stage__progress').textContent, '50%');
  stage.setProgress(2, null);
  assert.equal(stage.element.querySelector('.barun-wait-stage__progress').textContent, '');
  stage.destroy();
});
test('skip invokes callback and destroy removes element and observers', () => {
  const document = new FakeDocument(); const viewport = new FakeElement(document); let skipped = 0; const stage = mountWaitStage(viewport, { onSkip: () => { skipped += 1; } });
  stage.element.querySelector('.barun-wait-stage__skip').dispatch('click');
  assert.equal(skipped, 1); stage.destroy(); assert.equal(viewport.children.includes(stage.element), false);
});
test('finish is removed at 1600ms and notifies destroy once', async () => {
  const document=new FakeDocument(),viewport=new FakeElement(document);let destroyed=0;
  const stage=mountWaitStage(viewport,{onDestroy:()=>destroyed++});
  stage.finish();assert.equal(viewport.children.includes(stage.element),true);
  await new Promise(resolve=>setTimeout(resolve,1700));
  assert.equal(viewport.children.includes(stage.element),false);assert.equal(destroyed,1);
  stage.destroy();assert.equal(destroyed,1);assert.equal(document.listeners.visibilitychange.length,0);
});
test('hidden finish and hiding a completed band remove it immediately without waiting for visibility', () => {
 for(const hiddenFirst of [false,true]){
  const document=new FakeDocument(),viewport=new FakeElement(document);let destroyed=0;
  const stage=mountWaitStage(viewport,{onDestroy:()=>destroyed++});
  if(hiddenFirst){document.hidden=true;document.dispatch('visibilitychange');}
  stage.finish();
  if(!hiddenFirst){document.hidden=true;document.dispatch('visibilitychange');}
  assert.equal(viewport.children.includes(stage.element),false);assert.equal(destroyed,1);
  document.hidden=false;document.dispatch('visibilitychange');stage.destroy();assert.equal(destroyed,1);
 }
});

test('tool work yields its single slot and clock to a result reveal',()=>{
 const document=new FakeDocument(),viewport=new FakeElement(document);
 const original={setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};const clocks=new Set();let serial=0;
 globalThis.setInterval=()=>{const id=++serial;clocks.add(id);return id;};globalThis.clearInterval=id=>clocks.delete(id);
 let work,reveal;
 try{
  work=mountWaitStage(viewport,{kind:'work',title:'AI 작업 중'});work.setPhases([{key:'run',label:'도면 읽는 중'}]);work.push({phase:'run',source:'engine',elapsedMs:4500});
  assert.equal(work.element.querySelector('.barun-wait-stage__compact').textContent,'도면 읽는 중');
  assert.equal(work.element.querySelector('.barun-wait-stage__skip').hidden,true);assert.equal(clocks.size,1);
  reveal=mountWaitStage(viewport,{kind:'drafting'});assert.equal(work.element.hidden,true);assert.equal(reveal.element.hidden,false);assert.equal(clocks.size,1);
  document.hidden=true;document.dispatch('visibilitychange');assert.equal(clocks.size,0);
  document.hidden=false;document.dispatch('visibilitychange');assert.equal(clocks.size,1);
  reveal.destroy();assert.equal(work.element.hidden,false);assert.equal(clocks.size,1);
 }finally{work?.destroy();reveal?.destroy();Object.assign(globalThis,original);}
 assert.equal(clocks.size,0);
});

test('the shared slot stays inside the canvas area left of a visible conversation',()=>{
 const document=new FakeDocument(),viewport=new FakeElement(document),sidebar={hidden:false,getBoundingClientRect:()=>({left:400,width:240})};
 const create=document.createElement.bind(document);document.createElement=tag=>{const el=create(tag);el.style={};return el;};
 document.getElementById=id=>id==='ai-history-panel'?sidebar:null;viewport.getBoundingClientRect=()=>({left:0,right:640});
 const stage=mountWaitStage(viewport,{kind:'work'});
 assert.equal(stage.element.style.left,'200px');assert.equal(stage.element.style.maxWidth,'380px');stage.destroy();
});
