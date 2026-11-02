// 문자 글꼴(훈민캐드 대조 기반 2: H47). 도면 문자는 불러올 때 원래 글꼴(sourceFont: romans.shx · whgtxt.shx · malgun.ttf …)을 기억한다.
// 화면·출력 미리보기는 그 글꼴을 Windows 글꼴로 대응시켜 그리고, 없으면 같이 싣는 나눔고딕(한글 보장)으로 그린다.
// DXF 로 저장할 때는 문자 스타일 이름과 글꼴을 그대로 돌려 쓴다(exchange.py).
export const BASE_FONT_FAMILY = '"Barun Drawing Korean", "NanumGothic", sans-serif';

const TTF = {
 malgun: '"Malgun Gothic"', malgunbd: '"Malgun Gothic"', gulim: 'Gulim', gulimche: 'GulimChe', batang: 'Batang', batangche: 'BatangChe',
 dotum: 'Dotum', dotumche: 'DotumChe', gungsuh: 'Gungsuh', arial: 'Arial', arialn: '"Arial Narrow"', times: '"Times New Roman"',
 tahoma: 'Tahoma', verdana: 'Verdana', calibri: 'Calibri', consola: 'Consolas', nanumgothic: 'NanumGothic', nanummyeongjo: '"NanumMyeongjo"',
 h2gtrm: '"HYGothic-Medium", "Malgun Gothic"', h2mjsm: '"HYMyeongJo-Medium", Batang', hmkmrhd: '"Malgun Gothic"',
};
// SHX 는 선으로 그린 글꼴이라 가장 비슷한 윤곽 글꼴로 대신한다.
const SHX_GOTHIC = /^(wh?g(d)?txt|hgtxt|hgdtxt|whtgtxt|kttxt|ktgtxt|gothic)/;
const SHX_MYUNGJO = /^(wh?(t|s)mtxt|hmtxt|myungjo|whsmtxt)/;
const SHX_LATIN = /^(romans|romand|romant|romanc|simplex|txt|isocp|isoct|iso|monotxt|complex|italic|scripts|greeks|gothice|gdt|amgdt)/;

/** 글꼴 파일 이름 → CSS font-family. 모르는 이름이면 기본 글꼴. */
export function fontFamilyForFile(font = '', bigFont = '') {
 const name = String(font || '').trim().toLowerCase().replace(/\.(ttf|ttc|otf|shx)$/, '');
 const big = String(bigFont || '').trim().toLowerCase().replace(/\.shx$/, '');
 let family = TTF[name] || null;
 if (!family && SHX_MYUNGJO.test(name)) family = 'Batang';
 if (!family && SHX_GOTHIC.test(name)) family = '"Malgun Gothic", Gulim';
 if (!family && SHX_LATIN.test(name)) family = SHX_MYUNGJO.test(big) ? '"Arial Narrow", Batang' : '"Arial Narrow", Arial, "Malgun Gothic"';
 // 모르는 글꼴 이름은 따옴표·역슬래시·세미콜론·제어 문자를 빼고 쓴다(CSS·SVG 속성이 깨지지 않게).
 if (!family && name) { const clean = String(font).replace(/\.(ttf|ttc|otf|shx)$/i, '').replace(/["'\\;{}<>]|[\u0000-\u001f\u007f]/g, '').trim(); if (clean) family = `"${clean}"`; }
 return family ? `${family}, ${BASE_FONT_FAMILY}` : BASE_FONT_FAMILY;
}

/** 문자 객체의 글꼴. */
// 사용자 대체표(506)가 있으면 그 글꼴을 먼저 쓴다. 표가 비면 Map 조회도 하지 않는다(그리기 경로 비용 0).
export const fontFamilyFor = (e) => fontFamilyForFile(userFontMap.size ? (mappedFontFile(e?.sourceFont) || e?.sourceFont) : e?.sourceFont, e?.sourceBigFont);

/** STYLE 명령에서 고를 글꼴. [파일 이름, 설명]. */
export const FONT_CHOICES = Object.freeze([
 ['malgun.ttf', '맑은 고딕'], ['gulim.ttc', '굴림'], ['batang.ttc', '바탕'], ['dotum.ttc', '돋움'], ['gungsuh.ttc', '궁서'],
 ['H2GTRM.TTF', 'HY중고딕'], ['NanumGothic.ttf', '나눔고딕'], ['arial.ttf', 'Arial'], ['ARIALN.TTF', 'Arial Narrow'], ['times.ttf', 'Times New Roman'],
 ['romans.shx', 'romans.shx (선 글꼴)'], ['simplex.shx', 'simplex.shx (선 글꼴)'], ['whgtxt.shx', 'romans.shx + whgtxt.shx (한글 고딕 선 글꼴)'], ['whtmtxt.shx', 'romans.shx + whtmtxt.shx (한글 명조 선 글꼴)'],
]);

/* ── 506 글꼴 대체 규칙(FONTMAP)과 대체 보고 ──
   AutoCAD 는 FONTALT(simplex.shx) 하나로 없는 글꼴을 모두 바꾸고, 대체 사실은 창 하나로 알린다(끄면 끝).
   바른 CAD 는 ① 사용자 대체표(acad.fmp 형식 "별칭;파일")를 내장 표보다 먼저 쓰고 ② 한글 SHX 는 한글 윤곽 글꼴로,
   ③ 도면을 열 때 "원래 글꼴 → 실제로 그린 글꼴" 표를 한 번 만들어 대체된 것만 알린다(다시 안 보기 가능). */
let userFontMap = new Map();          // 'hygtre' → 'malgun.ttf'
const fontKey = name => String(name || '').trim().toLowerCase().replace(/\.(ttf|ttc|otf|shx)$/, '');

/** acad.fmp 형식 문자열("별칭;파일", ; 로 시작하면 주석) → 대체표. 잘못된 줄은 건너뛰고 읽은 개수를 돌려준다. */
export function loadFontMap(fmpText) {
 userFontMap = new Map();
 for (const raw of String(fmpText ?? '').split(/\r?\n/)) {
  const line = raw.trim(); if (!line || line.startsWith(';') || line.startsWith('#')) continue;
  const parts = line.split(';'); if (parts.length !== 2) continue;
  const from = fontKey(parts[0]), to = parts[1].trim();
  if (from && to && !/["'\<>{}]/.test(to)) userFontMap.set(from, to);
 }
 return userFontMap.size;
}
/** 지금 대체표(보기·저장용). */
export const fontMapEntries = () => [...userFontMap];
/** 대체표를 다시 acad.fmp 형식으로. */
export const fontMapText = () => fontMapEntries().map(([a, b]) => `${a};${b}`).join('\n');

/** 사용자 대체표를 먼저 본 글꼴 이름. 표에 없으면 원래 이름. */
export const mappedFontFile = font => userFontMap.get(fontKey(font)) || null;

const installedCache = new Map();
/**
 * CSS 글꼴 이름이 이 PC 에 있는지. 글꼴이 없으면 브라우저가 뒤 글꼴로 그려 폭이 기본 글꼴과 같아지는 것을 잰다
 * (document.fonts.check 는 없는 시스템 글꼴에도 true 를 돌려줘 믿을 수 없다). measure(fontCss, text) 는 폭을 돌려준다.
 */
export function fontInstalled(family, measure) {
 const name = String(family || '').trim(); if (!name) return false;
 if (installedCache.has(name)) return installedCache.get(name);
 if (typeof measure !== 'function') return true;    // 잴 수 없는 곳(시험·서버)은 있다고 본다
 const sample = 'mmmmmmmmmmlli가나다WW', result = ['monospace', 'serif'].some(base => Math.abs(measure(`72px ${name}, ${base}`, sample) - measure(`72px ${base}`, sample)) > 0.5);
 installedCache.set(name, result);
 return result;
}
const FALLBACK_NAME = '나눔고딕(같이 싣는 기본 글꼴)';

/**
 * 원래 글꼴 → 실제로 그릴 글꼴. {source, bigFont, family, drawnWith, mapped, substituted, reason}
 * reason: 'shx'(선 글꼴을 윤곽 글꼴로) · 'missing'(이 PC 에 없음) · 'mapped'(사용자 대체표) · ''(그대로).
 */
export function resolveFont(font = '', bigFont = '', measure = null) {
 const mapped = mappedFontFile(font);
 const family = fontFamilyForFile(mapped || font, bigFont);
 const families = family.split(',').map(s => s.trim()).filter(Boolean);
 const base = new Set(BASE_FONT_FAMILY.split(',').map(s => s.trim()));
 const wanted = families.filter(f => !base.has(f));
 const drawn = wanted.find(f => /^(sans-serif|serif|monospace)$/.test(f) || fontInstalled(f, measure));
 const drawnWith = drawn ? drawn.replace(/"/g, '') : FALLBACK_NAME;
 const isShx = /\.shx$/i.test(String(mapped || font).trim());
 const reason = mapped ? 'mapped' : isShx ? 'shx' : !drawn && String(font || '').trim() ? 'missing' : '';
 return {source: String(font || ''), bigFont: String(bigFont || ''), family, drawnWith, mapped, substituted: !!reason, reason};
}

/**
 * 도면 문자 글꼴 표(같은 글꼴은 한 번). 열 때 한 번만 부른다(매 프레임 금지). 맨 위 문자와 공유 블록 정의 안 문자를 본다.
 * @returns 대체된 글꼴만 [{source, bigFont, drawnWith, reason, count}]
 */
export function fontSubstitutionReport(doc, measure = null) {
 const seen = new Map();
 const visit = e => {
  if (!e) return;
  if (e.type === 'text' && (e.sourceFont || e.sourceBigFont)) {
   const key = fontKey(e.sourceFont) + '|' + fontKey(e.sourceBigFont), hit = seen.get(key);
   if (hit) hit.count++; else seen.set(key, {...resolveFont(e.sourceFont, e.sourceBigFont, measure), count: 1});
  }
  if (e.type === 'block' && !e.sharedBlock) for (const child of e.entities || []) visit(child);
 };
 for (const e of doc?.entities || []) visit(e);
 for (const def of Object.values(doc?.sharedBlocks || {})) for (const child of def?.entities || []) visit(child);
 return [...seen.values()].filter(r => r.substituted).sort((a, b) => b.count - a.count);
}

/** 대체 보고 → 한국어 한 줄 알림(없으면 ''). */
export function fontSubstitutionMessage(report, limit = 3) {
 if (!report?.length) return '';
 const why = {shx: '선 글꼴', missing: '이 PC 에 없음', mapped: '대체표'};
 const head = report.slice(0, limit).map(r => `${r.source || '(이름 없음)'}${r.bigFont ? '+' + r.bigFont : ''} → ${r.drawnWith}(${why[r.reason]})`).join(', ');
 return `글꼴 ${report.length}개를 대신 그렸습니다: ${head}${report.length > limit ? ` 외 ${report.length - limit}개` : ''}. 위치·크기는 원본 그대로이고 저장할 때 원래 글꼴 이름을 돌려줍니다.`;
}
