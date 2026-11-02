export function installDesignCases(studio){
 const {execute,selected,fit,toast}=studio.context;
 const open=document.createElement('button');open.id='design-cases-open';open.textContent='설계 사례';document.querySelector('#canvas-tools').prepend(open);
 const panel=document.createElement('dialog');panel.id='design-cases-dialog';panel.style.cssText='width:min(1100px,95vw);max-height:90vh;overflow:auto;background:#17212d;color:#eef5ff;border:1px solid #52718c;padding:22px';
 panel.innerHTML=`<button class="close" style="float:right">닫기</button><h2>원본 설계 사례 찾기</h2><p>원본 배치를 유지한 참고 사례입니다. 방 개수는 도면 한 장 전체 기준입니다.</p><form class="search"><input name="query" aria-label="설계 요구사항" placeholder="아파트, 주택, 84, 상가, 병원" style="width:55%;padding:10px"><select name="task" aria-label="사례 종류"><option value="SPA">공간 배치</option><option value="STR">벽·문·창</option><option value="OBJ">기구</option><option value="OCR">문자</option></select><button>사례 찾기</button></form><div class="quick"></div><p class="status" role="status"></p><div class="results"></div><section class="detail" hidden><h3 class="title"></h3><p class="reason"></p><div class="image-wrap" style="position:relative"><img class="drawing" alt="선택한 원본 도면" style="max-width:100%;cursor:crosshair;background:white"><div class="markers" style="position:absolute;inset:0;pointer-events:none"></div></div><p class="patterns"></p><button class="send-cad" type="button">캐드로 보내기 · 전체 객체 편집</button><p>제공된 좌표 전체를 편집 가능한 객체로 변환합니다. 좌표가 없는 이미지 선은 제외됩니다. 길이를 맞추지 않으면 임시 크기·축척 미확인으로 들어갑니다.</p><details><summary>실제 길이를 맞춰 CAD에 참고 사본 넣기</summary><p>도면의 치수선 양 끝을 차례로 누르고 실제 길이를 입력하세요. 원본은 바꾸지 않고 현재 작업 옆에 사본을 추가합니다.</p><p class="points">선택한 점 없음</p><label>실제 길이(mm) <input class="length" type="number" min="1" aria-label="기준 길이 mm"></label><button class="reset" type="button">점 다시 선택</button><button class="insert" type="button" disabled>참고 사본 넣기</button></details></section>`;
 document.body.append(panel);const $=s=>panel.querySelector(s);let current=null,points=[],generation=0,offset=0;
 panel.addEventListener('keydown',e=>e.stopPropagation());
 // U-M5: 열 때 자료 연결부터 확인해 로그인 전에도 [폴더 연결] 화면에 닿게 한다.
 // 여는 단추가 숨은 대지 도구 칸(#canvas-tools)에만 있어 들어갈 길이 없었다. AI 메뉴에서도 연다.
 studio.handlers.DESIGNCASES=()=>open.click();
 $('.close').onclick=()=>panel.close();open.onclick=async()=>{panel.showModal();try{const st=await studio.api('design-cases',{action:'status'});if(!st.connected){status('설계 사례 자료 연결이 끊겼습니다. 사례 자료 폴더를 다시 연결하세요.');await showConnect();return;}}catch{}$('.search').requestSubmit();};
 for(const word of ['전체','아파트','주택','다세대','84','상가','병원']){const b=document.createElement('button');b.type='button';b.textContent=word;b.style.margin='8px 6px 0 0';b.onclick=()=>{$('.search').elements.query.value=word==='전체'?'':word;$('.search').requestSubmit();};$('.quick').append(b);}
 window.addEventListener('cad-find-design-cases',e=>{$('.search').elements.query.value=e.detail.query||'';if(!panel.open)panel.showModal();$('.search').requestSubmit();});
 const status=s=>$('.status').textContent=s;
 function calibrate(){ const marks=$('.markers');marks.replaceChildren();if(current)points.forEach((p,i)=>{const mark=document.createElement('span');mark.textContent=String(i+1);mark.style.cssText=`position:absolute;left:${100*p.x/current.imageSize[0]}%;top:${100*p.y/current.imageSize[1]}%;transform:translate(-50%,-50%);border:2px solid white;border-radius:50%;background:#d22;color:white;width:22px;height:22px;text-align:center`;marks.append(mark);}); $('.points').textContent=points.length===2?'두 점 선택 완료. 실제 길이를 입력하세요.':`선택한 점 ${points.length}개`;$('.insert').disabled=points.length!==2||!(Number($('.length').value)>0); }
 $('.length').oninput=calibrate;$('.reset').onclick=()=>{points=[];calibrate();};
 $('.drawing').onclick=e=>{if(!current)return;if(points.length===2)points=[];const r=e.target.getBoundingClientRect();points.push({x:(e.clientX-r.left)/r.width*current.imageSize[0],y:(e.clientY-r.top)/r.height*current.imageSize[1]});calibrate();};
 $('.search').onsubmit=async e=>{e.preventDefault();offset=0;await searchPage(false);};
 async function searchPage(append){const revision=++generation;$('.detail').hidden=true;current=null;points=[];status('조건에 맞는 원본을 찾고 있습니다.');if(!append)$('.results').replaceChildren();$('.more')?.remove();
  try{const r=await studio.api('design-cases',{action:'search',query:$('.search').elements.query.value,task:$('.search').elements.task.value,offset,limit:30});if(revision!==generation)return;status(`${r.total}개 후보 중 ${offset+r.results.length}개 표시 · ${r.notice}`);
   for(const item of r.results){const b=document.createElement('button');b.type='button';b.style.cssText='display:block;width:100%;text-align:left;margin:8px 0;padding:10px';const counts=Object.entries(item.counts).map(([k,v])=>`${k.replace('공간_','')} ${v}`).join(' · ');b.textContent=`${({APT:'아파트',DEH:'단독주택',ROW:'다세대·연립'})[item.housing]}${item.areaUnverified?' · 면적 미확인':''} · ${item.id.split('/').pop()} — ${item.matchedText?.length?item.matchedText.join(' · '):counts} — 확인 항목 ${item.issues}`;b.onclick=()=>choose(item);$('.results').append(b);}
  if(r.hasMore){const more=document.createElement('button');more.type='button';more.className='more';more.textContent='다음 30개 더 보기';more.onclick=()=>{offset+=r.results.length;searchPage(true);};$('.results').append(more);}
  }catch(err){status(err.message);if(/연결이 끊겼/.test(err.message))showConnect();else if(/로그인이 필요/.test(err.message))showLoginHint();}
 }
 /* U-M5: 로그인 안내는 화면 오른쪽 위 [계정 연결]을 가리키고 바로 열어 준다. */
 function showLoginHint(){
  if($('.login-hint'))return;
  const box=document.createElement('div');box.className='login-hint';box.style.cssText='margin:10px 0;padding:10px;border:1px dashed #52718c;border-radius:6px';
  const text=document.createElement('span');text.textContent='설계 사례 검색은 바른 계정 로그인이 필요합니다. ';
  const go=document.createElement('button');go.type='button';go.textContent='[계정 연결] 열기';go.onclick=()=>{box.remove();panel.close();document.getElementById('shared-account')?.click();};
  box.append(text,go);$('.status').after(box);
 }
 /* 사례 자료 폴더 연결(2026-09-21): 설치본에는 자료가 들어 있지 않아 폴더를 한 번 지정한다. 설정은 사용자 폴더(BarunCAD/design-cases.json)에 남는다. */
 async function showConnect(){
  let box=$('.connect');
  if(!box){box=document.createElement('div');box.className='connect';box.style.cssText='margin:10px 0;padding:10px;border:1px dashed #52718c;border-radius:6px';box.innerHTML='<div style="margin-bottom:6px">설계 사례 자료 폴더(catalog.sqlite 가 있는 full-catalog 폴더)를 적고 [폴더 연결]을 누르세요.</div><input class="connect-path" style="width:70%;padding:8px" placeholder="예: D:\어플\캐드\data\aihub-71465\full-catalog"> <button type="button" class="connect-go">폴더 연결</button>';$('.status').after(box);
   box.querySelector('.connect-go').onclick=async()=>{const path=box.querySelector('.connect-path').value.trim();if(!path){status('폴더 경로를 적으세요.');return;}try{const r=await studio.api('design-cases',{action:'connect',path});status('사례 자료 연결됨: '+r.path);box.remove();offset=0;await searchPage(false);}catch(e){status(e.message);}};}
  try{const st=await studio.api('design-cases',{action:'status'});if(st?.path&&!box.querySelector('.connect-path').value)box.querySelector('.connect-path').value=st.connected?st.path:'';}catch{}
 }
 async function choose(item){const revision=++generation;status('원본 도면을 여는 중입니다.');$('.insert').disabled=true;current=null;points=[];
  try{const detail=await studio.api('design-cases',{action:'detail',id:item.id});if(revision!==generation)return;current=detail;$('.detail').hidden=false;$('.title').textContent=item.id;$('.reason').textContent=item.explanation+` · 확인 항목 ${item.issues}개. 원본 수정 없음.`+(detail.scaleMmPerPixel?' · 도면 표기 치수로 크기 확인됨(이미지 측정 오차 있음)':' · 아래에서 도면의 기준 길이를 맞출 수 있습니다.');$('.drawing').src='/api/design-cases/image?id='+encodeURIComponent(item.id);$('.patterns').textContent=detail.pattern?`공간 ${detail.pattern.nodes.length}개 · 근접 후보 ${detail.pattern.nearbyCandidates.length}개. 근접은 문으로 연결됐다는 뜻이 아닙니다.`:'이 자료에는 공간 관계 정보가 없습니다.';$('.length').value='';calibrate();status('캐드로 보내기를 누르면 전체 좌표 객체를 편집할 수 있습니다.');$('.detail').scrollIntoView({block:'start',behavior:'smooth'});
  }catch(err){status(err.message);}
 }
 $('.send-cad').onclick=async()=>{
  if(!current)return;
  const button=$('.send-cad'),id=current.id,revision=generation;
  const distance=points.length===2?Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y):0,length=Number($('.length').value);
  if(points.length&&(!(distance>=5)||!(length>0))){status('선택한 두 점의 실제 길이를 입력하거나 점 다시 선택으로 초기화하세요.');return;}
  button.disabled=true;status('전체 좌표를 편집 가능한 CAD 객체로 변환하는 중입니다.');
  try{const r=await studio.api('design-cases',{action:'editable',id,...(distance>=5&&length>0?{mmPerPixel:length/distance}:{})});
   if(revision!==generation||!panel.open)return;
   const ids=execute({type:'design.import',reference:true,documents:[r.document]});selected().clear();ids.forEach(id=>selected().add(id));fit();panel.close();toast(`${r.objectCount}개 CAD 객체 추가 · 바로 수정 가능${r.scaleVerified?'':' · 축척 미확인'}`);
  }catch(err){status(err.message);}finally{button.disabled=false;}
 };
 $('.insert').onclick=async()=>{if(!current||points.length!==2)return;const distance=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y),length=Number($('.length').value);if(distance<5||!(length>0)){status('떨어진 두 점과 실제 길이를 확인하세요.');return;}
  const id=current.id;$('.insert').disabled=true;
  try{const r=await studio.api('design-cases',{action:'reference',id,mmPerPixel:length/distance});const ids=execute({type:'design.import',reference:true,documents:[r.document]});selected().clear();ids.forEach(id=>selected().add(id));fit();toast('원본 설계 사례를 참고 사본으로 추가했습니다. 실행 취소할 수 있습니다.');panel.close();}
  catch(err){status(err.message);}finally{calibrate();}
 };
 return {open:()=>panel.showModal()};
}
