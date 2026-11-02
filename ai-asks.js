// AI 가 물어보며 진행하기 — 사용자는 "풍동검토 해줘"처럼 짧게만 말한다(2026-10-16 사용자 지시).
// 도구에 빠진 값이 있을 때 오류를 내지 않고 다음 셋으로 나눠 돌려준다.
//  · autoFilled: 도면에서 채운 값(주소·건물 높이·축척 등). AI 는 "도면에서 ○○로 읽었어요"라고 한 줄로 알린다.
//  · assumed:    무난한 기본값으로 계산한 것. 결과와 함께 쉬운 말로 알리고, 사용자가 바꾸고 싶을 때만 다시 부른다.
//  · needs:      도면으로 알 수 없고 결과가 크게 달라지는 것. AI 가 한 번에 하나씩, 전문 용어 없이 번호 보기로 묻는다.
// 질문·보기 글자는 사용자가 바로 읽는 말이다. 기준 기호(지표면조도 C, 중요도 1 등)는 value 에만 둔다.
import {basicWindSpeed} from './wind-load.js';
import {storedOverview} from './building-overview.js';

export const ASK_RULE='needs 가 있으면 계산하지 않았습니다. 먼저 도면·열린 도면/PDF 글자·실 이름·주소 조회로 needs[0] 의 답을 스스로 찾아 같은 도구를 다시 부르세요. 찾을 수도 짐작할 수도 없을 때만 needs[0] 하나만 question 그대로 쉬운 말로 묻고 choices 를 번호로 보여 주세요(suggested 는 "추천"). 답을 받으면 그 value 를 인자로 넣어 같은 도구를 다시 부르세요. 기준 기호나 매개변수 이름을 사용자에게 묻지 마세요.';

const ask=(key,question,choices=[],extra={})=>({key,question,choices:choices.map((c,i)=>({n:i+1,...c})),...extra});

/** 도면에 기록된 대지 주소: 계획 탭 입력 → 배치 결과 → 주소로 불러온 지적(대지) → 건축 개요 순. */
export function siteAddress(doc){
 const direct=doc?.sitePlanInput?.site?.address||doc?.sitePlan?.site?.address;if(direct)return {address:direct,zones:[]};
 for(const e of doc?.entities||[]){
  if(e.parcelRole!=='site')continue;const a=e.attributes||{},info=a.landInfo||{};
  const address=info.address||a.jibun||'';if(address)return {address,zones:info.zoneNames||[]};
 }
 const ov=storedOverview(doc).values;   // 마지막으로 건축 개요(개요표에서 읽었거나 설계자가 넣은 대지위치)
 return {address:String(ov.address||'').trim(),zones:ov.zone?String(ov.zone).split(/[,·]/).map(z=>z.trim()).filter(Boolean):[]};
}

// 지표면조도구분(KDS 41 12 00 표 5.5-1)을 주변 모습으로 묻는다. value 가 기준 기호.
export const TERRAIN_CHOICES=Object.freeze([
 {label:'큰 도시 한복판 — 10층 넘는 건물이 빽빽해요',value:'A'},
 {label:'주택가·시내 — 집·빌라·나무가 빽빽하고 중간 높이 건물이 섞여 있어요',value:'B'},
 {label:'교외·논밭·공장 지대 — 낮은 건물이나 나무가 드문드문 있어요',value:'C'},
 {label:'바닷가·넓은 들판 — 바람을 막는 것이 거의 없어요',value:'D'},
]);
// 중요도(표 5.5-5). 정확한 분류는 KDS 41 10 05 중요도 표 — 보기는 쉬운 말, 기본은 안전한 쪽 1.
export const IMPORTANCE_CHOICES=Object.freeze([
 {label:'보통 건물(주택·사무실·상가 등) — 안전한 쪽으로 계산',value:'1'},
 {label:'재난 때 꼭 버텨야 하는 건물(병원·소방서·대피시설 등)',value:'특'},
 {label:'사람이 거의 없는 건물(창고·축사·가설 건물 등)',value:'3'},
]);

/** 용도지역 이름으로 주변 모습을 짐작한다(추천만, 확정은 사용자). */
export function terrainHint(zones=[]){
 const zone=re=>zones.find(z=>re.test(z));   // 보호구역·도로 같은 다른 이름이 앞에 올 수 있다
 let z;
 if((z=zone(/중심상업/)))return {value:'A',why:`용도지역이 ${z}이라 큰 도시 한복판일 수 있어요`};
 if((z=zone(/상업|주거|준공업/)))return {value:'B',why:`용도지역이 ${z}이라 주택가·시내로 짐작했어요`};
 if((z=zone(/공업|녹지|관리|농림|자연환경/)))return {value:'C',why:`용도지역이 ${z}이라 건물이 드문드문한 곳으로 짐작했어요`};
 return null;
}

/** cad_wind_check 에 빠진 것. 지역은 도면 주소로 채우고, 주변 모습은 물어보고, 중요도는 안전한 쪽으로 둔다. */
export function windAsks(doc,{region,basicWindSpeed:V0,terrain,importance}={}){
 const autoFilled={},assumed=[],needs=[];
 let found=null;
 if(V0>0)found={speed:V0,region:'직접 입력',province:null};
 else{
  const site=siteAddress(doc),text=region||site.address;
  if(!region&&site.address)autoFilled.region={value:site.address,from:'도면에 불러온 대지 주소'};
  if(!text)needs.push(ask('region','건물이 어느 지역에 있나요? 시·군 이름이나 주소만 말해 주세요. (예: 부산 해운대구, 강릉)'));
  else{
   found=basicWindSpeed(text);
   if(found.error){
    needs.push(ask('region',found.candidates?`'${text}'과 이름이 같은 곳이 여러 곳이에요. 어디인가요?`:`'${text}'을 기본풍속 표에서 찾지 못했어요. 가까운 시·군 이름을 알려 주세요.`,
     (found.candidates||[]).map(c=>({label:`${c.province} ${c.region}`,value:`${c.province} ${c.region}`}))));
    found=null;
   }
  }
 }
 if(!terrain){
  const hint=terrainHint(siteAddress(doc).zones);
  needs.push(ask('terrain','건물 주변이 어떤 모습인가요? (바람이 얼마나 막히는지에 따라 달라져요)',TERRAIN_CHOICES,hint?{suggested:hint.value,why:hint.why}:{suggested:'C',why:'용도지역을 몰라 바람을 덜 막는 교외 쪽(안전한 쪽)으로 계산했어요'}));
 }
 if(!importance)assumed.push({key:'importance',value:'1',say:'건물은 보통 건물로 보고 안전한 쪽으로 계산했어요. 병원·대피시설이나 창고·가설 건물이면 말해 주세요.',choices:IMPORTANCE_CHOICES});
 return {autoFilled,assumed,needs,found};
}

/** 방 이름 글자(거실·침실…)를 둘러볼 자리 후보로. 층 이름이 레이어에 있으면 함께. 가볍게(글자만 훑음). */
const ROOM_WORDS=/^(거실|침실\d*|안방|방\d*|주방|식당|부엌|현관|욕실\d*|화장실\d*|드레스룸|다용도실|발코니|테라스|로비|홀|라운지|사무실\d*|회의실\d*|교실\d*|복도|카페|매장|전시실|강당|서재|작업실|대기실)$/;
export function roomSpots(doc,limit=12){
 const layers=new Map((doc?.layers||[]).map(l=>[l.id,l])),spots=[],seen=new Set();
 for(const e of doc?.entities||[]){
  if(e.type!=='text'||!e.position)continue;const name=String(e.text||'').replace(/\s+/g,'');if(!ROOM_WORDS.test(name))continue;
  const layer=layers.get(e.layer);if(layer&&(!layer.visible||layer.frozen))continue;
  const floor=/(^|[^0-9])([1-9]\d*)F/i.exec(layer?.name||'')?.[2];
  const key=name+(floor||'');if(seen.has(key))continue;seen.add(key);
  spots.push({label:floor?`${floor}층 ${name}`:name,value:{x:Math.round(e.position.x),y:Math.round(e.position.y),...(floor?{floor:floor+'F'}:{})}});
  if(spots.length>=limit)break;
 }
 return spots;
}

/** cad_view_interior 에 자리(x,y)가 없을 때: 방 이름 후보, 없으면 건물 가운데.
 *  inside(p) = 3D 모델 범위 안인지, floors = 모델에 있는 층. 다른 도면 묶음·자리를 옮긴 설계안의 글자는 모델 밖이라 뺀다. */
export function interiorAsks(doc,{x,y,floor}={},{center=null,inside=()=>true,floors=null}={}){
 if(Number.isFinite(x)&&Number.isFinite(y))return {autoFilled:{},assumed:[],needs:[]};
 const spots=roomSpots(doc,40).filter(s=>inside(s.value)&&(!s.value.floor||!floors?.length||floors.includes(s.value.floor))&&(!floor||!s.value.floor||s.value.floor===floor)).slice(0,12)
  .map(s=>floor&&!s.value.floor?{...s,value:{...s.value,floor}}:s);
 if(center)spots.push({label:'건물 한가운데',value:{x:Math.round(center.x),y:Math.round(center.y),...(floor?{floor}:{})}});
 return {autoFilled:{},assumed:[],needs:[ask('spot',spots.length?'어디에 서서 둘러볼까요?':'어디에 서서 둘러볼까요? 방 이름이나 도면 위치를 말해 주세요.',spots)]};
}

/** 도면 축척: 지금 주석 축척 → 첫 시트 축척 → 1:100(가정). */
export function drawingDenominator(doc){
 const n=Number(doc?.currentAnnoScale);if(Number.isInteger(n)&&n>1&&n<=5000)return {value:n,from:'도면 주석 축척'};
 const s=Number(doc?.sheets?.[0]?.denominator);if(Number.isInteger(s)&&s>=1&&s<=5000)return {value:s,from:'시트 축척'};
 return null;
}
