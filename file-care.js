/** ACAD200 영역 8 — 파일·호환·복구·자동화의 순수 함수(화면·노드 시험 공용, DOM 없음).
    AutoCAD 의 같은 기능을 흉내 내지 않고, 우리 구조에 맞게 '바뀐 것만·설정 몰라도·잃지 않게'를 목표로 한다.
    806 구버전 저장 미리 확인 · 809 복구해서 열기 · 810 감사 자동·보고서 · 815 미리보기 그림 · 818 스크립트 ·
    820 PDF 레이어 · 821 오타 자동 고침 학습 · 822 경로 대응 · 824 묶어 보내기 목록 */

/* ── 806: 구버전 저장 전에 잃는 것 미리 보기 ── */
export const LATEST_SAVE_VERSION='2018';
/** 미리 볼 필요가 있는 저장인가: 최신판(2018)이 아니고, 큰 도면(엔진 직접 저장)이 아닐 때만 — 큰 도면은 변환을 두 번 돌리지 않는다. */
export function needsVersionPreview({format,version,large=false}){
  return (format==='dxf'||format==='dwg')&&String(version||LATEST_SAVE_VERSION)!==LATEST_SAVE_VERSION&&!large;
}
/** 엔진 미리 보기 결과 → 저장 창에 띄울 한 줄('' 이면 그냥 저장). */
export function versionLossMessage(preview,{format='dxf',version=LATEST_SAVE_VERSION}={}){
  if(!preview)return '';
  const label=`${String(format).toUpperCase()} ${version}`;
  if(preview.ok===false)return `${label} 로는 저장할 수 없습니다: ${preview.blocked||'구버전에 없는 객체가 있습니다'}`;
  const lost=(preview.lost||[]).filter(Boolean);
  if(!lost.length)return '';
  return `${label} 로 저장하면 다음이 단순화됩니다 — ${lost.join(' / ')} · 그래도 저장하려면 [저장]을 한 번 더 누르세요.`;
}

/* ── 809: 열기 실패 → 복구해서 열기(DWGRECOVER) ── */
const NOT_DAMAGE=/250 MB|1 GB|권한|permission|찾을 수 없|취소|허용되지 않은|DXF 또는 DWG 파일을 선택|엔진에 연결|ECONNREFUSED|Failed to fetch/i;
/** 이 실패가 '파일 손상'일 수 있어 복구 열기를 권할 만한가. 크기·권한·연결 문제는 복구로 안 풀리므로 권하지 않는다. */
export function recoveryCandidate(name,error){
  if(!/\.(dxf|dwg)$/i.test(String(name||'')))return false;
  return !NOT_DAMAGE.test(String(error?.message||error||''));
}
/** 복구 열기 결과 한 줄: 쓴 엔진·살린 수·감사로 고친 수·버린 종류. */
export function recoverySummary(report){
  const r=report?.recovery;if(!r)return '';
  const skipped=Object.entries(r.skipped||report?.skipped||{}).filter(([,n])=>n>0).map(([t,n])=>`${t} ${n}개`);
  return [`DWGRECOVER · ${r.engine||report?.converter||'복구 읽기'}`,`살림 ${Number(r.imported??report?.imported??0).toLocaleString()}개`,
    `감사 오류 ${r.auditErrors||0}건 · 고침 ${r.auditFixes||0}건`,...(skipped.length?['버림 '+skipped.join(', ')]:[]),'원본 파일은 바꾸지 않았습니다'].join(' · ');
}

/* ── 810: 열 때 자동 감사(작은 도면만, 한 번) ── */
export const AUTO_AUDIT_LIMIT=50000;
export const shouldAutoAudit=(weight,limit=AUTO_AUDIT_LIMIT)=>Number.isFinite(weight)&&weight>0&&weight<=limit;
export function autoAuditNote(plan){
  if(!plan?.problems)return '';
  return `도면 검사: 고칠 문제 ${plan.problems}건 · AUDIT 로 고치기 · AUDITREPORT 로 보고서 저장`;
}

/* ── 815: 저장 파일 안 미리보기 그림(BMP, 1비트) ──
   AutoCAD 는 저장 때 화면을 다시 그려 그림을 만든다. 여기서는 객체를 고르게 budget 개까지만 훑어 크기와 무관하게
   일정한 시간에 끝낸다(20만 객체 도면도 2만 5천 개만 본다, 약 50 ms). 결과는 파일 머리 없는 DIB(DXF THUMBNAILIMAGE 형식). */
const pt=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null;
function entityStrokes(e,out,depth=0){
  if(!e||typeof e!=='object'||e.hidden)return;
  if(Array.isArray(e.points)&&e.points.length){const list=e.points.map(pt).filter(Boolean);if(list.length===1)out.push([list[0],list[0]]);for(let i=1;i<list.length;i++)out.push([list[i-1],list[i]]);if(e.closed&&list.length>2)out.push([list.at(-1),list[0]]);return;}
  const c=pt(e.center);
  if(c&&Number.isFinite(e.radius)&&e.radius>0){const n=16,ring=[];for(let i=0;i<=n;i++){const a=i/n*2*Math.PI;ring.push({x:c.x+e.radius*Math.cos(a),y:c.y+e.radius*Math.sin(a)});}for(let i=1;i<ring.length;i++)out.push([ring[i-1],ring[i]]);return;}
  const p=pt(e.position)||pt(e.start);
  if(p&&e.type==='text'&&Number.isFinite(e.height)){const w=String(e.text||'').length*e.height*0.8;out.push([p,{x:p.x+w,y:p.y}]);return;}
  if(Array.isArray(e.entities)&&depth<2){let budget=64;for(const child of e.entities){if(budget--<=0)break;entityStrokes(child,out,depth+1);}return;}
  if(p)out.push([p,p]);
}
export function drawingThumbnail(doc,{width=256,height=192,budget=25000}={}){
  const list=Array.isArray(doc?.entities)?doc.entities:[],step=Math.max(1,Math.ceil(list.length/budget)),strokes=[];
  for(let i=0;i<list.length;i+=step)entityStrokes(list[i],strokes);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const [a,b] of strokes){x0=Math.min(x0,a.x,b.x);y0=Math.min(y0,a.y,b.y);x1=Math.max(x1,a.x,b.x);y1=Math.max(y1,a.y,b.y);}
  const rowBytes=Math.ceil(width/8+3)&~3,pixels=new Uint8Array(rowBytes*height);
  const set=(x,y)=>{if(x<0||y<0||x>=width||y>=height)return;pixels[y*rowBytes+(x>>3)]|=0x80>>(x&7);};
  if(strokes.length&&Number.isFinite(x0)){
    const margin=4,k=Math.min((width-2*margin)/Math.max(x1-x0,1e-9),(height-2*margin)/Math.max(y1-y0,1e-9));
    const ox=(width-(x1-x0)*k)/2,oy=(height-(y1-y0)*k)/2;
    for(const [a,b] of strokes){
      let ax=Math.round(ox+(a.x-x0)*k),ay=Math.round(oy+(a.y-y0)*k);const bx=Math.round(ox+(b.x-x0)*k),by=Math.round(oy+(b.y-y0)*k);
      const dx=Math.abs(bx-ax),dy=-Math.abs(by-ay),sx=ax<bx?1:-1,sy=ay<by?1:-1;let err=dx+dy,guard=width+height+2;
      for(;;){set(ax,ay);if((ax===bx&&ay===by)||guard--<=0)break;const e2=2*err;if(e2>=dy){err+=dy;ax+=sx;}if(e2<=dx){err+=dx;ay+=sy;}}
    }
  }
  // BITMAPINFOHEADER(40) + 팔레트 2색(흰 바탕 0, 검은 선 1) + 아래에서 위로 쌓은 줄(y 가 위로 커지는 도면 좌표와 같은 방향)
  const out=new Uint8Array(40+8+pixels.length),view=new DataView(out.buffer);
  view.setUint32(0,40,true);view.setInt32(4,width,true);view.setInt32(8,height,true);view.setUint16(12,1,true);view.setUint16(14,1,true);
  view.setUint32(16,0,true);view.setUint32(20,pixels.length,true);view.setInt32(24,2835,true);view.setInt32(28,2835,true);view.setUint32(32,2,true);view.setUint32(36,2,true);
  out.set([255,255,255,0,0,0,0,0],40);out.set(pixels,48);
  return out;
}
export function bytesToBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}

/* ── 818: 스크립트(.scr) — AutoCAD 규칙 그대로: 공백·줄바꿈 하나가 Enter 하나, ';' 줄은 주석 ── */
export function parseScript(text){
  const inputs=[];
  for(const raw of String(text??'').replace(/^\uFEFF/,'').split(/\r?\n/)){
    if(raw.trimStart().startsWith(';'))continue;
    for(const token of raw.replace(/\t/g,' ').split(' '))inputs.push(token);
  }
  while(inputs.length&&inputs.at(-1)==='')inputs.pop();   // 파일 끝 빈 줄은 마지막 명령을 되풀이하지 않게 버린다
  return inputs;
}
/** 입력을 하나씩 넣고 화면이 한가해질 때까지 기다린다. 한 입력이 timeoutMs 안에 안 끝나면 멈추고 몇 번째에서 멈췄는지 알린다. */
export async function runScript(inputs,{submit,waitIdle,signal,timeoutMs=30000,onStep=()=>{}}){
  let done=0;
  for(const input of inputs){
    if(signal?.aborted)throw Object.assign(Error(`스크립트를 중지했습니다 (${done}/${inputs.length}).`),{stopped:true,done});
    submit(input);onStep(++done,inputs.length,input);
    const idle=await Promise.race([Promise.resolve(waitIdle()).then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),timeoutMs))]);
    if(!idle)throw Object.assign(Error(`스크립트 ${done}번째 입력 "${input}" 이(가) ${Math.round(timeoutMs/1000)}초 안에 끝나지 않아 멈췄습니다.`),{done});
  }
  return {done,total:inputs.length};
}

/* ── 820: PDF 레이어(OCG) → 바른 CAD 레이어 이름 ── */
export function pdfLayerName(name){
  const clean=String(name||'').replace(/[<>/\\":;?*|=`,]/g,'_').trim().slice(0,60);
  return clean?'PDF-'+clean:'PDF-IMPORT';
}
export function pdfLayerGroups(entities){
  const groups=new Map();
  for(const e of entities||[]){const name=pdfLayerName(e?.pdfLayer);groups.set(name,(groups.get(name)||0)+1);}
  return groups;
}

/* ── 821: 사용자가 실제로 친 오타를 배워 다음부터 바로 고친다(같은 짝 3번이면) ── */
const typoKey=text=>String(text??'').trim().toUpperCase();
const TYPO_PATTERN=/^[^\s()"';]{1,24}$/;
export function learnAutoCorrect(settings,typo,command,{threshold=3}={}){
  const key=typoKey(typo);
  if(!TYPO_PATTERN.test(key)||!command||key===command)return settings;
  const counts={...(settings?.autoCorrectCounts||{})},pair=key+'>'+command;
  counts[pair]=(counts[pair]||0)+1;
  const learned={...(settings?.autoCorrect||{})};
  if(counts[pair]>=threshold)learned[key]=command;
  return {...settings,autoCorrectCounts:counts,autoCorrect:learned};
}
export const autoCorrected=(settings,typed)=>settings?.autoCorrect?.[typoKey(typed)]||null;
/** 모르는 입력 뒤 짧은 시간 안에, 그때 추천한 명령 가운데 하나를 실행하면 그것을 그 오타의 정답으로 본다. */
export function createTypoLearner({windowMs=15000,now=()=>Date.now()}={}){
  let last=null;
  return {
    unknown(text,candidates=[]){last={text,at:now(),candidates:new Set(candidates)};},
    ran(command,settings){
      const pending=last;last=null;
      if(!pending||now()-pending.at>windowMs||!pending.candidates.has(command))return settings;
      return learnAutoCorrect(settings,pending.text,command);
    },
    clear(){last=null;},
  };
}

/* ── 822: 서버 경로 ↔ 이 PC 경로 대응(윈도우 \\NAS·N: ↔ 맥 /Volumes) ── */
const normPath=s=>String(s||'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
/** 가장 긴 앞부분이 맞는 항목으로 앞부분만 바꾼다. 맞는 항목이 없으면 null. 구분자는 바꿀 쪽 형식을 따른다. */
export function mapServerPath(target,table){
  const text=String(target||''),norm=normPath(text);let best=null;
  for(const [server,local] of Object.entries(table||{})){
    const key=normPath(server);if(!key)continue;
    if((norm===key||norm.startsWith(key+'/'))&&(!best||key.length>best[0].length))best=[key,local];
  }
  if(!best)return null;
  const rest=text.replace(/\\/g,'/').slice(best[0].length).replace(/^\/+/,''),local=String(best[1]).replace(/[\\/]+$/,'');
  const sep=/^[A-Za-z]:|^\\\\/.test(local)?'\\':'/';
  return rest?local+sep+rest.split('/').join(sep):local;
}
/** 사용자가 '새 경로로 복구'로 고친 한 건에서 앞부분 대응을 배운다(뒤쪽 같은 폴더 이름은 빼고 다른 앞부분만). */
export function learnPathMapping(oldFolder,newFolder){
  const a=String(oldFolder||'').replace(/\\/g,'/').replace(/\/+$/,'').split('/'),b=String(newFolder||'').replace(/\\/g,'/').replace(/\/+$/,'').split('/');
  let same=0;while(same<a.length-1&&same<b.length-1&&a[a.length-1-same].toLowerCase()===b[b.length-1-same].toLowerCase())same++;
  const from=a.slice(0,a.length-same).join('/'),to=b.slice(0,b.length-same).join('/');
  if(!from||!to||from.toLowerCase()===to.toLowerCase())return null;
  const back=s=>/^\/\//.test(s)||/^[A-Za-z]:/.test(s)?s.replace(/\//g,'\\'):s;
  return [back(from),back(to)];
}
export const XREF_PATH_MAP_KEY='barun-xref-path-map';
export function readPathMap(storage=globalThis.localStorage){
  try{const value=JSON.parse(storage?.getItem(XREF_PATH_MAP_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}
}
export function writePathMap(table,storage=globalThis.localStorage){try{storage?.setItem(XREF_PATH_MAP_KEY,JSON.stringify(table||{}));return true;}catch{return false;}}
/** 깨진 윈도우식 외부 참조 폴더(대소문자 무시 중복 제거). exists(folder) 로 이 PC 에 있는지 본다. */
export function missingWindowsFolders(entities,exists=()=>false){
  const seen=new Map();
  for(const e of entities||[]){
    const folder=e?.xref?.folder;if(!folder||e.xref.relative||!/^([A-Za-z]:[\\/]|\\\\)/.test(folder)||exists(folder))continue;
    seen.set(folder.toLowerCase(),folder);
  }
  return [...seen.values()];
}

/* ── 824: 묶어 보내기(PACK) 목록 — 참조·그림·글꼴·리습과 빠진 것 ── */
export function packManifest(doc,{fonts=[],lispFiles=[],drawingName='도면'}={}){
  const files=new Map(),missing=[];
  const visit=(list,depth=0)=>{for(const e of list||[]){
    if(e?.xref?.name)files.set(`xref/${e.xref.name}`,{kind:'xref',folder:e.xref.folder||'',relative:!!e.xref.relative});
    if(e?.type==='image'&&(e.source||e.path)){const from=String(e.source||e.path);files.set(`images/${from.split(/[\\/]/).pop()}`,{kind:'image',path:from});}
    if(Array.isArray(e?.entities)&&depth<8)visit(e.entities,depth+1);
  }};
  visit(doc?.entities);
  for(const b of Array.isArray(doc?.blocks)?doc.blocks:[])visit(b?.entities,1);
  for(const f of fonts){if(f?.fallback)missing.push(`글꼴 ${f.font} (이 PC 에 없어 대체 글꼴로 보임)`);else if(f?.font)files.set(`fonts/${f.font}`,{kind:'font',name:f.font});}
  for(const l of lispFiles)if(l?.name)files.set(`lisp/${l.name}`,{kind:'lisp',id:l.id||''});
  return {drawing:drawingName,files:[...files].map(([to,from])=>({to,...from})),missing};
}
export function packManifestText(manifest,{when=new Date()}={}){
  const lines=[`바른 CAD 묶어 보내기 목록 · ${manifest.drawing} · ${when.toLocaleString('ko-KR')}`,''];
  const kinds={xref:'외부 참조',image:'그림',font:'글꼴',lisp:'리습'};
  for(const kind of Object.keys(kinds)){const items=manifest.files.filter(f=>f.kind===kind);if(!items.length)continue;lines.push(`[${kinds[kind]} ${items.length}개]`);for(const f of items)lines.push(`  ${f.to}${f.folder?`  ← ${f.folder}${f.relative?' (프로젝트 기준)':''}`:f.path?`  ← ${f.path}`:''}`);lines.push('');}
  lines.push(manifest.missing.length?`[빠진 것 ${manifest.missing.length}개]`:'[빠진 것 없음]');
  for(const m of manifest.missing)lines.push('  '+m);
  return lines.join('\r\n');
}
