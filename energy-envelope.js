import {siteAddress} from './ai-asks.js';
import {normalizePreset} from './wall-preset.js';
import {APPLICABILITY,PROGRESS,reviewValue,makeReviewItem,compareCriterion} from './review-model.js';
const unit='W/m2K',regions=['central1','central2','south','jeju'];
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
// 지역 원문 members를 읽는다. 괄호 안 예외는 시·군·구가 있어야 구분한다.
export function energyRegion(address,db,designer=null){
 if(designer?.sourceKind==='designer'&&designer.confirmation==='confirmed'&&regions.includes(designer.value))return designer;
 const aliases={서울:'서울특별시',부산:'부산광역시',대구:'대구광역시',인천:'인천광역시',광주:'광주광역시',대전:'대전광역시',울산:'울산광역시',세종:'세종특별자치시',경기:'경기도',강원:'강원특별자치도',강원도:'강원특별자치도',충북:'충청북도',충남:'충청남도',전북:'전북특별자치도',전라북도:'전북특별자치도',전남:'전라남도',경북:'경상북도',경남:'경상남도',제주:'제주특별자치도',제주도:'제주특별자치도'};
 const [first='',district='']=String(address||'').trim().split(/\s+/),province=aliases[first]||first;let value=null,sourceRef=null;
 for(const key of regions)for(const entry of db?.regions?.[key]?.members?.split(/,\s*(?![^()]*\))/)||[]){const m=entry.trim().match(/^([^()]+)(?:\(([^)]+)\))?$/);if(!m||m[1]!==province)continue;const spec=m[2];if(spec){if(!district)continue;const excluded=spec.includes('제외'),names=spec.replace(/ 제외/g,'').split(/,\s*/),hit=names.some(n=>district===n||district===n+'시'||district===n+'군'||district===n+'구');if(hit===excluded)continue;}value=key;sourceRef=db.regions[key].source;}
 return reviewValue({value,sourceKind:'auto_read',confirmation:value&&db?.verified===true&&sourceRef?'confirmed':'unconfirmed',sourceRef});
}
export function envelopeU(thermalLayers,surface,exposure){
 if(!Array.isArray(thermalLayers)||!thermalLayers.length)return {value:null,status:'need_input',reason:'단면 필요'};
 const missingIndex=thermalLayers.findIndex(l=>!positive(l?.lambda)),missing=thermalLayers[missingIndex];if(missingIndex>=0)return {value:null,status:'need_input',reason:'재료층 λ 미입력: '+(missing?.name||'이름 없음')};
 if(thermalLayers.some(l=>!positive(l.thicknessMm)))return {value:null,status:'need_input',reason:'재료층 두께 미입력'};
 if(thermalLayers.some(l=>!l.lambdaSource))return {value:null,status:'need_input',reason:'재료층 λ 근거 미입력'};
 if(!['direct','indirect'].includes(exposure))return {value:null,status:'need_input',reason:'외기 노출 구분 필요'};
 const Ri=surface?.Ri,Ro=surface?.[exposure==='direct'?'RoDirect':'RoIndirect'];
 if(!positive(Ri)||!positive(Ro))return {value:null,status:'check_detail',reason:'표면 열전달저항 기준값 대조 전'};
 const value=1/(Ri+thermalLayers.reduce((r,l)=>r+l.thicknessMm/1000/l.lambda,0)+Ro);return positive(value)?{value,status:null,reason:''}:{value:null,status:'check_detail',reason:'열관류율 계산 범위 확인 필요'};
}
export function energyPart(e){const prefix=String(e.reviewObjectId||'').split('-')[0];return ({EW:'wall',W:'window',RF:'roof',FL:'floor'})[prefix]||(['wall','window','roof','floor'].includes(e.type)?e.type:e.category==='WINDOW'||Object.hasOwn(e,'uValue')?'window':e.wallPreset?'wall':e.model3d?.kind==='roof'?'roof':e.model3d?.kind==='slab'?'floor':null);}
export function energyReviewItems(doc,db,at=new Date().toISOString()){
 const settings=doc.reviewSettings?.energy||{},region=energyRegion(settings.address||siteAddress(doc).address||doc.siteContext?.landInfo?.address||doc.siteAnalysis?.address,db,settings.region),groups=new Map();
 for(const e of doc.entities||[]){const part=energyPart(e);if(!part)continue;const key=e.reviewObjectId||e.id;if(!groups.has(key))groups.set(key,{part,entities:[]});groups.get(key).entities.push(e);}
 for(const part of ['wall','window','roof','floor'])if(![...groups.values()].some(g=>g.part===part))groups.set(part,{part,entities:[]});
 const statuteRef=[db?.statute,db?.noticeNo,db?.effectiveDate].filter(Boolean).join(' · '),items=[];
 for(const [key,{part,entities}]of groups){
  const e=entities[0]||{},uValue=Object.hasOwn(e,'uValue')?e.uValue:e.parameters?.uValue,exposure=e.exposure??null,use=e.energyUse??settings.use,condition=e.energyCondition??settings.condition;
  const row=db?.maxU?.find(r=>r.part===part&&r.region===region.value&&r.exposure===exposure&&(r.use===undefined||r.use===use)&&(r.condition===undefined||r.condition===condition));
  const surfaces=db?.surfaceResistance,surface=Array.isArray(surfaces)?surfaces.find(r=>r.part===part):surfaces?.[part],criterion={name:'열관류율',value:positive(row?.maxU)?row.maxU:null,unit,operator:'<=',sourceId:row?.source??null};
  let result=part==='window'?{value:positive(uValue)?uValue:null,status:'need_input',reason:'창호 성능자료 없음'}:envelopeU(e.thermalLayers,surface,exposure);
  if(part==='window'&&result.value!==null)result={...result,status:null,reason:''};
  const current=reviewValue({value:result.value,unit,sourceKind:'auto_read',confirmation:result.value===null?'unconfirmed':'confirmed',sourceRef:part==='window'?e.performanceSource??'designer':Array.isArray(e.thermalLayers)?e.thermalLayers.map(l=>l?.lambdaSource):null});
  const missingInput=region.value===null?'지역 구분 필요':!['direct','indirect'].includes(exposure)?'외기 노출 구분 필요':db?.maxU?.some(r=>r.part===part&&r.use!==undefined)&&!['apartment','non_apartment'].includes(use)?'용도(공동주택 여부) 입력 필요':db?.maxU?.some(r=>r.part===part&&r.condition!==undefined)&&!['floor_heating','no_floor_heating'].includes(condition)?'바닥난방 여부 입력 필요':null;/* 기준 행을 못 찾은 이유가 입력 부족이면 '입력 필요', 아니면 기준값 대조 전 */
  let comparison=result.status?result:!row&&missingInput?{status:'need_input',reason:missingInput}:!row||criterion.value===null?{status:'check_detail',reason:'기준값 대조 전'}:compareCriterion(current,criterion);
  const unknowns=[];if(region.value===null)unknowns.push('지역 구분 대조 전');if(db?.verified!==true)unknowns.push('기준값 대조 전');
  const signature=o=>JSON.stringify([o.thermalLayers,o.exposure,o.uValue,o.parameters?.uValue,o.energyUse,o.energyCondition]);if(entities.some(v=>signature(v)!==signature(e)))unknowns.push('같은 검토 객체의 재료층·성능 불일치');
  if(unknowns.length&&comparison.status==='satisfied')comparison={status:'check_detail',reason:unknowns.join(' · ')};
  const evidence=[row?.source,surface?.source,statuteRef,region.sourceRef,...(Array.isArray(e.thermalLayers)?e.thermalLayers:[]).map(l=>l?.lambdaSource)].filter(Boolean);
  items.push(makeReviewItem({id:'energy:'+key,field:'energy',name:({wall:'외벽',window:'창호',roof:'지붕',floor:'바닥'})[part]+' · '+key,objectIds:entities.map(v=>v.id),reviewObjectIds:e.reviewObjectId?[e.reviewObjectId]:[],current,criterion,status:comparison.status,reason:[comparison.reason,...unknowns,row?.source,statuteRef].filter(Boolean).join(' · '),unknowns,applicability:entities.length?APPLICABILITY.applicable:APPLICABILITY.unknown,progress:PROGRESS.done,evidence,statuteRef:statuteRef||null,ruleSetId:db?.schema??null,ruleVersionId:db?.noticeNo??null,effectiveDate:db?.effectiveDate??null,evaluatedAt:at,nextAction:'에너지 입력에서 지역·용도·외기 노출과 재료층 또는 창호 성능자료를 확인하세요.'}));
 }
 items.push(makeReviewItem({id:'energy:separate',field:'energy',name:'ZEB(제로에너지건축물)',status:'check_detail',progress:PROGRESS.done,reason:'ZEB 인증 대상 여부 별도 확인',nextAction:'ZEB 인증 대상인지 별도로 확인하세요.',evaluatedAt:at}));return items;
}
export async function loadEnergyStandards(){const response=await fetch('/energy-envelope-standards.json',{cache:'no-store'});if(!response.ok)throw Error('에너지 기준 DB를 열 수 없습니다. 계정 연결 상태를 확인하세요.');return response.json();}
// 입력 적용은 기존 엔진 명령으로 기록하여 되돌리기·검토 이력을 공유한다.
export function applyEnergyInputs(engine,values,target=null){
 const region=regions.includes(values.region)?reviewValue({value:values.region,sourceKind:'designer',confirmation:'confirmed'}):null,settings={address:String(values.address||'').trim(),region,use:['apartment','non_apartment'].includes(values.use)?values.use:null,condition:['floor_heating','no_floor_heating'].includes(values.condition)?values.condition:null};
 let changes=null;
 if(target){const exposure=['direct','indirect'].includes(values.exposure)?values.exposure:null;let thermalLayers=null;if(values.thermalLayers?.trim()){const raw=JSON.parse(values.thermalLayers);if(raw!==null&&!Array.isArray(raw))throw Error('재료층은 JSON 배열 또는 null로 입력하세요.');thermalLayers=normalizePreset({thermalLayers:raw}).thermalLayers;}
  const uValue=values.uValue==null||String(values.uValue).trim()===''?null:Number(values.uValue);if(uValue!==null&&!positive(uValue))throw Error('열관류율은 양수로 입력하세요.');
  changes={exposure,...(target.part==='window'?{uValue}:{thermalLayers})};
 }
 engine.execute({type:'energy.input',settings,ids:target?.ids||[],changes});
}
export function installEnergyInputs({host,engine,form,reviews,toast}){
 const button=document.createElement('button');button.textContent='에너지 입력';host.append(button);
 button.onclick=()=>{const doc=engine.doc,settings=doc.reviewSettings?.energy||{},groups=new Map();for(const e of doc.entities){const part=energyPart(e);if(!part)continue;const key=e.reviewObjectId||e.id;if(!groups.has(key))groups.set(key,{part,e,ids:[]});groups.get(key).ids.push(e.id);}
  const selected=reviews.items.find(i=>reviews.selected.has(i.id)&&i.field==='energy'),key=selected?.id.slice(7)||'';
  form('에너지 입력 · 지역·용도',[
   {name:'address',label:'주소 (시·도 시·군·구)',value:settings.address||siteAddress(doc).address||doc.siteContext?.landInfo?.address||doc.siteAnalysis?.address||''},
   {name:'region',label:'지역 (직접 선택은 설계자 확인값)',type:'select',value:settings.region?.value||'',options:[['','주소로 판정'],...regions.map(v=>[v,({central1:'중부1',central2:'중부2',south:'남부',jeju:'제주'})[v]])]},
   {name:'use',label:'용도',type:'select',value:settings.use||'',options:[['','—'],['apartment','공동주택'],['non_apartment','공동주택 외']]},
   {name:'condition',label:'바닥난방',type:'select',value:settings.condition||'',options:[['','—'],['floor_heating','바닥난방'],['no_floor_heating','바닥난방 아님']]},
   {name:'target',label:'외피 자료 입력 대상',type:'select',value:groups.has(key)?key:'',options:[['','지역·용도만 저장'],...[...groups].map(([id,g])=>[id,id+' · '+g.part])]}
  ],values=>{if(engine.doc!==doc)throw Error('도면이 바뀌었습니다. 에너지 입력을 다시 여세요.');const target=groups.get(values.target);if(!target){applyEnergyInputs(engine,values);return;}
   const {e,part}=target;form('에너지 입력 · '+values.target,[
    {name:'exposure',label:'외기 노출',type:'select',value:e.exposure||'',options:[['','—'],['direct','직접'],['indirect','간접']]},
    ...(part==='window'?[{name:'uValue',label:'성능자료 열관류율 (W/m²K)',value:(Object.hasOwn(e,'uValue')?e.uValue:e.parameters?.uValue)??''}]:[{name:'thermalLayers',label:'재료층 JSON [{name,thicknessMm,lambda,lambdaSource,category}]',value:JSON.stringify(e.thermalLayers??null)}])
   ],data=>{if(engine.doc!==doc)throw Error('도면이 바뀌었습니다. 에너지 입력을 다시 여세요.');applyEnergyInputs(engine,{...values,...data},target);toast('에너지 입력 저장 · 공통 검토에서 다시 검토하세요.');});
  });
 };
 return button;
}
