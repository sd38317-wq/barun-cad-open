import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');

test('Ctrl+C·Ctrl+X 는 고른 게 없으면 객체 선택 단계로 들어가고 Enter·우클릭에서 복사한다(오토캐드처럼)',()=>{
 assert.match(source,/if\(\['COPYCLIP','CUTCLIP'\]\.includes\(name\)&&selected\.size\)\{/);
 assert.match(source,/const selectionCommands = new Set\(\[\s*'TALIGN','DIMCLEAN','LEN','PC','COPYCLIP','CUTCLIP',/);
 assert.match(source,/if\(\['COPYCLIP','CUTCLIP'\]\.includes\(mode\)\)\{\s*if\(!requireSelection\(\)\)return;/);
 assert.match(source,/'복사할'\)\+' 객체 선택 · 클릭·드래그 후 Enter 또는 우클릭'/);
});

test('PL W 는 오토캐드처럼 시작 폭 → 끝 폭을 묻고, 두 번째 값을 선분 길이로 그리지 않는다',()=>{
 assert.match(source,/if\(params\.plineWidthStart===undefined\)\{params\.plineWidthStart=blank\?\(params\.plineWidth\?\?run\.plineWidth\?\?0\):amount\*factor;/);
 assert.match(source,/const end=blank\?params\.plineWidthStart:amount\*factor;/);
 assert.match(source,/\$\{params\.plineWidthStart===undefined\?'시작':'끝'\} \$\{params\.plineValue==='halfwidth'\?'반폭':'폭'\}/);
});

test('ROTATE R(참조): 두 끝점·L 선·숫자로 지금 각도 → 새 각도(숫자·방향 점·L 맞출 선), 참조 점은 직교를 걸지 않는다',()=>{
 assert.match(source,/\['R','REFERENCE','참조'\]\.includes\(option\)\)\{params\.rotateRef=\{stage:'ref1'\};phase='rotate-ref';/);
 assert.match(source,/function rotateDelta\(newAngle,undirected=false\)\{\s*const r=params\.rotateRef;let delta=newAngle-\(r\?\.refAngle\|\|0\);/);
 assert.match(source,/if\(mode==='ROTATE'&&params\?\.rotateRef&&points\.length\)\{acceptRotateReference\(p\);return;\}/);
 assert.match(source,/const ORTHO_EXEMPT_PHASES=new Set\(\[[^\]]*'rotate-ref'\]\);/);
});

test('명령창이 비어 있으면 Ctrl+C/X/V 는 CAD 클립보드(새 도면에서 붙여넣기), 저장 알림은 세부 안내를 늘어놓지 않는다',()=>{
 assert.match(source,/if\(clip&&\(clip!=='PASTECLIP'\|\|cadClipboard\)\)\{e\.preventDefault\(\);canvas\.focus\(\);run\(clip\);return;\}/);
 assert.match(source,/if\(warnings\.length\)console\.info\('저장 세부 안내', warnings\);/);
});
