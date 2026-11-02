# 바른 CAD를 AI(Claude·Codex)에 연결하기 — Barun CAD MCP setup

이 파일은 사용자가 AI에게 "바른 CAD MCP 연결해 줘"라고 했을 때 AI가 읽고 그대로 따라 하라고 둔 안내입니다.
This file tells an AI agent how to connect Barun CAD as an MCP server (stdio). Follow it as written.

## 1. 한 줄로 연결 (권장)

바른 CAD 설치 폴더의 엔진 실행 파일이 직접 설정을 넣습니다. 바른 CAD 항목(`barun-cad`)만 바꾸고 다른 설정은 그대로 두며, 바꾸기 전에 설정 파일 옆에 백업(`*.barun-backup-날짜`)을 남깁니다.

Windows (기본 설치 위치):

```
"C:\Program Files\Barun\Barun CAD 6\resources\backend\barun-cad-6-server.exe" --register-mcp codex
"C:\Program Files\Barun\Barun CAD 6\resources\backend\barun-cad-6-server.exe" --register-mcp claude
```

Mac:

```
"/Applications/Barun CAD 6.app/Contents/Resources/backend/barun-cad-6-server" --register-mcp codex
```

- `claude` 는 이 PC의 Claude 데스크톱 앱과 Claude Code 둘 다(깔린 것만) 등록합니다. `codex` 는 Codex 앱·CLI 공통 설정(`~/.codex/config.toml`)에 넣습니다.
- 결과는 JSON 한 줄입니다. `ok: true` 면 성공, `message` 를 사용자에게 그대로 전하세요.
- 지금 상태 확인: `--mcp-status` (각 AI 앱이 `ok`(이 CAD를 가리킴) / `other`(다른 경로) / `missing`).
- 사용자가 직접 하려면: 바른 CAD 오른쪽 위 계정 창 → AI → **[Claude에 연결]** 또는 **[Codex에 연결]**.

설치 위치를 바꿨다면 `barun-cad-6-server.exe` 를 찾아 그 경로로 실행하세요. 개발 폴더의 `mcp_server.py` 는 쓰지 마세요(설치판과 도구 목록이 다를 수 있음).

## 2. 연결한 뒤

1. AI 프로그램(Claude·Codex)을 **완전히 껐다가 다시 켭니다.** 그래야 새 MCP 서버를 읽습니다.
2. 바른 CAD를 켜고 도면 창을 하나 엽니다.
3. 바른 CAD에서 **[계정 연결]로 로그인**합니다. 로그인하지 않으면 AI 도구는 모두 거절됩니다(`not_logged_in`).
4. AI에게 "바른 CAD 도면 읽어 줘"라고 말해 확인합니다(도구 `cad_get_document`).
5. 처음 한 번은 바른 CAD 화면에 **"Codex(또는 Claude)가 이 CAD를 쓰려고 합니다 [허락] [거절]"** 창이 뜹니다. 사용자가 **[허락]**을 눌러야 도구가 동작합니다(읽기 도구도 포함). [Claude에 연결]·[Codex에 연결] 단추로 등록해도 이 허락은 따로 한 번 받습니다.
   - 허락은 서명한 회사(Anthropic·OpenAI)와 프로그램 이름으로 기억해, AI 프로그램을 업데이트해도 다시 묻지 않습니다. 서명 없는 프로그램은 파일이 바뀌면 다시 묻습니다. python·node·powershell 처럼 아무 스크립트나 돌리는 프로그램은 기억하지 않고 연결할 때마다 묻습니다.
   - 허락·거절 목록과 취소: 계정 창 → AI → **[허락한 AI 관리]**.
   - 연결 파일(`%LOCALAPPDATA%\BarunCAD\connection-*.json`)의 토큰만으로는 CAD를 조종할 수 없습니다. 이 PC의 다른 프로그램이 몰래 CAD를 쓰지 못하게 하려는 것입니다.

## 3. 손으로 넣을 때 (위 명령을 못 쓸 때만)

Claude Code:

```
claude mcp add --scope user barun-cad -- "C:\Program Files\Barun\Barun CAD 6\resources\backend\barun-cad-6-server.exe" --mcp
```

Claude 데스크톱 앱(`%APPDATA%\Claude\claude_desktop_config.json` 의 `mcpServers`):

```json
"barun-cad": { "command": "C:\\Program Files\\Barun\\Barun CAD 6\\resources\\backend\\barun-cad-6-server.exe", "args": ["--mcp"] }
```

Codex(`~/.codex/config.toml`):

```toml
[mcp_servers.barun-cad]
command = 'C:\Program Files\Barun\Barun CAD 6\resources\backend\barun-cad-6-server.exe'
args = ['--mcp']
```

## 4. 연결 오류 뜻 (도구 결과의 `code`)

| code | 뜻 | 할 일 |
|---|---|---|
| `cad_not_running` | 바른 CAD가 켜져 있지 않음(연결 파일이 남아 있어도 그 주소에 아무도 없으면 이것) | 바른 CAD를 켜고 도면 창이 뜬 뒤 다시 |
| `cad_unreachable` | CAD 주소에 무언가 있는데 접속이 막히거나 응답이 없음(접속 거부는 여기 아님) | AI 프로그램의 보안 격리(sandbox)·보안 프로그램이 이 PC 안 연결을 막는지 확인 |
| `stale_connection` | 연결 정보가 지금 켜진 CAD와 다름(예전에 켠 CAD의 정보) | 바른 CAD를 완전히 껐다가 다시 켜기 |
| `not_logged_in` | 바른 CAD 로그인 안 됨 | 바른 CAD에서 [계정 연결]로 로그인 |
| `reconnecting` | 고른 도면 창에 다시 붙는 중 | 몇 초 뒤 `cad_get_document` 로 창 목록 다시 읽기 |
| `consent_required` | 바른 CAD 화면의 허락 창에 아직 답하지 않음(또는 도면 창이 없어 창을 못 띄움) | 사용자에게 "바른 CAD 화면에 뜬 창에서 [허락]을 눌러 주세요"라고 알리고, 누른 뒤 같은 도구를 다시 |
| `consent_denied` | 사용자가 이 AI 프로그램을 [거절]함 | 다시 시도하지 말 것. 사용자가 원하면 계정 창 → AI → [허락한 AI 관리]에서 지운 뒤 다시 |
| `consent_revoked` | 사용자가 허락을 취소함 | 중계가 자동으로 한 번 다시 묻는다. 그래도 나오면 사용자에게 다시 허락할지 묻기 |
| `library_first` | 벽·문·창처럼 바른 명령(리습)이 있는 일을 기본 도형으로 그리려 함 | 알려 준 명령을 `cad_describe_command` → `cad_run_command` 로 먼저 쓰기. 써 보고도 안 될 때만 `library_check` 에 명령·이유를 적어 다시 |

## 5. AI가 지킬 것

- 사용자는 짧게 말합니다("단면 그려 줘"). 도면에서 알 수 있는 것은 채우고, 모르는 것만 쉬운 말로 하나씩 물으세요.
- 오래 걸리는 도구는 `status: running` 과 `job_id` 를 돌려줍니다. 같은 작업을 다시 보내지 말고 `cad_get_job` 으로 기다리세요.
- 자세한 규칙은 MCP 서버의 `instructions` 에 있습니다.
