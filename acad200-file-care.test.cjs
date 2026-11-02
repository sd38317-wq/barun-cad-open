// ACAD200 영역 8: .dwl 잠금(802)·저장 전 검사(814)·교체 재시도와 하드 링크 이전 본(813)·최근 문서(825)·충돌 기록(823)
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {dwlPath,readWhoHas,claimDrawing,savePreflight,replaceWithRetry,documentStateActions,crashNote,whoHasMessage}=require('./desktop-files.cjs');

const tempDir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'barun-s8-'));

test('802 도면을 열면 AutoCAD 와 같은 3줄 .dwl 을 쓰고 닫으면 지운다',()=>{
 const dir=tempDir(),file=path.join(dir,'평면.dwg');fs.writeFileSync(file,'AC1032');
 const claim=claimDrawing(file,{user:'kim',host:'PC-A',pid:process.pid,now:new Date(2026,9,14,9,30)});
 assert.equal(claim.claimed,true);assert.equal(claim.readOnly,false);
 const lines=fs.readFileSync(dwlPath(file),'utf8').split(/\r\n/);
 assert.equal(lines[0],'kim');assert.equal(lines[1],'PC-A');assert.ok(lines[2].length>0);assert.equal(lines[3],'BarunCAD pid='+process.pid);
 claim.release();assert.equal(fs.existsSync(dwlPath(file)),false);
});

test('802 남(AutoCAD)이 연 도면은 잠금을 덮지 않고 읽기 전용을 알린다',()=>{
 const dir=tempDir(),file=path.join(dir,'배치.dwg');fs.writeFileSync(file,'AC1032');
 fs.writeFileSync(dwlPath(file),'lee\r\nNAS-PC\r\n2026-10-14 08:00\r\n');
 const claim=claimDrawing(file,{host:'PC-A',pid:process.pid});
 assert.equal(claim.claimed,false);assert.equal(claim.readOnly,true);assert.equal(claim.who.user,'lee');
 assert.match(whoHasMessage(claim.who),/lee\(NAS-PC\) 님이 2026-10-14 08:00부터/);
 claim.release();assert.equal(fs.readFileSync(dwlPath(file),'utf8').startsWith('lee'),true,'남의 잠금은 그대로');
 // 같은 PC 의 AutoCAD 잠금(바른 CAD 표시 없음)도 남의 것으로 본다
 fs.writeFileSync(dwlPath(file),'kim\r\nPC-A\r\n2026-10-14 08:00\r\n');
 assert.equal(claimDrawing(file,{host:'PC-A',pid:process.pid}).readOnly,true);
});

test('802 강제 종료로 남은 우리 잠금(꺼진 pid)은 다시 가져오고, 남이 바꾼 잠금은 지우지 않는다',()=>{
 const dir=tempDir(),file=path.join(dir,'a.dxf');fs.writeFileSync(file,'0\nEOF\n');
 fs.writeFileSync(dwlPath(file),'kim\r\npc-a\r\n어제\r\nBarunCAD pid=99999\r\n');
 const claim=claimDrawing(file,{host:'PC-A',pid:1234,alive:()=>false});
 assert.equal(claim.claimed,true);assert.equal(readWhoHas(file).barunPid,1234);
 fs.writeFileSync(dwlPath(file),'park\r\nPC-B\r\n지금\r\n');
 claim.release();assert.equal(readWhoHas(file).user,'park');
 // 살아 있는 다른 바른 CAD 프로세스(같은 PC)의 잠금은 남의 것
 fs.writeFileSync(dwlPath(file),'kim\r\nPC-A\r\n지금\r\nBarunCAD pid=4321\r\n');
 assert.equal(claimDrawing(file,{host:'PC-A',pid:1234,alive:()=>true}).readOnly,true);
 assert.equal(claimDrawing(file,{host:'PC-A',pid:1234,enabled:false}).claimed,false,'BARUN_CAD_DWL=0 이면 아무것도 안 씀');
});

test('814 저장 전 검사: 읽기 전용·사용 중·남의 잠금을 먼저 알린다',()=>{
 const dir=tempDir(),file=path.join(dir,'b.dwg');
 assert.deepEqual(savePreflight(file),{ok:true},'없는 파일은 새로 만든다');
 fs.writeFileSync(file,'x');assert.deepEqual(savePreflight(file),{ok:true});
 const denied=Object.assign(Error('denied'),{code:'EACCES'}),busy=Object.assign(Error('busy'),{code:'EBUSY'});
 const fake=over=>({existsSync:()=>true,constants:fs.constants,accessSync(){},openSync:()=>1,closeSync(){},readFileSync:()=>{throw Error('none');},...over});
 assert.equal(savePreflight(file,{fs:fake({accessSync(){throw denied;}})}).code,'readonly');
 assert.equal(savePreflight(file,{fs:fake({openSync(){throw busy;}})}).code,'busy');
 fs.writeFileSync(dwlPath(file),'choi\r\nPC-C\r\n10:00\r\n');
 const result=savePreflight(file,{host:'PC-A'});assert.equal(result.ok,false);assert.equal(result.code,'in-use');assert.match(result.reason,/choi/);
 fs.writeFileSync(dwlPath(file),'me\r\nPC-A\r\n10:00\r\nBarunCAD pid='+process.pid+'\r\n');
 assert.equal(savePreflight(file,{host:'PC-A',pid:process.pid}).ok,true,'내 잠금은 막지 않는다');
});

test('813 교체 저장: 이전 본은 복사 없이 하드 링크로 남고 내용은 저장 전 그대로다',async()=>{
 const dir=tempDir(),target=path.join(dir,'c.dxf'),temp=target+'.tmp';
 fs.writeFileSync(target,'old');fs.writeFileSync(temp,'new');
 await replaceWithRetry(temp,target);
 assert.equal(fs.readFileSync(target,'utf8'),'new');assert.equal(fs.readFileSync(target+'.previous','utf8'),'old');
 fs.writeFileSync(temp,'newer');await replaceWithRetry(temp,target,{backup:'.bak'});
 assert.equal(fs.readFileSync(target.replace(/$/,'.bak'),'utf8'),'new');
 const fresh=path.join(dir,'d.dxf');fs.writeFileSync(fresh+'.tmp','first');await replaceWithRetry(fresh+'.tmp',fresh);
 assert.equal(fs.readFileSync(fresh,'utf8'),'first');assert.equal(fs.existsSync(fresh+'.previous'),false);
});

test('813 백신·동기화가 잠깐 잡으면 200·400·800 ms 로 다시 하고, 다른 오류는 바로 알린다',async()=>{
 const waits=[];let fails=2;
 const busy=()=>Object.assign(Error('busy'),{code:'EBUSY'});
 const fsp={rm:async()=>{},link:async()=>{},copyFile:async()=>{},rename:async()=>{if(fails-->0)throw busy();}};
 const done=await replaceWithRetry('t','x',{fs:fsp,sleep:async ms=>waits.push(ms)});
 assert.deepEqual(waits,[200,400]);assert.equal(done.attempts,3);
 fails=10;waits.length=0;
 await assert.rejects(replaceWithRetry('t','x',{fs:fsp,sleep:async ms=>waits.push(ms)}),/busy/);assert.deepEqual(waits,[200,400,800]);
 const full={...fsp,rename:async()=>{throw Object.assign(Error('full'),{code:'ENOSPC'});}};waits.length=0;
 await assert.rejects(replaceWithRetry('t','x',{fs:full,sleep:async ms=>waits.push(ms)}),/full/);assert.deepEqual(waits,[]);
});

test('825 윈도우는 점프 목록 최근 문서, 맥은 대표 파일·수정 점까지',()=>{
 assert.deepEqual(documentStateActions({platform:'win32',path:'C:\\a\\b.dwg',event:'open'}),[['addRecentDocument','C:\\a\\b.dwg']]);
 assert.deepEqual(documentStateActions({platform:'win32',path:'C:\\a\\b.txt'}),[]);
 assert.deepEqual(documentStateActions({platform:'darwin',path:'/Volumes/개발/b.dwg',dirty:true,event:'edit'}),[['setRepresentedFilename','/Volumes/개발/b.dwg'],['setDocumentEdited',true]]);
});

test('823 충돌 기록은 이유·메모리만 남기고 마지막 명령은 10개까지',()=>{
 const note=crashNote({reason:'oom',exitCode:-536870904},{now:new Date('2026-10-14T00:00:00Z'),metrics:[{type:'Tab',pid:7,memory:{workingSetSize:2048000,privateBytes:1024000}}],lastCommands:Array.from({length:15},(_,i)=>'C'+i),version:'7.0.11'});
 assert.equal(note.reason,'oom');assert.equal(note.memory[0].workingSetMB,2000);assert.equal(note.lastCommands.length,10);assert.equal(note.lastCommands[0],'C5');
});
test('검토 B9: 화면이 알린 최근 명령이 충돌 기록에 들어가고, GPU 등 다른 프로세스 종료도 기록한다',()=>{
 const vm=require('node:vm'),source=fs.readFileSync('desktop.cjs','utf8'),handlers={},written=[],logs=[];
 const start=source.indexOf(' // 검토 B9: 화면마다 최근 명령'),end=source.indexOf(' const configureCadContents=');
 const context={WeakMap,JSON,Date,crashNote,ipcMain:{on:(n,fn)=>handlers[n]=fn},app:{on:(n,fn)=>handlers[n]=fn,getPath:()=>'D:/dumps',getAppMetrics:()=>[],getVersion:()=>'7.0.24'},
  fsSync:{mkdirSync(){},writeFileSync:(file,text)=>written.push([file,JSON.parse(text)])},path,logLine:line=>logs.push(line)};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+';globalThis.recent=recentCommands;',context);
 const sender={};for(let i=0;i<12;i++)handlers['cad:command-ran']({sender},'CMD'+i);handlers['cad:command-ran']({sender},'X'.repeat(41));
 assert.deepEqual(Array.from(context.recent.get(sender)),Array.from({length:10},(_,i)=>'CMD'+(i+2)),'최근 10개, 긴 이름은 버림');
 handlers['child-process-gone']({},{type:'GPU',reason:'crashed',exitCode:-1073741819});handlers['child-process-gone']({},{type:'Utility',reason:'clean-exit'});
 assert.equal(written.length,1);assert.match(written[0][0],/note-\d+-GPU\.json$/);assert.equal(written[0][1].process,'GPU');assert.equal(written[0][1].reason,'crashed');
 assert.match(source,/lastCommands:recentCommands\.get\(contents\)\|\|\[\]/,'화면 충돌 기록에 최근 명령을 넘긴다');
});
