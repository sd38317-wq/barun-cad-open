// 소규모 자동 구조: 서버 부재 목록 → 배근도·부재 일람표. 크기·배근을 계산하거나 부호를 다시 매기지 않는다.
// BLS의 기호·크기·비고/표선, CLI·BLI의 단면·철근 위치를 따른다. 좌표는 mm, 색은 S- 레이어를 따른다.
import {barRow, columnBarPoints} from './structure-cards-4.js';
import {textLineUnits} from './geometry.js';
import {PAPERS, DEFAULT_SHEET_TEMPLATE} from './sheet-layout.js';
import {isPreliminaryStructure, preliminaryMembers, preliminaryPilotiSpacing, PRELIMINARY_PROPOSAL_NOTICE} from './structure-preliminary.js';

const SCALE = 50, TEXT = 2.5, TITLE = 4, LINE = 6, PAD = 2, HEAD = 8, CAPTION = 7, GAP = 6;
const [W, H] = PAPERS.A3, MARGIN = DEFAULT_SHEET_TEMPLATE.margins;
const TOP = H - MARGIN.top - 13, BOTTOM = MARGIN.bottom + 12;
// 표 칸: 예전(도곽 없음)은 종이 여백 안 전체, 도곽에 담을 때(framed, 2026-10-27 구조 장 템플릿)는 표제란을 뺀 그림 칸(26~354 mm).
// shortcut: 표 폭을 모듈 변수로 바꿔 쓴다(호출마다 layout 첫 줄에서 다시 정함) — 동시에 두 폭이 필요해지면 인자로 넘기게 바꾼다.
let X0 = MARGIN.left, WIDTH = W - MARGIN.left - MARGIN.right, HALF = (WIDTH - GAP) / 2;
const useBox = (framed) => {const t = DEFAULT_SHEET_TEMPLATE; X0 = MARGIN.left + (framed ? t.pad : 0); WIDTH = framed ? W - MARGIN.right - t.titleWidth - t.pad - X0 : W - MARGIN.left - MARGIN.right; HALF = (WIDTH - GAP) / 2;};
const kindName = (m) => ({beam: m.type === 'B' ? '작은보' : '큰보', column: '기둥', footing: '독립기초', mat: '온통기초',
  slab: m.deck ? '데크 슬래브' : m.slope ? '경사 슬래브' : '슬래브', wall: '전단벽', stairWall: '계단실 벽', strip: '줄기초',
  flight: '계단', landing: '계단참', brace: '가새', purlin: '중도리', woodWall: m.ext ? '외벽' : '내벽', joists: '바닥장선',
  ceilJoists: '천장장선', rafters: '서까래', ridgeBoard: '마룻대', stripW: '줄기초', groundSlab: '1층 바닥', woodStair: '목재 계단', hardware: '철물'}[m.kind] || m.kind);
const unique = (values) => [...new Set(values.filter((v) => v !== undefined && v !== null && v !== ''))].join('\n') || '-';
const size = (m) => m.sec || (m.kind === 'woodWall' ? `${m.b || 38}×${m.stud}@${m.sp}`
  : ['joists', 'ceilJoists', 'rafters'].includes(m.kind) ? `${m.b || 38}×${m.h}@${m.sp}`
  : m.kind === 'stripW' ? `벽 ${m.stem} / 판 ${m.footW}×${m.footT}`
  : m.kind === 'woodStair' ? `폭 ${Math.round(m.W * 1000)}` : m.t ? `t${m.t}` : m.b && m.h ? `${m.b}×${m.h}` : '-');
function groups(model) {
  if (!model || !Array.isArray(model.members)) throw Error('구조 모델이 없습니다.');
  const out = new Map();
  for (const m of model.members) {
    if (typeof m.code !== 'string' || !m.code) throw Error('부재 부호(code)가 없습니다.');
    if (!out.has(m.code)) out.set(m.code, []);
    out.get(m.code).push(m);
  }
  return [...out.values()];
}
// 물량 시안 quantitiesRC의 슬래브 D10@200 / 계단 D13@150 양방향 상·하부. 모델 값이 있으면 그것을 쓴다.
function slabBar(m, dir) {
  const value = m[dir + 'Bar'] || (typeof m.bars === 'string' ? m.bars : m.bars?.[dir]) || m.bar;
  return value ? String(value) : 'D10@200 상·하 (가정)';
}
function concreteTables(all, rc) {
  const tables = [], add = (kind, title, headers, widths, kinds, cells, section) => {
    const rows = all.filter((g) => kinds.includes(g[0].kind)).map((g) => ({code: g[0].code, group: g, cells: cells(g), section}));
    if (rows.length) tables.push({kind, title, headers, widths, rows});
  };
  if (rc) {
    add('beam', '보 일람표', ['부호 · 크기', '단부', '중앙'], [40, (HALF - 40) / 2, (HALF - 40) / 2], ['beam'],
      ([m]) => [`${m.code}\n${m.b}×${m.h}`, '', ''], 'beam');
    add('column', '기둥 일람표', ['부호 · 층 · 크기', '단면', '주근 · 띠철근'], [35, 35, HALF - 70], ['column'],
      ([m]) => [`${m.code}\n${m.level}층\n${m.b}×${m.h}`, '', `${m.bars || '미제공'}\n띠 D10 단부@150\n중앙@300`], 'column');
  }
  add('foundation', '기초 일람표', ['부호', '평면 크기', '두께', '배근 (양방향)'], [25, 55, 20, HALF - 100], ['footing', 'mat'],
    (g) => [g[0].code, unique(g.map((m) => m.kind === 'footing' ? `${Math.round(m.B * 1000)}×${Math.round(m.B * 1000)}`
      : `${Math.round((m.x1 - m.x0) * 1000)}×${Math.round((m.y1 - m.y0) * 1000)}`)), unique(g.map((m) => m.D)),
      unique(g.map((m) => m.kind === 'mat' ? `상 ${m.top}\n하 ${m.bot}` : m.bars))]);
  if (rc) add('slab', '슬래브 배근표', ['부호', '형식', '두께', '단변 배근', '장변 배근'], [25, 20, 20, (HALF - 65) / 2, (HALF - 65) / 2], ['slab'],
    (g) => [g[0].code, unique(g.map((m) => m.form || '범위 밖')), unique(g.map((m) => m.t)), unique(g.map((m) => slabBar(m, 'short'))), unique(g.map((m) => slabBar(m, 'long')))]);
  add('wall', '벽 배근표', ['부호', '종류', '두께', '수직근 (양면)', '수평근 (양면)'], [25, 35, 20, (HALF - 80) / 2, (HALF - 80) / 2], ['wall', 'stairWall'],
    (g) => [g[0].code, kindName(g[0]), unique(g.map((m) => m.t)), unique(g.map((m) => m.vBar)), unique(g.map((m) => m.hBar))]);
  add('strip', '줄기초 배근표', ['부호', '폭×두께', '배근 (양방향)'], [25, 60, HALF - 85], ['strip'],
    (g) => [g[0].code, unique(g.map((m) => `${m.w}×${m.D}`)), unique(g.map((m) => m.bars))]);
  add('stair', '계단 배근표', ['부호', '종류', '두께', '배근 (양방향 상·하)'], [25, 30, 20, HALF - 75], ['flight', 'landing'],
    (g) => [g[0].code, kindName(g[0]), unique(g.map((m) => m.t)), unique(g.map((m) => m.bars || 'D13@150 (가정)'))]);
  return tables;
}
function tableData(model) {
  const all = groups(model);
  if (model.system === 'wood') return [{kind: 'wood', title: '목조 부재 일람표', wide: true,
    headers: ['부호', '부재', '크기 · 간격', '배근 · 철물 · 비고'], widths: [22, 38, 80, WIDTH - 140], rows: all.map((g) => {
      const m = g[0], note = (q) => q.kind === 'woodWall' ? `스터드 / 덮개 ${q.ext ? '외측' : '한쪽'} 11 · 홀드다운은 철물 행 참조`
        : ['joists', 'ceilJoists'].includes(q.kind) ? `경간 ${q.span} m` : q.kind === 'rafters' ? `수평 경간 ${q.run} m`
        : ['stripW', 'groundSlab'].includes(q.kind) ? q.bar : q.kind === 'hardware'
          ? `홀드다운 ${q.holdDown}개 · 8 kN 이상 · 기초 묻힘 180 이상\n띠쇠 ${q.strap}개 · 앵커 ${q.anchor}개`
        : q.kind === 'woodStair' ? `단 ${q.n} × ${Math.round(q.R * 1000)}/${Math.round(q.T * 1000)} · 옆판 38×235 이상` : '-';
      return {code: m.code, group: g, cells: [m.code, unique(g.map((q) => kindName(q) + (q.level ? ` ${q.level}층` : ''))), unique(g.map(size)), unique(g.map(note))]};
    })}];
  if (model.system === 'steel') {
    const steel = all.filter((g) => ['beam', 'column', 'brace', 'purlin', 'slab'].includes(g[0].kind));
    const base = (g, i) => unique(g.filter((m) => m.base).map((m) => `${m.braced ? '가새' : '일반'} ${m.base[i]}`));
    return [{kind: 'steel', title: '철골 부재 일람표', wide: true,
      headers: ['부호', '부재', '형강 · 규격', '베이스플레이트', '앵커볼트', '비고'], widths: [22, 28, 62, 65, 65, WIDTH - 242],
      rows: steel.map((g) => {const m = g[0]; return {code: m.code, group: g, cells: [m.code, kindName(m), unique(g.map(size)), base(g, 0), base(g, 1),
        m.kind === 'column' ? unique(g.filter((q) => q.base).map((q) => `페데스탈 ${q.base[2]}`))
          : m.kind === 'purlin' ? unique(g.map((q) => `@${Math.round(q.sp * 1000)}`)) : m.kind === 'brace' ? unique(g.map((q) => q.alt))
          : m.deck ? 'ALK12 t1.2 / 두께 150 (가정)\n상 D10@200·D10@300 / 하 D10@200' : '-']};})}, ...concreteTables(all, false)];
  }
  return concreteTables(all, true);
}
// 원문: docs/structure/kds41/KDS_42_20_00_소규모건축_콘크리트구조.txt 4.1.1·4.1.4.
// d_b = 철근 공칭지름. 규정의 조건과 예외를 함께 표시하며 부재별 적용 완료를 뜻하지 않는다.
export const STRUCTURE_NOTES = [
  {kind: 'cover', title: '피복두께 · KDS 42 20 00', rows: [
    ['4.1.1(1)①', '수중에서 치는 콘크리트: 100 mm'],
    ['4.1.1(1)②', '흙에 접하여 친 후 영구히 흙에 묻히는 콘크리트: 80 mm'],
    ['4.1.1(1)③가', '흙·옥외 공기에 직접 노출, D16 초과 D25 이하: 50 mm'],
    ['4.1.1(1)③나', '흙·옥외 공기에 직접 노출, D16 이하: 40 mm'],
    ['4.1.1(1)④가', '흙·옥외 공기에 직접 접하지 않는 슬래브·벽체: 20 mm'],
    ['4.1.1(1)④나', '흙·옥외 공기에 직접 접하지 않는 보·기둥: 40 mm'],
  ]},
  {kind: 'development', title: '정착·이음 · KDS 42 20 00', rows: [
    ['4.1.4.1(1)', '일반 정착: D19 이하 45d_b, D22 50d_b'],
    ['4.1.4.1(1)', '슬래브·벽체·계단 정착: 35d_b'],
    ['4.1.4.1(1)', '보·기초 상부철근 정착: 앞에서 정의한 정착길이 × 1.3'],
    ['4.1.4.1(2)', '겹침이음: (1)에 정의한 정착길이 × 1.3'],
    ['4.1.4.1(3)', 'KS B 0802·KS D 0249 실험방법으로 입증된 기계적 이음 사용 가능. 용접이음 사용 불가'],
    ['4.1.4.1(4)', '기둥 주근 이음: 겹침이음 구간 띠철근 간격 ≤ 기둥 최소치수/2이고 띠철근 정착이 90° 갈고리이면 40d_b 사용 가능'],
  ]},
  {kind: 'hooks', title: '표준갈고리 · KDS 42 20 00', rows: [
    ['4.1.4.2(1)', '90° 갈고리 수평정착 ℓdh: 25d_b 이상, 150 mm 이상. 횡철근·직각방향보로 횡구속된 영역은 20d_b 이상, 150 mm 이상'],
    ['4.1.4.2(1)', '90° 갈고리 부분: 12d_b 이상 (그림 4.1-1)'],
    ['4.1.4.3(1)', '스터럽·띠철근 90°/135° 표준갈고리: 구부림내면 반지름 2d_b 이상, 구부린 끝에서 6d_b 이상 연장'],
  ]},
];
function notesTables() {
  return STRUCTURE_NOTES.map(t => ({...t, headers: ['조항', '적용 대상 · 규정'], widths: [36, HALF - 36],
    rows: t.rows.map(([ref, value], i) => ({code: t.kind + '-' + i, group: [], cells: [ref, value]}))}));
}


const provided = value => value == null ? '' : String(value);
const dimensions = (...values) => values.every(v => typeof v === 'number' && Number.isFinite(v) && v > 0) ? values.join('×') : '';
const reinforcement = value => {
  if (typeof value === 'string') return value;
  if (!value?.bar) return '';
  if (value.count != null) return value.count + '-' + value.bar;
  if (value.spacing != null) return value.bar + '@' + value.spacing + (value.layers != null ? ' (' + value.layers + '면)' : '');
  return '';
};
function preliminaryTables(model) {
  const members = preliminaryMembers(model), tables = [];
  const source = m => m.proposal ? '제안' : (m.kind === 'column' ? [m.b,m.h,m.bar,m.bars] : m.kind === 'wall' ? [m.t,m.vertical,m.horizontal]
    : m.kind === 'beam' ? [m.bw,m.h,m.top,m.bottom,m.stirrup] : [m.B,m.L,m.h,m.reinforcement]).some(v => v != null) ? '사용자 지정' : '';
  const add = (kind, title, headers, widths, cells) => {
    const rows = members.filter(m => m.kind === kind).sort((a,b) => a.level-b.level || a.code.localeCompare(b.code)).map(m => ({code:m.code,group:[m],cells:cells(m),source:source(m)}));
    if (rows.length) tables.push({kind:kind === 'footing' ? 'foundation' : kind,title,headers,widths,rows,wide:true});
  };
  const columnBars = m => {
    if (typeof m.bars === 'string') return m.bars;
    if (Array.isArray(m.bars) && m.bars.length && m.bar) return m.bars.length + '-' + m.bar;
    if (m.bar && m.faces && ['top','bottom','left','right'].every(k => Number.isInteger(m.faces[k]))) return (Object.values(m.faces).reduce((sum,n) => sum+n,0)-4) + '-' + m.bar;
    if (m.bar && Number.isInteger(m.nx) && Number.isInteger(m.ny)) return (2*m.nx+2*m.ny-4) + '-' + m.bar;
    return '';
  };
  const ties = m => {
    const actual = m.tieBar && m.tieSpacing != null ? m.tieBar + '@' + m.tieSpacing : '';
    if (!m.pilotis) return actual;
    const max = preliminaryPilotiSpacing(m);
    return [actual, '필로티 · 9.8.4(6)~(9)', max == null ? '' : '전 길이 간격 ≤ ' + max + ' mm'].filter(Boolean).join('\n');
  };
  add('column','기둥 일람표',['부호','층','출처','b×h','주근','띠철근 · 필로티'],[28,12,30,45,65,WIDTH-180],
    m => [m.code,provided(m.level),source(m),dimensions(m.b,m.h),columnBars(m),ties(m)]);
  add('wall','벽 배근표',['부호','층','출처','두께','수직근','수평근'],[28,12,30,45,130,WIDTH-245],
    m => [m.code,provided(m.level),source(m),provided(m.t),reinforcement(m.vertical),reinforcement(m.horizontal)]);
  add('beam','보 일람표',['부호','층','출처','b×h','상부근','하부근','스터럽'],[28,12,30,45,80,80,WIDTH-275],
    m => [m.code,provided(m.level),source(m),dimensions(m.bw ?? m.b,m.h),reinforcement(m.top),reinforcement(m.bottom),reinforcement(m.stirrup)]);
  add('footing','기초 일람표',['부호','받침 기둥','출처','B×L×h','B 방향 철근','L 방향 철근'],[28,38,30,80,105,WIDTH-281],
    m => [m.code,provided(m.columnId),source(m),dimensions(m.B,m.L,m.h),reinforcement(m.reinforcement?.B),reinforcement(m.reinforcement?.L)]);
  return tables;
}
function preliminaryNotes(model) {
  const rows = [
    ['검토 단계','3~5층 개략 검토 초안 · 시공용 구조도면 아님. 책임구조기술자 확인 필요.'],
    ['근거 기준',model.preliminary?.basis || '저장소 수록판 KDS 41 · 적용 판 확인 필요'],
    ['적용 판','저장소 수록판: KDS 41 10 05:2024 · KDS 41 12 00:2022 · KDS 41 17 00:2022 · KDS 41 20 00:2024. 적용 시 개정 여부 확인.'],
    ['검토 범위',model.preliminary?.coverage || model.preliminary?.notice || '정밀 구조해석·최종 부재·접합·기초 상세 별도 확인.'],
    ['단면 출처','사용자 지정 단면과 엔진 제안을 구분한다. 제안은 미확정이며 책임구조기술자의 확인 전 시공 금지.'],
    ['미제공 값','빈칸은 값 미제공. 위치만 있는 부재는 중심선·위치기호로 표시하며 단면·배근을 가정하지 않는다.'],
    ['필로티','KDS 41 17 00 9.8.4: 전 길이 횡보강·간격·후프·크로스타이·특별지진하중·전이구조·접합부 확인 필요. 일람표 간격은 엔진 결과를 전사.'],
  ];
  return [{kind:'preliminary',title:'3~5층 구조일반주기 · KDS 41',headers:['항목','일반사항'],widths:[36,WIDTH-36],wide:true,
    rows:rows.map(([code,value]) => ({code,group:[],cells:[code,value]}))}];
}
// A3 용지 mm로 행을 배치하고 넘치는 표는 다음 장에 머리글과 함께 이어 쓴다.
function preliminaryLayout(model, origin, sheetKind, page) {
  const members = preliminaryMembers(model), proposal = members.some(m => m.proposal);
  const top = TOP - (proposal ? 8 : 0), pages = [[]]; let cursor = top;
  for (const table of sheetKind === 'notes' ? preliminaryNotes(model) : preliminaryTables(model)) {
    let part;
    for (const row of table.rows) {
      row.lines = row.cells.map((v,i) => wrap(v,table.widths[i]-PAD*2));
      row.height = Math.max(...row.lines.map(lines => lines.length*LINE+PAD*2));
      if (row.height+CAPTION+HEAD > top-BOTTOM) throw Error('부재 행이 A3 한 장에 들어가지 않습니다.');
      const overhead = part ? 0 : CAPTION+HEAD;
      if (cursor-overhead-row.height < BOTTOM) {pages.push([]);cursor=top;part=null;}
      if (!part) {part={...table,rows:[],x:X0,top:cursor,width:WIDTH,height:CAPTION+HEAD};pages.at(-1).push(part);cursor-=CAPTION+HEAD;}
      row.top=cursor;part.rows.push(row);part.height+=row.height;cursor-=row.height;
    }
    cursor-=GAP;
  }
  if (!Number.isInteger(page) || page<0 || page>=pages.length) throw Error('일람표 페이지가 없습니다.');
  const bounds = (x,y,w,h) => ({minX:origin.x+x*SCALE,minY:origin.y+y*SCALE,maxX:origin.x+(x+w)*SCALE,maxY:origin.y+(y+h)*SCALE});
  const tables=pages[page],sheet={sheet:sheetKind,level:null,title:sheetKind==='notes'?'구조일반주기':'배근도 · 부재 일람표',origin:{...origin},paper:'A3',scale:SCALE,
    page:page+1,pageCount:pages.length,proposal,paperSize:{width:W,height:H},bounds:bounds(0,0,W,H),tables:tables.map(t=>({kind:t.kind,title:t.title,
      bounds:bounds(t.x,t.top-t.height,t.width,t.height),rows:t.rows.map(r=>({code:r.code,level:r.group[0]?.level??null,source:r.source??'',cells:[...r.cells],
        members:r.group.map(m=>m.id),bounds:bounds(t.x,r.top-r.height,t.width,r.height)}))}))};
  return {tables,sheet};
}
export function structureSchedulePageCount(model, sheet='schedule', framed=false) {
  return isPreliminaryStructure(model) ? layout(model,{x:0,y:0},sheet,0,framed).sheet.pageCount : 1;
}

function wrap(value, width) {
  const out = [];
  for (const paragraph of String(value ?? '-').split('\n')) {
    let line = '';
    for (const ch of paragraph) {
      if (line && textLineUnits(line + ch) * TEXT > width) {out.push(line); line = '';}
      line += ch;
    }
    out.push(line);
  }
  return out;
}
function layout(model, origin, sheetKind = 'schedule', page = 0, framed = false) {
  useBox(framed);
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) throw Error('origin 은 {x,y} mm 입니다.');
  if (isPreliminaryStructure(model)) return preliminaryLayout(model, origin, sheetKind, page);
  const tables = sheetKind === 'notes' ? notesTables() : tableData(model), lanes = [TOP, TOP];
  for (const table of tables) {
    for (const row of table.rows) {
      row.lines = row.cells.map((t, i) => wrap(t, table.widths[i] - PAD * 2));
      const m = row.group[0], sectionHeight = row.section ? m.h / SCALE + PAD * 2 : 0;
      row.height = Math.max(...row.lines.map((l) => l.length * LINE + PAD * 2), sectionHeight, row.section === 'beam' ? LINE * 3 + PAD * 2 : 0);
      if (row.section && (!(m.b > 0 && m.h > 0) || m.b / SCALE > (row.section === 'beam' ? 20 : 31))) throw Error(`${m.code} 단면이 A3 일람표 칸보다 큽니다.`);
    }
    table.height = CAPTION + HEAD + table.rows.reduce((h, row) => h + row.height, 0);
    const lane = table.wide ? 0 : lanes[0] >= lanes[1] ? 0 : 1;
    table.x = X0 + (table.wide ? 0 : lane * (HALF + GAP));
    table.top = table.wide ? Math.min(...lanes) : lanes[lane];
    table.width = table.widths.reduce((a, b) => a + b, 0);
    if (table.top - table.height < BOTTOM) throw Error('부재 일람표가 A3 한 장에 들어가지 않습니다. 부재 구성을 확인하세요.');
    if (table.wide) lanes.fill(table.top - table.height - GAP); else lanes[lane] = table.top - table.height - GAP;
    let top = table.top - CAPTION - HEAD;
    for (const row of table.rows) {row.top = top; top -= row.height;}
  }
  const bounds = (x, y, w, h) => ({minX: origin.x + x * SCALE, minY: origin.y + y * SCALE, maxX: origin.x + (x + w) * SCALE, maxY: origin.y + (y + h) * SCALE});
  const sheet = {sheet: sheetKind, level: null, title: sheetKind === 'notes' ? '구조일반주기' : '배근도 · 부재 일람표', origin: {...origin}, paper: 'A3', scale: SCALE,
    paperSize: {width: W, height: H}, bounds: bounds(0, 0, W, H), tables: tables.map((t) => ({kind: t.kind, title: t.title,
      bounds: bounds(t.x, t.top - t.height, t.width, t.height), rows: t.rows.map((r) => ({code: r.code, members: r.group.map((m) => m.id),
        bounds: bounds(t.x, r.top - r.height, t.width, r.height)}))}))};
  return {tables, sheet};
}
/** A3(1/50) 한 장의 배치 정보. origin = 용지 왼쪽 아래(mm), bounds·표·행 경계도 도면 mm. */
export function structureScheduleLayout(model, {origin = {x: 0, y: 0}, sheet = 'schedule', page = 0, framed = false} = {}) {return layout(model, origin, sheet, page, framed).sheet;}
export function structureNotesLayout(model, options = {}) {return structureScheduleLayout(model, {...options, sheet: 'notes'});}
export function structureNotesEntities(model, options = {}) {return structureScheduleEntities(model, {...options, sheet: 'notes'});}

/** 도면 객체 배열. 배치는 structureScheduleLayout으로 받는다. 원본 모델은 고치지 않는다. */
export function structureScheduleEntities(model, {origin = {x: 0, y: 0}, setId, sheet: sheetKind = 'schedule', page = 0, framed = false} = {}) {
  if (!setId) throw Error('구조 묶음 id(setId)가 필요합니다.');
  const {tables, sheet} = layout(model, origin, sheetKind, page, framed), out = [], P = (x, y) => ({x: origin.x + x * SCALE, y: origin.y + y * SCALE});
  const tag = (m) => ({structureSet: {id: setId, member: m?.id ?? null}});
  const line = (x0, y0, x1, y1, m) => out.push({type: 'line', layer: 'S-ANNO', points: [P(x0, y0), P(x1, y1)], ...tag(m)});
  const text = (x, y, value, m, {height = TEXT, align = 'left'} = {}) => out.push({type: 'text', layer: 'S-ANNO', position: P(x, y), text: String(value), height: height * SCALE, align, ...tag(m)});
  const rect = (cx, cy, b, h, layer, m) => out.push({type: 'polyline', layer, closed: true,
    points: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => P(cx + sx * b / SCALE / 2, cy + sy * h / SCALE / 2)), ...tag(m)});
  const dot = (cx, cy, x, y, dia, m) => out.push({type: 'circle', layer: 'S-ANNO', center: P(cx + x / SCALE, cy + y / SCALE), radius: dia / 2, ...tag(m)});
  const cell = (lines, x0, x1, top, height, m) => {
    const block = (lines.length - 1) * LINE + TEXT, y = top - (height - block) / 2 - TEXT;
    lines.forEach((t, i) => text(x0 + PAD, y - i * LINE, t, m));
  };
  const beam = (m, part, x0, x1, top, height) => {
    const cx = x0 + 12, cy = top - height / 2, hw = m.b / 2 - 40, hh = m.h / 2 - 40;
    rect(cx, cy, m.b, m.h, 'S-BEAM', m); rect(cx, cy, m.b - 80, m.h - 80, 'S-ANNO', m);
    const bars = m.bars, count = (key) => Number(bars?.[key]?.[part]) || 0;
    // BLI: 상·하 주열/부열을 나누어 등간격으로 놓는다. 지름 D19, 두 줄 간격은 주근 지름의 두 배.
    for (const [key, y] of [['top1', hh], ['top2', hh - 38], ['bot1', -hh], ['bot2', -hh + 38]])
      for (const x of barRow(hw, count(key))) dot(cx, cy, x, y, 19, m);
    const labels = bars ? [`상 ${count('top1') + count('top2')}-D19`, `하 ${count('bot1') + count('bot2')}-D19`, `늑 D10@${bars.st[part]}`] : ['배근 미제공'];
    cell(labels, x0 + 22, x1, top, height, m);
  };
  const column = (m, x0, x1, top, height) => {
    const cx = (x0 + x1) / 2, cy = top - height / 2, spec = /^(\d+)-D(\d+)$/.exec(m.bars || '');
    rect(cx, cy, m.b, m.h, 'S-COLS', m); rect(cx, cy, m.b - 80, m.h - 80, 'S-ANNO', m);
    if (!spec) return;
    const n = Number(spec[1]), dia = Number(spec[2]);
    if (n >= 4 && n % 2 === 0) {
      const nx = Math.ceil((n + 4) / 4), ny = (n + 4) / 2 - nx;
      for (const p of columnBarPoints({width: m.b, depth: m.h, cover: 40, nx, ny})) dot(cx, cy, p.x, p.y, dia, m);
    }
  };
  text(X0, H - MARGIN.top - TITLE - 1, sheet.title, null, {height: TITLE});
  text(X0 + WIDTH, H - MARGIN.top - TITLE, 'A3 · 1/50 · 단위 mm', null, {align: 'right'});
  line(X0, H - MARGIN.top - 8, X0 + WIDTH, H - MARGIN.top - 8);
  if (sheet.proposal) text(X0, H - MARGIN.top - 18, PRELIMINARY_PROPOSAL_NOTICE, null);
  for (const table of tables) {
    text(table.x, table.top - TITLE, table.title, null, {height: TITLE});
    const top = table.top - CAPTION, bottom = table.top - table.height, xs = [table.x];
    for (const w of table.widths) xs.push(xs.at(-1) + w);
    line(xs[0], top, xs.at(-1), top); line(xs[0], top - HEAD, xs.at(-1), top - HEAD);
    // BLS의 수평 표선 + 칸 세로선 옵션. 단부/중앙 칸도 이 선으로 나눈다.
    for (const x of xs) line(x, top, x, bottom);
    table.headers.forEach((h, i) => cell([h], xs[i], xs[i + 1], top, HEAD, null));
    for (const row of table.rows) {
      const m = row.group[0];
      row.lines.forEach((lines, i) => {if (!row.section || i === 0 || row.section === 'column' && i === 2) cell(lines, xs[i], xs[i + 1], row.top, row.height, m);});
      if (row.section === 'beam') {beam(m, 0, xs[1], xs[2], row.top, row.height); beam(m, 1, xs[2], xs[3], row.top, row.height);}
      if (row.section === 'column') column(m, xs[1], xs[2], row.top, row.height);
      line(xs[0], row.top - row.height, xs.at(-1), row.top - row.height, m);
    }
  }
  text(X0, MARGIN.bottom + 2, isPreliminaryStructure(model) ? '개략 검토 초안 · 책임구조기술자 확인 필요 · 빈칸: 미제공 · 단면·배근은 입력 및 엔진 제안 결과 전사.' : sheetKind === 'notes' ? '검토 초안 · d_b: 철근 공칭지름 · KDS 42 20 00 4.1.1·4.1.4 원문 대조. 부재별 상세 확인 필요.' : '가정: 모델에 없는 슬래브·계단 배근은 시안 물량값. 부재 크기·배근은 서버 모델 기준.', null);
  return out;
}
