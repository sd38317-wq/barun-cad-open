let active=null, cached=null;
export function closeDraftingWait(){active?.close();}
export function destroyDraftingWait(){cached?.destroy();}
const settingEnabled=()=>{try{return localStorage.getItem('barun.aiDrawReveal')!=='0';}catch{return true;}};

// Keep one initialized iframe: subsequent results only send new native geometry.
export function showDraftingWait(host,entities,{title,scale,onReady,enabled=settingEnabled}={}){
  closeDraftingWait();
  if(!host||document.hidden||!enabled()||entities?.length>4000)return null;
  if(cached?.host===host){cached.start({entities,title,scale,onReady});return cached;}
  destroyDraftingWait();
  const panel=document.createElement('section'),frame=document.createElement('iframe'),close=document.createElement('button');
  panel.setAttribute('aria-label','단면·상세 제도 공개');
  panel.style.cssText='position:absolute;inset:70px 12px 44px 12px;z-index:45;background:#1d2126;border:1px solid #718246;box-shadow:0 8px 24px #0008;visibility:hidden';
  frame.title='단면·상세 제도 공개';frame.src='./wait-screens/drafting.html?embed=1&live=1';
  frame.style.cssText='width:100%;height:100%;border:0';
  close.textContent='도면으로 돌아가기 ×';close.style.cssText='position:absolute;right:10px;bottom:10px;z-index:2;padding:8px 12px';
  panel.append(frame,close);host.append(panel);
  let opened=false,loaded=false,intersecting=true,ready=false,payload,readyCallback,runId=0,readyTimer=null;
  const send=(cmd,value)=>frame.contentWindow?.postMessage({target:'barun-wait',cmd,value},location.origin);
  const visibility=()=>send(!opened||document.hidden||panel.hidden||!intersecting?'pause':'resume');
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{
    intersecting=entries[0]?.isIntersecting!==false;visibility();
  });
  const message=ev=>{
    if(ev.source!==frame.contentWindow||ev.origin!==location.origin||ev.data?.source!=='barun-wait'||ev.data.kind!=='drafting')return;
    if(ev.data.event==='request-drawing'){loaded=true;if(opened)send('drawing',payload);visibility();}
    if(ev.data.event==='ready'&&opened&&ev.data.runId===payload.runId){
      clearTimeout(readyTimer);readyTimer=null;
      if(!ready){ready=true;panel.style.visibility='visible';readyCallback?.();}
      visibility();
    }
    if(ev.data.event==='close')api.close();
  };
  const key=ev=>{if(opened&&ev.key==='Escape'){ev.stopPropagation();api.close();}};
  const api={host,element:panel,send,
    start(value){payload={entities:value.entities,title:value.title,scale:value.scale,runId:++runId};readyCallback=value.onReady;
      opened=true;ready=false;panel.hidden=false;panel.style.visibility='hidden';active=api;
      clearTimeout(readyTimer);readyTimer=setTimeout(()=>api.destroy(),15000);
      if(loaded)send('drawing',payload);visibility();},
    close(){clearTimeout(readyTimer);readyTimer=null;opened=false;panel.hidden=true;send('pause');if(active===api)active=null;},
    destroy(){api.close();observer?.disconnect();frame.remove();panel.remove();
      document.removeEventListener('visibilitychange',visibility);window.removeEventListener('message',message);
      window.removeEventListener('cad-document-switched',api.close);window.removeEventListener('keydown',key,true);
      if(cached===api)cached=null;}
  };
  frame.onload=()=>{if(!frame.contentDocument?.getElementById('cv'))api.destroy();};
  close.onclick=api.close;observer?.observe(panel);
  document.addEventListener('visibilitychange',visibility);window.addEventListener('message',message);
  window.addEventListener('cad-document-switched',api.close);window.addEventListener('keydown',key,true);
  cached=api;api.start({entities,title,scale,onReady});return api;
}
