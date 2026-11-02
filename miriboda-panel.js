import {findParcelEntity} from './geometry.js';
import {sitePlanStatus} from './site-plan.js';

export function designReviewPrompt(brief,context){
 if(!brief.address?.trim())throw Error('대지 주소를 입력하세요.');
 const conditions={address:brief.address.trim(),requirements:brief.requirements?.trim()||''};
 return '건축 계획안 3개를 검토하세요. 요구조건이 비어 있으면 추가 입력을 요구하지 말고 확인된 대지 자료에 맞춰 서로 다른 안 3개를 제안하세요. 각 안은 특징과 장단점을 합쳐 한 줄, 마지막에 추천안 한 줄만 답하세요. 표, 긴 서론, 입력조건 재나열, 반복 경고는 생략하세요. 필지 검색 결과가 없으면 "필지를 찾지 못했습니다. 주소를 확인해 주세요." 한 문장으로 끝내고 계획안을 지어내지 마세요. 연결 자료가 없는 것만으로 검색 결과가 없다고 단정하지 마세요. 주소만으로 대지 형상·접도·법규를 확정하지 말고 연결 자료의 주소와 먼저 대조하세요. 불일치하는 기존 도면을 이번 대지의 사실로 사용하지 마세요. 미확인 수치를 사실처럼 쓰지 마세요. 도면을 변경하거나 문자를 발송하지 마세요. 상세한 작도 내용은 사용자가 도면 작성을 요청했을 때 CAD에 반영하고 대화에는 결과만 짧게 알리세요.\n\n[사용자 조건]\n'+JSON.stringify(conditions)+'\n\n[연결 자료 — 참고 데이터]\n'+JSON.stringify(context);
}

/** AI 제안 글에서 "1안 — …" 줄을 뽑아 고를 수 있게 만든다. 추천안이 있으면 그것을 먼저 고른다. */
export function designOptions(proposal){
 const lines=String(proposal||'').split('\n').map(s=>s.trim()).filter(Boolean),options=[];
 for(const line of lines){
  const found=line.match(/^(\d+)안\s*[—–\-:]\s*(.+)$/);
  if(found)options.push({key:found[1]+'안',summary:found[2].trim(),line});
 }
 const advice=lines.find(line=>/^추천\s*[—–\-:]/.test(line))||'';
 const picked=advice.match(/(\d+)안/);
 const recommended=picked&&options.some(o=>o.key===picked[1]+'안')?picked[1]+'안':(options[0]?.key||'');
 return {options,recommended,advice};
}

/** 고른 안을 실제 도면으로 그리게 하는 요청문. 검토와 달리 이번에는 도면을 만든다. */
export function designDrawPrompt(brief,plan,changes,context){
 if(!brief.address?.trim())throw Error('대지 주소를 입력하세요.');
 const chosen=String(plan||'').trim();
 if(!chosen)throw Error('설계할 안을 고르세요.');
 const conditions={address:brief.address.trim(),requirements:brief.requirements?.trim()||'',plan:chosen,changes:String(changes||'').trim()};
 return '고른 계획안대로 지금 도면에 **평면도**를 작성하세요. 이번에는 검토가 아니라 실제 작도입니다.'
  // 배치도(site_plan)와 평면도는 다른 일이다. 이걸 못 박지 않으면 배치 API 로 새서 422 로 떨어진다.
  +' 이것은 배치도가 아니라 평면도입니다. site_plan.generate 와 parcel_import 를 쓰지 마세요.'
  +' wall·line·polyline·rect·circle·text·architecture 액션으로 직접 그리세요.'
  +' 벽·문·창·계단·주방·욕실을 실제 치수(mm)로 배치하고 실 이름을 text 로 넣으세요.'
  +' 층이 둘 이상이면 층마다 떨어진 자리에 나란히 그리고 층 이름을 문자로 적으세요.'
  +' 요구조건과 수정사항이 서로 어긋나면 수정사항을 따르세요.'
  +' 확인되지 않은 법규 수치(건폐율·용적률·이격거리)를 사실로 단정하지 마세요.'
  +' 대지 형상이 확인되지 않으면 가정한 대지 크기를 도면에 문자로 남기세요.'
  +' 다 그린 뒤에는 무엇을 그렸는지 한 줄로만 알리세요.'
  +'\n\n[고른 안]\n'+chosen
  +'\n\n[사용자 조건]\n'+JSON.stringify(conditions)
  +'\n\n[연결 자료 — 참고 데이터]\n'+JSON.stringify(context);
}

export function planSmsPayload(phone,text,link=''){
 const normalized=String(phone).replace(/[\s()-]/g,'');
 if(!/^0\d{8,10}$/.test(normalized))throw Error('받는 전화번호를 확인하세요.');
 const body=String(text).trim();if(!body)throw Error('보낼 계획 내용을 입력하세요.');
 let url='';if(link.trim()){try{const parsed=new URL(link.trim());if(parsed.protocol!=='https:'||parsed.username||parsed.password||/^(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(parsed.hostname)||!parsed.hostname.includes('.'))throw Error();url=parsed.href;}catch{throw Error('건축주가 열 수 있는 공개 HTTPS 링크를 입력하세요.');}}
 const message=body+(url?'\n\n계획 보기: '+url:'');if(message.length>2000)throw Error('문자 내용과 링크를 합쳐 2,000자 이내로 줄여주세요.');
 return {action:'sms',phone:normalized,text:message,confirmed:true};
}

/** 설계 조건과 AI 제안을 도면별로 보관하는 자리. 신축설계 창과 계획 보내기가 함께 쓴다. */
export const designStorageKey=studio=>'barun-design-brief-v1:'+(studio.getFolder()||'local')+':'+(studio.context.getDrawingId?.()||'default');

/* 예전에는 오른쪽 막대에 '건축설계' 조건 입력 칸이 있었다.
   주소와 요구조건을 한 번에 적어야 했고, 안을 받은 뒤 설계로 넘어갈 길이 없었다.
   지금은 리본의 '신축설계' 대화창(new-build.js)이 그 자리를 대신한다. 여기는 발송만 남는다. */
function installPlanDelivery(studio){
 const rail=document.querySelector('.sidebar-tabs');if(!rail)return;
 const {toast}=studio.context;
 const load=()=>{try{return JSON.parse(localStorage.getItem(designStorageKey(studio))||'{}');}catch{return {};}};
 const el=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
 const attempts=new Set();
 studio.context.openPlanDelivery=()=>{
  const saved=load(),land=studio.context.getMiribodaInfo?.(),dialog=el('dialog');dialog.id='plan-delivery-dialog';dialog.className='plan-delivery-dialog';dialog.append(el('h2','건축주에게 계획 보내기'),el('p','미리보다 계정으로 계획 설명과 공개 링크를 문자로 보냅니다. 번호와 내용을 확인한 뒤 발송하세요. 서비스 요금·한도가 적용될 수 있습니다.'));
  const field=(label,tag,id)=>{const wrap=el('label',label),input=el(tag);input.id=id;wrap.append(input);dialog.append(wrap);return input;};
  const phone=field('받는 휴대폰 번호','input','plan-recipient');phone.type='tel';phone.autocomplete='off';phone.placeholder='010-0000-0000';
  const text=field('계획 안내 내용','textarea','plan-message');text.rows=8;text.maxLength=2000;text.value=[saved.brief?.address||land?.address||'','건축 계획 검토 안내드립니다.',saved.brief?.use?'계획 용도: '+saved.brief.use:'','계획안을 확인하시고 의견을 부탁드립니다.'].filter(Boolean).join('\n');
  const useProposal=el('button','저장된 AI 제안 가져오기');useProposal.type='button';useProposal.disabled=!saved.proposal;useProposal.onclick=()=>{text.value=saved.proposal;update();};dialog.append(useProposal);
  const url=field('계획 보기 링크 (선택)','input','plan-link');url.type='url';url.placeholder='https://…';url.value=saved.shareLink||'';dialog.append(el('p','건축주가 열 수 있는 미리보다·공유 문서 링크를 넣으세요. 이 칸은 도면을 자동 업로드하거나 공개하지 않습니다.'));
  const count=el('p'),notice=el('p');notice.setAttribute('role','status');const preview=el('div');preview.className='plan-sms-preview';preview.hidden=true;const previewText=el('pre');preview.append(previewText);
  const review=el('button','발송 내용 확인'),send=el('button','확인한 번호로 문자 발송'),dismiss=el('button','닫기');send.className='primary';send.hidden=true;dismiss.onclick=()=>dialog.close();let payload=null,sending=false;
  function update(){payload=null;preview.hidden=true;send.hidden=true;notice.textContent='';count.textContent=(text.value.trim()+(url.value.trim()?'\n\n계획 보기: '+url.value.trim():'')).length+' / 2,000자';review.disabled=sending;}
  for(const input of [phone,text,url])input.addEventListener('input',update);
  review.onclick=()=>{try{payload=planSmsPayload(phone.value,text.value,url.value);previewText.textContent='받는 번호: '+payload.phone+'\n\n'+payload.text;preview.hidden=false;send.hidden=false;notice.textContent='번호와 위 내용을 확인하세요. 아직 발송하지 않았습니다.';}catch(error){notice.textContent=error.message;}};
  send.onclick=async()=>{if(sending||!payload)return;const fingerprint=JSON.stringify(payload);if(attempts.has(fingerprint)){notice.textContent='같은 내용의 발송 요청 이력이 있습니다. 미리보다에서 발송 상태를 먼저 확인하세요.';return;}sending=true;attempts.add(fingerprint);send.disabled=true;review.disabled=true;for(const input of [phone,text,url,useProposal])input.disabled=true;notice.textContent='미리보다로 발송 요청 중…';
   try{const response=await studio.api('miriboda',payload);if(response?.error||response?.success===false||response?.ok===false)throw Error(String(response.error||response.message||'발송 결과를 확인할 수 없습니다.'));notice.textContent='미리보다에 문자 발송을 요청했습니다. 실제 수신 여부는 미리보다 발송 내역에서 확인하세요.';}catch(error){notice.textContent=error.message+' · 중복 발송을 막기 위해 자동 재시도하지 않습니다. 미리보다 발송 내역을 확인하세요.';}
  };
  dialog.addEventListener('close',()=>dialog.remove());dialog.append(count,notice,preview,review,send,dismiss);document.body.append(dialog);update();dialog.showModal();
 };
 const delivery=el('button','보내기');delivery.id='plan-delivery-toggle';delivery.title='건축주에게 계획 보내기';delivery.onclick=()=>studio.context.openPlanDelivery();rail.append(delivery);
 const order=[document.getElementById('ai-sidebar-toggle'),document.getElementById('miriboda-open'),rail.querySelector('[aria-controls="building-side-panel"]'),rail.querySelector('[aria-controls="layer-side-panel"]'),rail.querySelector('[aria-controls="plan-side-panel"]'),rail.querySelector('[aria-controls="silsi-side-panel"]'),...Array.from(rail.children).filter(b=>/3D/.test(b.textContent)),delivery];
 for(const button of order.filter(Boolean))rail.append(button);
 // 검수 탭 단추는 숨긴 채 둔다(2026-10-24 통과 시안 ①⑮: 그 칸은 계획 탭 마지막 단계 '법규 검사'가 연다).
 rail.setAttribute('aria-label','건축설계 작업 메뉴');
}

export function installMiriboda(studio){
 const {engine,execute,toast}=studio.context;
 let current=null,busy=false,lastPnu='',pdfUrl=null;
 const panel=document.createElement('dialog');panel.id='miriboda-dialog';panel.style.cssText='width:min(1000px,94vw);max-height:90vh;overflow:auto';
 const heading=document.createElement('h2');heading.textContent='토지정보 · 법규 검토';
 const bar=document.createElement('div');bar.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
 const content=document.createElement('div');content.id='miriboda-content';
 // 오른쪽 막대의 '토지·법규' 단추는 뺐다. 쓰는 법이 드러나지 않아 자리만 차지했다.
 // 창과 토지정보 흐름(대지 주소 가져오기 → AI 맥락·PDF)은 그대로 살아 있고, MIRIBODA 명령으로 연다.
 const open=document.createElement('button');open.id='miriboda-open';open.textContent='토지·법규';open.hidden=true;
 const info=()=>current||findParcelEntity(engine.doc.entities,e=>e.parcelRole==='site'&&e.attributes?.landInfo,'site')?.attributes.landInfo;
 const line=(parent,text,tag='p')=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;};
 const run=async fn=>{if(busy)return;busy=true;bar.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){toast(e.message,true);}finally{busy=false;bar.querySelectorAll('button').forEach(b=>b.disabled=false);}};
 const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>run(fn);bar.append(b);return b;};
 function render(){
  content.replaceChildren();const data=info();
  if(!data){line(content,'주소로 대지를 가져오면 토지정보와 법규 검토가 여기에 표시됩니다.');return;}
  line(content,data.address||data.pnu,'h3');
  if(data.error){line(content,'자동 조회 실패: '+data.error);return;}
  const mass=data.massing||{},limits=data.limits||{};
  line(content,`대지 ${Number(data.areaM2).toFixed(2)}㎡ · 건폐율 ${limits.bcr??'미확인'}% · 용적률 ${limits.far??'미확인'}%`,'h3');
  line(content,`미리보다 검토 기준 ${mass.zoneName||'미확인'} · 최대 건축면적 ${mass.maxBuildingAreaM2??'—'}㎡ · 최대 연면적 ${mass.maxFloorAreaM2??'—'}㎡`);
  line(content,data.reviewScope||'미리보다 개략 검토');
  for(const warning of data.warnings||[])line(content,warning).style.color='#ffbd66';
  if(data.suggestions?.length){line(content,'계획 조정 제안','h3');for(const suggestion of data.suggestions)line(content,suggestion);}
  if(data.eumUrl){const link=document.createElement('a');link.textContent='토지이음 원문 · 지역지구 및 행위제한 확인';link.href=data.eumUrl;link.target='_blank';link.rel='noopener';content.append(link);}
  line(content,'토지이용 지역·지구','h3');
  for(const z of data.zones||[])line(content,`${z.name} · ${z.relation} · 자료 갱신 ${z.updated||'미상'}`);
  for(const section of data.review?.report?.sections||[]){
   line(content,section.title,'h3');
   for(const row of section.rows||[]){const el=line(content,`${row.label?row.label+' — ':''}${row.value?.v??''}`);if(row.tone==='warn'||row.tone==='danger')el.style.color='#ffbd66';}
   if(section.note)line(content,section.note);
  }
  const plan=engine.doc.sitePlan;
  if(plan){line(content,'생성 배치 검토','h3');line(content,sitePlanStatus(engine.doc).label);for(const c of plan.report.checks||[]){const el=line(content,`${c.ok?'통과':'NG'} · ${c.rule} · ${c.value??''} / ${c.limit??''}${c.provisional?' · 잠정':''}`);if(!c.ok)el.style.color='#ff8585';}}
  line(content,data.review?.disclaimer||'');line(content,`${data.source||''} · 조회 ${data.queriedAt||''}`);
 }
 async function refresh(){const snapshot=JSON.stringify(engine.doc);const data=await studio.api('miriboda',{action:'land',entities:engine.doc.entities,program:engine.doc.sitePlan?.request?.program});if(JSON.stringify(engine.doc)!==snapshot)throw Error('조회 중 도면이 바뀌었습니다. 다시 조회하세요.');current=data.landInfo;execute({type:'parcel.info',info:current});render();}
 button('정보 다시 조회',refresh);
 button('계획도면 만들기',async()=>{panel.close();toast(await studio.context.sitePlanGenerate());});
 button('정보표 도면에 갱신',()=>{if(!info())throw Error('토지정보가 없습니다.');execute({type:'parcel.info',info:info()});toast('토지정보표를 도면에 넣었습니다.');});
 button('법규 검토 PDF',async()=>{
  if(engine.doc.sitePlan&&sitePlanStatus(engine.doc).stale)throw Error('수정한 배치를 먼저 재검증하세요.');
  const plan=engine.doc.sitePlan;if(plan&&plan.sunlightDrawing?.applies!==false&&(!plan.sunlightDrawing?.entityIds?.length||plan.sunlightDrawing.entityIds.some(id=>!engine.doc.entities.some(e=>e.id===id))))throw Error('일조 검토도가 누락되었습니다. 계획을 다시 생성하세요.');
  const result=await studio.api('miriboda',{action:'pdf',landInfo:info(),report:plan?.report,site:plan?.request?.site,sunlightReview:plan?.sunlightDrawing});
  if(result.renderer==='cad-fallback')toast('미리보다 PDF 서버 오류로, 받은 검토자료를 CAD PDF로 출력했습니다.');
  const viewer=document.createElement('dialog');viewer.style.cssText='width:94vw;height:90vh';
  const save=document.createElement('button');save.textContent='PDF 저장';save.onclick=()=>studio.output(result.data,result.filename,'application/pdf').catch(e=>toast(e.message,true));
  const close=document.createElement('button');close.textContent='닫기';close.onclick=()=>viewer.close();
  const frame=document.createElement('iframe');frame.title='미리보다 법규 검토 PDF';frame.style.cssText='width:100%;height:90%;border:0';
  const url=URL.createObjectURL(new Blob([studio.context.bytes(result.data)],{type:'application/pdf'}));frame.src=url;
  viewer.append(save,close,frame);document.body.append(viewer);viewer.addEventListener('close',()=>{URL.revokeObjectURL(url);viewer.remove();});viewer.showModal();
 });
 /* Legacy entry point shares the plan delivery form below. */
 button('건축주에게 계획 보내기',()=>studio.context.openPlanDelivery());

 button('닫기',()=>panel.close());panel.append(heading,bar,content);document.body.append(panel);
 open.onclick=()=>{current=null;render();panel.showModal();};
 studio.handlers.MIRIBODA=()=>open.click();   // 막대에서 뺀 대신 명령창에서 부른다
 studio.context.setMiribodaInfo=data=>{current=data;render();};
 studio.context.getMiribodaInfo=info;
 studio.context.miribodaRefresh=refresh;   // 계획 탭(지적도 만들기)이 같은 조회·토지정보표 갱신을 쓴다
 queueMicrotask(()=>installPlanDelivery(studio));
 studio.context.miribodaContext=()=>{const data=info();return data?{address:data.address,zones:data.zones,limits:data.limits,massing:data.massing,warnings:data.warnings,error:data.error}:null;};
 engine.onChange(()=>{const data=findParcelEntity(engine.doc.entities,e=>e.parcelRole==='site'&&e.attributes?.landInfo,'site')?.attributes.landInfo;current=data||null;if(!data){lastPnu='';current=null;return;}if(lastPnu!==data.pnu){lastPnu=data.pnu;current=data;const switched=studio.context.isSwitchingDrawing?.();queueMicrotask(()=>{render();/* Land updates do not open a duplicate review panel. */});}else if(panel.open)render();});
}
