// 도면 칸마다 프로세스 탭 줄 전용. 도면 화면(desktop-preload.cjs)과 따로 둔다.
const {contextBridge,ipcRenderer}=require('electron');
// macOS: 창 단추가 왼쪽 위 → 탭 줄 여백을 바꾼다(desktop-shell.html html[data-platform=darwin]).
if(process.platform==='darwin'){const markPlatform=()=>{if(document.documentElement)document.documentElement.dataset.platform='darwin';};markPlatform();window.addEventListener('DOMContentLoaded',markPlatform);}
contextBridge.exposeInMainWorld('barunShell',{
 newDocument:()=>ipcRenderer.invoke('shell:new'),
 openFiles:()=>ipcRenderer.invoke('shell:open-files'),
 select:id=>ipcRenderer.invoke('shell:select',id),
 reload:id=>ipcRenderer.invoke('shell:reload',id),
 close:id=>ipcRenderer.invoke('shell:close',id),
 onTabs:handler=>{ipcRenderer.on('shell:tabs',(_event,tabs)=>handler(tabs));ipcRenderer.invoke('shell:tabs').then(handler);}
});
