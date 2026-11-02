// 한국 설치종류 판정과 실측 검토. 대상 범위·수치·출처는 한국 팩만 소유한다.
import {resolveDrawingDate, selectLawsForDate, valueAt} from './drawing-details/checks.js';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const compare=(v,op,n)=>op==='>='?v>=n:op==='<='?v<=n:op==='=='?v===n:op==='>'?v>n:v<n;
const FACILITY_ALIASES={'공동주택':['apartment','multi-family','dormitory'],'아파트':['apartment'],'다세대주택':['multi-family'],'연립주택':['multi-family'],'연립·다세대주택':['multi-family'],'기숙사':['dormitory']};
export function normalizeAccessFacility(facility,knowledge) { const input={...(facility||{})}, value=String(input.use||'').trim(), ids=FACILITY_ALIASES[value]; if(!ids)return {facility:input,suggestions:[]}; const profiles=(knowledge?.planRules?.profiles||[]).filter(p=>ids.includes(p.id)); const suggestions=profiles.map(p=>({id:p.id,name:p.name,needs:p.conditions?.map(c=>c.field)||[]})); if(value==='공동주택')return {facility:input,suggestions,needs:['facility.use'],ambiguous:true}; const selected=profiles.find(p=>p.id===value)||profiles[0]; return {facility:{...input,use:selected?.id||value},suggestions}; }
export function evaluateAccessFacility(facility, knowledge) {
  const rules=knowledge?.planRules;
  if(!rules)throw Error('한국 팩의 편의시설 설치종류 기준이 없습니다.');
  if(!facility || !finite(facility.areaM2)||facility.areaM2<=0)throw Error('해당 용도 바닥면적(㎡)을 양수로 입력하세요.');
  if(!['new','change-use'].includes(facility.work))throw Error('신축 또는 용도변경을 선택하세요.');
  for(const key of ['parkingSpaces','rooms','units','residents'])if(facility[key]!=null&&(!Number.isInteger(facility[key])||facility[key]<0))throw Error(key+'은 비음수 정수로 입력하세요.');
  if(facility.parkingRatio!=null&&(!finite(facility.parkingRatio)||facility.parkingRatio<0||facility.parkingRatio>1))throw Error('주차 설치비율은 0~1로 입력하세요.');
  if(facility.employmentObligation!=null&&typeof facility.employmentObligation!=='boolean')throw Error('공장 고용의무는 참/거짓으로 입력하세요.');
  if(facility.parkingKind!=null&&!['ancillary','off-street'].includes(facility.parkingKind))throw Error('주차장 종류를 확인하세요.');
  if(facility.noiseDb!=null&&(!finite(facility.noiseDb)||facility.noiseDb<0))throw Error('소음은 비음수 dB로 입력하세요.');
  const normalized=normalizeAccessFacility(facility,knowledge); if(normalized.ambiguous)throw Error('공동주택의 세부용도를 선택하세요: '+normalized.suggestions.map(s=>s.name).join(', ')+' (기본 제안: 아파트; 세대수·시설 용도를 확인하세요.)'); facility=normalized.facility;
  const date=resolveDrawingDate({},facility.date), profile=rules.profiles.find(p=>p.id===facility.use||p.aliases?.includes(facility.use));
  if(!profile)throw Error('대상시설 세부용도를 확인하세요: '+facility.use);
  const version=(rules.versions||[]).filter(v=>v.effective<=date&&(!v.until||date<v.until)).at(-1);
  const items=[...rules.items,...(rules.nonMatrixItems||[]).filter(i=>profile.extraItems?.includes(i.id))];
  const base={use:profile.id,name:profile.name,areaM2:facility.areaM2,work:facility.work,date,basis:profile.basis,items};
  if(!version)return {...base,target:null,applies:null,status:'해당 날짜 법 판 추가 필요',rows:items.map(i=>({...i,requirement:'unknown',basis:profile.basis}))};
  // 세대수 등 면적 외 조건은 반드시 별도로 받는다. 불명 용도는 다른 용도로 대신 판정하지 않는다.
  const missing=profile.conditions?.some(c=>facility[c.field]===undefined||facility[c.field]===null);
  const target=missing?null:facility.areaM2>=(profile.areaMin||0)&&(!profile.areaMax||facility.areaM2<profile.areaMax)&&(!profile.conditions||profile.conditions.every(c=>compare(facility[c.field],c.op,c.value)));
  const except=facility.work==='change-use'&&profile.changeExceptionBelow!=null&&facility.areaM2<profile.changeExceptionBelow;
  let applies=target===null?null:target&&!except;
  if(profile.id==='park'&&facility.work==='change-use')applies=null;
  if(profile.id==='public-phone'){if(!finite(facility.noiseDb))applies=null;else if(facility.noiseDb>=knowledge.laws.find(l=>l.id==='A_PLAN_PHONE_COUNT')?.values.excludedNoiseDb)applies=false;}
  const row=profile.bands.find(b=>facility.areaM2>=b.min&&(!b.max||facility.areaM2<b.max));
  const rows=items.map((item,n)=>({...item,requirement:applies===null||!row?'unknown':!applies?'not-required':(n>=rules.items.length?'mandatory':row.requirements[n])||'not-required',basis:[...profile.basis,...(except?rules.changeExceptionBasis:[]),...(row?.basis||[])]}));
  return {...base,target,applies,scopeReview:profile.scopeReview||[],status:!row?'설치종류 표 행 확인 필요':applies===null?'분류 조건 확인 필요':except?'주요부분 변경 적용 제외':applies?'대상시설':'면적/규모·예외 적용 대상 아님',rows};
}
export function normalizeAccessElements(model) {
  const names={accessible_wc:'accessible_wc','장애인화장실':'accessible_wc','장애인대변기':'accessible_wc',corridor:'corridor','복도':'corridor',elevator:'elevator','승강기':'elevator','접수대':'counter',ramp:'ramp','경사로':'ramp','임산부휴게실':'maternal_rest'};
  return (model.elements||[]).map(element=>{
    const e={...element,...element.props},use=String(e.use||e.roomUse||e.name||'').replace(/\s/g,'');
    if(['space','room'].includes(e.kind)&&names[use])return {...e,kind:names[use]};
    if(e.kind==='parking'&&e.accessible===true)return {...e,kind:'accessible_parking'};
    if(['space','room'].includes(e.kind)&&e.accessible===true&&['toilet','wc','화장실'].includes(use.toLowerCase()))return {...e,kind:'accessible_wc'};
    return e;
  });
}
export function reviewAccessPlan(model,facility,knowledge) {
  const decision=evaluateAccessFacility(facility,knowledge), laws=new Map(selectLawsForDate(knowledge.laws,decision.date).map(l=>[l.id,l]));
  const elements=normalizeAccessElements(model);
  const explicit=model.accessibility?.facilities||{};
  const rows=decision.rows.map(item=>{
    const declaration=explicit[item.id], candidates=elements.filter(e=>(item.kinds||[]).includes(e.kind)&&e.private!==true);
    const selected=declaration?.elementIds?candidates.filter(e=>declaration.elementIds.includes(e.id)):candidates;
    const alternatives=item.id==='stairsOrElevator',confirmed=selected.filter(e=>e.accessible===true||e.installed===true);
    const targets=alternatives?(confirmed.length?confirmed:selected.filter(e=>e.accessible!==false)):selected;
    // 이름이나 블록만 인식된 것은 설치 확인으로 바꾸지 않는다. 일반 문 폭은 통과유효폭과 다르다.
    const installed=declaration?.installed??(targets.some(e=>e.installed===true||e.accessible===true&&!e.recognized)?true:model.accessibility?.complete===true?false:null);
    const measure=e=>c=>{
      const override=c.alternative&&Object.entries(c.alternative.when).every(([k,v])=>e[k]===v)?c.alternative.lawValue:c.workValues?.[facility.work];
      const ref=override|| (typeof c.lawValue==='string'?c.lawValue:c.lawValue[facility.work]||c.lawValue.default);
      const [id,...keys]=ref.split('.'), law=laws.get(id), limit=valueAt(law?.values,keys.join('.'));
      let value=valueAt(e,c.field);if(c.field==='slope'&&finite(value))value=Math.abs(value);if(c.field==='slope'&&finite(e.rise)&&finite(e.run)&&e.run>0)value=Math.abs(e.rise/e.run);
      const ok=!finite(value)||!finite(limit)?null:value<0?false:compare(value,c.op,limit);
      return {...c,elementId:e.id,value:value??null,limit:limit??null,ok,lawValue:ref,basis:law?law.article:'해당 날짜 규격 확인 필요'};
    };
    const checks=targets.flatMap(e=>(item.checks||[]).filter(c=>!c.kinds||c.kinds.includes(e.kind)).map(measure(e)));
    // 도면에 따로 그리지 않는 시설(접근로·복도 등): 후보가 없으면 ④ 설계자 실측값으로 기준 줄을 만든다(값이 없으면 기준만 보임).
    const declared=item.declarable===true&&!targets.length;
    if(declared)checks.push(...(item.checks||[]).map(measure({id:null,kind:item.kinds?.[0],...declaration?.values})));
    let conditionPending=false,conditionNote='',applicabilityPending=false;
    if(decision.use==='park'&&decision.applies===true&&['parking','ticketVending'].includes(item.id)){
      if(declaration?.installed===false||item.id==='ticketVending'&&declaration?.serviceExempt===true)item={...item,requirement:'not-required'};
      else if(installed===true)item={...item,requirement:'mandatory'};
      else {conditionPending=true;conditionNote='해당 공원 시설 존재·면제 조건 확인';}
    }
    if(item.id==='publicPhone'&&item.requirement==='mandatory'){
      const law=laws.get('A_PLAN_PHONE_COUNT'),limit=law?.values.count,value=declaration?.count;
      checks.push({name:'접근 가능한 공중전화 수',op:'>=',value:value??null,limit:limit??null,unit:'대',ok:finite(value)&&finite(limit)?value>=limit:null,basis:law?.article||'날짜 근거 필요'});
    }
    if(item.id==='parking'&&decision.applies===true&&['mandatory','recommended'].includes(item.requirement)){
      const min=laws.get('A_PLAN_PARKING')?.values.exemptBelow;
      if(!finite(facility.parkingSpaces)||!finite(min)){conditionPending=true;applicabilityPending=decision.use!=='park'&&decision.use!=='parking-facility'&&facility.parkingKind!=='off-street';conditionNote='부설주차장 총대수·설치비율 확인';}
      else if(facility.parkingSpaces<min&&decision.use!=='park'&&decision.use!=='parking-facility'&&facility.parkingKind!=='off-street')item={...item,requirement:'not-required',basis:[...item.basis,'시행령 별표2 부설주차장 10대 미만 제외']};
      else if(!finite(facility.parkingRatio)||facility.parkingRatio<=0){conditionPending=true;conditionNote='지방 조례 장애인전용주차구역 설치비율 확인';}
      else {const value=declaration?.count,limit=Math.ceil(facility.parkingSpaces*facility.parkingRatio);checks.push({name:'장애인전용주차구역 수',value:value??null,limit,op:'>=',unit:'면',ok:finite(value)?value>=limit:null,basis:'시행령 별표2 부설주차장 설치비율 및 지방 조례(입력 비율 '+facility.parkingRatio+')'});}
    }
    if(item.id==='toilet'&&item.requirement==='mandatory'){
      const limits=laws.get('A_PLAN_WC');
      for(const [field,key] of [['maleFixtures','male'],['femaleFixtures','female']]){
        const value=declaration?.[field],limit=limits?.values[key];checks.push({name:field==='maleFixtures'?'남자용 대변기 수':'여자용 대변기 수',value:value??null,limit:limit??null,op:'>=',unit:'개',ok:!finite(value)||!finite(limit)?null:value>=limit,basis:limits?.article||'날짜 근거 필요'});
      }
      if(limits?.values.maternityInfantFacility===true&&declaration?.maternityInfantFacility!==true){conditionPending=true;conditionNote='임산부·영유아 안전편의설비 확인';}
    }
    if(item.id==='guestRoom'&&item.requirement==='mandatory'){
      const ratioLaw=laws.get('A_PLAN_GUEST'),ratio=ratioLaw?.values[decision.use==='tourist-hotel'?'touristRatio':'ratio'];
      const total=facility.rooms,value=declaration?.count,limit=finite(total)&&finite(ratio)?Math.ceil(total*ratio):null;
      checks.push({name:'장애인용 객실·침실 수',value:value??null,limit,op:'>=',unit:'실',ok:!finite(value)||!finite(limit)?null:value>=limit,basis:ratioLaw?.article||'날짜 근거 필요'});
    }
    const supplied=declaration?.verified===true;
    const alternativePass=alternatives&&targets.some(e=>{const own=checks.filter(c=>c.elementId===e.id);return own.length>0&&own.every(c=>c.ok===true);});
    const numericKnown=alternativePass||checks.length&&checks.every(c=>c.ok===true);
    const failed=alternatives?targets.length>0&&targets.every(e=>checks.some(c=>c.elementId===e.id&&c.ok===false)):checks.some(c=>c.ok===false);
    const status=item.requirement==='not-required'?'해당 없음':item.requirement==='unknown'?'검토필요':installed===false?'미설치':failed?'규격 부적합':conditionPending?'조건 확인 필요':installed===null?'설치 확인 필요':supplied&&(targets.length>0||declared)&&(!item.checks?.length||numericKnown)&&(alternativePass||checks.every(c=>c.ok===true))?'적합':'세부규격 확인 필요';
    const violation=!applicabilityPending&&item.requirement==='mandatory'&&(installed===false||failed);
    const remedy=installed===false?item.fix:failed?[...new Set(checks.filter(c=>c.ok===false).map(c=>c.name+' '+c.op+' '+c.limit+(c.unit||'')+' 확보'))].join('; '):status==='적합'||status==='해당 없음'?'':'현장 확인 및 누락 실측값 입력';
    return {...item,conditionPending,conditionNote,installed,targets:targets.map(e=>e.id),checks,status,violation,remedy,location:declaration?.location||targets.map(e=>e.location||e.name||e.id).join(', ')||'위치 미확인'};
  });
  return {decision,rows};
}
