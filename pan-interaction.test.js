import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
function setup(){
 const handlers={},c={performance,safe:Object.assign(fn=>fn(),{lastError:null}),world:p=>p,drag:null,origin:{x:10,y:20},space:false,mode:'SELECT',phase:'idle',busy:false,lastCanvasPointerId:null,lastSelectDown:null,selectDoubleClickEpoch:-1,interaction:{value:0,tag:value=>({...value,interactionEpoch:0}),accepts:value=>value?.interactionEpoch===0},inputState:()=>`${c.mode}.${c.phase}`,traceInput(){},scheduleEngineUiRefresh(){},rememberView(){},render(){},localPoint:e=>({x:e.clientX,y:e.clientY}),canvas:{focus(){},setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){},addEventListener:(name,fn)=>handlers[name]=fn}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function beginPan('),source.indexOf('canvas.addEventListener("pointerleave"')),c);
 const event=(x,y,buttons=4)=>({clientX:x,clientY:y,buttons,button:1,pointerId:1,preventDefault(){}});
 return {c,handlers,event};
}
test('middle drag pans even while document work is busy; release stops movement',()=>{
 const {c,handlers:h,event:e}=setup();c.busy=true;h.pointerdown(e(100,100));h.pointermove(e(150,125));assert.equal(c.origin.x,60);assert.equal(c.origin.y,45);h.pointerup(e(150,125,0));assert.equal(c.drag,null);
});
test('middle button chord starts pan without a second pointerdown and restores selection',()=>{
 const {c,handlers:h,event:e}=setup();const pending={kind:'selection',awaitingCorner:true,interactionEpoch:0};c.drag=pending;
 h.pointermove(e(100,100,5));h.pointermove(e(110,120,5));assert.equal(c.origin.x,20);assert.equal(c.origin.y,40);h.pointerup(e(110,120,1));assert.equal(c.drag,pending);
});
test('missed release and lost capture do not leave pan stuck',()=>{
 const {c,handlers:h,event:e}=setup();h.pointerdown(e(1,1));h.pointermove(e(10,10,0));assert.equal(c.drag,null);assert.equal(c.origin.x,10);
 h.pointerdown(e(1,1));h.lostpointercapture();assert.equal(c.drag,null);
});
