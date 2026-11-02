import * as G from './geometry.js';
import {num,positive,tableBlock} from './studio.js';
import {structuralDetail,steelFrame} from './structure.js';
import {mapServerPath,learnPathMapping,readPathMap,writePathMap} from './file-care.js';
import {xrefFileStem,xrefKey,xrefPath,dependentLayers,relayer,nestedXrefFilter,chooseXrefStorage,documentMark,documentChanged,staleXrefs,watchXrefs} from './xref-tools.js';
import {unitlessImportScale,UNITLESS_CHOICES,unitConversion,UNIT_NAMES} from './units.js';
import {prefGet} from './side-docs.js';
const p=(x,y)=>({x,y});
export function closestBuildings(a,b){
 const segA=G.segments(a),segB=G.segments(b);if(!segA.length||!segB.length)throw Error('건물 경계 선/폐합선을 선택하세요.');
 let best={distance:Infinity};
 const projection=(q,a,b)=>{const v=G.sub(b,a),t=Math.max(0,Math.min(1,G.dot(G.sub(q,a),v)/G.dot(v,v)));return G.add(a,G.mul(v,t));};
 for(const [a0,a1]of segA)for(const [b0,b1]of segB){
  const hit=G.lineIntersection(a0,a1,b0,b1);if(hit&&hit.t>=0&&hit.t<=1&&hit.u>=0&&hit.u<=1)return {distance:0,a:hit.point,b:hit.point};
  for(const [q,r,s,flip]of [[a0,b0,b1,false],[a1,b0,b1,false],[b0,a0,a1,true],[b1,a0,a1,true]]){const foot=projection(q,r,s),d=G.dist(q,foot);if(d<best.distance)best={distance:d,a:flip?foot:q,b:flip?q:foot};}
 }
 if(a.points&&b.points&&(G.inside(a.points[0],b.points)||G.inside(b.points[0],a.points)))best.distance=0;
 return best;
}
export function installFileWorkflows(studio){
 const {engine,form,execute,field:f,pointFields,chosen,add,change,getSettings,toast,activeLayer,api,output,pickFiles,b64}=studio.context;
 const choice=(name,label,value,options)=>f(name,label,value,'text',options.map(x=>Array.isArray(x)?x:[x,x]));
 const number=(name,label,value)=>f(name,label,value,'number');
 // 618: 원본 파일 지문(크기·수정 시각). 옛 엔진이 stat 을 모르면 빈 값(감시 안 함).
 const xrefStat=async xref=>{const baseFolder=xref.relative?studio.getFolder():undefined;try{return await api('project',{action:'stat',folder:xref.folder,name:xref.name,...(xref.relative?{baseFolder}:{})});}catch(error){if(/지원하지 않는/.test(error?.message||''))return {};throw error;}};
 if(typeof window!=='undefined'&&typeof document!=='undefined'&&!studio.xrefWatch)studio.xrefWatch=watchXrefs(()=>engine.doc.entities.filter(e=>e.xref?.fingerprint),xrefStat,item=>toast(`외부참조 ${item.ref.xref.name||item.ref.name} 원본이 ${item.missing?'없어졌습니다':'바뀌었습니다'} — XREF 에서 갱신하세요.`,true));
 Object.assign(studio.handlers,{
  VERSION(){form('하위 DXF 버전 저장',[choice('version','DXF 버전','R2010',['R2000','R2004','R2007','R2010','R2013','R2018']),f('name','파일 이름','도면')],async v=>{const r=await api('export',{document:engine.doc,version:v.version});await output(r.data,v.name+'_'+v.version+'.dxf','application/dxf');toast('DXF '+v.version+' 저장 완료');});},
  XREF(){const refs=engine.doc.entities.filter(e=>e.xref);form('외부참조 관리 · 결합하면 일반 블록으로 유지',[choice('action','작업',refs.length?'refresh':'attach',[['attach','새 외부참조 연결'],['refresh','선택 참조 갱신'],['check','원본 파일 바뀜 확인'],['repath','새 경로로 복구·갱신'],['toggle','참조 표시 전환'],['bind','결합 · 외부 연결 해제, 도형 유지'],['detach','분리 · 도면에서 참조 제거']]),choice('id','관리할 참조',refs[0]?.id||'',[['','새 참조'],...refs.map(e=>[e.id,e.name+' — '+(e.xref.relative?'[프로젝트 기준] ':'')+e.xref.folder+(e.hidden?' · 숨김':'')])]),choice('relative','새 연결·복구 경로 기준','absolute',[['absolute','절대 경로'],['relative','현재 프로젝트 폴더 기준 상대 경로']]),f('folder','새 연결·복구 폴더 (상대 경로 예: ../참조)',studio.getFolder()),f('name','새 연결·복구 파일 이름','참조.dxf'),...pointFields(),number('scale','새 연결 삽입 축척',1),choice('mode','새 연결 방식','attach',[['attach','연결(Attach) · 이 도면을 참조하는 도면도 함께 봄'],['overlay','겹치기(Overlay) · 이 도면에서만 봄']]),choice('layers','새 연결 레이어','keep',[['keep','원본 레이어 유지(파일명|레이어)'],['one','한 레이어로 합치기']]),choice('storage','새 연결 저장 방식','auto',[['auto','자동(큰 참조는 공유 정의)'],['embedded','도면 안 사본'],['shared','공유 정의 · 되돌리기 기록에 안 실림']]),choice('unitless','단위 없는 원본은','default',[['default','기본 원본 단위(설정, 기본 mm)로 보고 알림'],['refuse','멈추고 알림(예전)'],['mm','mm 로 보고 1배'],['cm','cm 로 보고 10배'],['m','m 로 보고 1000배']])],async v=>{
   let old=engine.doc.entities.find(e=>e.id===v.id);
   if(v.action!=='attach'&&!old?.xref)throw Error('관리할 외부참조를 고르세요.');
   if(v.action==='detach'){execute({type:'delete',ids:[old.id]});toast('도면에서 참조를 분리했습니다. 원본 파일은 유지됩니다. Ctrl+Z로 복원');return;}
   if(v.action==='bind'){execute({type:'update',ids:[old.id],changes:{xref:null}});toast('일반 블록으로 결합했습니다. 도형·클립은 유지됩니다. Ctrl+Z로 복원');return;}
   if(v.action==='toggle'){if(!old)throw Error('참조를 고르세요.');execute({type:'visibility',ids:[old.id],hidden:!old.hidden});return;}
   if(v.action==='check'){const stale=await staleXrefs(engine.doc.entities.filter(e=>e.xref),xrefStat);toast(stale.length?stale.map(s=>(s.ref.xref.name||s.ref.name)+(s.missing?' · 원본 없음':' · 바뀜 — 갱신하세요')).join(', '):'바뀐 외부참조가 없습니다.',!!stale.length);return;}
   const ref=v.action==='refresh'?{...old.xref}:{...(v.action==='repath'?old.xref:{x:num(v.x),y:num(v.y),scale:positive(v.scale,'축척'),mode:v.mode==='overlay'?'overlay':'attach',layers:v.layers==='one'?'one':'keep'}),folder:v.folder,name:v.name,relative:v.relative==='relative'};
   // 618: 읽는 동안 바뀌었는지는 문서 객체·되돌리기 깊이로 본다(예전: 도면 전체 JSON 문자열 두 번 — 큰 도면 수 초·힙 두 배).
   const mark=documentMark(engine),baseFolder=ref.relative?studio.getFolder():undefined;
   if(ref.relative&&!baseFolder)throw Error('먼저 PROJECT에서 기준 프로젝트 폴더를 여세요.');
   let source;try{source=await api('project',{action:'read',folder:ref.folder,name:ref.name,...(ref.relative?{baseFolder}:{})});}catch(error){
    // ACAD200-822: 다른 PC·맥에서 만든 경로면 경로 대응 표(XREFPATHMAP)로 이 PC 경로를 찾아 한 번 더 읽는다.
    const mapped=!ref.relative&&mapServerPath(ref.folder,readPathMap());
    if(mapped){try{source=await api('project',{action:'read',folder:mapped,name:ref.name});toast('외부참조 경로를 대응 표로 바꿨습니다: '+ref.folder+' → '+mapped);ref.folder=mapped;}catch{}}
    if(!source)throw Error('참조 파일을 읽지 못했습니다. 작업을 “새 경로로 복구·갱신”으로 바꾸고 폴더·파일 이름을 입력하세요. 기존 도형은 유지됩니다. '+error.message);
   }
   // 822: 손으로 '새 경로로 복구'한 것은 앞부분 대응을 배워 다음 참조부터 자동으로 쓴다.
   if(v.action==='repath'&&!ref.relative&&old?.xref?.folder&&!old.xref.relative){const pair=learnPathMapping(old.xref.folder,ref.folder);if(pair){const table=readPathMap();if(table[pair[0]]!==pair[1]){table[pair[0]]=pair[1];writePathMap(table);}}}
   if(source.fingerprint)ref.fingerprint=source.fingerprint;
   const imported=await api('import',{data:source.data,extension:source.extension});
   // 단위 없는 원본: ACAD200 714 — 고른 단위(mm·cm·m)를 기억해 갱신 때도 쓴다. '멈추고 알림'이면 멈춘다.
   // 623 — 고르지 않았으면(기본) 기본 원본 단위(설정, 기본 mm)로 환산하고 알린다(예전: 거부).
   let unitFactor=1,unitNote='';
   if(imported.report.unitless){
    if(UNITLESS_CHOICES[v.unitless])ref.unitless=v.unitless;
    if(ref.unitless||v.unitless==='refuse'){unitFactor=unitlessImportScale(imported.report,ref.unitless);if(unitFactor!==1)unitNote=` · 단위 없는 원본을 ${ref.unitless} 로 보고 ${unitFactor}배로 맞췄습니다`;}
    else{const fallback=prefGet('defaultSourceUnits',4);unitFactor=unitConversion(fallback,4);toast(`원본 단위가 없어 ${UNIT_NAMES[fallback]||'mm'} 로 보고 연결했습니다. 다르면 원본에 단위를 지정하세요.`);}
   }else if(Number(imported.report.unitScaleToMM)>0&&imported.report.unitScaleToMM!==1)unitNote=` · 원본 단위를 mm 로 ${imported.report.unitScaleToMM}배 맞췄습니다`;
   // 617: 겹치기(overlay)로 붙은 중첩 참조는 따라가지 않고, 순환은 뺀다.
   const nested=nestedXrefFilter(imported.document.entities,{path:xrefPath(ref)});
   if(nested.cycles.length)toast('외부참조 순환을 막았습니다: '+nested.cycles.join(', '),true);
   const layerMode=ref.layers||'one',fallbackLayer=old?.layer||activeLayer();
   const dependent=layerMode==='keep'?dependentLayers(imported.document.layers,xrefFileStem(ref.name),engine.doc.layers):{map:new Map(),add:[]};
   const sourceEntities=nested.entities.map(e=>unitFactor!==1?G.resize(e,p(0,0),unitFactor):e).map(e=>relayer(e,dependent.map,fallbackLayer));
   const storage=v.action==='attach'?chooseXrefStorage(v.storage,sourceEntities):old?.sharedBlock?'shared':'embedded';
   if(documentChanged(engine,mark))throw Error('참조를 읽는 동안 도면이 변경되었습니다. 다시 실행하세요.');
   const layerCommands=dependent.add.map(layer=>({type:'layer.add',...layer}));
   if(storage==='shared'){
    // 224: 도형은 공유 정의(되돌리기 기록끼리 같이 쓰는 불변 묶음)에 한 번만. 참조는 위치·회전·축척만 갖는다. 갱신 = 정의 교체 한 번.
    const key=old?.sharedBlock||xrefKey(ref),definitions={[key]:{name:ref.name,origin:{x:0,y:0},entities:sourceEntities,xref:true}};
    if(v.action==='attach'){
     const entity={type:'block',name:ref.name,layer:fallbackLayer,hidden:false,xref:{...ref,storage:'shared'},sharedBlock:key,position:p(ref.x,ref.y),scale:ref.scale,rotation:0,entities:[]};
     execute({type:'batch',commands:[...layerCommands,{type:'shared.add',definitions,replace:!!engine.doc.sharedBlocks?.[key],entities:[entity]}]});
    }else execute({type:'batch',commands:[...layerCommands,{type:'shared.add',definitions,replace:true},{type:'update',ids:[old.id],changes:{xref:{...ref,storage:'shared'}}}]});
   }else{
    const transform=e=>{if(!ref.matrix)return G.translate(G.rotate(G.resize(e,p(0,0),ref.scale),p(0,0),ref.rotation||0),ref.x,ref.y);const [a,b,c,d,x,y]=ref.matrix;return G.transformEntity(e,q=>p(a*q.x+c*q.y+x,b*q.x+d*q.y+y),{scale:Math.hypot(a,b),rotation:G.angle(p(a,b)),mirror:a*d-b*c<0});};
    const block={type:'block',name:ref.name,layer:fallbackLayer,hidden:old?.hidden||false,xref:ref,entities:sourceEntities.map(transform)};
    const {type:unusedType,...changes}=block;
    const command=v.action!=='attach'?{type:'update',ids:[old.id],changes}:{type:'add',entity:block};
    execute(layerCommands.length?{type:'batch',commands:[...layerCommands,command]}:command);
   }
   toast('외부참조 '+({attach:'연결',refresh:'갱신',repath:'경로 복구'}[v.action])+' 완료'+unitNote+(nested.skipped.length?` · 겹치기 중첩 ${nested.skipped.length}개는 따라가지 않음`:''));
  });},
  XREFSTYLE(){const refs=chosen().filter(entity=>entity.xref);if(!refs.length)throw Error('색상이나 레이어를 바꿀 외부참조를 선택하세요.');form('외부참조 표시 색상·레이어',[choice('layer','대상 레이어','keep',[['keep','기존 레이어 유지'],...engine.doc.layers.map(layer=>[layer.id,layer.name])]),f('color','표시 색상 (빈칸은 기존, #RRGGBB)','')],v=>{if(v.color&&!/^#[0-9a-f]{6}$/i.test(v.color))throw Error('색상은 #RRGGBB입니다.');const restyle=entity=>{const copy=structuredClone(entity);if(v.layer!=='keep')copy.layer=v.layer;if(v.color)copy.color=v.color;if(copy.entities)copy.entities=copy.entities.map(restyle);return copy;};execute({type:'batch',commands:refs.map(entity=>{const styled=restyle(entity),{id,type,...changes}=styled;return {type:'update',ids:[entity.id],changes};})});toast('외부참조 '+refs.length+'개의 표시 속성을 변경했습니다.');});},
  XREFBIND(){const refs=chosen().filter(entity=>entity.xref);if(!refs.length)throw Error('결합할 외부참조를 선택하세요.');execute({type:'batch',commands:refs.map(entity=>({type:'update',ids:[entity.id],changes:{xref:null}}))});toast('외부참조 '+refs.length+'개를 편집 가능한 일반 블록으로 결합했습니다.');},
  SHP(){form('SHP ZIP 가져오기 · PRJ/DBF/SHX를 같은 이름으로 포함',[f('sourceCRS','원본 CRS (PRJ가 있으면 빈칸)',''),f('targetCRS','출력 미터 투영 CRS','EPSG:5186'),number('originX','로컬 원점 동쪽좌표 m',0),number('originY','로컬 원점 북쪽좌표 m',0),choice('encoding','DBF 문자 인코딩','utf-8',['utf-8','cp949'])],v=>pickFiles('.zip',false,async files=>{const r=await api('shp',{...v,data:await b64(files[0]),originX:num(v.originX),originY:num(v.originY)});add(r.entities.map(e=>({...e,layer:activeLayer()})));toast('SHP '+r.entities.length+'개 · '+r.report.note);}));},
  DISTANCECHECK(){const es=chosen();if(es.length!==2)throw Error('건물 경계 두 개를 선택하세요.');const nearest=closestBuildings(...es);form('인동간격 계산 · 사용자 지정 높이 배수와 최소거리 비교',[number('height','적용 높이 m',10),number('factor','요구 간격/높이 배수',1),number('minimum','최소 간격 m',0),f('basis','적용 규정/지역/측정 방향 근거','사용자 지정 기준. 최단 평면거리 비교'),...pointFields()],v=>{
   const height=positive(v.height,'높이'),factor=num(v.factor),minimum=num(v.minimum);if(factor<0||minimum<0)throw Error('배수와 최소거리는 0 이상');const required=Math.max(height*factor,minimum),actual=nearest.distance/1000;
   const rows=[['항목','값'],['최단 평면거리 m',actual],['높이 m',height],['배수',factor],['최소 간격 m',minimum],['요구 간격 max(높이×배수,최소) m',required],['지정 기준 비교',actual>=required?'충족':'부족'],['근거/범위',v.basis]];
   add([tableBlock(rows,{x:num(v.x),y:num(v.y),height:getSettings().textHeight,layer:activeLayer(),name:'인동간격 산출'}),...(actual>0?[{type:'dimension',mode:'aligned',points:[nearest.a,nearest.b,nearest.a],textHeight:getSettings().textHeight}]:[])]);
  });},
  STRUCTURE(){form('구조 제도 · 사용자 배근 입력, 내력/정착/이음 검토 별도',[choice('action','작업','detail',[['detail','부재 상세 생성'],['schedule','도면 부재 → 보/기둥 일람표'],['read','선택 일람표 → 구조 부재 상세'],['frame','축선 좌표로 철골 평면 생성']]),choice('kind','부재 종류','beam',[['beam','보'],['column','기둥'],['slab','슬래브'],['steel','철골 평면/단면']]),f('mark','부재 번호','G1'),f('gridX','철골 X 축선 좌표 mm (쉼표)','0,6000,12000'),f('gridY','철골 Y 축선 좌표 mm (쉼표)','0,6000,12000'),number('width','폭 mm',400),number('depth','깊이/슬래브 두께 mm',600),number('cover','피복 mm',40),number('diameter','주근 지름 mm',22),number('count','한 변/상하 각 철근 개수',4),number('spacing','띠근/분포근 간격 mm',200),number('span','부재 길이 mm',6000),...pointFields()],v=>{
   const es=chosen().length?chosen():engine.doc.entities,layer=activeLayer(),height=getSettings().textHeight;
   if(v.action==='frame'){add(steelFrame(v.gridX.split(',').map(x=>num(x)),v.gridY.split(',').map(x=>num(x)),{x:num(v.x),y:num(v.y),width:positive(v.width,'폭'),depth:positive(v.depth,'깊이'),textHeight:height},layer));return;}
   if(v.action==='schedule'){const rows=[['kind','mark','width','depth','cover','diameter','count','spacing','span'],...es.filter(e=>e.structural).map(e=>['kind','mark','width','depth','cover','diameter','count','spacing','span'].map(k=>e.structural[k]))];if(rows.length<2)throw Error('구조 부재가 없습니다.');add([tableBlock(rows,{x:num(v.x),y:num(v.y),height,layer,name:'구조 일람표'})]);return;}
   if(v.action==='read'){const tb=chosen().find(e=>e.table);if(!tb)throw Error('구조 일람표 블록을 선택하세요.');const rows=tb.table.rows,headers=rows[0].map(String);for(const key of ['kind','mark','width','depth'])if(!headers.includes(key))throw Error('일람표 열 누락: '+key);const entities=rows.slice(1).map((r,i)=>{const o=Object.fromEntries(headers.map((k,j)=>[k,r[j]]));for(const key of ['width','depth','cover','diameter','count','spacing','span'])o[key]=num(o[key]??v[key]);return structuralDetail(o.kind,{...o,x:num(v.x),y:num(v.y)-i*2500,textHeight:height},layer);});add(entities);return;}
   const o={...v,textHeight:height};for(const key of ['width','depth','cover','diameter','count','spacing','span','x','y'])o[key]=num(v[key]);add([structuralDetail(v.kind,o,layer)]);
  });},
 });return studio;
}
