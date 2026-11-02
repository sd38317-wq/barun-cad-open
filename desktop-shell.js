// 도면 칸마다 프로세스 탭 줄. 탭 = 도면 창 하나 = 화면 프로세스 하나.
const shell=window.barunShell,tabsEl=document.getElementById('tabs'),crash=document.getElementById('crash');
let tabs=[];
const reasonText={crashed:'프로세스가 비정상 종료', oom:'메모리 부족', killed:'강제 종료', 'launch-failed':'시작 실패', 'abnormal-exit':'비정상 종료'};
function render(list){
 tabs=list;tabsEl.replaceChildren(...list.map(tab=>{
  const el=document.createElement('div');el.className='tab'+(tab.active?' active':'');el.dataset.state=tab.state;el.role='tab';el.ariaSelected=String(tab.active);
  el.title=`${tab.title} · 프로세스 ${tab.pid??'-'}${tab.loadMs!=null?` · 첫 화면 ${tab.loadMs}ms`:''}${tab.lastReloadMs!=null?` · 다시 열기 ${tab.lastReloadMs}ms`:''}`;
  const dot=document.createElement('span');dot.className='dot';
  const name=document.createElement('span');name.className='name';name.textContent=tab.state==='crashed'?`${tab.title} · 멈춤`:tab.title;
  const close=document.createElement('button');close.type='button';close.className='x';close.textContent='×';close.ariaLabel=tab.title+' 닫기';
  close.onclick=event=>{event.stopPropagation();shell.close(tab.id);};
  el.onclick=()=>shell.select(tab.id);
  el.append(dot,name,close);return el;
 }));
 const active=list.find(tab=>tab.active);
 crash.classList.toggle('show',active?.state==='crashed');
 if(active?.state==='crashed')document.getElementById('crash-note').textContent=`${reasonText[active.reason]||active.reason}. 다른 도면 창은 그대로입니다. 다시 열면 이 창의 자동 복구본에서 이어갑니다.`;
}
document.getElementById('new').onclick=()=>shell.newDocument();
document.getElementById('open').onclick=()=>shell.openFiles();
document.getElementById('crash-reload').onclick=()=>{const active=tabs.find(tab=>tab.active);if(active)shell.reload(active.id);};
document.getElementById('crash-close').onclick=()=>{const active=tabs.find(tab=>tab.active);if(active)shell.close(active.id);};
shell.onTabs(render);
