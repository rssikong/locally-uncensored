#!/bin/bash
# Prueft, dass ein Handy-Paket den langen Produktnamen nicht traegt.
#
# Aufruf:  scripts/mobile/release/pruefe-name-im-paket.sh [--alles] <paket> [paket ...]
#          <paket>  ein APK, AAB oder IPA (wird entpackt), ein Ordner LU.app,
#                   ein beliebiger Ordner, oder eine einzelne Datei (das
#                   iOS-Programm LU, eine Android-Bibliothek .so)
#          --alles  zeigt auch die erlaubten Stellen einzeln
# Ende 0:  kein unerlaubter Fund. Ende 1: mindestens einer. Ende 2: falscher Aufruf.
#
# Die Handy-Apps heissen ueberall nur "LU". Die Oberflaeche haelt der
# Store-Waechter (Regel "product name"). Dieses Skript liest, was er nicht
# sieht: das Programm selbst. Eine automatische Store-Pruefung liest es auch.
#
# Vorgehen: `strings -a` ueber jede Datei des Pakets, dazu ein zweiter
# Durchgang fuer Text in UTF-16 (Android-Manifest). In jeder Zeile werden die
# Stellen aus name-im-paket.erlaubt herausgenommen. Was danach noch auf den
# langen Namen passt, ist ein Fund.
#
# Die Seite der App liegt gepackt im Programm und ist hier nicht zu sehen.
# Die liest der Store-Waechter am laufenden Bau.
set -euo pipefail

HIER="$(cd "$(dirname "$0")" && pwd)"
ERLAUBT="${LU_NAME_ERLAUBT:-$HIER/name-im-paket.erlaubt}"
ALLES=0
PAKETE=()
for ARG in "$@"; do
  case "$ARG" in
    --alles) ALLES=1 ;;
    -*) echo "usage: pruefe-name-im-paket.sh [--alles] <package> [package ...]" >&2; exit 2 ;;
    *) PAKETE+=("$ARG") ;;
  esac
done
if [ "${#PAKETE[@]}" -eq 0 ]; then
  echo "usage: pruefe-name-im-paket.sh [--alles] <package> [package ...]" >&2
  exit 2
fi
if [ ! -f "$ERLAUBT" ]; then
  echo "[name] FAIL  the list of allowed places is missing: $ERLAUBT" >&2
  exit 2
fi
for WERKZEUG in strings perl unzip; do
  if ! command -v "$WERKZEUG" >/dev/null 2>&1; then
    echo "[name] FAIL  the tool $WERKZEUG is missing" >&2
    exit 2
  fi
done

ARBEIT="$(mktemp -d "${TMPDIR:-/tmp}/lu-name.XXXXXX")"
trap 'rm -rf "$ARBEIT"' EXIT

# Liest Zeilen "datei<TAB>text", nimmt die erlaubten Stellen heraus und
# schreibt je Fund eine Zeile "FUND<TAB>datei<TAB>ausschnitt" und je erlaubter
# Stelle "ERLAUBT<TAB>muster<TAB>datei<TAB>ausschnitt".
FILTER='
use strict; use warnings;
my ($liste) = @ARGV;
open(my $fh, "<", $liste) or die "cannot read $liste\n";
my @muster;
while (my $zeile = <$fh>) {
  chomp $zeile;
  next if $zeile =~ /^\s*(#|$)/;
  push @muster, $zeile;
}
close $fh;
my $name = qr/locally[ ._-]?uncensored/i;
while (my $zeile = <STDIN>) {
  chomp $zeile;
  my ($datei, $text) = split(/\t/, $zeile, 2);
  next unless defined $text && $text =~ $name;
  for my $m (@muster) {
    while ($text =~ /(.{0,24})($m)(.{0,24})/i) {
      print "ERLAUBT\t$m\t$datei\t$1$2$3\n";
      $text =~ s/$m/\x01/i;
    }
  }
  while ($text =~ /(.{0,70})($name)(.{0,50})/g) {
    my $ausschnitt = "$1$2$3";
    $ausschnitt =~ s/\x01/[..]/g;
    print "FUND\t$datei\t$ausschnitt\n";
  }
}
'

# Text in UTF-16LE (jedes zweite Byte null), wie ihn das Android-Manifest traegt.
UTF16='
use strict; use warnings;
local $/; binmode STDIN; my $bytes = <STDIN>;
while ($bytes =~ /((?:[\x20-\x7e]\x00){6,})/g) { my $t = $1; $t =~ s/\x00//g; print "$t\n"; }
'

lies_datei() {
  # $1 Datei, $2 Name fuer die Ausgabe
  { strings -a "$1" 2>/dev/null || true; perl -e "$UTF16" < "$1" 2>/dev/null || true; } |
    LC_ALL=C grep -a -i -E 'locally[ ._-]?uncensored' |
    LC_ALL=C sed "s|^|$2	|" || true
}

FUNDE=0
for PAKET in "${PAKETE[@]}"; do
  if [ ! -e "$PAKET" ]; then
    echo "[name] FAIL  $PAKET does not exist"
    FUNDE=$((FUNDE + 1))
    continue
  fi
  KURZ="$(basename "$PAKET")"
  WURZEL=""
  EINZELN=""
  if [ -d "$PAKET" ]; then
    WURZEL="$PAKET"
  else
    case "$PAKET" in
      *.apk|*.aab|*.ipa|*.zip|*.aar)
        WURZEL="$ARBEIT/entpackt-$FUNDE-$RANDOM"
        mkdir -p "$WURZEL"
        if ! unzip -q -o "$PAKET" -d "$WURZEL" 2>/dev/null; then
          echo "[name] FAIL  $KURZ cannot be unpacked"
          FUNDE=$((FUNDE + 1))
          continue
        fi
        ;;
      *) EINZELN="$PAKET" ;;
    esac
  fi

  ROH="$ARBEIT/roh.txt"
  : > "$ROH"
  ANZAHL=0
  if [ -n "$EINZELN" ]; then
    lies_datei "$EINZELN" "$KURZ" >> "$ROH"
    ANZAHL=1
  else
    while IFS= read -r DATEI; do
      lies_datei "$DATEI" "${DATEI#"$WURZEL"/}" >> "$ROH"
      ANZAHL=$((ANZAHL + 1))
    done < <(find "$WURZEL" -type f)
  fi
  if [ "$ANZAHL" -eq 0 ]; then
    echo "[name] FAIL  $KURZ holds no file, nothing to check"
    FUNDE=$((FUNDE + 1))
    continue
  fi

  ERGEBNIS="$ARBEIT/ergebnis.txt"
  perl -e "$FILTER" "$ERLAUBT" < "$ROH" > "$ERGEBNIS"
  N_FUND="$(grep -c '^FUND' "$ERGEBNIS" || true)"
  N_ERLAUBT="$(grep -c '^ERLAUBT' "$ERGEBNIS" || true)"

  if [ "$N_ERLAUBT" != "0" ]; then
    echo "[name] note  $KURZ: $N_ERLAUBT allowed internal places ($ANZAHL files read):"
    grep '^ERLAUBT' "$ERGEBNIS" | cut -f2 | sort | uniq -c | sed 's/^ *\([0-9]*\) /[name]         \1 x /'
    if [ "$ALLES" = "1" ]; then
      grep '^ERLAUBT' "$ERGEBNIS" | cut -f3,4 | sed 's/^/[name]           /'
    fi
  fi
  if [ "$N_FUND" != "0" ]; then
    echo "[name] FAIL  $KURZ carries the long product name in $N_FUND places that are not on the list:"
    grep '^FUND' "$ERGEBNIS" | cut -f2,3 | sed 's/^/[name]         /'
    FUNDE=$((FUNDE + N_FUND))
  else
    echo "[name] ok    $KURZ: no long product name outside the allowed internal places ($ANZAHL files read)"
  fi
done

if [ "$FUNDE" != "0" ]; then
  echo "[name] FAIL  $FUNDE finding(s). A text, a file header, a folder name or a user agent of the phone build"
  echo "[name]       belongs in src-tauri/src/app_identity.rs (phone_wording), not on the list of allowed places."
  exit 1
fi
exit 0
