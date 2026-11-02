!macro customInit
  StrCpy $INSTDIR "$PROGRAMFILES64\Barun\arun CAD Beta 5"
!macroend
!macro customInstall
  SetShellVarContext all
  CreateShortCut "$DESKTOP\arun CAD Beta 5.lnk" "$INSTDIR\arun CAD Beta 5.exe"
  CreateShortCut "$SMPROGRAMS\arun CAD Beta 5.lnk" "$INSTDIR\arun CAD Beta 5.exe"
!macroend
!macro customUnInstall
  nsExec::ExecToLog 'taskkill /IM "arun CAD Beta 5.exe" /T /F'
  nsExec::ExecToLog 'taskkill /IM "arun-cad-beta-server.exe" /T /F'
  Delete "$DESKTOP\arun CAD Beta 5.lnk"
  Delete "$SMPROGRAMS\arun CAD Beta 5.lnk"
!macroend
