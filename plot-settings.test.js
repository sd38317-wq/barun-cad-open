import {plotSVG,plotPDFJob,embedPlotImages,automaticPlotColor,automaticPlotLineweight} from './plot.js';
import {visibleEntities} from './geometry.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const doc={layers:[{id:'x',visible:true,color:'#ff0000',lineweight:.5}],entities:[{type:'line',layer:'x',points:[{x:0,y:0},{x:10000,y:5000}]}]};
test('window plot uses matching clipping and scale for SVG and PDF',()=>{
 const window={minX:100,minY:200,maxX:1100,maxY:1200};const options={window,fit:true};const svg=plotSVG(doc,options),job=plotPDFJob(doc,options);
 assert.match(svg,/clip-path="url\(#plot-window\)"/);assert.deepEqual(job.bounds,window);assert.equal(job.entities[0].clip.enabled,true);assert.equal(job.entities[0].clip.points.length,4);
 assert.throws(()=>plotSVG(doc,{window:{...window,maxX:100}}));assert.throws(()=>plotPDFJob(doc,{window:{...window,minY:NaN}}));
});
test('nonplot layers stay visible on screen and block layer zero inherits its parent style',()=>{
 const d={layers:[{id:'a',name:'A',visible:true,color:'#ff0000',lineweight:.4},{id:'zero',name:'0',visible:true,color:'#ffffff'},{id:'np',name:'guide',visible:true,plot:false},{id:'dp',name:'Defpoints',visible:true}],entities:[{type:'block',layer:'a',entities:[{type:'line',layer:'zero',points:[{x:0,y:0},{x:10,y:10}]}]},{type:'text',layer:'np',position:{x:0,y:0},text:'GUIDE',height:1},{type:'text',layer:'dp',position:{x:0,y:0},text:'DEFPOINTS',height:1}]};
 assert.equal(visibleEntities(d).length,3);const output=visibleEntities(d,{plot:true});assert.equal(output.length,1);assert.equal(output[0].entities[0].color,'#ff0000');assert.equal(output[0].entities[0].lineweight,.4);assert.doesNotMatch(plotSVG(d),/GUIDE|DEFPOINTS/);
});
test('points print and hidden layers inside blocks stay hidden',()=>{
 const d=structuredClone(doc);d.layers.push({id:'hidden',visible:false,color:'#00ff00'});d.entities.push({type:'point',layer:'x',position:{x:100,y:100}},{type:'block',name:'mixed',layer:'x',entities:[{type:'text',layer:'hidden',text:'HIDDEN',position:{x:0,y:0},height:100},{type:'text',layer:'x',text:'VISIBLE',position:{x:0,y:0},height:100}]});
 const svg=plotSVG(d);assert.match(svg,/<circle cx="100"/);assert.match(svg,/VISIBLE/);assert.doesNotMatch(svg,/HIDDEN/);
});
test('text background mask prints as a white rectangle behind the text',()=>{
 const d={layers:[{id:'x',visible:true,color:'#000000'}],entities:[{type:'text',layer:'x',position:{x:100,y:200},text:'MASK',height:100,backgroundMask:true,maskPadding:25}]},svg=plotSVG(d,{fit:true});
 assert.match(svg,/<rect[^>]+fill="#ffffff"/);assert.ok(svg.indexOf('fill="#ffffff"')<svg.indexOf('MASK'));
});
test('physical scale, paper fit and orientation',()=>{
 assert.throws(()=>plotSVG(doc,{denominator:1}));
 const svg=plotSVG(doc,{fit:true,paper:'A4',orientation:'portrait'});
 assert.ok(svg.includes('width="210mm" height="297mm"'));
 assert.match(svg,/scale\(0\.020999/);
 assert.ok(plotSVG(doc,{denominator:100}).includes('scale(0.01)'));
});
test('plot uses the full paper with zero built-in margin or footer',()=>{
 const svg=plotSVG(doc,{fit:true,paper:'A4',orientation:'landscape'});
 assert.doesNotMatch(svg,/<rect x="5"|font-size="3"/);
 const job=plotPDFJob(doc,{fit:true,paper:'A4',orientation:'landscape'});
 assert.equal(job.margin,0);assert.equal(job.denominator,Math.max(10000/297,5000/210));
});
test('plot styles and weights do not mutate drawing',()=>{
 const before=JSON.stringify(doc);
 assert.ok(plotSVG(doc,{colorMode:'color'}).includes('stroke="#ff0000"'));
 assert.ok(plotSVG(doc,{colorMode:'gray'}).includes('stroke="#363636"'));
 assert.ok(plotSVG(doc,{lineweights:false}).includes('stroke-width="18"'));
 assert.ok(plotSVG(doc).includes('stroke-width="50"'));
 assert.equal(JSON.stringify(doc),before);
});

test('CTB overrides output color and physical width without changing drawing',()=>{
 const doc={layers:[{id:'a',visible:true,color:'#ffff00',lineweight:.25}],entities:[{id:'l',layer:'a',type:'line',points:[{x:0,y:0},{x:1000,y:0}]}]};const before=JSON.stringify(doc);
 const svg=plotSVG(doc,{denominator:100,colorMode:'ctb',plotStyle:{palette:{2:'#ffff00'},styles:{2:{color:'#ff0000',lineweight:.5,screen:50}}}});
 assert.match(svg,/stroke="#ff0000"/);assert.match(svg,/stroke-width="50"/);assert.match(svg,/opacity="0.5"/);assert.equal(JSON.stringify(doc),before);
});

test('CTB-free automatic output makes bright screen colors printable without changing drawing',()=>{
 const drawing={layers:[{id:'bright',visible:true,color:'#ffffff'}],entities:[{id:'wall',type:'line',layer:'bright',plotRole:'wall',points:[{x:0,y:0},{x:1000,y:0}]}]},before=JSON.stringify(drawing);
 assert.equal(automaticPlotColor('#ffffff'),'#000000');
 assert.notEqual(automaticPlotColor('#ffff00'),'#ffff00');
 const svg=plotSVG(drawing,{denominator:100,colorMode:'auto'});
 assert.match(svg,/stroke="#000000"/);assert.equal(JSON.stringify(drawing),before);
});

test('CTB mode without a loaded file safely falls back to automatic output',()=>{
 const drawing={layers:[{id:'bright',visible:true,color:'#00ffff'}],entities:[{type:'line',layer:'bright',points:[{x:0,y:0},{x:1000,y:0}]}]},before=JSON.stringify(drawing);
 const svg=plotSVG(drawing,{denominator:100,colorMode:'ctb',plotStyle:null});
 assert.doesNotMatch(svg,/stroke="#00ffff"/);assert.equal(JSON.stringify(drawing),before);
});

test('automatic lineweights use explicit values first and infer common drawing roles',()=>{
 assert.equal(automaticPlotLineweight({type:'line',lineweight:.7},{},'wall'),.7);
 assert.equal(automaticPlotLineweight({type:'line'},{lineweight:.55},'wall'),.55);
 assert.equal(automaticPlotLineweight({type:'hatch'},{},'hatch'),.1);
 assert.equal(automaticPlotLineweight({type:'text'},{},'text'),.18);
 assert.equal(automaticPlotLineweight({type:'line'},{},'center'),.13);
 assert.equal(automaticPlotLineweight({type:'line'},{},'wall'),.4);
});

test('plot dialog follows the AutoCAD layout: three columns with the live preview in the middle, CTB optional',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8'),css=readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(app,/dialog\.classList\.add\('plot-settings-dialog'\)/);
 assert.match(app,/values\.colorMode==='ctb'&&!loadedPlotStyle\)values\.colorMode='auto'/);
 assert.match(app,/previewPane\.append\(live,previewHeading,summary\)/);
 assert.match(app,/middleCol\.append\(previewPane\);fields\.append\(settingsPane,middleCol,rightCol\)/);
 assert.match(css,/#form-dialog\.plot-settings-dialog #form-fields\{[\s\S]*?grid-template-columns:minmax\(330px,410px\) minmax\(440px,1fr\)/);
});
test('AutoCAD plot options: offset from the printable corner, 180° mirror and lineweight scaling reach SVG and PDF',()=>{
 const doc={layers:[{id:'0',name:'0',color:'#000000',visible:true,lineweight:.5}],entities:[{id:'a',type:'line',layer:'0',points:[{x:0,y:0},{x:10000,y:5000}]}]};
 const base={paper:'A3',denominator:100,margin:10};
 const centered=plotSVG(doc,base),offset=plotSVG(doc,{...base,center:false,offsetX:5,offsetY:7});
 // 창 왼쪽 아래(0,0)가 인쇄 영역 왼쪽 아래 + (5,7) mm 에 온다: x = 10+5, y(위가 0) = 297-10-7
 assert.match(offset,/translate\(15 280\)/);assert.notEqual(centered,offset);
 assert.match(plotSVG(doc,{...base,mirror:true}),/rotate\(180 210 148\.5\)/);
 const width=svg=>Number(/stroke-width="([\d.]+)"/.exec(svg)[1]);
 assert.equal(width(plotSVG(doc,{...base,denominator:200,scaleLineweights:true})),width(plotSVG(doc,{...base,denominator:200}))/2,'1:200 이면 선가중치 절반');
 const job=plotPDFJob(doc,{...base,center:false,offsetX:5,offsetY:7,mirror:true,scaleLineweights:true,denominator:50});
 assert.deepEqual([job.center,job.offsetX,job.offsetY,job.mirror],[false,5,7,true]);
 assert.equal(job.entities[0].lineweight,plotPDFJob(doc,{...base,denominator:50}).entities[0].lineweight*2);
});
import {plotFitScale,PLOT_STANDARD_SCALES,multiPagePlotFit} from './plot.js';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const appSource=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const reportWindow={minX:0,minY:0,maxX:84100,maxY:59400};
const standardOptions={paper:'A3',orientation:'landscape',margin:10,fit:true,standardScales:PLOT_STANDARD_SCALES,window:reportWindow,title:'배치도 1:100'};
test('approved nearest standard fit: report, both directions, ties, custom list and small overflow',()=>{
 const fit=plotFitScale(84100,59400,420,297,10,PLOT_STANDARD_SCALES);
 assert.equal(fit.denominator,200);assert.match(fit.warning,/7\.3%/);
 assert.equal(plotFitScale(228*400,1,420,297,10,PLOT_STANDARD_SCALES).denominator,250);
 assert.equal(plotFitScale(225*400,1,420,297,10,[250,200]).denominator,250);
 assert.equal(plotFitScale(214.44*400,1,420,297,10,[100,300]).denominator,300);
 assert.match(plotFitScale(200.2*400,1,420,297,10,[200]).warning,/0\.1%/);
 assert.equal(plotFitScale(200*400,1,420,297,10,[200]).warning,'');
});
test('reported window has matching snapped SVG/PDF scale and explicit overflow policy; manual scale stays strict',()=>{
 const before=JSON.stringify(doc),svg=plotSVG(doc,standardOptions),job=plotPDFJob(doc,standardOptions);
 assert.match(svg,/data-plot-denominator="200"/);assert.match(svg,/scale\(0\.005\)/);
 assert.match(svg,/data-fit-warning="1:200 .*7\.3%/);
 assert.equal(job.denominator,200);assert.equal(job.standardFit,true);assert.deepEqual(job.bounds,reportWindow);
 assert.throws(()=>plotSVG(doc,{...standardOptions,fit:false,denominator:200}),/용지/);
 assert.throws(()=>plotPDFJob(doc,{...standardOptions,fit:false,denominator:200}),/용지/);
 assert.equal(JSON.stringify(doc),before);
 assert.match(appSource,/const SCALES=PLOT_STANDARD_SCALES/);
 assert.match(appSource,/standardScales:SCALES/);
 assert.match(appSource,/input\('scalePreset'\)\.value=SCALES\.includes\(used\)/);
 assert.match(appSource,/getAttribute\('data-plot-denominator'\)/);
});
test('actual readRaw retains disabled fields omitted by FormData',()=>{
 const controls={denominator:{value:'200',disabled:true},scalePreset:{value:'200',disabled:true},copies:{value:'2'},offsetX:{value:'5',disabled:true},offsetY:{value:'7',disabled:true},fit:{checked:true},center:{checked:true}};
 const source=appSource.slice(appSource.indexOf('const readRaw=()=>'),appSource.indexOf('const persist=raw=>'));
 const read=vm.runInNewContext(source+';readRaw',{propertyForm:{},CHECKS:['fit','center'],fields:{querySelector:s=>controls[/name="([^"]+)"/.exec(s)[1]]},FormData:class{*[Symbol.iterator](){yield ['printerName','virtual'];}}});
 const raw=read();assert.equal(raw.denominator,'200');assert.equal(raw.scalePreset,'200');assert.equal(raw.copies,'2');assert.equal(raw.offsetX,'5');assert.equal(raw.fit,'on');
});
test('actual print callback sends the reported window through printer validation and finishes a virtual service',async()=>{
 const {createPrinterService}=require('./desktop-print.cjs');const calls=[],html=[],events=[];
 class VirtualWindow{
  constructor(){this.webContents={setWindowOpenHandler(){},on(){},print:(o,cb)=>{events.push('print');calls.push(o);cb(true);}};}
  async loadURL(url){html.push(decodeURIComponent(url));}isDestroyed(){return false;}destroy(){}
 }
 const service=createPrinterService({platform:'win32',createPrinterSettings:()=>({open:async()=>events.push('open'),set:async(p,o)=>events.push(p+' '+o),restore:async()=>events.push('restore')}),BrowserWindow:VirtualWindow,getPrinters:async()=>[{name:'virtual'}]});
 const source=appSource.match(/const printDrawing=async raw=>[^\r\n]+/)[0];
 let persisted=false,notified=false;
 const callback=vm.runInNewContext(source+';printDrawing',{window:{cadDesktop:{printDrawing:p=>service.print(p)}},selectedPages:()=>[],multiMode:{checked:false},normalizePlotValues:r=>({...r,fit:r.fit==='on',window:reportWindow}),plotDocument:()=>doc,plotOptions:v=>({...standardOptions,...v}),plotSVG,embedPlotImages,persist:()=>{persisted=true;},toast:()=>{notified=true;}});
 await callback({printerName:'virtual',copies:'2',fit:'on',paper:'A3',orientation:'landscape'});
 assert.deepEqual(events,['open','A3 landscape','print','A3 landscape','print','restore']);assert.equal(calls.length,2);assert.equal(calls[0].deviceName,'virtual');assert.equal(calls[0].pageSize,'A3');assert.equal(calls[0].scaleFactor,100);
 assert.match(html[0],/data-plot-denominator="200"/);assert.equal(persisted,true);assert.equal(notified,true);
});
test('actual plot callback restores Windows settings on failed print and does not announce success',async()=>{
 const {createPrinterService}=require('./desktop-print.cjs'),events=[];
 class FailedWindow{
  constructor(){this.webContents={setWindowOpenHandler(){},on(){},print:(_o,cb)=>{events.push('print');cb(false,'fake printer failed');}};}
  async loadURL(){}isDestroyed(){return false;}destroy(){events.push('destroy');}
 }
 const service=createPrinterService({platform:'win32',BrowserWindow:FailedWindow,getPrinters:async()=>[{name:'virtual'}],createPrinterSettings:()=>({open:async()=>events.push('open'),set:async(p,o)=>events.push(p+' '+o),restore:async()=>events.push('restore')})});
 const source=appSource.match(/const printDrawing=async raw=>[^\r\n]+/)[0];
 const callback=vm.runInNewContext(source+';printDrawing',{window:{cadDesktop:{printDrawing:p=>service.print(p)}},selectedPages:()=>[],multiMode:{checked:false},normalizePlotValues:r=>r,plotDocument:()=>doc,plotOptions:()=>standardOptions,plotSVG,embedPlotImages,persist:()=>events.push('persist'),toast:()=>events.push('toast')});
 await assert.rejects(callback({printerName:'virtual',copies:'1',paper:'A3',orientation:'landscape'}),/fake printer failed/);
 assert.deepEqual(events,['open','A3 landscape','print','destroy','restore']);
});
test('snapped job renders through the real Python PDF service and preserves manual overflow rejection',()=>{
 const job=plotPDFJob(doc,standardOptions);
 const result=JSON.parse(execFileSync('python',['-c',`import sys,json,io,base64
from pdf_service import process
from pypdf import PdfReader
job=json.load(sys.stdin)
data=base64.b64decode(process(job)['data'])
pages=PdfReader(io.BytesIO(data)).pages
assert len(pages)==1
assert abs(float(pages[0].mediabox.width)-420*72/25.4)<.001
job.pop('standardFit')
try: process(job)
except ValueError: pass
else: raise AssertionError('manual overflow accepted')
print(json.dumps({'pages':len(pages),'bytes':len(data)}))`],{input:JSON.stringify(job),encoding:'utf8'}));
 assert.equal(result.pages,1);assert.ok(result.bytes>500);
});

// 2026-10-27 맥판 시험: PPP 다중 플롯이 실제 크기 A3 도곽(1:100)과 세로 출력 박스를 '용지에 들어가지 않습니다'로 막았다.
test('multiPagePlotFit: 박스 모양대로 가로·세로를 고르고, 정한 축척이 여백 안에 안 들어가면 용지에 맞춘다',()=>{
 assert.deepEqual(multiPagePlotFit({minX:0,minY:0,maxX:30000,maxY:20000},'A3',100,10),{orientation:'landscape',fit:'off'});
 assert.deepEqual(multiPagePlotFit({minX:0,minY:0,maxX:20000,maxY:30000},'A3',100,10),{orientation:'portrait',fit:'off'});
 assert.deepEqual(multiPagePlotFit({minX:0,minY:0,maxX:42000,maxY:29700},'A3',100,10),{orientation:'landscape',fit:'on'});
});
