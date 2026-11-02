// 기능군 숫자 메뉴판(훈민캐드 대조 기반 H06 · 훈민 W/WW/WWW, AutoCAD 도구 팔레트).
// 단축키(기본 `) 또는 QMENU 로 띄워 [1 레이어] [2 색·선] … 을 숫자나 클릭으로 고르고, 다시 숫자로 명령을 실행한다.
// 메뉴판에서 실행한 최근 명령은 맨 위 "최근" 줄에 모인다. 명령 목록은 실제로 있는 명령만 보여 준다.
export const QUICK_MENU_GROUPS = Object.freeze([
 {key: 'layer', label: '레이어', commands: ['LAYER', 'LAYMCUR', 'LAYISO', 'LAYOFF', 'LAYON', 'LAYLOCK', 'LAYUNLOCK', 'LAYMERGE', 'LAYRENAME']},
 {key: 'property', label: '색·선', commands: ['CHPROP', 'CECOLOR', 'CELTYPE', 'SETBYLAYER', 'LINETYPE', 'MATCHPROP', 'DENSITY', 'PROPERTIES']},
 {key: 'text', label: '문자', commands: ['TEXT', 'TEXTEDIT', 'STYLE', 'SCALETEXT', 'TITLE']},
 {key: 'dimension', label: '치수', commands: ['DIMSMART', 'DIMLINEAR', 'DIMALIGNED', 'DIMSEQ', 'DIMCHAIN', 'QUICKDIM', 'DIMRADIUS', 'DIMDIAMETER', 'DIMARC', 'DIMJOGGED', 'DIMORDINATE', 'DIMBREAK', 'DIMSTYLE', 'LEADER', 'MLEADER']},
 {key: 'hatch', label: '해치', commands: ['HATCH', 'HATCHEDIT']},
 {key: 'architecture', label: '건축', commands: ['WALL', 'DOOR', 'WINDOW', 'STAIR', 'COL', 'GRIDLINE', 'GRIDBUBBLE', 'ARCHLIB', 'BLOCKLIB', 'DETAIL']},
 {key: 'sheet', label: '도곽·출력', commands: ['SHEET', 'SHEETEDIT', 'ANNOSCALE', 'PLOT', 'PDF']},
 {key: 'help', label: '도움말', commands: ['HELP', 'SETTINGS']},
]);
export const QUICK_MENU_RECENT_KEY = 'barun-qmenu-recent';
const MAX_RECENT = 9;

export function readRecent(storage) {
 try { const list = JSON.parse(storage?.getItem(QUICK_MENU_RECENT_KEY) || '[]'); return Array.isArray(list) ? list.filter(n => typeof n === 'string').slice(0, MAX_RECENT) : []; } catch { return []; }
}
export function recordRecent(storage, name) {
 const list = [name, ...readRecent(storage).filter(n => n !== name)].slice(0, MAX_RECENT);
 try { storage?.setItem(QUICK_MENU_RECENT_KEY, JSON.stringify(list)); } catch {}
 return list;
}

/** 있는 명령만 남긴 메뉴판 모델. known: 명령 이름 Set, labelOf: 이름 → 설명. */
export function quickMenuModel(known, labelOf = (n) => n, recent = []) {
 const item = (name) => ({name, label: labelOf(name) || name});
 const groups = QUICK_MENU_GROUPS.map(g => ({key: g.key, label: g.label, items: g.commands.filter(n => known.has(n)).map(item)})).filter(g => g.items.length);
 const recentItems = recent.filter(n => known.has(n)).slice(0, 9).map(item);
 return {groups: recentItems.length ? [{key: 'recent', label: '최근', items: recentItems}, ...groups] : groups};
}

/**
 * 메뉴판 DOM. 숫자 1~9 로 묶음 → 명령, Backspace 로 뒤로, Esc 로 닫기. onRun(name) 은 닫은 뒤 부른다.
 * 반환: {element, close}.
 */
export function openQuickMenu(doc, host, model, {onRun, onClose, anchor} = {}) {
 const root = doc.createElement('div');
 root.className = 'quick-menu';root.tabIndex = -1;root.setAttribute('role', 'dialog');root.setAttribute('aria-label', '기능군 메뉴판');
 let groupIndex = null, closed = false;
 const close = () => { if (closed) return;closed = true;root.remove();onClose?.(); };
 const choose = (name) => { close();onRun?.(name); };
 const button = (number, text, onClick, extra = '') => {   // number: 1~9 숫자키, '·' 는 클릭 전용
  const b = doc.createElement('button');b.type = 'button';b.className = 'quick-menu-item' + extra;
  const key = doc.createElement('b');key.textContent = String(number);
  const span = doc.createElement('span');span.textContent = text;
  b.append(key, span);b.addEventListener('click', onClick);return b;
 };
 const render = () => {
  root.replaceChildren();
  const head = doc.createElement('div');head.className = 'quick-menu-head';
  head.textContent = groupIndex === null ? '메뉴판 · 숫자로 묶음 선택 · Esc 닫기' : `${model.groups[groupIndex].label} · 숫자로 실행 · Backspace 뒤로`;
  const list = doc.createElement('div');list.className = 'quick-menu-list';
  if (groupIndex === null) model.groups.forEach((g, i) => list.append(button(i + 1, `${g.label} (${g.items.length})`, () => { groupIndex = i;render(); }, g.key === 'recent' ? ' recent' : '')));
  else model.groups[groupIndex].items.forEach((it, i) => list.append(button(i < 9 ? i + 1 : '·', `${it.name} · ${it.label}`, () => choose(it.name))));   // 10번째부터는 클릭으로
  root.append(head, list);
 };
 root.addEventListener('keydown', (event) => {
  event.stopPropagation();
  if (event.key === 'Escape') { event.preventDefault();close();return; }
  if (event.key === 'Backspace' && groupIndex !== null) { event.preventDefault();groupIndex = null;render();return; }
  const n = Number(event.key);
  if (Number.isInteger(n) && n >= 1 && n <= 9) {
   event.preventDefault();
   if (groupIndex === null) { if (model.groups[n - 1]) { groupIndex = n - 1;render(); } }
   else { const it = model.groups[groupIndex].items[n - 1];if (it) choose(it.name); }
  }
 });
 root.addEventListener('focusout', (event) => { if (!root.contains(event.relatedTarget)) setTimeout(() => { if (!root.contains(doc.activeElement)) close(); }, 0); });
 if (anchor) { root.style.left = `${Math.max(8, anchor.x)}px`;root.style.top = `${Math.max(8, anchor.y)}px`; }
 render();host.append(root);root.focus();
 return {element: root, close, keydown: (key) => root.dispatchEvent(new (doc.defaultView?.KeyboardEvent || Event)('keydown', {key, bubbles: true}))};
}
