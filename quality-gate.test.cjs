'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const gate = require('./quality-gate.cjs');
const HASH = 'a'.repeat(64), PROBE = 'b'.repeat(64);
function fixture() {
  const registry = gate.createRegistry();
  const candidate = {version:'6.0.2',artifactSha256:HASH,runId:'1234567890abcdef'};
  const report = {schemaVersion:1,runnerId:gate.RUNNER_ID,...candidate,executedProbeHashes:[PROBE],checks:registry.criteria.map(c=>({id:c.id,status:'passed'}))};
  return {registry,candidate,report,proposedProbeHashes:[PROBE]};
}
const code = wanted => e => e instanceof gate.QualityGateError && e.code === wanted;
function temp(t) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'barun-quality-gate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return path.join(root,'registry.json'); }
test('baseline contains only actual runtime tests and initial candidate passes',()=>{
  const args=fixture(); assert.equal(args.registry.criteria.length,require('./quality-gate-baseline.json').criteria.length);
  assert.ok(args.registry.criteria.some(c=>c.id==='HATCH_HOLE_SELECTION'));
  assert.equal(gate.validateCandidate(args).ok,true);
});
test('missing, failed, skipped, unknown and duplicate tests fail closed',()=>{
  for(const kind of ['missing','failed','skipped','unknown','duplicate']) {
    const args=fixture();
    if(kind==='missing')args.report.checks.pop();
    else if(kind==='duplicate')args.report.checks.push({...args.report.checks[0]});
    else args.report.checks[0].status=kind;
    assert.throws(()=>gate.validateCandidate(args),code(['unknown','duplicate'].includes(kind)?'REPORT_INVALID':'REGRESSION_BLOCKED'));
  }
});
test('a previous run or wrong candidate version/hash cannot satisfy a gate',()=>{
  for(const key of ['version','artifactSha256','runId']) {
    const args=fixture();args.report[key]='different';
    assert.throws(()=>gate.validateCandidate(args),code('REPORT_MISMATCH'));
  }
});
test('wrong harness or failure outside test cases blocks even if all tests passed',()=>{
  const args=fixture();args.report.runnerId='candidate-self-reported';assert.throws(()=>gate.validateCandidate(args),code('REPORT_INVALID'));
  for(const extra of [{status:'failed'},{errors:['startup failed']}]) assert.throws(()=>gate.validateCandidate({...fixture(),report:{...fixture().report,...extra}}),code('REPORT_FAILED'));
});
test('new criteria accumulate and cannot remove or weaken old criteria',()=>{
  const args=fixture();args.proposedCriteria=[{id:'NEW_FIX',description:'A new required behavior'}];
  assert.throws(()=>gate.validateCandidate(args),code('REGRESSION_BLOCKED'));
  args.report.checks.push({id:'NEW_FIX',status:'passed'});
  assert.equal(gate.validateCandidate(args).criteria.length,args.registry.criteria.length+1);
  const criteria=gate.mergeCriteria([{id:'TIME',description:'fast',maxDurationMs:50}],[{id:'TIME',description:'fast',maxDurationMs:40}]);assert.equal(criteria[0].maxDurationMs,40);
  for(const maxDurationMs of [undefined,100]) assert.throws(()=>gate.mergeCriteria(criteria,[{id:'TIME',description:'fast',maxDurationMs}]),code('CRITERIA_WEAKENED'));
});
test('registered performance criteria require measured finite timings',()=>{
  for(const durationMs of [undefined,NaN,-1,101]) {
    const args=fixture();args.proposedCriteria=[{id:'PERF',description:'timed',maxDurationMs:100}];args.report.checks.push({id:'PERF',status:'passed',durationMs});
    assert.throws(()=>gate.validateCandidate(args),code('REGRESSION_BLOCKED'));
  }
});
test('retained probe hashes must execute and cannot be dropped from next approval',t=>{
  const registryPath=temp(t),args=fixture();
  args.report.executedProbeHashes=[];assert.throws(()=>gate.validateCandidate(args),code('PROBE_NOT_EXECUTED'));
  args.report.executedProbeHashes=[PROBE];const first=gate.commitRegistry({...args,registryPath});
  const second=fixture();second.registry=first;second.candidate.version='6.0.3';second.report.version='6.0.3';second.proposedProbeHashes=[];
  second.report.executedProbeHashes=[];assert.throws(()=>gate.validateCandidate(second),code('PROBE_NOT_EXECUTED'));
  second.report.executedProbeHashes=[PROBE];assert.deepEqual(gate.commitRegistry({...second,registryPath}).probeHashes,[PROBE]);
});
test('failed candidate never creates or advances approval DB',t=>{
  const registryPath=temp(t),args=fixture();args.report.checks[0].status='failed';
  assert.throws(()=>gate.commitRegistry({...args,registryPath}),code('REGRESSION_BLOCKED'));assert.equal(fs.existsSync(registryPath),false);
  args.report.checks[0].status='passed';args.registry=gate.commitRegistry({...args,registryPath});const saved=fs.readFileSync(registryPath,'utf8');
  args.candidate.version='6.0.3';args.report.version='6.0.3';args.report.checks[0].status='failed';
  assert.throws(()=>gate.commitRegistry({...args,registryPath}),code('REGRESSION_BLOCKED'));assert.equal(fs.readFileSync(registryPath,'utf8'),saved);
});
test('atomic successful commit retains history and enforces increasing official versions',t=>{
  const registryPath=temp(t),args=fixture();args.registry=gate.commitRegistry({...args,registryPath});
  assert.equal(args.registry.revision,1);assert.deepEqual(gate.loadRegistry({registryPath}),args.registry);
  for(const version of ['6.0.2','6.0.1']) {args.candidate.version=version;assert.throws(()=>gate.validateCandidate(args),code('VERSION_NOT_NEWER'));}
  args.candidate.version='6.0.3-beta.1';assert.throws(()=>gate.validateCandidate(args),code('VERSION_INVALID'));
  assert.equal(fs.existsSync(registryPath+'.lock'),false);
});
test('concurrent update and stale lock fail closed without overwriting registry',t=>{
  const registryPath=temp(t),args=fixture();gate.commitRegistry({...args,registryPath});
  args.candidate.version='6.0.3';args.report.version='6.0.3';assert.throws(()=>gate.commitRegistry({...args,registryPath}),code('REGISTRY_CHANGED'));
  fs.writeFileSync(registryPath+'.lock','');assert.throws(()=>gate.commitRegistry({...args,registryPath}),code('REGISTRY_BUSY'));
});
test('corrupt DB is never silently reset to baseline',t=>{
  const registryPath=temp(t);fs.writeFileSync(registryPath,'{broken');assert.throws(()=>gate.loadRegistry({registryPath}),code('REGISTRY_UNREADABLE'));
  const bad=fixture().registry;bad.probeHashes=['not-a-hash'];fs.writeFileSync(registryPath,JSON.stringify(bad));assert.throws(()=>gate.loadRegistry({registryPath}),code('PROBES_INVALID'));
});
test('version comparison is numeric and strict',()=>{
  assert.equal(gate.compareVersions('6.0.10','6.0.9'),1);
  for(const version of ['6.0','6.00.2','6.0.2-beta.1','999999999999999999999.0.0']) assert.throws(()=>gate.compareVersions(version,'6.0.2'),code('VERSION_INVALID'));
});
