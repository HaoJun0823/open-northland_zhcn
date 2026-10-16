# Isolate the browser crash during portable save export

**Area:** app, tooling · **Focus:** browser save export · **Priority:** P3

Two headed Playwright persistent Chromium sessions closed during or shortly after exporting a
tutorial001 save through the normal save window. Matching macOS crash reports record
`EXC_BAD_ACCESS` / `SIGSEGV` on Chromium's main thread. These are confirmed native browser crashes;
the cause is not yet isolated to the app, browser or automation. Local saves remained available.

Observed environment: Google Chrome for Testing 153.0.8010.12 on macOS 27.0 (26A428), a muted windowed
persistent profile, one game browser capped at 30 FPS. The first crash occurred while exporting a
paused lesson around 10,800 simulation ticks; the download's `saveAs` failed because the target
closed. A second session exported a small early save successfully, then the browser closed within
29 seconds. A completed download alone therefore does not establish a passing export check. No
JavaScript error was recorded before either closure.

## Scope

Investigate the actual export path in `view/runtime/save-load/controller.ts` and `file-access.ts`,
then `diag/download.ts`. Reproduce with a disposable persistent profile and a freshly created save;
compare a minimal Blob download, a small save, and a later lesson save. Capture browser process exit
and crash diagnostics. Keep saved data intact and distinguish a browser/automation failure from an
application failure before changing either. Do not weaken save validation to work around the crash.

## Verify

Verify repeated normal UI exports complete, the downloaded saves import and restore, and the browser
stays alive. If isolated to the automation browser, use a verified supported launch configuration or
version and document that boundary without claiming an engine fix.
