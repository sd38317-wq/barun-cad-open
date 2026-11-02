import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryStore} from './drawing-tabs.js';
import {createChunkedRecoveryAdapter} from './recovery-chunks.js';

function backend(){
 const values=new Map();let rejectCurrent=false;
 return {values,failNextCurrent(){rejectCurrent=true;},
  async get(key){return structuredClone(values.get(key));},
  async keys(){return [...values.keys()];},
  async put(key,value){if(key==='current'&&rejectCurrent){rejectCurrent=false;throw Error('simulated commit failure');}if(value===undefined)values.delete(key);else values.set(key,structuredClone(value));},
 };
}
const snapshot=n=>({version:1,savedAt:n,activeId:'tab',tabs:[{id:'tab',name:'test-'+n,dirty:true,doc:{version:3,layers:[{id:'0',name:'0'}],entities:Array.from({length:200},(_,i)=>({id:'line-'+i,type:'line',points:[{x:i+n,y:0},{x:i+n+1,y:1}]}))}}]});

test('collection failure does not misreport a durable save, session, or deletion as failed',async()=>{
 const db=backend();let attempts=0;
 const store=createRecoveryStore({...db,cleanup:async()=>{attempts++;throw Error('collection unavailable');}});
 await store.write(snapshot(9));assert.deepEqual(await store.read(),snapshot(9));
 assert.equal(await store.preserveLastSession(snapshot(9)),true);
 await store.clearCurrent();assert.equal(await store.read(),undefined);
 assert.equal((await store.readLastSession()).savedAt,9);assert.equal(attempts,3);
 db.failNextCurrent();await assert.rejects(store.write(snapshot(10)),/simulated commit failure/);
 assert.equal(attempts,3);
});

test('public recovery policy retains three complete sessions after current replacement and cleanup',async()=>{
 const db=backend(),adapter=createChunkedRecoveryAdapter(db,{maxRecordBytes:2048,lock:operation=>operation(),yield:()=>Promise.resolve()});
 let stamp=0;const store=createRecoveryStore(adapter,{now:()=>new Date(1700000000000+stamp++)});
 for(let i=0;i<5;i++){await store.write(snapshot(i));await store.preserveLastSession(await store.read());}
 assert.deepEqual(await store.read(),snapshot(4));
 const sessions=await store.listSessions();assert.equal(sessions.length,3);
 for(let i=0;i<3;i++){const value=await adapter.get(sessions[i]);assert.equal(value.tabs[0].name,'test-'+(4-i));assert.equal(value.tabs[0].doc.entities.length,200);}
 await store.clearCurrent();assert.equal(await store.read(),undefined);
 assert.equal((await store.readLastSession()).tabs[0].name,'test-4');
 assert.equal((await store.listSessions()).length,3);
});

test('failed manifest commit rejects public write while the preceding complete snapshot remains readable',async()=>{
 const db=backend(),adapter=createChunkedRecoveryAdapter(db,{maxRecordBytes:2048,lock:operation=>operation(),yield:()=>Promise.resolve()}),store=createRecoveryStore(adapter);
 await store.write(snapshot(1));db.failNextCurrent();await assert.rejects(store.write(snapshot(2)),/simulated commit failure/);
 assert.deepEqual(await store.read(),snapshot(1));
 await adapter.cleanup();assert.deepEqual(await store.read(),snapshot(1));
 await Promise.all([store.write(snapshot(3)),store.write(snapshot(4))]);
 assert.deepEqual(await store.read(),snapshot(4));
});
