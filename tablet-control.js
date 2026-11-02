export function installTablet({api,onEvent,onDisconnect,toast,pad,view,drawingName}){
 const owner=crypto.randomUUID(),button=document.createElement('button');button.id='pad-office';button.dataset.padRole='office';button.textContent='사무실에서 보기';button.title='같은 Wi-Fi 의 패드로 이 PC 화면을 보고 조작합니다(사무실 패드)';document.querySelector('header .file-actions').append(button);
 let enabled=false,polling=false,connected=false;const dialog=document.createElement('dialog');dialog.innerHTML='<h2>패드 연결</h2><p>PC와 패드를 같은 Wi-Fi에 연결하세요.</p><div class="addresses"></div><p class="code"></p><p class="state"></p><button class="start">연결 시작 / 새 코드</button> <button class="stop">연결 종료</button> <button class="close">닫기</button>';document.body.append(dialog);
 // 새로 붙으면 같은 그림이라도 사진을 다시 보낸다(패드는 첫 사진을 기다린다)
 const setConnected=value=>{if(value&&!connected)lastImage='';connected=value;button.textContent=connected?'사무실에서 보기 · 연결됨':'사무실에서 보기';button.dataset.padState=connected?'connected':'';};
 // 도면 칸마다 프로세스: 다른 칸에 붙어 있던 패드를 이 칸으로 옮긴다(새 코드 없이, A15·A16).
 async function activate({announce=false}={}){
  try{const r=await api('tablet',{action:'claim',owner});if(!r.active)return false;enabled=true;setConnected(!!r.connected);lastImage='';pushInfo();if(announce&&r.paired)toast('패드를 이 도면으로 옮겼습니다.');return r.paired;}catch{return false;}
 }
 button.onclick=async()=>{if(!enabled&&await activate({announce:true}))return;dialog.showModal();};dialog.querySelector('.close').onclick=()=>dialog.close();
 const startPad=async address=>{try{const r=await api('tablet',{action:'start',owner,...(address?{address}:{})});enabled=true;onDisconnect();dialog.querySelector('.addresses').replaceChildren(...r.urls.map((url,i)=>{const p=document.createElement('div'),address=document.createElement('p'),img=document.createElement('img');address.textContent=url;img.src=r.qr[i];img.alt='패드 연결 QR';img.style.cssText='width:160px;height:160px;background:white';p.append(img,address);return p;}));
  // BC-03: 고른 LAN 주소 하나에만 연다. 다른 네트워크 주소가 더 있으면 골라서 다시 열 수 있다.
  for(const other of (r.addresses||[]).filter(a=>a!==r.bound)){const b=document.createElement('button');b.type='button';b.textContent=other+' 주소로 열기';b.onclick=()=>startPad(other);dialog.querySelector('.addresses').append(b);}
  dialog.querySelector('.code').textContent='연결 코드: '+r.code+' ('+Math.round((r.expiresIn||180)/60)+'분 이내 입력 · 패드가 '+Math.round((r.idleLimit||600)/60)+'분 조용하면 자동 종료)';dialog.querySelector('.state').textContent=r.urls.length?'패드 브라우저에 위 주소를 입력하세요. 이 주소('+r.bound+')에서만 연결을 받습니다.':'Wi-Fi 주소를 찾지 못했습니다. PC 네트워크 연결을 확인하세요.';}catch(e){toast(e.message,true);}};
 dialog.querySelector('.start').onclick=()=>startPad();
 dialog.querySelector('.stop').onclick=async()=>{try{await api('tablet',{action:'stop',owner});}finally{enabled=false;setConnected(false);onDisconnect();dialog.querySelector('.state').textContent='연결 종료';}};
 async function poll(){if(!enabled||polling)return;polling=true;try{const r=await api('tablet',{action:'poll',owner});
   if(r.moved){enabled=false;setConnected(false);onDisconnect();return;}   // 다른 도면 칸이 패드를 가져감 — 조용히 쉰다
   if(connected&&!r.connected)onDisconnect();if(!connected&&r.connected&&dialog.open)dialog.close();setConnected(r.connected);for(const e of r.events)onEvent(e);}
  catch(e){enabled=false;onDisconnect();toast('패드 연결 종료: '+e.message,true);}finally{polling=false;}}
 // 화면 사진: 펜을 긋는 동안은 쉬고(와이파이 비우기, A13), 같은 그림이면 다시 안 보낸다. 사진마다 그때의 보기를 기억해
 // 패드가 그 사진 위에 그은 점을 정확한 도면 좌표로 옮긴다(A19).
 let frameBusy=false,frameErrorAt=0,lastImage='',infoTimer=null;const capture=document.createElement('canvas');
 const info=()=>{const v=view(),source=document.getElementById('canvas'),ratio=source?.width?capture.width/source.width:1,dpr=source?.width&&v.width?source.width/v.width:1;return {drawing:drawingName(),...pad.info(),unitsPerPixel:1/(v.scale*dpr*(ratio||1))};};
 function pushInfo(){if(!enabled||!connected)return;clearTimeout(infoTimer);infoTimer=setTimeout(()=>api('tablet',{action:'info',owner,info:info()}).catch(()=>{}),50);}
 async function shareFrame(){if(!enabled||!connected||frameBusy||pad.busy)return;const source=document.getElementById('canvas');if(!source?.width||!source?.height)return;frameBusy=true;try{
   const ratio=Math.min(1,2048/source.width),shown=view();capture.width=Math.round(source.width*ratio);capture.height=Math.round(source.height*ratio);capture.getContext('2d').drawImage(source,0,0,capture.width,capture.height);
   let image=capture.toDataURL('image/jpeg',.8);if(image.length>1900000)image=capture.toDataURL('image/jpeg',.6);
   if(image===lastImage)return;lastImage=image;
   const r=await api('tablet',{action:'frame',owner,image,width:source.width,height:source.height,info:info()});if(Number.isInteger(r?.id))pad.rememberFrame(r.id,shown);}
  catch(e){lastImage='';if(Date.now()-frameErrorAt>10000){frameErrorAt=Date.now();toast('패드 화면 전송 재시도: '+e.message,true);}}finally{frameBusy=false;}}
 setInterval(shareFrame,300);setInterval(poll,40);window.addEventListener('pagehide',()=>{if(enabled)api('tablet',{action:'stop',owner}).catch(()=>{});enabled=false;});
 // 패드가 화면을 옮겼으면 그림이 같아도 새 사진을 보낸다 — 패드는 그 사진을 받아야 맞춤 보기로 돌아온다
 return {get connected(){return connected;},activate,pushInfo,refresh(){lastImage='';}};
}
