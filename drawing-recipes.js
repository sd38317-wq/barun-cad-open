/* Checklist evaluation shared by Node and browser consumers.
 * Contract: model is an array or {elements: array of {kind,type,story}},
 * document has entities/layers/texts collections, and story is a canonical
 * string (for example "1F") or an object with id plus explicit boolean
 * classification flags. An object with no such flag is unknown; flags allow
 * multiple classifications. A string confirms only its own classification;
 * absence of another classification cannot be inferred from it.
 */

const isObject = value => value !== null && typeof value === 'object';

function valuesOf(value) {
  if (!value) return [];
  if (typeof value === 'string' || typeof value === 'number') return [value];
  if (Array.isArray(value)) return value;
  if (isObject(value)) return Object.entries(value).map(([name, item]) =>
    isObject(item) ? ({ name, ...item }) : ({ name, value: item }));
  return [];
}

function modelEntities(model) {
  if (!model) return [];
  if (Array.isArray(model)) return model;
  return valuesOf(model.elements ?? model.entities);
}

function modelIsKnown(model) {
  const collection = Array.isArray(model) ? model : model?.elements ?? model?.entities;
  return Array.isArray(collection) && collection.every(entity => isObject(entity) && typeof entity.kind === 'string');
}

function modelKinds(model, story) {
  let entities = modelEntities(model);
  const byId = new Map(entities.map(entity => [entity.id, entity]));
  const effectiveStory = (entity, seen = new Set()) => {
    if (entity?.story !== undefined) return entity.story;
    if (typeof entity?.host !== 'string' || seen.has(entity.host)) return undefined;
    seen.add(entity.host);
    return effectiveStory(byId.get(entity.host), seen);
  };
  if (story !== undefined && story !== null) {
    const storyId = typeof story === 'string' ? story : story.id;
    if (storyId) entities = entities.filter(entity => effectiveStory(entity) == null || effectiveStory(entity) === storyId);
  }
  const kinds = new Set(entities.map(entity => entity?.kind ?? entity?.type ?? entity?.entityType).filter(Boolean));
  return kinds;
}

function namesFrom(value) {
  return valuesOf(value).flatMap(item => typeof item === 'string' ? [item] : [item?.name, item?.id, item?.layer, item?.type].filter(Boolean).map(String));
}

function documentEntities(document) {
  const result = [];
  const seen = new Set();
  const stack = (document?.entities ?? []).slice();
  while (stack.length) {
    const entity = stack.pop();
    if (!isObject(entity) || seen.has(entity)) continue;
    seen.add(entity);
    result.push(entity);
    stack.push(...valuesOf(entity.entities));
    if (entity.sharedBlock) {
      const definition = document.sharedBlocks?.[entity.sharedBlock];
      stack.push(...valuesOf(definition?.entities));
    }
  }
  return result;
}

function hasLayer(document, layer) {
  const layers = document?.layers;
  return namesFrom(layers).some(name => name === layer);
}

function hasEntityType(document, type) {
  const entities = documentEntities(document);
  return entities.some(entity => (entity?.type ?? entity?.entityType ?? entity?.kind) === type);
}

function hasPlanField(document, field, value) {
  return documentEntities(document).some(entity => String(entity?.[field] ?? '') === value);
}

function hasText(document, expression) {
  let regex;
  try { regex = new RegExp(expression); } catch { return null; }
  const texts = [
    ...valuesOf(document?.texts),
    ...documentEntities(document).filter(entity => entity?.text !== undefined),
  ];
  return texts.some(item => regex.test(String(item?.text ?? item?.value ?? item)));
}

function storyMatches(story, expected) {
  if (story === expected) return true;
  if (typeof story === 'string') return story === expected;
  return Boolean(story && (story[expected] === true || [story.id, story.name, story.level, story.story, story.storey].includes(expected)));
}

function applicability(item, context) {
  const when = item.when ?? 'always';
  if (when === 'always') return { applicable: true };
  if (when === 'if-applicable') return { applicable: true, manual: true };
  if (isObject(when) && Array.isArray(when.model)) {
    if (!modelIsKnown(context.model)) return { applicable: true, manual: true };
    const kinds = modelKinds(context.model, context.story);
    return { applicable: when.model.some(kind => kinds.has(kind)), known: true };
  }
  if (isObject(when) && typeof when.story === 'string') {
    if (context.story === undefined || context.story === null) return { applicable: true, manual: true };
    if (isObject(context.story)) {
      if (Object.prototype.hasOwnProperty.call(context.story, when.story)) {
        return typeof context.story[when.story] === 'boolean'
          ? { applicable: context.story[when.story] }
          : { applicable: true, manual: true };
      }
      if (when.story === '1F') {
        if (context.story.index === 1 || storyMatches(context.story, '1F')) return { applicable: true };
        if (Number.isInteger(context.story.index)) return { applicable: false };
      }
      // An ID such as B1 alone says nothing about roof/lowest/parking classification.
      return { applicable: true, manual: true };
    }
    if (typeof context.story === 'string' && context.story === when.story) return { applicable: true };
    return { applicable: true, manual: true };
  }
  return { applicable: true, manual: true };
}

function evaluateAuto(auto, context) {
  if (!auto) return { status: 'manual', why: '자동 판정 키가 없어 사람이 확인해야 합니다.' };
  const match = /^(hasLayer|hasEntityType|modelHas|hasText|hasPlanRole|hasPlanStage|planCheck):(.+)$/.exec(auto);
  if (!match) return { status: 'manual', why: `지원하지 않는 자동 판정 키: ${auto}` };
  const [, operation, argument] = match;
  if (operation === 'planCheck') {
    const value = context.facts?.[argument];
    if (value === true) return {status: 'done', why: `생성 결과 ${argument}을(를) 확인했습니다.`};
    if (value === false) return {status: 'missing', why: `생성 결과에 ${argument}이(가) 없습니다.`};
    if (value === null) return {status: 'na', why: `${argument}은(는) 해당 층에 적용되지 않습니다.`};
    return {status: 'manual', why: `생성 결과에서 ${argument}을(를) 자동 확인할 수 없습니다.`};
  }
  let known = true;
  let result = false;
  if (operation === 'hasLayer' || operation === 'hasEntityType' || operation === 'hasText' || operation === 'hasPlanRole' || operation === 'hasPlanStage') {
    if (!context.document) return { status: 'manual', why: '문서 정보가 없어 자동 판정할 수 없습니다.' };
  }
  if (operation === 'hasLayer') result = hasLayer(context.document, argument);
  if (operation === 'hasEntityType') result = hasEntityType(context.document, argument);
  if (operation === 'hasText') {
    result = hasText(context.document, argument);
    if (result === null) return { status: 'manual', why: '문자 정규식이 올바르지 않습니다.' };
  }
  if (operation === 'hasPlanRole') result = hasPlanField(context.document, 'planRole', argument);
  if (operation === 'hasPlanStage') result = hasPlanField(context.document, 'planStage', argument);
  if (operation === 'modelHas') {
    known = modelIsKnown(context.model);
    result = known && modelKinds(context.model, context.story).has(argument);
  }
  if (!known) return { status: 'manual', why: '모델 정보가 없어 자동 판정할 수 없습니다.' };
  if (result) return { status: 'done', why: `${auto} 조건을 확인했습니다.` };
  if (operation === 'modelHas' && modelIsKnown(context.model)) return { status: 'na', why: `알려진 모델에 ${argument} 요소가 없습니다.` };
  return { status: 'missing', why: `${auto} 조건을 확인하지 못했습니다.` };
}

export function evaluateChecklist(recipe, { model, document, story, facts } = {}) {
  if (!recipe || !Array.isArray(recipe.checklist)) return [];
  const context = { model, document, story, facts };
  return recipe.checklist.map(item => {
    const applicable = applicability(item, context);
    if (!applicable.applicable) return { id: item.id, status: 'na', why: '현재 도면 조건에 해당하지 않습니다.' };
    if (applicable.manual) return { id: item.id, status: 'manual', why: '적용 조건을 자동으로 확정할 수 없어 사람이 확인해야 합니다.' };
    const result = evaluateAuto(item.auto, context);
    return { id: item.id, ...result };
  });
}

export const supportedChecklistAutoKeys = ['hasLayer:', 'hasEntityType:', 'modelHas:', 'hasText:', 'hasPlanRole:', 'hasPlanStage:', 'planCheck:'];

// 평면 한 장·축척 시험마다 다시 받지 않게 한 번만 읽는다(실패는 기억하지 않음)
const recipeCache = new Map();
export function loadDrawingRecipes(options = {}) {
  const key = options.url || '/drawing-knowledge.json';
  if (!recipeCache.has(key)) recipeCache.set(key, readDrawingRecipes(options).catch(error => {recipeCache.delete(key);throw error;}));
  return recipeCache.get(key);
}
async function readDrawingRecipes({url = '/drawing-knowledge.json', fetchImpl = globalThis.fetch} = {}) {
  const isNode = typeof process !== 'undefined' && !!process.versions?.node;
  if (!isNode && typeof fetchImpl === 'function') {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`drawing recipes load failed: ${response.status}`);
    const payload = await response.json();
    return payload.recipes ?? payload;
  }
  const fsModule='node:fs/promises', urlModule='node:url';
  const {readFile} = await import(fsModule);
  const {fileURLToPath} = await import(urlModule);
  const path = fileURLToPath(new URL('./rules/knowledge/drawing-recipes.json', import.meta.url));
  return JSON.parse(await readFile(path, 'utf8'));
}
