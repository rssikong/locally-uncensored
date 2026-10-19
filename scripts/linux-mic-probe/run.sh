#!/bin/bash
# Runs inside rust:1-bookworm with the repository at /src (read only) and a
# writable /chk. Builds the probe against the real WebKitGTK and runs it under
# Xvfb with a PulseAudio sine wave as the default microphone.
#
#   docker run --rm -v "$PWD":/src:ro -v ~/.cargo/registry:/usr/local/cargo/registry \
#     -v /some/dir:/chk rust:1-bookworm bash /src/scripts/linux-mic-probe/run.sh
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends libwebkit2gtk-4.1-dev libgtk-3-dev pkg-config build-essential \
  xvfb xauth dbus dbus-x11 pulseaudio pulseaudio-utils \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-pulseaudio >/dev/null
echo "webkit2gtk: $(dpkg-query -W -f '${Version}' libwebkit2gtk-4.1-0)  gstreamer: $(dpkg-query -W -f '${Version}' libgstreamer1.0-0)"

mkdir -p /work/src-tauri/src /work/scripts
cp /src/src-tauri/src/linux_media.rs /work/src-tauri/src/
cp -r /src/scripts/linux-mic-probe /work/scripts/
cp /src/src-tauri/Cargo.lock /work/scripts/linux-mic-probe/Cargo.lock
cd /work/scripts/linux-mic-probe
CARGO_TARGET_DIR=/chk/target-micprobe CARGO_BUILD_JOBS=2 cargo build --offline -q 2>&1 | grep -E "^(error|warning: unused)" -A6 || true
BIN=/chk/target-micprobe/debug/linux-mic-probe
test -x "$BIN"

Xvfb :99 -screen 0 1024x768x24 >/dev/null 2>&1 &
export DISPLAY=:99
pulseaudio -D --exit-idle-time=-1 --disallow-exit 2>/dev/null || pulseaudio -D --exit-idle-time=-1 --system=false 2>/dev/null || true
sleep 2
pactl load-module module-null-sink sink_name=nullsink >/dev/null
pactl load-module module-sine-source source_name=sine frequency=440 >/dev/null
pactl set-default-source sine
echo "pulse default source: $(pactl info | sed -n 's/^Default Source: //p')"
export WEBKIT_DISABLE_COMPOSITING_MODE=1

for c in "stock lu" "settings lu" "lu lu" "lu foreign"; do
  set -- $c
  out=$(dbus-run-session -- timeout 60 "$BIN" "$1" "$2" 2>/tmp/probe-err.log | grep '^RESULT' || true)
  echo "CASE mode=$1 page=$2 -> ${out:-no RESULT line}"
  [ -n "$out" ] || tail -5 /tmp/probe-err.log
done
