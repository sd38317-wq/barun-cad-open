// 검토자(Opus) 2차 재검토 · N1 셸 경로 검사 / N2 양보 빌더 / 1 대용량 저장 흐름 / 2 엔진 복구본 우선
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {documentRequestBody,buildDocumentRequestBody} from './import-stream.js';
import {saveLargeDocument,isLargeDocument} from './studio.js';
import {DrawingTabs,recoveryOffer} from './drawing-tabs.js';
const require=createRequire(import.meta.url);
const {localSavePathProblem}=require('./desktop-files.cjs');
const BS='\\';

test('N1: shell-side save path filter mirrors the engine rules',()=>{
 assert.equal(localSavePathProblem(['C:','work','plan.dxf'].join(BS),'dxf','win32'),'');
 assert.equal(localSavePathProblem('D:/work/plan.bcad','bcad','win32'),'');
 const bad=[[BS+BS+['host','share','x.dxf'].join(BS),'dxf'],['relative.dxf','dxf'],[['C:','work','..','escaped.dxf'].join(BS),'dxf'],[['C:','work','a.dxf:stream'].join(BS),'dxf'],[['C:','work','con.dxf'].join(BS),'dxf'],[['C:','work','LPT1.tmp.bcad'].join(BS),'bcad'],[['C:','work','x.exe'].join(BS),'dxf'],[['C:','work','x.bcad'].join(BS),'dxf'],[['C:','work','bad<name>.dxf'].join(BS),'dxf'],['','dxf']];
 for(const [target,format] of bad)assert.notEqual(localSavePathProblem(target,format,'win32'),'',target);
});
test('N1 macOS: absolute POSIX paths are accepted; file names still follow the Windows name rules',()=>{
 assert.equal(localSavePathProblem('/Users/me/도면/plan.dxf','dxf','darwin'),'');
 assert.equal(localSavePathProblem('/Volumes/작업 폴더/a:b 폴더/plan.bcad','bcad','darwin'),'');   // 폴더 이름의 : · 공백은 macOS 에서 정상
 const bad=[['C:'+BS+'work'+BS+'plan.dxf','dxf'],['relative.dxf','dxf'],['//host/share/x.dxf','dxf'],['/Users/me/../x.dxf','dxf'],['/Users/me/./x.dxf','dxf'],['/Users/me/con.dxf','dxf'],['/Users/me/LPT1.tmp.bcad','bcad'],['/Users/me/a.dxf:stream','dxf'],['/Users/me/bad?.dxf','dxf'],['/Users/me/a'+BS+'b.dxf','dxf'],['/Users/me/x.bcad','dxf'],['/Users/me/x.exe','dxf'],['/Users/me/x.dxf'+String.fromCharCode(0),'dxf']];
 for(const [target,format] of bad)assert.notEqual(localSavePathProblem(target,format,'darwin'),'',target);
});
test('N2: the yielding builder produces the same bytes as the sync builder and yields per page',async()=>{
 const document={version:2,units:'mm',layers:[],blocks:[],entities:Array.from({length:9000},(_,i)=>({id:'e'+i,type:'line',points:[{x:i,y:0},{x:1,y:1}]})),dxfPreservation:{format:'x',data:'Q'.repeat(10)}};
 const sync=documentRequestBody({document,version:'R2018'},{limit:100});
 let yields=0;const built=await buildDocumentRequestBody({document,version:'R2018'},{limit:100,yieldFn:async()=>{yields++;}});
 assert.equal(built.streamed,true);assert.ok(yields>=5,'yields='+yields);assert.equal(built.yields,yields);
 assert.deepEqual(Buffer.from(await built.body.arrayBuffer()),Buffer.from(await sync.body.arrayBuffer()));
 const small=await buildDocumentRequestBody({document:{entities:[{id:'a'}]}});assert.equal(small.streamed,false);assert.equal(typeof small.body,'string');
});
test('1: large save asks the shell for a one-time target and never builds a base64 string; browser mode is refused in Korean',async()=>{
 const document={version:2,units:'mm',layers:[],blocks:[],entities:Array.from({length:50001},(_,i)=>({id:i}))};
 assert.equal(isLargeDocument(document),true);assert.equal(isLargeDocument({entities:[{id:1}]}),false);
 const calls=[];const api=async(route,payload)=>{calls.push({route,payload});return {path:'C:'+BS+'out'+BS+'plan.dxf',bytes:5,warnings:['w']};};
 const result=await saveLargeDocument({document,name:'plan.dxf',format:'dxf',api,desktop:{pickSaveTarget:async p=>({saveToken:'tok',path:'C:'+BS+'out'+BS+p.name})}});
 assert.equal(result.path,'C:'+BS+'out'+BS+'plan.dxf');assert.equal(calls[0].route,'export');assert.equal(calls[0].payload.saveToken,'tok');assert.equal(calls[0].payload.format,'dxf');assert.equal(calls[0].payload.document,document);
 await assert.rejects(saveLargeDocument({document,name:'plan.dxf',api,desktop:{pickSaveTarget:async()=>({canceled:true})}}),/취소/);
 await assert.rejects(saveLargeDocument({document,name:'plan.dxf',api,desktop:{pickSaveTarget:async()=>({error:'네트워크(UNC) 경로에는 저장할 수 없습니다.'})}}),/UNC/);
 await assert.rejects(saveLargeDocument({document,name:'plan.dxf',api,desktop:undefined}),/데스크톱 앱에서만/);
 assert.equal(calls.length,1);   // 취소·오류에서는 엔진을 부르지 않는다
});
test('2: a newer dirty engine (large) recovery wins over an older workspace copy; snapshots carry savedAt',()=>{
 const tabs=new DrawingTabs({capture:()=>({name:'a',doc:{entities:[]},undoStack:[],redoStack:[],dirty:false}),apply(){}});tabs.tabs=[{id:'x',name:'a',doc:{entities:[]},dirty:false}];tabs.activeId='x';
 const snap=tabs.snapshot();assert.ok(Number.isFinite(snap.savedAt)&&snap.savedAt>0);
 const saved={version:1,savedAt:1000,tabs:[{name:'평면',dirty:true,doc:{entities:[{id:'a'}]}}]};
 assert.equal(recoveryOffer({saved,startFresh:true,closedCleanly:false,engine:{kind:'large',dirty:true,savedAt:2000}}).source,'engine');
 assert.equal(recoveryOffer({saved,startFresh:true,closedCleanly:false,engine:{kind:'large',dirty:true,savedAt:500}}).source,'workspace');
 assert.equal(recoveryOffer({saved,startFresh:true,closedCleanly:false,engine:{kind:'large',dirty:false,savedAt:9000}}).source,'workspace');
 const only=recoveryOffer({saved:null,startFresh:true,closedCleanly:false,engine:{kind:'large',dirty:true,savedAt:9000}});assert.equal(only.action,'offer');assert.equal(only.source,'engine');
 assert.equal(recoveryOffer({saved:null,startFresh:true,closedCleanly:true,engine:{kind:'large',dirty:true,savedAt:9000}}).action,'keep');
 assert.equal(recoveryOffer({saved,startFresh:false,closedCleanly:false,engine:{kind:'large',dirty:true,savedAt:9000}}).action,'restore');   // 새로고침은 그대로
});
