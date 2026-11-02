import fs from 'node:fs';
import path from 'node:path';
import {DrawingEngine} from './engine.js';
import {plotPDFJob} from './plot.js';

const [inputPath,outputDirectory]=process.argv.slice(2);
if(!inputPath||!outputDirectory)throw Error('사용법: node verify_real_dwg.mjs <document.json> <output-directory>');
const document=JSON.parse(fs.readFileSync(inputPath,'utf8'));
fs.mkdirSync(outputDirectory,{recursive:true});

const engine=new DrawingEngine();
engine.execute({type:'load',document});
const loaded=JSON.stringify(engine.doc);
const layer=engine.doc.layers.find(item=>!item.locked&&item.visible!==false)?.id;
if(!layer)throw Error('Undo 검증에 사용할 편집 가능한 레이어가 없습니다.');
engine.execute({type:'add',entity:{type:'line',layer,points:[{x:0,y:0},{x:1,y:1}]}});
if(JSON.stringify(engine.doc)===loaded)throw Error('편집 명령이 도면을 변경하지 않았습니다.');
engine.execute({type:'undo'});
if(JSON.stringify(engine.doc)!==loaded)throw Error('Undo 후 원본 도면이 정확히 복원되지 않았습니다.');

fs.writeFileSync(path.join(outputDirectory,'actual-drawing-backup.bcad'),loaded,'utf8');
const plotJob=plotPDFJob(engine.doc,{fit:true,paper:'A3',orientation:'landscape',colorMode:'auto',title:'바른 CAD 5 실제 DWG 검증'});
fs.writeFileSync(path.join(outputDirectory,'plot-job.json'),JSON.stringify(plotJob),'utf8');
process.stdout.write(JSON.stringify({
  entities:engine.doc.entities.length,
  layers:engine.doc.layers.length,
  blocks:engine.doc.blocks?.length||0,
  undo:true,
  backup:true,
  plotEntities:plotJob.entities.length,
}));
