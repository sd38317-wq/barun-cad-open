// 시작점과 간격만으로 연속치수(훈민캐드 대조 기반 H50 · 훈민 AD/ADE/ADC, AutoCAD QDIM/DIMCONTINUE).
//  DIMSEQ  시작점 → 방향 → 간격 목록(3000,3600*2,…) 으로 연속치수 한 줄과 전체 치수를 한 번에. 위/아래·크게/작게 프리셋.
import {isChecked} from './card-input.js';
import {parseSpacingList} from './grid-tools.js';
import {dimensionPreview} from './dimension-preview.js';

const DIRS = {right: {x: 1, y: 0}, left: {x: -1, y: 0}, up: {x: 0, y: 1}, down: {x: 0, y: -1}};
export const SIZE_FACTORS = Object.freeze({normal: 1, large: 1.25, small: 0.8});

/** 두 점에서 가장 가까운 축 방향. */
export function directionFrom(a, b) {
 const dx = b.x - a.x, dy = b.y - a.y;
 if (Math.hypot(dx, dy) < 1e-9) throw Error('방향 점이 시작점과 같습니다.');
 return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'up' : 'down');
}

/**
 * 연속치수 객체 목록(레이어·스타일 없음).
 * side: 'above'(가로 치수는 위, 세로 치수는 왼쪽) | 'below'(아래 / 오른쪽). offset·rowGap 은 도면 단위.
 */
export function sequenceDimensions({start, direction = 'right', spacings = [], side = 'above', offset = 1000, rowGap = 700, total = true, style = {}}) {
 const u = DIRS[direction];
 if (!u) throw Error('방향은 right/left/up/down 중 하나입니다.');
 if (!spacings.length) throw Error('간격을 하나 이상 입력하세요.');
 if (!(offset >= 0) || !(rowGap >= 0)) throw Error('치수선 거리는 0 이상입니다.');
 const horizontal = u.y === 0, mode = horizontal ? 'horizontal' : 'vertical';
 const sign = horizontal ? (side === 'below' ? -1 : 1) : (side === 'below' ? 1 : -1);   // 세로 치수: above=왼쪽
 const n = horizontal ? {x: 0, y: sign} : {x: sign, y: 0};
 const pts = [start];
 for (const d of spacings) { const last = pts.at(-1); pts.push({x: last.x + u.x * d, y: last.y + u.y * d}); }
 const at = (p, dist) => ({x: p.x + n.x * dist, y: p.y + n.y * dist});
 const dims = [];
 for (let i = 1; i < pts.length; i++) dims.push({type: 'dimension', mode, points: [pts[i - 1], pts[i], at(pts[i - 1], offset)], ...style});
 if (total && pts.length > 2) dims.push({type: 'dimension', mode, points: [pts[0], pts.at(-1), at(pts[0], offset + rowGap)], ...style});
 return {dims, end: pts.at(-1), length: spacings.reduce((a, b) => a + b, 0)};
}

export function installDimSequence(ctx) {
 const defaultScale = () => Number(ctx.getSettings?.()?.denominator) || 100;
 const lastSpacing = () => { try { return ctx.storage?.getItem('barun-dimseq-spacing') || '3000,3600,3600,3000'; } catch { return '3000,3600,3600,3000'; } };
 return {
  DIMSEQ() {
   return ctx.form('연속치수 · 시작점과 간격만으로', [
    {name: 'spacings', label: '간격 목록 예: 3000,3600*2,2700', value: lastSpacing()},
    {name: 'direction', label: '방향', options: [['pick', '두 번째 점을 클릭해 정함'], ['right', '→ 오른쪽'], ['left', '← 왼쪽'], ['up', '↑ 위'], ['down', '↓ 아래']], value: 'pick'},
    {name: 'side', label: '치수선 위치', options: [['above', '위 (세로 치수는 왼쪽)'], ['below', '아래 (세로 치수는 오른쪽)']], value: 'above'},
    {name: 'size', label: '크기', options: [['normal', '보통 (현재 치수 스타일)'], ['large', '크게 ×1.25'], ['small', '작게 ×0.8']], value: 'normal'},
    {name: 'scale', label: '축척 1: (치수선 거리 계산용)', type: 'number', value: defaultScale()},
    {name: 'offsetPaper', label: '측정점에서 치수선까지 (용지 mm)', type: 'number', value: 10},
    {name: 'rowPaper', label: '전체 치수 줄 간격 (용지 mm)', type: 'number', value: 7},
    {name: 'total', label: '전체 치수 한 줄 추가', type: 'checkbox', value: true},
   ], async (v) => {
    const spacings = parseSpacingList(v.spacings), scale = Number(v.scale);
    if (!spacings.length) throw Error('간격을 하나 이상 입력하세요.');
    if (!(scale > 0)) throw Error('축척은 0보다 커야 합니다.');
    try { ctx.storage?.setItem('barun-dimseq-spacing', String(v.spacings)); } catch {}
    const base=ctx.styledDimension?ctx.styledDimension({type:'dimension'}):{},factor=SIZE_FACTORS[v.size]||1,style={};
    for(const key of ['textHeight','arrowSize','textGap'])if(Number.isFinite(base[key]))style[key]=base[key]*factor;
    const make=(start,direction)=>sequenceDimensions({start,direction,spacings,side:v.side,offset:Number(v.offsetPaper)*scale,rowGap:Number(v.rowPaper)*scale,total:isChecked(v.total),style});
    const styled=result=>result.dims.map(d=>ctx.styledDimension?{...ctx.styledDimension(d),...style}:d);
    const start=await ctx.pickPoint({prompt:'DIMSEQ · 시작점을 지정하세요',preview:v.direction==='pick'?null:dimensionPreview(cursor=>styled(make(cursor,v.direction)))});
    if(!start)return;
    let direction=v.direction;
    if(direction==='pick'){
     const toward=await ctx.pickPoint({prompt:'DIMSEQ · 치수를 이어 갈 방향 쪽을 클릭하세요',preview:dimensionPreview(cursor=>styled(make(start,directionFrom(start,cursor))))});
     if(!toward)return;
     direction=directionFrom(start,toward);
    }
    const result=make(start,direction),{length}=result;
    const layer=ctx.ensureLayer('A-DIM');
    ctx.commit({entities:styled(result).map(d=>({...d,layer}))});
    ctx.toast(`연속치수 ${spacings.length}칸 · 전체 ${length.toLocaleString('ko-KR')} mm. Ctrl+Z 로 되돌립니다.`);
   });
  },
 };
}
