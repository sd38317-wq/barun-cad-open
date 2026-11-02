import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { evaluateChecklist, supportedChecklistAutoKeys } from './drawing-recipes.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const data = JSON.parse(read('./rules/knowledge/drawing-recipes.json'));
const schema = JSON.parse(read('./rules/knowledge/drawing-recipes.schema.json'));
const standard = JSON.parse(read('./rules/knowledge/drawing-standard.json').replace(/^\uFEFF/, ''));
standard.sheetTemplates = JSON.parse(read('./rules/knowledge/sheet-templates.json'));   // 한 벌 템플릿은 도면 기준에 붙어 온다(vault_gate, 2026-10-25)
const main = read('./docs/표준도면_구성목록_2026-10-23.md');
const site = read('./docs/배치도_구성정리_2026-10-23.md');
const sections = new Map([...main.matchAll(/^## (\d[^\r\n]*)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)]
  .map(([, heading, body]) => [heading.split(' ')[0], { name: heading.slice(heading.indexOf(' ') + 1), body }]));
const checklist = text => [...text.matchAll(/^- \[ \] (.*)\r?$/gm)].map(match => match[1].replace(/\r$/, ''));
const list = (body, heading, prefix) => {
  const section = new RegExp(`^#{2,3} ${heading}[^\\r\\n]*\\r?\\n([\\s\\S]*?)(?=^#{2,3} |$(?![\\s\\S]))`, 'm').exec(body);
  assert.ok(section, heading);
  return [...section[1].matchAll(prefix)].map(match => match[1].replace(/\r$/, ''));
};
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

test('data satisfies schema; schema rejects malformed checks, conditions, scales and extras', () => {
  assert.ok(validate(data), JSON.stringify(validate.errors));
  for (const mutate of [
    d => { d.recipes[0].checklist[0].auto = 'typo:wall'; },
    d => { d.recipes[0].checklist[0].when = { story: '2F' }; },
    d => { d.recipes[0].checklist[0].when = { model: ['ramp'] }; },
    d => { d.recipes[0].checklist[0].fromShape = 'true'; },
    d => { d.recipes[0].scales.A1 = '1/0'; },
    d => { d.recipes[0].steps[0].unknown = true; },
    d => { d.common.pop(); },
  ]) {
    const changed = structuredClone(data);
    mutate(changed);
    assert.equal(validate(changed), false);
  }
});

test('all 22 sheets preserve exact checklist labels, count, reviews, drafting and scales', () => {
  assert.equal(data.recipes.length, 22);
  assert.deepEqual(data.recipes.map(r => r.sheetNo), [...sections.keys()]);
  for (const recipe of data.recipes) {
    const body = recipe.sheetNo === '05' ? site : sections.get(recipe.sheetNo).body;
    assert.equal(recipe.name, sections.get(recipe.sheetNo).name);
    assert.deepEqual(recipe.checklist.map(c => c.label), checklist(body), recipe.sheetNo);
    assert.deepEqual(recipe.review, list(body, '(?:3\\. )?검토 사항', /^- (.*)\r?$/gm), recipe.sheetNo);
    assert.deepEqual(recipe.drafting, list(body, '(?:1\\. 도면 )?작성 방법', /^\d+\. (.*)\r?$/gm), recipe.sheetNo);
    for (const paper of ['A1', 'A3']) {
      assert.equal(recipe.scales[paper], new RegExp(`${paper} (1/\\d+)`).exec(body)[1]);
    }
    for (const item of recipe.checklist) assert.equal(item.fromShape, item.label.includes('(도형에서)'));
  }
  assert.deepEqual(data.common, [...main.split('## 공통 규칙(여러 장에 반복)')[1].matchAll(/^\d+\. (.*)\r?$/gm)].map(m => m[1].replace(/\r$/, '')));
  assert.equal(data.recipes.reduce((n, r) => n + r.checklist.length, 0), checklist(main).length + checklist(site).length);
});

test('every check belongs to exactly one step and IDs are unique', () => {
  const globalIds = [];
  assert.equal(new Set(data.recipes.map(r => r.id)).size, data.recipes.length);
  for (const r of data.recipes) {
    const checks = r.checklist.map(c => c.id);
    const assigned = r.steps.flatMap(s => s.checks);
    assert.equal(new Set(r.steps.map(s => s.id)).size, r.steps.length, r.id);
    assert.equal(new Set(checks).size, checks.length, r.id);
    assert.equal(assigned.length, checks.length, r.id);
    assert.equal(new Set(assigned).size, assigned.length, r.id);
    assert.deepEqual([...assigned].sort(), [...checks].sort(), r.id);
    globalIds.push(...checks);
  }
  assert.equal(new Set(globalIds).size, globalIds.length);
});

test('plan follows actual planOrder and every standard reference resolves', () => {
  const plan = data.recipes.find(r => r.id === 'plan');
  assert.deepEqual(plan.steps.map(s => s.name), standard.planOrder.steps);
  assert.deepEqual(plan.steps.map(s => s.id), standard.plan.standardPlan.sequence);
  for (const r of data.recipes) {
    for (const ref of [...r.standardRef, ...r.steps.flatMap(s => s.uses)]) {
      assert.notEqual(ref.split('.').reduce((v, key) => v?.[key], standard), undefined, `${r.id}: ${ref}`);
    }
    for (const c of r.checklist.filter(c => c.auto)) {
      assert.ok(supportedChecklistAutoKeys.some(prefix => c.auto.startsWith(prefix)), c.id);
      if (c.auto.startsWith('hasText:')) assert.doesNotThrow(() => new RegExp(c.auto.slice(8)));
    }
  }
});

test('real recipes retain unknown/compound conditions and evaluate simple table labels', () => {
  const materials = data.recipes.find(r => r.id === 'material-schedule');
  const results = evaluateChecklist(materials, { document: { entities: [{ type: 'text', text: '구분' }] } });
  assert.equal(results[0].status, 'done');
  assert.equal(results[1].status, 'missing');
  assert.equal(results[7].status, 'manual');
  const plan = data.recipes.find(r => r.id === 'plan');
  const result = evaluateChecklist(plan, { model: { elements: [] }, story: '1F' });
  assert.equal(result.find(c => c.id === 'plan-11').status, 'na');
  assert.equal(result.find(c => c.id === 'plan-35').status, 'manual');
  assert.equal(result.find(c => c.id === 'plan-38').status, 'manual');
  assert.equal(plan.checklist.find(c => c.id === 'plan-42').when, 'always');
  assert.equal(data.recipes.find(r => r.id === 'site').checklist.find(c => c.id === 'site-03').when, 'if-applicable');
});

test('all new deliverables use LF without BOM', () => {
  for (const path of ['./rules/knowledge/drawing-recipes.json', './rules/knowledge/drawing-recipes.schema.json', './drawing-recipes.js', './drawing-recipes.test.js', './drawing-recipes-evaluator.test.js']) {
    const text = read(path);
    assert.equal(text.includes('\r'), false, path);
    assert.equal(text.startsWith('\uFEFF'), false, path);
  }
});
