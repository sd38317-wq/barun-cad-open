# OCCT CAD 자산 보관 기준

OCCT는 occt-commands.js가 명령을 처음 실행할 때 Worker로 로드한다. server.py는 다음 런타임 모듈과 vendor/occt-pkg/node_modules/replicad-opencascadejs/dist/replicad_single.js 및 replicad_single.wasm만 허용한다. 설치판 목록은 build_desktop.py에서 같은 파일을 추가한다.

WASM은 현재 약 22MB(원본), gzip 약 7MB이며 설치판에 포함되는 파일 크기를 빌드 전 점검할 수 있다. 패키지 라이선스는 LGPL-2.1이며, 고지와 라이선스 파일은 vendor/occt-pkg/NOTICE.md와 vendored LICENSE를 함께 설치판에 보관한다. 소스·라이선스 제공 위치를 바꾸거나 WASM을 다시 받지 않는다.

빌드·설치·배포는 이 작업에서 수행하지 않는다.

브라우저 번들은 occt-commands-[hash].js를 지연 청크로 만들며, server.py의 BUNDLE_CHUNK_PATTERN이 허용한다. occt-client.js는 --external:./occt-client.js로 번들 밖에 남겨 Node 전용 worker_threads import를 브라우저 번들러가 추적하지 않도록 했다. raw Worker/loader/kernel/building/section과 single JS/WASM은 build_desktop.py assets에서 경로를 보존한다. 실제 번들·설치판 생성은 사용자의 빌드 금지 지침으로 검증하지 않았다.

현재 포함되는 single WASM은 22,980,267B(21.9MiB), 이전 오프라인 gzip level9 측정은 7,250,252B(6.9MiB)다. multi WASM은 포함하지 않는다. LGPL-2.1-only 고지 원문은 vendor/occt-pkg/NOTICE.md, 라이선스 원문은 vendor/occt-pkg/node_modules/replicad-opencascadejs/LICENSE이며 같은 경로로 설치 자산에 보존된다. LGPL 소스 제공에 관한 기존 NOTICE 안내는 실제 배포 전 처리해야 한다. 이번 작업은 위치와 자산 목록만 연결했다.
