import test from 'node:test';
import assert from 'node:assert/strict';
import { CadGpuRenderer } from './gpu-renderer.js';
import { THREE } from './vendor/mlightcad.js';

function fixture(){
  const canvases=[];
  const previous=globalThis.document;
  globalThis.document={createElement(){
    const ctx={font:'',fills:[],save(){},restore(){},beginPath(){},rect(){},clip(){},
      measureText(text){return {width:String(text).length*parseFloat(this.font)*.6};},
      fillText(...args){this.fills.push(args);},rects:[],fillRect(...a){this.rects.push(a);}};
    const canvas={width:0,height:0,getContext(){return ctx;}};canvases.push(canvas);return canvas;
  }};
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{},textures:[],ownedMaterials:[],spatialObjects:new Map(),activeObjects:new Set()});
  return {r,canvases,restore(){r.clearScene();globalThis.document=previous;}};
}
const entry=(text,overrides={},z=.25,order=-1)=>({z,order,item:{color:'#ffffff',entity:{text,height:100,position:{x:20,y:30},...overrides}}});
const bounds=r=>{const b=new THREE.Box3().setFromObject(r.scene);return {minX:b.min.x,maxX:b.max.x,minY:b.min.y,maxY:b.max.y};};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.002,`${actual} != ${expected}`);

test('wide text is tiled at original resolution, retains baseline, width, and every character',()=>{
  const f=fixture();try{
    const text='가'.repeat(70),h=100,w=Math.ceil(70*h*1.15*.6+8),height=Math.ceil(h*1.6+8);
    f.r.addText([entry(text)],{x:0,y:0},1,1);
    assert.ok(f.r.stats.textAtlasTiles>1);assert.equal(f.r.stats.uniqueTextRasters,1);
    const b=bounds(f.r);close(b.minX,20-4);close(b.maxX,20-4+w);close(b.maxY,30+4+h*1.15);close(b.minY,30+4+h*1.15-height);
    for(const c of f.canvases.slice(1))for(const call of c.getContext().fills)assert.equal(call[0],text);
    for(const mesh of f.r.scene.children)for(const value of mesh.geometry.attributes.uv.array)assert.ok(value>=0&&value<=1);
  }finally{f.restore();}
});

test('repeated labels reuse pixels despite different position, rotation, alignment and width factor',()=>{
  const f=fixture();try{
    const text='가'.repeat(70),h=100,w=Math.ceil(70*h*1.15*.6+8),height=Math.ceil(h*1.6+8);
    const entries=Array.from({length:100},(_,i)=>entry(text,{position:{x:i*100,y:30}},i/200));
    f.r.addText(entries,{x:0,y:0},1,100);
    assert.equal(f.r.stats.textEntries,100);assert.equal(f.r.stats.uniqueTextRasters,1);
    assert.ok(f.r.stats.textAtlasPages<5);
    f.r.clearScene();
    f.r.addText([entry(text,{position:{x:20,y:30},rotation:90,widthFactor:2,align:'center'})],{x:10,y:5},1,1);
    const b=bounds(f.r),left=(-(w-8)/2-4),top=4+h*1.15;
    close(b.minX,10-top);close(b.maxX,10-top+height);close(b.minY,25+left*2);close(b.maxY,25+(left+w)*2);
  }finally{f.restore();}
});

test('tall multiline labels tile vertically without losing line spacing',()=>{
  const f=fixture();try{
    const lines=Array.from({length:60},(_,i)=>String(i)),h=100,height=Math.ceil(h*1.6+59*h*1.35+8);
    f.r.addText([entry(lines.join('\n'))],{x:0,y:0},1,1);
    assert.ok(f.r.stats.textAtlasTiles>=4);
    const b=bounds(f.r);close(b.maxY-b.minY,height);
    for(const c of f.canvases.slice(1)){
      const calls=c.getContext().fills;
      for(let i=1;i<calls.length;i++)if(i%lines.length)close(calls[i][2]-calls[i-1][2],h*1.35);
    }
  }finally{f.restore();}
});

test('atlas page reuse preserves painter sequence across A B A textures',()=>{
  const f=fixture();try{
    const text=Array.from({length:12},()=> 'a'.repeat(25)).join('\n');
    const a=entry(text,{},.1),b=entry(text.replaceAll('a','b'),{},.2),last=entry(text,{},.3);
    f.r.addText([a,b,last],{x:0,y:0},1,3);
    assert.equal(f.r.stats.textAtlasPages,2);assert.equal(f.r.scene.children.length,3);
    const meshes=f.r.scene.children;
    assert.equal(meshes[0].material,meshes[2].material);
    assert.notEqual(meshes[0].material,meshes[1].material);
    assert.ok(meshes[0].renderOrder<meshes[1].renderOrder&&meshes[1].renderOrder<meshes[2].renderOrder);
  }finally{f.restore();}
});

test('32-page limit is enforced during planning before large canvases allocate',()=>{
  const f=fixture();try{
    const entries=Array.from({length:33},(_,i)=>entry(Array.from({length:12},()=>String(i).padStart(2,'0')+'a'.repeat(23)).join('\n')));
    f.r.addText(entries,{x:0,y:0},1,33);
    assert.equal(f.r.textures.length,32);assert.equal(f.r.stats.textLabelsDropped,1);assert.equal(f.r.stats.uniqueTextRasters,32);assert.equal(f.r.textEntryCount,32);
  }finally{f.restore();}
});

test('different color and font do not share label rasters',()=>{
  const f=fixture();try{
    const a=entry('TEXT'),b=entry('TEXT'),c=entry('TEXT',{sourceFont:'malgun.ttf'});b.item.color='#ff0000';
    f.r.addText([a,b,c],{x:0,y:0},1,3);assert.equal(f.r.stats.uniqueTextRasters,3);
  }finally{f.restore();}
});

test('incremental distinct labels fill existing atlas pages instead of one page per command',()=>{
  const f=fixture();try{
    for(let i=0;i<100;i++)f.r.addText([entry('label '+i,{height:16},i/101)],{x:0,y:0},1,1);
    assert.equal(f.r.stats.textEntries,100);assert.equal(f.r.stats.uniqueTextRasters,100);
    assert.equal(f.r.textures.length,1);assert.equal(f.r.textPages.length,1);
    assert.ok(f.r.textures[0].version>=100,'existing texture uploads new labels');
  }finally{f.restore();}
});

function sourceFixture() {
  const r = Object.create(CadGpuRenderer.prototype);
  const make = (sources) => {
    const values = new Float32Array(sources.length * 18);
    sources.forEach((source, index) => {const x=(index+1)*10;values.set([x,5,0,x,0,0,x+4,0,0,x,5,0,x+4,0,0,x+4,5,0],index*18);});
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.Float32BufferAttribute(values, 3);
    geometry.setAttribute('position', attribute);
    const mesh = { geometry };
    const records = sources.map(sourceId => ({ sourceId }));
    return { mesh, records, attribute, original: values.slice() };
  };
  const first = make(['source-a', 'source-b']);
  const second = make(['source-a']);
  r.sourceTextMeshes = new Map([
    ['source-a', new Set([first, second])],
    ['source-b', new Set([first])]
  ]);
  return { r, first, second };
}

test('withoutTextSource hides only the requested source across shared atlas tiles', () => {
  const f = sourceFixture();
  f.r.withoutTextSource('source-a', () => {
    assert.deepEqual([...f.first.attribute.array.slice(0, 18)], Array.from({length:6},()=>[10,5,0]).flat());
    assert.deepEqual([...f.first.attribute.array.slice(18)], [...f.first.original.slice(18)]);
    assert.deepEqual([...f.second.attribute.array], Array.from({length:6},()=>[10,5,0]).flat());
  });
  assert.deepEqual([...f.first.attribute.array], [...f.first.original]);
  assert.deepEqual([...f.second.attribute.array], [...f.second.original]);
});

test('withoutTextSource restores every tile even when drawing throws', () => {
  const f = sourceFixture();
  assert.throws(() => f.r.withoutTextSource('source-a', () => {
    assert.equal(f.first.attribute.array[0], 10);assert.equal(f.first.attribute.array[3],10);assert.equal(f.first.attribute.array[4],5);
    throw new Error('render failed');
  }), /render failed/);
  assert.deepEqual([...f.first.attribute.array], [...f.first.original]);
  assert.deepEqual([...f.second.attribute.array], [...f.second.original]);
});

test('multiline center/right labels offset each line inside the atlas bitmap like canvas per-line textAlign',()=>{
  const text='AAAAAAAAAA\nBBBB',h=100,fs=h*1.15,rawW=10*fs*.6,short=4*fs*.6;
  const xs={};
  for(const align of ['left','center','right']){
    const f=fixture();try{
      f.r.addText([entry(text,{align})],{x:0,y:0},1,1);
      const b=bounds(f.r);
      const expectLeft=align==='center'?20-rawW/2-4:align==='right'?20-rawW-4:20-4;
      close(b.minX,expectLeft);close(b.maxX,expectLeft+Math.ceil(rawW+8));
      xs[align]=f.canvases.flatMap(c=>c.getContext().fills).filter(x=>x[0]==='BBBB').map(x=>x[1])[0];
    }finally{f.restore();}
  }
  close(xs.center-xs.left,(rawW-short)/2);close(xs.right-xs.left,rawW-short);
  const g=fixture();try{
    g.r.addText([entry(text,{align:'center'}),entry(text,{align:'right'}),entry(text,{align:'left'}),entry('one line',{align:'center'}),entry('one line',{align:'left'})],{x:0,y:0},1,1);
    assert.equal(g.r.stats.uniqueTextRasters,4);
  }finally{g.restore();}
});

test('backgroundMask labels paint the canvas mask rectangle (size estimate and padding) behind the text',()=>{
  const f=fixture();try{
    f.r.addText([entry('BBB',{backgroundMask:true})],{x:0,y:0},1,1);
    const rects=f.canvases.flatMap(c=>c.getContext().rects||[]);
    assert.equal(rects.length,1);
    close(rects[0][2],3*100*.65+2*25);close(rects[0][3],100*1.15+100*.25+2*25);
    const b=bounds(f.r);close(b.minX,20-25);assert.ok(Math.abs(b.maxY-(30+100*1.15+25))<=1.01);
  }finally{f.restore();}
  const g=fixture();try{
    g.r.addText([entry('BBB',{backgroundMask:true,align:'center'})],{x:0,y:0},1,1);
    close(bounds(g.r).minX,20-3*100*.65/2-25);
  }finally{g.restore();}
});
