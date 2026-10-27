#!/bin/sh
# Erzeugt einen WEGWERF-Keystore fuer den Android-Release-Bau von LU Mobile.
# Nur fuer lokale Probe-Bauten. Nie fuer eine Veroeffentlichung, nie ins Repo.
#
# Aufruf:   sh make-wegwerf-keystore.sh [ZIELORDNER]
# Standard: $HOME/.lu-mobile-signing/wegwerf
#
# Ergebnis im Zielordner (alles mit Rechten nur fuer den eigenen Nutzer):
#   lu-wegwerf.jks       der Keystore
#   passwort.txt         das zufaellige Passwort, eine Zeile
#   key.properties       storeFile, keyAlias, storePassword, keyPassword fuer Gradle
#
# Das Skript gibt das Passwort nie auf dem Bildschirm aus.
set -eu

ZIEL="${1:-$HOME/.lu-mobile-signing/wegwerf}"
ALIAS="lu-wegwerf"

# keytool finden (macOS liefert nur einen Platzhalter ohne Java mit)
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ]; then
  KEYTOOL="$JAVA_HOME/bin/keytool"
elif [ -x /opt/homebrew/opt/openjdk@17/bin/keytool ]; then
  KEYTOOL=/opt/homebrew/opt/openjdk@17/bin/keytool
elif [ -x "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" ]; then
  KEYTOOL="/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"
else
  KEYTOOL=keytool
fi
"$KEYTOOL" -help >/dev/null 2>&1 || { echo "FEHLER: kein lauffaehiges keytool gefunden. JAVA_HOME setzen." >&2; exit 1; }

mkdir -p "$ZIEL"
ZIEL="$(cd "$ZIEL" && pwd -P)"

# Der Zielordner darf in keinem Git-Arbeitsbaum liegen.
P="$ZIEL"
while [ "$P" != "/" ]; do
  if [ -e "$P/.git" ]; then
    echo "FEHLER: $ZIEL liegt im Git-Arbeitsbaum $P. Einen Ordner ausserhalb jedes Repos waehlen." >&2
    exit 1
  fi
  P="$(dirname "$P")"
done

if [ -e "$ZIEL/lu-wegwerf.jks" ]; then
  echo "Es gibt schon einen Wegwerf-Keystore in $ZIEL. Nichts geaendert."
  echo "Fuer einen neuen den Ordner loeschen und das Skript erneut starten."
  exit 0
fi

umask 077
# 32 Zeichen aus Buchstaben und Ziffern, aus dem Zufallsgenerator des Systems
PASS="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)"
[ "${#PASS}" -eq 32 ] || { echo "FEHLER: Passwort konnte nicht erzeugt werden." >&2; exit 1; }
printf '%s\n' "$PASS" > "$ZIEL/passwort.txt"

# Das Passwort geht ueber die Datei an keytool, nicht ueber die Kommandozeile
# (dort waere es in der Prozessliste sichtbar).
"$KEYTOOL" -genkeypair -v \
  -keystore "$ZIEL/lu-wegwerf.jks" -storetype PKCS12 \
  -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 365 \
  -storepass:file "$ZIEL/passwort.txt" -keypass:file "$ZIEL/passwort.txt" \
  -dname "CN=LU WEGWERF NICHT VEROEFFENTLICHEN, O=Platzhalter, C=DE" >/dev/null 2>&1

{
  printf 'storeFile=%s\n' "$ZIEL/lu-wegwerf.jks"
  printf 'keyAlias=%s\n' "$ALIAS"
  printf 'storePassword=%s\n' "$PASS"
  printf 'keyPassword=%s\n' "$PASS"
} > "$ZIEL/key.properties"
chmod 600 "$ZIEL/passwort.txt" "$ZIEL/key.properties" "$ZIEL/lu-wegwerf.jks"
unset PASS

echo "Wegwerf-Keystore angelegt in: $ZIEL"
echo "Fingerabdruck des Zertifikats:"
"$KEYTOOL" -list -v -keystore "$ZIEL/lu-wegwerf.jks" -storepass:file "$ZIEL/passwort.txt" 2>/dev/null | grep -E "SHA256|Owner|Eigent|Valid|G.ltig" | sed 's/^/  /'
echo
echo "Fuer den Bau:"
echo "  export LU_ANDROID_KEY_PROPERTIES=\"$ZIEL/key.properties\""
