// 바깥 AI 첫 연결 허락 창(10-21). 엔진(ai_consent.py)이 다리 pulse 의 aiConsent 로 기다리는 요청을 알려 주면
// "OOO가 이 CAD를 쓰려고 합니다 [허락] [거절]"을 띄우고, 답은 화면 토큰으로만 /api/ai-consent 에 보낸다.
// 계정 창 [허락한 AI 관리]는 기억한 프로그램 목록과 [취소]를 보여 준다.

const open=new Map();       // 요청 id → dialog
const dismissed=new Set();  // Esc 로 닫은 요청은 다시 띄우지 않는다(시간이 지나면 엔진이 지운다)

function line(doc,text,className){const p=doc.createElement('p');p.textContent=text;if(className)p.className=className;return p;}

export function describeProgram(item){
 const parts=[];
 if(item.program)parts.push('프로그램: '+item.program);
 parts.push(item.signer?'서명: '+item.signer:'서명 없는 프로그램');
 return parts.join(' · ');
}

function consentDialog(item,{api,doc,toast}){
 const dialog=doc.createElement('dialog');dialog.className='drawing-close-dialog ai-consent-dialog';
 const heading=doc.createElement('h2');heading.textContent=`${item.label}이(가) 이 CAD를 쓰려고 합니다`;
 dialog.append(heading,line(doc,'허락하면 이 AI 프로그램이 도면을 읽고, 그리고, 고치고, 저장할 수 있습니다. 처음 보는 프로그램이면 [거절]을 누르세요.'),line(doc,describeProgram(item)));
 if(!item.signer&&item.path)dialog.append(line(doc,'위치: '+item.path));
 if(item.remember===false)dialog.append(line(doc,'이 프로그램은 다른 스크립트도 돌릴 수 있어 기억하지 않고 이번 연결만 허락합니다.'));
 let answered=false;
 const answer=async(allow,event)=>{
  if(answered||event?.isTrusted===false)return;answered=true;
  try{await api('ai-consent',{action:'decide',id:item.id,allow});toast?.(allow?`${item.label} 연결을 허락했습니다.`:`${item.label} 연결을 거절했습니다.`);}
  catch(error){toast?.(String(error?.message||error),true);}
  finally{close(item.id);}
 };
 for(const [label,allow] of [['허락',true],['거절',false]]){const b=doc.createElement('button');b.type='button';b.textContent=label;b.dataset.consent=allow?'allow':'deny';b.autofocus=!allow;b.onclick=e=>answer(allow,e);dialog.append(b);}  // Enter 한 번에 허락되지 않게 처음 초점은 [거절]
 dialog.oncancel=e=>{e.preventDefault();dismissed.add(item.id);close(item.id);};
 return dialog;
}

function close(id){const dialog=open.get(id);open.delete(id);if(dialog){if(dialog.open)dialog.close();dialog.remove();}}

/* pulse 마다 부른다. 목록에 없는 요청(답했거나 시간이 지남) 창은 닫고, 새 요청은 하나씩 띄운다. */
export function showConsentRequests(list,{api,doc=globalThis.document,toast}={}){
 const items=Array.isArray(list)?list.filter(item=>item&&typeof item.id==='string'):[];
 const ids=new Set(items.map(item=>item.id));
 for(const id of [...open.keys()])if(!ids.has(id))close(id);
 for(const id of [...dismissed])if(!ids.has(id))dismissed.delete(id);
 for(const item of items){
  if(open.has(item.id)||dismissed.has(item.id)||!doc?.body)continue;
  const dialog=consentDialog(item,{api,doc,toast});open.set(item.id,dialog);doc.body.append(dialog);
  if(typeof dialog.showModal==='function')dialog.showModal();
 }
 return open.size;
}

/* 계정 창 [허락한 AI 관리]: 기억한 프로그램과 [취소]. 취소하면 다음 연결 때 다시 묻는다. */
export async function openConsentManager({api,doc=globalThis.document,toast}={}){
 const {entries=[]}=await api('ai-consent',{action:'list'});
 const dialog=doc.createElement('dialog');dialog.className='drawing-close-dialog ai-consent-manager';
 const heading=doc.createElement('h2');heading.textContent='허락한 AI 관리';dialog.append(heading);
 const body=doc.createElement('div');dialog.append(body);
 const render=rows=>{
  body.replaceChildren();
  if(!rows.length){body.append(line(doc,'아직 허락하거나 거절한 AI 프로그램이 없습니다.'));return;}
  for(const row of rows){
   const item=doc.createElement('div');item.className='ai-consent-row';
   item.append(line(doc,`${row.label} — ${row.decision==='allow'?'허락함':'거절함'}`),line(doc,describeProgram(row)));
   const remove=doc.createElement('button');remove.type='button';remove.textContent=row.decision==='allow'?'허락 취소':'거절 지우기';
   remove.onclick=async()=>{try{await api('ai-consent',{action:'revoke',key:row.key});toast?.(`${row.label}: 다음 연결 때 다시 묻습니다.`);render((await api('ai-consent',{action:'list'})).entries||[]);}catch(error){toast?.(String(error?.message||error),true);}};
   item.append(remove);body.append(item);
  }
 };
 render(entries);
 const done=doc.createElement('button');done.type='button';done.textContent='닫기';done.onclick=()=>dialog.close();dialog.append(done);
 dialog.addEventListener('close',()=>dialog.remove());doc.body.append(dialog);
 if(typeof dialog.showModal==='function')dialog.showModal();
 return dialog;
}
