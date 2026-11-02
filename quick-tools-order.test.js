import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedQuickGroups,moveQuickTool} from './quick-tools-order.js';
const defaults=[['SELECT'],['LINE','PLINE','RECTANGLE'],['COPY','MOVE']];
test('saved quick-tool order is trusted only for known commands; missing defaults come back',()=>{
 assert.deepEqual(orderedQuickGroups(defaults,null),defaults);
 assert.deepEqual(orderedQuickGroups(defaults,[['SELECT'],['RECTANGLE','LINE','EVIL'],['MOVE','COPY','LINE']]),[['SELECT'],['RECTANGLE','LINE','PLINE'],['MOVE','COPY']]);
 assert.deepEqual(orderedQuickGroups(defaults,[['LINE']]),defaults,'group count mismatch falls back to defaults');
});
test('a dragged tool moves before/after a target, across groups, or to the end of a group',()=>{
 assert.deepEqual(moveQuickTool(defaults,'RECTANGLE',{group:1,target:'LINE',before:true}),[['SELECT'],['RECTANGLE','LINE','PLINE'],['COPY','MOVE']]);
 assert.deepEqual(moveQuickTool(defaults,'LINE',{group:2,target:'COPY',before:false}),[['SELECT'],['PLINE','RECTANGLE'],['COPY','LINE','MOVE']]);
 assert.deepEqual(moveQuickTool(defaults,'SELECT',{group:2}),[[],['LINE','PLINE','RECTANGLE'],['COPY','MOVE','SELECT']]);
 assert.equal(moveQuickTool(defaults,'LINE',{group:1,target:'LINE'}),defaults);
});
