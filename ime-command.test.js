import test from 'node:test';
import assert from 'node:assert/strict';
import {preprocessImeCommand,classifyInput,defaultAliases,hangulToQwerty,typedCommandKey,trailingSpaceSubmit,imeOptionValue} from './commands.js';
const settings={aliases:defaultAliases()};
const convert=value=>preprocessImeCommand(value,'idle',settings);
test('jamo keys resolve existing aliases with a conversion notice',()=>{
 for(const [input,keys,command] of [['ㄱㄷㅊ','rec','RECTANGLE'],['ㅣ','l','LINE'],['ㅊ','c','COPY'],['ㅡㅐㅍㄷ','move','MOVE']]){
  assert.deepEqual(convert(input),{text:keys,command});
  assert.deepEqual(classifyInput(input,'idle',settings),{kind:'command',value:command,conversion:`${input} → ${keys}`});
 }
});
test('syllables, final clusters, compound vowels and shifted keys',()=>{
 for(const [input,keys] of [['럭','fjr'],['오프셋','dhvmtpt'],['ㅁㅐㅍㄷ','aove'],['값','rkqt'],['ㅘㅝㅢ','hknjml'],['ㅃㅉㄸㄲㅆㅒㅖ','QWERTOP']])assert.equal(hangulToQwerty(input),keys);
 assert.equal(convert('ㅁㅐㅍㄷ').command,null);
});
test('preserve Korean commands, text, numeric input and failed lookups',()=>{
 assert.equal(classifyInput('벽','idle',settings).value,'WALL');
 assert.equal(classifyInput('ㄱㄷㅊ','text',settings).value,'ㄱㄷㅊ');
 assert.equal(classifyInput('ㅣ','name',settings).value,'ㅣ');
 for(const input of ['100','100,200','@100,200','@100<90','100ㅣ'])assert.equal(convert(input).text,input);
 assert.equal(preprocessImeCommand('ㅣ','number',settings).command,null);
 assert.deepEqual(classifyInput('ㅁㅐㅍㄷ','idle',settings),{kind:'value',value:'ㅁㅐㅍㄷ'});
 const custom={aliases:{...settings.aliases,COPY:'CC',CIRCLE:'C'}};
 assert.equal(preprocessImeCommand('ㅊ','idle',custom).command,'CIRCLE');
});
// 맥은 도면 위에서도 한글 입력기가 켜져 있어 L 이 'ㅣ' 로 온다(윈도우는 도면 위에서 한글 입력이 꺼져 영문으로 온다).
// 10-24: ZOOM 중 ㄷ(E)이 'E/P/W/A/O/C 또는 배율' 오류 — 명령 안 옵션은 한글 변환을 안 거쳤다.
test('명령 안 옵션: 한글 낱자만 친 것은 영문 글자로, 한글 낱말·문자·이름 입력은 그대로',()=>{
 for(const [input,keys] of [['ㄷ','e'],['ㅔ','p'],['ㅈ','w'],['ㅁ','a'],['ㅐ','o'],['ㅊ','c'],['ㅁㄴ','at'.replace('t','s')],[' ㄷ ',' e ']])assert.equal(imeOptionValue(input,'ZOOM','zoom'),keys,input);
 for(const [input,mode,phase] of [['ㄷ','SELECT','idle'],['ㄱㄴ','TEXT','text'],['층','BLOCK','name'],['변위','STRETCH','point'],['ㄷ자','TEXT','point'],['100','ZOOM','zoom'],['ㅁ','DIMLINEAR','dim-text'],['ㅁ','DIMLINEAR','dim-mtext'],['ㅁ','AREA','area-label']])assert.equal(imeOptionValue(input,mode,phase),input,input+' '+phase);
});
test('app.js 입력은 맨 처음에 imeOptionValue 로 옵션 낱자를 바꾼다(ZOOM 등 앞에서 끝나는 명령도)',async()=>{
 const app=(await import('node:fs')).readFileSync(new URL('./app.js',import.meta.url),'utf8');
 assert.match(app,/function submit\(\) \{[^\n]*\n[^\n]*queueBusySubmit[^\n]*\n(?:\s*\/\/[^\n]*\n)?\s*const value = imeOptionValue\(\$\("coordinate"\)\.value, mode, phase\);/);
});
test('Mac: 도면 위에서 친 한글 낱자도 명령창으로 옮긴다',()=>{
 for(const key of ['l','L','1','@','ㅣ','ㄱ','럭'])assert.equal(typedCommandKey({key}),key,key);
 for(const e of [{key:'Enter'},{key:'F3'},{key:'Process'},{key:'ㅣ',metaKey:true},{key:'c',ctrlKey:true},{key:'ㅣ',altKey:true}])assert.equal(typedCommandKey(e),null,JSON.stringify(e));
});
test('Mac: 한글 조합 중 Space 가 글자로 들어오면 그 공백을 떼고 실행한다',()=>{
 assert.equal(trailingSpaceSubmit('ㅣ ','idle'),'ㅣ');
 assert.equal(trailingSpaceSubmit('ㄱㄷㅊ ','select'),'ㄱㄷㅊ');
 assert.equal(trailingSpaceSubmit('ㅣ','idle'),null,'공백 없음');
 assert.equal(trailingSpaceSubmit(' ','idle'),null,'빈칸만');
 assert.equal(trailingSpaceSubmit('안녕 ','text'),null,'문자 입력 중 공백은 글자');
 assert.equal(trailingSpaceSubmit('층 ','name'),null,'이름 입력 중 공백은 글자');
});
test('Mac: app.js 가 도면 위 글자와 명령창 공백에 위 두 판정을 쓴다',async()=>{
 const app=(await import('node:fs')).readFileSync(new URL('./app.js',import.meta.url),'utf8');
 assert.match(app,/const typed = typedCommandKey\(e\);/);
 assert.match(app,/\$\("coordinate"\)\.value \+= typed;/);
 assert.match(app,/trailingSpaceSubmit\(e\.target\.value, phase\)/);
});
