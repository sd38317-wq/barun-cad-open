'use strict';

// This module is policy and storage, not a sandbox or a signature verifier.
// Its caller must hash the staged candidate and run the installed, trusted harness.
// Never pass a report received from an update archive directly to commitRegistry.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const policy = require('./quality-policy.cjs');
const RUNNER_ID = 'barun-cad-packaged-regression-v1';
const SCHEMA_VERSION = 1;

class QualityGateError extends Error {
  constructor(code, message, details = []) {
    super(message); this.name = 'QualityGateError'; this.code = code; this.details = details;
  }
}
const fail = (code, message, details) => { throw new QualityGateError(code, message, details); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const versionParts = v => {
  if (typeof v !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v)) fail('VERSION_INVALID', '정식 버전 번호가 올바르지 않습니다.');
  const parts = v.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) fail('VERSION_INVALID', '버전 번호 범위를 초과했습니다.');
  return parts;
};
function compareVersions(a, b) {
  const aa = versionParts(a), bb = versionParts(b);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  return 0;
}
function normalizeCriteria(criteria) {
  if (!Array.isArray(criteria) || !criteria.length || criteria.length > 10000) fail('CRITERIA_INVALID', '필수 검증 목록이 없거나 올바르지 않습니다.');
  const ids = new Set();
  return criteria.map(c => {
    if (!object(c) || typeof c.id !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/.test(c.id) || ids.has(c.id)) fail('CRITERIA_INVALID', '필수 검증 ID가 없거나 중복되었습니다.');
    if (typeof c.description !== 'string' || !c.description.trim() || c.description.length > 1000) fail('CRITERIA_INVALID', '필수 검증 설명이 올바르지 않습니다.');
    ids.add(c.id);
    const clean = {id: c.id, description: c.description};
    if (c.maxDurationMs !== undefined) {
      if (!Number.isFinite(c.maxDurationMs) || c.maxDurationMs <= 0) fail('CRITERIA_INVALID', '검증 시간 기준이 올바르지 않습니다.');
      clean.maxDurationMs = c.maxDurationMs;
    }
    return clean;
  }).sort((a,b) => a.id.localeCompare(b.id));
}
function createRegistry(baseline = require('./quality-gate-baseline.json')) {
  if (!object(baseline) || baseline.schemaVersion !== SCHEMA_VERSION) fail('SCHEMA_INVALID', '검증 기준 형식이 지원되지 않습니다.');
  return {schemaVersion: SCHEMA_VERSION, revision: 0, activeVersion: null, activeArtifactSha256: null,
    criteria: normalizeCriteria(baseline.criteria), probeHashes: [], history: []};
}
function validateRegistry(registry) {
  if (!object(registry) || registry.schemaVersion !== SCHEMA_VERSION || !Number.isSafeInteger(registry.revision) || registry.revision < 0 || !Array.isArray(registry.history)) fail('REGISTRY_INVALID', '검증 DB가 손상되었거나 지원되지 않습니다.');
  normalizeCriteria(registry.criteria);
  normalizeProbeHashes(registry.probeHashes);
  if(registry.archivedCriteria !== undefined) {
    if(!Array.isArray(registry.archivedCriteria)) fail('REGISTRY_INVALID','보관된 검증 기준 이력이 잘못되었습니다.');
    if(registry.archivedCriteria.length) normalizeCriteria(registry.archivedCriteria);
  }
  if(registry.approvedChanges !== undefined) {
    if(!Array.isArray(registry.approvedChanges) || registry.approvedChanges.some(c=>!policy.APPROVED_CHANGES.some(p=>JSON.stringify(c)===JSON.stringify(p))) || new Set(registry.approvedChanges.map(c=>c.id)).size!==registry.approvedChanges.length) fail('REGISTRY_INVALID','승인된 요구사항 변경 이력이 잘못되었습니다.');
    for(const change of registry.approvedChanges) if(!registry.archivedCriteria?.some(c=>c.id===change.fromId) || registry.criteria.some(c=>c.id===change.fromId) || !registry.criteria.some(c=>c.id===change.toId)) fail('REGISTRY_INVALID','승인된 요구사항 변경과 검증 목록이 일치하지 않습니다.');
  }
  if (registry.revision === 0) {
    if (registry.activeVersion !== null || registry.activeArtifactSha256 !== null || registry.history.length !== 0) fail('REGISTRY_INVALID', '초기 검증 DB 상태가 올바르지 않습니다.');
  } else {
    versionParts(registry.activeVersion);
    if (!sha(registry.activeArtifactSha256) || registry.history.length !== registry.revision) fail('REGISTRY_INVALID', '검증 DB 이력이 일치하지 않습니다.');
    let previous = null;
    for (const item of registry.history) {
      if (!object(item) || !sha(item.artifactSha256) || !sha(item.reportSha256) || typeof item.runId !== 'string' || typeof item.approvedAt !== 'string') fail('REGISTRY_INVALID', '검증 승인 이력이 손상되었습니다.');
      versionParts(item.version);
      if (previous && compareVersions(item.version, previous) <= 0) fail('REGISTRY_INVALID', '검증 승인 버전 순서가 올바르지 않습니다.');
      previous = item.version;
    }
    const last = registry.history.at(-1);
    if (last.version !== registry.activeVersion || last.artifactSha256 !== registry.activeArtifactSha256) fail('REGISTRY_INVALID', '현재 승인 버전과 검증 이력이 다릅니다.');
  }
  return registry;
}
function loadRegistry({registryPath, baseline}) {
  try { return validateRegistry(JSON.parse(fs.readFileSync(registryPath, 'utf8'))); }
  catch (error) {
    if (error.code === 'ENOENT') return createRegistry(baseline);
    if (error instanceof QualityGateError) throw error;
    fail('REGISTRY_UNREADABLE', '검증 DB를 읽을 수 없어 업데이트를 중단했습니다.');
  }
}
function mergeCriteria(current, proposed = []) {
  const merged = new Map(normalizeCriteria(current).map(c => [c.id, c]));
  if (!Array.isArray(proposed)) fail('CRITERIA_INVALID', '새 검증 목록 형식이 올바르지 않습니다.');
  for (const next of proposed.length ? normalizeCriteria(proposed) : []) {
    const old = merged.get(next.id);
    // A patch may add checks or tighten timings; it may not weaken existing policy.
    if (old && (next.description !== old.description || (old.maxDurationMs !== undefined && (next.maxDurationMs === undefined || next.maxDurationMs > old.maxDurationMs)))) fail('CRITERIA_WEAKENED', '기존 필수 검증 기준을 완화할 수 없습니다.', [next.id]);
    merged.set(next.id, next);
  }
  return normalizeCriteria([...merged.values()]);
}
function normalizeProbeHashes(hashes) {
  if (!Array.isArray(hashes) || hashes.length > 10000 || hashes.some(h => !sha(h)) || new Set(hashes).size !== hashes.length) fail('PROBES_INVALID', '보존된 검증 코드 목록이 손상되었습니다.');
  return [...hashes].sort();
}
function validateCandidate({registry, candidate, report, proposedCriteria = [], proposedProbeHashes = []}) {
  validateRegistry(registry);
  if (!object(candidate) || !sha(candidate.artifactSha256) || typeof candidate.runId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(candidate.runId)) fail('CANDIDATE_INVALID', '업데이트 파일 식별 정보가 올바르지 않습니다.');
  versionParts(candidate.version);
  if (registry.activeVersion && compareVersions(candidate.version, registry.activeVersion) <= 0) fail('VERSION_NOT_NEWER', '현재 승인 버전보다 새 버전만 적용할 수 있습니다.');
  if (!object(report) || report.schemaVersion !== SCHEMA_VERSION || report.runnerId !== RUNNER_ID) fail('REPORT_INVALID', '지정된 검증 실행 결과가 없습니다.');
  if ((report.status !== undefined && report.status !== 'passed') || (report.errors !== undefined && (!Array.isArray(report.errors) || report.errors.length))) fail('REPORT_FAILED', '검증 실행 자체가 실패하여 업데이트를 차단했습니다.');
  if (report.runId !== candidate.runId || report.version !== candidate.version || report.artifactSha256 !== candidate.artifactSha256) fail('REPORT_MISMATCH', '검증 결과가 현재 업데이트 파일 또는 실행과 일치하지 않습니다.');
  const probeHashes = [...new Set([...registry.probeHashes,...normalizeProbeHashes(proposedProbeHashes)])].sort();
  const executed = normalizeProbeHashes(report.executedProbeHashes || []);
  if (probeHashes.some(h => !executed.includes(h))) fail('PROBE_NOT_EXECUTED', '기존 검증 코드가 실행되지 않아 업데이트를 차단했습니다.');
  if (!Array.isArray(report.checks) || !report.checks.length || report.checks.length > 10000) fail('REPORT_INVALID', '검증 항목 결과가 없습니다.');
  const checks = new Map();
  for (const check of report.checks) {
    if (!object(check) || typeof check.id !== 'string' || checks.has(check.id) || !['passed','failed','skipped','superseded'].includes(check.status)) fail('REPORT_INVALID', '검증 결과 항목이 중복되거나 잘못되었습니다.');
    checks.set(check.id, check);
  }
  let criteria = mergeCriteria(registry.criteria, proposedCriteria);
  const archivedCriteria = [...(registry.archivedCriteria || [])];
  const approvedChanges = [...(registry.approvedChanges || [])];
  const newApprovedChanges = [];
  const retiredChecks = new Set();
  for (const change of policy.APPROVED_CHANGES) {
    const retired = checks.get(change.fromId);
    const approvedRetired = policy.isApprovedSuperseded(retired,{version:candidate.version,executedProbeHashes:executed},change);
    if(approvedRetired) {
      retiredChecks.add(retired);
      if(!policy.changeHashes(change).some(h=>probeHashes.includes(h)) || checks.get(change.toId)?.status!=='passed' || !criteria.some(c=>c.id===change.toId)) fail('POLICY_REPLACEMENT_MISSING','변경된 요구사항의 대체 검증을 통과해야 합니다.');
      const old = criteria.find(c=>c.id===change.fromId);
      if(!old && !archivedCriteria.some(c=>c.id===change.fromId)) fail('POLICY_NOT_APPLICABLE','변경 대상의 기존 검증 기준이 없습니다.');
      if(old && !archivedCriteria.some(c=>c.id===old.id)) archivedCriteria.push({...old});
      criteria = criteria.filter(c=>c.id!==change.fromId);
      if(!approvedChanges.some(c=>c.id===change.id)) {approvedChanges.push({...change});newApprovedChanges.push({...change});}
    }
    // Previously migrated probes remain mandatory, including their raw retired result.
    else if(approvedChanges.some(c=>c.id===change.id)) fail('POLICY_AUDIT_MISSING','이전 검증 실행과 승인된 대체 검증 기록이 필요합니다.');
  }
  const failures = [];
  for (const criterion of criteria) {
    const check = checks.get(criterion.id);
    if (!check) failures.push({id:criterion.id, reason:'missing'});
    else if (check.status !== 'passed') failures.push({id:criterion.id, reason:check.status});
    else if (criterion.maxDurationMs !== undefined && (!Number.isFinite(check.durationMs) || check.durationMs < 0 || check.durationMs > criterion.maxDurationMs)) failures.push({id:criterion.id, reason:'duration'});
  }
  for (const check of checks.values()) if (check.status !== 'passed' && !retiredChecks.has(check) && !failures.some(f => f.id === check.id)) failures.push({id:check.id, reason:check.status});
  if (failures.length) fail('REGRESSION_BLOCKED', '필수 검증을 통과하지 못하여 업데이트를 차단했습니다.', failures);
  return {ok:true, criteria, probeHashes, archivedCriteria, approvedChanges, newApprovedChanges, passedCount:[...checks.values()].filter(c=>c.status==='passed').length};
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function commitRegistry({registryPath, registry, candidate, report, proposedCriteria = [], proposedProbeHashes = [], baseline}) {
  const validation = validateCandidate({registry,candidate,report,proposedCriteria,proposedProbeHashes});
  const dir = path.dirname(path.resolve(registryPath));
  fs.mkdirSync(dir,{recursive:true});
  const lock = registryPath + '.lock';
  let lockFd;
  try { lockFd = fs.openSync(lock,'wx',0o600); }
  catch (error) { if(error.code === 'EEXIST') fail('REGISTRY_BUSY','다른 검증이 진행 중이거나 이전 검증이 중단되어 업데이트를 보류했습니다.'); throw error; }
  const temporary = registryPath + '.' + crypto.randomUUID() + '.tmp';
  try {
    const actual = loadRegistry({registryPath, baseline:baseline || {schemaVersion:1, criteria:registry.criteria}});
    if (digest(actual) !== digest(registry)) fail('REGISTRY_CHANGED','검증 중 승인 DB가 변경되어 업데이트를 중단했습니다.');
    const next = {schemaVersion:1, revision:registry.revision + 1, activeVersion:candidate.version, activeArtifactSha256:candidate.artifactSha256,
      criteria:validation.criteria, probeHashes:validation.probeHashes, archivedCriteria:validation.archivedCriteria,approvedChanges:validation.approvedChanges,
      history:[...registry.history,{version:candidate.version,artifactSha256:candidate.artifactSha256,runId:candidate.runId,reportSha256:digest(report),approvedAt:new Date().toISOString(),approvedChanges:validation.newApprovedChanges,
        supersededChecks:report.checks.filter(c=>c.status==='superseded').map(c=>({...c}))}]};
    const fd = fs.openSync(temporary,'wx',0o600);
    try { fs.writeFileSync(fd,JSON.stringify(next,null,2)+'\n','utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary,registryPath);
    return next;
  } finally {
    if(fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.closeSync(lockFd); fs.unlinkSync(lock);
  }
}
module.exports = {RUNNER_ID,SCHEMA_VERSION,QualityGateError,createRegistry,validateRegistry,loadRegistry,mergeCriteria,compareVersions,validateCandidate,commitRegistry};
