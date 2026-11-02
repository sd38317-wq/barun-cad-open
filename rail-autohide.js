// 오른쪽 세로 탭 띠 자동 숨김.
// 패널이 모두 닫혀 있으면 도면 오른쪽 가장자리에 얇은 띠(8px)만 남긴다.
// 마우스가 띠에 닿으면 0.12초 뒤 탭 띠를 펼치고, 벗어나면 0.4초 뒤 다시 접는다(깜빡임 방지).
// 키보드로 탭 단추에 초점이 오면 바로 펼치고, 터치·펜은 띠를 누르면 펼쳤다가 바깥을 누르면 접는다.
// 패널(AI 대화·건축·계획·검수…)이 열려 있는 동안에는 늘 보인다(.is-collapsed 가 아니므로 CSS 가 너비를 준다).
export const RAIL_OPEN_DELAY=120;
export const RAIL_CLOSE_DELAY=400;
export const RAIL_REVEALED_CLASS='rail-revealed';
export const RAIL_AUTOHIDE_CLASS='rail-autohide';

export function installRailAutoHide(workspace,{timers=globalThis,doc=globalThis.document,openDelay=RAIL_OPEN_DELAY,closeDelay=RAIL_CLOSE_DELAY}={}){
 if(!workspace)return null;
 workspace.classList.add(RAIL_AUTOHIDE_CLASS);
 let openTimer=0,closeTimer=0,touchOpen=false;
 const revealed=()=>workspace.classList.contains(RAIL_REVEALED_CLASS);
 const focusInside=()=>!!doc?.activeElement&&workspace.contains(doc.activeElement);
 const clearOpen=()=>{if(openTimer)timers.clearTimeout(openTimer);openTimer=0;};
 const clearClose=()=>{if(closeTimer)timers.clearTimeout(closeTimer);closeTimer=0;};
 function reveal(now=false){
  clearClose();
  if(revealed()){clearOpen();return;}
  if(now){clearOpen();workspace.classList.add(RAIL_REVEALED_CLASS);return;}
  if(!openTimer)openTimer=timers.setTimeout(()=>{openTimer=0;workspace.classList.add(RAIL_REVEALED_CLASS);},openDelay);
 }
 function conceal(now=false){
  clearOpen();
  if(!revealed()||focusInside())return;
  const hide=()=>{closeTimer=0;if(!focusInside()){touchOpen=false;workspace.classList.remove(RAIL_REVEALED_CLASS);}};
  if(now){clearClose();hide();return;}
  if(!closeTimer)closeTimer=timers.setTimeout(hide,closeDelay);
 }
 const mouse=event=>!event.pointerType||event.pointerType==='mouse';
 const onEnter=event=>{if(mouse(event))reveal();};
 const onLeave=event=>{if(mouse(event)&&!touchOpen)conceal();};
 // 접힌 띠를 누르면(터치·펜·마우스 모두) 기다리지 않고 바로 펼친다. 이때 누른 것은 탭 단추에 닿지 않는다(띠는 pointer-events 로 막힘).
 const onDown=event=>{if(revealed())return;if(!mouse(event))touchOpen=true;reveal(true);};
 const onFocusIn=()=>reveal(true);
 const onFocusOut=event=>{if(!workspace.contains(event.relatedTarget))conceal();};
 const onOutside=event=>{if(touchOpen&&!workspace.contains(event.target))conceal(true);};
 workspace.addEventListener('pointerenter',onEnter);
 workspace.addEventListener('pointerleave',onLeave);
 workspace.addEventListener('pointerdown',onDown);
 workspace.addEventListener('focusin',onFocusIn);
 workspace.addEventListener('focusout',onFocusOut);
 doc?.addEventListener?.('pointerdown',onOutside,true);
 return {reveal,conceal,revealed,dispose(){clearOpen();clearClose();
  workspace.removeEventListener('pointerenter',onEnter);workspace.removeEventListener('pointerleave',onLeave);workspace.removeEventListener('pointerdown',onDown);
  workspace.removeEventListener('focusin',onFocusIn);workspace.removeEventListener('focusout',onFocusOut);doc?.removeEventListener?.('pointerdown',onOutside,true);}};
}
