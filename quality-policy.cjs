'use strict';

// Explicit user-approved requirement change. This is product policy, never
// loaded from candidate manifests or arbitrary "skip test" configuration.
const POPUP_CHANGE = Object.freeze({
  id: 'POPUP_SCALE_75_USER_20260927',
  fromId: 'DIALOG_HALF_SCALE',
  toId: 'DIALOG_THREE_QUARTER_SCALE',
  minVersion: '6.0.3',
  userReason: '이거보단 1.5배키워줘',
  probeSha256: 'cf65b2dd299b55ad15fdb9da07567e468cbdc1734423dacd7c6089a8d4fea067',
});
// Explicit user-approved requirement change (2026-10-02, approved again in chat: "승인할테니 설치해"):
// the output window follows the AutoCAD plot dialog the user drew (three columns, small live preview
// in the middle) instead of a dominant preview. Only these pinned retained probes may be superseded.
const PLOT_DIALOG_CHANGE = Object.freeze({
  id: 'PLOT_DIALOG_AUTOCAD_USER_20261002',
  fromId: 'OUTPUT_DIRECT_MULTIPLOT',
  toId: 'OUTPUT_PLOT_DIALOG_AUTOCAD',
  minVersion: '6.0.12',
  userReason: '이걸로 해 그대로 구현해',
  probeSha256s: Object.freeze([
    '3fb56e039ec87811c0521ca919c33b730bc5722bd330183a023878c92fbd1b32',
    'c4731355c70b969f6044ab5bb72860c90235c51e0e0917a0634c27720f337a7c',
  ]),
});
const APPROVED_CHANGES = Object.freeze([POPUP_CHANGE, PLOT_DIALOG_CHANGE]);
const changeHashes = change => change.probeSha256s || [change.probeSha256];
const versionParts = version => typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ? version.split('.').map(Number) : null;
function applies(version, minVersion = POPUP_CHANGE.minVersion) {
  const parts = versionParts(version), min = versionParts(minVersion);
  if(!parts || !min || !parts.every(Number.isSafeInteger)) return false;
  for(let i=0;i<3;i++) if(parts[i]!==min[i]) return parts[i]>min[i];
  return true;
}
function supersedeCheck(check, {version, probeHash}) {
  const change = APPROVED_CHANGES.find(c => c.fromId===check?.id && applies(version, c.minVersion) && changeHashes(c).includes(probeHash));
  if(!change || !['passed','failed'].includes(check.status)) return check;
  return {...check,status:'superseded',originalStatus:check.status,approvedChangeId:change.id,replacementId:change.toId,probeSha256:probeHash};
}
function isApprovedSuperseded(check, {version, executedProbeHashes}, change = APPROVED_CHANGES.find(c => c.fromId===check?.id)) {
  if(!change) return false;
  const hashes = changeHashes(change);
  return applies(version, change.minVersion) && check?.id===change.fromId && check.status==='superseded'
    && ['passed','failed'].includes(check.originalStatus) && check.approvedChangeId===change.id
    && check.replacementId===change.toId && hashes.includes(check.probeSha256)
    && executedProbeHashes.includes(check.probeSha256)
    && (!check.probeIds || (Array.isArray(check.probeIds) && check.probeIds.length>=1 && check.probeIds.length<=hashes.length
      && new Set(check.probeIds).size===check.probeIds.length && check.probeIds.every(h => hashes.includes(h) && executedProbeHashes.includes(h))));
}
module.exports = {POPUP_CHANGE,PLOT_DIALOG_CHANGE,APPROVED_CHANGES,changeHashes,applies,supersedeCheck,isApprovedSuperseded};
