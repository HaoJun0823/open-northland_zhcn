; The uninstaller is cut from an intermediate installer build; off Windows electron-builder copies that
; exe header as is instead of patching in the uninstall icon, so that build carries it as its own icon.
!ifdef BUILD_UNINSTALLER
  !undef MUI_ICON
  !define MUI_ICON "${MUI_UNICON}"
!endif
