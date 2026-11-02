import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleEntities,materializeSharedDrawingReference,prepareSharedDrawingReferences} from './geometry.js';

const doc=()=>({layers:[{id:'L',name:'A',visible:true,frozen:false,color:'#123456',linetype:'CONTINUOUS',lineweight:2}],linetypeScale:1,entities:[{id:'e',type:'line',layer:'L',points:[{x:0,y:0},{x:1,y:1}]}]});

test('inPlace annotates display style as nonenumerable writable fields',()=>{
 const d=doc(),e=d.entities[0];visibleEntities(d,{inPlace:true});
 assert.equal(e._displayColor,'#123456');assert.equal(e._displayLinetype,'CONTINUOUS');assert.equal(e._displayLineweight,2);assert.equal(e._displayLinetypeScale,1);
 assert.deepEqual(Object.keys(e),['id','type','layer','points']);assert.equal(JSON.stringify(e).includes('_display'),false);
 e._displayColor='changed';visibleEntities(d,{inPlace:true});assert.equal(e._displayColor,'#123456');
});

test('inPlace preserves existing annotations and adds only missing fields',()=>{
 const d=doc(),e=d.entities[0];Object.defineProperty(e,'_displayColor',{value:undefined,writable:true,configurable:true,enumerable:false});e._displayLineweight='old';
 visibleEntities(d,{inPlace:true});assert.equal(e._displayColor,'#123456');assert.equal(e._displayLineweight,2);assert.equal(e._displayLinetype,'CONTINUOUS');assert.equal(e._displayLinetypeScale,1);
 for(const key of ['_displayColor','_displayLinetype','_displayLinetypeScale'])assert.equal(Object.prototype.propertyIsEnumerable.call(e,key),false);
});

test('ordinary clones discard cached display annotations and use current layer style',()=>{
 const d={layers:[{id:'L',name:'A',visible:true,frozen:false,color:'#123456',linetype:'OLD',lineweight:1}],linetypeScale:1,entities:[{id:'e',type:'line',layer:'L',points:[{x:0,y:0},{x:1,y:1}]}]};
 visibleEntities(d,{inPlace:true});d.layers[0].color='#abcdef';d.layers[0].linetype='NEW';d.layers[0].lineweight=3;d.linetypeScale=2;
 const result=visibleEntities(d)[0];assert.equal(result._displayColor,undefined);assert.equal(result.color,'#abcdef');assert.equal(result.linetype,'NEW');assert.equal(result.lineweight,3);assert.equal(result.linetypeScale,2);assert.equal(JSON.stringify(d.entities[0]).includes('_display'),false);
});


test('only detached shared display descendants use ordinary fields; saved/editable data stays clean',()=>{
 const d={layers:[{id:'L',name:'wall',visible:true,color:'#123456',linetype:'DASHED',lineweight:2},{id:'zero',name:'0',visible:true,color:'#ffffff'}],entities:[{id:'ref',type:'block',sharedBlock:'b',layer:'L',position:{x:10,y:20},scale:1,rotation:0,entities:[]}],sharedBlocks:{b:{origin:{x:0,y:0},entities:[{id:'line',type:'line',layer:'zero',colorMode:'byblock',linetype:'BYBLOCK',points:[{x:0,y:0},{x:2,y:3}]},{id:'hidden',type:'line',layer:'zero',hidden:true,points:[{x:0,y:0},{x:2,y:3}]}]}}};
 prepareSharedDrawingReferences(d);const before=JSON.stringify(d),display=visibleEntities(d,{inPlace:true})[0];
 assert.equal(display.entities.length,1);const leaf=display.entities[0];assert.equal(leaf._displayColor,'#123456');assert.equal(leaf._displayLinetype,'DASHED');assert.equal(Object.prototype.propertyIsEnumerable.call(leaf,'_displayColor'),true);
 assert.equal(JSON.stringify(d),before);assert.equal(Object.prototype.propertyIsEnumerable.call(d.entities[0],'_displayColor'),false);
 assert.equal(JSON.stringify(materializeSharedDrawingReference(d,d.entities[0])).includes('_display'),false);
 d.layers[0].color='#abcdef';assert.equal(visibleEntities(d,{inPlace:true})[0].entities[0]._displayColor,'#abcdef');
 d.layers[0].color='#fedcba';d.layers[0].linetype='CONTINUOUS';d.layers[0].lineweight=4;d.linetypeScale=3;
 const saved=JSON.stringify(d),ordinary=visibleEntities(d)[0].entities[0];assert.equal(ordinary._displayColor,undefined);assert.equal(ordinary._displayLinetype,undefined);assert.equal(ordinary._displayLineweight,undefined);assert.equal(ordinary._displayLinetypeScale,undefined);assert.equal(ordinary.color,'#fedcba');assert.equal(ordinary.linetype,'CONTINUOUS');assert.equal(ordinary.lineweight,4);assert.equal(ordinary.linetypeScale,3);assert.equal(JSON.stringify(ordinary).includes('_display'),false);assert.equal(JSON.stringify(d),saved);
});
