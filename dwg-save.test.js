// 도면 저장(DWG) 계약: 저장 창에 DWG 가 있고, 셸·엔진 경로가 DWG 를 같은 규칙으로 받는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {saveLargeDocument} from './studio.js';
const require=createRequire(import.meta.url);
const {localSavePathProblem}=require('./desktop-files.cjs');
const read=name=>fs.readFileSync(new URL('./'+name,import.meta.url),'utf8');
const BS='\\';

test('저장 창: DXF 가 기본이고 DWG 는 버전과 한 줄 설명을 갖춘 둘째 선택지다',()=>{
 const app=read('app.js');
 const dialog=app.slice(app.indexOf('saveDialogEl.innerHTML'),app.indexOf('document.body.append(saveDialogEl)'));
 assert.match(dialog,/value="dxf" checked> <b>DXF 도면<\/b>/);
 assert.match(dialog,/value="dwg"> <b>DWG 도면<\/b>/);
 assert.match(dialog,/class="save-dwg-version"/);
 assert.match(dialog,/class="save-dxf-version"/);
 assert.match(dialog,/ · 구버전 호환/);
 assert.deepEqual(JSON.parse(app.match(/DXF_VERSIONS = (\[[^\]]+\])/)[1]),['2018','2013','2010','2007','2004','2000']);
 assert.match(dialog,/<span>오토캐드 기본 형식\. DXF로 만든 뒤 내장 엔진/);
 assert.ok(dialog.indexOf('value="dxf"')<dialog.indexOf('value="dwg"')&&dialog.indexOf('value="dwg"')<dialog.indexOf('value="bcad"'));
 // 화면이 고를 수 있는 버전은 엔진이 받는 버전과 같다.
 const versions=JSON.parse(app.match(/DWG_VERSIONS = (\[[^\]]+\])/)[1]);
 const engine=read('batch_converter.py').match(/DWG_SAVE_VERSIONS=\(([^)]+)\)/)[1].split(',').map(v=>v.trim().replace(/'/g,''));
 assert.deepEqual(versions,engine);
 assert.equal(versions[0],'2018','기본 버전은 2018');
});

test('셸 경로 검사: .dwg 는 dwg 형식으로만 통과한다',()=>{
 // Windows 경로는 Windows 규칙으로(맥에서 시험이 돌아도), 맥 경로는 맥 규칙으로 본다.
 assert.equal(localSavePathProblem(['C:','work','배치도.dwg'].join(BS),'dwg','win32'),'');
 assert.notEqual(localSavePathProblem(['C:','work','배치도.dwg'].join(BS),'dxf','win32'),'');
 assert.notEqual(localSavePathProblem(['C:','work','배치도.dxf'].join(BS),'dwg','win32'),'');
 assert.notEqual(localSavePathProblem(BS+BS+['host','share','x.dwg'].join(BS),'dwg','win32'),'');
 assert.notEqual(localSavePathProblem(['C:','work','con.dwg'].join(BS),'dwg','win32'),'');
 assert.equal(localSavePathProblem('/Users/me/작업/배치도.dwg','dwg','darwin'),'');
 assert.notEqual(localSavePathProblem('/Users/me/작업/배치도.dwg','dxf','darwin'),'');
});

test('셸: 작은 저장은 .dwg 이름을 받고, 대용량 저장 창은 DWG 필터로 dwg 형식을 등록한다',()=>{
 const desktop=read('desktop.cjs');
 assert.match(desktop,/\/\^\.\+\\\.\(dxf\|dwg\|bcad\|pdf\|xlsx\|svg\|lsp\|ifc\|png\|jpg\)\$\/i/);   // png·jpg: 미리 대화 그림 저장(2026-10-30)
 const pick=desktop.slice(desktop.indexOf("ipcMain.handle('cad:pick-save-target'"),desktop.indexOf("ipcMain.handle('cad:open-folder'"));
 assert.match(pick,/\['bcad','dwg'\]\.includes\(payload\?\.format\)\?payload\.format:'dxf'/);
 assert.match(pick,/dwg:'DWG 도면'/);
 assert.match(pick,/saveTargetCall/,'공통 저장 예약으로 등록한다');
 assert.match(desktop,/'X-CAD-Shell':shellSecret/,'공통 경로 등록은 셸 비밀로만 한다');
});

test('대용량 DWG 저장은 셸 저장 창 토큰과 DWG 버전을 엔진에 넘기고, DXF 에는 붙이지 않는다',async()=>{
 const document={version:2,units:'mm',layers:[],blocks:[],entities:[]};
 const calls=[],picks=[];
 const api=async(route,payload)=>{calls.push({route,payload});return {path:'C:'+BS+'out'+BS+'a.dwg',warnings:[]};};
 const desktop={pickSaveTarget:async p=>{picks.push(p);return {saveToken:'tok',path:'C:'+BS+'out'+BS+p.name};}};
 await saveLargeDocument({document,name:'a.dwg',format:'dwg',dwgVersion:'2013',dxfVersion:'2000',api,desktop});
 assert.deepEqual(picks[0],{name:'a.dwg',format:'dwg'});
 assert.equal(calls[0].payload.format,'dwg');assert.equal(calls[0].payload.dwgVersion,'2013');assert.equal(calls[0].payload.saveToken,'tok');
 await saveLargeDocument({document,name:'a.dxf',format:'dxf',api,desktop});
 assert.deepEqual(calls[0].payload,{document,format:'dwg',version:'R2018',dwgVersion:'2013',saveToken:'tok'});
 assert.equal(calls[1].payload.version,'R2018');
 assert.equal(calls[1].payload.format,'dxf');assert.equal('dwgVersion' in calls[1].payload,false);
 await saveLargeDocument({document,name:'a.dxf',format:'dxf',dxfVersion:'2000',api,desktop});
 assert.deepEqual(calls[2].payload,{document,format:'dxf',version:'R2000',saveToken:'tok'});
 await saveLargeDocument({document,name:'a.bcad',format:'bcad',dxfVersion:'2000',api,desktop});
 assert.deepEqual(calls[3].payload,{document,format:'bcad',version:'R2018',saveToken:'tok'});
});

test('탭 전환·복구본이 DWG 형식과 버전을 되살린다',()=>{
 const app=read('app.js');
 assert.match(app,/return \{name:fileName,filePath,saveFormat,dwgVersion,dxfVersion,doc:engine\.doc,/);
 assert.match(app,/saveFormat=SAVE_FORMATS\.includes\(tab\.saveFormat\)\?tab\.saveFormat:'dxf';dwgVersion=DWG_VERSIONS\.includes\(tab\.dwgVersion\)\?tab\.dwgVersion:'2018';/);
});

test('도면 변환 창: DXF → DWG 일 때만 2004·2000 에 한글 불가를 적는다(DWG → DXF 는 그대로)',()=>{
 const js=read('batch-converter.js');
 assert.match(js,/<select class="bc-version"><option value="2018">2018<\/option><option value="2013">2013<\/option><option value="2010">2010<\/option><option value="2004">2004<\/option><option value="2000">2000<\/option><\/select>/);
 assert.match(js,/const toDwg=\$\('\.bc-direction'\)\.value==='dxf-dwg'/);
 assert.match(js,/\(toDwg&&\['2004','2000'\]\.includes\(option\.value\)\?' · 한글 불가':''\)/);
 assert.match(js,/\$\('\.bc-direction'\)\.addEventListener\('change',versionLabels\);versionLabels\(\);/);
});

const newerVersionWarning='원본 보존을 위해 처음 DXF 버전(2018)을 유지했습니다. 고른 버전으로 저장되지 않았습니다.';
const olderVersionNotice='원본 보존을 위해 처음 DXF 버전(2013)을 유지했습니다.';
const specialCharacterWarning='2000·2004 DXF 에는 일부 특수 문자(2자)를 담을 수 없습니다. 2007 이상으로 저장하세요.';
for(const [warnings,versionWarning] of [[[],''],[['선종류를 대체했습니다.'],''],[[olderVersionNotice],''],[['선종류를 대체했습니다.',newerVersionWarning],newerVersionWarning],[[specialCharacterWarning],specialCharacterWarning],[[newerVersionWarning,specialCharacterWarning],newerVersionWarning+' '+specialCharacterWarning]])test('대용량 DXF 저장 알림은 버전 불일치·특수 문자 경고만 보여 준다('+warnings.length+')',async()=>{
 const document={version:2,units:'mm',layers:[],blocks:[],entities:[]},toasts=[];
 const path='C:'+BS+'out'+BS+'a.dxf';
 const api=async()=>({path,warnings});
 const desktop={pickSaveTarget:async()=>({saveToken:'tok',path})};
 await saveLargeDocument({document,name:'a.dxf',format:'dxf',dxfVersion:'2000',api,desktop,toast:(text,bad)=>toasts.push({text,bad})});
 assert.deepEqual(toasts.at(-1),{text:'파일을 저장했습니다: '+path+(versionWarning?' '+versionWarning:''),bad:!!versionWarning});
});

test('대용량 DXF 강등 안내는 일반 알림이다',async()=>{
 const toasts=[],notice='구버전(2000) 저장: MULTILEADER 2개를 기본 객체로 바꿨습니다.';
 await saveLargeDocument({document:{entities:[]},name:'a.dxf',api:async()=>({path:'a.dxf',warnings:[notice]}),desktop:{pickSaveTarget:async()=>({saveToken:'tok',path:'a.dxf'})},toast:(text,bad)=>toasts.push({text,bad})});
 assert.deepEqual(toasts.at(-1),{text:'파일을 저장했습니다: a.dxf '+notice,bad:false});
});
