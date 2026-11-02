// ACAD200 515: 치수 스타일 변수 대응표·재정의 분리·하위 스타일·새 값의 그리기 연결.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {DIMVAR_MAP,DIM_STYLE_DEFAULTS_ISO,applyDimStyle,resolveDimStyle,migrateDimOverrides,restyleDimension,restyleDimensions,setDimOverrides,clearDimOverrides,childStyleName,dimVarsToStyle,styleToDimVars,createDimStyle,updateDimStyle} from './dimension-style.js';

const P=(x,y)=>({x,y});
const label=e=>G.dimensionParts(e).find(p=>p.dimensionLabel);
const doc={dimStyles:{STANDARD:{textHeight:150},ARCH:{name:'ARCH',textHeight:250,precision:0,arrowType:'tick'},'ARCH$4':{name:'ARCH$4',textHeight:300}},currentDimStyle:'ARCH'};

test('AutoCAD 변수 대응표와 DXF 왕복',()=>{
 assert.equal(DIMVAR_MAP.DIMTXT,'textHeight');assert.equal(DIMVAR_MAP.DIMTAD,'textVertical');assert.equal(DIMVAR_MAP.DIMPOST,'textTemplate');
 const style=dimVarsToStyle({DIMTXT:2.5,DIMDEC:2,DIMDSEP:44,DIMZIN:8,DIMTAD:1,DIMBLK:'_ARCHTICK',DIMLUNIT:2,DIMPOST:'<> mm'});
 assert.deepEqual(style,{textHeight:2.5,textVertical:1,precision:2,decimalSeparator:',',zeroSuppress:8,textTemplate:'<> mm',arrowType:'tick',unit:'decimal'});
 const vars=styleToDimVars(style);assert.equal(vars.DIMBLK,'ARCHTICK');assert.equal(vars.DIMLUNIT,2);assert.deepEqual(dimVarsToStyle(vars),style);
});

test('하위 스타일($4 반지름)·재정의 순서: 기본 ← 스타일 ← 하위 스타일 ← 재정의',()=>{
 assert.equal(childStyleName('ARCH','radius'),'ARCH$4');assert.equal(childStyleName('ARCH','horizontal'),null);
 assert.equal(resolveDimStyle(doc,{mode:'horizontal',dimStyle:'ARCH'}).textHeight,250);
 assert.equal(resolveDimStyle(doc,{mode:'radius',dimStyle:'ARCH'}).textHeight,300);
 assert.equal(resolveDimStyle(doc,{mode:'radius',dimStyle:'ARCH',textHeight:999,overrides:{textHeight:400}}).textHeight,999,'재정의 값은 객체 값(변환을 따라간 값)');
 assert.equal(resolveDimStyle(doc,{mode:'radius',dimStyle:'ARCH',overrides:{textHeight:400}}).textHeight,400);
 assert.equal(resolveDimStyle(doc,{mode:'horizontal'}).dimStyle,'ARCH','스타일 이름이 없으면 현재 스타일');
 assert.equal(resolveDimStyle(doc,{mode:'horizontal'}).decimalSeparator,'.');
});

test('예전 치수 이전: 스타일과 다른 값만 재정의로, 객체 값은 그대로',()=>{
 const old={type:'dimension',mode:'horizontal',dimStyle:'ARCH',textHeight:250,precision:3,arrowType:'tick'};
 const migrated=migrateDimOverrides(old,doc.dimStyles.ARCH);
 assert.deepEqual(migrated.overrides,{precision:3});assert.equal(migrated.textHeight,250);assert.equal(migrated.precision,3);
 assert.equal(migrateDimOverrides(migrated,{}),migrated,'이미 이전한 치수는 그대로');
});

test('스타일을 고치면 재정의하지 않은 값만 따라 바뀐다(AutoCAD 와 같음)',()=>{
 const dim={type:'dimension',id:'d',mode:'horizontal',dimStyle:'ARCH',textHeight:250,precision:3,arrowType:'tick',points:[P(0,0),P(1000,0),P(0,300)]};
 const next=updateDimStyle(doc,'ARCH',{textHeight:200,precision:1});
 const changes=restyleDimension(next,dim,doc);
 assert.equal(changes.textHeight,200);assert.equal(changes.precision,undefined,'재정의(3)는 지킨다');assert.deepEqual(changes.overrides,{precision:3});
 assert.equal(changes.textVertical,undefined,'스타일이 정하지 않은 새 값은 쓰지 않는다');
 assert.deepEqual(restyleDimensions(next,[dim,{type:'line',id:'l'},{...dim,id:'o',dimStyle:'STANDARD'}],'ARCH',doc).map(u=>u.id),['d']);
 assert.equal(restyleDimension(next,dim).textHeight,undefined,'고치기 전 도면을 주지 않으면 예전 값을 재정의로 본다(보수적)');
 const overridden=setDimOverrides(dim,{textHeight:500});assert.equal(overridden.textHeight,500);assert.equal(overridden.overrides.textHeight,500);
 assert.equal(restyleDimension(next,overridden).textHeight,undefined);
 assert.equal(restyleDimension(next,clearDimOverrides(overridden)).textHeight,200,'재정의를 지우면 스타일 값으로');
 assert.throws(()=>setDimOverrides(dim,{textVertical:9}),/올바르지 않습니다/);
});

test('applyDimStyle: 새 값을 정하지 않은 스타일은 예전 결과와 똑같다',()=>{
 const before=applyDimStyle({type:'dimension'},{name:'S',textHeight:3});
 for(const key of ['textVertical','decimalSeparator','zeroSuppress','round','baselineSpacing'])assert.equal(before[key],undefined,key);
 const withExtras=applyDimStyle({type:'dimension'},{name:'S',decimalSeparator:',',textVertical:0});
 assert.equal(withExtras.decimalSeparator,',');assert.equal(withExtras.textVertical,0);
 assert.throws(()=>createDimStyle({},'BAD',{zeroSuppress:99}),/올바르지 않습니다/);
 assert.equal(DIM_STYLE_DEFAULTS_ISO.zeroSuppress,8,'기본 0 생략 = 지금 그리는 모양(끝 0 생략)');
});

test('그리기: 새 값이 없으면 예전 문자 그대로, 있으면 소수점·0 생략·반올림·문자 위치를 따른다',()=>{
 for(let i=0;i<500;i++){const v=(Math.sin(i)*1e5)/7,precision=i%5;assert.equal(G.formatDimNumber(v,{precision}),Number(v.toFixed(precision)).toString());}
 const dim={type:'dimension',mode:'horizontal',textHeight:100,textGap:30,precision:2,points:[P(0,0),P(1234.5,0),P(0,500)]};
 assert.equal(label(dim).text,'1234.5');
 assert.equal(label({...dim,zeroSuppress:0,decimalSeparator:','}).text,'1234,50');
 assert.equal(label({...dim,round:5,precision:0}).text,'1235');
 assert.equal(label({...dim,textTemplate:'<> mm'}).text,'1234.5 mm','DIMPOST 접미사');
 assert.equal(label(dim).position.y,530);assert.equal(label({...dim,textVertical:1}).position.y,530);
 assert.equal(label({...dim,textVertical:0}).position.y,450,'치수선 가운데');assert.equal(label({...dim,textVertical:4}).position.y,370,'치수선 아래');
 assert.equal(label({type:'dimension',mode:'angular',textHeight:10,precision:1,decimalSeparator:',',zeroSuppress:0,points:[P(0,0),P(100,0),P(0,100),P(50,50)]}).text,'90,0°');
});
