// 객체 속성 편집 창의 색 선택기(AutoCAD 색상 선택 창 모양).
// 색 칸(BYLAYER · BYBLOCK · 1~255 · #RRGGBB)은 그대로 두고, 그 값을 견본·표준 9색·전체 255색·트루컬러로 고르게 한다.
// 값은 항상 색 칸의 글자로만 오간다. 그래서 적용 경로(parseColor → colorChanges)는 그대로다.
import {aciColor} from './lisp-host.js';
import {parseColor, COLOR_NAMES} from './cad-properties.js';

export const STANDARD_ACI = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);

/** 색 칸에 적을 글자. 견본 하나가 어떤 값을 쓰는지의 단일 기준. */
export const colorInputText = (spec) => {
 if (!spec || spec.mode === 'bylayer') return 'BYLAYER';
 if (spec.mode === 'byblock') return 'BYBLOCK';
 if (spec.mode === 'aci') return String(spec.aci);
 return spec.color;
};

/** 색 칸 글자 → 화면에 그릴 색과 이름. 못 읽으면 null. */
export function describeColorText(text, layerColor = '#d8d8d8') {
 let spec;
 try { spec = parseColor(text); } catch { return null; }
 if (spec.mode === 'bylayer') return {css: layerColor, label: 'ByLayer (레이어 따름)'};
 if (spec.mode === 'byblock') return {css: '#9aa5ad', label: 'ByBlock (블록 따름)'};
 if (spec.mode === 'aci') return {css: spec.color, label: `${spec.aci}번${COLOR_NAMES[spec.aci] ? ' ' + COLOR_NAMES[spec.aci] : ''}`};
 return {css: spec.color, label: `트루컬러 ${spec.color}`};
}

/** 선택된 객체들의 색이 서로 다른가. text 는 객체 → 색 칸 글자. */
export function hasMixedColor(entities, text) {
 if (!entities?.length) return false;
 const first = text(entities[0]);
 return entities.some((e) => text(e) !== first);
}

/**
 * 색 칸이 바뀌었는지. 여러 객체가 서로 다른 색이면 칸이 비어 있고, 비어 있는 채로는 "그대로 유지"다.
 * 하나만 고른 경우 칸을 비우면 ByLayer 로 본다(기존 동작).
 */
export function colorFieldChanged(value, initial, mixed) {
 const now = String(value ?? '').trim();
 if (mixed && now === '') return false;
 return now !== initial;
}

/**
 * 색 칸 아래에 색 선택기를 붙인다.
 * @param input 색 칸 <input name=color>
 * @param opts  {layerColor, mixed}
 */
export function installColorPicker(input, {layerColor = '#d8d8d8', mixed = false, books = []} = {}) {
 const doc = input.ownerDocument;
 const make = (tag, cls, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
 const button = (cls, label, onClick, text = '') => {
  const b = make('button', cls, text);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('click', onClick);
  return b;
 };
 if (mixed) input.placeholder = '여러 값 (그대로 유지)';

 const root = make('div', 'color-picker');
 root.setAttribute('role', 'group');
 root.setAttribute('aria-label', '색 선택');
 const current = make('div', 'color-picker-current');
 const chip = make('span', 'color-picker-chip');
 chip.setAttribute('aria-hidden', 'true');
 const name = make('span', 'color-picker-name');
 name.setAttribute('aria-live', 'polite');
 current.append(make('span', 'color-picker-caption', '현재 색'), chip, name);

 const set = (text) => { input.value = text; input.dispatchEvent(new doc.defaultView.Event('input', {bubbles: true})); };
 const swatch = (aci) => {
  const b = button('color-swatch', `색 ${aci}번 ${COLOR_NAMES[aci] || ''}`.trim(), () => set(String(aci)));
  b.style.setProperty('background', aciColor(aci), 'important');
  b.dataset.aci = String(aci);
  return b;
 };

 const byRow = make('div', 'color-picker-row');
 byRow.append(
  button('color-by', 'ByLayer 레이어 색 따름', () => set('BYLAYER'), 'ByLayer'),
  button('color-by', 'ByBlock 블록 색 따름', () => set('BYBLOCK'), 'ByBlock'),
 );
 const trueColor = make('input', 'color-true');
 trueColor.type = 'color';
 trueColor.setAttribute('aria-label', '트루컬러 직접 고르기');
 trueColor.title = '트루컬러 직접 고르기';
 trueColor.addEventListener('input', () => set(trueColor.value.toLowerCase()));
 const trueWrap = make('label', 'color-true-wrap');
 trueWrap.append(make('span', '', '트루컬러'), trueColor);
 byRow.append(trueWrap);

 const standard = make('div', 'color-picker-standard');
 standard.setAttribute('role', 'group');
 standard.setAttribute('aria-label', '표준 색 1~9번');
 for (const aci of STANDARD_ACI) standard.append(swatch(aci));

 const all = make('div', 'color-picker-all');
 all.setAttribute('role', 'group');
 all.setAttribute('aria-label', '전체 색 1~255번');
 all.hidden = true;
 const toggle = button('color-more', '전체 색 1~255번 펼치기', () => {
  if (all.hidden && !all.childElementCount) for (let aci = 1; aci <= 255; aci++) all.append(swatch(aci));
  all.hidden = !all.hidden;
  toggle.setAttribute('aria-expanded', String(!all.hidden));
  toggle.textContent = all.hidden ? '전체 색 1~255 ▾' : '전체 색 1~255 ▴';
 }, '전체 색 1~255 ▾');
 toggle.setAttribute('aria-expanded', 'false');

 const sync = () => {
  const text = input.value.trim();
  chip.classList.remove('is-mixed', 'is-invalid');
  if (text === '' && mixed) { chip.style.removeProperty('background'); chip.classList.add('is-mixed'); name.textContent = '여러 값 (고르지 않으면 그대로)'; return; }
  const info = describeColorText(text, layerColor);
  if (!info) { chip.style.removeProperty('background'); chip.classList.add('is-invalid'); name.textContent = '읽을 수 없는 색'; return; }
  chip.style.setProperty('background', info.css, 'important');
  name.textContent = info.label;
  if (/^#[0-9a-f]{6}$/i.test(info.css)) trueColor.value = info.css;
  for (const b of root.querySelectorAll('.color-swatch[aria-pressed]')) b.removeAttribute('aria-pressed');
  if (/^\d{1,3}$/.test(text)) for (const b of root.querySelectorAll(`.color-swatch[data-aci="${Number(text)}"]`)) b.setAttribute('aria-pressed', 'true');
 };
 input.addEventListener('input', sync);
 byRow.prepend(current);
 const swatchRow = make('div', 'color-picker-row');
 swatchRow.append(standard, toggle);
 root.append(byRow, swatchRow, all);
 // ACAD200 721: 사용자 색 견본집(COLORBOOK 으로 불러온 CSV·.acb). 고르면 그 색(트루컬러)을 넣는다.
 if (Array.isArray(books) && books.length) {
  const bookRow = make('div', 'color-picker-row color-picker-books');
  const select = make('select', 'color-book-select');
  select.setAttribute('aria-label', '색 견본집에서 고르기');
  select.append(new doc.defaultView.Option('견본집 색 고르기…', ''));
  const groups = new Map();
  for (const c of books.slice(0, 2000)) { if (!groups.has(c.book)) { const g = make('optgroup'); g.label = c.book; groups.set(c.book, g); select.append(g); } groups.get(c.book).append(new doc.defaultView.Option(c.name + ' · ' + c.hex, c.hex)); }
  select.addEventListener('change', () => { if (select.value) set(select.value); });
  bookRow.append(make('span', 'color-picker-caption', '견본집'), select);
  root.append(bookRow);
 }
 const row = input.closest('.form-row');
 (row || input).after(root);
 sync();
 return root;
}
