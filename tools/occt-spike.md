# 바른 CAD OCCT 시범 결과

2026-10-13(KST). 설치된 `replicad-opencascadejs@1.1.0`으로 실제 사리로 모델 검증을 완료했다.
엔진을 다시 다운로드하거나 설치하지 않았다. 이 결과는 독립 시범 모듈의 결과이며 제품 UI 연결·설치판 검증·배포는 수행하지 않았다.

## 결과와 변경 파일

- `occt-section.js`: 반공간으로 잘린 솔리드의 평면·와이어별로 절단선과 닫힌 해치 경계를 함께 추출한다.
- `occt-kernel.js`: 새로 사용하는 BRepAdaptor_Surface/BRepTools 바인딩 확인을 추가했다.
- `occt-spike.test.js`: 기존 검증을 유지하고 실제 단면 면적·구멍·폐합 모서리를 강화했다. 접점 공유, 슬래브 구멍, 거의 평행한 면, 경계면 일치·외부 절단 회귀시험 4개를 추가했다.
- `tools/occt-bench.mjs`: 설치된 두 WASM의 원본/gzip 크기, Worker JS/WASM 메모리 및 앱 시작 경로 검사 결과를 표에 기록한다. 기하 연산 뒤에 출력·압축을 수행한다.
- `tools/occt-spike.md`: 이 결과 보고서.

다른 실행 모듈은 유지했다. loader는 요청 시에만 동적 import/초기화하며 동시 요청 공유·실패 재시도를 지원한다.
client/worker는 Node worker_threads와 브라우저 module Worker를 사용하고 모델을 Worker에 캐시한다.
RPC는 직렬화하며 dispose는 B-rep, terminate는 Worker와 WASM 힙을 정리한다.

## 단면 경계 실패 원인과 해결

기존 BRepAlgoAPI_Section의 모서리 결과에는 절단 평면과 겹친 원본 문·창 주변 면의 선도 포함됐다.
y=5500 단면은 44개 모서리와 차수 3인 접점 8개를 반환해, 전체 선 그래프를 한 번에 잇는 방식이 분기 오류를 냈다.
실제 반공간 절단 결과의 평면은 38개 모서리로 폐합되며, 외곽 1개와 내부 구멍 2개를 갖는다.

현재는 잘린 솔리드에서 요청 평면과 일치하는 평면을 고르고, 각 면의 와이어를 따로 검증한다.
BRepTools.OuterWire로 외곽을 식별하고 내부 와이어를 구멍으로 보존한다. 서로 꼭짓점만 접하는 면도 각각 닫힌 경계를 반환한다.
외곽은 반시계, 구멍은 시계 방향이다. 화면 절단선도 동일한 와이어에서 나오므로 가짜 연결선을 추가하지 않는다.

평면의 법선·원점만 비교하면 거의 평행한 원본 면도 통과할 수 있어, 모든 꼭짓점의 절단 평면 거리를 0.000001mm 이하로 확인한다.
기존 끝점 이어붙이기 허용오차 0.01mm는 키우지 않았다. 열린/분기한 와이어는 계속 오류를 낸다.
사리로 해치 순면적 **8,720,000mm²**는 원모델의 x/z 사각형 합집합에서 해당 개구부를 뺀 독립 계산과 일치했다.
대각 단면도 실제 구멍 6개와 모든 경계 모서리를 검사한다.

## 실측

Node v22.23.2 / Windows x64. 성공한 측정 1회: **2026-10-12T15:35:48.031Z**.
사리로 입력은 솔리드 21개(벽 18·슬래브 3), 개구부 24개, 지원 밖 요소 14개다.
범위는 x=700~11900, y=2500~8500, z=-200~6000mm다.

| WASM | 원본(B) | gzip level 9(B) | 원본(MiB) | gzip(MiB) |
|---|---:|---:|---:|---:|
| replicad_single.wasm (사용) | 22980267 | 7250252 | 21.9 | 6.9 |
| replicad_multi.wasm (미사용) | 22481415 | 7244963 | 21.4 | 6.9 |

| 항목 | 시간(ms) | RSS(MiB) | Worker JS heap(MiB) | WASM heap(MiB) |
|---|---:|---:|---:|---:|
| Worker 첫 로딩 | 298.2 | 174.9 | 25.3 | 100.0 |
| 솔리드 생성 | 1298.0 | 203.0 | 31.9 | 100.0 |
| 평면 절단 (+1.2m) | 193.6 | 224.6 | 22.0 | 100.0 |
| 세로 단면 (y=5500) | 41.0 | 221.6 | 26.7 | 100.0 |
| 남측 입면 HLR | 17.2 | 234.3 | 31.8 | 100.0 |
| STEP (전체) | 140.4 | 294.7 | 32.4 | 100.0 |

엔진 자체 초기화는 **240.1ms**, 단일 JS glue 파일은 **60,124B**다.
시간은 로컬 Worker RPC 포함, 도면 출력과 압축 제외다. OS 파일 캐시를 통제하지 않았으며 브라우저 전송 시간은 아니다.
RSS는 부모를 포함한 프로세스 전체이고 단계 완료 직후 값이며 최고값이 아니다. JS heap은 Worker만, WASM은 확보된 linear memory다.
gzip은 level 9 오프라인 계산값이며 실제 전송에 쓰려면 서버 압축 설정이 필요하다. multi 바이너리는 크기만 측정하고 로딩하지 않았다.

모델 dispose 뒤 캐시 모델 수는 0이나 WASM 힙은 100MiB를 유지한다. Worker terminate 직후 프로세스 RSS는 149.4MiB였다.
수치와 메모리 전후 값은 [bench.json](../tmp/occt-spike/bench.json), 표는 [bench.md](../tmp/occt-spike/bench.md)에 있다.

## 실제 산출물과 PNG 육안 검증

벤치마크가 `writeOcctArtifacts`를 호출해 아래 실제 모델 결과를 생성했다.

| 결과 | PNG | DXF | 선 개수 | 해치 면 경계 |
|---|---|---|---:|---:|
| 1층 +1.2m 평면 | [sariro-plan.png](../tmp/occt-spike/sariro-plan.png) | [sariro-plan.dxf](../tmp/occt-spike/sariro-plan.dxf) | 153 | 5 |
| y=5500 세로 단면 | [sariro-section.png](../tmp/occt-spike/sariro-section.png) | [sariro-section.dxf](../tmp/occt-spike/sariro-section.dxf) | 106 | 1 |
| 남측 입면 HLR | [sariro-elevation.png](../tmp/occt-spike/sariro-elevation.png) | [sariro-elevation.dxf](../tmp/occt-spike/sariro-elevation.dxf) | 58 | 0 |

전체 모델 STEP: [sariro-building.step](../tmp/occt-spike/sariro-building.step), **721,927B**, MANIFOLD_SOLID_BREP 21개.
각 도면의 전체 CAD 문서와 해치 경계는 같은 이름의 JSON에 보존했다. 숨은 선은 `*-hidden.dxf/png`에 별도로 생성했다.
DXF의 엔티티 수와 JSON의 선 개수가 일치하고, DXF 그룹코드/EOF와 STEP B-rep/종료 표식을 확인했다.

PNG 3장을 실제로 열어 다음 내용을 확인했다.

- 평면: 외벽·내벽 두께와 접합, 문·낮은 창의 절단 틈, 절단면 아래 보이는 얇은 선이 표현된다. 높은 욕실 창 밑 벽은 이어진다.
- 세로 단면: -200~0/2800~3000/5800~6000mm 슬래브와 층별 벽이 이어지고, 문·창 절단 틈과 너머의 개구부가 구별된다.
- 남측 입면: 2개 층과 상층 후퇴 형상, 문·창의 위치·높이가 맞는다. 개구부를 통해 보이는 내부 모서리는 HLR 결과다.

눈으로 확인한 벽·슬래브·개구부에 이상을 발견하지 않았다. 창틀·문짝·계단·메타데이터 난간은 지원 범위 밖으로 생략된다.
PNG/DXF는 선도이며 해치 경계를 실제 HATCH 채움으로 내보내지는 않는다. 경계 데이터는 JSON의 outer/holes 배열에 있다.

## 시험

- `node --test occt-contract.test.js occt-spike.test.js`: **24 통과 / 0 실패 / 0 건너뜀**(계약 12, 실제 OCCT 12).
- `npm test`: **8,295 통과 / 2 실패 / 2 건너뜀**, 전체 8,299개, 95,975.2ms, 종료 코드 1.
- 기존 실패 2개는 `design-cases.test.js`가 읽는 `data/aihub-71465/full-catalog/engine-test-editable.json`과 `engine-test-reference.json`의 ENOENT다. 예제 자료를 만들거나 시험을 건너뛰도록 바꾸지 않았다.
- npm의 기존 스크립트는 OCCT 시험을 포함하지 않아 위 두 시험 결과는 별도로 보고했다. package.json은 수정하지 않았다.
- 10개 실행/시험 파일의 `node --check` 통과.
- 독립 reviewer가 구멍·접점·일치/외부 절단·소유권을 실제 OCCT로 확인했다. 거의 평행한 면 중복 오류 1건을 발견했고, 수정 뒤 재현 6종 및 23개 당시 시험을 통과했다. primary가 마지막 경계면 시험을 추가한 뒤 24개를 확인했다.

로그: [occt-tests.log](../tmp/occt-spike/occt-tests.log), [npm-test-after.log](../tmp/occt-spike/npm-test-after.log),
[tests-summary.json](../tmp/occt-spike/tests-summary.json), [bench.log](../tmp/occt-spike/bench.log).
이전 로그와 합성 도형은 이전 시범의 자료로 남겨 두었으며 이번 산출물은 `sariro-*`다.

## CAD 적용 권장과 남은 문제

**건축 평면·단면·입면 및 STEP 명령에 요청 시 지연 로딩하는 Worker 방식으로 적용을 권장한다.**
첫 요청에 로딩+솔리드 생성 약 1.6초가 걸리므로 진행 표시를 제공하고, 이후 같은 모델을 캐시해 단면·입면을 재사용한다.
유휴/모델 종료 시 Worker를 terminate해 WASM 예약 메모리를 반환한다. UI 스레드에서 동기 OCCT 연산을 실행하지 않는다.

시작 경로는 index.html/app.js와 desktop.cjs의 정적·문자열 동적 로컬 의존성을 추적했다.
253개 경로 중 기존 소스 **252개**를 읽었고 OCCT 참조는 **0개**다. 나머지 vendor/electron-updater.cjs는 원래 catch/fallback하는 선택 경로다.
계약 시험에서도 첫 요청 전에 Worker 생성·엔진 초기화가 **0회**임을 확인했다.
따라서 현재 앱 시작 시 **OCCT로 인한 추가 작업은 0**이다. 앱 전체 시작 시간을 실행해 0ms 차이로 측정한 것은 아니다.

제품 연결 전에 남은 검증/작업은 다음과 같다.

- 실제 브라우저/Electron에서 HTTP/file WASM 로딩, MIME·정적 허용목록, Worker 오류/취소와 유휴 종료를 검증한다. 현재 Electron 분기 검사는 mock 계약이며 실제 GUI 실행은 하지 않았다.
- server.py의 명시적 정적 허용목록과 자산 경로, 제품 자산 목록, UI/명령 연결은 아직 반영하지 않았다. 이번 작업에서 제품 빌드·설치·배포는 하지 않았다.
- 곡선 벽·곡면, 창틀·문짝, 복합 마감/단열, 계단, 경사지붕·난간, 전역 좌표 변환과 대형 모델·반복 연산 메모리를 추가 검증한다. 현재 생성 입력은 직선 벽과 다각형 슬래브다.
- DXF HATCH 채움은 별도 연결이 필요하며 현재 닫힌 경계 JSON을 사용한다.
- 설치본 package.json의 라이선스 표시는 LGPL-2.1-only다. LICENSE와 잠금 파일이 로컬에 있으며 제품 포함 전 고지·소스 제공 준비는 [기존 고지문](../vendor/occt-pkg/NOTICE.md)을 참고한다. 이번 작업은 법률 검토를 수행하지 않았다.

재현 명령(설치 불필요):

```powershell
node --test occt-contract.test.js occt-spike.test.js
node tools/occt-bench.mjs
npm test
```

Worker 호출 예:

```js
import {createOcctClient} from './occt-client.js';
const client=createOcctClient(); // 첫 요청 전 Worker/WASM 로딩 없음
try {
  const {handle}=await client.build(model);
  const plan=await client.plan(handle,{story:'s1'});
  const section=await client.section(handle,{start:[0,5500],end:[13000,5500]});
  const elevation=await client.elevation(handle,{direction:[0,-1,0]});
  const step=await client.step(handle);
  await client.dispose(handle);
}finally{await client.terminate();}
```

## 실행 기록

주 담당: GPT-6 기반 Codex(세부 모델 ID 확인 불가).
도구: 로컬 Node REPL/fs/child_process, rg, node --test/npm test, node --check, view_image.
기본 exec_command는 환경 프로세스 생성 오류로 작동하지 않아 로컬 Node 도구로 이어서 실행했다.
LM Studio 로컬 모델은 호출하지 않았다.

| 에이전트 | 설정 모델 | 담당 | 결과 |
|---|---|---|---|
| occt_review | reviewer / gpt-6-astra | 독립 단면·경계·소유권 검토(읽기 전용) | 평행면 중복 1건 발견, 수정 후 재현 6종 정상·당시 23개 시험 통과, 추가 결함 없음 |

이번 실행의 하위 에이전트는 위 1개뿐이다. 이전 시범의 위임 기록을 이번 모델 사용으로 계산하지 않았다.
git 쓰기, 공유 node_modules 변경, 엔진 다운로드/설치, 제품 빌드·설치판 생성·배포는 하지 않았다.
