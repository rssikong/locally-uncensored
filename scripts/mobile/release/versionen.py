#!/usr/bin/env python3
"""Rechnet aus der Version in tauri.conf.json die Store-Nummern fuer Android und iOS.

Aufruf:  python3 versionen.py PFAD/zu/src-tauri/tauri.conf.json [BAUNUMMER]
BAUNUMMER ist 0 bis 999, Standard 1. Sie zaehlt hoch, wenn dieselbe Version noch einmal
in einen Store geladen wird.

Schema:  code = major * 10 000 000 + minor * 100 000 + patch * 1 000 + bau
         3.0.5 mit Bau 1 ergibt 30005001.
Grenzen: minor und patch je 0 bis 99, bau 0 bis 999, Obergrenze von Google Play 2 100 000 000.
Vorab:   3.0.7-pre1 mit Bau 0 ergibt 30007000, unter 3.0.7 mit Bau 1 (nur offener Bau, nie ein Store).
"""
import json, re, sys

def codes(version, build=1):
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(-pre[1-9]\d?)?", version)
    if not m:
        raise SystemExit(f"Version {version!r} ist nicht major.minor.patch (oder major.minor.patch-preN)")
    major, minor, patch = map(int, m.groups()[:3])
    # Vorab-Version (nur offener Bau): immer Bau 0, unter jedem echten Bau derselben Version.
    if m.group(4) and build != 0:
        raise SystemExit("Eine Vorab-Version (-preN) hat Baunummer 0")
    if minor > 99 or patch > 99 or not 0 <= build <= 999:
        raise SystemExit("minor und patch hoechstens 99, Baunummer 0 bis 999")
    code = major * 10_000_000 + minor * 100_000 + patch * 1_000 + build
    if code > 2_100_000_000:
        raise SystemExit("versionCode ueber der Grenze von Google Play")
    return code

if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    version = json.load(open(sys.argv[1]))["version"]
    build = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    code = codes(version, build)
    assert codes("2.6.6", 0) > 2006006, "muss ueber dem alten Code von 2.6.6 liegen"
    print(f"version                     {version}")
    print(f"Android versionName         {version}")
    print(f"Android versionCode         {code}")
    print(f"iOS CFBundleShortVersionString  {version}")
    print(f"iOS CFBundleVersion         {code}")
    print()
    print("Uebergabe an Tauri ohne Aenderung im Repo:")
    print(f"""  npx tauri android build --config '{{"bundle":{{"android":{{"versionCode":{code}}}}}}}'""")
    print(f"""  npx tauri ios build --config '{{"bundle":{{"iOS":{{"bundleVersion":"{code}"}}}}}}'""")
