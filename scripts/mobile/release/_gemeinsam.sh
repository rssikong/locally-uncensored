#!/bin/bash
# Gemeinsame Teile der Release-Skripte (android-play.sh, android-offen.sh,
# ios-appstore.sh). Wird eingelesen, nie selbst gestartet.
#
# Drei Regeln, die hier gehalten werden und die der Waechter
# src/lib/__tests__/mobile-release-skripte.test.ts prueft:
#   1. Ein Release-Skript nimmt keine Cargo-Features an. Das Feature abnahme
#      (inspizierbare WebView, Testhaken) kann so nicht in ein Paket geraten.
#      VITE_LU_ABNAHME wird zusaetzlich aus der Umgebung geloescht.
#   2. Jedes Paket wird nach dem Bau auf den Testhaken geprueft
#      (pruefe-testhaken.sh), sonst endet das Skript mit Fehler.
#   3. Hochgeladen wird nie von selbst: nur mit --upload UND dem
#      Bestaetigungswort hinter --confirm. Zugangsdaten kommen nur aus der
#      Umgebung, kein Skript schreibt sie in eine Datei.
#   4. --probe ist der Probelauf des ganzen Weges, bevor es die echte
#      Meldeadresse gibt: er setzt fuer die Store-Presets eine Platzhalter-
#      Adresse (eine Domain unter .invalid, die es nie gibt) und lockert sonst
#      NICHTS. Ein Probe-Paket heisst PROBE, liegt in einem Ordner PROBE-...,
#      sein Baubeleg sagt probe, und es wird nie hochgeladen: --probe und
#      --upload schliessen sich aus, und die Stelle vor dem Upload sieht noch
#      einmal nach.
#
# Meldungen sind englisch, weil sie beim Abbruch das sind, was man liest.

RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$(cd "$RELEASE_DIR/../../.." && pwd)"

DRY_RUN=0
UPLOAD=0
PROBE=0
# Die Adresse des Probelaufs. .invalid ist fuer genau so etwas reserviert
# (RFC 2606): kein Rechner der Welt antwortet darunter, nichts wird gesendet.
PROBE_MELDEADRESSE="https://lu-release-probe.invalid/report"
CONFIRM=""
ERWARTETE_VERSION=""
FEHLT=()

ok()      { printf '  ok       %s\n' "$1"; }
note()    { printf '  note     %s\n' "$1"; }
missing() { printf '  MISSING  %s\n' "$1"; FEHLT+=("$1"); }
abbruch() { printf 'ABORT: %s\n' "$1" >&2; exit 2; }

# argumente_lesen <bestaetigungswort oder leer> "$@"
# Ein leeres Bestaetigungswort heisst: dieses Ziel kennt keinen Upload.
argumente_lesen() {
  local wort="$1"
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --probe) PROBE=1 ;;
      --version)
        [ $# -ge 2 ] || abbruch "--version needs a value, for example --version 3.0.7"
        ERWARTETE_VERSION="$2"
        shift ;;
      --upload)
        [ -n "$wort" ] || abbruch "this target has no upload step. The package is a file you publish yourself."
        UPLOAD=1 ;;
      --confirm)
        [ $# -ge 2 ] || abbruch "--confirm needs the confirmation word"
        CONFIRM="$2"
        shift ;;
      -h|--help) hilfe; exit 0 ;;
      *) abbruch "unknown argument '$1'. A release script takes no build type and no cargo features, only --version, --dry-run, --probe${wort:+, --upload --confirm $wort}." ;;
    esac
    shift
  done
  if [ "$PROBE" = "1" ] && [ "$UPLOAD" = "1" ]; then
    abbruch "--probe and --upload exclude each other. A probe package is never uploaded: a probe of a store preset carries a placeholder instead of the report service address."
  fi
  if [ "$UPLOAD" = "1" ] && [ "$CONFIRM" != "$wort" ]; then
    abbruch "--upload sends the package to the store. It needs the confirmation word: --upload --confirm $wort"
  fi
  if [ "$UPLOAD" = "0" ] && [ -n "$CONFIRM" ]; then
    abbruch "--confirm without --upload does nothing. The upload is off unless you pass --upload --confirm $wort"
  fi
  return 0
}

# node und cargo in den PATH, wie in den Bauskripten.
umgebung_setzen() {
  if ! command -v node >/dev/null 2>&1; then
    local nvm_node
    nvm_node="$(find "$HOME/.nvm/versions/node" -maxdepth 2 -name bin -type d 2>/dev/null | sort -V | tail -1)"
    [ -n "$nvm_node" ] && export PATH="$nvm_node:$PATH"
  fi
  export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"
  # Der Testhaken gehoert nie in ein Paket, das veroeffentlicht wird. Die
  # Variable verschwindet hier, gleich was die Shell des Aufrufers traegt.
  if [ -n "${VITE_LU_ABNAHME:-}" ]; then
    note "VITE_LU_ABNAHME was set in this shell. It is removed: a release never carries the test hook."
  fi
  unset VITE_LU_ABNAHME
  # Nur =mobile packt die Handy-Oberflaeche ein (Lieferzweig, src/main.tsx).
  export VITE_LU_BUILD_TARGET=mobile
  # Der Probelauf sagt es jedem Skript, das er startet (bau-beleg.sh schreibt
  # es in den Baubeleg, die Paketpruefung liest es dort). Ohne --probe ist die
  # Variable weg, gleich was die Shell des Aufrufers traegt.
  unset LU_RELEASE_PROBE
  if [ "$PROBE" = "1" ]; then export LU_RELEASE_PROBE=1; fi
}

# Baupfade aus dem Programm (Sicherheitspruefung r49, Fund N2): ohne
# Umschreibung stehen im nativen Programm die Quellpfade des Baurechners,
# also Heimordner und Benutzername (Rust: Panikorte und file!(), C und C++
# von llama.cpp: __FILE__ in den Assertions). Hier werden sie fuer genau ein
# Rust-Ziel auf neutrale Namen umgeschrieben:
#   Heimordner -> /home, Cargo -> /cargo, rustup -> /rustup, Arbeitsbaum -> /lu
#
# pfade_umschreiben <rust-ziel> [<flag> ...]
#   Rust: CARGO_ENCODED_RUSTFLAGS. Sie schlaegt RUSTFLAGS und die
#   rustflags des Ziels, darum nimmt sie mit, was schon gilt: die Flags der
#   Shell (CARGO_ENCODED_RUSTFLAGS oder RUSTFLAGS), dann die mitgegebenen
#   (die Flags, die die Tauri-CLI sonst selbst fuer das Ziel setzt), dann die
#   Umschreibungen. Bei rustc gewinnt die letzte passende Umschreibung, darum
#   steht der Heimordner vorn und das Genauere dahinter.
#   C und C++: CFLAGS_<ziel> und CXXFLAGS_<ziel> (gelesen vom cc- und
#   cmake-Bau der Abhaengigkeiten) mit -ffile-prefix-map, angehaengt an das,
#   was dort oder in CFLAGS/CXXFLAGS schon steht. Ein Pfad mit Leerzeichen
#   laesst sich dort nicht trennen und bleibt aussen vor (der Heimordner
#   deckt ihn dann).
#   Die Seitengroesse fuer 16 KB setzt build.rs als Linker-Argument, sie
#   haengt nicht an diesen Variablen.
pfade_umschreiben() {
  local ziel="$1" us=$'\x1f' teil alt neu cvar cxxvar cflags cxxflags
  shift
  local flags=() paare=()
  if [ -n "${CARGO_ENCODED_RUSTFLAGS:-}" ]; then
    while IFS= read -r -d "$us" teil; do [ -n "$teil" ] && flags+=("$teil"); done <<< "${CARGO_ENCODED_RUSTFLAGS}${us}"
  elif [ -n "${RUSTFLAGS:-}" ]; then
    # shellcheck disable=SC2206
    flags=($RUSTFLAGS)
  fi
  flags+=("$@")
  paare=(
    "$HOME=/home"
    "${CARGO_HOME:-$HOME/.cargo}=/cargo"
    "${RUSTUP_HOME:-$HOME/.rustup}=/rustup"
    "$WURZEL=/lu"
  )
  for teil in "${paare[@]}"; do flags+=("--remap-path-prefix=$teil"); done
  CARGO_ENCODED_RUSTFLAGS="$(IFS="$us"; printf '%s' "${flags[*]}")"
  export CARGO_ENCODED_RUSTFLAGS
  unset RUSTFLAGS

  cvar="CFLAGS_${ziel//-/_}"
  cxxvar="CXXFLAGS_${ziel//-/_}"
  cflags="${!cvar:-${CFLAGS:-}}"
  cxxflags="${!cxxvar:-${CXXFLAGS:-}}"
  for teil in "${paare[@]}"; do
    alt="${teil%=*}"
    neu="${teil##*=}"
    case "$alt" in *[[:space:]]*) continue ;; esac
    cflags="${cflags:+$cflags }-ffile-prefix-map=$alt=$neu"
    cxxflags="${cxxflags:+$cxxflags }-ffile-prefix-map=$alt=$neu"
  done
  export "$cvar=$cflags" "$cxxvar=$cxxflags"
  note "build paths of $ziel are rewritten (home folder, cargo, rustup, working tree): the native program names no folder of this machine"
}

# iOS: die C-Flags aus pfade_umschreiben als Cargo-Konfiguration fuer genau
# einen Lauf (Integration 306, Abschnitt 35 und 36). Auf iOS ruft Xcode cargo
# ueber `tauri ios xcode-script` auf. Dorthin reicht die Tauri-CLI aus der
# Shell nur Variablen mit CARGO_, RUST_, TAURI und WRY weiter, und das
# xcode-script setzt CFLAGS_<ziel> selbst neu (nur -isysroot). Die Variablen
# der Shell kommen also nie beim cc- und cmake-Bau von llama.cpp an.
# Eine Cargo-Konfiguration [env] mit force gilt dagegen fuer jedes Bauskript,
# gleich wer cargo startet. Sie liegt in .cargo/config.toml an der Wurzel des
# Arbeitsbaums (cargo sucht vom Ordner src-tauri aus nach oben) und wird am
# Ende des Laufs entfernt (pfade_konfig_entfernen, auch im trap).
#   CFLAGS_<ziel>    -isysroot <sdk> (was das xcode-script setzt) und die Umschreibungen
#   CXXFLAGS_<ziel>  die Umschreibungen (das xcode-script setzt hier nichts)
#   OBJCFLAGS, OBJCXXFLAGS  die Umschreibungen (CMake liest sie fuer ggml-metal.m)
#
# pfade_als_cargo_konfig <rust-ziel> <sysroot>   (nach pfade_umschreiben)
PFADE_KONFIG=""
pfade_als_cargo_konfig() {
  local ziel="$1" sysroot="$2" u cvar cxxvar cflags cxxflags nur ordner
  u="${ziel//-/_}"
  cvar="CFLAGS_$u"
  cxxvar="CXXFLAGS_$u"
  cflags="${!cvar:-}"
  cxxflags="${!cxxvar:-}"
  case "$cflags" in *-ffile-prefix-map=*) ;; *) abbruch "pfade_als_cargo_konfig: call pfade_umschreiben $ziel first" ;; esac
  # shellcheck disable=SC2086
  nur="$(printf '%s\n' $cflags | grep -e '^-ffile-prefix-map=' | tr '\n' ' ' | sed 's/ $//')"
  ordner="$WURZEL/.cargo"
  if [ -e "$ordner" ]; then
    abbruch "$ordner exists already. It is not from this script; move it away (cargo would read it for every build in this working tree)."
  fi
  mkdir "$ordner"
  PFADE_KONFIG="$ordner"
  toml() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
  {
    echo "# Written by scripts/mobile/release for one iOS build, removed at its end."
    echo "# It rewrites the build paths of C, C++ and Objective-C code (llama.cpp)."
    echo "[env]"
    printf '%s = { value = "%s", force = true }\n' "$cvar" "$(toml "-isysroot $sysroot $cflags")"
    printf '%s = { value = "%s", force = true }\n' "$cxxvar" "$(toml "$cxxflags")"
    printf 'OBJCFLAGS = { value = "%s", force = true }\n' "$(toml "$nur")"
    printf 'OBJCXXFLAGS = { value = "%s", force = true }\n' "$(toml "$nur")"
  } > "$PFADE_KONFIG/config.toml"
  note "build paths of C, C++ and Objective-C code for $ziel go through a cargo configuration for this run (Xcode does not hand the shell variables to cargo)"
}
pfade_konfig_entfernen() {
  if [ -n "$PFADE_KONFIG" ]; then rm -rf "$PFADE_KONFIG"; PFADE_KONFIG=""; fi
}

# Die zweite Sperre, direkt vor jedem Upload-Befehl. argumente_lesen hat
# --probe mit --upload schon abgelehnt, hier steht es noch einmal an der
# Stelle, an der es zaehlt.
kein_upload_im_probelauf() {
  if [ "$PROBE" != "0" ] || [ -n "${LU_RELEASE_PROBE:-}" ]; then
    abbruch "this is a probe run. A probe package is never uploaded."
  fi
}

# Liegt der Pfad in einem Git-Arbeitsbaum? Dann gehoert dort kein Schluessel hin.
im_git_baum() {
  local p
  p="$(cd "$(dirname "$1")" 2>/dev/null && pwd -P)" || return 1
  while [ "$p" != "/" ] && [ -n "$p" ]; do
    [ -e "$p/.git" ] && return 0
    p="$(dirname "$p")"
  done
  return 1
}

# pruefe_allgemein <preset> <android|ios>: was jedes Ziel braucht.
pruefe_allgemein() {
  local preset="$1" plattform="$2" aus zeile frei mindest stand

  if [ "$PROBE" = "1" ]; then
    note "PROBE RUN: the package is named PROBE, goes into a folder PROBE-..., and is never uploaded. Every check is the same as in a real run."
    case "$preset" in
      open) ;;
      *)
        if [ -n "${VITE_LU_REPORT_URL:-}" ] && [ "$VITE_LU_REPORT_URL" != "$PROBE_MELDEADRESSE" ]; then
          note "PROBE RUN: VITE_LU_REPORT_URL from this shell is not used."
        fi
        export VITE_LU_REPORT_URL="$PROBE_MELDEADRESSE" ;;
    esac
  fi

  if command -v node >/dev/null 2>&1; then ok "node $(node -v)"; else missing "node is not in the PATH"; fi
  if command -v cargo >/dev/null 2>&1; then ok "cargo"; else missing "cargo is not in the PATH (rustup)"; fi
  if [ -x "$WURZEL/node_modules/.bin/tauri" ]; then ok "tauri cli (node_modules)"; else missing "node_modules/.bin/tauri does not exist. Run: npm ci"; fi

  # Feature abnahme darf kein Standard-Feature sein, sonst truege es jeder Bau.
  if grep -q -E '^default *= *\[[^]]*abnahme' "$WURZEL/src-tauri/Cargo.toml"; then
    missing "src-tauri/Cargo.toml lists abnahme in the default features. Every build would be an acceptance build."
  else
    ok "feature abnahme is not a default feature, and this script passes no features"
  fi

  # Die Version: genannt, gesetzt, in allen Dateien dieselbe.
  if ! command -v node >/dev/null 2>&1; then
    missing "version not checked: node is missing"
  elif [ -z "$ERWARTETE_VERSION" ]; then
    stand="$(node "$RELEASE_DIR/handy-version.mjs" zeige "$plattform" 2>/dev/null || true)"
    missing "--version is not given. Name the version you are about to ship, for example --version 3.0.7. The files carry: ${stand:-unknown}"
  else
    if aus="$(node "$RELEASE_DIR/handy-version.mjs" pruefe --erwartet "$ERWARTETE_VERSION" 2>&1)"; then
      ok "version $(node "$RELEASE_DIR/handy-version.mjs" zeige "$plattform" | sed 's/ / (build number /; s/$/)/')"
    else
      while IFS= read -r zeile; do
        [ -n "$zeile" ] && missing "wrong version: $zeile"
      done <<EOF_VERSION
$aus
EOF_VERSION
    fi
  fi

  # Die Seite About zeigt die Version des Handy-Pakets, nicht die des Desktops:
  # der Handy-Bau bekommt sie als Bau-Konstante (src/dev/phone-version.ts).
  # Fehlt eine der zwei Stellen, zeigte die App wieder die Version aus package.json.
  if grep -q "typeof __LU_PHONE_VERSION__ === 'string'" "$WURZEL/src/mobile/screens/settings/parts/app-info.ts" 2>/dev/null \
    && grep -q 'define: PHONE_DEFINE' "$WURZEL/vite.config.ts" 2>/dev/null; then
    ok "the About page shows the version of the phone package (build constant), the desktop version in package.json may differ"
  else
    missing "the About page does not read the version of the phone package: src/mobile/screens/settings/parts/app-info.ts has to read __LU_PHONE_VERSION__ and vite.config.ts has to define it (src/dev/phone-version.ts). Without that the app shows the desktop version of package.json."
  fi

  # Preset und Meldeadresse: dieselbe Pruefung wie in den Bauskripten.
  if VITE_LU_STORE_PRESET="$preset" "$WURZEL/scripts/mobile/store-bau-pruefen.sh" release >/dev/null 2>&1; then
    case "$preset" in
      open) ok "preset open (no report service needed)" ;;
      *)
        case "${VITE_LU_REPORT_URL:-}" in
          *example.*|*.invalid|*.invalid/*|*.invalid:*|*localhost*|*127.0.0.1*|*'...'*|*'<'*)
            if [ "$PROBE" = "1" ] && [ "$VITE_LU_REPORT_URL" = "$PROBE_MELDEADRESSE" ]; then
              note "PROBE RUN: preset $preset is built with the placeholder $PROBE_MELDEADRESSE instead of the report service address. No report of this package reaches anybody."
            else
              missing "VITE_LU_REPORT_URL is a placeholder, not the real address of the report service"
            fi ;;
          *) ok "preset $preset, report service address is set (https)" ;;
        esac ;;
    esac
  else
    missing "VITE_LU_REPORT_URL is not set to an https address. Preset $preset needs the address of the report service, both stores demand that a report reaches the maker."
  fi

  # Eine Vorab-Version (X.Y.Z-preN, version-setzen.sh) ist nur fuer den offenen
  # Bau: die Stores nehmen nur Zahlen, und ein Vorab-Paket gehoert in keinen.
  if [ -n "$ERWARTETE_VERSION" ] && command -v node >/dev/null 2>&1 && node "$RELEASE_DIR/handy-version.mjs" vorab "$ERWARTETE_VERSION"; then
    if [ "$preset" = "open" ]; then
      note "pre-release $ERWARTETE_VERSION: for testers by direct download only, its build number lies below the release"
    else
      missing "$ERWARTETE_VERSION is a pre-release. It is built only with android-offen.sh (preset open), never for a store"
    fi
  fi

  # Die Handy-Oberflaeche: auf dem Lieferzweig entscheidet VITE_LU_BUILD_TARGET.
  if grep -q 'VITE_LU_BUILD_TARGET' "$WURZEL/src/dev/store-build-check.ts" 2>/dev/null; then
    if grep -q 'VITE_LU_BUILD_TARGET=mobile' "$WURZEL/src-tauri/tauri.$plattform.conf.json"; then
      ok "tauri.$plattform.conf.json builds the phone interface (VITE_LU_BUILD_TARGET=mobile)"
    else
      missing "tauri.$plattform.conf.json does not set VITE_LU_BUILD_TARGET=mobile in beforeBuildCommand. The package would carry the desktop interface."
    fi
  else
    note "this branch picks the phone interface at run time. VITE_LU_BUILD_TARGET=mobile is exported for the delivery branch."
  fi

  # Platz: ein Rust-Bau-Cache hat 7 bis 48 GB (AGENTEN-REGELN.md).
  mindest="${LU_MIN_FREE_GB:-40}"
  frei="$(df -g "$WURZEL" | awk 'NR==2{print $4}')"
  if [ "${frei:-0}" -ge "$mindest" ]; then ok "$frei GB free on the disk"; else missing "only ${frei:-?} GB free on the disk, a build needs $mindest GB (LU_MIN_FREE_GB overrides)"; fi

  # Kein Abbruchgrund, aber man soll wissen, woraus das Paket entsteht.
  note "branch $(git -C "$WURZEL" branch --show-current 2>/dev/null || echo '?'), commit $(git -C "$WURZEL" rev-parse --short HEAD 2>/dev/null || echo '?'), $(git -C "$WURZEL" status --porcelain 2>/dev/null | wc -l | tr -d ' ') uncommitted file(s)"
}

# Am Ende der Vorpruefung: Trockenlauf meldet und endet, ein echter Lauf bricht bei Luecken ab.
vorpruefung_abschliessen() {
  local name="$1" i
  echo
  if [ ${#FEHLT[@]} -gt 0 ]; then
    echo "$name: ${#FEHLT[@]} thing(s) missing:"
    i=1
    for zeile in "${FEHLT[@]}"; do
      echo "  $i. $zeile"
      i=$((i + 1))
    done
    if [ "$DRY_RUN" = "1" ]; then
      echo "DRY RUN: nothing was built, nothing was uploaded."
      exit 1
    fi
    echo "ABORT: nothing was built. Fix the list above, then run again (--dry-run checks without building)." >&2
    exit 2
  fi
  if [ "$DRY_RUN" = "1" ]; then
    echo "$name: nothing is missing."
    echo "DRY RUN: nothing was built, nothing was uploaded. Run again without --dry-run to build."
    exit 0
  fi
  echo "$name: nothing is missing, building."
}

# seite_traegt_version <version>: die gebaute Seite (dist) nennt die Version, mit
# der sie gebaut wurde, in index.html (src/dev/phone-version.ts). Sie muss die
# des Pakets sein, sonst zeigt die Seite About eine andere Version als der Store.
seite_traegt_version() {
  local version="$1" ist
  ist="$(sed -n 's/.*<meta name="lu-phone-version" content="\([^"]*\)">.*/\1/p' "$WURZEL/dist/index.html" 2>/dev/null | head -1 || true)"
  if [ "$ist" = "$version" ]; then
    echo "[page] ok    the built page carries version $version (About shows what the package says)"
  else
    abbruch "wrong version in the built page: dist/index.html says '${ist:-nothing}', the package is $version. The About page would show another version than the store."
  fi
}

# Wohin die fertigen Pakete gelegt werden: ein eigener Ordner je Ziel, Version
# und Baunummer, AUSSERHALB des Bauordners. Play und der offene Bau schreiben
# ihr APK im Bauordner an dieselbe Stelle, der zweite Bau loescht das erste.
# Standard ist der Ordner release-pakete neben dem Arbeitsbaum, die Variable
# LU_RELEASE_PAKETE nennt einen anderen.
ABLAGE_WURZEL="${LU_RELEASE_PAKETE:-$(dirname "$WURZEL")/release-pakete}"
ABLAGE=""

# paket_ablegen <ziel> <android|ios> <paket> [<paket> ...]
# Kopiert jedes Paket mit seinem Baubeleg nach
#   $ABLAGE_WURZEL/<ziel>-<version>-<baunummer>/LU-<ziel>-<version>-<baunummer>.<endung>
# und schreibt SHA256SUMS dazu. Liegt dort schon etwas (derselbe Bau noch
# einmal), wird der alte Ordner zur Seite gestellt, nie ueberschrieben.
# Danach steht der Ordner in ABLAGE.
# Im Probelauf (--probe): Ordner PROBE-<ziel>-..., Dateien PROBE-<ziel>-...,
# dazu PROBE-NICHT-VEROEFFENTLICHEN.txt, und das Paket verschwindet aus dem
# Bauordner.
paket_ablegen() {
  local ziel="$1" plattform="$2" code name paket beleg kopie
  shift 2
  code="$(node "$RELEASE_DIR/handy-version.mjs" zeige "$plattform" | cut -d' ' -f2)"
  name="$ziel-$ERWARTETE_VERSION-$code"
  # Ein Probe-Paket traegt PROBE im Ordner UND im Dateinamen.
  if [ "$PROBE" = "1" ]; then name="PROBE-$name"; fi
  mkdir -p "$ABLAGE_WURZEL"
  if im_git_baum "$ABLAGE_WURZEL/x"; then
    abbruch "the folder for finished packages ($ABLAGE_WURZEL) lies inside a git working tree. Name a folder outside every repository in LU_RELEASE_PAKETE."
  fi
  ABLAGE="$ABLAGE_WURZEL/$name"
  if [ -e "$ABLAGE" ]; then
    mv "$ABLAGE" "$ABLAGE.frueher-$(date +%Y%m%d-%H%M%S)"
  fi
  mkdir -p "$ABLAGE"
  for paket in "$@"; do
    [ -f "$paket" ] || abbruch "cannot put away $paket: the file does not exist"
    kopie="LU-$name.${paket##*.}"
    if [ "$PROBE" = "1" ]; then kopie="$name.${paket##*.}"; fi
    cp "$paket" "$ABLAGE/$kopie"
    # Der Baubeleg ist ueber den Fingerabdruck an das Paket gebunden, nicht ueber den Namen.
    beleg="$paket.bau.json"
    if [ -f "$beleg" ]; then cp "$beleg" "$ABLAGE/$kopie.bau.json"; fi
    # Ein Probe-Paket bleibt nicht unter dem Namen eines echten im Bauordner liegen.
    if [ "$PROBE" = "1" ]; then rm -f "$paket" "$beleg"; fi
  done
  if [ "$PROBE" = "1" ]; then
    printf '%s\n' \
      "PROBE. NOT FOR PUBLICATION." \
      "" \
      "These packages come from a probe run of the release scripts (--probe)." \
      "A probe of a store preset is built with a placeholder instead of the" \
      "address of the report service: no report of generated content reaches" \
      "anybody. Never upload them to a store and never hand them to a user." > "$ABLAGE/PROBE-NICHT-VEROEFFENTLICHEN.txt"
  fi
  ( cd "$ABLAGE" && find . -maxdepth 1 -type f ! -name SHA256SUMS ! -name '*.bau.json' ! -name '*.txt' -exec basename {} \; | sort | xargs shasum -a 256 ) > "$ABLAGE/SHA256SUMS"
  echo "  $ABLAGE"
  sed 's/^/    /' "$ABLAGE/SHA256SUMS"
}

# Nach jedem Handy-Bau schreibt Tauri in verfolgte Dateien (BAUEN.md, Falle 6 und 5.6).
hinweis_nach_dem_bau() {
  echo
  echo "The build rewrote generated files. Before a commit:"
  echo "  git checkout -- src-tauri/gen/schemas src-tauri/gen/apple"
}
