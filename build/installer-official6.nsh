; 도면 파일 연결: 파일 종류 아이콘(resources\file-icons)과 '연결 프로그램' 후보를 등록하고,
; 기본 연결이 비었거나 옛 바른 CAD 의 것일 때만 6 으로 넘겨받는다(설치 직후 DWG·DXF 아이콘이 새 모양으로 바뀌게).
; Windows 기본 앱 선택(UserChoice)이나 다른 CAD(AutoCAD 등)의 연결은 덮어쓰지 않는다.
!define BARUN_CAD6_CAPABILITIES "Software\Barun CAD 6\Capabilities"
!macro BarunCad6RegisterType progid description icon
  WriteRegStr HKLM "Software\Classes\${progid}" "" "${description}"
  WriteRegStr HKLM "Software\Classes\${progid}\DefaultIcon" "" "$INSTDIR\resources\file-icons\${icon}"
  WriteRegStr HKLM "Software\Classes\${progid}\Application" "ApplicationName" "바른 CAD 6"
  WriteRegStr HKLM "Software\Classes\${progid}\Application" "ApplicationIcon" "$INSTDIR\Barun CAD 6.exe,0"
  WriteRegStr HKLM "Software\Classes\${progid}\shell\open\command" "" '"$INSTDIR\Barun CAD 6.exe" "%1"'
!macroend
!macro BarunCad6RegisterExtension extension progid
  WriteRegStr HKLM "Software\Classes\${extension}\OpenWithProgids" "${progid}" ""
  WriteRegStr HKLM "${BARUN_CAD6_CAPABILITIES}\FileAssociations" "${extension}" "${progid}"
!macroend
!macro BarunCad6RemoveExtension extension progid
  DeleteRegValue HKLM "Software\Classes\${extension}\OpenWithProgids" "${progid}"
  ; 넘겨받았던 기본 연결만 비운다(그 사이 다른 프로그램이 잡았으면 그대로 둔다).
  ReadRegStr $R0 HKLM "Software\Classes\${extension}" ""
  ${If} $R0 == "${progid}"
    DeleteRegValue HKLM "Software\Classes\${extension}" ""
  ${EndIf}
  ReadRegStr $R0 HKCU "Software\Classes\${extension}" ""
  ${If} $R0 == "${progid}"
    DeleteRegValue HKCU "Software\Classes\${extension}" ""
  ${EndIf}
!macroend
; 기본 연결 넘겨받기: 비어 있거나(컴퓨터 전체만) 옛 바른 CAD 가 쓴 이름일 때만 6 으로 바꾼다.
;   옛 이름 — 현재 사용자: BarunCAD.DWG/DXF/BCAD(옛 앱이 직접 등록), 컴퓨터 전체: 'DWG 도면'·'DXF 도면'·'바른CAD 도면'(옛 설치 파일).
;   현재 사용자 쪽이 비어 있으면 쓰지 않는다: 쓰면 컴퓨터 전체의 다른 CAD 연결을 가리게 된다.
!macro BarunCad6ClaimExtension root extension progid
  ReadRegStr $R0 ${root} "Software\Classes\${extension}" ""
  StrCpy $R1 $R0 8
  ${If} $R1 == "BarunCAD"
  ${OrIf} $R0 == "DWG 도면"
  ${OrIf} $R0 == "DXF 도면"
  ${OrIf} $R0 == "바른CAD 도면"
    WriteRegStr ${root} "Software\Classes\${extension}" "" "${progid}"
  !if "${root}" == "HKLM"
  ${ElseIf} $R0 == ""
    WriteRegStr ${root} "Software\Classes\${extension}" "" "${progid}"
  !endif
  ${EndIf}
!macroend
; 옛 바른 CAD 연결 이름(BarunCAD.DWG 등)이 남아 있으면 그 이름을 가리키는 곳(Windows 기본 앱 선택 포함)도
; 새 아이콘으로 보이게 아이콘을 바꾸고, 지워진 옛 실행 파일 대신 6 으로 열리게 한다.
!macro BarunCad6RefreshLegacyType root progid icon
  ReadRegStr $R0 ${root} "Software\Classes\${progid}" ""
  ${If} $R0 != ""
    WriteRegStr ${root} "Software\Classes\${progid}\DefaultIcon" "" "$INSTDIR\resources\file-icons\${icon}"
    WriteRegStr ${root} "Software\Classes\${progid}\shell\open\command" "" '"$INSTDIR\Barun CAD 6.exe" "%1"'
  ${EndIf}
!macroend

!macro customInit
  StrCpy $INSTDIR "$PROGRAMFILES64\Barun\Barun CAD 6"
  ; Run the actual candidate BEFORE installSection can close/uninstall the old CAD.
  ; Reuse the embedded archive: no second payload or second installed CAD.
  InitPluginsDir
  SetShellVarContext all
  Var /GLOBAL qualityRegistry
  Var /GLOBAL qualityReport
  Var /GLOBAL qualityArgs
  Var /GLOBAL qualityCheckOnly
  ; 사용자 PC 설치는 검사 결과와 상관없이 설치한다(사용자 2026-10-21 "저런 문제가 있어도 깔려야"). GPU 없음·느린 PC·같은 판 재설치·검증 DB 손상은
  ; 그 PC 사정이라 설치를 막지 않고 기록만 남긴다. 빌드 확인(/QUALITYCHECKONLY)만 지금처럼 실패 = 멈춤 — 최종본 품질 기준은 그대로.
  Var /GLOBAL qualityPassed
  StrCpy $qualityPassed "no"
  StrCpy $qualityRegistry "$APPDATA\Barun\CAD6Quality\registry.json"
  StrCpy $qualityReport "$PLUGINSDIR\quality-result.json"
  ${GetParameters} $qualityArgs
  ClearErrors
  ${GetOptions} $qualityArgs "/QUALITYCHECKONLY" $qualityCheckOnly
  IfErrors +2 0
    StrCpy $qualityCheckOnly "yes"
  ${If} $qualityCheckOnly == "yes"
    ; A packaging smoke test cannot change the machine's approval storage.
    StrCpy $qualityRegistry "$PLUGINSDIR\quality-registry.json"
  ${Else}
    ReadRegStr $R0 HKLM "Software\Barun\CAD6Quality" "ApprovedVersion"
    ${If} $R0 != ""
    ${AndIfNot} ${FileExists} "$qualityRegistry"
      ; 검증 DB 가 없어졌어도 설치는 한다(검사·승인만 건너뛴다)
      DetailPrint "바른 CAD 검증 DB 없음 — 설치는 계속하고 검증 승인은 하지 않습니다."
    ${EndIf}
  ${EndIf}
  StrCpy $R0 ""
  ${GetOptions} $qualityArgs "/QUALITYREPORT=" $R0
  ${If} $R0 != ""
    StrCpy $qualityReport $R0
  ${EndIf}
  SetOutPath "$PLUGINSDIR\quality-candidate"
  !ifdef COMPRESS
    SetCompress off
  !endif
  File /oname=$PLUGINSDIR\quality-app.7z "${APP_64}"
  !ifdef COMPRESS
    SetCompress "${COMPRESS}"
  !endif
  Nsis7z::Extract "$PLUGINSDIR\quality-app.7z"
  ClearErrors
  ExecWait '"$PLUGINSDIR\quality-candidate\Barun CAD 6.exe" --barun-verify --report "$qualityReport" --registry "$qualityRegistry"' $R0
  ${If} ${Errors}
    StrCpy $R0 2
  ${EndIf}
  ${If} $R0 == 0
    StrCpy $qualityPassed "yes"
  ${Else}
    CopyFiles /SILENT "$qualityReport" "$TEMP\Barun-CAD-6-quality-failure.json"
    ${If} $qualityCheckOnly == "yes"
      ; 빌드 확인: 실패하면 지금처럼 멈춘다
      SetErrorLevel 2
      Quit
    ${EndIf}
    ; 사용자 PC: 막지 않는다. 실패 기록만 남기고 설치를 계속한다(검증 DB 승인은 하지 않음)
    CreateDirectory "$APPDATA\Barun\CAD6Quality"
    CopyFiles /SILENT "$qualityReport" "$APPDATA\Barun\CAD6Quality\last-install-check.json"
    DetailPrint "바른 CAD 설치 전 기능 검사가 이 PC 에서 통과하지 못했습니다(기록: $TEMP\Barun-CAD-6-quality-failure.json). 설치는 계속합니다."
  ${EndIf}
  ${If} $qualityCheckOnly == "yes"
    SetErrorLevel 0
    Quit
  ${EndIf}
  SetOutPath $INSTDIR
!macroend
!macro customInstall
  SetShellVarContext all
  ; Only advance the cumulative DB after the verified files were installed.
  ; 검사를 통과한 설치만 검증 DB 에 승인한다. 승인 실패도 설치를 되돌리지 않는다
  ${If} $qualityPassed == "yes"
    ClearErrors
    ExecWait '"$INSTDIR\Barun CAD 6.exe" --barun-quality-commit --report "$qualityReport" --registry "$qualityRegistry"' $R0
    ${If} ${Errors}
      StrCpy $R0 2
    ${EndIf}
    ${If} $R0 == 0
      WriteRegStr HKLM "Software\Barun\CAD6Quality" "ApprovedVersion" "${VERSION}"
    ${Else}
      DetailPrint "검증 결과 확정 실패 — 설치는 완료, 검증 DB 는 그대로입니다."
    ${EndIf}
  ${EndIf}
  CreateShortCut "$DESKTOP\바른 CAD 6.lnk" "$INSTDIR\Barun CAD 6.exe"
  CreateShortCut "$SMPROGRAMS\바른 CAD 6.lnk" "$INSTDIR\Barun CAD 6.exe"
  !insertmacro BarunCad6RegisterType "BarunCAD6.DWG" "바른 CAD DWG 도면" "file-dwg.ico"
  !insertmacro BarunCad6RegisterType "BarunCAD6.DXF" "바른 CAD DXF 도면" "file-dxf.ico"
  !insertmacro BarunCad6RegisterType "BarunCAD6.BCAD" "바른 CAD 도면" "file-bcad.ico"
  !insertmacro BarunCad6RegisterExtension ".dwg" "BarunCAD6.DWG"
  !insertmacro BarunCad6RegisterExtension ".dxf" "BarunCAD6.DXF"
  !insertmacro BarunCad6RegisterExtension ".bcad" "BarunCAD6.BCAD"
  !insertmacro BarunCad6ClaimExtension HKLM ".dwg" "BarunCAD6.DWG"
  !insertmacro BarunCad6ClaimExtension HKLM ".dxf" "BarunCAD6.DXF"
  !insertmacro BarunCad6ClaimExtension HKLM ".bcad" "BarunCAD6.BCAD"
  !insertmacro BarunCad6ClaimExtension HKCU ".dwg" "BarunCAD6.DWG"
  !insertmacro BarunCad6ClaimExtension HKCU ".dxf" "BarunCAD6.DXF"
  !insertmacro BarunCad6ClaimExtension HKCU ".bcad" "BarunCAD6.BCAD"
  !insertmacro BarunCad6RefreshLegacyType HKCU "BarunCAD.DWG" "file-dwg.ico"
  !insertmacro BarunCad6RefreshLegacyType HKCU "BarunCAD.DXF" "file-dxf.ico"
  !insertmacro BarunCad6RefreshLegacyType HKCU "BarunCAD.BCAD" "file-bcad.ico"
  !insertmacro BarunCad6RefreshLegacyType HKLM "BarunCAD.DWG" "file-dwg.ico"
  !insertmacro BarunCad6RefreshLegacyType HKLM "BarunCAD.DXF" "file-dxf.ico"
  !insertmacro BarunCad6RefreshLegacyType HKLM "BarunCAD.BCAD" "file-bcad.ico"
  WriteRegStr HKLM "${BARUN_CAD6_CAPABILITIES}" "ApplicationName" "바른 CAD 6"
  WriteRegStr HKLM "${BARUN_CAD6_CAPABILITIES}" "ApplicationDescription" "바른 CAD 6로 DWG·DXF 도면을 엽니다."
  WriteRegStr HKLM "Software\RegisteredApplications" "BarunCAD6" "${BARUN_CAD6_CAPABILITIES}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; 탐색기가 옛 아이콘(파일·바로가기)을 기억하고 있으므로 아이콘 캐시를 새로 읽게 한다.
  ; 설치 프로그램은 32비트라 System32 가 SysWOW64 로 바뀌는데, ie4uinit.exe 는 64비트 System32 에만 있다(Sysnative 로 접근).
  ${If} ${FileExists} "$WINDIR\Sysnative\ie4uinit.exe"
    nsExec::Exec '"$WINDIR\Sysnative\ie4uinit.exe" -show'
  ${Else}
    nsExec::Exec '"$WINDIR\System32\ie4uinit.exe" -show'
  ${EndIf}
!macroend
!macro customUnInstall
  nsExec::ExecToLog 'taskkill /IM "Barun CAD 6.exe" /T /F'
  nsExec::ExecToLog 'taskkill /IM "barun-cad-6-server.exe" /T /F'
  Sleep 500
  SetShellVarContext all
  Delete "$DESKTOP\바른 CAD 6.lnk"
  Delete "$SMPROGRAMS\바른 CAD 6.lnk"
  ; 업데이트 중 옛 판 제거 단계에서는 연결을 지우지 않는다(새 판 customInstall 이 다시 쓴다).
  ${ifNot} ${isUpdated}
    DeleteRegValue HKLM "Software\RegisteredApplications" "BarunCAD6"
    !insertmacro BarunCad6RemoveExtension ".dwg" "BarunCAD6.DWG"
    !insertmacro BarunCad6RemoveExtension ".dxf" "BarunCAD6.DXF"
    !insertmacro BarunCad6RemoveExtension ".bcad" "BarunCAD6.BCAD"
    DeleteRegKey HKLM "${BARUN_CAD6_CAPABILITIES}"
    DeleteRegKey HKLM "Software\Classes\BarunCAD6.DWG"
    DeleteRegKey HKLM "Software\Classes\BarunCAD6.DXF"
    DeleteRegKey HKLM "Software\Classes\BarunCAD6.BCAD"
  ${endIf}
!macroend
