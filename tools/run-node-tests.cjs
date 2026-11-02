// npm test: package.json 의 testFiles 목록을 node --test 로 돌린다.
// 목록을 scripts.test 한 줄에 두면 Windows 명령줄 한도(cmd.exe 8,191자)를 넘어 "명령줄이 너무 깁니다"로 실행조차 안 된다.
// 추가 인자는 그대로 node --test 에 넘긴다(예: npm test -- --test-name-pattern=ATTSYNC).
'use strict';
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.join(__dirname,'..');
const pkg=require(path.join(root,'package.json'));
const files=pkg.testFiles;
if(!Array.isArray(files)||!files.length){console.error('package.json testFiles 목록이 비었습니다.');process.exit(1);}
const result=spawnSync(process.execPath,['--test',...process.argv.slice(2),...files],{cwd:root,stdio:'inherit'});
if(result.error){console.error(result.error.message);process.exit(1);}
process.exit(result.status??1);
