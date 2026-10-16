# Isolate the browser crash during portable save export

**Area:** app, tooling · **Focus:** browser save export · **Priority:** P3

A headed Playwright persistent Chromium session closed during export of an already saved tutorial001
slot. The download's `saveAs` failed because the target closed; the page was closed and the context
contained no pages. A matching macOS crash report records `EXC_BAD_ACCESS` / `SIGSEGV` on Chromium's
main thread. This is one confirmed native browser crash, not yet a reproducible app defect or evidence
of corrupt save data. The preceding local save succeeded; earlier exports in the session succeeded.

Observed environment: Google Chrome for Testing 153.0.8010.12 on macOS 27.0 (26A428), a muted windowed
persistent profile, one game browser capped at 30 FPS. The lesson was paused after the group-travel
exercise, around 10,800 simulation ticks. The selected stored slot was exported through the normal
save window. No JavaScript error was recorded before the browser closed.

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
