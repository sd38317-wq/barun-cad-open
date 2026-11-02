// 에너지절약계획서. 기준은 energy_saving_plan_standards.json(고시 제2026-360호·시행령 제10조) 값만 쓴다. 면적은 ㎡.
import {APPLICABILITY,PROGRESS,reviewValue,makeReviewItem} from './review-model.js';
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const m2=n=>n.toLocaleString('ko-KR')+'㎡';
export const PART_LABEL={nonres:'비주거',res:'주거'},COLUMN_LABEL={nonres_large:'비주거 대형',nonres_small:'비주거 소형',house:'주택 1·2(냉방 방식으로 정함)'};
// 건축법 시행령 별표1 용도(호). 5-zoo·3-ah 는 예외 조문에 따로 나오는 세부 용도.
const USES=[['1','단독주택'],['2','공동주택'],['3','제1종 근린생활시설'],['3-ah','제1종 근린생활시설 아목(변전소·정수장 등)'],['4','제2종 근린생활시설'],['5','문화 및 집회시설'],['5-zoo','문화 및 집회시설 중 동ㆍ식물원'],['6','종교시설'],['7','판매시설'],['8','운수시설'],['9','의료시설'],['10','교육연구시설'],['11','노유자시설'],['12','수련시설'],['13','운동시설'],['14','업무시설'],['15','숙박시설'],['16','위락시설'],['17','공장'],['18','창고시설'],['19','위험물 저장 및 처리 시설'],['20','자동차 관련 시설'],['21','동물 및 식물 관련 시설'],['22','자원순환 관련 시설'],['23','교정시설'],['23-2','국방ㆍ군사시설'],['24','방송통신시설'],['25','발전시설'],['26','묘지 관련 시설'],['27','관광 휴게시설'],['28','장례시설'],['29','야영장 시설']];
const yesNo=[['','—'],['yes','예'],['no','아니오']];
export const ENERGY_PLAN_FIELDS=[
 {name:'mainUse',label:'주 용도 (건축법 시행령 별표1)',type:'select',options:[['','—'],...USES.map(([v,l])=>[v,(v.includes('-')?'':v+'. ')+l])]},
 {name:'mixedUse',label:'다른 용도도 있음',type:'select',options:[['','—'],['no','없음'],['yes','있음(복합용도)']]},
 {name:'work',label:'공사 종류',type:'select',options:[['','—'],['new','신축'],['rebuild','재축'],['full_remodel','전부 개축'],['annex','별동 증축'],['extension','증축'],['use_change','용도변경'],['register_change','건축물대장 기재내용 변경'],['permit_change','허가·신고사항 변경']]},
 {name:'nonResidentialAreaM2',label:'비주거 연면적 ㎡ (주차장·기계실 빼고)',type:'number'},
 {name:'residentialAreaM2',label:'주거 연면적 ㎡ (공동주택, 주차장·기계실 빼고)',type:'number'},
 {name:'hvac',label:'냉난방 설비',type:'select',options:[['','—'],['both','냉방·난방 모두'],['heating','난방만'],['cooling','냉방만'],['none','둘 다 없음']]},
 {name:'hvacAreaM2',label:'냉난방 공급 대상 연면적 ㎡ (창고·공장·운동시설 등만)',type:'number'},
 {name:'publicAgency',label:'공공기관 건축물',type:'select',options:yesNo},
 {name:'housingProjectApproved',label:'주택법 사업계획승인 + 친환경주택 건설기준 적합',type:'select',options:yesNo}];
const NUMBER_FIELDS=['nonResidentialAreaM2','residentialAreaM2','hvacAreaM2'];
/** 별표1 용도 번호 → 이름(없으면 ''). */
export const energyUseLabel=v=>USES.find(([k])=>k===v)?.[1]??'';
/** 도면 인식 개요 → 에너지 빈칸 기본값. 주용도 글이 별표1 용도 하나와만 맞을 때만 고른다(1종·2종 근생처럼 애매하면 비움).
 *  연면적은 주용도가 공동주택이면 주거, 그 밖(단독주택 제외)은 비주거 칸에. 층고는 mm → m. */
export function energyDefaultsFromOverview(ov){
 const plan={},text=String(ov?.mainUse??'').replace(/\s+/g,'');
 const hits=text?USES.filter(([v,l])=>!v.includes('-')&&text.includes(l.replace(/\s+/g,''))):[];
 if(hits.length===1){plan.mainUse=hits[0][0];const gfa=Number(ov.gfa);if(gfa>0&&plan.mainUse!=='1')plan[plan.mainUse==='2'?'residentialAreaM2':'nonResidentialAreaM2']=gfa;}
 const h=Number(ov?.storyHeight);
 return {plan,storyHeightM:h>0?Math.round(h)/1000:null};
}
/** 입력 창 값 → 도면 reviewSettings.energyPlan. 하나라도 틀리면 아무것도 저장하지 않는다. */
export function applyEnergyPlanInputs(engine,values){
 const out={};
 for(const f of ENERGY_PLAN_FIELDS){const raw=values[f.name]==null?'':String(values[f.name]).trim();
  if(NUMBER_FIELDS.includes(f.name)){if(raw===''){out[f.name]=null;continue;}const n=Number(raw);if(!finite(n))throw Error(f.label+': 면적은 0 이상의 숫자로 입력하세요.');out[f.name]=n;continue;}
  if(raw!==''&&!f.options.some(([v])=>v===raw))throw Error(f.label+': 고를 수 있는 용도·값이 아닙니다.');out[f.name]=raw||null;}
 engine.execute({type:'review.settings',settings:{energyPlan:out}});
}
/** 판정 결과를 사람이 읽는 줄로. 검토 항목 사유와 검토창 카드가 같이 쓴다. */
export function planSummary(r){
 const targets=r.parts.filter(p=>p.target);
 const head=r.status==='target'?'제출 대상 · '+targets.map(p=>`${PART_LABEL[p.part]} ${m2(p.areaM2)}`).join(' · ')+' (500㎡ 이상)':r.status==='need_input'?'계획서 조건 입력 필요: '+r.needs.join(', '):r.status==='check'?'제출 대상 확인 필요':'제출 대상 아님';
 return {head,columns:targets.map(p=>COLUMN_LABEL[p.column]),passScore:r.passScore,over1000:r.over1000.applies,energyDemand:r.energyDemand.applies};
}
/** 검토창 에너지 탭 맨 위 카드. 판정은 energyPlanReviewItem 과 같은 planSubmission 을 쓴다. */
export function energyPlanCard({doc,db,onEdit}){
 const document=globalThis.document,card=document.createElement('div'),title=document.createElement('strong');
 card.setAttribute('class','energy-plan-card');card.setAttribute('style','border:1px solid #3a414b;border-radius:8px;padding:8px 10px;margin:6px 0');
 title.textContent='에너지절약계획서';card.append(title);
 const line=(text,cls)=>{const p=document.createElement('p');p.textContent=text;if(cls)p.setAttribute('class',cls);card.append(p);};
 const row=(label,value)=>{const r=document.createElement('div'),a=document.createElement('span'),b=document.createElement('span');a.textContent=label;a.setAttribute('style','white-space:nowrap');b.textContent=value;b.setAttribute('style','text-align:right');r.setAttribute('style','display:flex;justify-content:space-between;gap:8px');r.append(a,b);card.append(r);};
 if(db?.verified!==true||!db?.rules)line('에너지절약계획서 기준 DB를 열 수 없습니다. 계정 연결 상태를 확인하세요.');
 else{
  line(`${db.noticeNo.replace('국토교통부고시 제','')} 기준 · ${db.effectiveDate} 시행`,'lc-scope');
  const r=planSubmission(doc.reviewSettings?.energyPlan,db),sum=planSummary(r);
  row('제출 대상',sum.head.replace(/^제출 대상 · /,'대상 · ').replace(/^제출 대상 아님/,'대상 아님').replace(/^제출 대상 확인 필요/,'확인 필요').replace(/^계획서 조건 /,'조건 '));
  if(r.status==='target'){row('점수표 칸',sum.columns.join(' · '));row('적합 기준',`${r.passScore}점 이상`);row('1천㎡ 이상 필수 조건',r.over1000.applies?`적용 · ${r.over1000.requirements.length}개`:'해당 없음');row('에너지소요량 평가서',r.energyDemand.applies?`대상 · 1차 에너지소요량 ${r.energyDemand.passKwhPerM2Year} kWh/㎡년 미만`:'해당 없음');}
  else for(const brief of r.briefs)line(brief);
 }
 const edit=document.createElement('button');edit.textContent='계획서 조건 입력';edit.onclick=()=>onEdit();card.append(edit);
 return card;
}
export function energyPlanReviewItem(doc,db,at=new Date().toISOString()){
 const base={id:'energy:plan-submission',field:'energy',name:'에너지절약계획서 · 제출 대상',progress:PROGRESS.done,evaluatedAt:at,nextAction:'에너지 탭 [계획서 조건]에서 용도·공사 종류·연면적을 확인하세요.'};
 if(db?.verified!==true||!db?.rules)return makeReviewItem({...base,status:'check_detail',reason:'에너지절약계획서 기준 DB를 열 수 없어 판정하지 않았습니다.'});
 const s=doc.reviewSettings?.energyPlan||{},r=planSubmission(s,db),sum=planSummary(r),areas=r.parts.map(p=>p.areaM2).filter(v=>v!==null);
 const statute=[db.statute,db.noticeNo,db.effectiveDate].join(' · ');
 const detail=r.status==='target'?[`${sum.columns.join('·')} 칸`,`${r.passScore}점 이상`,r.over1000.applies?`1천㎡ 필수 조건 ${r.over1000.requirements.length}개`:null,r.energyDemand.applies?'에너지소요량 평가서도 대상':null]:r.briefs;
 return makeReviewItem({...base,status:{target:'check_detail',check:'check_detail',need_input:'need_input'}[r.status]||'satisfied',applicability:APPLICABILITY.applicable,
  current:reviewValue({value:areas.length?areas.reduce((a,b)=>a+b,0):null,unit:'㎡',sourceKind:'designer',confirmation:areas.length?'confirmed':'unconfirmed'}),
  criterion:{name:'연면적 합계',value:db.rules.submission.minGrossFloorAreaM2,unit:'㎡',operator:'>=',sourceId:db.rules.submission.source},
  reason:[sum.head,...detail.filter(Boolean)].join(' · '),unknowns:r.status==='need_input'?r.needs:[],nextAction:[base.nextAction,...r.notes].join(' '),
  evidence:[...r.reasons,db.rules.submission.source,db.rules.submission.noticeExemptions.source,db.rules.epiJudgement.source,...(r.energyDemand.applies?[r.energyDemand.source]:[])],
  statuteRef:statute,ruleSetId:db.schema,ruleVersionId:db.noticeNo,effectiveDate:db.effectiveDate});
}
const NEW_WORKS=['new','rebuild','full_remodel','annex'];
// 건축법 시행령 별표1 호. 냉난방 조건부 예외: 시행령 제10조제1항제3호(17~26호) · 고시 제3조제1항제1~4호.
const DECREE_HVAC_USES=['17','18','19','20','21','22','23','23-2','24','25','26'],NOTICE_HVAC_USES={'3-ah':0,'13':1,'16':2,'27':3};
// 예외면 {full: 원문 근거, brief: 화면용 한 줄}, 아니면 null. 판정에 모자란 입력은 needs 에 넣는다.
function planExemption(s,sub,needs){
 const use=USES.find(([v])=>v===s.mainUse)?.[1]??'';
 const decree=(i,brief)=>({full:`${sub.decreeExemptions[i]} (${sub.source})`,brief:`${brief} — 시행령 제10조제1항제${i+1}호`}),notice=(i,brief)=>({full:`${sub.noticeExemptions.items[i]} (${sub.noticeExemptions.source})`,brief:`${brief} — 고시 제3조제1항제${i+1}호`});
 if(s.mainUse==='1')return decree(0,'단독주택');
 if(s.mainUse==='5-zoo')return decree(1,'동ㆍ식물원');
 if(s.mainUse==='2'&&s.housingProjectApproved==='yes')return notice(4,'사업계획승인 주택(친환경주택 건설기준 적합)');
 const decreeUse=DECREE_HVAC_USES.includes(s.mainUse),noticeUse=Object.hasOwn(NOTICE_HVAC_USES,s.mainUse);
 if(!decreeUse&&!noticeUse)return null;
 if(!['none','heating','cooling','both'].includes(s.hvac)){needs.push('냉난방 설비');return null;}
 if(s.hvac==='none')return decreeUse?decree(2,`냉방·난방 설비 모두 없는 ${use}`):notice(NOTICE_HVAC_USES[s.mainUse],`냉방·난방 설비 없는 ${use}`);
 if(!finite(s.hvacAreaM2)){needs.push('냉난방 공급 연면적');return null;}
 return s.hvacAreaM2<sub.minGrossFloorAreaM2?{full:`${sub.hvacAreaUnder500.text} (${sub.hvacAreaUnder500.source})`,brief:`냉난방 공급 대상 연면적 ${m2(s.hvacAreaM2)} (${m2(sub.minGrossFloorAreaM2)} 미만) — 고시 제3조제3항`}:null;
}
export function planSubmission(settings,db){
 const s=settings||{},sub=db.rules.submission,epi=db.rules.epiJudgement,min=sub.minGrossFloorAreaM2;
 const nonres=finite(s.nonResidentialAreaM2)?s.nonResidentialAreaM2:null,res=finite(s.residentialAreaM2)?s.residentialAreaM2:null;
 const parts=[{part:'nonres',areaM2:nonres},{part:'res',areaM2:res}].map(p=>({...p,target:p.areaM2!==null&&p.areaM2>=min,column:p.areaM2===null||p.areaM2<min?null:p.part==='nonres'?(p.areaM2>=3000?'nonres_large':'nonres_small'):'house'}));
 const total=(nonres||0)+(res||0),needs=[],reasons=[],briefs=[];
 if(!s.mainUse)needs.push('주 용도');if(!s.work)needs.push('공사 종류');
 if(nonres===null&&res===null)needs.push('연면적');
 else if(!parts.some(p=>p.target)){if(nonres===null)needs.push('비주거 연면적');if(res===null)needs.push('주거 연면적');}
 const over1000={applies:total>=epi.over1000.minGrossFloorAreaM2&&NEW_WORKS.includes(s.work),requirements:epi.over1000.requirements,source:epi.source};
 const exemption=planExemption(s,sub,needs);
 let status=parts.some(p=>p.target)?'target':'not_target';
 if(exemption){status=s.mixedUse==='yes'?'check':'exempt';reasons.push(exemption.full);briefs.push(exemption.brief);if(status==='check'){const mixed='혼합 용도 — 예외는 그 용도 부분에만 해당하는지 확인하세요.';reasons.push(mixed);briefs.push(mixed);}}
 else if(status==='not_target'&&nonres!==null&&res!==null){reasons.push(`주거 ${m2(res)} · 비주거 ${m2(nonres)} 모두 ${m2(min)} 미만 (주거·비주거 따로 계산, ${sub.source})`);briefs.push(`주거 ${m2(res)} · 비주거 ${m2(nonres)} 모두 ${m2(min)} 미만 — 주거·비주거 따로 계산`);}
 if(needs.length&&status!=='exempt')status='need_input';
 const calc=sub.areaCalculation,notes=[calc.items[4],calc.items[1]];
 if(['extension','use_change','register_change'].includes(s.work))notes.push(calc.items[2]);
 if(s.work==='permit_change')notes.push(calc.items[3]);
 const publicNew=s.publicAgency==='yes'&&['new','annex'].includes(s.work);
 if(s.publicAgency!=='yes'&&s.publicAgency!=='no')notes.push(`공공기관이 신축하면 ${epi.publicNewBuildPassScore}점 이상 (${epi.source})`);
 const demand=db.rules.energyDemand,demandUse={'14':'업무시설','10':'교육연구시설'}[s.mainUse],demandTarget=demand.targets.find(t=>t.use===demandUse);
 const energyDemand={applies:!!demandTarget&&nonres!==null&&nonres>=demandTarget.minGrossFloorAreaM2&&['new','annex'].includes(s.work),passKwhPerM2Year:s.publicAgency==='yes'?demand.publicPassKwhPerM2Year:demand.passKwhPerM2Year,text:demandTarget?.text??null,source:demand.source};
 if(energyDemand.applies&&s.mixedUse==='yes')notes.push(`혼합 용도 — ${demandUse} 부분 연면적으로 소요량 평가 대상인지 확인하세요.`);
 return {status,needs,reasons,briefs,notes,parts,passScore:publicNew?epi.publicNewBuildPassScore:epi.passScore,over1000,energyDemand};
}
export async function loadEnergyPlanStandards(){const response=await fetch('/energy-plan-standards.json',{cache:'no-store'});if(!response.ok)throw Error('에너지절약계획서 기준 DB를 열 수 없습니다. 계정 연결 상태를 확인하세요.');return response.json();}
// AI가 개요(개요표·면적표)에서 읽은 값. 조건은 reviewSettings.energyPlan, 근거·확인할 칸은 energyPlanMeta 에 둔다.
const OVERVIEW_EXTRA=['address','floorsAbove','floorsBelow'];
const OVERVIEW_KEYS=[...ENERGY_PLAN_FIELDS.map(f=>f.name),...OVERVIEW_EXTRA];
function overviewValue(key,value){
 if(value==null||value==='')return null;
 if(key==='address'){if(typeof value!=='string')throw Error('주소는 글자여야 합니다.');return value.trim()||null;}
 if(key==='floorsAbove'||key==='floorsBelow'){if(!Number.isInteger(value)||value<0)throw Error('층수는 0 이상의 정수여야 합니다.');return value;}
 if(NUMBER_FIELDS.includes(key)){if(!finite(value))throw Error(key+': 면적은 0 이상의 숫자여야 합니다.');return value;}
 const field=ENERGY_PLAN_FIELDS.find(f=>f.name===key);if(!field.options.some(([v])=>v===value))throw Error(field.label+': 고를 수 있는 용도·값이 아닙니다.');return value;
}
/** AI 결과 {values,evidence,confirm} → 도면. 빈 칸(null)은 확인할 칸에 더한다. 하나라도 틀리면 아무것도 저장하지 않는다. */
export function applyEnergyPlanOverview(engine,{values={},evidence={},confirm=[]}={},at=new Date().toISOString()){
 for(const key of [...Object.keys(values),...Object.keys(evidence),...confirm])if(!OVERVIEW_KEYS.includes(key))throw Error('개요에 없는 칸입니다: '+key);
 const plan={},meta={source:'ai',readAt:at,evidence:{},confirm:[]};
 for(const key of OVERVIEW_KEYS){const v=overviewValue(key,values[key]);if(OVERVIEW_EXTRA.includes(key))meta[key]=v;else plan[key]=v;if(typeof evidence[key]==='string'&&evidence[key].trim())meta.evidence[key]=evidence[key].trim();}
 meta.confirm=[...new Set([...confirm,...['mainUse','work','nonResidentialAreaM2','residentialAreaM2'].filter(k=>Object.hasOwn(values,k)&&plan[k]===null)])];
 const energy={...engine.doc.reviewSettings?.energy,...(meta.address?{address:meta.address}:{})};
 engine.execute({type:'review.settings',settings:{energyPlan:plan,energyPlanMeta:meta,energy}});
}
/** 저장된 개요 읽기 결과(없으면 null). */
export function energyPlanOverview(doc){const m=doc?.reviewSettings?.energyPlanMeta;return m?{...m,values:{...doc.reviewSettings.energyPlan}}:null;}
/** 설계자 [확인]. value 를 주면 그 값으로 고치고 근거를 '설계자 입력'으로 바꾼다. */
export function confirmEnergyPlanField(engine,key,value){
 const meta=structuredClone(engine.doc.reviewSettings?.energyPlanMeta||{evidence:{},confirm:[]}),plan={...engine.doc.reviewSettings?.energyPlan};
 if(value!==undefined){plan[key]=overviewValue(key,value);meta.evidence={...meta.evidence,[key]:'설계자 입력'};}
 meta.confirm=(meta.confirm||[]).filter(k=>k!==key);
 engine.execute({type:'review.settings',settings:{energyPlan:plan,energyPlanMeta:meta}});
}
