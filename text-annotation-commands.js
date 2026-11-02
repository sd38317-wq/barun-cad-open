// 영역 5(문자·주석) 새 명령: FONTMAP(506) · SHXLOAD(507) · FIELD/UPDATEFIELD(512) · ATTSYNC(521) · TEXTALIGN(523).
// 명령 흐름만 여기 두고 계산은 각 모듈(text-fonts·shx-font·text-fields·block-attributes·text-edit-tools)에 있다.
import * as G from './geometry.js';
import {loadFontMap, fontMapText, fontMapEntries, fontSubstitutionReport, fontSubstitutionMessage} from './text-fonts.js';
import {parseShx, advanceTable} from './shx-font.js';
import {FIELD_KINDS, evaluateField, fieldText, activeFieldController, FIELDEVAL} from './text-fields.js';
import {attsyncPlan, attributeTexts} from './block-attributes.js';
import {alignTextsEvenly} from './text-edit-tools.js';
import {registerManualLabels} from './commands.js';

export const FONTMAP_STORAGE = 'barun-cad-fontmap';
export const FONT_NOTICE_STORAGE = 'barun-cad-font-notice-off';
export const SHX_STORAGE = 'barun-cad-shx-advances';

const read = (storage, key) => { try { return storage?.getItem?.(key) ?? null; } catch { return null; } };
const write = (storage, key, value) => { try { if (value === null) storage?.removeItem?.(key); else storage?.setItem?.(key, value); return true; } catch { return false; } };

/** 저장해 둔 사용자 글꼴 대체표를 읽어 둔다(앱 시작 때 한 번). */
export function restoreFontMap(storage) { const text = read(storage, FONTMAP_STORAGE); return text ? loadFontMap(text) : 0; }

/** 도면을 연 뒤 대체된 글꼴을 한 번 알린다(끄기 가능). 도면을 한 번 훑으니 열 때만 부른다. */
export function fontNoticeOnOpen(doc, {storage, toast, measure = null} = {}) {
 if (read(storage, FONT_NOTICE_STORAGE) === '1') return null;
 const report = fontSubstitutionReport(doc, measure), message = fontSubstitutionMessage(report);
 if (message) toast?.(message + ' (FONTMAP 명령: 대체표·알림 끄기)');
 return report;
}

/** 파일 고르기(브라우저). 고른 파일들의 [{name, bytes}] 또는 null. */
function pickFiles(accept, multiple = false) {
 const doc = globalThis.document; if (!doc?.createElement) return Promise.resolve(null);
 return new Promise(resolve => {
  const input = doc.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple;
  input.onchange = async () => resolve(input.files?.length ? await Promise.all([...input.files].map(async f => ({name: f.name, bytes: new Uint8Array(await f.arrayBuffer())}))) : null);
  input.click();
 });
}

registerManualLabels([['글꼴대체', 'FONTMAP'], ['SHX글꼴읽기', 'SHXLOAD'], ['필드', 'FIELD'], ['필드갱신', 'UPDATEFIELD'], ['속성동기화', 'ATTSYNC'], ['문자고르게정렬', 'TEXTALIGN']]);

export function installTextAnnotation(ctx) {
 restoreFontMap(ctx.storage);
 const storage = ctx.storage;
 const commands = {
  /* 506 FONTMAP: 원래 글꼴 → 실제로 그린 글꼴 표, 사용자 대체표(acad.fmp 형식) 불러오기·지우기, 열 때 알림 켜기·끄기. */
  async FONTMAP() {
   const report = fontSubstitutionReport(ctx.doc?.() || {entities: ctx.entities?.()});
   const lines = report.length ? report.map(r => `${r.source}${r.bigFont ? '+' + r.bigFont : ''} → ${r.drawnWith} · 문자 ${r.count}개`).join('\n') : '대신 그린 글꼴이 없습니다.';
   return ctx.form('글꼴 대체(FONTMAP)', [
    {name: 'report', label: '이 도면에서 대신 그린 글꼴', type: 'textarea', value: lines},
    {name: 'map', label: `사용자 대체표 (한 줄에 "원래글꼴;바꿀글꼴", 지금 ${fontMapEntries().length}줄)`, type: 'textarea', value: fontMapText()},
    {name: 'action', label: '할 일', options: [['save', '대체표 저장'], ['load', '대체표 파일(.fmp) 불러오기'], ['clear', '대체표 지우기']], value: 'save'},
    {name: 'notice', label: '도면을 열 때 대체 알림', options: [['on', '보기'], ['off', '다시 안 보기']], value: read(storage, FONT_NOTICE_STORAGE) === '1' ? 'off' : 'on'},
   ], async values => {
    write(storage, FONT_NOTICE_STORAGE, values.notice === 'off' ? '1' : null);
    let text = String(values.map ?? '');
    if (values.action === 'clear') text = '';
    if (values.action === 'load') { const files = await pickFiles('.fmp,.txt'); if (!files) return; text = new TextDecoder().decode(files[0].bytes); }
    const count = loadFontMap(text);
    write(storage, FONTMAP_STORAGE, count ? fontMapText() : null);
    ctx.refresh?.();
    ctx.toast(count ? `글꼴 대체표 ${count}줄을 적용했습니다. 원래 글꼴 이름은 저장할 때 그대로 돌려줍니다.` : '글꼴 대체표를 비웠습니다.');
   });
  },

  /* 507 SHXLOAD: 사용자 PC 의 SHX 글꼴(예: AutoCAD Fonts 폴더)을 읽어 글자 폭 표를 기억한다. 글꼴 파일은 복사하지 않는다. */
  async SHXLOAD() {
   const files = await pickFiles('.shx', true); if (!files) return null;
   let saved = {}; try { saved = JSON.parse(read(storage, SHX_STORAGE) || '{}') || {}; } catch { saved = {}; }
   const done = [], failed = [];
   for (const f of files) {
    try { const font = parseShx(f.bytes); saved[f.name.toLowerCase()] = advanceTable(font); done.push(`${f.name}(${font.kind === 'bigfont' ? '빅폰트' : '글꼴'} ${font.glyphs.size}자)`); }
    catch (error) { failed.push(`${f.name}: ${error.message}`); }
   }
   write(storage, SHX_STORAGE, JSON.stringify(saved));
   ctx.toast([done.length ? `SHX 폭 표를 읽었습니다: ${done.join(', ')}` : '', failed.length ? `읽지 못함: ${failed.join(' · ')}` : ''].filter(Boolean).join(' / '), !done.length);
   return done;
  },

  /* 512 FIELD: 날짜·파일 이름·객체 면적/길이 필드 문자를 넣는다. */
  async FIELD() {
   const values = await new Promise(resolve => ctx.form('필드 넣기(FIELD)', [
    {name: 'kind', label: '필드', options: FIELD_KINDS.map(([k, label]) => [k, label]), value: 'date'},
    {name: 'prefix', label: '앞 글(예: 면적 )', value: ''},
    {name: 'height', label: '문자 높이', value: String(ctx.getTextHeight?.() || 250)},
   ], resolve, () => resolve(null)));
   if (!values) return null;
   const kind = FIELD_KINDS.find(k => k[0] === values.kind) || FIELD_KINDS[0];
   let sourceId = null;
   if (values.kind === 'area' || values.kind === 'length') {
    const picked = await ctx.pickEntity({prompt: `${kind[1]}을(를) 읽을 객체 선택`}); if (!picked) return null;
    sourceId = (picked.entity || picked).id;
   }
   const at = await ctx.pickPoint({prompt: '필드 문자 넣을 점 지정'}); if (!at) return null;
   const height = Number(values.height); if (!(height > 0)) throw Error('문자 높이는 양수로 적으세요.');
   const code = kind[2](sourceId), ctxValues = {...fieldContext(ctx), byId: id => (ctx.entities?.() || []).find(e => e.id === id) || null};
   const cache = evaluateField(code, ctxValues) ?? '----';
   const fieldTemplate = `${String(values.prefix ?? '')}{{0}}`, fields = [{code, cache}];
   return ctx.commit({entities: [{type: 'text', position: {x: at.x, y: at.y}, height, rotation: 0, fieldTemplate, fields, text: fieldText(fieldTemplate, fields)}]});
  },

  /* 512 UPDATEFIELD: 모든 필드를 지금 값으로. */
  UPDATEFIELD() {
   const controller = activeFieldController();
   if (!controller) throw Error('필드 연결이 준비되지 않았습니다.');
   const n = controller.refresh(FIELDEVAL.regen | FIELDEVAL.command | FIELDEVAL.open | FIELDEVAL.save | FIELDEVAL.plot);
   ctx.toast(n ? `필드 문자 ${n}개를 새 값으로 바꿨습니다.` : '바뀐 필드가 없습니다.');
   return n;
  },

  /* 521 ATTSYNC: 고른(또는 집은) 블록을 기준으로 같은 이름 블록들의 속성 배치를 맞춘다. 값은 그대로. */
  async ATTSYNC() {
   let reference = (ctx.selected?.() || []).find(e => e.type === 'block' && attributeTexts(e).length);
   if (!reference) { const picked = await ctx.pickEntity({prompt: '기준이 될 속성 블록 선택', types: ['block']}); if (!picked) return null; reference = picked.entity || picked; }
   const layers = new Map((ctx.layers?.() || []).map(l => [l.id, l]));
   const all = (ctx.entities?.() || []).filter(e => e.type === 'block' && e.name === reference.name);
   const writable = all.filter(e => !layers.get(e.layer)?.locked);
   const plan = attsyncPlan(reference, writable);
   if (!plan.updates.length) return ctx.toast(`같은 이름(${reference.name})의 다른 블록이 없거나 맞출 수 없습니다${plan.skipped ? ` · 삽입점 없음·대칭 ${plan.skipped}개` : ''}.`);
   ctx.execute({type: 'updateMany', updates: plan.updates});
   ctx.toast(`ATTSYNC · ${reference.name} 블록 ${plan.synced}개의 속성 배치를 맞췄습니다(값 유지)${all.length - writable.length ? ` · 잠긴 레이어 ${all.length - writable.length}개 건너뜀` : ''}${plan.extraTags.length ? ` · 기준에 없는 태그(${plan.extraTags.join(', ')})는 지우지 않았습니다` : ''}. Ctrl+Z 로 되돌립니다.`);
   return plan.synced;
  },

  /* 523 TEXTALIGN: 첫 점·방향으로 문자를 고르게(간격 + 문자 폭) 늘어놓는다. 수평·수직 1° 안이면 축에 붙인다. */
  async TEXTALIGN() {
   const texts = (ctx.selected?.() || []).filter(e => e.type === 'text');
   if (texts.length < 2) throw Error('정렬할 문자를 두 개 이상 선택하세요.');
   const values = await new Promise(resolve => ctx.form('문자 고르게 정렬(TEXTALIGN)', [{name: 'spacing', label: '문자 사이 간격(도면 단위)', value: String(Math.round((texts[0].height || 100) * 2 / 2.5))}], resolve, () => resolve(null)));
   if (!values) return null;
   const spacing = Number(values.spacing); if (!Number.isFinite(spacing) || spacing < 0) throw Error('간격은 0 이상 숫자로 적으세요.');
   const start = await ctx.pickPoint({prompt: '첫 문자 위치 지정'}); if (!start) return null;
   const end = await ctx.pickPoint({prompt: '정렬 방향 지정'}); if (!end) return null;
   if (G.dist(start, end) <= G.EPS) throw Error('방향 점은 첫 점과 달라야 합니다.');
   const updates = alignTextsEvenly(texts, start, G.sub(end, start), spacing);
   ctx.execute({type: 'updateMany', updates});
   ctx.toast(`TEXTALIGN · 문자 ${updates.length}개를 고르게 늘어놓았습니다. Ctrl+Z 로 되돌립니다.`);
   return updates.length;
  },
 };
 return commands;
}

/** 필드 계산에 쓰는 문맥(파일 경로·날짜). */
export function fieldContext(ctx) {
 const doc = ctx.doc?.() || {};
 return {now: new Date(), filePath: ctx.drawingFilePath?.() || '', saveDate: doc.savedAt ? new Date(doc.savedAt) : null, plotDate: doc.plottedAt ? new Date(doc.plottedAt) : null};
}
