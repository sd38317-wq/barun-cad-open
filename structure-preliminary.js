// 3~5층 개략 엔진의 위치·입력 단면·미확정 choice를 도면용 데이터로 연결한다.
// 설계 계산·후보 선택·입력 보충은 하지 않는다. 부재 치수는 mm, 위치는 m.
export const isPreliminaryStructure = model => model?.reviewMethod === 'kds41-preliminary';
export const PRELIMINARY_PROPOSAL_NOTICE = '제안 단면 포함 — 확인 전 시공 금지';
const list = value => Array.isArray(value) ? value : [];
export const preliminaryFloors = model => list(model.floors).length ? model.floors : list(model.p?.floors);
export function preliminaryLevels(model) {
  const floors = preliminaryFloors(model), n = floors.length || Number(model.p?.stories);
  return Number.isInteger(n) && n > 0 ? Array.from({length: n}, (_, i) => i + 1)
    : [...new Set(list(model.members).map(m => m.level).filter(Number.isInteger))].sort((a, b) => a - b);
}
const defined = object => Object.fromEntries(Object.entries(object || {}).filter(([, v]) => v != null));
const memberKey = m => JSON.stringify([m.kind, m.id, m.level]);
export function preliminaryMembers(model) {
  const p = model.p || {}, floors = preliminaryFloors(model), members = new Map();
  const add = m => {
    if (!['column', 'wall', 'beam', 'footing'].includes(m.kind)) return;
    const key = memberKey(m);
    members.set(key, {...members.get(key), ...defined(m)});
  };
  // 층 지정 없는 기둥·벽 단면은 같은 ID의 실제 위치·검토 결과에만 연결한다.
  for (const m of list(model.members)) add(m);
  floors.forEach((f, i) => {
    for (const [kind, key] of [['column', 'columns'], ['wall', 'walls']])
      for (const m of list(f[key])) {
        // CORE가 입력에 없는 기둥 ID를 부여한 경우 그 부호에 다시 연결한다.
        const generated = kind === 'column' && !m.id && list(model.members).find(q => q.kind === kind && q.level === i + 1 && q.x === m.x && q.y === m.y);
        add({...m, id: m.id || generated?.id, kind, level: i + 1});
      }
  });
  const specs = [['column', 'columns'], ['wall', 'walls']]
    .flatMap(([kind, key]) => list(p.members?.[key]).map(m => ({...m, kind})));
  // CORE reviewMidriseMembers: 보 입력은 beams → flexure → 층별 beams 순 첫 ID+층이 우선한다.
  const beams = [...list(p.members?.beams), ...list(p.members?.flexure).filter(m => m.kind === 'beam'),
    ...floors.flatMap((f,i) => list(f.beams).map(m => ({...m,level:i+1})))], selectedBeams = new Set();
  for (const input of beams) {
    const m = {...input,kind:'beam',level:input.level??1}, key = memberKey(m);
    if (!selectedBeams.has(key)) {members.set(key,defined(m));selectedBeams.add(key);}
  }
  const results = [...list(model.preliminary?.memberResults), ...list(model.preliminary?.footingResults)];
  for (const r of results) add({id: r.id, kind: r.kind, level: r.level ?? 1});
  for (const s of specs) {
    const matches = [...members.values()].filter(m => m.kind === s.kind && m.id === s.id && (s.level == null || s.level === m.level));
    if (matches.length) for (const m of matches) members.set(memberKey(m), {...defined(s), ...m});
    else add({...s, level: s.level ?? 1});
  }
  if (p.foundation && typeof p.foundation === 'object') {
    const r = results.find(r => r.kind === 'footing');
    add({...p.foundation, id: p.foundation.id ?? r?.id, kind: 'footing', level: 1});
  }
  return [...members.values()].map(m => {
    const result = results.find(r => r.kind === m.kind && r.id === m.id && (r.level ?? 1) === m.level);
    const input = {...defined(result?.data?.input), ...m}, choice = result?.data?.choice;
    const proposal = choice != null; // proposal=true여도 choice=null이면 치수를 보충하지 않는다.
    const section = proposal ? {...input, ...defined(choice)} : input;
    const columnId = result?.columnId ?? input.columnId;
    const support = m.kind === 'footing' && [...members.values()].find(c => c.kind === 'column' && c.level === 1 && c.id === columnId);
    return {...section, code: m.code || String(m.id ?? ''), result, proposal, columnId,
      x: section.x ?? support?.x, y: section.y ?? support?.y,
      pilotis: m.kind === 'column' && floors[m.level - 1]?.pilotis === true};
  });
}
// 모듈 checks의 capacity를 전사한다. 엔진이 산출하지 않은 숫자는 만들지 않는다.
export function preliminaryPilotiSpacing(member) {
  return list(member.result?.checks).find(c => c.item === '필로티 횡보강 수직간격')?.capacity;
}
