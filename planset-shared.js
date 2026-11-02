// PLANSET 화면이 쓰는 기본값·박스 고르기·요약·상세 목록. 계산(평면 읽기)은 서버 compute/plan-to-model.js 에 있다.
import * as G from './geometry.js';

export const PLANSET_DEFAULTS=Object.freeze({floorHeight:3000,windowHeight:1500,sill:900,doorHeight:2100,slab:200,structure:'rc',insulation:'exterior',region:'중부2',align:'walls',roofBox:'auto',foundation:Object.freeze({mat:600,lean:60,gravel:200,overhang:300})});
/** 닫힌 PL·사각형만 층 박스가 된다. */
export function isPlanBox(e){return !!e&&((e.type==='rectangle'&&e.points?.length>=2)||(e.type==='polyline'&&e.closed&&e.points?.length>=4));}
/** 박스를 왼쪽부터(같으면 위부터) 놓인 순서로 — 사람이 평면을 1층부터 옆으로 그려 나가는 흔한 배치. */
export function orderBoxes(boxes){return [...boxes].sort((a,b)=>{const A=G.bounds([a]),B=G.bounds([b]);return Math.abs(A.minX-B.minX)>1000?A.minX-B.minX:B.maxY-A.maxY;});}
export const TRACE_LAYERS=Object.freeze({conc:'A-WALL-CONC',masonry:'A-WALL-MASN',light:'A-WALL-PRTN',window:'A-GLAZ',door:'A-DOOR'});
/** 결과 한 줄 요약(명령 창·알림). */
export function plansetSummary({floors,unresolved,assumed}){
 const sum=k=>floors.reduce((s,f)=>s+(Array.isArray(f[k])?f[k].length:f[k]),0);
 return `${floors.map(f=>f.name).join('·')} · 벽 ${sum('walls')} · 창 ${sum('windows')} · 문 ${sum('doors')} · 계단 ${sum('stairs')} · 실 ${sum('rooms')}`+
  (unresolved.length?` · 확인 필요 ${unresolved.length}`:'')+(assumed.length?` · 기본값 ${assumed.length}가지`:'');
}

// 도면에서 읽은 사실 → 넣을 상세(핵심). 생성기는 이 목록 중 규칙상 맞는 것만 그린다(autoSelect only).
// 'all' = 규칙이 고른 전부(확대 상세 포함), 'none' = 상세 없음.
const has=(m,f)=>m.elements.some(f);
export const PLANSET_DETAILS=Object.freeze([
 {what:'외벽 외단열 단면',ids:['WALL-001'],when:m=>has(m,e=>e.kind==='wall'&&e.exterior&&e.insulationPosition!=='internal')},
 {what:'외벽 내단열 단면',ids:['WALL-002'],when:m=>has(m,e=>e.kind==='wall'&&e.exterior&&e.insulationPosition==='internal')},
 {what:'벽 하부',ids:['BASIC-04'],when:m=>has(m,e=>e.kind==='wall'&&e.exterior)},
 {what:'창대·인방(창호 일람표는 도면 세트가 직접)',ids:['BASIC-01','BASIC-02'],when:m=>has(m,e=>e.kind==='window')},
 {what:'평지붕·난간벽·드레인',ids:['ROOF-001','BASIC-03','ROOF-085'],when:m=>has(m,e=>e.kind==='slab'&&e.role==='roof')},
 {what:'온돌 바닥',ids:['FLOOR-072'],when:m=>has(m,e=>e.kind==='space'&&/거실|침실|안방|방$|룸/.test(e.use||''))},
 {what:'욕실 바닥 방수',ids:['FLOOR-030'],when:m=>has(m,e=>e.kind==='slab'&&['욕실','화장실'].includes(e.use))},
 {what:'발코니 바닥',ids:['FLOOR-040'],when:m=>has(m,e=>e.kind==='slab'&&e.use==='발코니')},
 {what:'계단',ids:['STAIR-02'],when:m=>has(m,e=>e.kind==='stair')},
]);
export function plansetDetailIds(model,mode='core'){
 if(mode==='all')return null;
 if(mode==='none')return [];
 return PLANSET_DETAILS.filter(d=>d.when(model)).flatMap(d=>d.ids);
}
