#!/usr/bin/env node
/* ACAD200-817: 화면 없는 바른 CAD(AutoCAD 의 AcCoreConsole 에 해당).
   AutoCAD 는 콘솔을 띄우는 데만 3초가 걸리고 도면을 통째로 연다. 이 도구는 Electron·엔진 서버 없이 노드 하나로
   DrawingEngine 과 건축 요소 명령(command-runner.runScripted)을 돌린다 — 여러 개를 동시에 돌려도 설정 파일을 같이 쓰지 않는다.

   사용: node tools/barun-cad-cli.mjs --in 도면.bcad --script 작업.txt [--out 결과.bcad] [--json]
   스크립트 한 줄:  명령 {입력 JSON}      예) D1 {"points":[[2000,0],[3000,0],[2000,200]]}
                    !{엔진 명령 JSON}      예) !{"type":"add","entity":{"type":"line","points":[{"x":0,"y":0},{"x":100,"y":0}]}}
                    ; 로 시작하면 주석, 빈 줄은 건너뜀
   --in 이 없으면 새 도면에서 시작한다. DXF·DWG 읽기·쓰기는 다음 단계(엔진 서버 연결)다. */
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const load=name=>import(pathToFileURL(path.join(root,name)).href);

export function parseCliScript(text){
  const steps=[];
  String(text??'').replace(/^\uFEFF/,'').split(/\r?\n/).forEach((raw,index)=>{
    const line=raw.trim();if(!line||line.startsWith(';'))return;
    if(line.startsWith('!')){steps.push({line:index+1,engine:JSON.parse(line.slice(1))});return;}
    const match=/^(\S+)(?:\s+(.+))?$/.exec(line);
    steps.push({line:index+1,command:match[1].toUpperCase(),inputs:match[2]?JSON.parse(match[2]):{}});
  });
  return steps;
}

/** 레이어를 안 적은 객체는 도면의 첫 레이어(보통 0)에 둔다 — 스크립트를 쓰는 사람이 레이어 id 를 몰라도 된다. */
function withLayer(command,doc){
  const layer=(doc.layers.find(l=>l.name==='0')||doc.layers[0])?.id;
  const fill=e=>e&&typeof e==='object'&&e.layer==null&&layer!=null?{...e,layer}:e;
  if(command?.type==='add')return {...command,entity:fill(command.entity)};
  if(command?.type==='addMany')return {...command,entities:(command.entities||[]).map(fill)};
  return command;
}

export async function runCli(argv,{log=console.log}={}){
  const arg=name=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:null;};
  const input=arg('--in'),scriptPath=arg('--script'),output=arg('--out'),asJson=argv.includes('--json');
  if(!scriptPath)throw Error('--script 스크립트 파일을 지정하세요.');
  for(const file of [input,output].filter(Boolean))if(!/\.(bcad|json)$/i.test(file))throw Error('지금은 .bcad·.json 도면만 읽고 씁니다 (DXF·DWG 는 다음 단계): '+file);
  const {DrawingEngine,newDrawingDocument}=await load('engine.js');
  const {runScripted}=await load('command-runner.js');
  const engine=new DrawingEngine();
  if(input){const doc=JSON.parse((await readFile(input,'utf8')).replace(/^\uFEFF/,''));engine.validate?.(doc);engine.execute({type:'load',document:doc});}
  else engine.doc=newDrawingDocument();
  const results=[];
  for(const step of parseCliScript(await readFile(scriptPath,'utf8'))){
    try{
      if(step.engine){const before=engine.doc.entities.length;engine.execute(withLayer(step.engine,engine.doc));results.push({line:step.line,command:'!'+step.engine.type,added:Math.max(0,engine.doc.entities.length-before)});}
      else{const r=await runScripted(engine,step.command,step.inputs);results.push({line:step.line,command:r.command,added:r.added.length,removed:r.removed.length,changed:r.changed.length});}
      const last=results.at(-1);if(!asJson)log(`${last.line}줄 ${last.command}: +${last.added}${last.removed!=null?` -${last.removed} ~${last.changed}`:''}`);
    }catch(error){throw Object.assign(Error(`${step.line}줄 ${step.command||'!'+step.engine?.type} 실패: ${error.message}`),{results});}
  }
  if(output)await writeFile(output,JSON.stringify(engine.doc,null,2),'utf8');
  const summary={steps:results.length,entities:engine.doc.entities.length,output:output||null,results};
  if(asJson)log(JSON.stringify(summary));
  return summary;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runCli(process.argv.slice(2)).catch(error=>{console.error('바른 CAD CLI: '+error.message);process.exitCode=1;});
}
