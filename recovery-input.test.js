import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
function setup(store){
 let now=2000,writes=0;const timers=[],listeners={};
 const context={documents:{},hasOversizedRecoveryDocument:()=>false,recoveryStore:store,recoveryBlocked:false,performance:{now:()=>now},document:{addEventListener:(name,fn)=>listeners[name]=fn},engine:{doc:{entities:[]}},setTimeout:fn=>(timers.push(fn),timers.length),clearTimeout(){},localStorage:{setItem(){writes++;}},stampRecovery(){},sceneRevision:1,toast(){}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('let localRecoveryTimer='),source.indexOf('let engineRefreshFrame=')),context);
 return {context,timers,listeners,writes:()=>writes,advance:n=>now+=n};
}
test('healthy workspace recovery avoids duplicate synchronous localStorage serialization',()=>{
 const s=setup({});s.context.scheduleLocalRecovery();assert.equal(s.timers.length,0);assert.equal(s.writes(),0);
 s.context.recoveryBlocked=true;s.context.scheduleLocalRecovery();assert.equal(s.timers.length,1);s.timers.shift()();assert.equal(s.writes(),1);
});
test('legacy recovery waits for input to settle, explicit flush still persists immediately',()=>{
 const s=setup(null);s.context.scheduleLocalRecovery();s.listeners.pointermove();s.timers.shift()();assert.equal(s.writes(),0);assert.equal(s.timers.length,1);
 s.advance(1100);s.timers.shift()();assert.equal(s.writes(),1);
 s.listeners.pointermove();s.context.flushLocalRecovery();assert.equal(s.writes(),2);
});
test('small active tab retains legacy recovery when another large tab disables workspace recovery',()=>{
 const s=setup({});s.context.hasOversizedRecoveryDocument=()=>true;s.context.scheduleLocalRecovery();assert.equal(s.timers.length,1);s.timers.shift()();assert.equal(s.writes(),1);
});
