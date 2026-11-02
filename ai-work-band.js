import {mountWaitStage} from './wait-stage.js';

// Only fixed labels and numeric aggregates may enter this surface. Never render
// a tool argument, result message, drawing name, path, identifier or error text.
export const TOOL_LABELS = Object.freeze({
  cad_get_document:'도면 읽는 중', cad_observation_head:'도면 상태 확인 중',
  cad_view_drawing:'도면 살펴보는 중', cad_select:'객체 고르는 중',
  cad_execute:'도면 고치는 중', cad_undo:'작업 되돌리는 중', cad_redo:'작업 다시 하는 중',
  cad_save:'도면 저장 중', cad_open_file:'도면 여는 중', cad_close_document:'도면 닫는 중',
  cad_preview:'변경 미리 보는 중', cad_validate:'도면 확인 중',
  cad_list_commands:'명령 찾는 중', cad_get_command:'명령 확인 중',
  cad_describe_command:'작도 설정 확인 중', cad_preview_command:'작도 미리 보는 중',
  cad_run_command:'작도하는 중', cad_ui_command:'화면 작업 중',
  cad_list_details:'상세 목록 읽는 중', cad_search_details:'상세 찾는 중',
  cad_get_detail:'상세 읽는 중', cad_insert_detail:'상세 넣는 중',
  cad_suggest_details:'맞는 상세 찾는 중', cad_generate_details:'상세 만드는 중',
  cad_generate_drawing:'도면 만드는 중', cad_get_drawing_sets:'도면 묶음 읽는 중',
  cad_design_reference:'설계 자료 확인 중', cad_get_drawing_knowledge:'작도 기준 확인 중',
  cad_search_design_cases:'설계 사례 찾는 중', cad_get_design_case:'설계 사례 읽는 중',
  cad_search_classified_drawings:'참고 도면 찾는 중', cad_get_classified_drawing:'참고 도면 읽는 중',
  cad_evaluate_drawing_evidence:'도면 근거 확인 중', cad_get_layer_usage:'레이어 확인 중',
  cad_search_units:'단위 세대 찾는 중', cad_get_unit:'단위 세대 읽는 중', cad_insert_unit:'단위 세대 넣는 중',
  cad_search_jutong:'주동 찾는 중', cad_get_jutong:'주동 읽는 중', cad_insert_jutong:'주동 넣는 중',
  cad_search_address:'주소 찾는 중', cad_get_parcel:'대지 읽는 중',
  cad_suggest_layout:'배치안 만드는 중', cad_validate_layout:'배치안 확인 중', cad_sunlight_report:'일조 보고서 만드는 중',
  cad_insert_layout:'배치안 넣는 중', cad_site_plan_from_drawing:'대지 배치 준비 중', cad_place_from_site_plan:'원본 배치도로 대지에 앉히는 중', cad_apartment_review:'아파트 검토 중',
  cad_get_pad_sketch:'스케치 읽는 중', cad_view_3d:'입체 모형 준비 중',
  cad_export_glb:'입체 모형 저장 중', cad_get_materials:'재료 확인 중', cad_energy_regions:'에너지 영역 읽는 중', cad_energy_plan:'에너지 도서 만드는 중', cad_recognize_drawing:'도면 인식 중', cad_get_recognition:'도면 인식 결과 읽는 중', cad_extension_review:'증축·대수선 판정 중', cad_set_materials:'재료 바꾸는 중',
  cad_sun_study:'일조 계산 중', cad_view_interior:'실내 살펴보는 중', cad_wind_check:'바람 하중 확인 중',
  cad_plot_pdf:'출력 준비 중', cad_delivery_check:'납품 도면 확인 중', cad_delivery_fix:'납품 도면 정리 중',
  cad_suggest_openings:'문과 창 위치 찾는 중', cad_check_daylight:'채광 확인 중', cad_read_foreign_plan:'남의 도면 읽는 중', cad_electrical_layout:'조명·전기 배치 계산 중', cad_apply_openings:'문과 창 넣는 중',
  cad_access_plan:'편의시설 배치 중', cad_set_floor_heights:'층 높이 설정 중',
  cad_set_model3d:'입체 모형 바꾸는 중', cad_push_pull:'입체 형상 바꾸는 중',
  cad_structure_generate:'구조 계획 중', cad_structure_get:'구조 읽는 중', cad_structure_review:'구조 검토 중',
  cad_structure_set_member:'구조 부재 바꾸는 중', cad_structure_drawings:'구조 도면 만드는 중',
  cad_structure_certificate:'구조 확인서 만드는 중', cad_structure_calc_report:'구조 계산서 만드는 중',
  cad_lisp_list:'리습 목록 읽는 중', cad_lisp_read:'리습 읽는 중', cad_lisp_save:'리습 저장 중',
  cad_lisp_load:'리습 불러오는 중', cad_lisp_run:'리습 실행 중'
});
const STAGES = Object.freeze({queued:'작업 준비', running:'도구 실행', waiting:'CAD 창 확인 대기',
  dispatch:'CAD에 전달', rendering:'도면 반영', completed:'완료', failed:'확인 필요'});
const CHANGE_LABELS = Object.freeze({
  cad_set_floor_heights:'AI가 층고를 바꿨습니다',
  cad_set_model3d:'AI가 입체 모형 설정을 바꿨습니다',
  cad_set_materials:'AI가 재료를 바꿨습니다',
  cad_undo:'AI가 되돌렸습니다', cad_redo:'AI가 다시 실행했습니다',
  cad_delivery_fix:'AI가 납품 도면을 정리했습니다'
});
// Fixed completion labels share the same safe surface as bridge/chat progress.
export function notifyAIChange(context, tool, id) {
  const label = CHANGE_LABELS[tool];
  if (!label) return;
  try {
    const band = context.aiWorkBand;
    if (band && band.consume([{id:id || crypto.randomUUID(),tool,phase:'completed',stage:'completed'}]) !== false) return;
  } catch { /* Presentation must not change the result of an edit. */ }
  try {context.toast?.(label);} catch { /* Optional presentation. */ }
}
let historyId = 0;
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000 ? value : null;
const labelFor = tool => TOOL_LABELS[String(tool || '').replace(/_bound$/, '')] || 'CAD 작업 중';

export function describeToolEvent(event, now = Date.now()) {
  if (!event || typeof event !== 'object' || event.tool === 'cad_get_job') return null;
  if (!['running','completed','failed'].includes(event.phase)) return null;
  const phase = event.phase, tool = String(event.tool || '').replace(/_bound$/, '');
  const label = phase === 'completed' && CHANGE_LABELS[tool] || labelFor(tool);
  const targetCount = integer(event.target?.ids_count);
  const count = integer(event.count ?? event.target?.entity_count);
  const target = targetCount !== null ? '대상 객체 ' + targetCount + '개' : event.target?.kind === 'window' ? '도면의 선택 영역' : event.target?.kind === 'selection' ? '선택 객체' : '현재 도면';
  const stage = STAGES[event.stage] || STAGES[phase];
  const detail = phase === 'completed' ? (count !== null ? '항목 ' + count + '개 확인' : '작업 완료') :
    phase === 'failed' ? '작업을 마치지 못했어요 · 도면을 확인해 주세요' : stage;
  const at = Number.isFinite(event.at_ms) ? Math.min(now, event.at_ms) : now;
  return {id:String(event.id || '').slice(0,200), phase, label, stage, target, detail,
    source:event.source === 'chat' ? 'chat' : 'mcp', requestEpoch:integer(event.request_epoch),
    startedAt:Number.isFinite(event.started_at_ms) ? Math.min(at,event.started_at_ms) : at,
    text:label + ' · ' + detail, at};
}

export function createAIWorkBand({viewport, enabled = () => true, now = Date.now, mount = mountWaitStage} = {}) {
  const active = new Map(), listeners = new Set(), recent = [], seen = new Map();
  let stage = null, ended = false, disposed = false;
  function remember(event) {
    recent.push(event); if (recent.length > 3) recent.shift();
  }
  function removeStage() { const old = stage; stage = null; ended = false; old?.destroy(); }
  function render() {
    const el = typeof viewport === 'function' ? viewport() : viewport;
    if (!enabled() || !el) { removeStage(); return false; }
    const event = [...active.values()].at(-1) || recent.at(-1);
    if (!event) return;
    if (ended) removeStage();
    if (!stage) {
      let current;
      current = mount(el, {kind:'work', title:'AI 작업 중', onDestroy:() => { if (stage === current) stage = null; }});
      stage = current;
      stage.element.classList.add('barun-ai-work-band');
      const document = el.ownerDocument;
      const history = document.createElement('ol');
      history.className = 'barun-ai-work-band__recent'; history.id = 'barun-ai-work-history-' + ++historyId;
      history.hidden = true; history.setAttribute('aria-label','최근 AI 작업 3개');
      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'barun-ai-work-band__toggle';
      toggle.setAttribute('aria-controls',history.id); toggle.setAttribute('aria-expanded','false');
      toggle.setAttribute('aria-label','최근 AI 작업 기록 펼치기');
      toggle.title = '최근 AI 작업 기록 펼치기';
      const state = document.createElement('span'); state.className = 'barun-ai-work-band__state';
      const caret = document.createElement('span'); caret.className = 'barun-ai-work-band__caret';
      caret.textContent = '⌄'; caret.setAttribute('aria-hidden','true');
      // Reuse the shared phase/clock nodes so visibility pausing and reveal handoff
      // stay in mountWaitStage. The hidden skip button must not nest in this button.
      stage.element.querySelector('.barun-wait-stage__skip').remove();
      toggle.appendChild(stage.element.querySelector('.barun-wait-stage__main'));
      toggle.appendChild(state);
      toggle.appendChild(stage.element.querySelector('.barun-wait-stage__info'));
      toggle.appendChild(caret);
      stage.element.querySelector('.barun-wait-stage__detail').hidden = true;
      stage.element.querySelector('.barun-wait-stage__note').hidden = true;
      stage.element.appendChild(toggle); stage.element.appendChild(history);
      // Let native Enter/Space activate the button before CAD shortcuts see them.
      toggle.addEventListener('keydown', event => event.stopPropagation());
      toggle.addEventListener('click', () => {
        history.hidden = !history.hidden;
        toggle.setAttribute('aria-expanded',String(!history.hidden));
        const label = '최근 AI 작업 기록 ' + (history.hidden ? '펼치기' : '접기');
        toggle.setAttribute('aria-label',label); toggle.title = label;
        caret.textContent = history.hidden ? '⌄' : '⌃';
      });
      if (!document.getElementById('barun-ai-work-style')) {
        const style = document.createElement('style'); style.id = 'barun-ai-work-style';
        style.textContent = [
          '.barun-ai-work-band{flex-direction:column;align-items:stretch;gap:0;width:max-content;max-height:max(44px,calc(20% - max(10px,env(safe-area-inset-top))));padding:0;overflow:hidden;background:var(--panel,#25292f)}',
          '.barun-ai-work-band .barun-ai-work-band__toggle{display:flex;align-items:center;gap:6px;flex-shrink:0;width:100%;height:42px;min-height:42px;margin:0;padding:0 10px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;white-space:nowrap;cursor:pointer}',
          '.barun-ai-work-band .barun-ai-work-band__toggle:focus-visible{outline:2px solid #9dcbe0;outline-offset:-3px}',
          '.barun-ai-work-band .barun-wait-stage__main{gap:6px;overflow:hidden}.barun-ai-work-band .barun-wait-stage__title::after{content:" ·"}',
          '.barun-ai-work-band .barun-wait-stage__phases{overflow:hidden}.barun-ai-work-band .barun-wait-stage__phase{min-width:0;overflow:hidden;text-overflow:ellipsis;padding:0;border:0;color:inherit}.barun-ai-work-band .barun-wait-stage__phase[data-state="done"]::before{content:none}',
          '.barun-ai-work-band__state{flex-shrink:0;color:#c3cdd1}.barun-ai-work-band__state::before,.barun-ai-work-band .barun-wait-stage__info::before{content:"·";margin-right:6px}',
          '.barun-ai-work-band .barun-wait-stage__info{flex-shrink:0;gap:0;margin-left:0}.barun-ai-work-band .barun-wait-stage__progress{display:none}',
          '.barun-ai-work-band__caret{margin-left:auto;color:#9dcbe0}.barun-ai-work-band__recent{min-height:0;overflow:auto;margin:0;padding:6px 10px;border-top:1px solid var(--border,#383f48);list-style:none;color:#c3cdd1;font-size:12px;line-height:18px}',
          '.barun-ai-work-band__recent li{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
          '.barun-ai-work-band[data-compact=true]{gap:0;padding:0}.barun-ai-work-band[data-compact=true] :is(.barun-wait-stage__title,.barun-ai-work-band__state,.barun-ai-work-band__caret){display:none}',
          '.barun-ai-work-band .barun-wait-stage__compact{overflow:hidden;text-overflow:ellipsis}',
          ':root[data-theme=ivory] .barun-ai-work-band{background:#f1ede6;color:#403c36}:root[data-theme=ivory] .barun-ai-work-band :is(.barun-wait-stage__compact,.barun-wait-stage__info,.barun-ai-work-band__state,.barun-ai-work-band__recent){color:#514b43}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
      }
    }
    stage.setPhases([{key:'tool',label:event.label}]);
    stage.push({phase:'tool', source:'engine', detail:event.target + ' · ' + event.detail + (active.size > 1 ? ' · 진행 중 ' + active.size + '개' : ''), elapsedMs:now()-event.startedAt});
    stage.element.querySelector('.barun-ai-work-band__state').textContent = event.stage;
    const history = stage.element.querySelector('.barun-ai-work-band__recent');
    history.replaceChildren(...recent.map(item => {const li=el.ownerDocument.createElement('li');li.textContent=item.text;return li;}));
    if (!active.size && !ended) { ended = true; stage.finish({title:event.phase === 'failed' ? '확인 필요' : event.phase === 'completed' ? 'AI 작업 완료' : '작업 상태 갱신', label:event.target + ' · ' + event.detail}); }
    // A different in-flight tool may own the visible row. Let local completion
    // callers fall back to a toast instead of hiding their notice in history.
    return event.id === recent.at(-1)?.id;
  }
  function consume(events, activeIds) {
    if (disposed || !Array.isArray(events) || (!events.length && !active.size) || (!listeners.size && !enabled())) return false;
    let changed = false;
    for (const raw of events.slice(-128)) {
      const event = describeToolEvent(raw, now()); if (!event || !event.id) continue;
      const signature = [event.phase,event.stage,event.detail].join('|');
      if (seen.get(event.id) === signature) continue;
      // A delayed start must never reopen an already completed operation.
      if (event.phase === 'running' && seen.get(event.id)?.startsWith('completed|')) continue;
      if (event.phase === 'running' && seen.get(event.id)?.startsWith('failed|')) continue;
      const prior = active.get(event.id);
      if (prior) event.startedAt = prior.startedAt;
      seen.delete(event.id); seen.set(event.id,signature); if (seen.size > 512) seen.delete(seen.keys().next().value);
      if (event.phase === 'running') { active.set(event.id,event); if (active.size > 64) active.delete(active.keys().next().value); }
      else active.delete(event.id);
      remember(event); changed = true;
      for (const listener of listeners) {try {listener(event);} catch { /* progress cannot affect a tool */ }}
    }
    if (Array.isArray(activeIds)) {
      const live = new Set(activeIds);
      for (const id of active.keys()) if (!live.has(id)) {active.delete(id); changed = true;}
    }
    if (changed) {try {return render();} catch {removeStage();return false;}}
    return !!stage;
  }
  return {consume, subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
    reset() {active.clear(); recent.length=0; seen.clear(); removeStage();},
    destroy() {disposed=true; active.clear(); recent.length=0; seen.clear(); listeners.clear(); removeStage();},
    snapshot:() => ({active:active.size, recent:recent.map(event=>event.text)})};
}

export function ensureAIWorkBand(studio) {
  return studio.context.aiWorkBand ||= createAIWorkBand({
    viewport:() => globalThis.document?.querySelector?.('.viewport'),
    enabled:() => {try {return globalThis.localStorage?.getItem('barun.aiWorkBand') !== '0';} catch {return true;}}
  });
}
