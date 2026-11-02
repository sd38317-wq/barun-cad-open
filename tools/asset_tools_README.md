# CAD 자산 묶음과 표식 기준 구현

입력과 원본 라이브러리는 읽기만 한다. 서버 호출, 업로드, 설치 파일 생성, 배포는 하지 않는다.

## 실행

저장소 루트에서:

~~~powershell
python tools/asset_pack.py --kinds detail unit jutong
python tools/asset_pack.py --kinds detail --output tmp/cad-assets
python tools/asset_wm.py --vectors tools/asset_wm_vectors.json
python tools/asset_wm_detect.py suspect.dxf --asset tmp/cad-assets/detail/ACCESS-07.json.gz
python tools/asset_wm_detect.py suspect.dxf --kind detail --id ACCESS-07 --asset-dir tmp/cad-assets
python -m pytest test_asset_pack.py
~~~

기본 입력은 D:/어플/캐드/tmp/details-v2 및 D:/어플/캐드/tools/details_v2/recipes,
기본 출력은 D:/어플/캐드/tmp/cad-assets다. --dxf-dir/--recipes-dir/--version으로 지정 가능하다.
상세 ID는 레시피 파일 stem이며, same_as 레시피는 건너뛴다. 대표 ids는 원문 그대로 보존한다.
동평면·주동은 기존 라이브러리 API가 실제 mm 기하로 승인한 항목만 묶는다. 확인이 필요한
항목의 제외 사유는 CLI 결과 skipped에 나온다. --kinds 일부만 재생성해도 다른 kind 목록은 유지한다.
선택한 kind의 오래된 파일이 남으면 성공으로 처리하지 않고 새 출력 디렉터리를 요구한다.

Python/ezdxf는 기존 프로그램 의존성을 쓴다. 찾기 도구는 선택 의존성 NumPy/SciPy가 추가로
필요하며 tools/asset_wm_requirements.txt는 이 작업에서 확인한 버전을 기록한다.
프로그램 시작 경로에는 이 도구나 추가 의존성을 연결하지 않는다.

## 서버와 공유하는 정확한 규칙

- format은 barun-asset/1. 장면·객체·점 순서를 보존하며 블록은 묶기 전에 실제 기하로 전개한다.
- 엔진 필드 line.points[0], line.points[1]는 지시서의 start,end와 같다. text.position은 insert와 같다.
  기준 구현은 지시서 필드 start/end/insert도 받는다. 점은 x,y 객체 또는 XY 배열이다.
- 대상은 line, polyline/lwpolyline, arc/circle center, text position/insert뿐이다.
  dimension 정의점, 해치, 타원, 점 객체, 블록 껍데기에는 싣지 않는다.
- wm_points는 스칼라 좌표 수다. XY 점 하나당 두 개. 장면마다 번호를 재시작하지 않는다.
- HMAC-SHA256의 키는 비밀 UTF-8, 메시지는 계정 ID UTF-8만 사용한다. 첫 6바이트가 태그다.
- **작업지시서에서 생략된 비트 방향은 첫 바이트부터 MSB 우선으로 명시한다.**
  48비트 정수의 최상위 비트가 T[0]. k번째 스칼라 좌표에는 T[k % 48].
- 비트 1이면 +0.004 mm, 0이면 -0.004 mm. 반지름·높이·치수 관련 값은 그대로다.
- 첫 객체 xdata.BARUN_WM은 [barun-asset/1, kind, id, 12자리 소문자 tagHex].
- test-secret / acct-1의 태그는 f1800a8f17ad. tools/asset_wm_vectors.json에
  원본·전체 결과·좌표 순서·64개 좌표·48개 비트를 담아 TypeScript 시험에서 비교할 수 있다.
- embed는 원본을 복사한다. 같은 원본/태그의 결과는 결정적이다. 이미 표식을 넣은 결과에
  embed를 다시 적용하면 좌표가 또 이동하므로 항상 표식 없는 원본에 적용한다.

묶음에 원본 DXF 보존 데이터나 제목을 넣지 않는다. 레이어 ID를 안정적인 이름으로 바꾸고
객체에 실제 색·선굵기·선종류를 보존한다. 글꼴 resource 필드는 보존한다.
객체 ID는 kind/자산 ID/장면 번호/객체 순번으로 만들어 여러 장면에서 중복되지 않는다.
장면의 bounds는 제목을 뺀 엔진 객체를 기존 DXF writer로 변환한 뒤 실제 기하에서 계산한다.
NTS는 레시피의 렌더링 축척을 보존한다. 2/1은 scale=0.5다.

## 찾기 결과

탐지는 native DXF를 직접 읽는다. 저장된 CAD 메타데이터·XDATA만으로 태그를 단정하지 않는다.
이동·평면 회전·양의 균일 배율, 중첩 INSERT, 폴리선 분해, 복사와 일부 추가 선을 처리한다.
태그는 좌표 잔차의 부호 다수결로 읽고, 48개 비트별 표수와 신뢰도를 함께 출력한다.
장면 하나만 넣은 경우도 정합하며, scalar_offset은 앞 장면을 포함한 원본 전체 좌표
순번이다. matched_scene은 찾은 장면 번호다. 원·호 중심이 겹치면 불변 반지름과
호의 각도 범위도 비교한다. 일부 비트에 표가 하나뿐인 경우 신뢰도가 낮아진다.
서명은 좌표로 읽은 태그를 뒷받침하는 보조 증거다. 계정 조회·네트워크 요청은 하지 않는다.
확정 태그 CLI 종료 코드는 0, 불충분/모호는 1, 입력·의존성 오류는 2다.

반사·비균일 배율·과도한 편집·반복/겹친 기하에서는 미확정일 수 있다. 각 축의 비트가 모두
같은 극단적인 태그는 단순 이동과 구별할 수 없다. 서로 다른 태그의 복사본이 섞이면
후보 태그와 모호성을 보고한다. 이 규칙은 원본 기하를 모르는 사람의 임의 편집까지 막는
암호화 보호 장치가 아니라, 원본과 비교해 계정 표식을 조사하는 도구다.
