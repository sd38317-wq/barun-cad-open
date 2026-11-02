import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
// 사무실 패드 화면(tablet-input.js)을 가짜 DOM 에서 돌린다. 패드 영역 1000×800, 사진 2000×1600(맞춤 보기 배율 .5).
function element(id,extra={}){return {id,style:{},dataset:{},hidden:false,value:'',textContent:'',innerHTML:'',placeholder:'',attrs:{},children:[],
 classList:{set:new Set(),toggle(n,on){on?this.set.add(n):this.set.delete(n);},add(n){this.set.add(n);},remove(n){this.set.delete(n);}},
 setAttribute(k,v){this.attrs[k]=v;},getBoundingClientRect:()=>({left:0,top:0,width:1000,height:800,bottom:id==='top'?0:800}),setPointerCapture(){},append(c){this.children.push(c);},focus(){this.focused=true;},...extra};}
function setup(){
 const es=new Map();for(const id of ['pad','drawing','ink','top','bottom','status','waiting','login','code','error','ruler','ruler-label','measure','textbox','textbox-input','textbox-close','ruler-toggle','undo','clear','keep','confirm','cancel','voice','full','ask','pending','chips','send'])es.set(id,element(id));
 es.get('bottom').getBoundingClientRect=()=>({top:800,bottom:900});es.get('top').getBoundingClientRect=()=>({top:0,bottom:0});
 const modes=['mark','draw','select','text'].map(m=>element('mode-'+m,{dataset:{mode:m}})),commands=['MOVE','COPY','ERASE','TEXTEDIT'].map(c=>element('cmd-'+c,{dataset:{command:c}})),kinds=['memo','text'].map(a=>element('as-'+a,{dataset:{as:a}}));
 const c={document:{getElementById:id=>es.get(id),querySelectorAll:q=>q==='[data-mode]'?modes:q==='[data-command]'?commands:q.includes('data-as')?kinds:[],createElement:()=>element('tick'),documentElement:{}},
  window:{addEventListener(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},innerWidth:1000,innerHeight:900,setInterval(){},setTimeout(){},clearTimeout(){},Date,Math,Map,Set,JSON,Number,String,Error,AbortSignal:{timeout:()=>null},fetch(){}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('tablet-input.js','utf8'),c);
 vm.runInContext("frameReady=true;token='test';frameId=7;imageWidth=2000;imageHeight=1600;fitView()",c);
 return {es,modes,commands,kinds,pad:es.get('pad'),run:s=>vm.runInContext(s,c),events:()=>JSON.parse(vm.runInContext('JSON.stringify(queue)',c))};
}
const e=(id,x,y,type='touch',extra={})=>({pointerId:id,clientX:x,clientY:y,pointerType:type,preventDefault(){},type:'pointermove',...extra});
const up=(id,x,y,type)=>e(id,x,y,type,{type:'pointerup'});

test('two-finger pinch zooms the pad, then moves the PC view the same way (A25)',()=>{
 const s=setup(),scale=s.run('viewScale');
 s.pad.onpointerdown(e(1,400,400));s.pad.onpointerdown(e(2,600,400));s.pad.onpointermove(e(2,800,400));
 assert.ok(s.run('viewScale')>scale);s.pad.onpointerup(up(2,800,400));s.pad.onpointerup(up(1,400,400));
 const view=s.events().find(x=>x.kind==='view');assert.ok(view&&view.factor>1.2);assert.ok(!s.events().some(x=>x.phase==='up'));
 assert.equal(s.run('syncWaiting'),true);
});
test('finger draws until a pen is used; then palm and fingers only move the view (A22)',()=>{
 let s=setup();s.pad.onpointerdown(e(1,400,400));s.pad.onpointermove(e(1,420,400));s.pad.onpointerup(up(1,440,400));
 assert.deepEqual(s.events().map(x=>x.phase),['down','move','up']);assert.ok(s.events().every(x=>x.mode==='mark'&&x.frame===7));
 s=setup();s.pad.onpointerdown(e(1,400,400,'pen'));s.pad.onpointerup(up(1,400,400,'pen'));const before=s.events().length;
 s.pad.onpointerdown(e(2,500,500));s.pad.onpointermove(e(2,600,550));s.pad.onpointerup(up(2,600,550));
 const after=s.events().slice(before);assert.ok(!after.some(x=>x.kind==='point'));assert.equal(after.filter(x=>x.kind==='view').length,1);
});
test('pen along the ruler edge draws a straight line and says so (A26)',()=>{
 const s=setup();s.es.get('ruler-toggle').onclick();const r=s.run('({x:ruler.x,y:ruler.y})');
 s.pad.onpointerdown(e(1,r.x+40,r.y+10,'pen'));s.pad.onpointermove(e(1,r.x+150,r.y+18,'pen'));s.pad.onpointermove(e(1,r.x+300,r.y-6,'pen'));s.pad.onpointerup(up(1,r.x+320,r.y+4,'pen'));
 const points=s.events().filter(x=>x.kind==='point');assert.equal(points[0].ruler,true);
 assert.ok(points.every(p=>Math.abs(p.y-points[0].y)<1e-9));assert.ok(points.at(-1).x>points[0].x);
});
test('two fingers on the ruler turn it and snap near 90° instead of zooming',()=>{
 const s=setup();s.es.get('ruler-toggle').onclick();const r=s.run('({x:ruler.x,y:ruler.y})'),scale=s.run('viewScale');
 s.pad.onpointerdown(e(1,r.x+100,r.y+30));s.pad.onpointerdown(e(2,r.x+300,r.y+30));s.pad.onpointermove(e(2,r.x+101,r.y+229));
 assert.equal(s.run('ruler.angle'),90);assert.equal(s.run('viewScale'),scale);
 s.pad.onpointerup(up(2,0,0));s.pad.onpointerup(up(1,0,0));assert.ok(!s.events().some(x=>x.kind==='view'));
});
test('text mode: tap opens a box in place and sends memo or drawing text (B8)',()=>{
 const s=setup();s.modes[3].onclick();s.pad.onpointerdown(e(1,500,400,'pen'));s.pad.onpointerup(up(1,500,400,'pen'));
 assert.equal(s.es.get('textbox').hidden,false);assert.ok(s.es.get('textbox-input').focused);
 s.es.get('textbox-input').value='창 키워 주세요';s.es.get('textbox').onsubmit({preventDefault(){}});
 s.kinds[1].onclick();s.pad.onpointerdown(e(1,200,200,'pen'));s.pad.onpointerup(up(1,200,200,'pen'));s.es.get('textbox-input').value='거실';s.es.get('textbox').onsubmit({preventDefault(){}});
 const texts=s.events().filter(x=>x.kind==='text');assert.deepEqual(texts.map(t=>[t.text,t.as]),[['창 키워 주세요','memo'],['거실','text']]);
 assert.equal(texts[0].x,.5);assert.equal(texts[0].frame,7);assert.ok(!s.events().some(x=>x.kind==='point'));
});
test('select mode shows command chips; ask box sends text; pending shows confirm and cancel',()=>{
 const s=setup();s.modes[2].onclick();assert.equal(s.es.get('chips').hidden,false);s.commands[0].onclick();
 s.es.get('ask').value='문 300 아래로';s.es.get('bottom').onsubmit({preventDefault(){}});
 assert.deepEqual(s.events().filter(x=>x.kind==='ask').map(x=>x.text),['MOVE','문 300 아래로']);assert.equal(s.es.get('ask').value,'');
 s.run("updateInfo({pending:'1번 아래 300',drawing:'A-101'})");assert.equal(s.es.get('confirm').hidden,false);assert.equal(s.es.get('pending').textContent,'1번 아래 300');
 s.es.get('confirm').onclick();s.run("updateInfo({})");assert.equal(s.es.get('confirm').hidden,true);assert.ok(s.events().some(x=>x.kind==='confirm'));
});
test('pad keeps its own line after lifting the pen until PC picture catches up (A12)',()=>{
 const s=setup();s.pad.onpointerdown(e(1,400,400,'pen'));s.pad.onpointermove(e(1,500,420,'pen'));s.pad.onpointerup(up(1,600,430,'pen'));
 assert.equal(s.run('localInk.length'),1);assert.ok(s.es.get('ink').innerHTML.includes('polyline'));
});
test('queue never cancels a long stroke on slow Wi-Fi; it thins middle points (A20)',()=>{
 const s=setup();s.pad.onpointerdown(e(1,10,10,'pen'));for(let i=0;i<3500;i++)s.pad.onpointermove(e(1,10+i%900,10+i%700,'pen'));s.pad.onpointerup(up(1,20,20,'pen'));
 const q=s.events();assert.ok(q.length<=3001);assert.equal(q[0].phase,'down');assert.equal(q.at(-1).phase,'up');assert.ok(!q.some(x=>x.phase==='cancel'));
});
