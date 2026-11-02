#!/usr/bin/env node
// node tools/check-ai-reveal.mjs http://127.0.0.1:8851 [--renderer=both|canvas|gpu]
//   [--output=tmp/reveal-check] [--cdp=http://127.0.0.1:9222]
// PLAYWRIGHT_MODULE may name an installed playwright/playwright-core module.
// Uses a fresh browser context and verifies its MCP session before inserting anything.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {buildDetail} from '../detail-library.js';
import {translate} from '../geometry.js';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2), option = name => args.find(arg => arg.startsWith('--'+name+'='))?.slice(name.length+3);
const base = new URL(args.find(arg => !arg.startsWith('--')) || 'http://127.0.0.1:8851/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw Error('Use the local development server.');
const renderer = option('renderer') || 'both';
if (!['both','canvas','gpu'].includes(renderer)) throw Error('renderer must be both, canvas or gpu');
const output = option('output') && path.resolve(option('output'));
const home = process.env.USERPROFILE || process.env.HOME;
const modulePaths = [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core', home && path.join(home,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean);
let playwright;
for (const modulePath of modulePaths) { try { playwright = require(modulePath); break; } catch {} }
if (!playwright) throw Error('Install Playwright or set PLAYWRIGHT_MODULE to its installed location.');
const connectionPath = option('connection') || path.join(process.env.LOCALAPPDATA || '', 'BarunCAD', 'connection-'+(base.port || '80')+'.json');
const connection = JSON.parse(await fs.readFile(connectionPath, 'utf8'));
// The credentials belong to this exact development server; never send them to a supplied remote host.
if (new URL(connection.url).origin !== base.origin) throw Error('Connection file origin does not match the server URL.');
async function mcp(name, arguments_) {
  const response = await fetch(new URL('/api/mcp', base), {method:'POST', signal:AbortSignal.timeout(30000),
    headers:{'Content-Type':'application/json', 'X-CAD-Token':connection.token, Origin:base.origin},
    body:JSON.stringify({name, arguments:arguments_})});
  const result = await response.json();
  if (!response.ok || result.error || result.isError) {
    const error = new Error('MCP '+name+' failed: HTTP '+response.status+' ('+(result.code || 'tool error')+')');
    error.code = result.code;
    throw error;
  }
  return result;
}
const entities = [['wall-rc-ext',0], ['win-sill-lintel',5000], ['roof-flat',10000]].flatMap(([id,x]) =>
  buildDetail(id).entities.map(entity => translate(entity,x,-20000)));
if (entities.length !== 97) throw Error('The three-detail fixture changed: expected 97 entities, got '+entities.length);
const browser = option('cdp') ? await playwright.chromium.connectOverCDP(option('cdp')) : await playwright.chromium.launch({headless:true});
let failed = false;
try {
  for (const mode of renderer === 'both' ? ['canvas','gpu'] : [renderer]) {
    const context = await browser.newContext({viewport:{width:1440,height:1000}, deviceScaleFactor:1});
    try {
      const page = await context.newPage(), pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      // Observe module-local state in this test page only; production sources stay untouched.
      await page.route('**/app.js*', async route => {
        const response = await route.fetch();
        const source = await response.text(), marker = '  reveal.player.paint(ctx);';
        if (!source.includes(marker)) throw Error('Reveal paint hook was not found.');
        // Copy the actual base pixels before ink is composited. Comparing against
        // this frame removes moving grid/axis antialiasing and opaque GPU backgrounds.
        const observed = source.replace(marker,
          '  window.__checkAIRevealBase=ctx.getImageData(0,0,canvas.width,canvas.height);\n'+marker+'\n  window.__checkAIRevealObserve?.();');
        await route.fulfill({response, body:observed+
          '\nwindow.__checkAIReveal=()=>({active:!!aiReveal,progress:aiReveal?.player.progress??0,'+
          'durationMs:aiReveal?.plan.durationMs??0,clusters:aiReveal?.plan.clusters.length??0,cameraMoving:viewMoving,session:studio.context.getBridgeSession?.(),'+
          'entities:engine.doc.entities.length,handoff:!!aiReveal?.handoff,palette:getCanvasPalette(),'+
          'gpu:{enabled:gpuView.stats.enabled,active:gpuView.stats.active,reason:gpuView.stats.reason,backend:gpuView.stats.backend}});'+
          '\nconst checkFinishAIReveal=finishAIReveal;finishAIReveal=()=>{const images=aiReveal?'+
          '(window.__checkAIRevealImages={before:(aiReveal.handoff?.from||canvas).toDataURL(),last:canvas.toDataURL()}):null;'+
          'checkFinishAIReveal();if(images)requestAnimationFrame(()=>{images.after=canvas.toDataURL();});};'});
      });
      const url = new URL(base); url.pathname = '/'; url.search = mode === 'gpu' ? '?renderer=gpu' : '';
      await page.addInitScript(() => {localStorage.setItem('barun.aiDrawReveal','1');localStorage.setItem('barun-ai-sidebar','false');});
      await page.goto(url.href, {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => window.__checkAIReveal?.().session, null, {timeout:20000});
      const session = await page.evaluate(() => window.__checkAIReveal().session);
      if (await page.evaluate(() => window.__checkAIReveal().entities)) throw Error('The test page is not a blank drawing.');
      await page.bringToFront();
      let document_;
      for (let attempt=0; attempt<20; attempt++) {
        try { document_ = await mcp('cad_get_document', {editor_session:session}); }
        catch (error) { if (error.code !== 'reconnecting') throw error; }
        if (document_?.target?.editor_session === session) break;
        await page.waitForTimeout(300);
      }
      if (document_?.target?.editor_session !== session) throw Error('MCP is targeting a different editor; no insertion performed.');
      await page.evaluate(() => {
        const canvas = document.querySelector('#canvas'), ctx = canvas.getContext('2d');
        window.__checkAIRevealSamples=[];
        window.__checkAIRevealFrames=[];
        let seenInk=false;
        const sample = () => {
          const state = window.__checkAIReveal(), data = ctx.getImageData(0,0,canvas.width,canvas.height).data;
          const base = window.__checkAIRevealBase?.data;
          let pixels=0;
          for(let i=0;i<data.length;i+=4) {
            if(!state.active || !base || base.length!==data.length || !data[i+3]) continue;
            if(data[i]===base[i] && data[i+1]===base[i+1] && data[i+2]===base[i+2] && data[i+3]===base[i+3]) continue;
            pixels++;
          }
          const value={time:performance.now(),pixels,...state,palette:undefined,session:undefined};
          value.hasPreviousInk=seenInk;
          if(pixels>0)seenInk=true;
          return value;
        };
        // Observe every painted camera frame, not just the 100ms samples.
        // The initial approach has no ink yet and is explicitly excluded.
        window.__checkAIRevealObserve=()=>window.__checkAIRevealFrames.push(sample());
        window.__checkAIRevealTimer=setInterval(()=>window.__checkAIRevealSamples.push(sample()),100);
      });
      const result = await mcp('cad_execute', {target:document_.target, command:{type:'addMany', entities}, layer:'A-DETL'});
      if (result.added?.length !== 97) throw Error('MCP did not insert all 97 fixture entities: '+JSON.stringify({keys:Object.keys(result),added:result.added?.length,count:result.count,queued:result.queued}));
      await page.waitForFunction(() => window.__checkAIRevealSamples.some(s => s.active), null, {timeout:5000});
      const dir = output && path.join(output,mode);
      if (dir) await fs.mkdir(dir,{recursive:true});
      const deadline = Date.now()+22000;
      let frame=0, done=false;
      while (Date.now()<deadline) {
        if (dir) await page.screenshot({path:path.join(dir,String(frame++).padStart(3,'0')+'.png')});
        if (!(await page.evaluate(() => window.__checkAIReveal().active))) {done=true;break;}
        await page.waitForTimeout(300);
      }
      await page.waitForFunction(()=>window.__checkAIRevealImages?.after,null,{timeout:5000});
      const {samples,frames,images}=await page.evaluate(()=>{
        clearInterval(window.__checkAIRevealTimer);
        return {samples:window.__checkAIRevealSamples,frames:window.__checkAIRevealFrames,images:window.__checkAIRevealImages};
      });
      if(dir)for(const [name,data] of Object.entries(images))await fs.writeFile(path.join(dir,
        ({before:'before-handoff',last:'last-reveal',after:'after-reveal'}[name])+'.png'),Buffer.from(data.split(',')[1],'base64'));
      const differences=await page.evaluate(async images=>{
        const pixels=async url=>{
          const bytes=Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0));
          const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
          const surface=document.createElement('canvas');surface.width=bitmap.width;surface.height=bitmap.height;
          const target=surface.getContext('2d');target.fillStyle=window.__checkAIReveal().palette.background;target.fillRect(0,0,surface.width,surface.height);
          target.drawImage(bitmap,0,0);bitmap.close();return target.getImageData(0,0,surface.width,surface.height).data;
        };
        const [before,last,after]=await Promise.all([images.before,images.last,images.after].map(pixels));
        const difference=(a,b)=>{let changedPixels=0,total=0,maxChannelDelta=0;
          for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<3;c++){
            const delta=Math.abs(a[i+c]-b[i+c]);total+=delta;maxChannelDelta=Math.max(maxChannelDelta,delta);changed ||= delta>0;
          }if(changed)changedPixels++;}
          return {changedPixels,changedPercent:100*changedPixels/(a.length/4),meanChannelDelta:total/(a.length/4*3),maxChannelDelta};
        };
        return {unblended:difference(before,after),completion:difference(last,after)};
      },images);
      const active = samples.filter(s => s.active);
      const blankCameraFrames=frames.filter(s=>s.active&&s.cameraMoving&&s.hasPreviousInk&&s.pixels===0);
      const drops = samples.flatMap((sample,i) => i && sample.active && samples[i-1].active &&
        !sample.handoff && !sample.cameraMoving && !samples[i-1].cameraMoving && sample.pixels < samples[i-1].pixels*.2 ? [{time:sample.time,progress:sample.progress,
          previous:samples[i-1].pixels,pixels:sample.pixels}] : []);
      const arrivals = samples.flatMap((sample,i) => i && sample.active && !sample.handoff && !sample.cameraMoving && samples[i-1].cameraMoving ? [sample] : []);
      const missingInk = arrivals.filter(arrival => !samples.some(sample => sample.active && !sample.cameraMoving &&
        sample.time > arrival.time && sample.time <= arrival.time+300 && sample.progress > arrival.progress && sample.pixels > arrival.pixels));
      const final = await page.evaluate(() => window.__checkAIReveal());
      if (!done || active.length<10 || !active.some(s=>s.progress>=s.durationMs-(1000+(s.clusters-1)*700)-500) || !active.some(s=>s.clusters===3) || !active.some(s=>s.pixels>0))
        throw Error(mode+': a complete three-cluster reveal was not observed.');
      if (pageErrors.length) throw Error(mode+': browser errors: '+pageErrors.join('; '));
      if (mode==='gpu' && (!final.gpu.enabled || !final.gpu.active || final.gpu.reason))
        throw Error('GPU renderer did not run successfully: '+JSON.stringify(final.gpu));
      const report = {renderer:mode,entities:97,clusters:3,samples:active.length,
        maxSampleGapMs:Math.max(...active.slice(1).map((s,i)=>s.time-active[i].time)),cameraFrames:frames.filter(s=>s.cameraMoving&&s.hasPreviousInk).length,blankCameraFrames:blankCameraFrames.map(s=>({time:s.time,progress:s.progress})),differences,drops,arrivals:arrivals.length,missingInk:missingInk.map(s=>({time:s.time,progress:s.progress,pixels:s.pixels})),gpu:final.gpu};
      if (dir) await fs.writeFile(path.join(dir,'samples.json'),JSON.stringify({report,samples,frames},null,2));
      console.log(JSON.stringify(report));
      if (blankCameraFrames.length || drops.length || missingInk.length || arrivals.length<3) failed=true;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
if (failed) process.exitCode=1;
