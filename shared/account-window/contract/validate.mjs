import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const ui=read('account-window.json'), repair=read('self-repair.json'), sso=read('sso-contract.json'), work=read('work-order.json');
const all=[ui,repair,sso,work,...sso.apps.map(a=>read('apps/'+a+'.json'))];
all.forEach(x=>assert.equal(x.schemaVersion,'2.0.0'));
assert.deepEqual(ui.sections.map(s=>s.id),['header','account','ai','update','footer']);
assert.equal(ui.theme.kakaoBackground,'#FEE500');
assert(ui.excluded.includes('file-association'));
assert(ui.excluded.includes('separate-small-login-dialog'));
assert.equal(new Set(ui.actions.map(a=>a.id)).size,ui.actions.length);
assert.equal(repair.entryAction,'repair.diagnose');
assert(ui.actions.find(a=>a.id==='auth.login').enabledWhen.includes('LocallyDisconnected'));
assert(sso.manualReconnect.includes('실패 시 억제를 유지'));
const stepIds=new Set(repair.allowlistedSteps.map(s=>s.id));
for(const c of repair.checks){assert.equal(c.readOnly,true); if(c.fix) assert(stepIds.has(c.fix));}
for(const a of sso.apps){const cfg=read('apps/'+a+'.json'); assert.equal(cfg.appId,a); assert.equal(cfg.contract,'../account-window.json'); assert(cfg.officialIconAsset===null||(typeof cfg.officialIconAsset==='string'&&/^[\w.\/-]+\.(png|svg|ico)$/i.test(cfg.officialIconAsset)&&!cfg.officialIconAsset.includes('..')));}   // 확인된 공식 아이콘은 앱 안의 파일 경로만(외부 URL 금지)
assert.equal(repair.timeouts.maxRetriesPerStep,1);
assert(repair.prohibited.includes('문서·Vault·스킬·설정·캐시 파일 삭제'));
console.log('PASS: 8 JSON files, section order, Kakao color, exclusions, app references, repair allowlist and safety invariants.');
console.log('NOT RUN: actual renderer, SSO, repair handlers, screenshots and product integration.');
