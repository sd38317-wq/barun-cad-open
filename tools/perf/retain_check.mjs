import * as G from 'file:///D:/어플/캐드/geometry.js';
import {getRetainedDisplayArtifact} from 'file:///D:/어플/캐드/display-instance.js';
import fs from 'node:fs';
const doc=JSON.parse(fs.readFileSync('D:/어플/캐드/tmp/review/full-plan.json','utf8'));
G.prepareSharedDrawingReferences(doc);
const shared=doc.entities.filter(e=>e.sharedBlock);
const allowed=new Set(['id','type','layer','name','sharedBlock','scale','rotation','color','colorMode','linetype','lineweight','linetypeScale','hidden','sourceHandle','sourceFingerprint','aci','position','entities']);
const why=e=>{const r=[];if(e.scale!==1)r.push('scale='+e.scale);if(e.rotation!==0)r.push('rotation='+e.rotation);if(e.clip)r.push('clip');if(e.parameters)r.push('parameters');if(e.xref)r.push('xref');if(!Array.isArray(e.entities)||e.entities.length)r.push('entities='+(e.entities?.length));const extra=Object.keys(e).filter(k=>!allowed.has(k));if(extra.length)r.push('keys:'+extra.join(','));return r.join(' ');};
let t=performance.now();for(const e of shared)G.visibleEntities(doc,{inPlace:true,lodScale:0,viewBox:null,entities:[e]});console.log('prewarm ms',Math.round(performance.now()-t));
const ctx={definitions:doc.sharedBlocks,styleKey:JSON.stringify([false,doc.linetypeScale,doc.layers])};
let retained=0,notRetained=[];for(const e of shared){if(getRetainedDisplayArtifact(e,ctx))retained++;else notRetained.push(e);}
console.log('shared',shared.length,'retained',retained);
const reasons={};for(const e of notRetained){const k=why(e)||'(valid canonical but not registered: children<128?)';reasons[k]=(reasons[k]||0)+1;}
console.log(Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,12));
// big ones not retained
const defs=doc.sharedBlocks;const size=n=>(defs[n]?.entities||[]).length;
console.log('largest not retained',notRetained.map(e=>[e.name||e.sharedBlock,size(e.sharedBlock),why(e)]).sort((a,b)=>b[1]-a[1]).slice(0,8));
t=performance.now();const all=G.visibleEntities(doc,{inPlace:true,lodScale:0,viewBox:null});console.log('full visible() after prewarm ms',Math.round(performance.now()-t),'entities',all.length);
t=performance.now();G.visibleEntities(doc,{inPlace:true,lodScale:0,viewBox:null});console.log('full visible() again ms',Math.round(performance.now()-t));
