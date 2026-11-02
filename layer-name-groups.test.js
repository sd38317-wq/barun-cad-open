import test from 'node:test';
import assert from 'node:assert/strict';
import {layerFamilyKey,suggestLayerFamily,buildNameGroups,applyNameGroup,dictionaryFromNameGroups,splitNameGroup,nameGroupState,rememberTarget,describeDictionary} from './layer-name-groups.js';
import {analyzeRankedDrawingLayers,layerDictionaryKey} from './architecture.js';

const doc=(layerNames,entitiesPerLayer=2)=>{
 const layers=layerNames.map((name,i)=>({id:'L'+i,name,visible:true,locked:false,frozen:false,color:'#fff'}));
 const entities=[];
 layers.forEach((l,i)=>{for(let k=0;k<entitiesPerLayer;k++)entities.push({id:`e${i}_${k}`,type:'line',layer:l.id,points:[{x:0,y:k*100},{x:3000,y:k*100}]});});
 return {layers,entities};
};

test('이름 묶음 키: 외부참조 앞·괄호 설명·끝 번호를 뗀다',()=>{
 assert.equal(layerFamilyKey('WALL1'),'WALL');
 assert.equal(layerFamilyKey('평면도$0$WALL2'),'WALL');
 assert.equal(layerFamilyKey('주동$1$WIN-3'),'WIN');
 assert.equal(layerFamilyKey('도면|TEX_1'),'TEX');
 assert.equal(layerFamilyKey('ELE-4(입면선 가는선)'),'ELE');
 assert.equal(layerFamilyKey('a-wall'),'A-WALL');
 assert.equal(layerFamilyKey('0'),'0');
});

test('외부참조 이름은 $0$ 말고 $1$ 도 뗀다',()=>{
 assert.equal(layerDictionaryKey('주동$1$WALL'),'WALL');
});

test('제안: 사전·괄호 설명·이름 규칙·한글 낱말 순',()=>{
 const pick=s=>s&&{label:s.label,source:s.source};
 assert.deepEqual(pick(suggestLayerFamily('WALL1')),{label:'벽체',source:'이름 규칙'});
 assert.deepEqual(pick(suggestLayerFamily('W3',{'W#':'벽체'})),{label:'벽체',source:'사무소 사전'});
 assert.deepEqual(pick(suggestLayerFamily('WALL2',{'WALL2':'칸막이','WALL#':'벽체'})),{label:'칸막이',source:'사무소 사전'}); // 펼쳐서 정한 이름이 묶음보다 먼저
 assert.equal(suggestLayerFamily('FUR-욕실').hint,"이름에 '욕실'");          // 직원이 읽는 근거
 assert.equal(suggestLayerFamily('ELE-4(입면선 가는선)').label,'전개·입면');   // 설명이 이름(ELE=승강기)보다 먼저
 assert.equal(suggestLayerFamily('ELE1').label,'승강기');
 assert.equal(suggestLayerFamily('결로방지단열재').label,'단열재');
 assert.equal(suggestLayerFamily('A-벽콘').label,'벽체');
 assert.equal(suggestLayerFamily('창호부호').label,'기호');                    // 번호표는 창이 아니라 기호
 assert.equal(suggestLayerFamily('FUR2').label,'가구');
 assert.equal(suggestLayerFamily('CON').label,'콘크리트벽');
 assert.equal(suggestLayerFamily('HAT-덧부재').label,'해치');                  // 낱말 하나가 통째로 약어
 assert.equal(suggestLayerFamily('SET-난간'),null);
 assert.equal(suggestLayerFamily('FUR-욕실').label,'위생');                    // 한글 낱말이 낱말 약어보다 먼저
 assert.equal(suggestLayerFamily('MC'),null);
 assert.equal(suggestLayerFamily('STREET'),null);                              // 짧은 영문 조각으로 짐작하지 않는다
 assert.equal(suggestLayerFamily('창고'),null);                                // '창' 한 글자로 창이라 하지 않는다
});

test('남은 객체를 이름 묶음으로: 끝 번호만 다른 레이어는 한 줄, 제안 있는 줄이 먼저',()=>{
 const d=doc(['WALL1','WALL2','MC','OPEN','0']);
 const decisions=analyzeRankedDrawingLayers(d);
 const groups=buildNameGroups(d,decisions);
 const wall=groups.find(g=>g.key==='WALL');
 assert.ok(wall,'WALL 줄');
 assert.deepEqual(wall.layers.map(l=>l.name),['WALL1','WALL2']);
 assert.equal(wall.count,4);
 assert.equal(wall.suggestion.label,'벽체');
 assert.equal(wall.core,true);                                                // 단면·법규에 쓰이는 종류
 const open=groups.find(g=>g.key==='OPEN');
 assert.equal(open.suggestion.label,'문');
 assert.match(open.warning,/열림 호/);                                        // 문인데 열림 호가 없으면 경고
 const mc=groups.find(g=>g.key==='MC');
 assert.equal(mc.suggestion,null);
 const zero=groups.find(g=>g.key==='0');
 assert.equal(zero.unnamed,true);                                             // 이름 없는 레이어는 선 하나씩
 const firstPlain=groups.findIndex(g=>!g.suggestion);
 assert.ok(groups.slice(0,firstPlain).every(g=>g.suggestion),'제안 있는 줄이 앞');
});

test('이미 자동으로 정해진 객체는 묶음에 넣지 않는다',()=>{
 const d=doc(['A-WALL','WALL1']);
 const groups=buildNameGroups(d,analyzeRankedDrawingLayers(d));
 assert.deepEqual(groups.map(g=>g.key),['WALL']);
});

test('묶음 하나를 확인하면 그 객체만 옮길 대상이 된다',()=>{
 const d=doc(['WALL1','WALL2','MC']);
 const decisions=analyzeRankedDrawingLayers(d);
 const wall=buildNameGroups(d,decisions).find(g=>g.key==='WALL');
 const n=applyNameGroup(decisions,wall,'벽체');
 assert.equal(n,4);
 const byId=new Map(decisions.map(x=>[x.id,x]));
 for(const id of wall.entityIds){assert.equal(byId.get(id).label,'벽체');assert.equal(byId.get(id).accepted,true);}
 assert.equal(decisions.filter(x=>x.accepted).length,4);                        // MC 는 그대로
});

test('다음부터 자동: 확인한 묶음은 번호 묶음으로 사전에 남고, 다음 도면의 WALL3 도 자동',()=>{
 const learned=dictionaryFromNameGroups([{key:'WALL',label:'벽체',remember:true},{key:'MC',label:'기호',remember:false}]);
 assert.deepEqual(learned,{'WALL#':'벽체'});
 const next=doc(['WALL3']);
 const decisions=analyzeRankedDrawingLayers(next,{dictionary:learned});
 assert.ok(decisions.every(x=>x.accepted&&x.label==='벽체'));
});

test('묶음을 레이어별로 펼치면 줄마다 따로 확인하고, 그 이름 그대로 기억한다',()=>{
 const d=doc(['WALL1','WALL2']);
 const decisions=analyzeRankedDrawingLayers(d);
 const wall=buildNameGroups(d,decisions).find(g=>g.key==='WALL');
 const parts=splitNameGroup(d,wall);
 assert.deepEqual(parts.map(p=>[p.key,p.exact,p.count,p.suggestion?.label]),[['WALL1',true,2,'벽체'],['WALL2',true,2,'벽체']]);
 applyNameGroup(decisions,parts[0],'콘크리트벽');applyNameGroup(decisions,parts[1],'칸막이');
 const learned=dictionaryFromNameGroups([{...parts[0],label:'콘크리트벽',remember:true},{...parts[1],label:'칸막이',remember:true}]);
 assert.deepEqual(learned,{WALL1:'콘크리트벽',WALL2:'칸막이'});
 const next=analyzeRankedDrawingLayers(doc(['WALL1','WALL2']),{dictionary:learned});
 assert.deepEqual([...new Set(next.map(x=>x.label))].sort(),['칸막이','콘크리트벽']);
});

test('묶음 상태는 객체 분류에서 다시 읽는다(종류별 보기에서 고쳐도 맞게)',()=>{
 const d=doc(['WALL1','WALL2']);
 const decisions=analyzeRankedDrawingLayers(d);
 const byId=new Map(decisions.map(x=>[x.id,x]));
 const wall=buildNameGroups(d,decisions).find(g=>g.key==='WALL');
 assert.equal(nameGroupState(wall,byId).state,'pending');
 applyNameGroup(decisions,wall,'벽체');
 assert.deepEqual(nameGroupState(wall,byId),{state:'confirmed',label:'벽체',accepted:4});
 byId.get(wall.entityIds[0]).accepted=false;                                  // 종류별 보기에서 선 하나를 원본 유지로
 assert.equal(nameGroupState(wall,byId).state,'mixed');
 applyNameGroup(decisions,wall,null);
 assert.equal(nameGroupState(wall,byId,true).state,'kept');
});

test('기억 문구와 사전 목록은 사람이 읽는 말로',()=>{
 const d=doc(['WALL1','WALL2','MC']);
 const groups=buildNameGroups(d,analyzeRankedDrawingLayers(d));
 assert.equal(rememberTarget(groups.find(g=>g.key==='WALL')),'WALL·WALL1·WALL2…');
 assert.equal(rememberTarget(groups.find(g=>g.key==='MC')),'MC');
 assert.deepEqual(describeDictionary({'WALL#':'벽체',WALL1:'콘크리트벽'}),[{entry:'WALL + 번호'.replace(' + 번호','#'),label:'벽체',name:'WALL + 번호'},{entry:'WALL1',label:'콘크리트벽',name:'WALL1'}]);
});

test('펼친 줄은 괄호 설명까지 이름 그대로 기억해 서로 덮어쓰지 않는다',()=>{
 const d=doc(['ELE-4(입면선)','ELE-4(기타)']);
 const g=buildNameGroups(d,analyzeRankedDrawingLayers(d)).find(x=>x.key==='ELE');
 const parts=splitNameGroup(d,g);
 assert.deepEqual(parts.map(p=>p.key),['ELE-4(입면선)','ELE-4(기타)']);
 assert.ok(parts.every(p=>p.parent===g));
 const learned=dictionaryFromNameGroups(parts.map((p,i)=>({...p,label:i?'승강기':'전개·입면',remember:true})));
 assert.deepEqual(learned,{'ELE-4(입면선)':'전개·입면','ELE-4(기타)':'승강기'});
 const next=analyzeRankedDrawingLayers(doc(['ELE-4(입면선)','ELE-4(기타)']),{dictionary:learned});
 assert.deepEqual(next.map(x=>x.label),['전개·입면','전개·입면','승강기','승강기']);
});
