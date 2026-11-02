// 신축설계 — 주소 하나로 대지를 가져오고, 최대 규모를 산출하고, 새 도면에 평면을 그린다.
//
// 조건을 캐묻지 않는다. 용도지역·최대 건폐율·최대 용적률·최대 건축면적은
// 주소만 있으면 토지이용정보 조회에서 그대로 나온다(miriboda_service.land_info).
// 용도와 실 구성은 그 규모에 맞춰 AI 가 안을 내고, 사람은 고르고 고칠 점만 적는다.
//
//   주소 → 새 도면 → 대지 가져오기 → 최대 규모 → 계획안 3개 → 고르기·고칠 점 → 작도
import {designReviewPrompt, designDrawPrompt, designOptions, designStorageKey} from './miriboda-panel.js';
import {apartmentView} from './apartment-panel.js';

/** 조회된 토지 자료에서 설계에 실제로 쓰는 값만 추린다. 없으면 없는 대로 둔다. */
export function siteLimits(info) {
 if (!info) return null;
 const massing = info.massing || {}, limits = info.limits || {};
 const number = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);
 return {
  address: info.address || '',
  zone: massing.zoneName || (info.zoneNames || [])[0] || '',
  lotAreaM2: number(massing.lotAreaM2 ?? info.areaM2),
  maxCoverage: number(limits.bcr),
  maxFloorRatio: number(limits.far),
  maxBuildingAreaM2: number(massing.maxBuildingAreaM2),
  maxFloorAreaM2: number(massing.maxFloorAreaM2),
  warnings: info.warnings || [],
 };
}

/** 산출된 최대 규모를 한 줄로. 값이 없으면 무엇이 없는지 말한다. */
export function limitsLine(site) {
 if (!site) return '대지를 아직 가져오지 않았습니다.';
 const parts = [];
 if (site.zone) parts.push(site.zone);
 if (site.lotAreaM2) parts.push('대지 ' + site.lotAreaM2.toFixed(1) + '㎡');
 if (site.maxCoverage) parts.push('최대 건폐율 ' + site.maxCoverage + '%');
 if (site.maxFloorRatio) parts.push('최대 용적률 ' + site.maxFloorRatio + '%');
 if (site.maxBuildingAreaM2) parts.push('최대 건축면적 ' + site.maxBuildingAreaM2.toFixed(1) + '㎡');
 if (site.maxFloorAreaM2) parts.push('최대 연면적 ' + site.maxFloorAreaM2.toFixed(1) + '㎡');
 return parts.length ? parts.join(' · ') : '용도지역과 최대 규모를 조회하지 못했습니다. 토지정보에서 확인하세요.';
}

/** 작도 요청에 늘 붙이는 규칙.
    배치도(site_plan)와 평면도는 다른 일인데, AI 는 '계획해줘' 를 배치 API 로 보내도록 배워 있다.
    그대로 두면 평면 요청이 배치 API 로 새고 422 로 떨어진다. 여기서 못 박는다. */
const DRAW_RULES = '이것은 평면도 작도입니다. 배치도가 아닙니다.'
 + ' site_plan.generate 와 parcel_import 를 쓰지 마세요. 대지 경계는 이미 도면에 있습니다.'
 + ' wall·line·polyline·rect·circle·text·architecture 액션으로 직접 끝까지 그리세요. 되묻지 마세요.';

/** 주소 자동설계는 외부 AI가 JSON을 되묻는 경우에도 빈 도면으로 끝나면 안 된다.
    현재 대지 오른쪽에 서로 다른 3개 평면 초안을 확정적으로 만든다. */
/** 말로 그려 달라고 한 것인가. 대화칸에서도 작도로 이어 주려고 본다. */
export function wantsDrawing(message) {
 return /그려|그리기|작도|만들어|설계해|설계 해|뽑아|배치해|넣어 줘|넣어줘/.test(String(message || ''));
}

/** 자유롭게 주고받는 말 한 차례. 조건을 캐묻지 않고 물어본 것에만 답한다. */
export function newBuildTalkPrompt(site, history, message) {
 const said = String(message || '').trim();
 if (!said) throw Error('하실 말씀을 적어 주세요.');
 const talk = (history || []).slice(-10).map(item => (item.role === 'user' ? '건축주' : 'AI') + ': ' + item.text).join('\n');
 return '신축 계획을 두고 건축주와 나누는 대화입니다. 한국어로 짧게, 물어본 것에만 답하세요.'
  + ' 조건을 캐묻지 마세요. 용도·층수·실 구성은 아래 최대 규모에 맞춰 당신이 제안하세요.'
  + ' 조회된 값이 없는 항목은 모른다고 말하고 지어내지 마세요. 이번 차례에는 도면을 바꾸지 마세요.'
  + '\n\n[조회된 대지 — 데이터]\n' + JSON.stringify(site || null)
  + (talk ? '\n\n[지금까지 나눈 이야기]\n' + talk : '')
  + '\n\n[건축주의 이번 말]\n' + said;
}

export function installNewBuild(studio) {
 const { toast } = studio.context;
 const el = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
 const key = () => designStorageKey(studio);
 const load = () => { try { return JSON.parse(localStorage.getItem(key()) || '{}'); } catch { return {}; } };
 const store = (value, where = key()) => { try { localStorage.setItem(where, JSON.stringify(value)); } catch { toast('설계 조건을 이 PC에 저장하지 못했습니다.', true); } };

 const dialog = el('dialog'); dialog.id = 'new-build-dialog'; dialog.className = 'new-build-dialog';
 const head = el('div'); head.className = 'dialog-header';
 head.append(el('h2', 'AI 설계'));
 const close = el('button', '닫기 ×'); close.type = 'button'; head.append(close);
 dialog.append(head, el('p', '주소를 넣으면 소규모 3안과 아파트 2안을 바로 도면에 그립니다.'));

 const start = el('div'); start.className = 'nb-start';
 const addressWrap = el('label', '대지 주소'), address = el('input');
 address.id = 'nb-address'; address.maxLength = 300; address.placeholder = '예: 부산 부산진구 양정동 156-7';
 addressWrap.append(address);
 const begin = el('button', '자동 설계'); begin.type = 'button'; begin.className = 'primary'; begin.id = 'nb-begin';
 // 아파트 계획도 같이(빠른 검토, 회원 무료). 끄면 예전처럼 소규모 3안만.
 const aptWrap = el('label'); aptWrap.className = 'nb-apt-toggle';
 const aptOn = el('input'); aptOn.type = 'checkbox'; aptOn.id = 'nb-apartment';
 try { aptOn.checked = localStorage.getItem('barun-newbuild-apartment') !== 'off'; } catch { aptOn.checked = true; }
 aptOn.onchange = () => { try { localStorage.setItem('barun-newbuild-apartment', aptOn.checked ? 'on' : 'off'); } catch { /* 이 PC 저장 실패는 다음 실행 기본값만 바뀐다 */ } };
 aptWrap.append(aptOn, el('span', '아파트 계획도 같이'), el('small', '빠른 검토 · 회원 무료 · 약 1분'));
 const limits = el('p'); limits.className = 'nb-limits'; limits.setAttribute('role', 'status');
 start.append(addressWrap, begin, aptWrap, limits);

 // 결과: 소규모 3안 카드 + 아파트 진행·카드. 소규모가 먼저 그려지고 아파트는 서버 계산이 끝나면 이어서 그린다.
 const results = el('div'); results.className = 'nb-results'; results.hidden = true;
 const section = (title, sub) => { const box = el('section'); box.className = 'nb-sec'; const h = el('div'); h.className = 'nb-sec-h'; const s = el('span', sub); h.append(el('strong', title), s); const body = el('div'); box.append(h, body); results.append(box); return { box, sub: s, body }; };
 const smallSec = section('소규모 계획안', ''), aptSec = section('아파트 계획안', '');
 const resultActions = el('div'); resultActions.className = 'nb-plan-actions';
 const openApt = el('button', '아파트 검토 창 열기…'); openApt.type = 'button';
 const viewDrawing = el('button', '도면에서 보기'); viewDrawing.type = 'button'; viewDrawing.className = 'primary';
 resultActions.append(openApt, viewDrawing); results.append(resultActions);

 const talk = el('div'); talk.className = 'nb-talk'; talk.setAttribute('role', 'log'); talk.setAttribute('aria-label', '신축설계 대화');
 const compose = el('div'); compose.className = 'nb-compose';
 const say = el('textarea'); say.id = 'nb-message'; say.rows = 2; say.maxLength = 4000;
 say.setAttribute('aria-label', '신축설계 대화 입력');
 say.placeholder = '궁금한 것이나 바라는 것을 적으세요. Enter 전송 · Shift+Enter 줄바꿈';
 const send = el('button', '보내기'); send.type = 'button';
 compose.append(say, send);

 const proposal = el('div'); proposal.className = 'nb-proposal'; proposal.hidden = true;
 const planTitle = el('div', '계획안 선택'); planTitle.className = 'nb-section-title';
 const planCards = el('div'); planCards.className = 'nb-plan-cards'; planCards.setAttribute('role', 'radiogroup'); planCards.setAttribute('aria-label', '계획안');
 const choice = el('input'); choice.type = 'hidden'; choice.id = 'nb-plan-choice';
 const conditions = el('fieldset'); conditions.className = 'nb-conditions';
 const conditionTitle = el('legend', '설계 조건'); conditions.append(conditionTitle);
 const makeSelect = (name, label, values) => { const wrap = el('label', label), select = el('select'); select.dataset.condition = name; for (const [value, text] of values) { const option = el('option', text); option.value = value; select.append(option); } wrap.append(select); conditions.append(wrap); return select; };
 const floors = makeSelect('층수', '층수', [['', '자동'], ['1층', '1층'], ['2층', '2층'], ['3층', '3층'], ['4층', '4층']]);
 const parking = makeSelect('주차', '주차', [['', '자동'], ['1대', '1대'], ['2대', '2대'], ['3대', '3대'], ['4대 이상', '4대 이상']]);
 const bedrooms = makeSelect('침실', '침실', [['', '자동'], ['1개', '1개'], ['2개', '2개'], ['3개', '3개'], ['4개', '4개'], ['5개 이상', '5개 이상']]);
 const direction = makeSelect('거실 방향', '거실 방향', [['', '자동'], ['남향', '남향'], ['남동향', '남동향'], ['남서향', '남서향'], ['도로 방향', '도로 방향']]);
 const changesWrap = el('label', '추가 조건 (선택)'), changes = el('input');
 changes.id = 'nb-plan-changes'; changes.maxLength = 1000; changes.placeholder = '예: 다목적실 제외'; changesWrap.className = 'nb-extra'; changesWrap.append(changes);
 const drawAll = el('button', '1·2·3안 모두 그리기'); drawAll.type = 'button'; drawAll.className = 'primary'; drawAll.id = 'nb-draw-all';
 const draw = el('button', '선택한 안 그리기'); draw.type = 'button'; draw.id = 'nb-draw';
 const actions = el('div'); actions.className = 'nb-plan-actions'; actions.append(drawAll, draw);
 const step = el('div'); step.className = 'nb-step'; step.hidden = true; step.append(planTitle, planCards, choice, conditions, changesWrap, actions);
 const note = el('p'); note.id = 'nb-status'; note.setAttribute('role', 'status');
 const loading = el('div'); loading.className = 'nb-loading'; loading.hidden = true;
 loading.append(el('span'), el('strong', 'AI 자동설계 중'), el('p', '도면이 완성될 때까지 이 창을 유지합니다.'));

 dialog.append(start, note, results, loading);
 document.body.append(dialog);
 dialog.addEventListener('keydown', e => e.stopPropagation());
 close.onclick = () => { if (!busy) dialog.close(); };
 dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });

 let history = [], busy = false;
 const line = (role, text) => {
  const row = el('div'); row.className = 'nb-line nb-' + role;
  row.append(el('strong', role === 'user' ? '나' : 'AI'), el('div', text));
  talk.append(row); talk.scrollTop = talk.scrollHeight;
 };
 const site = () => siteLimits(studio.context.getMiribodaInfo?.());
 const busyState = (on, label = 'AI 자동설계 중') => {
  busy = on; close.disabled = on; dialog.classList.toggle('is-busy', on); loading.hidden = !on;
  loading.querySelector('strong').textContent = label;
  // 아파트가 아직 계산 중이면 [자동 설계]는 계속 막아 둔다(같은 대지에 두 번 접수 방지).
  for (const control of dialog.querySelectorAll('button,input,select,textarea')) if (control !== close) control.disabled = on || (control === begin && aptRunning);
 };
 const saveState = () => store({ ...load(), brief: { address: address.value.trim(), requirements: '' }, talk: history.slice(-40) });
 const showDrawingAndChat = message => {
  dialog.close();
  requestAnimationFrame(() => studio.context.fit?.());
  const aiToggle = document.getElementById('ai-sidebar-toggle');
  if (aiToggle && aiToggle.getAttribute('aria-expanded') !== 'true') aiToggle.click();
  toast(message || '도면을 그렸습니다. 오른쪽 AI 대화에서 계속 수정할 수 있습니다.');
 };

 function renderPlans(text, message = '') {
  const { options, recommended } = designOptions(text);
  proposal.hidden = true; planCards.replaceChildren();
  const shown = options.length ? options : (text ? [{ key: '제안 그대로', summary: text, line: text }] : []);
  for (const [index, option] of shown.entries()) {
   const card = el('button'); card.type = 'button'; card.className = 'nb-plan-card'; card.dataset.value = option.key; card.setAttribute('role', 'radio');
   const title = el('strong', option.key || ((index + 1) + '안')); const summary = el('span', option.summary || option.line || '');
   card.append(title, summary); card.onclick = () => selectPlan(option.key); planCards.append(card);
  }
  const selectPlan = value => { choice.value = value; for (const card of planCards.children) { const selected = card.dataset.value === value; card.classList.toggle('selected', selected); card.setAttribute('aria-checked', String(selected)); } };
  selectPlan((recommended && shown.some(item => item.key === recommended)) ? recommended : shown[0]?.key || '');
  step.hidden = true;
  note.textContent = message || (recommended ? '추천안(' + recommended + ')을 골라 두었습니다. 다른 안으로 바꿔도 됩니다.' : '');
 }
 function show() {
  const data = load();
  address.value = data.brief?.address || studio.context.getMiribodaInfo?.()?.address || '';
  history = Array.isArray(data.talk) ? data.talk : [];
  talk.replaceChildren();
  for (const item of history) line(item.role, item.text);
  limits.textContent = limitsLine(site());
  renderPlans(data.proposal, '');
 }

 /** 대지를 가져온다. 이미 있으면 그대로 쓴다. */
 async function ensureSite(query) {
  if (studio.context.hasSite?.()) return true;
  if (!studio.context.importSite) throw Error('대지 가져오기를 쓸 수 없습니다. 앱을 다시 시작해 주세요.');
  limits.textContent = '대지를 조회하고 있습니다…';
  const message = await studio.context.importSite(query);
  limits.textContent = message;
  return !!studio.context.hasSite?.();
 }

 begin.onclick = async () => {
  if (busy) return;
  const query = address.value.trim();
  if (!query) { limits.textContent = '대지 주소를 적어 주세요.'; return; }
  busyState(true, '대지와 계획안 만드는 중');
  try {
   // 설계는 새 도면에서 한다. 대지도 그 도면에 넣어야 안에 건물을 앉힐 수 있다.
   if (!studio.context.hasSite?.()) {
    if (!studio.context.newDrawingTab) throw Error('새 도면 탭을 열 수 없습니다. 앱을 다시 시작해 주세요.');
    studio.context.newDrawingTab('계획안 · ' + query);
    // 탭 전환 이벤트가 새 도면의 빈 상태를 불러오더라도 이번 실행 주소는 유지한다.
    address.value = query;
    saveState();
   }
   const ready = await ensureSite(query);
   const found = site();
   limits.textContent = limitsLine(found);
   if (!ready) { note.textContent = '대지 경계를 도면에 넣지 못했습니다. 열린 창에서 지번을 고른 뒤 다시 눌러 주세요.'; busyState(false); return; }
   // 대지 확인 뒤 설계엔진이 서로 다른 3안(용적률·건축면적·효율)을 만들고 곧바로 도면에 넣는다.
   const proposal = '설계엔진 추천 계획안 3개';
   store({ ...load(), brief: { address: query, requirements: '' }, proposal }, key());
   busyState(false);
   executePlans(true);
  } catch (error) { busyState(false); note.textContent = error.message; limits.textContent = limitsLine(site()); }
 };

 const selectedConditions = () => [floors, parking, bedrooms, direction]
  .filter(select => select.value).map(select => select.dataset.condition + ' ' + select.value)
  .concat(changes.value.trim() ? [changes.value.trim()] : []).join(', ');

 function executePlans(all) {
  if (busy) return;
  const saved = load();
  if (!saved.proposal) { note.textContent = '먼저 계획안을 만드세요.'; return; }
  try {
   const query = address.value.trim();
   const { options } = designOptions(saved.proposal);
   const chosen = options.find(option => option.key === choice.value);
   const found = site();
   const planText = all && options.length
    ? options.map(option => option.line).join('\n')
    : (chosen ? chosen.line : saved.proposal);
   const extra = selectedConditions() + (all ? '\n1안·2안·3안을 서로 겹치지 않게 가로로 나란히 배치하고 각 안의 제목을 표시하세요.' : '');
   busyState(true, 'AI가 도면을 그리는 중'); note.textContent = '도면을 그리고 있습니다…';
   const beforeDrawing = studio.context.actionSnapshot?.();
   const where = key();
   const drawnName = all ? '1·2·3안' : (chosen?.key || '제안 그대로');
   store({ ...saved, talk: history.slice(-40), drawnPlan: drawnName, drawnAt: new Date().toISOString() }, where);
   if (all) {
    // 3안: 설계엔진 추천 계획안(법규 검토 포함)을 대지 옆에 나란히 그린다. 계획 탭과 같은 계산이다.
    if (!studio.context.drawRecommendedPlans) throw Error('계획 탭을 쓸 수 없습니다. 앱을 다시 시작해 주세요.');
    busyState(true, '설계엔진이 계획안 3개를 만드는 중'); note.textContent = '설계엔진이 계획안을 만들고 있습니다(안마다 약 10초)…';
    // 아파트는 서버에 먼저 접수해 같이 계산하고, 도면에는 소규모 3안을 다 그린 뒤에 그린다(ready).
    let smallDrawn; const ready = new Promise(resolve => { smallDrawn = resolve; });
    const withApartment = aptOn.checked && !!studio.context.apartmentQuickReview;
    results.hidden = false; smallSec.sub.textContent = '계산 중'; smallSec.body.replaceChildren();
    aptSec.box.hidden = !withApartment; openApt.hidden = !withApartment;
    if (withApartment) startApartment(ready, where);
    studio.context.drawRecommendedPlans({ onProgress: message => { note.textContent = message; } }).then(placed => {
     busyState(false); smallDrawn();
     store({ ...load(), proposal: placed.map(plan => `${plan.title}: ${plan.summary}`).join('\n'), drawnPlan: placed.map(plan => plan.title).join(' · '), drawnAt: new Date().toISOString() }, where);
     renderSmall(placed);
     const text = `설계엔진 계획안 ${placed.length}개를 도면에 그렸습니다(법규 검토 포함, Ctrl+Z 한 번으로 되돌림). 오른쪽 AI 대화에서 계속 수정할 수 있습니다.`;
     if (where !== key()) toast('이전 도면에 계획안을 그렸습니다.');
     else if (!withApartment) showDrawingAndChat(text);
     else note.textContent = '소규모 3안을 그렸습니다. 아파트 안은 계산이 끝나면 이어서 그립니다(창을 닫아도 계속됩니다).';
    }).catch(error => { busyState(false); smallDrawn(); smallSec.sub.textContent = '실패'; note.textContent = error.message; });
    return;
   }
   const request = designDrawPrompt({ address: query, requirements: selectedConditions() }, planText, extra, { site: found });
   studio.context.requestDesign({request, label: '설계 작성 · ' + drawnName, mode: 'execute', instructions: DRAW_RULES,
    onComplete: outcome => { busyState(false); const changed = beforeDrawing !== studio.context.actionSnapshot?.();
     if (outcome.ok && changed) { showDrawingAndChat('도면을 그렸습니다. 오른쪽 AI 대화에서 계속 수정할 수 있습니다.'); return; }
     note.textContent = outcome.ok ? '도면 객체가 만들어지지 않았습니다. 다시 실행해 주세요.' : (outcome.error || '설계를 완료하지 못했습니다.');
    }});
  } catch (error) { busyState(false); note.textContent = error.message; }
 }
 draw.onclick = () => executePlans(false);
 drawAll.onclick = () => executePlans(true);

 function renderSmall(placed) {
  smallSec.sub.textContent = '도면에 그림';
  const cards = el('div'); cards.className = 'nb-cards nb-c3';
  for (const plan of placed) { const card = el('div'); card.className = 'nb-card'; card.append(el('strong', plan.title), el('span', plan.summary || '')); cards.append(card); }
  smallSec.body.replaceChildren(cards);
 }
 function renderApartment(state) {
  const view = apartmentView(state);
  const elapsed = Number(state?.elapsed_s);
  aptSec.sub.textContent = '배치 엔진 서버' + (Number.isFinite(elapsed) ? ' · ' + Math.round(elapsed) + '초' : '');
  if (view.blocked) { const bad = el('div'); bad.className = 'nb-apt-blocked'; bad.textContent = view.blocked; aptSec.body.replaceChildren(bad); return; }
  if (view.steps) {
   const steps = el('div'); steps.className = 'nb-apt-steps';
   for (const step of view.steps) { const row = el('div'); row.className = 'nb-apt-step is-' + step.state; row.append(el('span', step.state === 'done' ? '✓' : step.state === 'now' ? '▶' : '·'), el('span', step.label), el('span', step.text)); steps.append(row); }
   aptSec.body.replaceChildren(steps); return;
  }
  const cards = el('div'); cards.className = 'nb-cards nb-c2';
  for (const card of view.cards) {
   const box = el('div'); box.className = 'nb-card';
   const big = el('div'); big.className = 'nb-big'; big.append(card.big, ' ', el('small', card.cap ? '/ ' + card.cap : ''));
   const tag = el('span', card.ok ? '일조·인동 통과' : '검사 확인 필요'); tag.className = 'nb-tag ' + (card.ok ? 'ok' : 'warn');
   box.append(el('strong', card.title), big, el('span', card.meta), tag); cards.append(box);
  }
  aptSec.body.replaceChildren(cards);
 }
 let aptRunning = false;
 function startApartment(ready, where) {
  aptRunning = true; begin.disabled = true;
  renderApartment({ status: 'queued', done: [] });
  studio.context.apartmentQuickReview({ ready, onProgress: state => { if (where === key()) renderApartment(state); } }).then(result => {
   aptRunning = false; begin.disabled = busy;
   if (where === key()) { renderApartment(result); if (!busy) note.textContent = ''; }
   const count = result.plans.filter(plan => plan.status !== '불가').length;
   if (result.status === 'done' && count) toast(`아파트 계획안 ${count}개를 '아파트-검토' 레이어에 그렸습니다.`);
   else toast('아파트 계획: ' + (apartmentView(result).blocked || '결과 없음'), true);
  });
 }
 openApt.onclick = () => { dialog.close(); studio.context.apartmentOpen?.(); };
 viewDrawing.onclick = () => showDrawingAndChat(aptRunning ? '아파트 안은 계산이 끝나면 이어서 그립니다.' : '');

 send.onclick = () => {
  if (busy) return;
  const message = say.value.trim();
  if (!message) { note.textContent = '하실 말씀을 적어 주세요.'; return; }
  try {
   const saved = load();
   // 말로 "그려 줘" 하면 그려야 한다. 대화칸이라고 "검토 모드라 못 한다"고 답하면 막다른 길이다.
   const drawing = wantsDrawing(message) && studio.context.hasSite?.();
   const request = drawing
    ? designDrawPrompt({ address: address.value.trim() }, saved.proposal || message, message, { site: site() })
    : newBuildTalkPrompt(site(), history, message);
   const beforeDrawing = drawing ? studio.context.actionSnapshot?.() : null;
   busyState(true, drawing ? 'AI가 도면을 그리는 중' : 'AI가 계획을 검토하는 중'); note.textContent = drawing ? '도면을 그리고 있습니다…' : 'AI가 생각하고 있습니다…';
   line('user', message); history.push({ role: 'user', text: message }); say.value = '';
   studio.context.requestDesign({
    request, label: '신축설계 · ' + message.slice(0, 30), mode: drawing ? 'execute' : 'review',
    instructions: drawing ? DRAW_RULES : '',
    onComplete: outcome => {
     busyState(false);
     if (!outcome.ok) { note.textContent = outcome.error || 'AI 답을 받지 못했습니다.'; return; }
     if (drawing) {
      if (!beforeDrawing || beforeDrawing !== studio.context.actionSnapshot?.()) showDrawingAndChat();
      else note.textContent = '도면 객체가 만들어지지 않았습니다. 다시 실행해 주세요.';
      return;
     }
     line('ai', outcome.text); history.push({ role: 'ai', text: outcome.text }); note.textContent = ''; saveState();
    },
   });
  } catch (error) { busyState(false); note.textContent = error.message; }
 };
 say.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); } });
 address.addEventListener('input', saveState);
 // 자동 설계 도중 새 탭을 만들 때 show()가 입력과 진행 상태를 초기화하면 작도가 끊긴다.
 window.addEventListener('cad-document-switched', () => { if (dialog.open && !busy) show(); });

 const open = () => { if (!dialog.open) dialog.showModal(); show(); address.focus(); };
 studio.handlers.NEWBUILD = open;
 return { open };
}
