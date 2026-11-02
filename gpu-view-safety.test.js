import test from 'node:test';
import assert from 'node:assert/strict';
import {gpuViewPending} from './gpu-view-safety.js';
const view={width:800,height:600,scale:2,origin:{x:200,y:100}};
const stats={enabled:true,active:true,backend:'MLightCAD Worker',viewPending:false,displayedView:view};
test('normal GPU and CPU keep existing input behavior',()=>{
 assert.equal(gpuViewPending({...stats,backend:'MLightCAD'},view),false);
 assert.equal(gpuViewPending({...stats,enabled:false,viewPending:true},view),false);
});
test('only the displayed camera may accept editing coordinates',()=>{
 assert.equal(gpuViewPending(stats,view),false);
 for(const target of [{...view,scale:3},{...view,width:801},{...view,origin:{x:200.25,y:100}}])assert.equal(gpuViewPending(stats,target),true);
 assert.equal(gpuViewPending({...stats,displayedView:null},view),true);
 assert.equal(gpuViewPending({...stats,viewPending:true},view),true);
 assert.equal(gpuViewPending({...stats,displayedRevision:2},{...view,revision:3}),true);
 assert.equal(gpuViewPending({...stats,displayedDoc:{}},{...view,doc:{}}),true);
});

test('aligned worker raster permits input for the same noisy CSS viewport only',()=>{
 const raw={...view,width:1172,height:492.3999938964844,pixelRatio:2.5};
 const displayed={...raw,height:492.4};
 const ready={...stats,displayedView:displayed};
 assert.equal(gpuViewPending(ready,raw),false);
 assert.equal(gpuViewPending(ready,{...raw,height:492.41}),true);
 assert.equal(gpuViewPending(ready,{...raw,origin:{x:raw.origin.x+.01,y:raw.origin.y}}),true);
});
