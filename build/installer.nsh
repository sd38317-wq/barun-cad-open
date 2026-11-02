!macro customInit
  StrCpy $INSTDIR "$PROGRAMFILES64\Barun\Barun CAD"
!macroend

!macro customInstall
  ; 업데이트 제거 단계에서 바로가기가 먼저 사라질 수 있다. 설치 마지막에
  ; 실제 실행 파일을 대상으로 공용 바로가기를 반드시 다시 만든다.
  SetShellVarContext current
  Delete "$DESKTOP\Barun CAD.lnk"
  Delete "$SMPROGRAMS\Barun CAD.lnk"
  Delete "$DESKTOP\바른 CAD.lnk"
  Delete "$SMPROGRAMS\바른 CAD.lnk"
  SetShellVarContext all
  CreateShortCut "$DESKTOP\바른 CAD.lnk" "$INSTDIR\Barun CAD.exe"
  CreateShortCut "$SMPROGRAMS\바른 CAD.lnk" "$INSTDIR\Barun CAD.exe"
!macroend

!macro customUnInstall
  ; 실행 중인 본체와 내장 변환 엔진이 설치 파일을 잡고 있으면 제거가
  ; 오류 2로 중단된다. 제거를 시작할 때 자식 프로세스까지 먼저 끝낸다.
  nsExec::ExecToLog 'taskkill /IM "Barun CAD.exe" /T /F'
  nsExec::ExecToLog 'taskkill /IM "barun-cad-server.exe" /T /F'
  Sleep 500
  SetShellVarContext current
  Delete "$DESKTOP\Barun CAD.lnk"
  Delete "$SMPROGRAMS\Barun CAD.lnk"
  Delete "$DESKTOP\바른 CAD.lnk"
  Delete "$SMPROGRAMS\바른 CAD.lnk"
  SetShellVarContext all
  Delete "$DESKTOP\Barun CAD.lnk"
  Delete "$SMPROGRAMS\Barun CAD.lnk"
  Delete "$DESKTOP\바른 CAD.lnk"
  Delete "$SMPROGRAMS\바른 CAD.lnk"
!macroend
