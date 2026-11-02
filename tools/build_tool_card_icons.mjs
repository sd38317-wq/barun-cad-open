// 빈 문서에 기본 명령을 실행해 카드용 검은 CAD 그림을 굽는다.
import fs from 'node:fs';
import {DrawingEngine} from '../engine.js';
import {entitiesSvg} from '../card-kit.js';
import {runScripted} from '../command-runner.js';
import {previewInk} from '../cad-asset-preview.js';
const icons={};
for(const [key,entity] of Object.entries({
 WALL:{command:'WALDRAW',inputs:{form:{method:'points'},paths:[[[0,0],[3000,0]]]}},
 DOOR:{command:'D1',inputs:{paths:[[[0,0],[1000,0],[0,200]]]}},
 WINDOW:{command:'W1',inputs:{paths:[[[0,0],[1000,0],[0,200]]]}},
 PLINE:{type:'polyline',points:[{x:0,y:0},{x:0,y:2000},{x:3000,y:2000},{x:3000,y:1000}]},
 STAIR:{command:'STP',inputs:{paths:[[[0,0],[0,1000],[1200,0]]]}},
 ELEVATOR:{command:'ELV',inputs:{paths:[[[0,0],[1000,0]]]}},
})){
 const engine=new DrawingEngine();
 if(entity.command)await runScripted(engine,entity.command,entity.inputs);else engine.execute({type:'add',entity:{...entity,layer:engine.doc.layers[0].id}});
 const flatten=e=>e.entities?e.entities.flatMap(flatten):[e];
 icons[key]=entitiesSvg(engine.doc.entities.flatMap(flatten),{width:64,height:48,pad:5,compact:true,background:'#000000',label:key,colorOf:e=>previewInk(e.color||engine.doc.layers.find(l=>l.id===e.layer)?.color)}).replace('rx="6"/>','stroke="none" rx="6"/>')/* 카드 CSS 의 선 색이 바탕 사각형에 묻지 않게 */;
}
const body=`// tools/build_tool_card_icons.mjs 가 기본 명령으로 만든 그림.
const icons=${JSON.stringify(icons)};
const kinds={WAL:'WALL',WALL:'WALL',D1:'DOOR',DOOR:'DOOR',W1:'WINDOW',WINDOW:'WINDOW',PLINE:'PLINE',STP:'STAIR',STAIR:'STAIR',ELV:'ELEVATOR',ELEVATOR:'ELEVATOR',CORE:'ELEVATOR',MASS:'MASS'};
export function toolCardIconSvg(command){const key=kinds[command.nativeCommand]||kinds[command.commandCode]||kinds[command.alias]||kinds[command.command]||(/3D 매스/.test(command.label||'')?'MASS':null);if(!key)return null;return icons[key]||'<span class="tool-card-pending">그림 준비 중 · 3D 매스</span>';}
`;
fs.writeFileSync(new URL('../tool-card-icons.js',import.meta.url),body);
