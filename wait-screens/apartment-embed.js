/* The demonstration's visual shell, with actual values isolated from replay data. */
(() => {
  if (new URLSearchParams(location.search).get('embed') !== '1') return;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('ko-KR', {maximumFractionDigits:1}) : '–';
  let real = {}, progress = {status:'queued', plans:[]}, example, exampleError = false, search = null;
  // 예시 기록(apt_example.js)은 설치판에 없다. 없으면 가운데 탐색 자리에 '계산 중'(또는 엔진 실시간 걸음)을 보인다.
  // 엔진 실시간 탐색 걸음이 들어올 자리: cmd 'search' (docs/엔진요청_대기화면_실시간탐색_2026-10-23.md).
  const searchLine = () => search ? `실시간 탐색 · ${search.phase||'배치 탐색'} · 후보 ${num(search.tried)}개`+(search.best?` · 지금 최고 ${num(search.best.far)}% · ${num(search.best.units)}세대`:'') : '배치 탐색 · 계산 중';
  let index = -1, clock = 0, last = 0, speed = 1, paused = false, dirty = true, scale = 1;
  const modes = {'84':'1안 · 84 주력', max:'2안 · 최대 용적'};
  const plans = () => progress.plans || [];
  const terminal = () => ['done','failed'].includes(progress.status);
  const replaying = () => !plans().length && !terminal();
  const post = (event, extra={}) => parent.postMessage({source:'barun-wait',kind:'apartment',event,...extra}, location.origin);
  const style = document.createElement('style');
  style.textContent = `.embed .head{grid-template-columns:420px 1fr auto}.embed .head h1{font-size:14px}.embed .head small{font-size:12px}
    .embed .res{width:360px;max-height:calc(100% - 28px);overflow:auto;top:14px;right:14px}.embed .res h3{font-size:18px}
    .embed .site{display:none}.embed .p h2{font-size:12px}.embed .p{overflow:auto}.embed .feed{font-size:12px;line-height:19px}
    .embed .res .nums b{font-size:24px}.embed .res .nums{margin-top:6px}.embed .res .plan-result{padding:10px 0;border-bottom:1px solid var(--edge)}
    .embed .real-stages{color:var(--cyan);line-height:1.8;margin-bottom:10px}.embed .example-label{color:var(--warn)}
    .embed .p td{white-space:normal}.embed #checks,.embed #siteInfo{overflow:auto}.embed #closeWait{color:var(--text);background:var(--panel);border:1px solid var(--edge);padding:7px 10px;cursor:pointer}
    .embed .compact .res{font-size:14px}`;
  document.head.append(style);
  document.documentElement.classList.add('embed');
  document.querySelector('h1').firstChild.textContent = 'BARUN APARTMENT / 빠른 검토';
  document.querySelector('.speed').innerHTML = '<button id="closeWait">닫기</button>';
  $('closeWait').onclick = () => parent.postMessage({target:'barun-wait',cmd:'close'}, location.origin);
  addEventListener('keydown', e => { if (e.key === 'Escape') parent.postMessage({target:'barun-wait',cmd:'close'}, location.origin); });   // 누름 뒤 초점이 이 칸 안이면 바깥 대화상자 Esc 가 안 온다
  const headings = ['예시 탐색 기록 · 다른 대지','예시 세대수 추이 · 다른 대지','예시 탐색 작업 · 다른 대지','실제 대지 · 배치 평면','예시 작업 비교 · 다른 대지','실제 결과 · 동별 표','실제 법규 · 용도지역 조각','실제 대지 · 목표'];
  document.querySelectorAll('.p h2').forEach((e,i) => e.textContent = headings[i]);
  const table = rows => '<table>'+rows.map(r => '<tr>'+r.map(v => '<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</table>';
  const target = () => real.incentive?.target_far_pct ?? plans().find(p=>p.mode==='84')?.target_plan?.target_far_pct;
  function fit() {
    const app = document.querySelector('.app'), h = Math.max(900, Math.min(1000,1600*innerHeight/innerWidth));
    scale = Math.min(innerWidth/1600, innerHeight/h);
    document.body.classList.toggle('compact', scale < .75);
    app.style.setProperty('--H',h+'px');
    app.style.transform = `translate(${(innerWidth-1600*scale)/2}px,${(innerHeight-h*scale)/2}px) scale(${scale})`;
    document.querySelectorAll('canvas').forEach(cv => {
      const r = (devicePixelRatio||1)*Math.max(scale,.5);
      cv.width = Math.max(1,cv.clientWidth*r); cv.height = Math.max(1,cv.clientHeight*r);
      cv.getContext('2d').setTransform(r,0,0,r,0,0);
    }); dirty = true;
  }
  function ctx(id) {const cv=$(id), c=cv.getContext('2d'); c.clearRect(0,0,cv.clientWidth,cv.clientHeight);return [c,cv.clientWidth,cv.clientHeight];}
  function text(c,s,x,y,color='#A4E4CE',size=15) {c.fillStyle=color;c.font=`${size}px "Barun Drawing Korean",sans-serif`;c.fillText(s,x,y);}
  function ring(p) {return Array.isArray(p)&&p.length>=3&&p.every(q=>Array.isArray(q)&&q.length>=2&&q.every(Number.isFinite));}
  // Actual geometry is always on its own site. Floors are labels, never assumed heights.
  function map(c, box, site, buildings=[], pieces=[], iso=false) {
    if (!ring(site)) {text(c,'대지 좌표 수신 대기',box.x+20,box.y+40,'#7F8C9C');return;}
    const coords=[site,...buildings.map(b=>b.poly).filter(ring),...pieces.map(p=>p.poly).filter(ring)].flat();
    const xs=coords.map(p=>p[0]),ys=coords.map(p=>p[1]), minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const s=Math.min((box.w-50)/(maxX-minX||1),(box.h-70)/(maxY-minY||1));
    const X=x=>box.x+box.w/2+(x-(minX+maxX)/2)*s, Y=y=>box.y+box.h/2-(y-(minY+maxY)/2)*s;
    const path = pts => {c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(X(x),Y(y)):c.moveTo(X(x),Y(y)));c.closePath();};
    c.save();c.beginPath();c.rect(box.x,box.y,box.w,box.h);c.clip();
    path(site);c.fillStyle='#182933';c.fill();c.strokeStyle='#8FB7CA';c.lineWidth=2;c.stroke();
    pieces.filter(p=>ring(p.poly)).forEach((p,i)=>{path(p.poly);c.fillStyle=['#CABBF122','#79AD9122','#F2CA8922'][i%3];c.fill();c.strokeStyle='#8FB7CA88';c.lineWidth=1;c.stroke();});
    buildings.filter(b=>ring(b.poly)).forEach(b=>{
      path(b.poly);c.fillStyle='#A4E4CE44';c.fill();c.strokeStyle='#A4E4CE';c.stroke();
      if(iso) { // Presentation-only extrusion: no metre-height claim.
        const lift=Math.min(65,(b.floors||0)*1.5);
        const top=b.poly.map(([x,y])=>[X(x)+lift*.25,Y(y)-lift]);
        b.poly.forEach(([x,y],i)=>{c.beginPath();c.moveTo(X(x),Y(y));c.lineTo(...top[i]);c.strokeStyle='#A4E4CE66';c.stroke();});
        c.beginPath();top.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fillStyle='#A4E4CE66';c.fill();c.strokeStyle='#A4E4CE';c.stroke();
      }
      const x=b.poly.reduce((s,p)=>s+p[0],0)/b.poly.length,y=b.poly.reduce((s,p)=>s+p[1],0)/b.poly.length;
      text(c,`${b.label||''} ${num(b.floors)}층`,X(x)+3,Y(y)-4,'#E8EEF5',11);
    });c.restore();
  }
  function render() {
    const ps=plans(), t=target(), done=progress.done||[];
    const status={queued:'서버 접수 · 대기',running:'서버 계산 중',done:'서버 계산 완료',failed:'서버 계산 실패'}[progress.status]||'서버 상태 수신 대기';
    $('sub').textContent=real.address||'이 대지 실제 값 수신 대기';
    $('cnt').innerHTML=[['대지면적',num(real.area)+'㎡'],['용도지역',real.zone||'–'],['현재 안',modes[progress.current]||'–'],['완료 안',done.map(m=>modes[m]||m).join(' · ')||'–'],['서버 경과',num(progress.elapsed_s)+'초'],['상태',status]].map(([k,v])=>`<div>${esc(k)}<b>${esc(v)}</b></div>`).join('');
    $('res').innerHTML=`<div class="tag">이 대지 · 실제 서버 값</div><div class="real-stages">법규·대지 → 인센티브·목표 → 1안 84 → 2안 최대 → 결과<br>${esc(status)} · ${esc(modes[progress.current]||'')}${done.length?' · 완료 '+esc(done.map(m=>modes[m]||m).join(', ')):''}</div>
      <h3>${t==null?'서버가 인센티브 최대로 고르는 중':'목표 용적률 '+num(t)+'%'}</h3>
      ${ps.map(p=>`<div class="plan-result"><div class="badge">${esc(modes[p.mode]||p.title||'실제 안')}</div><div>${esc(p.title)}</div><div style="color:${p.status==='불가'||p.checks_ok===false?'var(--hot)':'var(--sub)'}">${esc(p.status||'판정 수신 대기')}${p.checks_ok===false?' · 검사 미통과':''}${p.blocked_by?.length?' · '+esc(p.blocked_by.join(', ')):''}</div><div class="nums"><div>용적률<b>${num(p.far_pct)}<small>%</small></b></div><div>세대<b>${num(p.units)}</b></div><div>동 수<b>${num(p.buildings_n)}</b></div></div><div class="sub">연면적 ${num(p.gfa_m2)}㎡ · 목표 ${num(p.target_plan?.target_far_pct)}%</div></div>`).join('')}
      ${progress.error?'<div style="color:var(--hot)">'+esc(progress.error)+'</div>':''}
      <div class="why">${ps.length?'실제 결과 수신 · 예시 탐색 재생 중지':terminal()?'예시 탐색 재생 중지':'가운데 탐색은 다른 대지의 예시 기록입니다.'}</div>`;
    $('checks').innerHTML=table([['용도지역','면적 ㎡','건폐 %','용적 %'],...(real.pieces||[]).map(p=>[p.zone,num(p.area),num(p.bcr),num(p.far)])]);
    $('siteInfo').innerHTML=table([['주소',real.address||'–'],['대지면적',num(real.area)+'㎡'],['용도지역',real.zone||'–'],['법정 용적 상한',num(real.far_cap)+'%'],['목표',t==null?'서버가 인센티브 최대로 고르는 중':num(t)+'%'],...(real.incentive?.items||[]).map(i=>[typeof i==='string'?i:i.name||i.id,typeof i==='object'&&i.far_gain_pct!=null?num(i.far_gain_pct)+'%':''])]);
    $('dongs').innerHTML=table([['안','동','층'],...ps.flatMap(p=>(p.buildings||[]).map(b=>[modes[p.mode]||p.title,b.label||'–',num(b.floors)]))]);
    const [c,w,h]=ctx('hero'), usable=w-400;
    text(c,`${status} · ${modes[progress.current]||''} · 서버 경과 ${num(progress.elapsed_s)}초`,22,30,'#75DDE8',18);
    if (ps.length) {
      ps.forEach((p,i)=>{const box={x:i*usable/ps.length,y:85,w:usable/ps.length,h:h-105};text(c,modes[p.mode]||p.title,box.x+22,65);map(c,box,real.site,p.buildings,real.pieces);});
    } else {
      const small={x:16,y:100,w:usable*.32,h:h-120};text(c,'이 대지 · 실제 경계',25,80,'#75DDE8');map(c,small,real.site,[],real.pieces);
      const box={x:usable*.35,y:130,w:usable*.65-14,h:h-160};
      c.strokeStyle='#F2CA89';c.strokeRect(box.x,55,box.w,h-70);
      if (example) {text(c,'예시 탐색 · 다른 대지 기록 · 엔진 실시간 연결 전',box.x+12,80,'#F2CA89',19);text(c,'연산동 586-3 · 층 높이·움직임은 시각 연출',box.x+12,105,'#7F8C9C',12);}
      else text(c,'이 대지 · 배치 탐색',box.x+12,80,'#75DDE8',19);
      const step=example?.steps[index];
      if (example) map(c,box,example.site,(step?.B||[]).map(b=>({poly:b.p,floors:b.f,label:b.c})),[],true);
      else text(c,exampleError?searchLine():'불러오는 중',box.x+16,180,'#A4E4CE');
    }
    const [pc,pw,ph]=ctx('cPlan');
    ps.forEach((p,i)=>map(pc,{x:i*pw/ps.length,y:0,w:pw/ps.length,h:ph},real.site,p.buildings));
    if(!ps.length)map(pc,{x:0,y:0,w:pw,h:ph},real.site,[],real.pieces);
    drawExample(); dirty=false;
  }
  function drawExample() {
    if (!example) {
      $('feed').innerHTML=(search?.rejected||[]).slice(-12).map(r=>`<div>막힘 · ${esc(r.why)}</div>`).join('')||`<div>${esc(searchLine())}</div>`;
      $('lanes').textContent=searchLine();for(const id of ['cTrace','cJobs'])ctx(id);return;
    }
    const steps=example?.steps||[], s=steps[index], shown=steps.slice(Math.max(0,index-12),index+1);
    $('feed').innerHTML=shown.map(s=>`<div class="example-label">예시 · ${s.t==='s'?`${esc(s.n)}동 · ${esc(s.u)}세대 · 동 놓기·층·간격 조정`:'막힘 · '+esc(s.why)}</div>`).join('');
    $('lanes').textContent=example?`다른 대지 예시 · ${example.jobs.length}개 탐색 작업 기록 · 실제 서버 진행과 무관`:'예시 자료 수신 대기';
    const [c,w,h]=ctx('cTrace'), samples=steps.slice(0,index+1).filter(s=>s.t==='s');
    const max=Math.max(1,...samples.map(s=>s.u));c.strokeStyle='#A4E4CE';c.beginPath();samples.forEach((s,i)=>{const x=12+i/Math.max(1,samples.length-1)*(w-24),y=h-15-s.u/max*(h-30);i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();
    text(c,s?'예시 '+num(s.u)+'세대':'예시 기록 재생 대기',12,16,'#F2CA89',12);
    const [jc,jw,jh]=ctx('cJobs'), jobs=example?.jobs||[];
    jobs.forEach((j,i)=>{jc.fillStyle=j.win?'#A4E4CE':'#70BFB888';const hh=(jh-30)*j.fill/100;jc.fillRect(i*jw/jobs.length,jh-hh,Math.max(1,jw/jobs.length-2),hh);});
    text(jc,'다른 대지의 예시 작업 비교',8,16,'#F2CA89',12);
  }
  addEventListener('message',e=>{
    if(e.source!==parent||e.origin!==location.origin||e.data?.target!=='barun-wait')return;
    const {cmd,value}=e.data;
    if(cmd==='real'&&value&&typeof value==='object')real=value;
    if(cmd==='progress'&&value&&typeof value==='object'){
      progress={...progress,...value};post(terminal()?'done':'phase',{phase:plans().length?'result':progress.current||progress.status});
    }
    if(cmd==='search'&&value&&typeof value==='object')search=value;
    if(cmd==='pause')paused=true;
    if(cmd==='resume')paused=false;
    if(cmd==='speed')speed=[1,2,4].includes(+value)?+value:1;
    if(cmd==='restart'){index=-1;clock=0;}
    dirty=true;
  });
  addEventListener('resize',fit);
  function frame(now) {
    const dt=Math.min(.2,(now-last)/1000||0);last=now;
    if(!document.hidden) {
      if(!paused&&replaying()&&example) {
        clock+=dt*speed;
        if(clock>.2) {clock=0;do{index=(index+1)%example.steps.length;}while(example.steps[index].t!=='s');dirty=true;}
      }
      if(dirty)render();
    }
    requestAnimationFrame(frame);
  }
  const script=document.createElement('script');script.src='apt_example.js';
  script.onload=()=>{example=window.APT_RUN;dirty=true;};
  script.onerror=()=>{exampleError=true;dirty=true;};document.head.append(script);
  document.fonts.ready.then(()=>{fit();render();post('ready');requestAnimationFrame(frame);});
})();
