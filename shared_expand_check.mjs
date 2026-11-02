// Flatten a document the way the app displays it (shared references expanded) and print comparable geometry.
// Used by test_shared_mirror_insert.py to prove mirrored/clipped shared references draw like the old expanded import.
import fs from 'node:fs';
import * as G from './geometry.js';
const doc=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
G.prepareSharedDrawingReferences(doc);
const shown=G.visibleEntities(doc,{plot:false,lodScale:0});
const out=[];const r=v=>Math.round(v*1e4)/1e4;const deg=v=>r(((v%360)+360)%360);
const walk=(e,clip)=>{
 const c=e.clip?{points:e.clip.points.map(p=>[r(p.x),r(p.y)]),inverted:!!e.clip.inverted}:clip;
 if(Array.isArray(e.entities)&&e.entities.length){for(const child of e.entities)walk(child,c);return;}
 const row={type:e.type,clip:c||null};
 if(e.type==='line'||e.type==='polyline')row.points=e.points.map(p=>[r(p.x),r(p.y)]);
 if(e.type==='arc'||e.type==='circle'){row.center=[r(e.center.x),r(e.center.y)];row.radius=r(e.radius);if(e.type==='arc'){row.start=deg(e.startAngle);row.end=deg(e.endAngle);}}
 if(e.type==='text'){row.position=[r(e.position.x),r(e.position.y)];row.rotation=deg(e.rotation||0);row.align=e.align||'left';row.text=e.text;row.height=r(e.height);}
 if(e.type==='hatch')row.loops=(e.loops||[]).map(l=>l.map(p=>[r(p.x),r(p.y)]));
 out.push(row);
};
for(const e of shown)walk(e,null);
console.log(JSON.stringify({shared:doc.entities.filter(e=>e.sharedBlock).length,mirror:doc.entities.filter(e=>e.mirror).length,clipped:doc.entities.filter(e=>e.sharedBlock&&e.clip).length,rows:out}));
