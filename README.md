# 바른 CAD (공개판)

건축사가 쓰는 Windows·Mac CAD입니다. DXF·DWG·BCAD 도면을 열고 그리고 고치고 출력합니다.
무료로 쓰고, 건축사들이 함께 고쳐 나가는 것을 목표로 합니다.

## 이 저장소에 들어 있는 것

- 도면 화면·편집 명령·GPU 그리기 (JavaScript)
- 로컬 엔진 (Python, `server.py`)
- DWG 변환기 소스 (`converter/` C#, `converter-rs/` Rust)
- 데스크톱 셸 (Electron)과 빌드 스크립트

## 들어 있지 않은 것

건축 상세 자료, 건축 리습 명령 묶음, 법규·지식 데이터, 서버 계산(구조·창호·도면 읽기),
도면 생성기는 바른 서버에서만 제공합니다. 공개판에서는 이 기능들이 "로그인 후 사용" 안내만 보이고,
기본 CAD 기능은 그대로 동작합니다.

## 실행

```
pip install -r requirements.txt
npm ci
python server.py
```

브라우저에서 `http://127.0.0.1:8765` 를 엽니다. 데스크톱 창은 `npm run desktop`.

DWG 열기에는 변환기가 필요합니다. `converter/`(dotnet) 또는 `converter-rs/`(cargo)로 빌드해
`dwg-runtime/`·`acadrust-runtime/` 에 둡니다.

## 라이선스

GPL-3.0-or-later (`LICENSE`). 남의 부품과 그 라이선스는 `THIRD_PARTY_NOTICES.md` 에 있습니다.
명령 설명은 `사용법.md`.

## 시험

`npm test`(JS)는 공개판에서 돌도록 맞춰 두었습니다. 파이썬 시험(`pytest`) 중 DWG 변환기 실행 파일,
서버 전용 자료, 동봉 리습이 있어야 하는 것은 공개판에서 실패합니다.
