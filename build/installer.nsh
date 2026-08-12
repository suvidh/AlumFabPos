; =============================================================================
;  ALUMFAB POS — NSIS installer customisation
; =============================================================================
;  Included by electron-builder via  nsis.include: build/installer.nsh
;
;  electron-builder generates the surrounding installer and calls the macros
;  below at fixed points in its lifecycle. We only fill in the POS-specific
;  behaviour:
;
;    preInit          -> pin the default install directory
;    customInit       -> OS / disk / prerequisite gate before anything is copied
;    customInstall    -> firewall rule, auto-start, support registry keys
;    customUnInit     -> parse silent-uninstall switches
;    customUnInstall  -> stop processes, tear down OS integration, data prompt
;
;  Silent-install switches (for fleet rollout via PDQ / Intune / a .bat):
;
;    ALUMFAB-POS-Setup-1.0.0-x64.exe /S                 silent, all defaults on
;    ...exe /S /AUTOSTART=0                             do not launch at login
;    ...exe /S /FIREWALL=0                              skip the inbound rule
;    ...exe /S /SKIPPREREQ=1                            assume runtimes present
;    ...exe /S /D=C:\POS\ALUMFAB                        custom dir (must be last)
;
;  Silent-uninstall switches:
;
;    Uninstall ALUMFAB POS.exe /S                       keeps all business data
;    Uninstall ALUMFAB POS.exe /S /PURGEDATA=1          deletes db + backups
;
;  NOTE ON THE BACKEND API
;  -----------------------
;  The Express REST API (port 3333) runs *inside* the Electron main process,
;  so there is no separate Windows Service by default — the API is alive
;  whenever the till app is running, and the HKLM Run entry written by
;  customInstall is what makes that happen at every login. If you later split
;  the API into a headless Node process, flip ENABLE_NSSM_SERVICE below; the
;  full service registration and recovery configuration is already written.
; =============================================================================

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinVer.nsh"
!include "x64.nsh"

; -----------------------------------------------------------------------------
;  Configuration
; -----------------------------------------------------------------------------
!define POS_DATA_DIRNAME      "ALUMFAB-POS"
!define POS_API_PORT          "3333"
!define POS_SUPPORT_KEY       "Software\ALUMFAB\POS"
!define POS_RUN_KEY           "Software\Microsoft\Windows\CurrentVersion\Run"
!define POS_RUN_VALUE         "ALUMFAB POS"
!define POS_FW_RULE_PORT      "ALUMFAB POS API (TCP ${POS_API_PORT})"
!define POS_FW_RULE_APP       "ALUMFAB POS Application"
!define POS_MIN_DISK_MB       700          ; unpacked app + seed DB + headroom

; Minimum VC++ 2015-2022 x64 runtime we accept (14.30 = VS2022 17.0).
!define POS_VCRT_MIN_MAJOR    14
!define POS_VCRT_MIN_MINOR    30
!define POS_VCRT_URL          "https://aka.ms/vs/17/release/vc_redist.x64.exe"

; .NET Framework 4.8 == release 528040. Only needed by some OPOS / thermal
; printer driver stacks — treated as a warning, never a hard failure.
!define POS_DOTNET48_RELEASE  528040

; Set to 1 only if you extract the Express API into a headless Node process.
!define ENABLE_NSSM_SERVICE   0
!define POS_SERVICE_NAME      "AlumfabPosApi"
!define POS_SERVICE_DISPLAY   "ALUMFAB POS API Server"

; -----------------------------------------------------------------------------
;  State
; -----------------------------------------------------------------------------
Var /GLOBAL PosAutoStart        ; 1 = write HKLM Run entry          (default 1)
Var /GLOBAL PosFirewall         ; 1 = create inbound firewall rule  (default 1)
Var /GLOBAL PosSkipPrereq       ; 1 = bypass runtime checks         (default 0)
Var /GLOBAL PosPurgeData        ; 1 = delete business data on uninstall
Var /GLOBAL PosCmdLine
Var /GLOBAL PosTmp
Var /GLOBAL PosDataDir

; =============================================================================
;  preInit — runs before $INSTDIR is resolved
; =============================================================================
;  Force the 64-bit Program Files location. Without this, a machine that once
;  had a 32-bit build installed can inherit  C:\Program Files (x86)\...  from
;  the leftover registry key.
; =============================================================================
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\${PRODUCT_FILENAME}"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\${PRODUCT_FILENAME}"
!macroend

; =============================================================================
;  customHeader — compile-time installer attributes
; =============================================================================
!macro customHeader
  ; Crisp text on the 4K screens that increasingly show up behind counters.
  ManifestDPIAware true
  ; Reboots on a live till are unacceptable; prerequisites are invoked with
  ; /norestart and we simply tell the operator if one is pending.
  SetOverwrite on
!macroend

; =============================================================================
;  Helper: read the installed VC++ 2015-2022 x64 runtime version
; =============================================================================
;  Sets $PosTmp to "1" when an acceptable runtime is present, "0" otherwise.
; =============================================================================
Function PosCheckVcRuntime
  Push $0
  Push $1
  Push $2

  StrCpy $PosTmp "0"
  SetRegView 64

  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Installed"
  ${If} $0 == 1
    ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Major"
    ReadRegDWORD $2 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Minor"
    ${If} $1 > ${POS_VCRT_MIN_MAJOR}
      StrCpy $PosTmp "1"
    ${ElseIf} $1 == ${POS_VCRT_MIN_MAJOR}
      ${If} $2 >= ${POS_VCRT_MIN_MINOR}
        StrCpy $PosTmp "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; =============================================================================
;  Helper: silently install the VC++ 2015-2022 x64 runtime
; =============================================================================
;  Strategy, in order of preference:
;    1. Use the redistributable bundled into this installer, if the build
;       machine had  build\prereq\VC_redist.x64.exe  present at compile time.
;       (Offline-capable — the right choice for shops with no internet.)
;    2. Otherwise download it from Microsoft over TLS 1.2 using PowerShell,
;       which is guaranteed present on Windows 10/11. We avoid NSISdl (no
;       HTTPS support) and third-party plugins (not in electron-builder's
;       bundled NSIS distribution).
; =============================================================================
Function PosInstallVcRuntime
  Push $0

  DetailPrint "Installing Microsoft Visual C++ 2015-2022 Redistributable (x64)..."
  SetDetailsPrint both

!if /FileExists "${BUILD_RESOURCES_DIR}\prereq\VC_redist.x64.exe"
  ; ---- Path 1: bundled, fully offline -------------------------------------
  DetailPrint "Using bundled redistributable (offline install)."
  SetOutPath "$PLUGINSDIR"
  File "/oname=VC_redist.x64.exe" "${BUILD_RESOURCES_DIR}\prereq\VC_redist.x64.exe"
!else
  ; ---- Path 2: download on demand -----------------------------------------
  ; Kept on one physical line on purpose: NSIS line-continuation would inject
  ; stray whitespace into the PowerShell expression. $\' is an escaped quote.
  DetailPrint "Downloading redistributable from Microsoft..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri $\'${POS_VCRT_URL}$\' -OutFile $\'$PLUGINSDIR\VC_redist.x64.exe$\' -UseBasicParsing"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Download failed (exit $0). The machine may be offline."
    Pop $0
    Return
  ${EndIf}
!endif

  ${IfNot} ${FileExists} "$PLUGINSDIR\VC_redist.x64.exe"
    DetailPrint "Redistributable payload not available — skipping."
    Pop $0
    Return
  ${EndIf}

  ; /norestart is mandatory: never reboot a till mid-rollout.
  ExecWait '"$PLUGINSDIR\VC_redist.x64.exe" /install /quiet /norestart' $0
  ; 0 = success, 1638 = a newer version is already present, 3010 = reboot queued
  ${If} $0 == 0
    DetailPrint "Visual C++ runtime installed."
  ${ElseIf} $0 == 1638
    DetailPrint "A newer Visual C++ runtime is already present."
  ${ElseIf} $0 == 3010
    DetailPrint "Visual C++ runtime installed — a reboot is pending."
  ${Else}
    DetailPrint "Visual C++ runtime installer returned $0."
  ${EndIf}

  Delete "$PLUGINSDIR\VC_redist.x64.exe"
  Pop $0
FunctionEnd

; =============================================================================
;  customInit — environment gate
; =============================================================================
!macro customInit
  ; Every MessageBox below carries /SD: without it NSIS still renders the
  ; dialog during a /S silent install and the rollout hangs waiting for a click.
  SetShellVarContext current      ; $APPDATA must be the operator, not ProgramData

  ; ---- Defaults, then command-line overrides ------------------------------
  StrCpy $PosAutoStart  "1"
  StrCpy $PosFirewall   "1"
  StrCpy $PosSkipPrereq "0"

  ${GetParameters} $PosCmdLine
  ${GetOptions} $PosCmdLine "/AUTOSTART=" $0
  ${IfNot} $0 == ""
    StrCpy $PosAutoStart $0
  ${EndIf}
  ${GetOptions} $PosCmdLine "/FIREWALL=" $0
  ${IfNot} $0 == ""
    StrCpy $PosFirewall $0
  ${EndIf}
  ${GetOptions} $PosCmdLine "/SKIPPREREQ=" $0
  ${IfNot} $0 == ""
    StrCpy $PosSkipPrereq $0
  ${EndIf}

  ; ---- 1. Architecture ----------------------------------------------------
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP \
      "ALUMFAB POS requires 64-bit Windows.$\r$\n$\r$\nThis machine is running a 32-bit edition of Windows and cannot be used as a POS terminal." \
      /SD IDOK
    Abort
  ${EndIf}

  ; ---- 2. OS version ------------------------------------------------------
  ; Electron 43 drops support for Windows 8.1 and below. Blocking here gives a
  ; readable message instead of a "the application was unable to start (0xc...)"
  ; crash on first launch.
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP \
      "ALUMFAB POS requires Windows 10 (version 1809) or later.$\r$\n$\r$\nPlease upgrade this terminal before installing." \
      /SD IDOK
    Abort
  ${EndIf}

  ; ---- 3. Free disk space -------------------------------------------------
  ; $INSTDIR is already resolved at customInit time; take its drive letter.
  StrCpy $0 $INSTDIR 3                       ; e.g. "C:\"
  ${DriveSpace} "$0" "/D=F /S=M" $1          ; free space, megabytes
  ${If} $1 != ""
  ${AndIf} $1 < ${POS_MIN_DISK_MB}
    MessageBox MB_YESNO|MB_ICONEXCLAMATION \
      "Only $1 MB is free on $0 — ALUMFAB POS needs about ${POS_MIN_DISK_MB} MB, plus room for the sales database to grow.$\r$\n$\r$\nContinue anyway?" \
      /SD IDYES IDYES +2
    Abort
  ${EndIf}

  ; ---- 4. Runtime prerequisites ------------------------------------------
  ${If} $PosSkipPrereq != "1"

    ; 4a. Visual C++ 2015-2022 x64 — required by the Prisma query engine.
    Call PosCheckVcRuntime
    ${If} $PosTmp != "1"
      DetailPrint "Visual C++ 2015-2022 x64 runtime not found."
      Call PosInstallVcRuntime
      Call PosCheckVcRuntime
      ${If} $PosTmp != "1"
        MessageBox MB_YESNO|MB_ICONEXCLAMATION \
          "The Microsoft Visual C++ 2015-2022 x64 Redistributable could not be installed automatically.$\r$\n$\r$\nALUMFAB POS may fail to open its database without it. You can install it later from:$\r$\n${POS_VCRT_URL}$\r$\n$\r$\nContinue with the installation?" \
          /SD IDYES IDYES +2
        Abort
      ${EndIf}
    ${Else}
      DetailPrint "Visual C++ 2015-2022 x64 runtime: OK"
    ${EndIf}

    ; 4b. .NET Framework 4.8 — advisory only. Electron does not need it, but
    ;     several thermal-printer and cash-drawer driver packs do.
    SetRegView 64
    ; A missing key leaves $0 at 0, which fails the comparison below anyway.
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" "Release"
    ${If} $0 < ${POS_DOTNET48_RELEASE}
      DetailPrint ".NET Framework 4.8 not detected — printer driver packs may need it."
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONINFORMATION \
          ".NET Framework 4.8 was not detected on this machine.$\r$\n$\r$\nALUMFAB POS itself does not require it, but some receipt-printer and cash-drawer drivers do. Install it from Windows Update if your hardware misbehaves." \
          /SD IDOK
      ${EndIf}
    ${Else}
      DetailPrint ".NET Framework 4.8+: OK"
    ${EndIf}

  ${EndIf}
!macroend

; =============================================================================
;  customInstall — OS integration after files are copied
; =============================================================================
!macro customInstall
  SetRegView 64
  ; Critical: electron-builder switches to "all" for a per-machine install, which
  ; would make $APPDATA resolve to C:\ProgramData. The POS database lives in the
  ; operator's roaming profile, so force the context back.
  SetShellVarContext current

  ; ---- 1. Support / telemetry registry keys -------------------------------
  ; Field engineers and the in-app diagnostics screen read these. Keeping the
  ; data directory here means a support script never has to guess.
  StrCpy $PosDataDir "$APPDATA\${POS_DATA_DIRNAME}"
  WriteRegStr   HKLM "${POS_SUPPORT_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKLM "${POS_SUPPORT_KEY}" "Version"         "${VERSION}"
  WriteRegStr   HKLM "${POS_SUPPORT_KEY}" "Executable"      "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr   HKLM "${POS_SUPPORT_KEY}" "DataDirectory"   "%APPDATA%\${POS_DATA_DIRNAME}"
  WriteRegDWORD HKLM "${POS_SUPPORT_KEY}" "ApiPort"         ${POS_API_PORT}
  WriteRegStr   HKLM "${POS_SUPPORT_KEY}" "InstallMode"     "per-machine"

  ; ---- 2. Windows Firewall ------------------------------------------------
  ; The embedded Express API listens on 0.0.0.0:${POS_API_PORT} so that a
  ; second till, a stock-take tablet, or a Tailscale peer can reach it.
  ; Scope the rule to Private + Domain profiles only — a POS must never accept
  ; inbound connections on a Public network.
  ${If} $PosFirewall == "1"
    DetailPrint "Configuring Windows Firewall for the local API (port ${POS_API_PORT})..."
    ; Delete first so re-running the installer never stacks duplicate rules.
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${POS_FW_RULE_PORT}"'
    Pop $0
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${POS_FW_RULE_APP}"'
    Pop $0
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${POS_FW_RULE_PORT}" dir=in action=allow protocol=TCP localport=${POS_API_PORT} profile=private,domain description="Allows other ALUMFAB POS terminals on the shop LAN to reach the local REST API."'
    Pop $0
    ${If} $0 == 0
      DetailPrint "Firewall rule created."
    ${Else}
      DetailPrint "Firewall rule could not be created (netsh exit $0) — continuing."
    ${EndIf}
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${POS_FW_RULE_APP}" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=private,domain'
    Pop $0
  ${Else}
    DetailPrint "Firewall configuration skipped (/FIREWALL=0)."
  ${EndIf}

  ; ---- 3. Launch at login -------------------------------------------------
  ; Because the REST API is hosted inside the Electron main process, "the
  ; backend starts automatically" means "the app starts automatically". An
  ; HKLM Run entry covers every operator who signs into the terminal.
  ;
  ; --autostart is passed so the app can decide to start minimised to the
  ; tray on a boot-triggered launch rather than a user double-click.
  ${If} $PosAutoStart == "1"
    WriteRegStr HKLM "${POS_RUN_KEY}" "${POS_RUN_VALUE}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --autostart'
    WriteRegDWORD HKLM "${POS_SUPPORT_KEY}" "AutoStart" 1
    DetailPrint "ALUMFAB POS will start automatically at login."
  ${Else}
    DeleteRegValue HKLM "${POS_RUN_KEY}" "${POS_RUN_VALUE}"
    WriteRegDWORD HKLM "${POS_SUPPORT_KEY}" "AutoStart" 0
    DetailPrint "Auto-start disabled (/AUTOSTART=0)."
  ${EndIf}

  ; ---- 4. Optional: headless API as a Windows Service ---------------------
  ; Disabled by default (ENABLE_NSSM_SERVICE 0) because the API currently runs
  ; inside Electron. Flip the define once you ship a standalone Node entry
  ; point at  resources\server\service-main.js  and bundle NSSM at
  ; build\bin\nssm.exe.
!if ${ENABLE_NSSM_SERVICE} == 1
  DetailPrint "Registering ${POS_SERVICE_DISPLAY} as a Windows Service..."
  SetOutPath "$INSTDIR\bin"
  File "${BUILD_RESOURCES_DIR}\bin\nssm.exe"

  ; Remove any previous registration so upgrades are idempotent.
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" stop ${POS_SERVICE_NAME}'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" remove ${POS_SERVICE_NAME} confirm'
  Pop $0

  ; Install: run the bundled Node runtime against the headless server entry.
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" install ${POS_SERVICE_NAME} "$INSTDIR\resources\node.exe" "$INSTDIR\resources\server\service-main.js"'
  Pop $0

  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" set ${POS_SERVICE_NAME} DisplayName "${POS_SERVICE_DISPLAY}"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" set ${POS_SERVICE_NAME} Description "Hosts the ALUMFAB POS REST API and SQLite data layer on port ${POS_API_PORT}."'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" set ${POS_SERVICE_NAME} Start SERVICE_AUTO_START'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" set ${POS_SERVICE_NAME} AppDirectory "$INSTDIR"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" set ${POS_SERVICE_NAME} AppStdout "$APPDATA\${POS_DATA_DIRNAME}\logs\service-out.log"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" set ${POS_SERVICE_NAME} AppStderr "$APPDATA\${POS_DATA_DIRNAME}\logs\service-err.log"'
  Pop $0
  ; Rotate the service log at 16 MB so a busy shop never fills the disk.
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" set ${POS_SERVICE_NAME} AppRotateFiles 1'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" set ${POS_SERVICE_NAME} AppRotateBytes 16777216'
  Pop $0

  ; --- Recovery: restart automatically 5 seconds after any failure ---------
  ; NSSM's own throttle (how long the app must stay up to count as "started")
  ; plus the SCM recovery actions. Both are set: NSSM handles a clean crash,
  ; the SCM handles NSSM itself dying.
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" set ${POS_SERVICE_NAME} AppThrottle 5000'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" set ${POS_SERVICE_NAME} AppExit Default Restart'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" set ${POS_SERVICE_NAME} AppRestartDelay 5000'
  Pop $0
  ; reset=86400 -> the failure counter clears after a day without incident.
  nsExec::ExecToLog 'sc.exe failure ${POS_SERVICE_NAME} reset= 86400 actions= restart/5000/restart/5000/restart/5000'
  Pop $0
  nsExec::ExecToLog 'sc.exe failureflag ${POS_SERVICE_NAME} 1'
  Pop $0

  nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" start ${POS_SERVICE_NAME}'
  Pop $0
  ${If} $0 == 0
    DetailPrint "${POS_SERVICE_DISPLAY} started."
  ${Else}
    DetailPrint "${POS_SERVICE_DISPLAY} could not be started (exit $0). Check the service log."
  ${EndIf}
!endif

  ; ---- 5. Pre-create the per-user data tree -------------------------------
  ; The app creates these itself on first run; doing it here means a fresh
  ; terminal shows the right folders to a technician immediately.
  CreateDirectory "$APPDATA\${POS_DATA_DIRNAME}"
  CreateDirectory "$APPDATA\${POS_DATA_DIRNAME}\database"
  CreateDirectory "$APPDATA\${POS_DATA_DIRNAME}\backups"
  CreateDirectory "$APPDATA\${POS_DATA_DIRNAME}\logs"
  CreateDirectory "$APPDATA\${POS_DATA_DIRNAME}\assets\logos"
!macroend

; =============================================================================
;  customUnInit — parse uninstall switches
; =============================================================================
!macro customUnInit
  StrCpy $PosPurgeData "0"
  ${GetParameters} $PosCmdLine
  ${GetOptions} $PosCmdLine "/PURGEDATA=" $0
  ${IfNot} $0 == ""
    StrCpy $PosPurgeData $0
  ${EndIf}
!macroend

; =============================================================================
;  customUnInstall — clean teardown
; =============================================================================
;  ${isUpdated} is true when the uninstaller is being run by a NEW installer as
;  part of an in-place upgrade. Everything destructive must be skipped in that
;  case, or an auto-update would wipe the shop's ledger.
; =============================================================================
!macro customUnInstall
  SetRegView 64
  SetShellVarContext current       ; $APPDATA = the operator's roaming profile

  ; ---- 1. Stop the service (harmless if it was never installed) -----------
  DetailPrint "Stopping ALUMFAB POS services and processes..."
  nsExec::ExecToLog 'sc.exe stop ${POS_SERVICE_NAME}'
  Pop $0
  ${If} ${FileExists} "$INSTDIR\bin\nssm.exe"
    nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" stop ${POS_SERVICE_NAME}'
    Pop $0
    nsExec::ExecToLog '"$INSTDIR\bin\nssm.exe" remove ${POS_SERVICE_NAME} confirm'
    Pop $0
  ${Else}
    nsExec::ExecToLog 'sc.exe delete ${POS_SERVICE_NAME}'
    Pop $0
  ${EndIf}

  ; ---- 2. Kill any orphaned till process ----------------------------------
  ; electron-builder already asks the user to close a running app, but a
  ; crashed renderer or a session left open on another user account can keep
  ; port ${POS_API_PORT} bound and lock the SQLite file.
  nsExec::ExecToLog 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Sleep 1000

  ${IfNot} ${isUpdated}

    ; ---- 3. Firewall rules ------------------------------------------------
    DetailPrint "Removing firewall rules..."
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${POS_FW_RULE_PORT}"'
    Pop $0
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${POS_FW_RULE_APP}"'
    Pop $0

    ; ---- 4. Auto-start + support keys -------------------------------------
    DeleteRegValue HKLM "${POS_RUN_KEY}" "${POS_RUN_VALUE}"
    DeleteRegValue HKCU "${POS_RUN_KEY}" "${POS_RUN_VALUE}"
    DeleteRegKey   HKLM "${POS_SUPPORT_KEY}"
    DeleteRegKey /ifempty HKLM "Software\ALUMFAB"

    ; ---- 5. Business data: keep or purge ----------------------------------
    StrCpy $PosDataDir "$APPDATA\${POS_DATA_DIRNAME}"

    ${If} ${FileExists} "$PosDataDir\*.*"

      ${If} ${Silent}
        ; Unattended: never destroy data unless explicitly told to.
        ${If} $PosPurgeData != "1"
          StrCpy $PosPurgeData "0"
        ${EndIf}
      ${Else}
        ; Interactive: default answer is KEEP. Deleting a shop's sales ledger
        ; and GST records is irreversible, so it takes two deliberate clicks.
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
          "Keep your ALUMFAB POS business data?$\r$\n$\r$\nThis includes the sales database, customer ledgers, invoice history and all local backups stored in:$\r$\n$PosDataDir$\r$\n$\r$\nYES  —  Keep the data (recommended). A future reinstall picks up exactly where you left off.$\r$\nNO   —  Permanently delete everything." \
          /SD IDYES IDYES lbl_keep_data

        MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 \
          "Final confirmation.$\r$\n$\r$\nAll sales records, customer balances, invoices and database backups will be permanently deleted. This cannot be undone, and these records may be required for tax filing.$\r$\n$\r$\nDelete everything?" \
          /SD IDNO IDYES lbl_purge_data
        Goto lbl_keep_data

        lbl_purge_data:
          StrCpy $PosPurgeData "1"
        lbl_keep_data:
      ${EndIf}

      ${If} $PosPurgeData == "1"
        DetailPrint "Deleting business data at $PosDataDir ..."
        RMDir /r "$PosDataDir\database"
        RMDir /r "$PosDataDir\backups"
        RMDir /r "$PosDataDir\logs"
        RMDir /r "$PosDataDir\assets"
        RMDir /r "$PosDataDir"
        DetailPrint "Business data removed."
      ${Else}
        DetailPrint "Business data preserved at $PosDataDir"
        ${IfNot} ${Silent}
          MessageBox MB_OK|MB_ICONINFORMATION \
            "Your ALUMFAB POS data has been kept at:$\r$\n$PosDataDir$\r$\n$\r$\nReinstalling ALUMFAB POS on this machine will reconnect to it automatically." \
            /SD IDOK
        ${EndIf}
      ${EndIf}

    ${EndIf}

    ; ---- 6. electron-updater cache ----------------------------------------
    ; Downloaded-but-not-yet-applied update packages. Always safe to remove.
    RMDir /r "$LOCALAPPDATA\${PRODUCT_FILENAME}-updater"
    RMDir /r "$LOCALAPPDATA\alumfab-pos-updater"

  ${EndIf}
!macroend
