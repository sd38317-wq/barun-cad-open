// 검토 B5: 새 시험 파일을 만들고 package.json testFiles 에 안 넣으면 npm test 가 돌리지 않는다. 빠진 파일이 있으면 실패.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
// 지금 실패하는 시험이라 목록 밖에 둔 것(고치면 목록에 넣고 여기서 지운다).
const KNOWN_FAILING=new Set(['cursor-command-hint.test.js','official-packaging.test.cjs']);
test('모든 시험 파일이 npm test 목록에 있다',()=>{
 const listed=new Set(JSON.parse(fs.readFileSync('package.json','utf8')).testFiles);
 const files=[...fs.readdirSync('.'),...fs.readdirSync('drawing-details').map(name=>'drawing-details/'+name)].filter(name=>/\.test\.c?js$/.test(name));
 assert.deepEqual(files.filter(name=>!listed.has(name)&&!KNOWN_FAILING.has(name)),[]);
});
