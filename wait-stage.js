const STYLE_ID = 'barun-wait-stage-style';
const ACCENT = '#9dcbe0';
// A result reveal takes the same slot while tool work continues in the background.
const stagesByViewport = new WeakMap();

function installStyle(document) {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    '.barun-wait-stage{position:absolute;top:max(10px,env(safe-area-inset-top));left:50%;z-index:17;display:flex;align-items:center;gap:10px;min-height:44px;max-width:calc(100% - 20px);padding:5px 10px;box-sizing:border-box;border:1px solid rgba(157,203,224,.42);border-radius:5px;background:rgba(24,34,42,.94);color:#e9f0f3;font-family:inherit;font-size:12px;line-height:1.25;transform:translateX(-50%);box-shadow:0 2px 8px rgba(0,0,0,.18)}',
    '.barun-wait-stage[hidden],.barun-wait-stage [hidden]{display:none!important}.barun-wait-stage[data-compact=true]{gap:5px;padding:5px 7px;font-size:12px}.barun-wait-stage[data-compact=true] .barun-wait-stage__progress{display:none}.barun-wait-stage__main{display:flex;align-items:center;gap:8px;min-width:0}.barun-wait-stage__title{font-weight:600;color:'+ACCENT+';white-space:nowrap}.barun-wait-stage__phases{display:flex;gap:4px;min-width:0}.barun-wait-stage__phase{padding:3px 6px;border:1px solid rgba(220,230,235,.22);border-radius:3px;color:#aebbc1;white-space:nowrap}.barun-wait-stage__phase[data-state="current"]{border-color:'+ACCENT+';color:#fff}.barun-wait-stage__phase[data-state="done"]::before{content:"✓ ";color:'+ACCENT+'}.barun-wait-stage__compact{display:inline;color:#c3cdd1;white-space:nowrap}.barun-wait-stage__info{display:flex;gap:7px;margin-left:auto;white-space:nowrap;color:#c3cdd1;font-variant-numeric:tabular-nums}.barun-wait-stage__skip{border:0;padding:3px 0;background:transparent;color:'+ACCENT+';font:inherit;cursor:pointer;text-decoration:underline}.barun-wait-stage__detail{position:absolute;top:calc(100% + 4px);left:50%;max-width:min(520px,calc(100vw - 30px));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transform:translateX(-50%);color:#9faeb5;font-size:12px;pointer-events:none}.barun-wait-stage__note{position:absolute;top:calc(100% + 20px);left:50%;transform:translateX(-50%);color:#8d9aa1;font-size:12px;white-space:nowrap}.barun-wait-stage__progress{min-width:42px;text-align:right}'].join('');
  (document.head || document.documentElement).appendChild(style);
}

export function mountWaitStage(viewportElement, options = {}) {
  if (!viewportElement || !viewportElement.ownerDocument) {
    throw new TypeError('viewportElement is required');
  }
  const document = viewportElement.ownerDocument;
  installStyle(document);
  const element = document.createElement('div');
  element.className = 'barun-wait-stage';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.innerHTML = [
    '<div class="barun-wait-stage__main"><span class="barun-wait-stage__title">AI 제도 중</span>',
    '<div class="barun-wait-stage__phases"></div><span class="barun-wait-stage__compact"></span></div>',
    '<div class="barun-wait-stage__info"><span class="barun-wait-stage__elapsed">0.0초</span>',
    '<span class="barun-wait-stage__progress"></span><button class="barun-wait-stage__skip" type="button">클릭하면 바로 완성</button></div>',
    '<div class="barun-wait-stage__detail"></div>',
    '<div class="barun-wait-stage__note">그리는 순서·속도는 연출 · 도면 내용은 실제</div>'
  ].join('');
  const work = options.kind === 'work';
  element.dataset.kind = work ? 'work' : (options.kind || 'drafting');
  viewportElement.appendChild(element);

  const phasesElement = element.querySelector('.barun-wait-stage__phases');
  const compactElement = element.querySelector('.barun-wait-stage__compact');
  const elapsedElement = element.querySelector('.barun-wait-stage__elapsed');
  const progressElement = element.querySelector('.barun-wait-stage__progress');
  const detailElement = element.querySelector('.barun-wait-stage__detail');
  const skipElement = element.querySelector('.barun-wait-stage__skip');
  element.querySelector('.barun-wait-stage__title').textContent = options.title || 'AI 제도 중';
  element.querySelector('.barun-wait-stage__note').textContent = options.note || '그리는 순서·속도는 연출 · 도면 내용은 실제';
  if (options.skipLabel) skipElement.textContent = options.skipLabel;
  if (options.hideSkip) skipElement.hidden = true;
  let phases = [];
  let currentPhase = null;
  let startedAt = performance.now();
  let elapsedTimer = 0;
  let finishTimer = 0;
  let resizeObserver = null;
  let destroyed = false;
  let paused = Boolean(document.hidden);
  let covered = false;
  let finished = false;

  function renderCompact() {
    let available = viewportElement.clientWidth;
    const sidebar = document.getElementById('ai-history-panel');
    const view = viewportElement.getBoundingClientRect?.(), side = !sidebar?.hidden && sidebar?.getBoundingClientRect?.();
    // The conversation sidebar overlays the canvas; reserve its visible area.
    if (view && side && side.width > 0 && side.left > view.left && side.left < view.right) available = side.left - view.left;
    if (element.style) {element.style.left = available / 2 + 'px'; element.style.maxWidth = Math.max(0, available - 20) + 'px';}
    const narrow = available < (options.compactWidth || 720);
    const currentIndex = phases.findIndex((phase) => phase.key === currentPhase);
    phasesElement.hidden = narrow;element.dataset.compact=String(narrow);
    compactElement.hidden = !narrow;
    compactElement.textContent = narrow ? (currentIndex >= 0 ? (phases[currentIndex].label || phases[currentIndex].key || '') : '') + (work ? '' : ' ' + (currentIndex + 1) + '/' + phases.length) : '';
  }
  function updateElapsed() {
    if (!paused && !covered && !destroyed) elapsedElement.textContent = ((performance.now() - startedAt) / 1000).toFixed(1) + '초';
  }
  function startClock() { if (!elapsedTimer && !paused && !covered && !finished) elapsedTimer = setInterval(updateElapsed, 100); }
  function stopClock() { if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = 0; } }
  function onVisibilityChange() {
    paused = Boolean(document.hidden);
    if (paused) {
      stopClock();
      if (finished) api.destroy();
    } else {
      if (!options.wallClock && !work) startedAt = performance.now() - parseFloat(elapsedElement.textContent || '0') * 1000;
      startClock();
    }
  }
  function clearFinish() { if (finishTimer) clearTimeout(finishTimer); finishTimer = 0; }
  function armFinish(delay) { finishTimer = setTimeout(() => api.destroy(), delay); }
  let api;
  const skip = () => options.onSkip ? options.onSkip() : api.finish({ label: '완료' });
  api = {
    element,
    setPhases(list) {
      phases = Array.isArray(list) ? list.slice() : [];
      if (!currentPhase && phases.length) currentPhase = phases[0].key;
      phasesElement.replaceChildren(...phases.map((phase) => { const node = document.createElement('span'); node.className = 'barun-wait-stage__phase'; node.textContent = phase.label || phase.key || ''; node.dataset.key = phase.key || ''; return node; }));
      renderCompact();
    },
    push(item = {}) {
      currentPhase = item.phase || currentPhase;
      const currentIndex = phases.findIndex((phase) => phase.key === currentPhase);
      [...phasesElement.children].forEach((node, index) => { node.dataset.state = index === currentIndex ? 'current' : (item.completed ? (item.completed.includes(phases[index].key) ? 'done' : '') : (currentIndex >= 0 && index < currentIndex ? 'done' : '')); });
      const phase = phases[currentIndex];
      if (phase && phase.label) element.querySelector('.barun-wait-stage__title').textContent = options.title || 'AI 제도 중';
      if (work && Number.isFinite(item.elapsedMs)) startedAt = performance.now() - Math.max(0, item.elapsedMs);
      if (work) updateElapsed();
      if (item.label || item.detail) detailElement.textContent = item.detail || item.label;
      element.dataset.source = item.source || 'presentation';
      renderCompact();
    },
    setProgress(done, total) {
      progressElement.textContent = total == null ? '' : (total ? Math.round(Math.max(0, Math.min(1, done / total)) * 100) + '%' : '100%');
    },
    finish(info = {}) {
      if (destroyed) return;
      detailElement.textContent = info.label || '완료';
      element.querySelector('.barun-wait-stage__title').textContent = info.title || info.label || '완료';
      [...phasesElement.children].forEach(node => {node.dataset.state = 'done';});
      skipElement.hidden = true;stopClock();
      clearFinish();
      finished = true;
      if (document.hidden) api.destroy();else armFinish(1600);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; stopClock(); clearFinish();
      if (resizeObserver) resizeObserver.disconnect();
      skipElement.removeEventListener('click', skip);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      element.remove();
      const remaining = (stagesByViewport.get(viewportElement) || []).filter(entry => entry.api !== api);
      stagesByViewport.set(viewportElement, remaining);
      remaining.forEach(entry => entry.sync(remaining));
      options.onDestroy?.();
    }
  };
  skipElement.addEventListener('click', skip);
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(renderCompact); resizeObserver.observe(viewportElement); const sidebar = document.getElementById('ai-history-panel'); if (sidebar) resizeObserver.observe(sidebar); }
  if (options.title) element.querySelector('.barun-wait-stage__title').textContent = options.title;
  if (work) {
    skipElement.hidden = true;
    element.querySelector('.barun-wait-stage__note').textContent = '실제 도구 작업';
  }
  const entry = {api, work, sync(entries) {
    const owner = [...entries].reverse().find(item => !item.work) || entries.at(-1);
    covered = owner !== entry; element.hidden = covered;
    if (covered) stopClock(); else { updateElapsed(); startClock(); }
  }};
  const entries = [...(stagesByViewport.get(viewportElement) || []), entry];
  stagesByViewport.set(viewportElement, entries);
  renderCompact(); entries.forEach(item => item.sync(entries));
  return api;
}
