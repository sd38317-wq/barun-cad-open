// F1 명령 검색의 순위와 Enter 판정. 화면(app.js)과 분리해 그대로 시험한다.
// 순위: 명령창과 같은 해석(resolveCommand)으로 풀리는 입력(-1) > 이름·별칭 완전일치(0) > 라벨 완전일치(1)
//       > 이름·별칭 앞부분(2) > 라벨 앞부분·낱말 시작(3) > 검색어 포함(4)
//       > 낱말마다 뜻이 비슷한 말로 맞음(5) > 일부 낱말만 맞음·초성·오타(6). 같은 순위는 기본 명령(카탈로그 뒤쪽)부터.
const PUNCTUATION=/[()\[\]{}·,./·:;'"]+/g;
export function tokenizeLabel(label){
  return String(label||'').toLowerCase().replace(PUNCTUATION,' ').split(/\s+/).filter(Boolean);
}
// 사용자는 이름 대신 하고 싶은 일을 쓴다("객체만 켜기"). 같은 뜻의 말 묶음(낱말 앞부분으로 맞춤).
const SYNONYMS=[
  ['켜','보이','표시','나타내','보기','show','visible','display'],
  ['끄','숨기','숨김','감추','hide'],
  ['객체','개체','선택','오브젝트','object','entity'],
  ['만','격리','분리','단독','only','isolate','iso'],
  ['지우','지움','삭제','erase','delete'],
  ['복사','복제','copy','duplicate'],
  ['옮기','이동','move'],
  ['레이어','도면층','layer'],
  ['회전','돌리','rotate'],
  ['크기','축척','배율','scale'],
  ['글자','문자','텍스트','text'],
  ['치수','dim'],
  ['저장','save'],
  ['출력','인쇄','plot','print'],
  ['모두','전부','전체','all'],
  ['되돌리','취소','undo'],
  ['넣','그리','삽입','배치','insert','draw'],
];
const ENDINGS=['해줘','하기','하다','으로','해','기','을','를','은','는','이','가','의','에','로'];
const CHOSEONG='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const initials=text=>[...text].map(ch=>{const code=ch.charCodeAt(0)-0xac00;return code>=0&&code<11172?CHOSEONG[Math.floor(code/588)]:ch;}).join('');
// "객체만"→객체·만, "켜기"→켜, "숨기기"→숨기. 남는 말이 한 글자 이상일 때만 뗀다.
export function queryWords(query){
  const out=[];
  for(let word of query.split(/\s+/).filter(Boolean)){
    if(/[가-힣]만$/.test(word)){out.push('만');word=word.slice(0,-1);}
    for(const end of ENDINGS)if(word.length>end.length&&/[가-힣]$/.test(word)&&word.endsWith(end)){word=word.slice(0,-end.length);break;}
    out.push(word);
  }
  return out;
}
const groupsOf=word=>SYNONYMS.filter(group=>group.some(member=>member.startsWith(word)||word.startsWith(member)));
// 한 글자 차이(빠짐·더함·바뀜)까지. 영문 명령 이름 오타용.
function nearlyEqual(a,b){
  if(Math.abs(a.length-b.length)>1||a.length<4)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){
    if(a[i]===b[j]){i++;j++;continue;}
    if(++edits>1)return false;
    if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}
  }
  return edits+(a.length-i)+(b.length-j)<=1;
}
// 낱말 하나가 명령 글(text)에 맞는 정도: 2 그대로, 1 비슷한 말·초성·오타, 0 없음.
function wordHit(word,groups,text,name){
  if(text.includes(word))return 2;
  if(groups.some(group=>group.some(member=>text.includes(member))))return 1;
  if(/^[ㄱ-ㅎ]{2,}$/.test(word)&&initials(text).replace(/\s/g,'').includes(word))return 1;
  if(/^[a-z]{4,}$/.test(word)&&nearlyEqual(word,name))return 1;
  return 0;
}
export function rankCommandSearch(commands,rawQuery,{aliases={},resolve=null,terms=()=>'',limit=50}={}){
  const query=String(rawQuery||'').trim().toLowerCase();
  if(!query)return [];
  const words=query.split(/\s+/).filter(Boolean),compactQuery=query.replace(/\s/g,''),loose=queryWords(query),looseGroups=loose.map(groupsOf);
  let resolved=null;
  try{resolved=resolve?resolve(rawQuery):null;}catch{resolved=null;}
  const scored=[];
  commands.forEach((command,index)=>{
    const name=String(command.name||'').toLowerCase(),alias=String(aliases[command.name]||'').toLowerCase();
    const labelWords=tokenizeLabel(command.label),compactLabel=labelWords.join('');
    let score=null;
    if(name===query||(alias&&alias===query))score=0;
    // 명령창 해석으로 풀린 입력은 1위. 단, '취소' 같은 명령 끝내기(SELECT)는 실행할 것이 없으니 제외하고,
    // 한 글자 입력(R→REGEN 같은 호환 별칭)은 정확한 이름·별칭이 아니면 앞부분 일치(2)와 같이 취급해 Enter 로 바로 실행되지 않게 한다.
    else if(resolved&&resolved===command.name&&resolved!=='SELECT')score=compactQuery.length>1?-1:2;
    else if(compactLabel===compactQuery)score=1;
    else if(name.startsWith(query)||(alias&&alias.startsWith(query)))score=2;
    else if(compactLabel.startsWith(compactQuery)||labelWords.some(word=>word.startsWith(query)))score=3;
    else{
      const text=(String(command.label||'')+' '+String(terms(command)||'')).toLowerCase();
      if(words.every(word=>text.includes(word)))score=4;
      else{
        // 5: 모든 낱말이 맞음(그대로 맞은 낱말이 많을수록 위), 6: 일부만 맞음(맞은 수가 많을수록 위).
        const hits=loose.map((word,i)=>wordHit(word,looseGroups[i],text,name)),found=hits.filter(Boolean).length,exact=hits.filter(hit=>hit===2).length;
        if(found===loose.length)score=5+(1-exact/loose.length)*.5;
        else if(found&&loose.some((word,i)=>hits[i]&&word.length>1))score=6+(1-found/loose.length)*.5;
      }
    }
    if(score!==null)scored.push({command,score,index});
  });
  scored.sort((a,b)=>a.score-b.score||b.index-a.index);
  return scored.slice(0,limit).map(({command,score})=>({command,score}));
}
/* Enter: 사용자가 ↑↓ 로 고른 항목 > 분명한 1위(명령창 해석·완전일치 / 결과 하나 / 유일한 앞부분 일치). 애매하면 강조만(hint). */
export function searchEnterDecision(matches,activeIndex=-1){
  if(activeIndex>=0&&matches[activeIndex])return {action:'run',command:matches[activeIndex].command,reason:'chosen'};
  const [top,second]=matches;
  if(!top)return {action:'none'};
  const clear=matches.length===1||top.score<=1||(top.score===2&&(!second||second.score>2));
  return clear?{action:'run',command:top.command,reason:'clear'}:{action:'hint',command:top.command};
}
