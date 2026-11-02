// 524 맞춤법 검사(SPELL). AutoCAD 는 영어 사전(DCTMAIN=enu)으로 단어를 하나씩 확인하고(spellTrim → spellVerify →
// spellCorrect) 사용자 사전(sample.cus)을 둔다. 한국 건축 도면은 한글·영문이 섞이고, 실제로 자주 틀리는 것은
// 외래어 표기(몰타르·판넬·샷시…)라 영어 사전으로는 못 잡는다. 그래서:
//  - "자주 틀리는 표기" 대응표(국립국어원 외래어 표기·건축 표준시방서 용어 기준으로 근거가 확실한 것만)로 고칠 말을 바로 제안,
//  - 우리 표준 용어(레이어 표준·상세 재료·지시선 재료 목록)는 사전으로 써서 오탐을 막고,
//  - 사전에 없는 영문 단어 알림은 오탐이 많아 기본 끔(옵션), 대응표에 있는 영문 오타만 기본으로 잡는다.
// 검사 대상은 522 의 textSlots(문자·치수 문자·블록 속성·표 칸·블록 안 문자)를 그대로 쓴다. 명령을 실행할 때만 훑는다.
import {textSlots, planSlotEdits, lockedBy, slotBounds, SLOT_KIND_LABELS, SCOPE_MODES} from './text-find.js';
import {LAYER_STANDARDS} from './layer-standards-data.js';
import {DETAIL_MATERIALS} from './detail-library.js';
import {DEFAULT_MATERIALS} from './mleader-tools.js';
import {registerManualLabels} from './commands.js';

export const USER_DICT_KEY = 'barun-spell-user-words';
export const MAX_USER_WORDS = 2000;

/* 자주 틀리는 표기 → 바른 표기. whole: 단어 전체가 같을 때만(짧아서 다른 말 속에 들어갈 수 있는 것). 나머지는 낱말 속에서도 찾는다
   (예: 방수판넬 → 방수패널). 바른 표기 속에 틀린 표기가 들어 있지 않음을 시험이 확인한다. */
export const KOREAN_FIXES = Object.freeze([
 ['몰타르', '모르타르'], ['콘크리이트', '콘크리트'], ['콘크리드', '콘크리트'], ['판넬', '패널'],
 ['샷시', '새시'], ['샤시', '새시'], ['알미늄', '알루미늄'], ['알루미니움', '알루미늄'],
 ['스치로폴', '스티로폼'], ['스티로폴', '스티로폼'], ['스테인레스', '스테인리스'], ['스텐', '스테인리스', true],
 ['후레싱', '플래싱'], ['후로링', '플로어링'], ['덱크', '데크'], ['앙카', '앵커'], ['브라켓', '브래킷'],
 ['세멘트', '시멘트'], ['아스활트', '아스팔트'], ['화이바', '파이버'], ['그라스울', '글라스울'], ['비니루', '비닐'],
 ['시이트', '시트'], ['쉬트', '시트'], ['커텐', '커튼'], ['후레임', '프레임'], ['스라브', '슬래브'], ['후랜지', '플랜지'],
 ['닥트', '덕트'], ['카페트', '카펫'], ['썬큰', '선큰'], ['샷다', '셔터'], ['셧타', '셔터'],
 ['엘레베이터', '엘리베이터'], ['엘리베이타', '엘리베이터'], ['엘레베이타', '엘리베이터'], ['에스카레이터', '에스컬레이터'], ['메쉬', '메시'],
].map(([wrong, right, whole = false]) => Object.freeze({wrong, right, whole})));

/* 도면에 자주 나오는 영문 오타(단어 전체, 대소문자 무시 · 고친 말은 원래 대소문자 모양을 따른다). */
export const ENGLISH_FIXES = Object.freeze({
 morter: 'mortar', concret: 'concrete', concerte: 'concrete', insullation: 'insulation', insulaton: 'insulation',
 waterprofing: 'waterproofing', gypsom: 'gypsum', aluminun: 'aluminum', stainles: 'stainless', plywod: 'plywood',
 foundaton: 'foundation', elevaton: 'elevation', partion: 'partition', ceilling: 'ceiling', celing: 'ceiling',
});

/* 영문 알림(옵션)을 켰을 때 쓰는 기본 영문 사전. 도면 약어(THK·EL·FL 등)는 짧은 대문자라 따로 건너뛴다. */
const ENGLISH_WORDS = `a an and at by for from in of on or the to with
wall walls door doors window windows floor floors roof stair stairs column columns beam beams slab slabs plan plans section sections
elevation elevations detail details scale level levels ceiling ceilings room rooms toilet kitchen living bed bedroom bath bathroom
entrance lobby hall corridor storage stor elev elevator escalator ramp parking lot site north south east west up down top bottom
concrete mortar brick block stone steel metal glass wood timber board gypsum insulation waterproofing membrane paint tile tiles
panel panels sheet plate pipe duct drain grill louver frame sash curtain fixed sliding swing fire exit sign note notes typ typical
see refer reference dimension dimensions grid line lines center centre axis area total net gross height width length depth thickness
new existing demolish remove finish finishes ext int exterior interior main sub type mark no number drawing title sheet date rev
revision approved checked designed drawn owner architect project building house apartment unit units office shop store
aluminum aluminium stainless galvanized plywood asphalt urethane epoxy silicone sealant anchor bolt nut washer bracket flange
foundation footing pile retaining basement mezzanine parapet canopy balcony terrace deck handrail railing guard opening`.split(/\s+/);

const WORD_SPLIT = /[\s()[\]{}\/·,+:;"'<>=]+/u;
const HANGUL = /\p{Script=Hangul}/u;

/** 단어 앞뒤 기호 떼기(AutoCAD spellTrim 과 같은 일). 고친 말에 다시 붙인다. */
const TRIM = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su;
export function spellTrim(word) { const [, lead, core, trail] = TRIM.exec(String(word ?? '')); return {lead, core, trail}; }

function tokensOf(text) { return String(text ?? '').split(WORD_SPLIT).map(t => spellTrim(t).core).filter(Boolean); }

/** 표준 용어 사전: 레이어 표준 이름·설명, 상세 재료, 지시선 재료 목록, 사용자 사전. 틀린 표기는 들어가지 않게 뺀다. */
export function buildSpellDictionary(userWords = []) {
 const dict = new Set(), english = new Set(ENGLISH_WORDS);
 const addText = (text) => { for (const t of tokensOf(text)) { dict.add(t); dict.add(t.toLowerCase()); if (/^[A-Za-z]+$/.test(t)) english.add(t.toLowerCase()); } };
 for (const l of LAYER_STANDARDS) { addText(l.label); addText(l.description); for (const part of String(l.name || '').split('-')) if (part) english.add(part.toLowerCase()); }
 for (const m of Object.values(DETAIL_MATERIALS)) addText(m.label);
 for (const m of DEFAULT_MATERIALS) addText(m);
 for (const f of KOREAN_FIXES) addText(f.right);
 for (const w of Object.values(ENGLISH_FIXES)) english.add(w);
 for (const f of KOREAN_FIXES) for (const t of [...dict]) if (f.whole ? t === f.wrong : t.includes(f.wrong)) dict.delete(t);
 for (const w of Object.keys(ENGLISH_FIXES)) { english.delete(w); dict.delete(w); }
 for (const w of userWords || []) { const t = String(w).trim(); if (t) { dict.add(t); dict.add(t.toLowerCase()); english.add(t.toLowerCase()); } }
 return {dict, english};
}

const casedLike = (sample, word) => sample === sample.toUpperCase() ? word.toUpperCase() : sample[0] === sample[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word;

/**
 * 단어 하나 검사. 고칠 것이 없으면 null. 결과 {word, core, suggestions, reason:'fix'|'unknown'}.
 * dict 에 있으면 통과, 숫자로 시작하면 통과, 한글은 대응표에 있을 때만, 영문은 오타 대응표 또는(english 옵션) 사전에 없을 때.
 */
export function checkWord(word, dict, {fixes = KOREAN_FIXES, englishFixes = ENGLISH_FIXES, english = false, englishDict = null} = {}) {
 const {lead, core, trail} = spellTrim(word);
 if (!core || /^\p{N}/u.test(core)) return null;
 if (dict?.has(core) || dict?.has(core.toLowerCase())) return null;
 if (HANGUL.test(core)) {
  let fixed = core;
  for (const f of fixes) if (f.whole ? fixed === f.wrong : fixed.includes(f.wrong)) fixed = f.whole ? f.right : fixed.split(f.wrong).join(f.right);
  return fixed !== core ? {word, core, suggestions: [lead + fixed + trail], reason: 'fix'} : null;
 }
 if (!/^[A-Za-z]+$/.test(core)) return null;
 const fix = englishFixes[core.toLowerCase()];
 if (fix) return {word, core, suggestions: [lead + casedLike(core, fix) + trail], reason: 'fix'};
 if (!english || core.length < 3 || (core === core.toUpperCase() && core.length <= 4)) return null;   // 짧은 대문자는 도면 약어(THK·EL·FL…)
 return englishDict?.has(core.toLowerCase()) ? null : {word, core, suggestions: [], reason: 'unknown'};
}

/** 객체들의 모든 글을 단어로 나눠 검사. 결과마다 슬롯 정보 + index(글 안 위치) + word·suggestions. */
export function spellScan(entities, dict, options = {}) {
 const out = [], scope = options.scope || 'all';
 for (const e of entities || []) for (const slot of textSlots(e)) {
  if (!slot.value || (scope === 'text' && (slot.kind !== 'text' || slot.path.length))) continue;
  for (const m of slot.value.matchAll(/\S+/gu)) {
   const r = checkWord(m[0], dict, options);
   if (r) out.push({...slot, index: m.index, ...r});
  }
 }
 return out;
}

/** 사용자 사전(브라우저 저장소). 못 읽거나 못 쓰면 빈 목록·오류 문구. */
export function loadUserWords(storage) {
 try { const list = JSON.parse(storage?.getItem(USER_DICT_KEY) || '[]'); return Array.isArray(list) ? list.filter(w => typeof w === 'string' && w.trim()).slice(0, MAX_USER_WORDS) : []; } catch { return []; }
}
export function addUserWord(storage, word) {
 const w = String(word ?? '').trim();
 if (!w) throw Error('사전에 넣을 단어가 비어 있습니다.');
 const list = loadUserWords(storage);
 if (!list.includes(w)) list.push(w);
 try { storage.setItem(USER_DICT_KEY, JSON.stringify(list.slice(-MAX_USER_WORDS))); } catch { throw Error('사용자 사전을 저장하지 못했습니다(저장소를 쓸 수 없음).'); }
 return list;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 글 안에서 그 단어(공백으로 나뉜 한 덩어리)만 바꾼다. index 가 주어지면 그 자리 하나만. */
export function replaceWord(value, word, to, index = null) {
 if (index != null) return value.slice(index, index + word.length) === word ? value.slice(0, index) + to + value.slice(index + word.length) : null;
 const re = new RegExp(`(?<=^|\\s)${escapeRe(word)}(?=\\s|$)`, 'gu');
 const out = value.replace(re, () => to);
 return out === value ? null : out;
}

const slotId = s => `${s.id}|${s.path.join('/')}|${s.key}`;
/** 글 안에서 그 단어(한 덩어리)의 자리. 앞에서 같은 칸을 고쳐 자리가 밀렸으면 가장 가까운 같은 단어. 없으면 null. */
export function locateWord(value, word, index) {
 if (value.slice(index, index + word.length) === word && (index === 0 || /\s/u.test(value[index - 1])) && !/\S/u.test(value[index + word.length] || ' ')) return index;
 let best = null;
 for (const m of value.matchAll(/\S+/gu)) if (m[0] === word && (best == null || Math.abs(m.index - index) < Math.abs(best - index))) best = m.index;
 return best;
}

export function installSpellCheck(ctx) {
 registerManualLabels([['SPELL', 'SPELL'], ['맞춤법', 'SPELL'], ['맞춤법검사', 'SPELL'], ['철자검사', 'SPELL']]);
 const storage = () => ctx.storage ?? globalThis.localStorage;
 const byId = id => (ctx.entities?.() || []).find(e => e.id === id);
 const show = (hit) => {
  ctx.setSelected?.([hit.id]);
  if (typeof ctx.zoomToBounds === 'function') { const b = slotBounds(byId(hit.id), hit); if (b) try { ctx.zoomToBounds(b); } catch {} }
 };
 const currentValue = (hit) => { const e = byId(hit.id); if (!e) return null; for (const s of textSlots(e)) if (slotId(s) === slotId(hit)) return {e, value: s.value}; return null; };

 function SPELL() {
  return ctx.form('맞춤법 검사 (SPELL) · 선택 없으면 도면 전체', [
   {name: 'scope', label: '검사할 곳', value: 'all', options: SCOPE_MODES},
   {name: 'english', label: '사전에 없는 영문 단어도 알리기 (오탐이 많아 기본 끔 · 영문 오타 대응표는 늘 확인)', value: 'off', options: [['off', '끔'], ['on', '켬']]},
  ], v => {
   const sel = ctx.selected?.() || [], pool = sel.length ? sel : (ctx.entities?.() || []);
   const userWords = loadUserWords(storage()), {dict, english} = buildSpellDictionary(userWords);
   const options = {scope: v.scope, english: v.english === 'on', englishDict: english};
   const locked = lockedBy(ctx.layers?.()), found = spellScan(pool, dict, options), hits = found.filter(h => !locked(h));
   const lockedNote = found.length - hits.length ? ` · 잠긴 레이어 ${found.length - hits.length}곳은 건너뜀` : '';
   if (!hits.length) { ctx.toast(`SPELL · 고칠 표기를 찾지 못했습니다${lockedNote}.`); return {hits: 0}; }
   const ignored = new Set(), tally = {replaced: 0, skipped: 0, added: 0};
   const finish = (how) => ctx.toast(`SPELL · ${how} · 바꿈 ${tally.replaced}곳 · 건너뜀 ${tally.skipped}곳${tally.added ? ` · 사전에 ${tally.added}개 추가` : ''}${lockedNote}${tally.replaced ? ' · Ctrl+Z 로 되돌리기' : ''}`);
   const commit = (edits) => {   // edits: Map(slotId → {hit, value})
    const ids = [...new Set([...edits.values()].map(x => x.hit.id))], entities = ids.map(byId).filter(Boolean);
    const plan = planSlotEdits(entities, s => edits.get(slotId(s))?.value ?? null, {locked, scope: 'all'});
    if (plan.updates.length) ctx.execute({type: 'updateMany', updates: plan.updates});
    return plan.edits.length;
   };
   const step = (i) => {
    while (i < hits.length && ignored.has(hits[i].core)) { i++; tally.skipped++; }
    if (i >= hits.length) { finish(`검사 ${hits.length}곳을 모두 지났습니다`); return; }
    const hit = hits[i], now = currentValue(hit), at = now ? locateWord(now.value, hit.word, hit.index) : null;
    if (at == null) { step(i + 1); return; }   // 앞에서 이미 바뀐 곳
    show(hit);
    const reason = hit.reason === 'fix' ? `바른 표기: ${hit.suggestions[0]}` : '사전에 없는 영문 단어';
    ctx.form(`SPELL · ${i + 1}/${hits.length} · ${SLOT_KIND_LABELS[hit.kind]} · "${hit.word}" · ${reason}`, [
     {name: 'to', label: '바꿀 말', value: hit.suggestions[0] ?? hit.word},
     {name: 'action', label: '작업', value: hit.suggestions.length ? 'replace' : 'skip', options: [['replace', '이것만 바꾸기'], ['all', `"${hit.word}" 를 모두 바꾸기`], ['skip', '건너뛰기'], ['ignore', `"${hit.core}" 는 이번 검사에서 모두 건너뛰기`], ['add', `"${hit.core}" 를 사용자 사전에 추가 (다음부터 안 알림)`], ['stop', '그만두기']]},
    ], f => {
     const to = String(f.to ?? '');
     if (f.action === 'stop') { finish('그만뒀습니다'); return; }
     if (f.action === 'skip') { tally.skipped++; step(i + 1); return; }
     if (f.action === 'ignore' || f.action === 'add') {
      if (f.action === 'add') { addUserWord(storage(), hit.core); tally.added++; }
      ignored.add(hit.core); tally.skipped++; step(i + 1); return;
     }
     if ((f.action === 'replace' || f.action === 'all') && (!to.trim() || to === hit.word)) throw Error('바꿀 말을 넣으세요(지금 표기와 달라야 합니다).');
     const edits = new Map();
     if (f.action === 'replace') { const next = replaceWord(now.value, hit.word, to, at); if (next != null) edits.set(slotId(hit), {hit, value: next}); }
     else for (const h of hits.slice(i)) {
      if (h.word !== hit.word || edits.has(slotId(h))) continue;
      const cur = currentValue(h), next = cur && replaceWord(cur.value, hit.word, to);
      if (next != null) edits.set(slotId(h), {hit: h, value: next});
     }
     tally.replaced += commit(edits);
     step(i + 1);
    });
   };
   step(0);
   return {hits: hits.length};
  });
 }
 return {SPELL};
}
