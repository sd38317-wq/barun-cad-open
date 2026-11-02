import {sitePlanWaitEnabled} from './site-plan-wait.js';

const point = p => Array.isArray(p) ? [+p[0], +p[1]] : [+p?.x, +p?.y];
const finite = p => p.every(Number.isFinite);
const numeric = v => v !== null && v !== undefined && v !== '' && Number.isFinite(+v) ? +v : undefined;

// Convert CAD millimetres to the metre coordinates used by the wait screen.
export function apartmentMmToM(enclose, p) {
  const q = point(p), f = enclose?.engine?.frame || enclose?.frame;
  if (!finite(q)) return null;
  // frame 은 도면 좌표계 m(ox·oy)다. 5187 등이면 엔진 대지(5179)와 섞이니 아래 대지 짝 좌표로 맞춘다.
  if (f && (!f.crs || f.crs === 'EPSG:5179') && Number.isFinite(+f.ox) && Number.isFinite(+f.oy) && Number.isFinite(+f.ax) && Number.isFinite(+f.ay))
    return [+f.ox + (q[0] - +f.ax) / 1000, +f.oy + (q[1] - +f.ay) / 1000];
  const mm = enclose?.engine?.site_mm || enclose?.site_mm, site = enclose?.engine?.site || enclose?.site;
  if (Array.isArray(mm) && Array.isArray(site) && mm.length >= 2 && site.length >= 2) {
    const a = point(mm[0]), b = point(mm[1]), A = point(site[0]), B = point(site[1]);
    const dx=b[0]-a[0], dy=b[1]-a[1], len=Math.hypot(dx,dy), L=Math.hypot(B[0]-A[0],B[1]-A[1]);
    if (finite(a)&&finite(b)&&finite(A)&&finite(B)&&len>0&&L>0) {
      const s=L/len, c=(B[0]-A[0])/L, sn=(B[1]-A[1])/L, ec=dx/len, es=dy/len;
      return [A[0]+s*(c*(ec*(q[0]-a[0])+es*(q[1]-a[1]))-sn*(-es*(q[0]-a[0])+ec*(q[1]-a[1]))), A[1]+s*(sn*(ec*(q[0]-a[0])+es*(q[1]-a[1]))+c*(-es*(q[0]-a[0])+ec*(q[1]-a[1])))];
    }
  }
  return null;
}
const polyMm = (enclose, pts) => (Array.isArray(pts)?pts.map(p=>apartmentMmToM(enclose,p)).filter(Boolean):[]);

export function apartmentWaitReal(enclose={}) {
  const eng=enclose.engine||{}, site=(eng.site||enclose.site||[]).map(point).filter(finite);
  const parts=(eng.parts||[]).map(p=>{const x={zone:p.zone,area:numeric(p.area_m2),bcr:numeric(p.bcr),far:numeric(p.far)};if(Array.isArray(p.poly))x.poly=p.poly.map(point).filter(finite);else if(Array.isArray(p.points_mm))x.poly=polyMm(enclose,p.points_mm);return x;});
  const total=parts.reduce((s,p)=>s+(p.area||0),0), weighted=parts.reduce((s,p)=>s+(p.area||0)*(p.far||0),0);
  const out={address:eng.address||enclose.address||'',site,area:numeric(eng.site_area_m2)??numeric(enclose.site_area_m2),zone:[...new Set(parts.map(p=>p.zone).filter(Boolean))].join(' + '),pieces:parts};if(total&&parts.every(p=>Number.isFinite(p.far)&&Number.isFinite(p.area)))out.far_cap=weighted/total;return out;
}

export function apartmentWaitProgress(state={}, enclose={}) {
  const plans=(state.plans||[]).map(p=>({...p,buildings:(p.buildings||[]).map(b=>{const x={...b};if(Array.isArray(b.points_mm))x.poly=polyMm(enclose,b.points_mm);return x;})}));
  const out={status:state.status,plans,error:state.error};
  for(const k of ['current','done','elapsed_s']) if(Object.prototype.hasOwnProperty.call(state,k)&&state[k]!==undefined) out[k]=state[k];
  return out;
}

export function mountApartmentWaitFrame(viewport,enclose,{onClose=()=>{}}={}) {
  const doc=viewport?.ownerDocument, win=doc?.defaultView;
  if (!doc || !sitePlanWaitEnabled(doc)) return null;
  const shell=doc.createElement('dialog'); shell.setAttribute('aria-label','아파트 빠른 검토'); // 공용 대화상자 규칙(dialog-design.css 너비 780px·안쪽 여백, zoom .75)이 !important 라 같은 무게로 덮는다 — 안 덮으면 왼쪽 위에 작게 뜬다(10-28).
  const put=o=>{for(const [k,v] of Object.entries(o))shell.style.setProperty(k,v,'important');};
  put({position:'fixed',zoom:'1',margin:'0',padding:'0',border:'0','border-radius':'0','box-shadow':'none',background:'#101820','max-width':'none','max-height':'none',width:'0',height:'0',overflow:'hidden','z-index':'2147483000'});
  const iframe=doc.createElement('iframe'); iframe.src='wait-screens/apartment.html?embed=1'; iframe.title='아파트 빠른 검토';
  Object.assign(iframe.style,{position:'absolute',inset:'0',width:'100%',height:'100%',border:'0',zIndex:'20',background:'#101820'});
  let real=apartmentWaitReal(enclose), progress=null, dead=false;
  const origin=win?.location?.origin||''; const send=()=>{if(!dead&&iframe.contentWindow){iframe.contentWindow.postMessage({target:'barun-wait',cmd:'real',value:real},origin);if(progress)iframe.contentWindow.postMessage({target:'barun-wait',cmd:'progress',value:progress},origin);}};
  let loaded=false;iframe.addEventListener('load',()=>{loaded=true;send();}); const update=state=>{if(dead)return;const next=apartmentWaitProgress(state,enclose);progress={...progress,...next,plans:next.plans?.length?next.plans:(progress?.plans||[])};if(loaded)send();};
  const onMessage=e=>{if(e.source===iframe.contentWindow&&(!origin||e.origin===origin)&&e.data?.target==='barun-wait'&&e.data.cmd==='close')destroy();};win?.addEventListener('message',onMessage);
  shell.append(iframe); const layout=()=>{const r=viewport.getBoundingClientRect();put({left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});};
  const observer=win?.ResizeObserver?new win.ResizeObserver(layout):null;
  const destroy=()=>{if(dead)return;dead=true;observer?.disconnect();win?.removeEventListener('message',onMessage);win?.removeEventListener('resize',layout);shell.close?.();shell.remove();onClose();};
  shell.addEventListener('cancel',e=>{e.preventDefault();destroy();});
  shell.addEventListener('close',destroy);
  observer?.observe(viewport);
  win?.addEventListener('resize',layout); viewport.append(shell); layout(); try{shell.showModal?.();}catch{} return {element:iframe,update,destroy};
}
