// 5.0.4 보안 검토 BC-02/BC-03/BC-04 · CSP, 원격 코드 동의, innerHTML 외부 자료, 업데이트 검증
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {VOICE_MODEL_RUNTIME,VOICE_MODEL_CONSENT_KEY,askVoiceModelConsent,voiceModelConsented} from './chat.js';

const csp=html=>{const match=html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);assert.ok(match,'CSP meta missing');return Object.fromEntries(match[1].split(';').map(part=>part.trim()).filter(Boolean).map(part=>{const [name,...values]=part.split(/\s+/);return [name,values];}));};
test('index.html carries a strict CSP with no inline scripts; the only remote script origin is the pinned voice runtime',()=>{
 const html=fs.readFileSync('index.html','utf8'),policy=csp(html);
 assert.deepEqual(policy['default-src'],["'self'"]);assert.deepEqual(policy['object-src'],["'none'"]);assert.deepEqual(policy['base-uri'],["'self'"]);
 assert.ok(!policy['script-src'].includes("'unsafe-inline'"));assert.ok(!policy['script-src'].includes("'unsafe-eval'"));
 const remote=policy['script-src'].filter(v=>/^https?:/.test(v));assert.equal(remote.length,1);assert.ok(VOICE_MODEL_RUNTIME.startsWith(remote[0]));assert.match(remote[0],/transformers@3\.7\.2\/dist\/$/);
 assert.doesNotMatch(html,/<script>[^<]*<\/script>/);assert.match(html,/<html lang="ko" data-theme="dark"( data-barun-theme="air")?>/);
 assert.ok(policy['worker-src'].includes('blob:'));assert.ok(policy['connect-src'].includes("'self'"));
 const tablet=fs.readFileSync('tablet.html','utf8'),pad=csp(tablet);assert.deepEqual(pad['script-src'],["'self'"]);assert.deepEqual(pad['connect-src'],["'self'"]);
 const server=fs.readFileSync('server.py','utf8');assert.match(server,/X-Frame-Options', 'SAMEORIGIN' if urlparse\(self\.path\)\.path in \('\/wait-screens\/[^)]*\) else 'DENY'/);
 const py=fs.readFileSync('tablet.py','utf8');assert.match(py,/Content-Security-Policy/);assert.doesNotMatch(py,/'0\.0\.0\.0'/);
});
test('voice model download needs explicit consent that is remembered',()=>{
 const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 assert.equal(voiceModelConsented(storage),false);
 assert.equal(askVoiceModelConsent(()=>false,storage),false);assert.equal(voiceModelConsented(storage),false);
 let asked='';assert.equal(askVoiceModelConsent(text=>{asked=text;return true;},storage),true);assert.equal(store.get(VOICE_MODEL_CONSENT_KEY),'1');assert.match(asked,/cdn\.jsdelivr\.net/);assert.match(asked,/huggingface\.co/);
 const chat=fs.readFileSync('chat.js','utf8');assert.match(chat,/if\(!worker&&!voiceModelConsented\(\)\)/);assert.equal((chat.match(/https:\/\//g)||[]).length,1);
});
test('external data no longer flows through innerHTML in the panels this fix owns',()=>{
 const app=fs.readFileSync('app.js','utf8');
 assert.doesNotMatch(app,/row\.innerHTML=`<label><input type="checkbox">후보/);assert.doesNotMatch(app,/parcel-legal-list'\)\.innerHTML/);
 for(const file of ['design-cases-panel.js','auto-plan.js','tablet-control.js']){const source=fs.readFileSync(file,'utf8');for(const match of source.matchAll(/innerHTML=(`[^`]*`|'[^']*'|"[^"]*")/g))assert.doesNotMatch(match[1],/\$\{/,file+' interpolates into innerHTML');}
 assert.doesNotMatch(fs.readFileSync('chat.js','utf8'),/innerHTML=`[^`]*\$\{/);
});
test('BC-04: updater keeps sha512 verification (not disabled) and publishes only over https',()=>{
 const desktop=fs.readFileSync('desktop.cjs','utf8'),pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
 assert.doesNotMatch(desktop,/disableWebInstaller|allowDowngrade\s*=\s*true|verifySignature|checksum/);
 for(const target of pkg.build.publish||[])assert.match(target.url,/^https:\/\//);
});
