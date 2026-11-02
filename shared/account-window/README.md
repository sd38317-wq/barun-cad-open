# 공통 계정 및 업데이트 창 (SharedAccountWindow) r3

바른문서·바른CAD·바른디자인·미리가 **똑같은 창**을 쓰기 위한 부품. 이 폴더를 통째로 복사해서 쓰고, 안의 파일은 앱마다 고치지 않는다.
바꿀 일이 생기면 여기(중앙 판)를 고치고 `rendererVersion`을 올린 뒤 네 앱에 같은 판을 다시 복사한다.

## 들어 있는 것
- `contract/` — 계약 v2 원본 그대로(해시는 `manifest.json`, `model.mjs`에 고정). 파일이 다르면 창이 열리지 않는다.
- `model.mjs` — 상태 → 화면 값 규칙(DOM 없음). `enabledWhen`은 코드 표로만 해석한다(eval 없음).
- `renderer.mjs` — 창 그리기. `account-window.css` — 모양(값은 계약 JSON에서 변수로 들어옴).
- `icons.mjs` — 일반 선 아이콘. 앱 아이콘·카카오 심볼은 공식 파일만 쓴다.
- `shared-assets/kakao-symbol-approved.svg` — 카카오 공식 말풍선 심볼(공식 리소스 원본은 `shared-assets/kakao-official/`, 출처는 `shared-assets/PROVENANCE.json`).

## 앱에서 쓰는 법
```js
import { createAccountWindow } from './shared/account-window/renderer.mjs';
const win = await createAccountWindow({ dialog: document.querySelector('dialog#account'), adapter });
headerButton.onclick = () => win.open(headerButton);
```
`<dialog>`는 비어 있어도 된다. CSS는 부품이 스스로 불러온다(CSP `style-src 'self'`, `script-src 'self'`에서 동작).

## adapter 규격 (앱이 만드는 부분은 이것뿐)
```js
{
  app: { appId, displayName, officialIconAsset /* 공식 아이콘 URL */, installedVersion /* 실행 중인 앱의 판 */ },
  getState: async () => ({
    session: { state /* signed_out|authenticating|connected|expired|offline|error|locally_disconnected */, displayName },
    wallet:  { state /* unknown|loading|ready|error */, balance },
    ai: { activeMode /* managed|personal */, modes: { managed: {…}, personal: { state, configured, providerDisplayName, actualModelId, selectedModelId, billingSource } } },
    update: { state /* idle|checking|up_to_date|available|error */, phase /* downloading|downloaded|installing|null */, verified, nextVersion, percent, message, releaseNotes },
  }),
  subscribe: (fn) => unsubscribe,
  actions: { 'auth.login': async (ctx) => '알림 문구', … },   // 계약의 action id만. 없는 것은 자동으로 꺼짐
  updateExtensions: [ … ],       // 선택. 계약에 없는 기존 업데이트 기능 보존용(예: 받은 업데이트 설치)
  aiExtensions: [ … ],           // 선택. 계약에 없는 AI 자세히 칸 단추(예: 바른문서 Codex 로그인·로그아웃). 모양은 updateExtensions와 같다
}
```
- `ctx.trusted`는 사람이 실제로 누른 클릭인지 알려준다. 로그인처럼 사람만 시작해야 하는 동작은 이것을 확인한다.
- 모르는 값은 비워서 넘긴다. 코인 0·모델 이름을 추측해서 채우지 않는다.
- 토큰·이메일·문서 내용은 넘기지 않는다.

## 아직 없는 것 (다음 단계)
- Pretendard 글꼴 묶음
- SSO broker(미리 없이 앱 간 로그인 공유), 자가 복구의 고치기 단계(현재는 읽기 전용 진단)
- 계약 v2에 `update.install`(받은 업데이트 설치)이 없어 adapter 확장으로 보존 중 — 중앙 계약 v2.1에 넣자고 제안

## r3 (2026-09-26, 사용자 결정)
- 카카오 버튼 문구를 카카오 공식 표기 "카카오 로그인"으로(계약 account-window.json, 해시 갱신).
- 바른 CAD 앱 정보: 표시 이름 "바른 CAD", 공식 아이콘 barun-cad-brand.png.
- 카카오 심볼은 공식 파일의 말풍선을 잘라 쓴 현재 파일 유지(사용자 확인).

## r2.1.0-r1 (2026-09-29, 대표 승인 시안 — "창이 너무 크고 한눈에 안 들어온다")
- `popover.mjs` + `account-popover.css` + `popover-model.mjs` 추가: 제목줄 계정 단추 바로 아래 약 410px 팝오버(꼬리·둥근 18px·유리/효과 줄이기 대응).
  한 줄에 하나씩(보유 코인·AI·업데이트·자가 복구), 자세한 내용은 ›로 그 줄 아래에만 펼침(한 번에 한 줄). 바닥: 계정 관리 · 사용 내역 · 로그아웃(로그인했을 때만).
- 계약(contract/)·상태 규칙(model.mjs)·adapter 규격은 그대로. adapter에 선택 항목 `setAiMode(mode)`(고른 AI 방식 저장)가 더해졌다.
- adapter 선택 항목 `aiExtensions`: `{ id, label, style, visible(state), enabled(state), run(ctx) }` 목록을 AI 자세히 칸 단추 줄 앞에 그린다(렌더마다 visible·enabled 다시 계산, `data-aw-action`=id). AI 줄에서 이미 고른 방식을 다시 누르거나 상태 글을 누르면 자세히 칸이 펼쳐진다.
- 사용: `const pop = await createAccountPopover({ mount: document.getElementById('account-popover') /* popover="manual" 빈 div */, adapter }); button.onclick = () => pop.toggle(button);`
- 큰 창(`renderer.mjs`·`account-window.css`)은 다른 앱이 아직 쓰므로 부품에 남긴다. 바른문서는 팝오버만 쓴다.
