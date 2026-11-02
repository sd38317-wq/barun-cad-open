const test=require('node:test');
const assert=require('node:assert/strict');
const {assertAIFileWrite,replaceWithRetry}=require('./desktop-files.cjs');
test('AI native file write requires the live epoch and unexpired request',()=>{
 const payload={aiRequestEpoch:4,aiExpiresAt:200},state={epoch:4,cancelled:false};assert.doesNotThrow(()=>assertAIFileWrite(payload,state,100));
 for(const value of [{epoch:5,cancelled:false},{epoch:4,cancelled:true},null])assert.throws(()=>assertAIFileWrite(payload,value,100),/중지/);
 assert.throws(()=>assertAIFileWrite(payload,state,201),/만료/);assert.doesNotThrow(()=>assertAIFileWrite({},null));
});
test('cancel after native dialog or during disk write cannot replace existing file',async()=>{
 let current=false,renames=0;await assert.rejects(replaceWithRetry('tmp','drawing.lsp',{backup:false,assertCurrent:()=>{if(!current)throw Error('cancelled');},fs:{rename:async()=>renames++}}),/cancelled/);assert.equal(renames,0);
});
test('cancel while retrying cannot overwrite and AI backups are never deleted',async()=>{
 let current=true,renames=0,removes=0;
 await assert.rejects(replaceWithRetry('tmp','drawing.lsp',{backup:'.previous.unique',overwriteBackup:false,assertCurrent:()=>{if(!current)throw Error('cancelled');},fs:{rm:async()=>removes++,link:async()=>{},rename:async()=>{renames++;throw Object.assign(Error('busy'),{code:'EBUSY'});}},sleep:async()=>{current=false;}}),/cancelled/);
 assert.equal(renames,1);assert.equal(removes,0);
});
