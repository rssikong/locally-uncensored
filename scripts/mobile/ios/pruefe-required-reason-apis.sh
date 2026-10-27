#!/bin/sh
# Sucht im fertigen iOS-Programm nach Symbolen der Required-Reason-APIs von Apple.
# Damit laesst sich PrivacyInfo.xcprivacy gegen den echten Bau pruefen, statt zu raten.
#
# Aufruf:  sh pruefe-required-reason-apis.sh PFAD/zu/LU.app
set -eu
APP="${1:?Pfad zum .app angeben}"
NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist")"
BIN="$APP/$NAME"
SYMS="$(nm -u "$BIN" 2>/dev/null || true)"
STR="$(strings "$BIN" 2>/dev/null || true)"

zeige() { # Kategorie, Muster fuer Symbole
  TREFFER="$(printf '%s\n' "$SYMS" | grep -E "$2" | sort -u | tr '\n' ' ' || true)"
  if [ -n "$TREFFER" ]; then echo "GEFUNDEN  $1: $TREFFER"; else echo "nichts    $1"; fi
}
echo "Programm: $BIN"
zeige "FileTimestamp (stat, fstat, lstat, getattrlist)" '_(stat|fstat|lstat|fstatat|getattrlist|getattrlistbulk|fgetattrlist)(\$INODE64)?$'
zeige "DiskSpace (statfs, statvfs)"                    '_(statfs|fstatfs|statvfs|fstatvfs)(\$INODE64)?$'
zeige "SystemBootTime (mach_absolute_time)"            '_mach_absolute_time$'
zeige "ActiveKeyboards"                                 'activeInputModes'
if printf '%s\n' "$SYMS $STR" | grep -q 'NSUserDefaults'; then echo "GEFUNDEN  UserDefaults: NSUserDefaults"; else echo "nichts    UserDefaults"; fi
if printf '%s\n' "$STR" | grep -q 'kern.boottime'; then echo "GEFUNDEN  SystemBootTime: sysctl kern.boottime (keine Required-Reason-API, nur zur Einordnung)"; fi
echo
echo "Im Manifest erklaert:"
/usr/libexec/PlistBuddy -c 'Print :NSPrivacyAccessedAPITypes' "$APP/PrivacyInfo.xcprivacy" 2>/dev/null | grep -E 'Category|\.[0-9]$' | sed 's/^ */  /' || echo "  KEIN PrivacyInfo.xcprivacy im Paket"
