import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {saveLargeDocument,createEngineApi} from './studio.js';

const source=fs.readFileSync(new URL('./desktop.cjs',import.meta.url),'utf8');
function desktopStage({inPlace=true,failWrite=false,platform=null}={}){
  const handlers={},events=[];let clock=0;const target='D:\\drawings\\plan.dxf';
  const context={Buffer,Uint8Array,ArrayBuffer,performance:{now:()=>clock},path:path.win32,...(platform?{process:{platform}}:{}),
    ipcMain:{handle:(name,fn)=>handlers[name]=fn},trusted:()=>true,window:{},supervisor:{worker:{}},
    aiRequestStates:new Map(),assertAIFileWrite(){},aiSaveIdentity:()=>({}),
    inPlaceTarget:()=>inPlace?target:null,savePreflight:()=>{clock+=3;return {ok:true};},
    approveSavePath(){},holdDrawingLock(){},localSavePathProblem:()=>'',preferredSaveFolder:()=>path.win32.dirname(target),
    dialog:{showSaveDialog:async()=>{clock+=20;return {filePath:target};},showMessageBox:async()=>{clock+=30;return {response:1};}},
    fs:{open:async()=>({writeFile:async()=>{events.push('write');clock+=4;if(failWrite)throw Error('disk full');},sync:async()=>{events.push('sync');clock+=100;},close:async()=>{events.push('close');clock+=1;}}),rm:async()=>{}},
    saveTargetCall:async body=>{
      if(body.action==='cancel')return {};
      if(body.action==='commit'){events.push('commit');clock+=7;return {path:target,bytes:3,backup_method:'link',replace_attempts:1,timings_ms:{reserve:2,temp_write:0,temp_sync:6,backup:1,replace:1}};}
      clock+=5;return {saveToken:'test-token',tempPath:target+'.tmp',path:target,existed:true,timings_ms:{reserve:2}};
    },
  };
  const start=source.indexOf("ipcMain.handle('cad:save-file'");
  const stop=source.indexOf("ipcMain.handle('cad:open-folder'",start);
  assert.ok(start>0&&stop>start);vm.runInNewContext(source.slice(start,stop),context);
  return {handlers,events,context,payload:{name:'plan.dxf',data:'YWJj'},event:{sender:{id:1}}};
}

test('desktop saves keep backend diagnostics and sync only at the server commit',async()=>{
  const s=desktopStage();const result=await s.handlers['cad:save-file'](s.event,s.payload);
  assert.deepEqual(s.events,['write','close','commit']);
  assert.equal(result.backup_method,'link');assert.equal(result.replace_attempts,1);
  assert.equal(result.timings_ms.temp_write,5);assert.equal(result.timings_ms.temp_sync,6);
  assert.equal(result.timings_ms.preflight,3);assert.equal(result.timings_ms.confirm_wait,0);
});

test('partial desktop write closes and cancels without committing the original',async()=>{
  const s=desktopStage({failWrite:true});await assert.rejects(s.handlers['cad:save-file'](s.event,s.payload),/disk full/);
  assert.deepEqual(s.events,['write','close']);
});

test('target registration measures dialog wait separately and keeps reserve timing',async()=>{
  const s=desktopStage({inPlace:false});const result=await s.handlers['cad:pick-save-target'](s.event,{name:'plan.dxf'});
  assert.equal(result.timings_ms.dialog_wait,20);assert.equal(result.timings_ms.confirm_wait,30);
  assert.equal(result.timings_ms.reserve,2);assert.equal(result.timings_ms.save_target,5);
});

test('large save merges shell and export stages into the caller timing result',async()=>{
  const collected={thumbnail:2};const result=await saveLargeDocument({document:{entities:[]},name:'plan.dxf',timings_ms:collected,
    desktop:{pickSaveTarget:async()=>({saveToken:'x',path:'plan.dxf',timings_ms:{confirm_wait:0,reserve:3}})},
    api:async()=>({path:'plan.dxf',timings_ms:{serialize:5,backup:1}})});
  assert.equal(collected.serialize,5);assert.equal(result.timings_ms.thumbnail,2);assert.equal(result.timings_ms.reserve,3);
  assert.ok(result.timings_ms.client_large_save>=0);
});

test('studio output keeps its string return and transfers shell timings and backup diagnostics',async()=>{
  const studio=fs.readFileSync(new URL('./studio.js',import.meta.url),'utf8');
  const start=studio.indexOf('  async function output('),stop=studio.indexOf('  const field=',start);
  const context={performance,outputObservers:{consume:()=>null},LARGE_SAVE_CHARS:50_000_000,console,technicalErrorMessage:String,userErrorMessage:()=>'',toast(){},window:{cadDesktop:{saveFile:async()=>({saved:true,path:'plan.dxf',backup_method:'link',replace_attempts:1,timings_ms:{temp_write:4,temp_sync:7}})}}};
  vm.runInNewContext(studio.slice(start,stop),context);const timings_ms={},saveResult={};
  assert.equal(await context.output('YWJj','plan.dxf','application/dxf','',{timings_ms,saveResult}),'plan.dxf');
  assert.equal(timings_ms.temp_sync,7);assert.equal(saveResult.backup_method,'link');assert.ok(timings_ms.desktop_save>=0);
});

test('export API reports request encoding time while preserving server stages',async()=>{
  const fetch=async route=>route==='/api/status'?{ok:true,json:async()=>({token:'test'})}:{ok:true,status:200,json:async()=>({timings_ms:{serialize:7}})};
  const {api}=createEngineApi({fetch,encode:async()=>({body:'{}',contentType:'application/json'})});
  const result=await api('export',{document:{entities:[]}});assert.equal(result.timings_ms.serialize,7);assert.ok(result.timings_ms.client_serialize>=0);
});

for(const large of [false,true])test('app save keeps stage diagnostics through recovery scheduling ('+large+')',async()=>{
  const app=fs.readFileSync(process.env.BARUN_SAVE_TEST_APP||new URL('./app.js',import.meta.url),'utf8');
  const start=app.indexOf('async function saveDrawingExport('),stop=app.indexOf('function bytesToBase64(',start);
  let clock=0;const infos=[],errors=[];const document={entities:[],layers:[]};
  const context={performance:{now:()=>clock},busy:false,dirty:true,engine:{doc:document},fileName:'plan',filePath:'D:/drawings/plan.dxf',saveDialogEl:null,
    DWG_VERSIONS:['2018'],DXF_VERSIONS:['2018'],dwgVersion:'2018',dxfVersion:'2018',
    documents:{activeId:'a',checkpoint:()=>clock+=3},updatePrompt(){},dwgSaveProblem:()=>'',
    drawingThumbnail:()=>{clock+=2;return new Uint8Array();},bytesToBase64:()=>'',padShare:{drawingSaved(){}},
    $:()=>({textContent:''}),renderDrawingTabs:()=>clock++,scheduleDrawingRecovery:()=>clock+=4,
    toast:(text,bad)=>{if(bad)errors.push(text);},console:{info(){},debug:(...args)=>infos.push(args)},
    request:async()=>{clock+=11;return {data:'',warnings:[],timings_ms:{serialize:5}};},
    studio:{getFolder:()=>'',isLargeDocument:()=>large,
      output:async(data,name,type,target,options={})=>{clock+=13;if(options.timings_ms)Object.assign(options.timings_ms,{temp_sync:7});if(options.saveResult)Object.assign(options.saveResult,{backup_method:'link',replace_attempts:1});return target;},
      saveLargeDocument:async(doc,name,format,options={})=>{clock+=24;return {path:'D:/drawings/plan.dxf',warnings:[],timings_ms:{serialize:5,temp_sync:7},backup_method:'link',replace_attempts:1};}},
  };
  vm.runInNewContext(app.slice(start,stop),context);assert.equal(await context.saveDrawingExport(),true,errors.join(';'));
  const report=infos.find(([tag])=>tag==='[Barun CAD save performance]')?.[1];assert.ok(report);
  assert.equal(report.backup_method,'link');assert.equal(report.timings_ms.serialize,5);
  assert.equal(report.timings_ms.temp_sync,7);assert.equal(report.timings_ms.thumbnail,2);
  assert.equal(report.timings_ms.recovery_schedule,8);assert.equal(report.timings_ms.recovery_cleanup,0);assert.ok(report.timings_ms.client_save_total>=0);
  assert.equal(JSON.stringify(report).includes('D:/drawings'),false);
});

test('A22: on mac/windows a person-picked existing file is confirmed once by the OS save panel; AI saves and Linux still get the app question',async()=>{
  for(const [platform,payload,asked] of [['darwin',{name:'plan.dxf'},false],['win32',{name:'plan.dxf'},false],['linux',{name:'plan.dxf'},true],['darwin',{name:'plan.dxf',aiRequestId:'ai-1',aiRequestEpoch:1},true]]){
    const s=desktopStage({inPlace:false,platform});
    let questions=0;const box=s.context.dialog.showMessageBox;s.context.dialog.showMessageBox=async(...a)=>{questions++;return box(...a);};
    const result=await s.handlers['cad:pick-save-target'](s.event,payload);
    assert.equal(questions,asked?1:0,platform+' '+JSON.stringify(payload));assert.equal(result.saveToken,'test-token');
  }
});
