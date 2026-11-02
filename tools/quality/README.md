# 로컬 도면 자동 검사

사용자 지정 역할(2026-09-27): 로컬 LLM은 필요한 경우 수집 보조만 담당하고, 결과 해석과 원인 분석은 Astra가 담당한다. 파일 열기와 명령 실행 및 로그 수집은 아래 Python/Electron 도구가 실제로 수행한다. 모델이 직접 GUI를 조작한 것으로 보고하지 않는다. 수집 종료 후 로컬 LLM 분석을 자동 호출하지 않는다.

## 실행

프로젝트 루트에서:

```powershell
python tools/quality/inspect-batch.py --root '<검사할 폴더>' --out tools/quality/runs/<새 이름> --inventory-only
python tools/quality/inspect-drawing.py --file '<도면.dwg>' --out tools/quality/runs/<새 사례 이름> --compact
```

`inspect-batch.py`의 `--inventory-only`를 제거하면 지정한 폴더의 모든 DWG/DXF/BCAD를 순차 검사한다. 대량 실행 전 목록 수와 디스크 용량을 확인해야 한다. 현재 일괄 실행은 중복 내용 제거/재개를 지원하지 않는다. 대규모 실사용 큐로 사용하기 전 이 기능이 필요하다.

## 원본과 개인정보

- 원본을 읽고 실행 전후 SHA256을 비교한다. 편집은 격리된 앱의 메모리에서만 한다.
- 기존 실행 중인 CAD와 다른 프로필을 사용하고, 저장/API POST 및 외부 네트워크를 제공하지 않는다.
- `.private.json`, `.private.log`, `prepared.json`, 앱 프로필은 로컬 전용이다. 원본 경로 또는 도면 내용이 포함될 수 있다. 모델이나 외부 서버에 전달하지 않는다.
- `--compact`는 결과를 기록한 뒤 해당 새 사례 폴더 내부의 생성된 도면 사본/캐시만 정리한다. 결과와 개인용 원본 경로 매핑은 보관한다.
- 도구가 생성한 프로세스만 제한 시간 초과 시 종료한다. 기존 CAD 창은 종료하지 않는다.

## 검사 범위와 판정

- 실제 가져오기 → 숨겨진 CAD 창에서 로딩 → PAN/ZOOM/SELECT 합성 이벤트 → 임시 LINE으로 편집 명령 검사 → 원래 객체 수 확인 → 시험 창 종료.
- LINE/MOVE/COPY/ROTATE/SCALE/OFFSET/TRIM/EXTEND/ERASE/UNDO/REDO는 앱 명령 API를 사용한다. 모든 원본 객체 종류를 편집하는 검사는 아니다.
- SNAP은 예외 없는 실행만 확인한다. 기하학적 정확성, 참조 이미지 비교, 일반 저장/닫기 대화상자, 실제 마우스 체감 반응, 표시 FPS는 미검증이다.
- `status: completed`는 검사 실행 및 현재 assertion 완료이다. 미검증 항목까지 통과했다는 의미가 아니다.
- `scenarioMs`는 assertion/문서 복제 비용을 포함한다. 순수 명령 시간이나 실제 사용자 입력 지연으로 해석하지 않는다. `gpu.buildMs`는 별도 GPU 장면 구성 측정이다.
- 가져오기 180초, 렌더러 내부 120초, 외부 렌더러 프로세스 135초 제한. 준비 JSON이 200 MB를 넘으면 `blocked`로 남긴다.
- `--profile-open`은 별도 진단 실행이다. 렌더러 예산은 60초이며 CPU 프로필은 로컬 전용 `cpu.private.json`으로 기록한다. 일반 120초 기능 검사 결과와 섞어 집계하지 않는다.
- 실패 최초 단계·정제한 코드 위치와 정리 오류를 구분하며, 선행 fixture 생성 실패 시 의존 검사는 건너뛴다. 시간 초과 때도 마지막 검사 위치와 부분 결과를 보존한다.

## 2026-09-27 실행 기록

- 설치된 `qwen3-coder-30b-a3b-instruct`를 실제 호출하여 계획과 첫 실측 분석을 각각 받았다.
- `local-cad-inspection-plan.txt`, `local-cad-measured-report.txt`는 모델 원문이다. 검증된 결론은 `docs/local-drawing-inspection-2026-09-27.md`를 따른다.
- 모델 원문의 “GPU 성능 정상”, “GPU 빌드 시간은 렌더링 성능과 직접적인 연관 없음”은 근거 없는 표현이므로 채택하지 않는다.
- 모델은 호출 후 언로드했다. 별도 클라우드 하위 에이전트는 사용하지 않았다.
