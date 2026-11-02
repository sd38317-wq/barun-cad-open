// For each busy stretch (>=40 ms of consecutive non-idle samples) print what ran: top self functions and top call paths.
const fs=require('node:fs');
const profile=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const byId=new Map(profile.nodes.map(n=>[n.id,n]));const parent=new Map();
for(const n of profile.nodes)for(const c of n.children||[])parent.set(c,n.id);
const name=n=>`${n.callFrame.functionName||'(anon)'} ${String(n.callFrame.url).split('/').pop()}:${n.callFrame.lineNumber+1}`;
const idle=n=>['(idle)','(program)','(garbage collector)'].includes(n.callFrame.functionName)&&n.callFrame.functionName!=='(garbage collector)'||n.callFrame.functionName==='(idle)';
let t=profile.startTime;const samples=profile.samples.map((id,i)=>{t+=profile.timeDeltas[i];return {id,t};});
const runs=[];let cur=null;
for(let i=0;i<samples.length;i++){const s=samples[i],n=byId.get(s.id);const busy=!(n.callFrame.functionName==='(idle)');
 if(busy){if(!cur)cur={start:s.t,end:s.t,ids:[]};cur.end=s.t;cur.ids.push(s.id);}
 else if(cur){if(s.t-cur.end>3000){runs.push(cur);cur=null;}}}
if(cur)runs.push(cur);
const long=runs.filter(r=>(r.end-r.start)/1000>=40).sort((a,b)=>(b.end-b.start)-(a.end-a.start)).slice(0,Number(process.argv[3]||8));
for(const r of long.sort((a,b)=>a.start-b.start)){
 const self=new Map(),paths=new Map();
 for(const id of r.ids){const n=byId.get(id);self.set(name(n),(self.get(name(n))||0)+1);
  const chain=[];let x=id;while(x!==undefined){const m=byId.get(x);if(m.callFrame.url&&!/^node:|extensions::/.test(m.callFrame.url))chain.push(m.callFrame.functionName||'(anon)');x=parent.get(x);}
  const key=chain.reverse().filter(Boolean).slice(0,7).join(' > ');paths.set(key,(paths.get(key)||0)+1);}
 const ms=Math.round((r.end-r.start)/1000),per=r.ids.length?ms/r.ids.length:0;
 console.log(`\n== busy ${ms} ms at +${Math.round((r.start-profile.startTime)/1e6*10)/10}s`);
 for(const [k,v] of [...self].sort((a,b)=>b[1]-a[1]).slice(0,8))console.log('   self',Math.round(v*per),'ms',k);
 for(const [k,v] of [...paths].sort((a,b)=>b[1]-a[1]).slice(0,5))console.log('   path',Math.round(v*per),'ms',k);
}
