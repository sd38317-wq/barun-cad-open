import test from 'node:test';
import assert from 'node:assert/strict';
import {describeToolEvent,createAIWorkBand,notifyAIChange,TOOL_LABELS} from './ai-work-band.js';

const event=(id,phase='running',extra={})=>({id,tool:'cad_get_document',phase,stage:phase,source:'chat',request_epoch:7,started_at_ms:1000,at_ms:2000,...extra});
function harness(enabled=()=>true){
 const stages=[];
 const node=()=>({children:[],attributes:{},listeners:{},hidden:false,className:'',
  classList:{add(){}},setAttribute(k,v){this.attributes[k]=v;},
  appendChild(n){n.remove();n.parent=this;this.children.push(n);return n;},
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;},
  replaceChildren(...nodes){this.children.forEach(n=>n.parent=null);this.children=[];nodes.forEach(n=>this.appendChild(n));},
  querySelector(selector){return this.children.find(n=>n.className===selector.slice(1))||this.children.map(n=>n.querySelector(selector)).find(Boolean);},
  addEventListener(type,fn){this.listeners[type]=fn;}});
 const document={getElementById:()=>true,createElement:node},viewport={ownerDocument:document};
 const mount=(_,options)=>{const element=node();
  for(const name of ['main','info','skip','detail','note']){const n=node();n.className='barun-wait-stage__'+name;element.appendChild(n);}
  const s={element,options,phases:[],pushes:[],finishes:[],destroyed:false,setPhases(p){this.phases=p;},push(e){this.pushes.push(e);},finish(e){this.finishes.push(e);},destroy(){this.destroyed=true;options.onDestroy();}};stages.push(s);return s;};
 return {stages,band:createAIWorkBand({viewport,enabled,now:()=>5000,mount})};
}
test('tool description admits fixed labels and numeric counts only',()=>{
 const raw=event('secret-path', 'completed',{tool:'cad_execute',target:{ids_count:3,kind:'C:/private',name:'private',path:'secret'},count:3,error:'token-secret',message:'private'});
 const value=describeToolEvent(raw,5000);
 assert.equal(value.target,'대상 객체 3개');assert.equal(value.detail,'항목 3개 확인');
 assert.doesNotMatch(value.text,/private|secret|C:\//);
 assert.equal(describeToolEvent({...raw,tool:'private-tool'}).label,'CAD 작업 중');
 assert.equal(describeToolEvent({...raw,tool:'cad_get_job'}),null);
 assert.equal(describeToolEvent({...raw,count:true,target:{ids_count:-1}}).target,'현재 도면');
 assert.equal(TOOL_LABELS.cad_sun_study,'일조 계산 중');
});
test('one source feeds subscribers and band; duplicates do not repeat history',()=>{
 const {band,stages}=harness();const chat=[];band.subscribe(e=>chat.push(e.text));
 band.consume([event('a'),event('a')],['a']);
 assert.equal(chat.length,1);assert.equal(stages.length,1);assert.equal(stages[0].pushes[0].elapsedMs,4000);
 band.consume([event('a','running',{stage:'waiting'})],['a']);
 assert.match(chat.at(-1),/CAD 창 확인 대기/);
 band.consume([event('a','completed',{count:3})],[]);
 assert.equal(band.snapshot().active,0);assert.equal(stages[0].finishes.length,1);assert.equal(chat.at(-1),band.snapshot().recent.at(-1));
 band.consume([event('a')],[]);assert.equal(chat.length,3,'late starts cannot reopen completion');
 band.destroy();
});

test('local completion hidden behind a different bridge progress id falls back to toast',()=>{
 const {band,stages}=harness(),toasts=[];
 band.consume([event('backend-progress','running',{tool:'cad_ui_command'})]);
 notifyAIChange({aiWorkBand:band,toast:text=>toasts.push(text)},'cad_undo','request-uuid');
 assert.deepEqual(toasts,['AI가 되돌렸습니다']);assert.equal(band.snapshot().active,1);
 assert.equal(stages[0].phases[0].label,'화면 작업 중');
 band.destroy();
 const idle=harness();
 notifyAIChange({aiWorkBand:idle.band,toast:text=>toasts.push(text)},'cad_redo','redo-request');
 assert.equal(idle.stages[0].phases[0].label,'AI가 다시 실행했습니다');
 assert.equal(toasts.length,1);idle.band.destroy();
});
test('concurrent work keeps one slot, caps recent history and reconciles dropped terminals',()=>{
 const {band,stages}=harness();
 band.consume([event('a'),event('b')],['a','b']);assert.equal(stages.length,1);assert.equal(band.snapshot().active,2);
 band.consume([event('a','completed')],['b']);assert.equal(stages[0].finishes.length,0);
 band.consume([event('b','running',{stage:'dispatch'})],['b']);assert.equal(band.snapshot().recent.length,3);
 band.consume([],[]);assert.equal(band.snapshot().active,0);assert.equal(stages[0].finishes[0].title,'작업 상태 갱신');
 band.consume([event('c')],['c']);assert.equal(stages.length,2);assert.equal(stages[0].destroyed,true);
 band.reset();assert.equal(stages[1].destroyed,true);assert.deepEqual(band.snapshot(),{active:0,recent:[]});band.destroy();
});
test('disabled work creates no stage or history; progress observer failure cannot fail a tool',()=>{
 const {band,stages}=harness(()=>false);band.consume([event('a')]);assert.equal(stages.length,0);assert.equal(band.snapshot().active,0);
 const seen=[];band.subscribe(()=>{throw Error('observer');});band.subscribe(e=>seen.push(e));
 assert.doesNotThrow(()=>band.consume([event('a')],['a']));assert.equal(seen.length,1);assert.equal(stages.length,0);band.destroy();
});

test('recent records stay collapsed until the native button is pressed; updates preserve expansion',()=>{
 const {band,stages}=harness();
 band.consume([event('a')],['a']);
 const el=stages[0].element,history=el.querySelector('.barun-ai-work-band__recent'),toggle=el.querySelector('.barun-ai-work-band__toggle');
 assert.equal(toggle.type,'button');assert.equal(toggle.attributes['aria-controls'],history.id);
 assert.equal(history.hidden,true);assert.equal(toggle.attributes['aria-expanded'],'false');
 assert.equal(el.querySelector('.barun-wait-stage__note').hidden,true);
 assert.equal(el.querySelector('.barun-wait-stage__detail').hidden,true);
 assert.equal(toggle.querySelector('.barun-wait-stage__skip'),undefined,'no nested button');
 toggle.listeners.click();assert.equal(history.hidden,false);assert.equal(toggle.attributes['aria-expanded'],'true');
 band.consume([event('a','running',{stage:'waiting'}),event('b'),event('c')],['a','b','c']);
 assert.equal(history.hidden,false);assert.equal(history.children.length,3);
 assert.equal(el.querySelector('.barun-ai-work-band__state').textContent,'도구 실행');
 toggle.listeners.click();assert.equal(history.hidden,true);assert.match(toggle.attributes['aria-label'],/펼치기/);
 band.destroy();
});
