import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {encodeFull,decodeBcad,fileBytes} from './bcad-store.js';
import {alignImage,imageEntity,pixelToDrawing,commitImage,setImageTransport} from './image-underlay.js';
import {createImageRenderer,keyImagePaper,imageOpacity,imageUnderlaysFirst} from './image-render.js';
import {runScripted,describeCommand,createCommandClient} from './command-runner.js';
import {createBoundRequestHandler,prepareComputeRequest} from './bridge-client.js';

const createCanvas=()=>({getContext:()=>({drawImage(){},getImageData(){return {data:new Uint8ClampedArray([255,255,255,255])};},putImageData(){}})});
const source={data:'data:image/png;base64,AAAA',pixelWidth:200,pixelHeight:100};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const pointNear=(a,b)=>{near(a.x,b.x);near(a.y,b.y);};
const entity=()=>imageEntity({position:{x:10,y:20},width:400},source);

test('two-point alignment uses top-left pixels, rotation and uniform mm scale',()=>{
 for(const drawingPoints of [[[10,20],[210,20]],[[10,20],[10,220]],[[30,-80],[-30,-120]]]){
  const imagePoints=[[25,30],[125,60]],aligned=alignImage(200,100,{imagePoints,drawingPoints});
  const image={...aligned,...source};
  drawingPoints.forEach((p,i)=>pointNear(pixelToDrawing(image,imagePoints[i]),{x:p[0],y:p[1]}));
  near(image.width/image.height,2);
 }
 assert.throws(()=>alignImage(200,100,{imagePoints:[[0,0],[0,0]],drawingPoints:[[0,0],[1,1]]}));
 assert.throws(()=>alignImage(200,100,{imagePoints:[[0,0],[1,1]],drawingPoints:[[0,0],[0,0]]}));
 assert.throws(()=>alignImage(200,100,{imagePoints:[[-10,0],[1,1]],drawingPoints:[[0,0],[1,1]]}));
 near(imageEntity({position:{x:0,y:0},pxToMm:3},source).width,600);
 assert.equal(imageEntity({align:{imagePoints:[[0,0],[100,0]],drawingPoints:[[0,0],[1000,0]]}},source).width,2000);
});

test('IMAGE survives BCAD, transforms, delete and one-step undo including its nonplot layer',()=>{
 const engine=new DrawingEngine(),before=structuredClone(engine.doc);
 commitImage({doc:()=>engine.doc,execute:c=>engine.execute(c)},entity());
 assert.equal(engine.undoStack.length,1);
 const original=structuredClone(engine.doc),image=original.entities[0],layer=original.layers.find(l=>l.id===image.layer);
 assert.equal(layer.plot,false);assert.equal(layer.name,'밑그림');
 assert.deepEqual(decodeBcad(fileBytes(encodeFull(original))).doc,original);
 engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);engine.execute({type:'redo'});assert.deepEqual(engine.doc,original);
 engine.execute({type:'move',ids:[image.id],dx:100,dy:-50});
 pointNear(engine.doc.entities[0].position,{x:110,y:-30});
 const scaled=G.resize(image,{x:0,y:0},2);near(scaled.width,800);near(scaled.height,400);
 const rotated=G.rotate(image,{x:0,y:0},90);pointNear(rotated.position,{x:-20,y:10});near(rotated.rotation,90);
 engine.execute({type:'delete',ids:[image.id]});assert.equal(engine.doc.entities.length,0);
 engine.execute({type:'undo'});assert.equal(engine.doc.entities.length,1);engine.execute({type:'redo'});assert.equal(engine.doc.entities.length,0);
});

test('IMAGEATTACH scripted file input and IMAGEALIGN share UI commands and undo rules',async()=>{
 const engine=new DrawingEngine();
 const described=await describeCommand(engine.doc,'IMAGEATTACH');assert.equal(described.needs.what,'file');
 setImageTransport(async()=>source);
 try{
  await runScripted(engine,'IMAGEATTACH',{form:[{path:'C:/photo.png'},{width:400}],points:[[10,20]]});
  const image=engine.doc.entities[0];assert.equal(image.width,400);assert.equal(image.height,200);assert.equal(engine.undoStack.length,1);
  await runScripted(engine,'IMAGEALIGN',{entities:[image.id],points:[[10,220],[410,220],[100,200],[100,1000]]});
  const result=engine.doc.entities[0];near(result.width,800);near(result.rotation,90);
  pointNear(pixelToDrawing(result,[0,0]),{x:100,y:200});pointNear(pixelToDrawing(result,[200,0]),{x:100,y:1000});
  engine.execute({type:'undo'});assert.deepEqual(engine.doc.entities[0],image);
 }finally{setImageTransport(null);}
});

test('MCP preparation commits one image synchronously and rejects changed targets',async()=>{
 const engine=new DrawingEngine(),context={engine,execute:c=>engine.execute(c),assertAIRequest(){}};
 const binding={assert(){},current:()=>({revision:engine.undoStack.length})},target={revision:0},request={id:crypto.randomUUID(),expires_at:Date.now()+20000,action:'cad_insert_image',args:{target,path:'C:/photo.png',position:{x:0,y:0},width:500}};
 const handler=createBoundRequestHandler(context,binding);
 setImageTransport(async()=>source);
 try{
  const prepared=await prepareComputeRequest(context,binding,request),reply=handler(request,prepared);
  assert.equal(reply.error,undefined);assert.equal(engine.doc.entities[0].type,'image');near(engine.doc.entities[0].width,500);
  assert.equal(engine.undoStack.length,1);handler(request,prepared);assert.equal(engine.doc.entities.length,1);
  const next={...request,id:crypto.randomUUID()},stale=await prepareComputeRequest(context,binding,next);
  engine.execute({type:'move',ids:[engine.doc.entities[0].id],dx:1,dy:0});
  assert.ok(handler(next,stale).error);assert.equal(engine.doc.entities.length,1);
 }finally{setImageTransport(null);}
});

test('common raster pass keeps image orientation, fade and screen-sized mip selection',()=>{
 const calls=[],image={naturalWidth:200,naturalHeight:100};
 const renderer=createImageRenderer({createImage:()=>image,createCanvas});
 const ctx={globalAlpha:1,save(){this.oldAlpha=this.globalAlpha;},restore(){this.globalAlpha=this.oldAlpha;},transform(...args){calls.push(args);},drawImage(...args){calls.push({image:args[0],alpha:this.globalAlpha});}};
 const e=entity(),screen=p=>({x:p.x,y:1000-p.y});
 renderer.draw(ctx,[e],screen,1);image.onload();renderer.draw(ctx,[e],screen,1);
 assert.deepEqual(calls[0],[1,0,0,1,10,780]);assert.equal(calls[1].alpha,.5);
 renderer.draw(ctx,[{...e,rotation:90,fade:90}],screen,1);near(calls[3].alpha,.1);
 const before=calls.length;renderer.draw(ctx,[{...e,position:{x:-1000,y:0}}],screen,1,{width:100,height:100});assert.equal(calls.length,before);
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 assert.ok(app.indexOf('imageRenderer.draw(ctx,visible()',app.indexOf('function paintFrameInner()'))<app.indexOf('const gpuDrawn=gpuView.draw(ctx,gpuOptions)'));
});

test('all sources in a frame stay pinned when more than twelve images are visible',()=>{
 const images=[];let draws=0;
 const renderer=createImageRenderer({createCanvas,createImage:()=>{const image={naturalWidth:200,naturalHeight:100};images.push(image);return image;}});
 const ctx={globalAlpha:1,save(){},restore(){},transform(){},drawImage(){draws++;}};
 const entities=Array.from({length:13},(_,i)=>({...entity(),data:source.data+i}));
 const draw=()=>renderer.draw(ctx,entities,p=>({x:p.x,y:1000-p.y}),1);
 draw();images.forEach(i=>i.onload());draw();draw();
 assert.equal(images.length,13);assert.equal(draws,26);
});

test('desktop Worker delegates local image reads to the owning screen token',async t=>{
 const original={Worker:globalThis.Worker,fetch:globalThis.fetch,window:globalThis.window};
 t.after(()=>Object.assign(globalThis,original));
 let worker;const requests=[];
 globalThis.Worker=class{constructor(){worker=this;this.messages=[];}postMessage(m){this.messages.push(m);if(m.computeReply)this.reply?.(m.computeReply);}terminate(){}};
 globalThis.window={cadDesktop:{engineToken:async()=> 'screen-test-token'}};
 globalThis.fetch=async(url,options)=>{
  requests.push({url,options});
  return {ok:true,json:async()=>url==='/api/status'?{tokenPolicy:'desktop'}:source};
 };
 const client=createCommandClient();t.after(()=>client.stop());
 const pending=client.run(new DrawingEngine().doc,'IMAGEATTACH',{});
 const id=worker.messages[0].id;
 const reply=new Promise(resolve=>worker.reply=resolve);
 worker.onmessage({data:{id,compute:{call:1,action:'image.read',input:{path:'C:/photo.png'}}}});
 assert.deepEqual((await reply).result,source);
 assert.equal(requests[1].options.headers['X-CAD-Token'],'screen-test-token');
 worker.onmessage({data:{id,result:{ok:true}}});await pending;
});


test('paper key preserves source alpha and fade on both backgrounds without a white plate',()=>{
 const original=[255,255,255,255,0,0,0,255,128,128,128,255,0,0,0,128];
 const light=keyImagePaper(new Uint8ClampedArray(original)),dark=keyImagePaper(new Uint8ClampedArray(original),true);
 assert.deepEqual([...light],[0,0,0,0,0,0,0,255,0,0,0,127,0,0,0,128]);
 assert.deepEqual([...dark],[255,255,255,0,255,255,255,255,255,255,255,127,255,255,255,128]);
 assert.equal(imageOpacity(40),.6);assert.equal(imageOpacity(0),1);assert.equal(imageOpacity(100),0);
});

test('image underpasses precede all ink, including clipped block children',()=>{
 const image=entity(),line={type:'line'},block={type:'block',clip:{enabled:true},entities:[line,image]};
 const ordered=imageUnderlaysFirst([line,block,image]);
 assert.equal(ordered[0].entities[0],image);assert.equal(ordered[1],image);
 assert.equal(ordered[2],line);assert.equal(ordered[3].entities[0],line);assert.deepEqual(ordered[0].clip,block.clip);
});


test('plot-enabled IMAGE is below ink with fade; nonplot layers are excluded from SVG/PDF',async()=>{
 const {plotSVG,plotPDFJob}=await import('./plot.js');
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;
 const image={...entity(),layer,data:'data:image/png;base64,AAAA',fade:40},line={type:'line',layer,points:[{x:0,y:0},{x:500,y:300}]};
 engine.doc.entities=[line,image];
 const svg=plotSVG(engine.doc,{fit:true}),job=plotPDFJob(engine.doc,{fit:true});
 assert.ok(svg.indexOf('<image ')<svg.indexOf('<polyline '));assert.match(svg,/<image [^>]*opacity="0.6"/);
 assert.deepEqual(job.entities.map(e=>e.type),['image','line']);assert.equal(job.entities[0].fade,40);
 engine.doc.layers.push({id:'ref',name:'A-REF',visible:true,plot:false});image.layer='ref';
 assert.ok(!plotSVG(engine.doc,{fit:true}).includes('<image '));assert.deepEqual(plotPDFJob(engine.doc,{fit:true}).entities.map(e=>e.type),['line']);
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const reveal=app.slice(app.indexOf('function paintAIRevealFrame()'),app.indexOf('let propertiesDock='));
 assert.ok(reveal.indexOf('imageRenderer.draw(')<reveal.indexOf('const gpuDrawn=gpuView.draw('));
 const normal=app.slice(app.indexOf('function paintFrameInner()'));
 assert.ok(normal.indexOf('imageRenderer.draw(')<normal.indexOf('ctx.stroke();'));
});


test('SVG export embeds path-only images once and rejects non-raster responses',async()=>{
 const {embedPlotImages}=await import('./plot.js');let reads=0;
 const href='href="/api/image?path='+encodeURIComponent('C:/scan.jpg')+'"',svg='<svg><image '+href+'/><image '+href+'/></svg>';
 const embedded=await embedPlotImages(svg,{read:async path=>{assert.equal(path,'C:/scan.jpg');reads++;return source;}});
 assert.equal(reads,1);assert.equal(embedded.split(source.data).length,3);assert.ok(!embedded.includes('/api/image'));
 await assert.rejects(embedPlotImages(svg,{read:async()=>({data:'data:image/svg+xml;base64,AAAA'})}),/Invalid plot image/);
});
