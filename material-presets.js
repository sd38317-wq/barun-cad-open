// 3D 재료 목록(화면 없음). 엔진 검사·AI 도구 설명·3D 그림이 같은 목록을 쓴다.
// 무늬는 그림 파일 없이 실제 크기(mm)로 즉석에서 그린다(review-3d.js). 색·거칠기·금속감·투명도는 three.js 재질 값.
// kinds: 이 재료를 쓸 수 있는 부재 종류(wall 벽·slab 바닥판·roof 지붕·frame 창틀·leaf 문짝·glass 유리·stair 계단·solid 그 밖의 입체).
const P=(id,label,kinds,color,pattern=null,more={})=>Object.freeze({id,label,kinds:Object.freeze(kinds),color,pattern:pattern&&Object.freeze(pattern),roughness:.9,metalness:0,...more});
const SOLIDS=['wall','slab','stair','solid'];
export const MATERIAL_PRESETS=Object.freeze([
 // 벽(외벽·내벽)
 P('plaster-white','흰색 미장',['wall','solid'],'#e9e5dd'),
 P('plaster-beige','베이지 미장',['wall','solid'],'#e4d6bf'),
 P('paint-gray','회색 도장',['wall','solid'],'#b9bcbe'),
 P('concrete-exposed','노출 콘크리트',[...SOLIDS],'#b3b1ab',{type:'panel',unit:[1800,900],joint:4,jointColor:'#8e8c86',dots:true,variation:.05}),
 P('brick-red','적벽돌',['wall','solid'],'#9b4a33',{type:'brick',unit:[210,60],joint:10,jointColor:'#d6cfc4',variation:.12}),
 P('brick-gray','회색 벽돌',['wall','solid'],'#8d8a86',{type:'brick',unit:[210,60],joint:10,jointColor:'#cfcac2',variation:.1}),
 P('brick-white','백색 벽돌',['wall','solid'],'#e6e1d8',{type:'brick',unit:[210,60],joint:10,jointColor:'#bdb6ab',variation:.06}),
 P('stone-granite','화강석 판석',[...SOLIDS],'#a8a29a',{type:'stone',unit:[600,300],joint:5,jointColor:'#7d776f',variation:.1,speckle:true}),
 P('stone-limestone','라임스톤',['wall','solid'],'#d8ccb4',{type:'stone',unit:[900,450],joint:4,jointColor:'#b8ab92',variation:.06}),
 P('tile-white','백색 타일',['wall','slab','solid'],'#efeeea',{type:'stone',unit:[300,600],joint:3,jointColor:'#c9c6bf',variation:.03},{roughness:.4}),
 P('wood-siding','목재 사이딩',['wall','solid'],'#9a6c45',{type:'board',unit:[3600,150],joint:6,jointColor:'#5c3d24',variation:.15}),
 P('metal-panel','금속 패널',['wall','roof','solid'],'#8f969c',{type:'panel',unit:[1000,3000],joint:15,jointColor:'#5d6368',variation:.03},{roughness:.45,metalness:.55}),
 P('curtain-wall','커튼월(유리 외벽)',['wall'],'#5f7f90',{type:'panel',unit:[1500,3000],joint:40,jointColor:'#3a3f44',variation:.04},{roughness:.15,metalness:.6}),
 // 지붕
 P('roof-concrete','콘크리트 평지붕',['roof'],'#8f9195',null,{roughness:.9}),
 P('roof-zinc','징크(세로 이음)',['roof','wall'],'#7d848b',{type:'seam',unit:[430,1000],joint:25,jointColor:'#61676d',variation:.02},{roughness:.4,metalness:.6}),
 P('roof-clay-tile','점토 기와',['roof'],'#8a3f2c',{type:'brick',unit:[300,350],joint:20,jointColor:'#5e2a1d',variation:.12}),
 P('roof-asphalt','아스팔트 슁글',['roof'],'#4b4e52',{type:'brick',unit:[333,140],joint:6,jointColor:'#323538',variation:.1}),
 P('roof-green','옥상 녹화',['roof'],'#6f8f4e',null,{roughness:1}),
 // 창틀·문짝
 P('frame-black','검정 창틀',['frame'],'#2f3236',null,{roughness:.45,metalness:.4}),
 P('frame-silver','은색 창틀',['frame'],'#a7adb2',null,{roughness:.35,metalness:.7}),
 P('frame-white','흰색 창틀',['frame'],'#e9e9e6',null,{roughness:.5}),
 P('frame-wood','목재 창틀',['frame','leaf'],'#8a5d3b',{type:'grain',unit:[1000,40],joint:0,jointColor:'#6e4a2f',variation:.12},{roughness:.6}),
 P('door-oak','오크 문',['leaf'],'#b08553',{type:'grain',unit:[1000,30],joint:0,jointColor:'#8e6a40',variation:.1},{roughness:.6}),
 P('door-walnut','월넛 문',['leaf'],'#5e3f2a',{type:'grain',unit:[1000,30],joint:0,jointColor:'#47301f',variation:.1},{roughness:.6}),
 P('door-white','흰색 문',['leaf'],'#ecebe7',null,{roughness:.5}),
 P('door-steel','회색 철문',['leaf'],'#6d7378',null,{roughness:.45,metalness:.5}),
 // 유리
 P('glass-clear','투명 유리',['glass'],'#a9d0e2',null,{roughness:.05,opacity:.3}),
 P('glass-lowe','로이 유리(푸른빛)',['glass'],'#6fa3b5',null,{roughness:.05,metalness:.2,opacity:.42}),
 P('glass-reflective','반사 유리',['glass'],'#8a9aa5',null,{roughness:.02,metalness:.85,opacity:.6}),
 P('glass-frosted','불투명(간유리)',['glass'],'#dfe8ec',null,{roughness:.6,opacity:.7}),
 // 바닥·계단
 P('concrete','콘크리트',['slab','stair','solid','roof'],'#c8c3b9'),
 P('wood-floor','목재 마루',['slab','stair'],'#a57a50',{type:'board',unit:[1200,120],joint:2,jointColor:'#6e4f33',variation:.15},{roughness:.55}),
]);
/** 부재 종류별 기본 재료(아무것도 고르지 않았을 때 — 지금 3D 기본 그림과 같다). */
export const DEFAULT_MATERIALS=Object.freeze({wall:'plaster-white',slab:'concrete',roof:'roof-concrete',frame:'frame-black',leaf:'door-oak',glass:'glass-clear',stair:'concrete',solid:'concrete'});
export const MATERIAL_KINDS=Object.freeze(Object.keys(DEFAULT_MATERIALS));
const byId=new Map(MATERIAL_PRESETS.map(m=>[m.id,m]));
export const materialPreset=id=>byId.get(id)||null;
export const KIND_LABELS=Object.freeze({wall:'벽',slab:'바닥판',roof:'지붕',frame:'창틀',leaf:'문짝',glass:'유리',stair:'계단',solid:'그 밖의 입체'});

/** 종류별 재료 설정 검사. {wall:'brick-red', …} → 그대로(잘못이면 오류). */
export function validateMaterialMap(map){
 if(!map||typeof map!=='object'||Array.isArray(map))throw Error('재료 설정은 {부재 종류: 재료 ID} 입니다.');
 for(const [kind,id] of Object.entries(map)){
  if(!MATERIAL_KINDS.includes(kind))throw Error(`없는 부재 종류: ${kind} (쓸 수 있는 것: ${MATERIAL_KINDS.join(', ')})`);
  if(id===null)continue;   // null = 기본으로 되돌림
  const fits=()=>`${KIND_LABELS[kind]}에 쓸 수 있는 재료: ${MATERIAL_PRESETS.filter(m=>m.kinds.includes(kind)).map(m=>`${m.label}(${m.id})`).join(', ')}`;
  const preset=materialPreset(id);if(!preset)throw Error(`없는 재료: ${id} — ${fits()}`);
  if(!preset.kinds.includes(kind))throw Error(`${preset.label}(${id})은 ${KIND_LABELS[kind]}에 쓸 수 없습니다. ${fits()}`);
 }
 return map;
}
/** 실제로 쓸 재료: 객체에 정한 것 > 도면 종류별 설정 > 기본. */
export function resolveMaterial(kind,docMaterials={},entityMaterial=null){
 const own=entityMaterial&&materialPreset(entityMaterial);if(own&&own.kinds.includes(kind))return own;
 const picked=docMaterials?.[kind]&&materialPreset(docMaterials[kind]);if(picked&&picked.kinds.includes(kind))return picked;
 return materialPreset(DEFAULT_MATERIALS[kind])||materialPreset(DEFAULT_MATERIALS.solid);
}
/** AI 도구 설명용 한 줄 목록: "wall: plaster-white(흰색 미장), brick-red(적벽돌) …". */
export function materialCatalogText(){
 return MATERIAL_KINDS.map(kind=>`${kind}(${KIND_LABELS[kind]}): `+MATERIAL_PRESETS.filter(m=>m.kinds.includes(kind)).map(m=>`${m.id}=${m.label}`).join(', ')).join(' | ');
}
