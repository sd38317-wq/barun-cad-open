import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from './three.module.js';
import {installLawOverlay} from './review-3d-law.js';
import {createReview3DOpener} from './live-check.js';

const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const drawing=()=>({layers:[{id:'b',name:'A-BLDG-L1',height:3000}],entities:[{id:'mass',type:'polyline',closed:true,layer:'b',points:rect(2000,2000,4000,4000)}],siteAnalysis:{version:1,units:'mm',areaUnits:'m2',siteArea:100,ruleId:'test',coverageLimit:60,farLimit:200,tolerancePct:3,buildable:[{outer:rect(0,0,10000,10000),holes:[]}],heightLimit:2000}});
function harness(check){
 const elements=[];
 const element=tag=>({tag,children:[],_value:'',get value(){return this._value;},set value(v){this._value=String(v);},checked:false,append(...items){this.children.push(...items);},setAttribute(){}});
 const previous=globalThis.document;
 globalThis.document={createElement:tag=>{const el=element(tag);elements.push(el);return el;},createTextNode:text=>text};
 const scene=new THREE.Scene(),engine={doc:drawing()},controls=element('div'),errors=[];
 let active=false;
 const overlay=installLawOverlay({engine,controls,getScene:()=>scene,isActive:()=>active,toast:e=>errors.push(e),check});
 globalThis.document=previous;
 engine.execute=command=>{engine.doc={...engine.doc,siteAnalysis:command.analysis};overlay.invalidate();};
 return {overlay,scene,engine,errors,setActive:value=>active=value,toggle:elements.find(e=>e.className==='r-law'),height:elements.find(e=>e.className==='r-law-height'),refresh:elements.find(e=>e.tag==='button'),status:elements.find(e=>e.className==='r-law-status')};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('law view is loaded only from an explicit browser action',()=>{
 const source=readFileSync(new URL('./live-check.js',import.meta.url),'utf8');
 assert.match(source,/import\('\.\/review-3d\.js'\)/);
 assert.doesNotMatch(source,/^import .*from ['"]\.\/review-3d/m);
 const review=readFileSync(new URL('./review-3d.js',import.meta.url),'utf8');
 assert.match(review,/lawOverlay\.invalidate\(\)/);
 assert.doesNotMatch(review,/function rebuild\(\)[\s\S]*?lawOverlay\.update/);
});
test('unchecked/closed view does no checking; enabled view shows mass and height limit',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return {active:true};});
 h.overlay.open();h.overlay.invalidate();assert.equal(calls,0);
 h.toggle.checked=true;h.toggle.onchange();await settle();assert.equal(calls,0);
 h.setActive(true);h.overlay.open();await settle();assert.equal(calls,1);
 assert.equal(h.scene.children.length,1);assert.ok(h.scene.children[0].children.length>=2);
 assert.match(h.status.textContent,/위반/);
 h.toggle.checked=false;h.toggle.onchange();assert.equal(h.scene.children.length,0);
});
test('editing invalidates without calculation and discards an in-flight result',async()=>{
 let calls=0,resolve;const h=harness(()=>{calls++;return new Promise(r=>resolve=r);});
 h.setActive(true);h.toggle.checked=true;h.toggle.onchange();assert.equal(calls,1);
 h.overlay.invalidate();resolve({active:true});await settle();
 assert.equal(h.scene.children.length,0);assert.equal(calls,1);assert.match(h.status.textContent,/갱신 필요/);
 h.refresh.onclick();resolve({active:true});await settle();assert.equal(calls,2);
 assert.equal(h.scene.children.length,1);h.overlay.invalidate();
 assert.equal(h.scene.children[0].visible,false);assert.equal(calls,2);
});
test('inactive/stale checker results never render old limits',async()=>{
 const h=harness(async()=>({active:false,stale:true,status:'기준 재확인 필요'}));
 h.setActive(true);h.toggle.checked=true;h.toggle.onchange();await settle();
 assert.equal(h.scene.children.length,0);assert.deepEqual(h.errors,['기준 재확인 필요']);
});
test('height limit survives document copies and can be explicitly removed',async()=>{
 const h=harness(async()=>({active:true}));h.setActive(true);h.overlay.open();
 h.height.value='4500';h.height.onchange();assert.equal(h.engine.doc.siteAnalysis.heightLimit,4500);
 h.engine.doc=structuredClone(h.engine.doc);h.overlay.invalidate();h.overlay.close();h.overlay.open();
 assert.equal(h.height.value,'4500');
 h.height.value='';h.height.onchange();assert.equal(h.engine.doc.siteAnalysis.heightLimit,undefined);
 h.height.value='-1';h.height.onchange();assert.equal(h.engine.doc.siteAnalysis.heightLimit,undefined);assert.equal(h.errors.length,1);
});
test('undo or imported baseline refreshes the visible height input and plane',async()=>{
 const h=harness(async()=>({active:true}));h.setActive(true);h.overlay.open();
 h.height.value='4500';h.height.onchange();h.engine.doc.siteAnalysis.heightLimit=2000;h.overlay.invalidate();
 assert.equal(h.height.value,'2000');h.refresh.onclick();await settle();
 const heightMesh=h.scene.children[0].children.find(o=>o.material.color.getHex()===0xc2a1ed);
 const positions=heightMesh.geometry.getAttribute('position');for(let i=0;i<positions.count;i++)assert.equal(positions.getY(i),2);
});


test('sidebar and law entry points share one lazy installation in either order, including simultaneous opens',async()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 assert.match(app,/installLiveCheck\(\{[^\n]*openReview3D/);
 assert.ok(app.indexOf("document.querySelector('.sidebar-tabs')?.append(review3DButton)")>app.indexOf('liveCheck=installLiveCheck('),'attach the 3D button after the sidebar exists');
 assert.match(app,/review3DButton\.onclick=[\s\S]*?await openReview3D\(\)/);
 const live=readFileSync(new URL('./live-check.js',import.meta.url),'utf8');
 assert.match(live,/view3d\.onclick=[\s\S]*?await openReview3D\(\)/);
 for(const order of [[0,1],[1,0]]){
  let loads=0,installs=0,opens=0;const context={inferLayerWalls(){},editEntity(){}};
  const open=createReview3DOpener(context,async()=>{loads++;return {installReview3D:received=>{assert.equal(received,context);installs++;return {open(){opens++;}};}};});
  assert.equal(loads,0);const entries=[open,open];
  await Promise.all(order.map(index=>entries[index]()));await entries[order[0]]();
  assert.equal(loads,1);assert.equal(installs,1);assert.equal(opens,3);
 }
});

test('failed lazy 3D installation can be retried without caching a rejection',async()=>{
 let calls=0,opens=0;
 const open=createReview3DOpener({},async()=>{if(++calls===1)throw Error('load failed');return {installReview3D:()=>({open(){opens++;}})};});
 await assert.rejects(open(),/load failed/);await open();assert.equal(calls,2);assert.equal(opens,1);
});
