#!/usr/bin/env bash
#
# verify-mac-bundle.sh: is this LU.app the thing the release promises?
#
# It judges the BUILT bundle, not the configuration it was built from, and it
# asks only questions that need no certificate, so the same script runs on the
# ad hoc signed build of ci.yml's macos-gate, on the signed build of
# release.yml's build-tauri-macos before anything is uploaded, and on a
# developer's Mac:
#
#   1. Every Mach-O file in the bundle is arm64 and nothing else. Not
#      universal, not x86_64: the release ships one architecture, and the
#      updater key is `darwin-aarch64`.
#   2. Every Mach-O file runs on the oldest macOS LU supports (`minos` of its
#      LC_BUILD_VERSION). A sidecar stamped with the build machine's OS
#      refuses to start on every older Mac.
#   3. The main program named in Info.plist and every sidecar of
#      tauri.macos.conf.json (llama-server, llama-quantize) are there and
#      executable.
#   4. Contents/Resources holds every file `bundle.resources` in
#      tauri.conf.json names. The app reads them at run time (Voice, the
#      private Python), and a bundler that drops one still exits 0.
#   5. Info.plist carries the minimum system, the version and the identifier
#      of the configuration, and the usage descriptions without which macOS
#      refuses the microphone and the local network without asking.
#
# Signature, notarization and the stapled ticket are NOT judged here. They
# need the Developer ID and stay in release.yml.
#
# Usage:
#   scripts/verify-mac-bundle.sh <path/to/LU.app>
#   scripts/verify-mac-bundle.sh --allow-stub-sidecar <path/to/LU.app>
#
# --allow-stub-sidecar accepts EMPTY sidecars (lu-llama-server and, since
# 3.0.8, lu-llama-quantize). ci.yml's macos-gate bundles zero-byte
# placeholders because it does not build llama.cpp.
# The release lane never passes it.
#
# MIN_MACOS overrides the minimum system (default: tauri.macos.conf.json).
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CONF_DIR="${CONF_DIR:-$ROOT/src-tauri}"

SIDECAR_NAME="lu-llama-server"
REQUIRED_PLIST_KEYS="NSMicrophoneUsageDescription NSLocalNetworkUsageDescription"

failures=0
ok() { printf 'OK:   %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; failures=$((failures + 1)); }

allow_stub=0
app=""
for arg in "$@"; do
  case "$arg" in
    --allow-stub-sidecar) allow_stub=1 ;;
    -*) printf 'unknown option: %s\n' "$arg" >&2; exit 2 ;;
    *) app="$arg" ;;
  esac
done
[ -n "$app" ] || { printf 'usage: %s [--allow-stub-sidecar] <path/to/LU.app>\n' "$0" >&2; exit 2; }
[ -d "$app/Contents" ] || { printf 'FAIL: %s is not an app bundle\n' "$app" >&2; exit 1; }

conf() {
  # conf <file> <dotted.path>: one value from a JSON file under src-tauri.
  node -e '
    const value = process.argv[2].split(".").reduce((o, k) => (o == null ? o : o[k]), require(process.argv[1]))
    if (value == null) process.exit(1)
    process.stdout.write(Array.isArray(value) ? value.join("\n") : String(value))
  ' "$CONF_DIR/$1" "$2"
}

plist="$app/Contents/Info.plist"
plist_value() { /usr/libexec/PlistBuddy -c "Print :$1" "$plist" 2>/dev/null; }

MIN_MACOS="${MIN_MACOS:-$(conf tauri.macos.conf.json bundle.macOS.minimumSystemVersion)}"
[ -n "$MIN_MACOS" ] || { printf 'FAIL: could not read the minimum macOS version\n' >&2; exit 1; }

# "14.0" and "14" compare as (14, 0); a file may ask for less, never for more.
needs_newer_than_min() {
  local have="$1" major minor min_major min_minor
  major="${have%%.*}"; minor="$(printf '%s' "$have" | awk -F. '{print ($2 == "" ? 0 : $2)}')"
  min_major="${MIN_MACOS%%.*}"; min_minor="$(printf '%s' "$MIN_MACOS" | awk -F. '{print ($2 == "" ? 0 : $2)}')"
  [ "$major" -gt "$min_major" ] || { [ "$major" -eq "$min_major" ] && [ "$minor" -gt "$min_minor" ]; }
}

# ── 1 and 2: architecture and minimum OS of every Mach-O file ──────────────
macho_count=0
while IFS= read -r -d '' path; do
  file -b "$path" | grep -q '^Mach-O' || continue
  macho_count=$((macho_count + 1))
  rel="${path#"$app"/}"
  archs="$(lipo -archs "$path" 2>/dev/null)"
  if [ "$archs" = "arm64" ]; then
    ok "$rel is arm64"
  else
    fail "$rel is '${archs:-unreadable}', the release ships arm64 only"
  fi
  minos="$(otool -l "$path" | awk '/LC_BUILD_VERSION/{f=1} f && /minos/ && !done {print $2; done=1}')"
  if [ -z "$minos" ]; then
    fail "$rel names no minimum OS (no LC_BUILD_VERSION)"
  elif needs_newer_than_min "$minos"; then
    fail "$rel needs macOS $minos, LU promises $MIN_MACOS"
  else
    ok "$rel runs from macOS $minos (promised: $MIN_MACOS)"
  fi
done < <(find "$app" -type f -print0)
[ "$macho_count" -gt 0 ] || fail "no Mach-O file at all in $app"

# ── 3: the main program and the sidecar ────────────────────────────────────
main_exe="$(plist_value CFBundleExecutable)"
if [ -z "$main_exe" ]; then
  fail "Info.plist names no CFBundleExecutable"
elif [ ! -x "$app/Contents/MacOS/$main_exe" ] || ! file -b "$app/Contents/MacOS/$main_exe" | grep -q '^Mach-O'; then
  fail "the main program Contents/MacOS/$main_exe is missing or not a Mach-O executable"
else
  ok "main program Contents/MacOS/$main_exe"
fi

# Every sidecar tauri.macos.conf.json bundles, not only llama-server: since
# 3.0.8 lu-llama-quantize ships too (A14, the refusal-removal tool), and a
# release with an empty quantizer passed this check before.
sidecars="$(conf tauri.macos.conf.json bundle.externalBin)" || sidecars=""
printf '%s\n' "$sidecars" | grep -qx "bin/$SIDECAR_NAME" || fail "tauri.macos.conf.json does not bundle bin/$SIDECAR_NAME"
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  name="${entry##*/}"
  sidecar="$app/Contents/MacOS/$name"
  if [ ! -e "$sidecar" ]; then
    fail "the sidecar Contents/MacOS/$name is missing"
  elif [ ! -s "$sidecar" ]; then
    if [ "$allow_stub" -eq 1 ]; then
      ok "sidecar $name is the empty placeholder (--allow-stub-sidecar)"
    else
      fail "the sidecar Contents/MacOS/$name is empty; this is the CI placeholder, not the real program"
    fi
  elif [ ! -x "$sidecar" ] || ! file -b "$sidecar" | grep -q '^Mach-O'; then
    fail "the sidecar Contents/MacOS/$name is not a Mach-O executable"
  else
    ok "sidecar Contents/MacOS/$name"
  fi
done <<< "$sidecars"

# ── 4: the resources the app reads at run time ─────────────────────────────
# The list form of `bundle.resources` keeps each path relative to src-tauri
# under Contents/Resources (read off a built bundle: Contents/Resources/
# resources/whisper_server.py). The patterns are expanded against the source
# tree, so a new file there is expected in the bundle without a second list.
patterns="$(conf tauri.conf.json bundle.resources)" || patterns=""
resource_count=0
failures_before_resources="$failures"
if [ -z "$patterns" ]; then
  fail "tauri.conf.json names no bundle.resources; this check would pass on an empty bundle"
else
  while IFS= read -r pattern; do
    [ -n "$pattern" ] || continue
    matched=0
    # compgen -G expands the pattern without word splitting on spaces.
    while IFS= read -r rel; do
      [ -f "$CONF_DIR/$rel" ] || continue
      matched=$((matched + 1))
      resource_count=$((resource_count + 1))
      if [ ! -f "$app/Contents/Resources/$rel" ]; then
        fail "Contents/Resources/$rel is missing from the bundle (bundle.resources: $pattern)"
      elif ! cmp -s "$CONF_DIR/$rel" "$app/Contents/Resources/$rel"; then
        fail "Contents/Resources/$rel differs from src-tauri/$rel: the bundle was not built from this tree"
      fi
    done < <(cd "$CONF_DIR" && compgen -G "$pattern")
    [ "$matched" -gt 0 ] || fail "bundle.resources pattern '$pattern' matches no file under src-tauri"
  done <<EOF
$patterns
EOF
  [ "$failures" -ne "$failures_before_resources" ] || ok "$resource_count resource file(s) are in Contents/Resources, byte for byte"
fi

# ── 5: Info.plist ──────────────────────────────────────────────────────────
plist_min="$(plist_value LSMinimumSystemVersion)"
if [ "$plist_min" = "$MIN_MACOS" ]; then
  ok "LSMinimumSystemVersion is $plist_min"
else
  fail "LSMinimumSystemVersion is '${plist_min:-missing}', the build promises $MIN_MACOS"
fi

want_version="$(conf tauri.conf.json version)"
have_version="$(plist_value CFBundleShortVersionString)"
if [ -n "$want_version" ] && [ "$have_version" = "$want_version" ]; then
  ok "CFBundleShortVersionString is $have_version"
else
  fail "CFBundleShortVersionString is '${have_version:-missing}', tauri.conf.json says '${want_version:-nothing}'"
fi

want_id="$(conf tauri.conf.json identifier)"
have_id="$(plist_value CFBundleIdentifier)"
if [ -n "$want_id" ] && [ "$have_id" = "$want_id" ]; then
  ok "CFBundleIdentifier is $have_id"
else
  fail "CFBundleIdentifier is '${have_id:-missing}', tauri.conf.json says '${want_id:-nothing}'"
fi

for key in $REQUIRED_PLIST_KEYS; do
  text="$(plist_value "$key")"
  if [ -n "$text" ]; then
    ok "$key: $text"
  else
    fail "Info.plist has no $key; macOS then refuses without asking, or asks with a text that explains nothing"
  fi
done

if [ "$failures" -ne 0 ]; then
  printf 'FAIL: %s finding(s) in %s\n' "$failures" "$app" >&2
  exit 1
fi
printf 'OK: %s is arm64 only, runs from macOS %s, and carries its resources and usage descriptions.\n' "$app" "$MIN_MACOS"
