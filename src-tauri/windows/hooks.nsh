; Installer hooks (tauri.conf.json › bundle.windows.nsis.installerHooks).

; Music App became Legato (2026-10-29). The installer finds a previous install by product name, so the first Legato
; update lands in a new folder beside "Music App": run that one's uninstaller, silently (its files, shortcuts and Apps
; entry go; a silent uninstall keeps app data, which both names share by identifier). An update makes no shortcuts:
; the ones the old install had come back under the new name, and a taskbar pin is pointed at the new exe. Nothing to
; do once the old install is gone. SetLnkAppUserModelId uses $0 to $5: every register touched here is put back.
!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $R0
  Push $R1
  Push $R2
  ReadRegStr $R0 SHCTX "${MANUKEY}\Music App" ""
  ${If} $R0 != ""
  ${AndIf} $R0 != $INSTDIR
  ${AndIf} ${FileExists} "$R0\uninstall.exe"
    StrCpy $R1 0
    StrCpy $R2 0
    ${IfThen} ${FileExists} "$SMPROGRAMS\Music App.lnk" ${|} StrCpy $R1 1 ${|}
    ${IfThen} ${FileExists} "$DESKTOP\Music App.lnk" ${|} StrCpy $R2 1 ${|}
    ExecWait '"$R0\uninstall.exe" /S _?=$R0'
    Delete "$R0\uninstall.exe"
    RMDir "$R0"
    ${If} $R1 = 1
      CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}
    ${If} $R2 = 1
      CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
    StrCpy $R1 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Music App.lnk"
    ${If} ${FileExists} $R1
      CreateShortcut $R1 "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId $R1
    ${EndIf}
  ${EndIf}
  DeleteRegKey SHCTX "${MANUKEY}\Music App"
  Pop $R2
  Pop $R1
  Pop $R0
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
