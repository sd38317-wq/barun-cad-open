!macro customInit
  StrCpy $INSTDIR "$PROGRAMFILES64\Barun\Barun CAD 5"
!macroend
!macro customInstall
  SetShellVarContext all
  CreateShortCut "$DESKTOP\바른 CAD 5.lnk" "$INSTDIR\Barun CAD 5.exe"
  CreateShortCut "$SMPROGRAMS\바른 CAD 5.lnk" "$INSTDIR\Barun CAD 5.exe"
!macroend
!macro customUnInstall
  nsExec::ExecToLog 'taskkill /IM "Barun CAD 5.exe" /T /F'
  nsExec::ExecToLog 'taskkill /IM "barun-cad-5-server.exe" /T /F'
  Sleep 500
  SetShellVarContext all
  Delete "$DESKTOP\바른 CAD 5.lnk"
  Delete "$SMPROGRAMS\바른 CAD 5.lnk"
!macroend
