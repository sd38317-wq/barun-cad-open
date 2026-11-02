/** ACAD200 영역 8 — 명령 연결(화면). 큰 로직은 file-care.js(순수 함수)에 있고, 여기는 명령 이름과 화면 일만 잇는다.
    SCRIPT(818) · DWGRECOVER(809) · AUDITREPORT(810) · PACK(824) · XREFPATHMAP(822) · 열린 뒤 자동 감사(810)·복구 보고(809).
    app.js 는 hooks(명령줄 넣기·한가함·복구 열기·마지막 실패 경로·로그)만 넘긴다. */
import {planAudit,auditReportText} from './drawing-cleanup.js';
import {documentWeight} from './import-stream.js';
import {parseScript,runScript,packManifest,packManifestText,shouldAutoAudit,autoAuditNote,recoverySummary,bytesToBase64,AUTO_AUDIT_LIMIT,XREF_PATH_MAP_KEY,readPathMap,writePathMap} from './file-care.js';

export {XREF_PATH_MAP_KEY,readPathMap,writePathMap};
/** 문자에 쓰인 글꼴(원래 글꼴 파일·문자 스타일) 이름. 명령을 부를 때만 한 번 훑는다. */
export function usedFonts(doc){
  const fonts=new Set();
  const visit=(list,depth=0)=>{for(const e of list||[]){if(e?.sourceFont)fonts.add(String(e.sourceFont));if(e?.sourceBigFont)fonts.add(String(e.sourceBigFont));if(Array.isArray(e?.entities)&&depth<6)visit(e.entities,depth+1);}};
  visit(doc?.entities);for(const b of Array.isArray(doc?.blocks)?doc.blocks:[])visit(b?.entities,1);
  return [...fonts].filter(Boolean).sort();
}

export function installFileCareCommands(studio,hooks={}){
  const ctx=studio.context,toast=(message,error=false)=>ctx.toast?.(message,error),log=hooks.log||(message=>toast(message));
  const doc=()=>ctx.engine?.doc;
  const drawingName=()=>String(hooks.drawingName?.()||doc()?.name||'도면').replace(/\.(dxf|dwg|bcad)$/i,'');
  const text64=text=>bytesToBase64(new TextEncoder().encode(text));
  let scriptAbort=null;
  const onEscape=event=>{if(event.key==='Escape')scriptAbort?.abort();};
  Object.assign(studio.handlers,{
    // 818: AutoCAD .scr 를 그대로 — 공백·줄바꿈 하나가 Enter 하나. 실행 중 Esc 또는 SCRIPT 를 다시 부르면 멈춘다.
    SCRIPT(){
      if(scriptAbort){scriptAbort.abort();return;}
      if(!hooks.submitInput||!hooks.waitIdle)throw Error('이 화면에서는 스크립트를 실행할 수 없습니다.');
      studio.pickFiles('.scr,.txt',false,async files=>{
        const file=files[0];if(!file)return;
        const inputs=parseScript(await file.text());if(!inputs.length)throw Error('스크립트에 실행할 입력이 없습니다.');
        scriptAbort=new AbortController();document.addEventListener('keydown',onEscape,true);
        log(`SCRIPT · ${file.name} · 입력 ${inputs.length}개 · Esc 로 중지`);
        try{const result=await runScript(inputs,{submit:hooks.submitInput,waitIdle:hooks.waitIdle,signal:scriptAbort.signal});toast(`SCRIPT 끝 · 입력 ${result.done}개를 실행했습니다.`);}
        finally{scriptAbort=null;document.removeEventListener('keydown',onEscape,true);}
      });
    },
    // 809: 마지막으로 열지 못한 도면(없으면 고른 도면)을 복구 읽기로 연다. 원본은 바꾸지 않는다.
    DWGRECOVER(){
      if(!hooks.openRecovered)throw Error('복구해서 열기는 데스크톱 앱에서만 할 수 있습니다.');
      const failed=hooks.lastFailedOpen?.();
      if(failed?.path){log(`DWGRECOVER · ${failed.name} 을(를) 복구 읽기로 엽니다.`);return hooks.openRecovered(failed);}
      studio.pickFiles('.dwg,.dxf',false,files=>{const file=files[0];if(file)return hooks.openRecovered({name:file.name,file});});
    },
    // 810: 감사 보고서를 <도면>.adt 로 남긴다(고치지는 않는다 — 고치기는 AUDIT).
    async AUDITREPORT(){
      const plan=planAudit(doc()),name=drawingName();
      await studio.output(text64(auditReportText(plan,{name})),name+'.adt','text/plain');
      log(`AUDITREPORT · 문제 ${plan.problems}건 · ${name}.adt`);
    },
    // 824: 보낼 때 같이 챙길 것(외부 참조·그림·글꼴·사용자 리습)과 빠진 것 목록. 묶음(zip) 만들기는 다음 단계.
    async PACK(){
      const name=drawingName();let lispFiles=[];
      try{lispFiles=((await studio.api('lisp',{action:'status'})).files||[]).filter(file=>!file.bundled&&!file.disabled);}catch{}
      const manifest=packManifest(doc(),{fonts:usedFonts(doc()).map(font=>({font})),lispFiles,drawingName:name});
      await studio.output(text64(packManifestText(manifest)),name+'_묶음목록.txt','text/plain');
      log(`PACK · 챙길 파일 ${manifest.files.length}개 · 빠진 것 ${manifest.missing.length}개`);
    },
    // 822: 서버 경로 ↔ 이 PC 경로 대응 표(예 \\192.168.0.10\개발 → N:\, /Volumes/개발). 외부 참조를 못 찾으면 이 표로 다시 찾는다.
    XREFPATHMAP(){
      const table=readPathMap(),rows=Object.entries(table);
      ctx.form('외부참조 경로 대응 · 다른 PC·맥에서 만든 참조 경로를 이 PC 경로로',[
        ctx.field('action','작업','add','text',[['add','대응 추가·바꾸기'],['remove','대응 지우기'],['list','지금 표 보기']]),
        ctx.field('server','도면에 적힌 앞부분 (예: \\\\192.168.0.10\\개발)',rows[0]?.[0]||''),
        ctx.field('local','이 PC 의 앞부분 (예: N:\\ 또는 /Volumes/개발)',rows[0]?.[1]||''),
      ],v=>{
        const next={...readPathMap()};
        if(v.action==='list'){log('경로 대응 · '+(Object.entries(next).map(([a,b])=>`${a} → ${b}`).join(' · ')||'없음'));return;}
        const server=String(v.server||'').trim();if(!server)throw Error('도면에 적힌 앞부분을 입력하세요.');
        if(v.action==='remove')delete next[server];
        else{const local=String(v.local||'').trim();if(!local)throw Error('이 PC 의 앞부분을 입력하세요.');next[server]=local;}
        writePathMap(next);toast(`경로 대응 ${Object.keys(next).length}개 · 외부참조 갱신(XREF) 때 자동으로 씁니다.`);
      });
    },
  });
  return {
    /** 도면을 연 직후 한 번: 복구 열기 보고, 작은 도면은 한가할 때 자동 감사(큰 도면은 건너뛴다 — 멈춤 없음). */
    afterDrawingOpened(report){
      const summary=recoverySummary(report);if(summary)log(summary);
      const current=doc();if(!shouldAutoAudit(documentWeight(current,AUTO_AUDIT_LIMIT+1)))return;
      const run=()=>{if(doc()!==current)return;const note=autoAuditNote(planAudit(current));if(note)log(note);};
      if(typeof requestIdleCallback==='function')requestIdleCallback(run,{timeout:5000});else setTimeout(run,500);
    },
    scriptRunning:()=>!!scriptAbort,
  };
}
