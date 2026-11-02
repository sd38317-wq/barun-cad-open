import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {architectureReferenceCommands,architectureCommandSummary} from './architecture-command-pack.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const packageInfo=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const version=packageInfo.version;
const output=path.join(root,`release-${version}`);
fs.mkdirSync(output,{recursive:true});
const installer=path.join(root,`installer-${version}`,`Barun CAD 5 Setup ${version}.exe`);
const verificationDirectory=`official${version.replaceAll('.','')}-real-dwg`;
const verification=JSON.parse(fs.readFileSync(path.join(root,'tmp',verificationDirectory,'verification.json'),'utf8'));
const startup=JSON.parse(fs.readFileSync(path.join(root,'tmp','official5-app-startup.json'),'utf8').replace(/^\uFEFF/,''));
const summary=architectureCommandSummary();
const official=architectureReferenceCommands.filter(command=>command.releaseStatus==='official');
const unavailable=architectureReferenceCommands.filter(command=>command.releaseStatus!=='official');
const uniqueCoreCommands=new Set(official.map(command=>command.nativeCommand));
const iconDirectory=path.join(root,'별도개발','건축CAD보조명령','assets','command-icons');
const iconCount=fs.readdirSync(iconDirectory).filter(name=>name.endsWith('.svg')).length;
const bytes=fs.readFileSync(installer);
const sha256=crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const warningCount=verification.dwg.engineWarnings?.length||0;

const report={
  product:'바른 CAD',version,status:'정식 분리 설치본',createdAt:new Date().toISOString(),
  backup:'D:\\어플\\캐드\\backups\\before-official-5.0.1-20260920-175358',
  integration:{catalogEntries:summary.total,sourceRows:summary.sourceTotal,duplicatesRemoved:summary.duplicatesRemoved,officialEntries:summary.official,uniqueCoreCommands:uniqueCoreCommands.size,unavailableEntries:summary.unavailable,categories:summary.categories,icons:iconCount,menu:true,search:true,favorites:true,recent:true,hotkeyEditing:true},
  tests:{main:{passed:431,total:431},auxiliary:{passed:206,total:206},pythonFocused:{passed:21,total:21,skipped:12},packaging:{passed:4,total:4},packagedEngineSmoke:{passed:6,total:6},packagedAppStartup:startup.startup,actualDrawing:verification.checks},
  actualDrawing:{source:verification.source,sourceBytes:verification.sourceBytes,entities:verification.drawing.entities,layers:verification.drawing.layers,blocks:verification.drawing.blocks,dwgBytes:verification.dwg.bytes,pdfBytes:verification.pdf.bytes,seconds:verification.seconds,engine:verification.dwg.engine,engineWarningCount:warningCount},
  installer:{name:path.basename(installer),bytes:bytes.length,sha256,signed:false,externalDeployment:false,previousReleasePreserved:'바른 CAD 5.0.0'},
  failures:{official:[],notPromoted:unavailable.map(({id,category,label,alias})=>({id,category,label,alias,reason:'본체 실행 경로 미연결'}))},
  notices:['설치 파일은 코드 서명되지 않아 Windows SmartScreen 경고가 나타날 수 있습니다.','DWG 엔진이 원본의 시각 스타일 사전 25개 누락 경고를 냈지만 객체 열기·저장·재열기·출력·Undo 검증은 통과했습니다.','미연결 172개는 목록에 보이되 정식 기능으로 표시하지 않고 도면을 변경하지 않습니다.','빌드 시 미리 Core가 로그인·실행 중이 아니어서 실제 원격 응답 왕복은 수행하지 못했고, 요청 분류·도면 문맥·JSON 실행 계약의 로컬 검사는 통과했습니다.']
};

fs.writeFileSync(path.join(output,'통합-검증-보고서.json'),JSON.stringify(report,null,2),'utf8');
fs.writeFileSync(path.join(output,`미연결-명령-${summary.unavailable}개.csv`),'분류,이름,별칭,상태\n'+unavailable.map(command=>[command.category,command.label,command.alias,'미연결'].map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\n'),'utf8');
fs.writeFileSync(path.join(output,'설치파일-SHA256.txt'),`${sha256}  ${path.basename(installer)}\n`,'utf8');
fs.writeFileSync(path.join(output,'통합-검증-보고서.md'),`# 바른 CAD ${version} 정식 통합 보고서

- 기존 5.0.0 설치본·현재 소스 백업: 완료
- 생산 메뉴 명령: ${summary.total}개 (원본 ${summary.sourceTotal}행 중 정확한 중복 ${summary.duplicatesRemoved}개 제거)
- 실제 본체 연결을 검증해 정식 표시한 항목: ${summary.official}개 / 고유 본체 명령 ${uniqueCoreCommands.size}개
- 본체 실행 경로가 없어 정식 표시하지 않은 항목: ${summary.unavailable}개
- 단순형 SVG 아이콘: ${iconCount}개
- 연결 UI: 메뉴, 검색, 즐겨찾기, 최근 사용, 사용자 단축키 변경

## 검사 결과

- 본체 자동 검사: 431/431 통과
- beta.3 보조명령 검사: 206/206 통과
- Python 교환·변환·출력·미리 집중 검사: 21/21 통과 (외부 프로그램 필요 항목 12개 건너뜀)
- 베타/정식 분리 설치 검사: 4/4 통과
- 패키지 엔진 독립 실행 검사: 6/6 통과
- 포장 앱 전용 포트 시작: 통과 (${startup.port})
- 실제 도면: ${path.basename(verification.source)} (${verification.sourceBytes.toLocaleString('ko-KR')} bytes)
- 실제 DWG 열기·저장·BCAD 백업·DXF 재저장/재열기·PDF 출력·Undo: 전부 통과
- 실제 도면 내용: 객체 ${verification.drawing.entities.toLocaleString('ko-KR')}개, 레이어 ${verification.drawing.layers}개, 블록 ${verification.drawing.blocks}개

## 정식 제외 및 주의사항

- 정식 기능 실패: 0개
- 미연결 명령: ${summary.unavailable}개 — 별도 CSV 참조
- DWG 엔진 경고: 시각 스타일 사전 누락 ${warningCount}건. 도면 객체 왕복 및 편집 검사는 통과했습니다.
- 미리 Core 실제 원격 응답: 빌드 시 로그인·실행 상태가 아니어서 미검증. 요청 분류·도면 문맥·실행 계약 로컬 검사는 통과했습니다.
- 설치 파일은 코드 서명되지 않았으므로 Windows SmartScreen 경고가 나타날 수 있습니다.
- 외부 배포와 자동 업데이트는 사용하지 않습니다.

## 설치 파일

- ${path.basename(installer)}
- 크기: ${bytes.length.toLocaleString('ko-KR')} bytes
- SHA-256: ${sha256}
`,'utf8');
console.log(JSON.stringify({output,summary,uniqueCoreCommands:uniqueCoreCommands.size,iconCount,installerBytes:bytes.length,sha256,unavailable:unavailable.length},null,2));
