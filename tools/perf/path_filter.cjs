// Top self functions for samples whose stack contains every given substring.
const fs=require('node:fs');const profile=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const needles=process.argv.slice(3);
const byId=new Map(profile.nodes.map(n=>[n.id,n]));const parent=new Map();for(const n of profile.nodes)for(const c of n.children||[])parent.set(c,n.id);
const name=n=>`${n.callFrame.functionName||'(anon)'} ${String(n.callFrame.url).split('/').pop().split('?')[0]}:${n.callFrame.lineNumber+1}`;
const chainCache=new Map();const chain=id=>{if(chainCache.has(id))return chainCache.get(id);const out=[];let x=id;while(x!==undefined){out.push(name(byId.get(x)));x=parent.get(x);}chainCache.set(id,out);return out;};
const counts=new Map();let total=0;const dt=profile.timeDeltas;const avg=(profile.endTime-profile.startTime)/profile.samples.length/1000;
profile.samples.forEach((id,i)=>{const c=chain(id);if(!needles.every(n=>c.some(f=>f.includes(n))))return;total++;const k=c[0];counts.set(k,(counts.get(k)||0)+1);});
console.log('matched ms ~',Math.round(total*avg));for(const [k,v] of [...counts].sort((a,b)=>b[1]-a[1]).slice(0,Number(process.env.TOP||14)))console.log('  ',Math.round(v*avg),'ms',k);
