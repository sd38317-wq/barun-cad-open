// AutoCAD 홈 탭 "특성" 패널에 해당하는 명령. 훈민캐드 대조표 H21·H22·H25·H26·H30·H32·H33(격차표 기반 1).
//  CECOLOR  현재 색(이후 그리는 객체) · 객체에서 가져오기
//  CELTYPE  현재 선종류 · 객체에서 가져오기
//  CHPROP   선택 객체의 색·레이어·선종류·선종류 축척·선굵기 한 번에 바꾸기(빈칸 = 그대로)
//  SETBYLAYER 선택 객체의 색·선종류·선굵기를 레이어 따름으로
//  LINETYPE 선종류 목록(표준 acadiso 전체)과 현재 선종류·도면 선종류 축척
// 현재 특성은 도면 탭마다 따로 기억한다(app.js captureDrawingTab). 새 객체에 채우는 일은 app.js execute 한 곳에서 한다.
import {isChecked} from './card-input.js';
import {parseColor, colorChanges, describeColor, colorOfEntity, linetypeChoices, parseLinetype, parseLineweight, byLayerChanges, COLOR_NAMES, emptyCurrentProperties} from './cad-properties.js';
import {FONT_CHOICES} from './text-fonts.js';
import {normalizeTextStyles, cleanStyle, planTextStyleUpdate, planApplyTextStyle} from './text-style.js';
import {PLOT_DENSITIES} from './plot.js';

const KEEP = '__keep__';
const colorOptions = (includeKeep) => [
 ...(includeKeep ? [[KEEP, '그대로']] : []),
 ['BYLAYER', 'ByLayer (레이어 색)'], ['BYBLOCK', 'ByBlock'],
 ...Object.entries(COLOR_NAMES).map(([n, name]) => [n, `${n} ${name}`]),
 ['OTHER', '다른 번호·RGB (아래 칸)'],
];
/** 색 선택칸 + 직접 입력칸을 하나의 색으로. */
function readColorField(choice, custom) {
 if (choice === KEEP) return undefined;
 if (choice === 'OTHER') {
  if (!String(custom || '').trim()) throw Error('다른 색을 고르셨으면 "색 직접 입력" 칸에 번호(1~255)나 #RRGGBB 를 적으세요.');
  return parseColor(custom);
 }
 return parseColor(choice);
}

export function installPropertyTools(ctx) {
 const current = () => ctx.getCurrentProperties() || emptyCurrentProperties();
 const setCurrent = (patch) => { ctx.setCurrentProperties({...current(), ...patch}); };
 const needSelection = (what) => { const sel = ctx.selected(); if (!sel.length) throw Error(`${what}: 먼저 객체를 선택하세요.`); return sel; };
 const editable = (sel) => {
  const layers = new Map(ctx.layers().map(l => [l.id, l]));
  const ok = sel.filter(e => !layers.get(e.layer)?.locked);
  return {ok, skipped: sel.length - ok.length};
 };
 const report = (label, count, skipped) => ctx.toast(`${label} · ${count}개를 바꿨습니다.${skipped ? ` 잠긴 레이어 객체 ${skipped}개는 건너뛰었습니다.` : ''} Ctrl+Z 로 되돌립니다.`);

 return {
  CECOLOR() {
   const now = current().color;
   return ctx.form(`현재 색 (지금: ${describeColor(now)})`, [
    {name: 'color', label: '이후 그릴 객체의 색', options: colorOptions(false).map(([v, l]) => [v, l]), value: now?.mode === 'aci' && now.aci <= 9 ? String(now.aci) : now?.mode === 'byblock' ? 'BYBLOCK' : now ? 'OTHER' : 'BYLAYER'},
    {name: 'custom', label: '색 직접 입력 (1~255 · #RRGGBB · R,G,B)', value: now && !(now.mode === 'aci' && now.aci <= 9) && now.mode !== 'byblock' ? (now.aci || now.color || '') : ''},
    {name: 'fromObject', label: '도면 객체에서 색 가져오기', type: 'checkbox', value: false},
   ], async (values) => {
    let spec;
    if (isChecked(values.fromObject)) {
     const entity = await ctx.pickEntity({prompt: '색을 가져올 객체를 클릭하세요 · Esc 취소'});
     if (!entity) return;
     spec = colorOfEntity(entity);
    } else spec = readColorField(values.color, values.custom);
    setCurrent({color: spec.mode === 'bylayer' ? null : spec});
    ctx.toast(`현재 색: ${describeColor(spec)} · 이후 그리는 객체에 적용합니다.`);
   });
  },

  CELTYPE() {
   const now = current().linetype;
   return ctx.form(`현재 선종류 (지금: ${now || 'ByLayer'})`, [
    {name: 'linetype', label: '이후 그릴 객체의 선종류', options: linetypeChoices(ctx.doc()).concat([['BYBLOCK', 'ByBlock']]), value: now || 'BYLAYER'},
    {name: 'scale', label: '현재 선종류 축척 (CELTSCALE, 빈칸 = 1)', type: 'number', value: current().linetypeScale ?? ''},
    {name: 'fromObject', label: '도면 객체에서 선종류 가져오기', type: 'checkbox', value: false},
   ], async (values) => {
    let linetype;
    if (isChecked(values.fromObject)) {
     const entity = await ctx.pickEntity({prompt: '선종류를 가져올 객체를 클릭하세요 · Esc 취소'});
     if (!entity) return;
     linetype = entity.linetype && String(entity.linetype).toUpperCase() !== 'BYLAYER' ? String(entity.linetype).toUpperCase() : null;
    } else linetype = parseLinetype(values.linetype, ctx.doc());
    const scaleText = String(values.scale ?? '').trim();
    const scale = scaleText === '' ? null : Number(scaleText);
    if (scale !== null && !(scale > 0 && scale <= 10000)) throw Error('선종류 축척은 0 초과 10,000 이하입니다.');
    setCurrent({linetype, linetypeScale: scale === 1 ? null : scale});
    ctx.toast(`현재 선종류: ${linetype || 'ByLayer'}${scale && scale !== 1 ? ` · 축척 ${scale}` : ''}`);
   });
  },

  CHPROP() {
   const sel = needSelection('CHPROP');
   const layers = ctx.layers().filter(l => !l.locked);
   return ctx.form(`특성 변경 · ${sel.length}개 (그대로 = 바꾸지 않음)`, [
    {name: 'color', label: '색', options: colorOptions(true), value: KEEP},
    {name: 'custom', label: '색 직접 입력 (1~255 · #RRGGBB · R,G,B · 현재색은 .)', value: ''},
    {name: 'layer', label: '레이어', options: [[KEEP, '그대로'], ...layers.map(l => [l.id, l.name])], value: KEEP},
    {name: 'linetype', label: '선종류', options: [[KEEP, '그대로'], ...linetypeChoices(ctx.doc())], value: KEEP},
    {name: 'linetypeScale', label: '선종류 축척 (빈칸 = 그대로)', type: 'number', value: ''},
    {name: 'lineweight', label: '선굵기 mm (빈칸 = 그대로, BYLAYER = 레이어)', value: ''},
    {name: 'plotDensity', label: '출력 농도 % (인쇄할 때 흐리게)', options: [[KEEP, '그대로'], ...PLOT_DENSITIES.map(v => [String(v), v === 100 ? '100 (기본 · 진하게)' : `${v}`])], value: KEEP},
   ], (values) => {
    const changes = {};
    let spec;
    if (String(values.custom || '').trim() === '.') spec = current().color || {mode: 'bylayer'};
    else spec = readColorField(values.color === KEEP && String(values.custom || '').trim() ? 'OTHER' : values.color, values.custom);
    if (spec) Object.assign(changes, colorChanges(spec));
    if (values.layer !== KEEP) {
     const layer = ctx.layers().find(l => l.id === values.layer);
     if (!layer || layer.locked) throw Error('잠긴 레이어로는 옮길 수 없습니다.');
     changes.layer = layer.id;
    }
    if (values.linetype !== KEEP) changes.linetype = parseLinetype(values.linetype, ctx.doc());
    const ltText = String(values.linetypeScale ?? '').trim();
    if (ltText) { const n = Number(ltText); if (!(n > 0 && n <= 10000)) throw Error('선종류 축척은 0 초과 10,000 이하입니다.'); changes.linetypeScale = n; }
    const lwText = String(values.lineweight ?? '').trim();
    if (lwText) changes.lineweight = parseLineweight(lwText);
    if (values.plotDensity !== undefined && values.plotDensity !== KEEP) {
     const density = Number(values.plotDensity);
     if (!PLOT_DENSITIES.includes(density)) throw Error('출력 농도는 100·80·60·40·20 중 하나입니다.');
     changes.plotDensity = density === 100 ? null : density;   // 100 = 기본(블록 안이면 블록 농도를 따름)
    }
    if (!Object.keys(changes).length) return ctx.toast('바꿀 특성을 하나 이상 고르세요.');
    const {ok, skipped} = editable(sel);
    if (!ok.length) throw Error('선택한 객체가 모두 잠긴 레이어에 있습니다.');
    ctx.execute({type: 'update', ids: ok.map(e => e.id), changes});
    report('CHPROP', ok.length, skipped);
   });
  },

  SETBYLAYER() {
   const sel = needSelection('SETBYLAYER');
   return ctx.form(`레이어 따름으로 · ${sel.length}개`, [
    {name: 'color', label: '색을 ByLayer 로', type: 'checkbox', value: true},
    {name: 'linetype', label: '선종류를 ByLayer 로', type: 'checkbox', value: true},
    {name: 'lineweight', label: '선굵기를 ByLayer 로', type: 'checkbox', value: true},
    {name: 'linetypeScale', label: '선종류 축척을 1 로', type: 'checkbox', value: false},
    {name: 'blocks', label: '블록 안 객체까지 (AutoCAD 기본 · 공유 블록 정의는 제외)', type: 'checkbox', value: true},
   ], (values) => {
    const options = {color: isChecked(values.color), linetype: isChecked(values.linetype), lineweight: isChecked(values.lineweight), linetypeScale: isChecked(values.linetypeScale)};
    if (!Object.values(options).some(Boolean)) return ctx.toast('되돌릴 특성을 하나 이상 고르세요.');
    const {ok, skipped} = editable(sel);
    if (!ok.length) throw Error('선택한 객체가 모두 잠긴 레이어에 있습니다.');
    const changes = byLayerChanges(options), inside = isChecked(values.blocks);
    const deep = (e) => ({...e, ...changes, ...(e.type === 'block' && !e.sharedBlock && !e.xref && Array.isArray(e.entities) ? {entities: e.entities.map(deep)} : {})});
    ctx.execute({type: 'updateMany', updates: ok.map(e => ({id: e.id, changes: inside && e.type === 'block' && !e.sharedBlock && !e.xref && Array.isArray(e.entities) ? {...changes, entities: e.entities.map(deep)} : changes}))});
    report('SETBYLAYER', ok.length, skipped);
   });
  },

  /* STYLE: 문자 스타일의 글꼴(H47). AutoCAD 처럼 스타일 글꼴을 바꾸면 그 스타일 문자 전부가 바뀐다. 고른 문자에 스타일을 입힐 수도 있다.
     SHX 선 글꼴은 한글 큰 글꼴(whgtxt.shx)을 함께 둬 AutoCAD 에서도 한글이 보이게 한다. */
  STYLE() {
   // 509: 스타일 표(doc.textStyles)가 기준. 글꼴은 그 스타일 문자 전부(AutoCAD 처럼, 블록 안 포함 — 공유 블록·외부참조 정의 제외),
   // 폭 비율·기울기·고정 높이는 스타일 값을 따르던 문자만 바꾼다(따로 바꾼 문자는 지킨다). 표와 문자가 한 번의 Ctrl+Z 로 돌아온다.
   const texts = [];
   const walk = (list) => { for (const e of list || []) { if (e.type === 'text') texts.push(e); else if (e.type === 'block' && !e.sharedBlock && !e.xref) walk(e.entities); } };
   walk(ctx.doc().entities);
   const table = normalizeTextStyles(ctx.doc());
   const styles = [...new Set([...Object.keys(ctx.doc().textStyles || {}), ...texts.map(e => e.textStyle || 'Standard')])].sort();
   const selectedTexts = ctx.selected().filter(e => e.type === 'text');
   const first = selectedTexts[0] || texts[0];
   const current = table[first?.textStyle || styles[0]] || table.Standard;
   return ctx.form('문자 스타일 · 글꼴', [
    {name: 'style', label: '스타일', options: [...styles.map(n => [n, `${n} · 문자 ${texts.filter(e => (e.textStyle || 'Standard') === n).length}개`]), ['__new__', '새 스타일 만들기']], value: first?.textStyle || styles[0] || '__new__'},
    {name: 'name', label: '새 스타일 이름', value: ''},
    {name: 'font', label: '글꼴', options: [['__keep__', '그대로'], ...FONT_CHOICES.map(([file, label]) => [file, label])], value: '__keep__'},
    {name: 'widthFactor', label: '폭 비율 (그대로 두면 바꾸지 않음)', value: ''},
    {name: 'oblique', label: '기울기 각도 (도, -85~85)', value: ''},
    {name: 'height', label: '고정 높이 (0 = 고정 안 함)', value: ''},
    {name: 'scope', label: '적용', options: [['style', '이 스타일의 모든 문자'], ...(selectedTexts.length ? [['selection', `선택한 문자 ${selectedTexts.length}개를 이 스타일로`]] : [])], value: selectedTexts.length ? 'selection' : 'style'},
   ], (values) => {
    const name = values.style === '__new__' ? String(values.name || '').trim() : values.style;
    if (!name) throw Error('새 스타일 이름을 적으세요.');
    if (/[<>/\\":;?*|=]/.test(name)) throw Error('스타일 이름에 < > / \\ " : ; ? * | = 는 쓸 수 없습니다.');
    const font = values.font === '__keep__' ? null : values.font;
    if (values.style === '__new__' && !font) throw Error('새 스타일의 글꼴을 고르세요.');
    // 한글 선 글꼴(whgtxt·whtmtxt)은 AutoCAD 에서 큰 글꼴이다: 기본 글꼴 romans.shx + 큰 글꼴로 둔다.
    const fontStyle = !font ? {} : /^wh.*\.shx$/i.test(font) ? {font: 'romans.shx', bigFont: font} : {font, bigFont: /\.shx$/i.test(font) ? 'whgtxt.shx' : ''};
    const number = (key, label, lo, hi) => {
     const raw = String(values[key] ?? '').trim(); if (!raw) return {};
     const v = Number(raw); if (!Number.isFinite(v) || v < lo || v > hi) throw Error(`${label}은(는) ${lo}~${hi} 사이 숫자로 적으세요.`);
     return {[key]: v};
    };
    const valueStyle = {...number('widthFactor', '폭 비율', 0.01, 100), ...number('oblique', '기울기', -85, 85), ...number('height', '고정 높이', 0, 1e9)};
    const layers = new Map(ctx.layers().map(l => [l.id, l])), writable = (e) => !layers.get(e.layer)?.locked;
    const doc = ctx.doc();
    let plan;
    if (values.scope === 'selection') {
     const chosen = selectedTexts.filter(writable);
     if (values.style === '__new__' || !table[name]) {
      // 새 스타일: 표에 만들고 고른 문자에 스타일 값을 복사한다.
      const withStyle = {...doc, textStyles: {...table, [name]: cleanStyle({...(table[name] || {}), ...fontStyle, ...valueStyle})}};
      plan = planApplyTextStyle(withStyle, name, chosen);
     } else if (font || Object.keys(valueStyle).length) {
      // 있는 스타일 + 글꼴·값 지정: 고른 문자만 그 값으로(예전과 같음, 표는 그대로).
      const changes = {textStyle: name, ...(font ? {sourceFont: fontStyle.font, sourceBigFont: fontStyle.bigFont} : {}), ...valueStyle};
      if (changes.height === 0) delete changes.height;
      plan = {command: {type: 'updateMany', updates: chosen.map(e => ({id: e.id, changes}))}, count: chosen.length};
     } else plan = planApplyTextStyle(doc, name, chosen);   // 글꼴 그대로: 그 스타일의 지금 값을 따른다(한 스타일에 글꼴이 섞이지 않게)
     if (!plan.count) return ctx.toast('바꿀 문자가 없습니다(잠긴 레이어 문자는 건너뜁니다).');
    } else {
     plan = planTextStyleUpdate(doc, name, {...fontStyle, ...valueStyle}, {writable});
     if (!plan.changedKeys.length) return ctx.toast('바뀐 스타일 값이 없습니다.');
    }
    ctx.execute(plan.command);
    const shown = fontStyle.font ? ` · ${fontStyle.font}${fontStyle.bigFont ? ' + ' + fontStyle.bigFont : ''}` : '';
    ctx.toast(`문자 스타일 ${name}${shown} · 문자 ${plan.count}개${plan.skipped ? ` · 잠긴 레이어 ${plan.skipped}개 건너뜀` : ''}. Ctrl+Z 로 되돌립니다.`);
   });
  },

  /* LUPREC: 거리·좌표·속성 표시 자리수(H04). 도면 값은 그대로이고 보이는 자리수만 바뀐다. */
  LUPREC() {
   const now = ctx.getDisplayPrecision?.() ?? 2;
   return ctx.form(`표시 자리수 (지금: 소수 ${now}자리)`, [
    {name: 'digits', label: '소수 자리수 (0~8)', options: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => [String(n), n ? `${n}자리 · ${(1.23456789).toFixed(n)}` : '0자리 · 정수']), value: String(now)},
   ], (values) => {
    const digits = ctx.setDisplayPrecision(Number(values.digits));
    ctx.refresh?.();
    ctx.toast(`표시 자리수: 소수 ${digits}자리`);
   });
  },

  LINETYPE() {
   const doc = ctx.doc();
   return ctx.form('선종류 · 표준 acadiso 전체', [
    {name: 'current', label: '현재 선종류', options: linetypeChoices(doc), value: current().linetype || 'BYLAYER'},
    {name: 'ltscale', label: '도면 전체 선종류 축척 (LTSCALE)', type: 'number', value: doc.linetypeScale ?? 1},
   ], (values) => {
    // 둘 다 검사한 뒤에 바꾼다(잘못된 LTSCALE 로 오류가 나도 현재 선종류가 먼저 바뀌어 있지 않게).
    const linetype = parseLinetype(values.current, doc), ltscale = Number(values.ltscale);
    if (!(ltscale > 0 && ltscale <= 100000)) throw Error('LTSCALE 은 0 초과 100,000 이하입니다.');
    setCurrent({linetype});
    // ACAD200 719: AutoCAD ltscale_cmd 처럼 같은 값이면(부동소수 오차 포함) 아무것도 하지 않는다 — 도면 전체 다시 그리기 없음.
    if (Math.abs(ltscale - (Number(doc.linetypeScale) || 1)) > 1e-12) ctx.execute({type: 'document.update', changes: {linetypeScale: ltscale}});
    ctx.toast(`현재 선종류: ${current().linetype || 'ByLayer'} · LTSCALE ${ltscale}`);
   });
  },
 };
}
