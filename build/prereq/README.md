# Bundled prerequisites

Drop redistributable installers in this folder to make the ALUMFAB POS setup
**fully offline-capable**. `build/installer.nsh` detects each file at *compile
time* and embeds it into `ALUMFAB-POS-Setup-<version>-x64.exe`. If a file is
absent, the installer falls back to downloading it from Microsoft over HTTPS at
install time.

Shops with unreliable or filtered internet should always get the bundled build.

| File | Required? | Download | Adds to installer |
|---|---|---|---|
| `VC_redist.x64.exe` | Recommended | <https://aka.ms/vs/17/release/vc_redist.x64.exe> | ~25 MB |

## Why VC++ 2015-2022 x64?

The Prisma query engine (`query_engine-windows.dll.node`) links against the
MSVC runtime. On a clean Windows 10 LTSC or a freshly imaged till it is
frequently missing, and the failure mode is ugly — the app launches, the window
appears, and every database call throws. Checking for it up front turns a
support call into a silent 20-second install step.

Windows 10 1809+ ships the UCRT itself, so no separate Universal CRT package is
needed.

## Not required

- **.NET Framework** — Electron does not use it. `installer.nsh` checks for 4.8
  and shows an advisory note only, because some OPOS thermal-printer and
  cash-drawer driver packs depend on it.
- **WebView2** — Electron bundles its own Chromium. Do not install it.
- **Node.js** — the Node runtime is embedded inside `ALUMFAB POS.exe`.

## Verifying a bundled redistributable

```powershell
# Confirm authenticity before committing a binary to the repo
Get-AuthenticodeSignature .\VC_redist.x64.exe | Format-List Status, SignerCertificate
```

Status must be `Valid` and the signer must be Microsoft Corporation.

> These binaries are intentionally **not** committed to git (see `.gitignore`).
> Fetch them on the build machine or in CI before running `npm run dist:win`.
