import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingEngine } from './engine.js';
import * as G from './geometry.js';
import { detectGpuTranslations } from './gpu-edit-translation.js';

const p=(x,y)=>({x,y}),line={id:'line',type:'line',layer:'0',points:[p(0,0),p(40,10)]};
const fixtures=[
  {id:'block',type:'block',layer:'0',name:'fixture',position:p(0,0),entities:[line,{id:'label',type:'text',layer:'0',position:p(3,7),height:5,text:'fixture'}]},
  {id:'text',type:'text',layer:'0',position:p(3,7),height:5,text:'fixture'},
  {id:'hatch',type:'hatch',layer:'0',points:[p(0,0),p(20,0),p(20,20),p(0,20)],pattern:'ANSI31',spacing:3},
  {id:'pattern',type:'hatch',layer:'0',points:[p(0,0),p(20,0),p(20,20),p(0,20)],patternLines:[{angle:45,base:p(0,0),offset:p(0,3),dashes:[]}]},
];
const engineFor=e=>{
  const engine=new DrawingEngine();engine.doc={version:2,units:'mm',layers:[{id:'0',name:'0',visible:true,color:'#ffffff',locked:false}],entities:[structuredClone(e)],blocks:[]};return engine;
};

test('actual engine MOVE, undo and redo retain nested blocks, text and hatch translations',()=>{
  for(const fixture of fixtures){
    const engine=engineFor(fixture);
    for(const command of [{type:'move',ids:[fixture.id],dx:123.25,dy:-64.5},{type:'undo'},{type:'redo'}]){
      const before=engine.doc.entities;engine.execute(command);
      const result=detectGpuTranslations(before,engine.doc.entities);
      assert.ok(result,fixture.type+' '+command.type);
      assert.deepEqual(result.get(fixture.id),command.type==='undo'?{dx:-123.25,dy:64.5}:{dx:123.25,dy:-64.5});
    }
  }
});

test('different per-source translations are proved without requiring a shared vector',()=>{
  const removed=[line,fixtures[1]],added=[G.translate(fixtures[1],4,8),G.translate(line,2,3)];
  assert.deepEqual([...detectGpuTranslations(removed,added)],[['line',{dx:2,dy:3}],['text',{dx:4,dy:8}]]);
});

test('all source content and styling remain authoritative',()=>{
  for(const change of [e=>e.color='#ff0000',e=>e.layer='other',e=>e.text='changed',e=>e.height=6,e=>e.rotation=1,e=>e.hidden=true,e=>e.attributes={customer:'changed'}]){
    const before=fixtures[1],after=G.translate(before,5,8);change(after);
    assert.equal(detectGpuTranslations([before],[after]),null);
  }
  const block=fixtures[0],after=G.translate(block,5,8);after.entities[0].points[1].x+=1;
  assert.equal(detectGpuTranslations([block],[after]),null);
  const hatch=fixtures[3],changed=G.translate(hatch,5,8);changed.patternLines[0].dashes=[1,2];
  assert.equal(detectGpuTranslations([hatch],[changed]),null);
});

test('rotation, scaling, renaming, duplicates and nonfinite displacement fail closed',()=>{
  assert.equal(detectGpuTranslations([line],[G.rotate(line,p(0,0),90)]),null);
  assert.equal(detectGpuTranslations([line],[G.resize(line,p(0,0),2)]),null);
  assert.equal(detectGpuTranslations([line],[{...G.translate(line,1,2),id:'copy'}]),null);
  assert.equal(detectGpuTranslations([line,line],[line,line]),null);
  assert.equal(detectGpuTranslations([line],[{...line,points:[p(Infinity,0),p(1,2)]}]),null);
  assert.equal(detectGpuTranslations([],[]),null);
  assert.equal(detectGpuTranslations([line],[]),null);
});

test('shared INSERT placement and attachments translate while definition identity stays fixed',()=>{
  const before={id:'insert',type:'block',layer:'0',sharedBlock:'definition',position:p(100,200),entities:[structuredClone(line)]};
  const after=G.translate(before,10,20);
  assert.deepEqual(detectGpuTranslations([before],[after]).get('insert'),{dx:10,dy:20});
  assert.ok(detectGpuTranslations([after],[before]));
  assert.equal(detectGpuTranslations([before],[{...after,sharedBlock:'different'}]),null);
});

test('large world coordinates tolerate arithmetic roundoff but metadata never gets that tolerance',()=>{
  const before={...line,points:[p(1e9+.1,-1e9+.2),p(1e9+100.3,-1e9+80.4)],attributes:{x:1e9}};
  const after=G.translate(before,.2,-.3);
  assert.ok(detectGpuTranslations([before],[after]));
  assert.ok(detectGpuTranslations([after],[before]));
  after.attributes.x+=Number.EPSILON*1e9;
  assert.equal(detectGpuTranslations([before],[after]),null);
});

test('multiple entities fail atomically when one replacement changes shape',()=>{
  const a=G.translate(line,1,2),b=G.translate(fixtures[1],3,4);b.height+=.01;
  assert.equal(detectGpuTranslations([line,fixtures[1]],[a,b]),null);
});
