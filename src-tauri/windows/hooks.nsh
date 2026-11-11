; Installer hooks (tauri.conf.json › bundle.windows.nsis.installerHooks).

; Music App became Legato (2026-10-29). The installer finds a previous install by product name, so the first Legato
; update lands in a new folder beside "Music App": run that one's uninstaller, silently (its files, shortcuts and Apps
; entry go; a silent uninstall keeps app data, which both names share by identifier). An update makes no shortcuts:
; the ones the old install had come back under the new name, and a taskbar pin is pointed at the new exe. Nothing to
; do once the old install is gone. SetLnkAppUserModelId uses $0 to $5: every register touched here is put back.
; Its key is the old manufacturer's (from the old identifier dev.musicapp.desktop), not ${MANUKEY} (legato's): looked for
; there, it was never found (2026-11-06, the owner's PC: Music App 0.1.324 stayed, its shortcut and startup entry too).
!define LEGATO_OLD_KEY "Software\musicapp\Music App"
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
  ReadRegStr $R0 SHCTX "${LEGATO_OLD_KEY}" ""
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
  ; Its uninstaller takes its own key; one still there with its uninstaller means it failed (the old app running?): kept,
  ; so the next update tries again.
  ${IfNot} ${FileExists} "$R0\uninstall.exe"
    DeleteRegKey SHCTX "${LEGATO_OLD_KEY}"
  ${EndIf}
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

; The legato:// link type the installed app registers for this user (src-tauri/src/protocol.rs): gone with the app.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\legato"
!macroend
