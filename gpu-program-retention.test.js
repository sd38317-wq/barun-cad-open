import test from 'node:test';
import assert from 'node:assert/strict';
import {retainableProgramKey} from './gpu-renderer.js';

// A program may be kept for the renderer's lifetime only if its cache key fully
// determines its code. THREE's default key for a custom material is the source
// text of its onBeforeCompile, which cannot tell apart closures that inject
// different per-material code; reusing such a program drew a hatch island
// filled (Oncheon plan, 2026-09-28).
test('only self-describing program keys are retained',()=>{
  for(const key of ['basic,highp,srgb,false,,srgb,onBeforeCompile(){}','basic,srgb,onBeforeCompile(){}|barun-xclip-v1',
    'basic,srgb,cad-retained-opaque-v2:line:0:false:onBeforeCompile(){}','6,8,MAX_PATTERN_SEGMENT_COUNT,2,srgb,cad-retained-opaque-v2:pattern:7:true:onBeforeCompile(){}|barun-xclip-v1',
    'basic,srgb,cad-unified-transparent-prototype-v1:true'])assert.equal(retainableProgramKey(key),true,key);
  for(const key of ['basic,srgb,onBeforeCompile(){}|batchHighlightCompare','basic,srgb,(s,o)=>{n?.call(i,s,o),MH(s,t)}',
    'basic,srgb,cad-retained-opaque-v2:line:0:false:(s,o)=>{inject(s)}',undefined])assert.equal(retainableProgramKey(key),false,String(key));
});
