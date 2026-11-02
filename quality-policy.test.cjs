'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const gate=require('./quality-gate.cjs');
const policy=require('./quality-policy.cjs');
const change=policy.POPUP_CHANGE;
function setup() {
  const registry=gate.createRegistry({schemaVersion:1,criteria:[{id:'UNRELATED',description:'unchanged required behavior'},{id:change.fromId,description:'50 percent popup'}]});
  registry.probeHashes=[change.probeSha256];
  const candidate={version:'6.0.3',artifactSha256:'a'.repeat(64),runId:'1234567890abcdef'};
  const raw={id:change.fromId,status:'failed',detail:'Expected 0.5 but got 0.75'};
  const retired=policy.supersedeCheck(raw,{version:candidate.version,probeHash:change.probeSha256});
  const report={schemaVersion:1,runnerId:gate.RUNNER_ID,...candidate,status:'passed',errors:[],executedProbeHashes:[change.probeSha256],checks:[{id:'UNRELATED',status:'passed'},retired,{id:change.toId,status:'passed'}]};
  return {registry,candidate,report,proposedCriteria:[{id:change.toId,description:'75 percent popup'}]};
}
test('only explicitly approved version, pinned probe and old check may be superseded',()=>{
  const raw={id:change.fromId,status:'failed'};
  for(const input of [{version:'6.0.2',probeHash:change.probeSha256},{version:'6.0.3',probeHash:'0'.repeat(64)},{version:'6.0.3-beta.1',probeHash:change.probeSha256}])assert.equal(policy.supersedeCheck(raw,input),raw);
  const other={id:'UNRELATED',status:'failed'};assert.equal(policy.supersedeCheck(other,{version:'6.0.3',probeHash:change.probeSha256}),other);
  assert.equal(policy.supersedeCheck(raw,{version:'6.0.3',probeHash:change.probeSha256}).originalStatus,'failed');
});
test('approved replacement retains old failed result, archives old criterion, requires passing new criterion',()=>{
  const args=setup(),out=gate.validateCandidate(args);
  assert.equal(args.report.checks[1].status,'superseded');assert.equal(args.report.checks[1].originalStatus,'failed');
  assert.equal(args.report.checks[1].detail,'Expected 0.5 but got 0.75');
  assert.equal(out.passedCount,2);assert.equal(out.criteria.some(c=>c.id===change.fromId),false);
  assert.equal(out.archivedCriteria[0].id,change.fromId);assert.deepEqual(out.approvedChanges,[change]);
  args.report.checks[2].status='failed';assert.throws(()=>gate.validateCandidate(args),e=>e.code==='POLICY_REPLACEMENT_MISSING');
});
test('unapproved old failure, unrelated failure and forged supersession always block',()=>{
  const old=setup();old.report.checks[1]={id:change.fromId,status:'failed'};assert.throws(()=>gate.validateCandidate(old));
  const other=setup();other.report.checks[0].status='failed';assert.throws(()=>gate.validateCandidate(other),e=>e.code==='REGRESSION_BLOCKED');
  for(const field of ['probeSha256','approvedChangeId','replacementId','originalStatus']) {
    const args=setup();args.report.checks[1][field]='fake';assert.throws(()=>gate.validateCandidate(args),undefined,field);
  }
  const mixed=setup();mixed.report.checks[1].probeIds=[change.probeSha256,'different'];assert.throws(()=>gate.validateCandidate(mixed));
  const omitted=setup();omitted.report.executedProbeHashes=[];assert.throws(()=>gate.validateCandidate(omitted),e=>e.code==='PROBE_NOT_EXECUTED');
});
test('commit records user approval and preserves failed superseded audit across subsequent updates',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'barun-policy-'));t.after(()=>fs.rmSync(folder,{force:true,recursive:true}));
  const registryPath=path.join(folder,'registry.json'),args=setup();fs.writeFileSync(registryPath,JSON.stringify(args.registry));
  const next=gate.commitRegistry({...args,registryPath});assert.equal(next.history[0].approvedChanges[0].userReason,'이거보단 1.5배키워줘');
  assert.equal(next.history[0].supersededChecks[0].originalStatus,'failed');assert.equal(next.history[0].supersededChecks[0].status,'superseded');
  assert.equal(gate.loadRegistry({registryPath}).archivedCriteria[0].id,change.fromId);
  args.registry=next;args.candidate.version='6.0.4';args.report.version='6.0.4';
  const after=gate.commitRegistry({...args,registryPath});assert.equal(after.approvedChanges.length,1);assert.deepEqual(after.history[1].approvedChanges,[]);
  args.registry=after;args.candidate.version='6.0.5';args.report.version='6.0.5';args.report.checks=args.report.checks.filter(c=>c.id!==change.fromId);
  assert.throws(()=>gate.validateCandidate(args),e=>e.code==='POLICY_AUDIT_MISSING');
});

const plot=policy.PLOT_DIALOG_CHANGE;
function plotSetup(){
  const registry=gate.createRegistry({schemaVersion:1,criteria:[{id:'UNRELATED',description:'unchanged required behavior'},{id:plot.fromId,description:'big preview output'}]});
  registry.probeHashes=[...plot.probeSha256s];
  const candidate={version:'6.0.12',artifactSha256:'b'.repeat(64),runId:'abcdef1234567890'};
  // Two retained probes both assert the old large preview; the verifier merges them into one superseded check.
  const first=policy.supersedeCheck({id:plot.fromId,status:'failed',detail:'Output preview is too small'},{version:candidate.version,probeHash:plot.probeSha256s[0]});
  const merged={...first,probeIds:[...plot.probeSha256s]};
  const report={schemaVersion:1,runnerId:gate.RUNNER_ID,...candidate,status:'passed',errors:[],executedProbeHashes:[...plot.probeSha256s,'c'.repeat(64)],checks:[{id:'UNRELATED',status:'passed'},merged,{id:plot.toId,status:'passed'}]};
  return {registry,candidate,report,proposedProbeHashes:['c'.repeat(64)],proposedCriteria:[{id:plot.toId,description:'AutoCAD plot dialog'}]};
}
test('AutoCAD plot dialog change supersedes the old large-preview check from both pinned probes only',()=>{
  const raw={id:plot.fromId,status:'failed'};
  assert.equal(policy.supersedeCheck(raw,{version:'6.0.11',probeHash:plot.probeSha256s[0]}),raw,'not before 6.0.12');
  assert.equal(policy.supersedeCheck(raw,{version:'6.0.12',probeHash:'0'.repeat(64)}),raw,'unpinned probe');
  for(const hash of plot.probeSha256s)assert.equal(policy.supersedeCheck(raw,{version:'6.0.12',probeHash:hash}).approvedChangeId,plot.id);
  const args=plotSetup(),out=gate.validateCandidate(args);
  assert.equal(out.criteria.some(c=>c.id===plot.fromId),false);assert.equal(out.archivedCriteria.some(c=>c.id===plot.fromId),true);
  assert.deepEqual(out.newApprovedChanges.map(c=>c.id),[plot.id]);
  const failed=plotSetup();failed.report.checks[2].status='failed';assert.throws(()=>gate.validateCandidate(failed),e=>e.code==='POLICY_REPLACEMENT_MISSING');
  const forged=plotSetup();forged.report.checks[1].probeIds=[plot.probeSha256s[0],'d'.repeat(64)];assert.throws(()=>gate.validateCandidate(forged));
});
test('registry with both approved changes stays valid and later updates still need the retired audit',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'barun-plot-policy-'));t.after(()=>fs.rmSync(folder,{force:true,recursive:true}));
  const registryPath=path.join(folder,'registry.json'),args=plotSetup();fs.writeFileSync(registryPath,JSON.stringify(args.registry));
  const next=gate.commitRegistry({...args,registryPath});assert.equal(next.history[0].approvedChanges[0].userReason,'이걸로 해 그대로 구현해');
  assert.deepEqual(gate.loadRegistry({registryPath}).approvedChanges.map(c=>c.id),[plot.id]);
  args.registry=next;args.candidate.version='6.0.13';args.report.version='6.0.13';args.report.checks=args.report.checks.filter(c=>c.id!==plot.fromId);
  assert.throws(()=>gate.validateCandidate(args),e=>e.code==='POLICY_AUDIT_MISSING');
});
