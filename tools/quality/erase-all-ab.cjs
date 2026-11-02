// Correct the keyboard target and reject non-deleting ERASE_ALL benchmark runs.
// Keep input phases and default GC flags; separate forced renderer collection.
const fs = require('node:fs');
const path = require('node:path');
const EXPECTED_PHASES=["OPEN_TO_SETTLED","SELECT_WINDOW_LARGE","SELECT_WINDOW_MEDIUM","ZOOM_IN_BURST_1","ZOOM_IN_BURST_2","ZOOM_IN_BURST_3","ZOOM_IN_BURST_4","ZOOM_IN_BURST_5","OFFSET_COMMIT","OFFSET_AFTER","OFFSET_UNDO","TRIM_COMMIT","TRIM_AFTER","TRIM_UNDO","TRIM_QUICK_COMMIT","TRIM_QUICK_AFTER","EXTEND_COMMIT","EXTEND_AFTER","EXTEND_UNDO","FILLET_COMMIT","FILLET_AFTER","MIRROR_COMMIT","MIRROR_AFTER","ROTATE_COMMIT","ROTATE_AFTER","ROTATE_UNDO","SCALE_COMMIT","SCALE_AFTER","SCALE_UNDO","ARRAY_3x3_COMMIT","ARRAY_3x3_AFTER","ARRAY_3x3_UNDO","STRETCH_COMMIT","STRETCH_AFTER","STRETCH_UNDO","HATCH_ADD_COMMIT","HATCH_ADD_AFTER","HATCH_ADD_UNDO","HATCH_SOLID_ADD_COMMIT","HATCH_SOLID_ADD_AFTER","HATCH_SOLID_ADD_UNDO","DIMLINEAR_COMMIT","DIMLINEAR_AFTER","DIMLINEAR_UNDO","TEXT_CREATE_COMMIT","TEXT_CREATE_AFTER","TEXT_EDIT_EXISTING_COMMIT","TEXT_EDIT_EXISTING_AFTER","TEXT_EDIT_EXISTING_UNDO","INSERT_BLOCK_COMMIT","INSERT_BLOCK_AFTER","INSERT_BIGGEST_BLOCK_COMMIT","INSERT_BIGGEST_BLOCK_AFTER","BLOCK_CREATE_COMMIT","BLOCK_CREATE_AFTER","EXPLODE_BIG_BLOCK_COMMIT","EXPLODE_BIG_BLOCK_AFTER","EXPLODE_BIG_BLOCK_UNDO","SAVE_CLIENT","TAB_NEW","TAB_SWITCH_TO_BIG","TAB_SWITCH_TO_SMALL","TAB_SWITCH_TO_BIG_2","RESIZE_SHRINK","RESIZE_RESTORE","LAYER_OFF_COMMIT","LAYER_OFF_AFTER","LAYER_OFF_UNDO","LAYER_ON_COMMIT","LAYER_ON_AFTER","LAYER_ON_UNDO","LAYER_FREEZE_COMMIT","LAYER_FREEZE_AFTER","LAYER_FREEZE_UNDO","LAYER_THAW_COMMIT","LAYER_THAW_AFTER","LAYER_THAW_UNDO","CHPROP_COLOR_LARGE_COMMIT","CHPROP_COLOR_LARGE_AFTER","CHPROP_COLOR_LARGE_UNDO","CHPROP_LAYER_LARGE_COMMIT","CHPROP_LAYER_LARGE_AFTER","CHPROP_LAYER_LARGE_UNDO","MOVE_LARGE_COMMIT","MOVE_LARGE_AFTER","MOVE_LARGE_UNDO","ERASE_LARGE_COMMIT","ERASE_LARGE_AFTER","ERASE_LARGE_UNDO","SELECT_ALL_COMMIT","SELECT_ALL_AFTER","ERASE_ALL_COMMIT","ERASE_ALL_AFTER","ERASE_ALL_UNDO","ERASE_ALL_REDO","ERASE_ALL_UNDO2"];
function replaceOnce(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Unexpected scenario source: '+from.slice(0,70));
  return source.replace(from, to);
}
function prepareScenario(source, {forceCollect=false}={}) {
  if ((source.match(/document\.dispatchEvent\(new KeyboardEvent/g)||[]).length !== 2) throw Error('Expected two document keyboard dispatches');
  source=source.replaceAll('document.dispatchEvent(new KeyboardEvent','c.dispatchEvent(new KeyboardEvent');
  source=replaceOnce(source,'out.selectAllCount=api.state().selected.length;',
    "out.selectAllIds=[...api.state().selected];out.eraseAllBefore=D.doc().entities.length;out.selectAllCount=out.selectAllIds.length;if(!out.selectAllCount)throw Error('ERASE_ALL selected zero objects');");
  source=replaceOnce(source,'  if(out.cmds.at(-1).committed){',
    "  out.eraseAllAfter=D.doc().entities.length;{const remaining=new Set(D.doc().entities.map(e=>e.id));out.eraseAllDeleted=out.selectAllIds.every(id=>!remaining.has(id));}delete out.selectAllIds;\n"+
    "  if(!out.cmds.at(-1).committed||out.cmds.at(-1).entDelta!==-out.selectAllCount||!out.eraseAllDeleted)throw Error('ERASE_ALL did not delete selected objects');\n  if(out.cmds.at(-1).committed){");
  for (const [phase,field,expected] of [['UNDO','eraseAllUndo','eraseAllBefore'],['REDO','eraseAllRedo','eraseAllAfter'],['UNDO2','eraseAllUndo2','eraseAllBefore']]) {
    const call="rows.push(await phase('ERASE_ALL_"+phase+"',async()=>{q.run('"+(phase==='UNDO2'?'UNDO':phase)+"');},2500));";
    source=replaceOnce(source,call,call+"out."+field+"=D.doc().entities.length;if(out."+field+"!==out."+expected+")throw Error('ERASE_ALL "+phase+" object count mismatch');");
  }
  // phase() used to run a full diagnostic collect + cache invalidation after
  // every summary. That perturbation is not a user input and can spill into
  // the next phase. Keep the original form available only for diagnostics.
  if(!forceCollect) {
    const begin=source.indexOf('  {const r=(typeof __renderer');
    const end=source.indexOf('\n  pub(row);return row;',begin);
    if(begin<0||end<0)throw Error('Missing phase renderer verification');
    source=source.slice(0,begin)+source.slice(end);
  }
  source=replaceOnce(source,"const out={errors:globalThis.__reviewErrors||[],cmds:[],skipped:[]};", "const out={errors:globalThis.__reviewErrors||[],cmds:[],skipped:[],benchmarkConditions:{forceCollect:"+forceCollect+",heapLimit:performance.memory?.jsHeapSizeLimit}};");
  return source;
}
function validateRun(report) {
  const problems=[],r=report.result||{},erase=r.cmds?.find(c=>c.name==='ERASE_ALL');
  if(report.status!=='completed')problems.push('status: '+report.status);
  if(r.errors?.length)problems.push('browser errors: '+r.errors.length);
  if(r.cmds?.some(c=>c.error))problems.push('command error');
  if(!(r.selectAllCount>0))problems.push('zero or missing selection');
  if(!erase?.committed)problems.push('ERASE_ALL did not commit');
  if(erase?.entDelta!==-r.selectAllCount)problems.push('deleted count does not match selection');
  if(r.eraseAllDeleted!==true)problems.push('selected IDs were not verified absent');
  if(r.eraseAllBefore-r.eraseAllAfter!==r.selectAllCount)problems.push('before/after count mismatch');
  if(r.eraseAllUndo!==r.eraseAllBefore||r.eraseAllUndo2!==r.eraseAllBefore||r.eraseAllRedo!==r.eraseAllAfter)problems.push('undo/redo count mismatch');
  const phases=report.phases?.filter(p=>p.summary)||[],names=new Set(phases.map(p=>p.name));
  if(names.size!==phases.length)problems.push('duplicate measured phase');
  if(phases.some(p=>['durationMs','longMax'].some(k=>!Number.isFinite(p.summary[k])||p.summary[k]<0)))problems.push('non-finite or negative timing');
  for(const name of ['ERASE_ALL_COMMIT','ERASE_ALL_AFTER','ERASE_ALL_UNDO','ERASE_ALL_REDO','ERASE_ALL_UNDO2'])if(!names.has(name))problems.push('missing '+name);
  return problems;
}
const median=values=>{const s=[...values].sort((a,b)=>a-b),i=s.length>>1;return s.length%2?s[i]:(s[i-1]+s[i])/2;};
function compareRuns(baseline,candidate,{minimumRuns=3,expectedPhases=EXPECTED_PHASES}={}) {
  for(const [label,runs] of [['baseline',baseline],['candidate',candidate]]) {
    if(runs.length<minimumRuns)throw Error(label+' needs '+minimumRuns+' valid runs');
    for(const [i,r] of runs.entries()){const p=validateRun(r);if(p.length)throw Error(label+' run '+(i+1)+': '+p.join('; '));const actual=new Set(r.phases.filter(p=>p.summary).map(p=>p.name));const missing=expectedPhases.filter(n=>!actual.has(n));if(missing.length)throw Error(label+' missing phase sample: '+missing.join(', '));if(actual.size!==expectedPhases.length)throw Error(label+' unexpected phase count: '+actual.size);}
  }
  const conditions=baseline[0].result.benchmarkConditions;
  if(typeof conditions?.forceCollect!=='boolean'||!Number.isFinite(conditions.heapLimit)||conditions.heapLimit<=0)throw Error('missing benchmark conditions');
  for(const r of [...baseline,...candidate]){const c=r.result.benchmarkConditions;if(!c||c.forceCollect!==conditions.forceCollect||c.heapLimit!==conditions.heapLimit)throw Error('benchmark conditions differ');}
  const names=new Set([...baseline,...candidate].flatMap(r=>r.phases.filter(p=>p.summary).map(p=>p.name)));
  const rows=[];
  for(const name of names) {
    const group=runs=>runs.map(r=>r.phases.find(p=>p.name===name)?.summary);
    const b=group(baseline),n=group(candidate);
    if(b.some(x=>!x)||n.some(x=>!x))throw Error('missing phase sample: '+name);
    const bd=median(b.map(s=>s.durationMs)),nd=median(n.map(s=>s.durationMs)),bl=median(b.map(s=>s.longMax)),nl=median(n.map(s=>s.longMax));
    const bw=Math.max(bd,bl),nw=Math.max(nd,nl);
    rows.push({name,baseline:{durationMs:bd,longMax:bl},candidate:{durationMs:nd,longMax:nl},slow:nw-bw>150&&nw>1.3*bw,fast:nw-bw < -150&&nw < .77*bw});
  }
  return {conditions:baseline[0].result.benchmarkConditions||null,runs:{baseline:baseline.length,candidate:candidate.length},phases:rows.length,slow:rows.filter(r=>r.slow),fast:rows.filter(r=>r.fast),erase:rows.filter(r=>r.name.startsWith('ERASE_ALL')),rows};
}
module.exports={prepareScenario,validateRun,compareRuns,EXPECTED_PHASES};
if(require.main===module) {
  const [command,a,b,c]=process.argv.slice(2);
  if(command==='prepare')fs.writeFileSync(b,prepareScenario(fs.readFileSync(a,'utf8')));
  else if(command==='compare') {
    const read=tag=>fs.readdirSync(a).filter(d=>d.includes('-sab-'+tag+'-full-plan-flat-')).sort().map(d=>JSON.parse(fs.readFileSync(path.join(a,d,'report.json'),'utf8')));
    console.log(JSON.stringify(compareRuns(read(b),read(c)),null,2));
  } else throw Error('Usage: prepare source.js output.js | compare runs-dir baseline-tag candidate-tag');
}
