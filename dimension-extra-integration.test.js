import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {AUTOCAD_COMMAND_MAP} from './pgp-aliases.js';
import {architectureReferenceCommands,architectureSourceCommands} from './architecture-command-pack.js';
import {DrawingEngine} from './engine.js';
import {runScripted,scriptedCommandNames,NeedInput} from './command-runner.js';
import {COMMANDS,resolveCommand,defaultAliases,defaultHotkeys,validateSettings,koreanNamesFor} from './commands.js';
import {rankCommandSearch} from './command-search.js';
import {MENU_CATALOG} from './menu-catalog.js';
import {QUICK_MENU_GROUPS} from './quick-menu.js';
import {dimensionParts} from './geometry.js';
import {prepareDimensionExport} from './dimension-export.js';
import {annotationScaleCommands} from './annotation-scale.js';
const P=(x,y)=>({x,y});
const fresh=()=>validateSettings({version:1,aliases:defaultAliases(),hotkeys:defaultHotkeys()});
test('four commands and nonconflicting aliases resolve in command input, search, menu and scripted execution',()=>{
 const settings=fresh(),names=scriptedCommandNames(),menus=Object.values(MENU_CATALOG).flatMap(tab=>tab.sections.flatMap(s=>s.commands));
 for(const [name,alias] of [['DIMARC','DARC'],['DIMJOGGED','DJO'],['DIMJOGGED','JOG'],['DIMORDINATE','DORD'],['DIMBREAK','DBRK']]){
  assert.equal(resolveCommand(name,settings),name);assert.equal(resolveCommand(alias,settings),name);assert.ok(names.includes(name));assert.ok(menus.includes(name));
  assert.ok(QUICK_MENU_GROUPS.find(g=>g.key==='dimension').commands.includes(name));
  assert.equal(rankCommandSearch(COMMANDS,alias,{aliases:settings.aliases,resolve:v=>resolveCommand(v,settings)})[0].command.name,name);
  for(const word of koreanNamesFor(name))assert.equal(resolveCommand(word,settings),name);
 }
});
test('DAR/DOR retain original names, settings, search, menus and architecture cards',()=>{
 const settings=fresh();settings.aliases.DAR='AREAOLD';settings.aliases.DOR='DOOROLD';
 settings.hotkeys.DOR='CTRL+ALT+O';settings.hotkeys.DAR='CTRL+ALT+A';settings.extraAliases={DAR:['OLD_AREA'],DOR:['OLD_DOOR']};
 validateSettings(settings);assert.equal(settings.aliases.DAR,'AREAOLD');assert.equal(settings.aliases.DOR,'DOOROLD');
 assert.equal(settings.hotkeys.DOR,'CTRL+ALT+O');assert.equal(settings.hotkeys.DAR,'CTRL+ALT+A');
 for(const [input,name] of [['DAR','DAR'],['DOR','DOR'],['AREAOLD','DAR'],['DOOROLD','DOR'],['OLD_AREA','DAR'],['OLD_DOOR','DOR'],['문회전','DOR'],['면적 숫자 넣기','DAR'],['평면문 회전','DOR']])assert.equal(resolveCommand(input,settings),name);
 const names=scriptedCommandNames(),menus=Object.values(MENU_CATALOG).flatMap(tab=>tab.sections.flatMap(s=>s.commands));
 for(const name of ['DAR','DOR']){
  assert.ok(names.includes(name));assert.ok(menus.includes(name));
  assert.equal(rankCommandSearch(COMMANDS,name,{aliases:settings.aliases,resolve:v=>resolveCommand(v,settings)})[0].command.name,name);
  const card=architectureReferenceCommands.find(c=>c.alias===name);assert.equal(card.nativeCommand,name);assert.equal(card.commandCode,name);
 }
 for(const name of ['AREATEXT','DOORROTATE']){assert.ok(!COMMANDS.some(c=>c.name===name));assert.ok(!names.includes(name));}
 assert.ok(!Object.hasOwn(settings.aliases,'AREATEXT'));assert.ok(!Object.hasOwn(settings.aliases,'DOORROTATE'));
});
test('DAR command input runs the original area text tool',async()=>{
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;
 const [id]=engine.execute({type:'add',entity:{type:'rectangle',layer,points:[P(0,0),P(4000,0),P(4000,3000),P(0,3000)]}});
 const result=await runScripted(engine,resolveCommand('DAR',fresh()),{entities:[id],points:[P(5000,0)]});
 const e=engine.doc.entities.find(e=>result.added.includes(e.id));assert.equal(e.type,'text');assert.equal(e.text,'12.00㎡');assert.equal(e.darSourceId,id);
});
test('DOR command input runs the original door rotation card',async()=>{
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;
 const [id]=engine.execute({type:'add',entity:{type:'line',layer,points:[P(0,0),P(900,0)]}});
 const result=await runScripted(engine,resolveCommand('DOR',fresh()),{selection:[id],form:{angle:30,recycle:false},paths:[{points:[P(0,0),P(0,-900)]}]});
 const added=engine.doc.entities.filter(e=>result.added.includes(e.id));assert.ok(added.some(e=>e.type==='arc'));assert.ok(added.some(e=>e.type==='line'));assert.ok(added.every(e=>e.type!=='dimension'));
 assert.deepEqual(engine.doc.entities.find(e=>e.id===id).points,[P(0,0),P(900,0)]);
});
const configs=[
 ['DIMARC',{type:'arc',center:P(0,0),radius:1000,startAngle:0,endAngle:90},{points:[P(1500,1500)]},'arcLength'],
 ['DIMJOGGED',{type:'circle',center:P(0,0),radius:1000},{points:[P(200,200),P(1500,400),P(600,300)]},'jogged'],
 ['DIMORDINATE',null,{points:[P(300,400),{option:'X'},{option:'A'},P(600,1000)],form:{value:35}},'ordinateX'],
];
for(const [fullName,source,baseInputs,mode] of configs)for(const input of [fullName,defaultAliases()[fullName],...(fullName==='DIMJOGGED'?['JOG']:[])])test(input+' commits one native dimension with active style and one undo step',async()=>{
 const name=resolveCommand(input,fresh());let inputs=baseInputs;
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;
 engine.execute({type:'document.update',changes:{dimStyles:{STANDARD:{name:'STANDARD',textHeight:20,arrowSize:10,scale:3,textGap:4}},currentDimStyle:'STANDARD'}});
 if(source)inputs={...inputs,entities:engine.execute({type:'add',entity:{...source,layer}})};
 const before=structuredClone(engine.doc);const result=await runScripted(engine,name,inputs);
 const e=engine.doc.entities.find(e=>result.added.includes(e.id));assert.equal(e.type,'dimension');assert.equal(e.mode,mode);assert.equal(e.layer,layer);
 assert.equal(e.dimStyle,'STANDARD');assert.equal(e.scale,3);assert.equal(dimensionParts(e).find(p=>p.dimensionLabel).height,60);
 const parts=prepareDimensionExport(engine.doc).entities.find(d=>d.id===e.id).dimensionDisplayParts;assert.deepEqual(parts,dimensionParts(e));
 const scaled=annotationScaleCommands([e],{from:100,to:200});assert.equal(scaled.commands[0].updates[0].changes.textHeight,40);
 engine.validate(engine.doc);engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});
test('DIMJOGGED missing a later point rolls back the transaction',async()=>{
 const engine=new DrawingEngine(),id=engine.execute({type:'add',entity:{type:'circle',layer:engine.doc.layers[0].id,center:P(0,0),radius:1000}})[0],before=structuredClone(engine.doc);
 await assert.rejects(runScripted(engine,'DIMJOGGED',{entities:[id],points:[P(100,200)]}),NeedInput);assert.deepEqual(engine.doc,before);
});
test('DIMBREAK scripted automatic and removal keep the editable dimension and undo the change',async()=>{
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;
 const ids=engine.execute({type:'addMany',entities:[{type:'dimension',mode:'horizontal',layer,textHeight:20,points:[P(0,0),P(1000,0),P(0,300)]},{type:'line',layer,points:[P(500,-500),P(500,800)]}]});
 const before=structuredClone(engine.doc);await runScripted(engine,resolveCommand('DBRK',fresh()),{entities:[ids[0]],points:[{option:'A'},P(0,0)]});
 const e=engine.doc.entities[0];assert.ok(e.breaks.length);assert.equal(e.id,ids[0]);assert.equal(e.type,'dimension');assert.equal(engine.doc.entities.length,2);
 assert.ok(dimensionParts(e).filter(p=>p.type==='line').length>3);
 await runScripted(engine,'DIMBREAK',{selection:[ids[0]],points:[{option:'R'},P(0,0)]});assert.equal(engine.doc.entities[0].breaks.length,0);
 engine.execute({type:'undo'});assert.ok(engine.doc.entities[0].breaks.length);engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});
test('both browser save entrypoints prepare native display geometry before encoding',()=>{
 const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
 assert.match(read('./app.js'),/path==='\/api\/export'[^\n]+prepareDimensionExport\(data.document\)/);
 assert.match(read('./studio.js'),/route==='export'[^\n]+prepareDimensionExport\(data.document\)/);
 const pkg=JSON.parse(read('./package.json'));for(const p of ['dimension-extra.test.js','dimension-extra-integration.test.js','dimension-export.test.js'])assert.ok(pkg.scripts.test==='node tools/run-node-tests.cjs'&&pkg.testFiles.includes(p));
});

test('lowercase DAR/DOR settings stay on the original commands',()=>{
 const settings=fresh();settings.aliases.DAR=' dar ';settings.aliases.DOR='dor';settings.extraAliases={DAR:['dar','OLD_AREA'],DOR:['Dor','OLD_DOOR']};validateSettings(settings);
 assert.equal(settings.aliases.DAR,'DAR');assert.equal(settings.aliases.DOR,'DOR');
 assert.equal(resolveCommand('DAR',settings),'DAR');assert.equal(resolveCommand('DOR',settings),'DOR');assert.equal(resolveCommand('OLD_AREA',settings),'DAR');assert.equal(resolveCommand('OLD_DOOR',settings),'DOR');
});
test('existing startup repair recovers development settings without moving DAR/DOR again',()=>{
 const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const body=source.match(/function repairSettings\(raw\) \{([\s\S]*?)\r?\n\}\r?\ntry \{/)[1];
 const repairSettings=new Function('validateSettings','raw',body).bind(null,validateSettings);
 const raw={version:1,aliases:{...defaultAliases(),AREATEXT:'ARTXT',DOORROTATE:'DROT',DIMARC:'DAR',DIMORDINATE:'DOR',LINE:'MYLINE'},hotkeys:{LINE:'CTRL+ALT+L',AREATEXT:'CTRL+ALT+A',DOORROTATE:'CTRL+ALT+O'},extraAliases:{AREATEXT:['OLD_AREA'],DOORROTATE:['OLD_DOOR']}};
 delete raw.aliases.DAR;delete raw.aliases.DOR;
 const before=structuredClone(raw),{settings,dropped}=repairSettings(raw);assert.deepEqual(raw,before);
 assert.ok(dropped.includes('DIMARC=DAR'));assert.ok(dropped.includes('DIMORDINATE=DOR'));
 assert.equal(resolveCommand('DAR',settings),'DAR');assert.equal(resolveCommand('DOR',settings),'DOR');assert.equal(resolveCommand('DARC',settings),'DIMARC');assert.equal(resolveCommand('DORD',settings),'DIMORDINATE');
 assert.equal(settings.aliases.LINE,'MYLINE');assert.equal(settings.hotkeys.LINE,'CTRL+ALT+L');
});
test('all command names, default/compatibility aliases and bundled Lisp command names have zero ownership collisions',()=>{
 const owners=new Map(),commandNames=new Set();
 const register=(token,owner)=>{if(!token)return;token=token.trim().toUpperCase();if(!owners.has(token))owners.set(token,new Set());owners.get(token).add(owner);};
 for(const c of COMMANDS){assert.ok(!commandNames.has(c.name),'duplicate command '+c.name);commandNames.add(c.name);register(c.name,c.name);register(c.alias,c.name);}
 const source=fs.readFileSync(new URL('./commands.js',import.meta.url),'utf8');
 const typed=vm.runInNewContext('('+source.match(/const AUTOCAD_TYPED_NAMES = Object.freeze\((\{[^\n]+\})\)/)[1]+')');
 const legacy=vm.runInNewContext('('+source.match(/\((\{LISP:[^\n]+\})\)\[key\]/)[1]+')');
 for(const map of [typed,legacy,AUTOCAD_COMMAND_MAP])for(const [token,owner] of Object.entries(map))register(token,owner);
 let lispFiles=0,lispCommands=0;
 const scan=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const url=new URL(entry.name+(entry.isDirectory()?'/':''),dir);if(entry.isDirectory())scan(url);else if(entry.name.endsWith('.lsp')){lispFiles++;const source=fs.readFileSync(url,'utf8');for(const match of source.matchAll(/\(defun\s+c:([^\s()]+)/gi)){lispCommands++;register(match[1],'lisp:'+url.pathname+':'+match[1].toUpperCase());}}}};
 scan(new URL('./examples/',import.meta.url));assert.ok(lispFiles>=24);assert.ok(lispCommands>=27);
 const clashes=[...owners].filter(([,targets])=>targets.size>1).map(([token,targets])=>[token,[...targets]]);assert.deepEqual(clashes,[]);
 for(const alias of ['DARC','DORD','DJO','JOG','DBRK'])assert.ok(!architectureSourceCommands.some(c=>c.alias.toUpperCase().split(/[,\s]+/).includes(alias)),'reserved manual Lisp name '+alias);
 validateSettings({version:1,aliases:defaultAliases(),hotkeys:defaultHotkeys()});
});
