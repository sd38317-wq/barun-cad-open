import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApartmentPreview,bandColor,BANDS,PREVIEW_LAYER} from './apartment-sheet.js';

const sq=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const plan=(title,extra={})=>({title,status:'가능',fill_pct:95,far_pct:300,far_cap_pct:316,bcr_pct:12,gfa_m2:24000,units:250,buildings_n:2,share84_pct:100,floors_min:20,floors_max:30,
 per_piece:[{zone:'제3종일반주거지역',far_used_pct:300,far_cap_pct:316,fill_pct:95}],unit_mix:[{type:'84A',units:250,pct:100,upf:4,dongs:[101,102]}],
 check_rows:[{rule:'86조① 정북 일조',ok:true,text:'2/2'},{rule:'동지 일조',ok:false,text:'1/2'}],callouts:[{text:'인동 0.8H 부족 · 영86조③2호',position_mm:{x:50000,y:50000}}],
 buildings:[{dong:'101',block:'J-1',floors:20,label:'101동 84×4 · 20F',points_mm:sq(10000,10000,30000,12000),centroid_mm:{x:25000,y:16000},ground:31.2,steep:true},
  {dong:'102',block:'J-1',floors:30,label:'102동 84×4 · 30F',points_mm:sq(10000,50000,30000,12000)}],
 sheets:[{title:'건축개요 · '+title,groups:[['건축개요',['대지면적  8,000 ㎡','지하 연면적  산정 필요']]]}],...extra});
const run={enclose:{site_mm:sq(0,0,100000,80000),parts_mm:[{no:1,zone:'제3종일반주거지역',points:sq(0,0,100000,80000)}],text_h:2000,
  sheets:[{title:'필지 검토서',groups:[['대지',['대지 2필지 8,000㎡']]]},{title:'묶음별 검토',perColumn:true,groups:[['묶음 1 · 제3종일반주거지역',['정북 일조 적용']],['합계',['8,000㎡']]]}]},
 incentive:{sheets:[{title:'계산표',groups:[['묶음 1',['상한 용적률  316 %']]]}]},
 place:{text_h:2000,north_vec:[0,1],contours_mm:[{points:[{x:0,y:40000},{x:100000,y:42000}]}],
  plans:[plan('타워형'),plan('판상형'),plan('혼합형',{status:'불가',blocked_by:'86조③2호 인동간격',buildings:[],unit_mix:[],per_piece:[]})],
  drawings:{blocks:[{code:'J-1',outline_mm:[[0,0],[20000,0],[20000,12000],[0,12000]],rooms:[{label:'거 실',poly:[[0,0],[5000,0],[5000,5000],[0,5000]]}]}],
   unit_types:[{label:'84A',missing:true}]}}};

test('미리보기: 3안 제목·불가 칸·동 배지·높이 띠·검토서·실제 도면', () => {
 const e=buildApartmentPreview(run);
 assert.ok(e.length>50);
 assert.ok(e.every(x=>x.layerName===PREVIEW_LAYER&&x.apartmentZone==='preview'));
 const texts=e.filter(x=>x.type==='text').map(x=>x.text);
 for(const t of ['1안 · 타워형','2안 · 판상형','3안 · 혼합형  [불가]','막힌 규칙: 86조③2호 인동간격','필지 검토서','묶음별 검토 · 묶음 1 · 제3종일반주거지역','묶음별 검토 · 합계','계산표','건축개요 · 타워형','평면 정보 없음','EL.31.2','인동 0.8H 부족 · 영86조③2호'])
  assert.ok(texts.some(x=>x.includes(t)),t);
 assert.ok(texts.some(x=>x.includes('84A · 250세대 · 100% · 층당 4호 · 101·102동')));
 assert.equal(e.filter(x=>x.type==='circle').length,4);                       // 가능한 2안 × 2동
 const fills=e.filter(x=>x.type==='hatch').map(x=>x.color);
 assert.ok(fills.includes(bandColor(20))&&fills.includes(bandColor(30)));
 assert.ok(e.filter(x=>x.type==='text'&&x.text.includes('[NG]')).length===3);  // 동지 일조 NG 줄(3안 모두)
});

test('높이 띠 경계', () => {
 assert.equal(bandColor(15),BANDS[0][2]);assert.equal(bandColor(16),BANDS[1][2]);assert.equal(bandColor(40),BANDS[3][2]);
});
