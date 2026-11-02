# OCCT 시범 의존성 고지

선택 패키지: **replicad-opencascadejs 1.1.0**. 이것은 Open CASCADE Technology의
WebAssembly 바인딩 축소 배포판이며, AGPL인 `replicad` 래퍼 패키지는 사용하지 않는다.

- 배포 패키지의 표시 라이선스: LGPL-2.1-only.
- OCCT에는 LGPL 2.1의 추가 예외가 적용된다. 예외의 정확한 범위는 아래 원문을 따른다.
- 원저작자: Open CASCADE SAS 및 OCCT 기여자, OpenCascade.js와 패키지 바인딩 기여자.
- 변경 사항: 의존성 바이너리를 수정하지 않으며 바른 CAD용 독립 어댑터를 추가한다.
- 이 파일은 고지문이다. 실제 제품에 포함할 때 패키지 LICENSE, OCCT 예외 원문,
  해당 바이너리와 일치하는 소스 제공·재링크 방식도 갖추어야 한다.

원문:
- [패키지와 라이선스 메타데이터](https://github.com/sgenoud/replicad/blob/main/packages/replicad-opencascadejs/package.json)
- [패키지 LICENSE](https://github.com/sgenoud/replicad/blob/main/packages/replicad-opencascadejs/LICENSE)
- [OCCT LGPL](https://github.com/Open-Cascade-SAS/OCCT/blob/master/LICENSE_LGPL_21.txt)
- [OCCT 추가 예외](https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt)
- [바인딩 축소 구성](https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs/build-source)

설치가 끝나면 LGPL 원문은 `node_modules/replicad-opencascadejs/LICENSE`에 있다.
현재 작업 환경은 로컬 npm 네트워크가 EACCES로 차단되어 설치가 완료되지 않았다.
제품 빌드·설치판 생성·배포는 이 시범의 범위가 아니다.
