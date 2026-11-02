import {bounds} from './geometry.js';
// Pure, on-demand search and recommendation helpers. No drawing-loop subscriptions.
export const DETAIL_GROUPS = Object.freeze(['wall', 'window', 'floor', 'roof', 'stair', 'fire', 'parking', 'access', 'interior', 'steel', 'jutong', 'unit']);
export const DETAIL_GROUP_LABELS = Object.freeze({wall:'외벽',window:'창호',floor:'바닥',roof:'지붕',stair:'계단',fire:'방화',parking:'주차장',access:'편의시설',interior:'실내',steel:'철골',jutong:'주동',unit:'단위세대'});
export const normalizeDetailText = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/gu, '');
const array = value => Array.isArray(value) ? value : value == null ? [] : [value];
const rows = value => Array.isArray(value) ? value : value?.items || value?.details || [];
function words(value) {
  if (value == null || typeof value === 'function') return '';
  if (typeof value !== 'object') return String(value);
  return Object.entries(value).filter(([k]) => !['draw','geometry','entities','_text'].includes(k)).map(([k,v]) => k + ' ' + words(v)).join(' ');
}
const groupPatterns = {
  steel:/철골|h형강|steel/, jutong:/jutong|주동|판상|타워/, unit:/단위세대|unit-plan/,
  window:/window|opening|창호|창대|창문|인방|문틀/, roof:/roof|파라펫|지붕|옥상/,
  stair:/stair|계단|디딤판|난간/, fire:/fire|방화|내화|방염/,
  parking:/parking|주차/, access:/access|편의시설|접근성|무장애|장애인|경사로|점자/,
  floor:/floor|slab|바닥|슬래브/, interior:/interior|실내|천장|가구/,
  wall:/wall|벽|beam|column/,
};
function groupsFrom(value) {
  const text = normalizeDetailText(words(value));
  return Object.entries(groupPatterns).filter(([,pattern]) => pattern.test(text)).map(([group]) => group);
}
export function detailGroup(item = {}) {
  const basic = {'BASIC-01':'window','BASIC-02':'window','BASIC-03':'roof','BASIC-04':'wall','BASIC-05':'stair'};
  if (basic[item.id]) return basic[item.id];
  if (DETAIL_GROUPS.includes(item.group)) return item.group;
  return groupsFrom([item.group,item.classification,item.category,item.name,item.folder])[0] || 'interior';
}
function facilities(item) {
  const raw = array(item.facilities ?? item.facility).flatMap(v => String(v).split(/[,/|]/)).map(v => v.trim()).filter(Boolean);
  const text = words([raw,item.classification,item.category,item.appliesTo,item.name]);
  return [...new Set([...raw,...['세대','공용','부대','지하주차장'].filter(v => text.includes(v))])];
}
const sourceOf = source => /^(lh|lh2017|lh2025|la)$/i.test(source || '') ? 'lh' : source;
function normalized(raw, source, knowledge = {}) {
  const detail = {...raw,...knowledge.details?.find(d => d.id === raw.id)};
  const id = String(detail.id ?? detail.drawing_id ?? detail.name ?? '');
  const checks = array(detail.checks);
  const lawIds = new Set(checks.map(c => c.lawValue?.split('.')[0]).filter(Boolean));
  const laws = [...array(detail.laws),...array(knowledge.laws).filter(law => lawIds.has(law.id))];
  const catalogSource = raw.source || source;
  const item = {...detail,id,key:(source === 'lh' ? source + ':' + catalogSource : source) + ':' + id,source,catalogSource,registryGroup:raw.group,
    name:detail.name || detail.title || detail.drawing_id || id,group:detailGroup(detail),
    facilities:facilities(detail),detail,laws,checks,raw,
    layers:array(detail.layers ?? detail.assembly?.layers ?? detail.assembly),
    preview:detail.previewUrl || detail.preview || detail.png || detail.thumbnail || null,
    lhNumbers:array(detail.lhNumbers ?? detail.lhNumber ?? detail.lh ?? detail.lhReferences),
  };
  item._text = normalizeDetailText(words([detail,laws,item.group,DETAIL_GROUP_LABELS[item.group],item.facilities]));
  return item;
}
export function createDetailIndex({ours = [],knowledge = {},lh = [],library = []} = {}) {
  const result = [], seen = new Set();
  for (const [source, entries] of [['ours',rows(ours)],['lh',rows(lh)],['library',rows(library)]]) {
    for (const raw of entries) {
      if (!raw || typeof raw !== 'object') continue;
      const item = normalized(raw,source,source === 'ours' ? knowledge[raw.group] || {} : {});
      if (!item.id || seen.has(item.key)) continue;
      seen.add(item.key); result.push(item);
    }
  }
  return result;
}
function matchesReference(ref,item) {
  if (!ref) return false;
  if (typeof ref === 'string') return ref === item.key || ref === item.id;
  if (ref.searchKey) return ref.searchKey === item.key;
  const id = ref.detailId ?? ref.detail?.id ?? ref.detail ?? ref.id;
  if (id !== item.id && id !== item.key) return false;
  if (!ref.source) return item.source === 'ours' || !item.source;
  if (sourceOf(ref.source) !== item.source) return false;
  return !item.catalogSource || ['ours','library','lh'].includes(item.catalogSource) || ref.source === item.catalogSource;
}
function liveState(document) {
  const entities = document.entities || [], byId = new Map(), sets = new Set();
  for (const entity of entities) {
    byId.set(entity.id,entity);
    if (entity.drawingSet?.id != null) sets.add(String(entity.drawingSet.id));
  }
  return {entities,byId,sets};
}
function liveMembers(ref,setId,state) {
  if (Array.isArray(ref.entityIds)) return ref.entityIds.map(id => state.byId.get(id)).filter(Boolean);
  return state.sets.has(String(setId)) ? null : [];
}
function movedReference(ref,members) {
  if (!members?.length || !ref.referenceBounds) return ref;
  const current = bounds(members), previous = ref.referenceBounds;
  if (!current || ![current.minX,current.minY,previous.minX,previous.minY].every(Number.isFinite)) return ref;
  const dx = current.minX - previous.minX, dy = current.minY - previous.minY;
  const move = point => Array.isArray(point) ? [point[0]+dx,point[1]+dy,...point.slice(2)] :
    point && Number.isFinite(point.x) && Number.isFinite(point.y) ? {...point,x:point.x+dx,y:point.y+dy} : point;
  return {...ref,at:move(ref.at),referenceAt:move(ref.referenceAt)};
}
function referenceRecords(document,state = liveState(document)) {
  const result = [];
  for (const [setId,set] of Object.entries(document.drawingSets || {})) {
    for (const ref of array(set.references ?? set.details?.references)) {
      const members = liveMembers(ref,setId,state);
      if (members?.length === 0) continue;
      result.push({ref:movedReference(ref,members),extra:{setId}});
    }
  }
  for (const entity of state.entities) {
    const ref = entity.detailReference;
    if (ref && !ref.annotation) result.push({ref,extra:{entityId:entity.id,at:entity.position ?? entity.center ?? entity.points?.[0] ?? ref.at}});
  }
  return result;
}
export function findDetailUses(document = {},item,records = referenceRecords(document)) {
  if (typeof item === 'string') {
    const pieces = item.split(':');
    item = {id:pieces.length > 1 ? pieces.at(-1) : item,key:item,source:pieces.length > 1 ? pieces[0] : undefined,catalogSource:pieces.length > 2 ? pieces[1] : undefined};
  }
  const uses = [], seen = new Set();
  for (const {ref,extra} of records) {
    if (!matchesReference(ref,item) || ref.annotation) continue;
    const use = {...(typeof ref === 'object' ? ref : {}),...extra};
    const key = JSON.stringify([use.setId,use.entityId,use.view,use.face,use.referenceAt || use.at,use.number,use.sheetRef]);
    if (!seen.has(key)) {seen.add(key);uses.push(use);}
  }
  return uses;
}
function insertionRecords(document,state = liveState(document)) {
  const records = [];
  for (const [setId,set] of Object.entries(document.drawingSets || {})) {
    const selected = [...array(set.selected ?? set.details?.selected),...array(set.placed ?? set.details?.placed)];
    for (const ref of selected) if (ref && !ref.annotation && liveMembers(ref,setId,state)?.length !== 0) records.push(ref);
  }
  for (const entity of state.entities) if (entity.detail && !entity.detail.annotation) records.push(entity.detail);
  return records;
}
export function isDetailInserted(document = {},item,records = insertionRecords(document)) {
  return records.some(ref => matchesReference(ref,item));
}
export function searchDetails(index, {query = '',group = '',facility = '',source = '',allowGroups,document} = {}) {
  const q = normalizeDetailText(query), records = document ? referenceRecords(document) : []; 
  const wanted = sourceOf(source === '우리 상세' ? 'ours' : source === 'LH' ? 'lh' : source);
  return index.filter(item => (allowGroups == null || allowGroups.includes(item.group)) && (!q || item._text.includes(q)) && (!group || group === 'all' || item.group === group) &&
    (!facility || facility === 'all' || item.facilities.includes(facility)) && (!wanted || wanted === 'all' || item.source === wanted))
    .map(item => {const uses = document ? findDetailUses(document,item,records) : []; return {...item,uses,useCount:uses.length};});
}
export function dismissDetail(document,item) {
  const key = typeof item === 'string' ? item : item.key || item.source + ':' + item.id;
  document.projectSettings = {...document.projectSettings, detailSuggestionsDismissed: [...new Set([...array(document.projectSettings?.detailSuggestionsDismissed ?? document.detailSuggestionsDismissed),key])]};
  return document.projectSettings.detailSuggestionsDismissed;
}
export function recommendDetails(index, {selected = [],layers = [],model = {},autoSelected = [],command = '',failedChecks = [],document = {},idle = true,allowGroups} = {}) {
  if (!idle) return [];
  const dismissed = new Set(array(document.projectSettings?.detailSuggestionsDismissed ?? document.detailSuggestionsDismissed));
  const state = liveState(document);
  const entities = array(selected instanceof Set ? [...selected] : selected).map(e => typeof e === 'string' ? state.byId.get(e) : e).filter(Boolean);
  const layerRows = Array.isArray(layers) ? layers : Object.values(layers || {});
  const selectedLayers = entities.map(e => layerRows.find(l => l.id === e.layer)?.name ?? e.layer);
  const selectedText = words([entities,selectedLayers]);
  const stories = array(model.stories), basement = model.basement ?? model.building?.basement ?? document.projectSettings?.basement;
  const hasBasement = basement === true || Number(basement) > 0 || stories.some(s => s.index < 0 || s.elevation < 0 || /^(?:b[1-9]\d*|지하\s*\d*층|basement)$/i.test(String(s.name || s.id || '').trim()));
  const noBasement = !hasBasement && (basement === false || basement === 0);
  const selectedGroups = new Set(groupsFrom(selectedText));
  if (selectedGroups.has('wall')) selectedGroups.add('window');
  const steel = /철골|h형강|steel/i.test(selectedText);
  const commandGroups = new Set(groupsFrom(command));
  const auto = new Set(array(autoSelected).map(d => typeof d === 'string' ? d : d.id));
  const failures = array(failedChecks).filter(c => c && (c.ok === false || c.status === '부적합'));
  const inserted = insertionRecords(document,state);
  const scored = [];
  for (const item of index) {
    if ((allowGroups != null && !allowGroups.includes(item.group)) || dismissed.has(item.key) || dismissed.has(item.id)) continue;
    const basementOnly = /지하|basement|underground/i.test(words([item.name,item.facilities,item.detail?.appliesTo]));
    if (noBasement && basementOnly) continue;

    let score = 0, reason = '';
    const promote = (points,text) => { if (points > score) {score = points; reason = text;} };
    if (selectedGroups.has(item.group)) promote(70,'선택한 객체·레이어와 관련된 상세');
    if (steel && /철골|h형강|steel/.test(item._text)) promote(90,'선택한 철골 부재의 접합 상세');
    if (auto.has(item.id) && !isDetailInserted(document,item,inserted)) promote(60,'현재 설계에 필요하지만 아직 넣지 않은 상세');
    if (commandGroups.has(item.group)) promote(65,'지금 실행 중인 명령과 관련된 상세');
    if (/section|단면/i.test(command) && selectedGroups.has(item.group)) promote(80,'단면을 그리는 부위와 관련된 상세');
    for (const failure of failures) {
      const explicit = failure.detailId ?? failure.detail;
      const law = failure.lawValue ?? failure.lawId;
      const sameLaw = law && item.checks.some(c => c.lawValue === law || c.lawValue?.split('.')[0] === law);
      const sameGroup = failure.group && item.group === failure.group;
      const sameKey = failure.key && item.checks.some(c => c.key === failure.key);
      if (explicit === item.id || sameLaw || sameGroup || sameKey) promote(100,'법 검토 부적합 항목을 검토할 수 있는 상세');
    }
    if (score && basementOnly && !hasBasement) {score = Math.min(score,30);reason = '지하층 여부를 확인한 뒤 검토할 상세';}
    if (score) scored.push({...item,score,reason});
  }
  return scored.sort((a,b) => b.score-a.score || a.key.localeCompare(b.key,'ko')).slice(0,5);
}
