// 머리줄 [패드 연결] 묶음: 원래 단추를 숨기고, 원래 단추의 data 상태로 표시·배지를 만들고, 메뉴 누름을 원래 단추로 넘긴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installPadHub} from './pad-hub.js';

class FakeElement {
  constructor(tag, doc) {
    Object.assign(this, {tag, doc, children: [], parent: null, style: {}, dataset: {}, attributes: {}, hidden: false, textContent: '', listeners: {}, clicks: 0, offsetWidth: 200});
    const names = new Set();
    this.classList = {toggle: (n, on) => {(on ?? !names.has(n)) ? names.add(n) : names.delete(n);}, contains: n => names.has(n)};
    Object.defineProperty(this, 'className', {get: () => [...names].join(' '), set: v => {names.clear(); String(v).split(/\s+/).filter(Boolean).forEach(n => names.add(n));}});
  }
  append(...nodes) {for (const n of nodes) {n.parent = this; this.children.push(n);}}
  before(node) {const list = this.parent.children; node.parent = this.parent; list.splice(list.indexOf(this), 0, node);}
  setAttribute(k, v) {this.attributes[k] = String(v);}
  getAttribute(k) {return this.attributes[k] ?? null;}
  addEventListener(type, fn) {(this.listeners[type] ||= []).push(fn);}
  click() {this.clicks++; this.onclick?.();}
  focus() {}
  contains(node) {for (let n = node; n; n = n.parent) if (n === this) return true; return false;}
  getBoundingClientRect() {return {left: 100, bottom: 40};}
  all() {return this.children.flatMap(c => [c, ...c.all()]);}
  querySelector(selector) {
    const role = /data-pad-role="([^"]+)"/.exec(selector)?.[1];
    return this.all().find(e => e.tag === 'button' && (!role || e.dataset.padRole === role)) || null;
  }
}
function setup({roles = ['office', 'field', 'records', 'records-more']} = {}) {
  const doc = {listeners: {}, createElement: tag => new FakeElement(tag, doc), addEventListener(type, fn) {(this.listeners[type] ||= []).push(fn);}};
  doc.body = new FakeElement('body', doc);
  const actions = new FakeElement('div', doc); doc.body.append(actions);
  doc.querySelector = selector => selector === 'header .file-actions' ? actions : null;
  const originals = {};
  for (const role of roles) {const b = new FakeElement('button', doc); b.dataset.padRole = role; actions.append(b); originals[role] = b;}
  const observed = [];
  const win = {innerWidth: 1200, addEventListener() {}, MutationObserver: class {constructor(fn) {observed.push(fn);} observe() {}}};
  const hub = installPadHub({doc, win});
  const changed = () => observed.forEach(fn => fn());
  return {doc, actions, originals, hub, changed};
}

test('hides the three header buttons and shows one [패드 연결] with a menu', () => {
  const {originals, hub, actions} = setup();
  for (const b of Object.values(originals)) assert.equal(b.style.display, 'none');
  assert.equal(actions.children[0], hub.hub);
  assert.equal(hub.hub.children[0].textContent, '패드 연결');
  const labels = hub.menu.children.map(b => b.children[0]?.textContent ?? b.textContent);
  assert.deepEqual(labels, ['사무실에서 수정', '현장에서 수정', '기록 열기', '기록 창(핀 목록·답)']);
});

test('reads data state, not button wording: connected label and badge total', () => {
  const {originals, hub, changed} = setup();
  originals.office.dataset.padState = 'connected';
  originals.field.dataset.padCount = '3'; originals.records.dataset.padCount = '2';
  originals.field.textContent = '아무 글자'; changed();
  assert.equal(hub.hub.children[0].textContent, '패드 연결됨');
  assert.ok(hub.hub.classList.contains('connected'));
  const badge = hub.hub.children[1];
  assert.equal(badge.hidden, false); assert.equal(badge.textContent, '5');
  originals.field.dataset.padCount = '120'; changed(); assert.equal(badge.textContent, '99+');
  originals.field.dataset.padCount = '0'; originals.records.dataset.padCount = '0'; changed();
  assert.equal(badge.hidden, true); assert.equal(badge.textContent, '');
});

test('menu items click the original hidden buttons and close the menu', () => {
  const {originals, hub} = setup();
  hub.open(); assert.equal(hub.menu.hidden, false);
  hub.menu.children[1].click();
  assert.equal(originals.field.clicks, 1); assert.equal(hub.menu.hidden, true);
  hub.open(); hub.menu.children[3].click(); assert.equal(originals['records-more'].clicks, 1);
  hub.open(); hub.menu.listeners.keydown[0]({key: 'Escape', stopPropagation() {}}); assert.equal(hub.menu.hidden, true);
});

test('returns null when neither pad button exists', () => {
  assert.equal(setup({roles: []}).hub, null);
});
