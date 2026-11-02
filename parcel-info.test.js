import test from 'node:test';import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';import {parcelDaylightGuide,planSuggestions,parcelInfoTable,updateParcelInfoTable} from './parcel-info.js';
const info={pnu:'2623010100101560007',address:'검토 대지',areaM2:100,zones:[{name:'제1종지구단위계획구역',relation:'포함'}],limits:{bcr:60,far:400},massing:{zoneName:'준주거지역',maxBuildingAreaM2:60,maxFloorAreaM2:400}};
const site=()=>({type:'polyline',closed:true,parcelRole:'site',points:[{x:0,y:0},{x:10000,y:0},{x:10000,y:10000},{x:0,y:10000}],attributes:{pnu:info.pnu,landInfo:info}});
test('import adds independent information table and reference guide in one undo',()=>{
 const e=new DrawingEngine();e.execute({type:'parcel.import',entities:[site()]});
 assert.ok(e.doc.entities.some(e=>e.table?.rows.some(r=>r.some(v=>String(v).includes('지구단위')))));assert.ok(!e.doc.entities.some(e=>e.daylightGuide));
 const count=e.doc.entities.length;e.execute({type:'parcel.info',info});assert.equal(e.doc.entities.length,count);
 e.execute({type:'undo'});e.execute({type:'undo'});assert.equal(e.doc.entities.length,0);
});
test('reference line highlights northern edge, not a legal setback distance',()=>{
 const guides=parcelDaylightGuide([site()],'layer',info);const dashed=guides.filter(e=>e.linetype==='DASHED');
 assert.equal(dashed.length,1);assert.ok(dashed[0].points.every(p=>p.y===10400));assert.ok(guides.some(e=>e.text?.includes('법적 일조 제한선 아님')));
});
test('suggestions follow failed or provisional engine checks',()=>{
 assert.deepEqual(planSuggestions({checks:[{rule:'정북일조',ok:true,provisional:false}]}),[]);
 assert.match(planSuggestions({checks:[{rule:'정북일조',ok:false}]})[0],/북측 이격/);
});
// 2026-10-28 시안 docs/시안-대지도면정리-2026-10-28: 긴 토지정보표는 2단으로 접고 뒤에 가리기, 지적도 오른쪽 바깥에 두고 안내 글은 표 아래.
const tall={...info,zones:Array.from({length:30},(_,i)=>({name:'검토 구역 '+(i+1)+' — 긴 이름으로 줄이 넘어가게 하는 시험용 지역지구',relation:'포함'}))};
const span=es=>{const ys=es.flatMap(e=>e.points?e.points.map(p=>p.y):[e.position.y]);return Math.max(...ys)-Math.min(...ys);};
test('tall site information table folds into two columns behind a wipeout and keeps its cells',()=>{
 const [plain]=parcelInfoTable(info,{minX:0,minY:0,maxX:10000,maxY:10000},'L',{x:50000,y:10000});
 const [table]=parcelInfoTable(tall,{minX:0,minY:0,maxX:10000,maxY:10000},'L',{x:50000,y:10000});
 assert.ok(table.table.folded,'긴 표는 접는다');assert.ok(!plain.table.folded||span(plain.entities)<=20000+1000);
 const lines=table.entities.filter(e=>e.type==='line'),xs=lines.flatMap(e=>e.points.map(p=>p.x)),width=Math.max(...xs)-Math.min(...xs);
 assert.ok(width>2*12000,'두 칸이 나란히');const first=table.entities.find(e=>!e.wipeout);assert.equal(first.points[0].x,50000);assert.equal(first.points[0].y,10000);assert.ok(table.entities[0].wipeout,'가리기가 맨 앞(뒤에 그려짐)');
 const masks=table.entities.filter(e=>e.wipeout);assert.equal(masks.length,2);assert.ok(masks.every(m=>m.solid&&m.frame===0));
 const cells=table.entities.filter(e=>e.type==='text'&&!e.siteHeaderCopy&&e.tableCell);
 assert.equal(new Set(cells.filter(e=>!e.siteWrappedLine).map(e=>e.tableCell.row+':'+e.tableCell.column)).size,table.table.rows.length*3,'칸 글은 그대로 한 번씩');
 assert.equal(table.entities.filter(e=>e.siteHeaderCopy&&e.type==='text').length,3,'오른쪽 칸 머리 줄');
 const again=updateParcelInfoTable(table,tall,{minX:0,minY:0,maxX:10000,maxY:10000},'L');
 assert.deepEqual(again.entities.find(e=>!e.wipeout).points,first.points,'다시 그려도 제자리');assert.equal(again.entities.length,table.entities.length);
});
test('imported site puts the table right of the cadastre, the review note under it and standard layer colours',()=>{
 const e=new DrawingEngine();
 const road={type:'polyline',closed:true,parcelRole:'road',points:[{x:-5000,y:-8000},{x:30000,y:-8000},{x:30000,y:-1000},{x:-5000,y:-1000}]};
 const note={type:'text',parcelRole:'label',text:'검토용 — 연속지적도 기반, 지적측량 성과 아님',position:{x:-5000,y:-20000},height:250,attributes:{reviewNote:true}};
 e.execute({type:'parcel.import',entities:[{...site(),attributes:{pnu:tall.pnu,landInfo:tall}},road,note]});
 const table=e.doc.entities.find(x=>x.siteInfoPnu),tb=(()=>{const ps=table.entities.flatMap(x=>x.points||[x.position]);return {minX:Math.min(...ps.map(p=>p.x)),minY:Math.min(...ps.map(p=>p.y))};})();
 const top=table.entities.find(x=>!x.wipeout);assert.equal(top.points[0].x,30000+8000,'지적도 오른쪽 끝에서 8m');assert.equal(top.points[0].y,10000,'위는 지적도 위');
 const moved=e.doc.entities.find(x=>x.attributes?.reviewNote);assert.ok(moved.position.x<=tb.minX+1&&moved.position.y<tb.minY,'안내 글은 표 아래');
 const layer=name=>e.doc.layers.find(l=>l.name===name);assert.equal(layer('A-SITE-BND').color,'#ffd479');assert.equal(layer('A-SITE-BND').lineweight,0.7);
});
