# LU Mobile: Bauen

Stand: 08.10.2026, Branch `feat/mobile`, Basis `v3.0.5`.
Vorher lesen: `MOBILE-ZIEL.md`. Hintergruende: `INVENTUR-UEBERNAHME.md`, `IOS-MACHBARKEIT.md`.

Alle Befehle sind kopierbar und gehen vom Worktree aus, also vom Wurzelordner dieses Repos:

```sh
cd "$(git rev-parse --show-toplevel)"
```

Was hier steht, lief am 08.10.2026 auf diesem Mac (Apple Silicon, macOS 26.3.1, Rust 1.95.0, Node 24.15.0, Xcode 26.6, Simulator-Runtime iOS 26.5). Fallen stehen in Abschnitt 7.

## 1. Was wo liegt

| Datei | Zweck |
|---|---|
| `src-tauri/src/lib.rs` | die ganze App, Einstieg `run()` fuer Desktop, Android und iOS |
| `src-tauri/src/main.rs` | nur die Desktop-Huelle um `run()` |
| `src-tauri/src/commands/engine_inproc.rs` | die eine In-Prozess-Engine fuer Android und iOS |
| `src-tauri/src/commands/engine.rs` | die Engine-Kommandos, Desktop-Sidecar und die Handy-Zwillinge am Ende |
| `src-tauri/src/os_paths.rs` | alle app-eigenen Pfade, Handy-Arm ueber `set_mobile_dirs` |
| `src-tauri/src/disk.rs` | freier Platz, `statvfs` auf dem Handy |
| `src-tauri/Cargo.toml` | Abhaengigkeiten nach Ziel getrennt, Feature `inproc-engine` |
| `src-tauri/.cargo/config.toml` | `IPHONEOS_DEPLOYMENT_TARGET` fuer jeden cargo-Aufruf |
| `src-tauri/tauri.android.conf.json`, `tauri.ios.conf.json` | Overlays: kein Sidecar, Fenster sichtbar |
| `src-tauri/capabilities/mobile.json` | Rechte des einen Webviews auf dem Handy |
| `src-tauri/gen/android/` | das Android-Projekt, eingecheckt |
| `src-tauri/gen/apple/` | das Xcode-Projekt aus `tauri ios init`, eingecheckt, dazu Icons, Startbild, Entitlements, Privacy Manifest |
| `src-tauri/Info.ios.plist` | Berechtigungstexte und Schalter fuer iOS, die CLI mischt sie bei jedem Bau ein |
| `src-tauri/Info.ios.fernzugriff.plist` | die zwei Texte, die nur ein Bau mit Fernzugriff traegt; die Bauskripte reichen sie der CLI je Preset (`scripts/mobile/ios/preset-plist.mjs`) |
| `src-tauri/src/android_entry.rs` | ein `run()` je Prozess auf Android, Prozessende ohne Absturz |
| `scripts/mobile/` | Hilfsskripte (WebView fernsteuern, iOS-Mindestversion pruefen) |
| `scripts/mobile/ios/` | iOS: Bau, Simulatoren, Harness (WebKit Remote Inspector), Belegskripte |
| `scripts/mobile/release/` | Icons neu erzeugen, Baunummer rechnen, Wegwerf-Keystore |

Gates im Rust-Code: `cfg(desktop)` und `cfg(mobile)` fuer Desktop gegen Handy (setzt `tauri-build` aus dem Ziel). `target_os` nur dort, wo Android und iOS sich wirklich unterscheiden (Logziel, Speicherabfrage, Simulator).

## 2. Einmalig

```sh
npm ci
rustup target add aarch64-linux-android aarch64-apple-ios aarch64-apple-ios-sim
```

Der Desktop-Bau braucht die Sidecar-Datei `src-tauri/bin/lu-llama-server-aarch64-apple-darwin`. Sie ist nicht eingecheckt. Ohne sie bricht schon `cargo check` ab ("resource path ... doesn't exist"). Entweder mit `scripts/build-llama.sh` bauen oder aus einem anderen Checkout kopieren, zum Beispiel:

```sh
cp -p ../lu-300-desktop/src-tauri/bin/lu-llama-server-aarch64-apple-darwin src-tauri/bin/
```

Android zusaetzlich (auf diesem Mac vorhanden): JDK 17, Android SDK mit `platform-tools`, `platforms;android-34`, `build-tools;34.0.0`, `ndk;27.2.12479018`, `emulator`, ein Abbild `system-images;android-34;google_apis;arm64-v8a`, und `cmake`.

## 3. Desktop pruefen (die Messlatte)

```sh
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
npx vite build
(cd src-tauri && cargo check)
(cd src-tauri && cargo test)
(cd src-tauri && cargo clippy --all-targets -- -D warnings)
```

Stand 08.10.2026 nach dem Fundament: siehe `JOURNAL.md`, Abschnitt Fundament.

## 4. Android

### 4.1 Umgebung

Vor jedem Bau in derselben Shell:

```sh
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"
export ANDROID_NDK_HOME="$NDK_HOME"
export ANDROID_NDK_ROOT="$NDK_HOME"
export ANDROID_API_LEVEL=24
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$JAVA_HOME/bin:$PATH"
```

`ANDROID_NDK_ROOT` und `ANDROID_API_LEVEL` liest das Build-Skript von `llama-cpp-sys-2` fuer die CMake-Toolchain.

### 4.2 Nur die Rust-Kiste pruefen (ohne Vite und Gradle)

```sh
TC="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin"
export CC_aarch64_linux_android="$TC/aarch64-linux-android24-clang"
export CXX_aarch64_linux_android="$TC/aarch64-linux-android24-clang++"
export AR_aarch64_linux_android="$TC/llvm-ar"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$TC/aarch64-linux-android24-clang"
(cd src-tauri && cargo check --target aarch64-linux-android --lib)
```

### 4.3 APK bauen

```sh
touch src-tauri/tauri.conf.json
npx tauri android build --debug --target aarch64
# Ergebnis:
# src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

Release. Die Signatur kommt nur ueber die Umgebungsvariable `LU_ANDROID_KEY_PROPERTIES`, die auf eine `key.properties` ausserhalb des Repos zeigt. Ohne die Variable ist der Release unsigniert und laesst sich nicht installieren. Eine `key.properties` im Projektordner liest Gradle nicht von selbst.

```sh
# einmalig: Wegwerf-Schluessel unter ~/.lu-mobile-signing/wegwerf (nie fuer eine Veroeffentlichung)
sh scripts/mobile/release/make-wegwerf-keystore.sh

export LU_ANDROID_KEY_PROPERTIES="$HOME/.lu-mobile-signing/wegwerf/key.properties"
touch src-tauri/tauri.conf.json
npx tauri android build --apk --target aarch64
# src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk

"$ANDROID_HOME/build-tools/34.0.0/apksigner" verify --print-certs \
  src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
# erwartet: CN=LU WEGWERF NICHT VEROEFFENTLICHEN
```

Fuer die echte Signatur zeigt dieselbe Variable auf die echte Datei. Das macht David.

Fuer eine Veroeffentlichung gibt es je Ziel einen Befehl, der vor dem Bau alle Vorbedingungen prueft und danach das Paket (Signatur, Version, Preset, Testhaken): `scripts/mobile/release/android-play.sh` (AAB und APK, Preset `play`), `android-offen.sh` (APK, Preset `open`) und `ios-appstore.sh` (IPA, Preset `appstore`), jeder mit `--dry-run`. Die eine Seite dazu: `RELEASE-KNOPF.md`.

Dasselbe als ein Aufruf, mit Umgebung, `touch` und der Regel fuer den Testhaken:

```sh
scripts/mobile/android-bauen.sh debug                    # Debug, nur arm64-v8a
# Ein Release verlangt das Store-Preset ausdruecklich, sonst bricht das Skript ab (Runde 3, M5).
# play und appstore verlangen dazu VITE_LU_REPORT_URL (M4). Pruefung: scripts/mobile/store-bau-pruefen.sh
VITE_LU_STORE_PRESET=play VITE_LU_REPORT_URL=https://... scripts/mobile/android-bauen.sh release   # fuer den Store
VITE_LU_STORE_PRESET=open scripts/mobile/android-bauen.sh release abnahme          # Release mit inspizierbarer WebView und Testhaken, NIE fuer den Store
VITE_LU_STORE_PRESET=open scripts/mobile/android-bauen.sh release "" aarch64 armv7 # weitere ABIs nur auf ausdruecklichen Wunsch
```

Jedes Bauskript (Android, iOS-Simulator, iOS-Geraet) legt am Ende neben das Paket einen Baubeleg `<paket>.bau.json` (`scripts/mobile/bau-beleg.sh`): Art, Preset, ob ein Meldedienst gesetzt war, Features, Fingerabdruck des Pakets. Die Abnahme (`mobile-tests/checks/release.mjs`, Punkt 8) liest das Preset dort, weil es sich am Paket selbst nicht ablesen laesst. Ein Paket ohne Beleg, also eines, das an den Skripten vorbei gebaut wurde, gilt dort als Bau ohne genanntes Preset.

Das Skript loescht `VITE_LU_ABNAHME` immer zuerst und setzt es nur, wenn das Feature genannt ist. Beide Baeue schreiben nach demselben Pfad, wer beide braucht, kopiert den ersten weg.

**ABIs.** Gebaut wird nur `arm64-v8a` (`--target aarch64`). Ohne `--target` baut die CLI vier ABIs (arm64, armv7, x86, x86_64) und das Paket wird viermal so gross. Kein Handy, auf dem ein lokales Modell sinnvoll laeuft, braucht armv7 oder x86, und der Emulator auf einem Apple-Mac ist selbst arm64.

**Groessen, gemessen am 08.10.2026 am zusammengefuehrten Stand:**

| Paket | Groesse | davon `liblocally_uncensored_lib.so` |
|---|---|---|
| Release, gewoehnlich | 25,1 MB (25 124 540 Bytes) | 22,5 MB |
| Release mit `abnahme` | 25,1 MB (25 141 860 Bytes) | 22,5 MB |
| Debug, sauberer Bau | 376 MB | 369 MB |
| Debug, nach mehreren Baeuen | 745 MB | 369 MB, dazu 369 MB toter Platz |

Warum Debug so gross ist: nicht mehrere ABIs (jedes der gemessenen Pakete enthaelt genau eine Bibliothek, `lib/arm64-v8a/`), sondern Symbole. `app/build.gradle.kts` laesst im Debug die Debug-Symbole in der Bibliothek (`keepDebugSymbols`), und die Bibliothek liegt unkomprimiert im Paket. Von ihren 369 MB sind rund 280 MB DWARF (`.debug_info` 123 MB, `.debug_str` 94 MB, `.debug_line` 28 MB, `.debug_ranges` 18 MB, `.debug_loc` 15 MB), der Code selbst (`.text`) hat 26,5 MB. Warum 745 statt 376 MB: die Inhaltsliste der 745-MB-Datei zaehlt nur 376 MB an Eintraegen. Gradle packt inkrementell und haengt die neue Bibliothek an, die alte bleibt als toter Platz in der Datei. Ein sauberer Bau (`./gradlew clean` in `src-tauri/gen/android`, oder das Paket vorher loeschen) liefert wieder 376 MB. Der Release ist davon nicht betroffen: `strip = true`, `lto`, `opt-level = "s"`.

```sh
unzip -lv <apk> | sort -k1 -n -r | head -5      # groesste Eintraege, letzte Zeile ist die Summe
"$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-size" -A <lib.so>   # Abschnitte
```

Version: `versionName` folgt `version` in `tauri.conf.json`. `versionCode` steht in `tauri.android.conf.json` und folgt dem Schema `major * 10 000 000 + minor * 100 000 + patch * 1 000 + bau`, fuer 3.0.5 Bau 1 also `30005001`. iOS traegt dieselbe Zahl als `CFBundleVersion` (`bundle.iOS.bundleVersion` in `tauri.ios.conf.json`). Rechner:

```sh
python3 scripts/mobile/release/versionen.py src-tauri/tauri.conf.json 1
```

Bei jedem Versionssprung setzt `scripts/mobile/release/version-setzen.sh <version> <bau>` alle Stellen auf einmal (die zwei Handy-Konfigurationen, `gen/apple/project.yml` und die `Info.plist` daneben), mit `--dry-run` zeigt es nur. Es traegt die Version als eigenes Feld `version` in die Handy-Konfigurationen ein und fasst die Desktop-Version nicht an. Die Waechter `mobile-ios-fallen.test.ts` und `mobile-release-skripte.test.ts` melden eine vergessene Stelle.

### 4.4 Emulator, installieren, starten

```sh
emulator -list-avds
emulator -avd LU_Bauer -port 5558 -no-snapshot -no-audio -no-boot-anim &
adb wait-for-device
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n com.purpledoubled.locallyuncensored/.MainActivity
adb logcat -s LU
adb exec-out screencap -p > /tmp/lu.png
```

`LU_Bauer` ist ein leeres Geraet nur fuer diese Bauten (angelegt am 08.10.2026 mit `avdmanager create avd -n LU_Bauer -k "system-images;android-34;google_apis;arm64-v8a" -d pixel_7`, danach `hw.ramSize=4096` in `~/.android/avd/LU_Bauer.avd/config.ini`). Auf `LU_Phone` und `LU_Fresh` liegt je eine aeltere, anders signierte Installation mit Daten. Die nicht deinstallieren.

Laufen zwei Emulatoren, bekommt jeder `adb`-Aufruf `-s emulator-5558`, oder man setzt `export ANDROID_SERIAL=emulator-5558`.

Ein APK mit anderer Signatur laesst sich nicht ueber ein vorhandenes installieren (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Dann zuerst `adb uninstall com.purpledoubled.locallyuncensored`. Das loescht die Daten der alten Installation auf diesem Geraet.

Wartezeiten in Skripten mit `adb shell sleep N`.

### 4.5 Engine am Geraet belegen

Modell in den Modellordner der App legen (geht bei einem Debug-Bau ueber `run-as`):

```sh
PKG=com.purpledoubled.locallyuncensored
adb push /pfad/zum/modell.gguf /data/local/tmp/modell.gguf
adb shell run-as $PKG mkdir -p models
adb shell run-as $PKG cp /data/local/tmp/modell.gguf models/modell.gguf
adb shell rm /data/local/tmp/modell.gguf
```

Engine ueber das echte Tauri-Kommando starten und ihren Status lesen (nur Debug-Bau):

```sh
node scripts/mobile/android-webview-eval.mjs --invoke list_bundled_models
node scripts/mobile/android-webview-eval.mjs --invoke start_bundled_engine \
  '{"modelPath":"/data/user/0/com.purpledoubled.locallyuncensored/models/modell.gguf"}'
node scripts/mobile/android-webview-eval.mjs --invoke bundled_engine_status
```

Die HTTP-Flaeche vom Mac aus fragen:

```sh
adb forward tcp:18127 tcp:8127
curl -s http://127.0.0.1:18127/health
curl -s http://127.0.0.1:18127/v1/chat/completions -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Count from 1 to 10."}],"temperature":0,"max_tokens":48}'
adb forward --remove tcp:18127
```

Das Emulator-Abbild (android-34, google_apis) hat kein `curl`, der Weg fuehrt ueber `adb forward`.

### 4.6 Android-Projekt

`src-tauri/gen/android` ist das Ergebnis von `npx tauri android init` auf v3.0.5. Verglichen mit `feat/android`: dieselben 40 Dateien, fuenf davon von Hand gepflegt und von dort uebernommen:

- `.gitignore`
- `app/build.gradle.kts` (Release-Signatur aus `key.properties`, uebersprungen wenn die Datei fehlt)
- `app/proguard-rules.pro` (Keep-Regel fuer `FileProvider`)
- `app/src/main/AndroidManifest.xml` (Mikrofon-Rechte, `allowBackup=false`, `configChanges`, `adjustResize`, `singleTask`)
- `app/src/main/java/.../MainActivity.kt` (Edge-to-Edge, Insets als Padding)

Abweichung vom alten Manifest: die drei Intent-Filter fuer `lu://oauth` und `lu://remote` sind NICHT dabei. Sie gehoeren zum Deep-Link-Plugin und kommen mit ihm in einem Schritt (Fahrplan Commit 7 und 11).

Seit dem Beiwerk (08.10.2026) zusaetzlich von Hand gepflegt:

- `app/src/main/res/mipmap-*` und `mipmap-anydpi-v26`: adaptives Icon mit Monochrom (themed icons ab Android 13). Neu erzeugen mit `python3 scripts/mobile/release/make_icons.py` (braucht Pillow, schreibt in einen Ausgabeordner, von dort kopieren).
- `res/values/themes.xml`, `res/values-v31/themes.xml`, `res/values/lu_colors.xml`, `res/values-night/lu_colors.xml`, `res/drawable-*/lu_splash_icon.png` (dunkles Motiv) und `res/drawable-night-*/lu_splash_icon.png` (weisses Motiv): Startbild und Fensterfarbe. Folgen dem System, hell `#F3F4F6`, dunkel `#141414`, das ist `--m-canvas` der Handy-Shell. `MainActivity.kt` setzt Fenster, Leistensymbole und die leere WebView vor dem ersten eigenen Bild (`StartTheme` im Plugin lu-native, auch fuer eine feste Themenwahl des Nutzers). Hintergrund und Pruefschritte: `mobile-docs/r5/start.md`. Waechter: `src/mobile/platform/__tests__/start-colours.test.ts`.
- `res/xml/network_security_config.xml`: Klartext nur zu `127.0.0.1` und `localhost`. `app/src/debug/res/xml/network_security_config.xml` oeffnet das fuer den Dev-Server, nur im Debug-Bau.
- Manifest: `ACCESS_NETWORK_STATE`, `<queries>` fuer Browser und Systemkamera, `roundIcon`, `networkSecurityConfig`, und in `configChanges` zusaetzlich `assetsPaths|touchscreen|navigation|colorMode|grammaticalGender` (Abschnitt 7, Falle 13).
- `MainActivity.kt`: `onDestroy` startet die App in einem frischen Prozess, falls Android die Activity doch neu erzeugt (Falle 13).

Bewusst NICHT im Manifest, das bringt der Native-Strang mit dem Plugin, das es benutzt: die Intent-Filter fuer `lu://oauth/callback` und `lu://remote`, der Download-Dienst mit `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS` und `WAKE_LOCK`, die `<queries>` fuer das Teilen-Blatt und Custom Tabs.

`key.properties.example` ist die leere Vorlage. `key.properties`, `keystore.properties`, `local.properties`, `*.jks`, `*.keystore`, `build/`, `.gradle/` und die generierten Dateien sind ignoriert, doppelt (Wurzel-`.gitignore` und die zwei im Projekt).

### 4.7 Release-Paket pruefen

```sh
APK=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
BT="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
"$BT/apksigner" verify --print-certs "$APK" | head -1
"$BT/aapt2" dump badging "$APK" | grep -E "^package|uses-permission|native-code"
"$BT/aapt2" dump xmltree --file AndroidManifest.xml "$APK" | grep -E "debuggable|usesCleartext|allowBackup|exported"
unzip -o -q "$APK" 'lib/*' -d /tmp/lu-apk && strings -a /tmp/lu-apk/lib/arm64-v8a/*.so | grep -c setWebContentsDebuggingEnabled
```

Gemessen am 08.10.2026 am gewoehnlichen Release:

| Frage | Befund |
|---|---|
| Signatur | `CN=LU WEGWERF NICHT VEROEFFENTLICHEN` (Platzhalter) |
| ABIs | nur `arm64-v8a` |
| WebView inspizierbar | nein. Die Zeichenkette `setWebContentsDebuggingEnabled` (der Aufruf von wry) kommt in der Bibliothek 0-mal vor, im Abnahmebau 1-mal. `android:debuggable` fehlt. Der Socket, den der Emulator trotzdem zeigt, kommt vom Abbild (Falle 23). Auf einem Geraet mit `user`-Abbild ist das noch nicht nachgemessen. |
| Testhaken | `typeof window.__LU_TEST__` ist `undefined` (am Emulator ausgelesen, der wegen Falle 23 hineinsehen laesst), im Abnahmebau `object`. `dist/` nach einem gewoehnlichen Bau: 0 Dateien mit `__LU_TEST__`. Im Paket selbst laesst sich nicht suchen, die Seite liegt komprimiert in der Bibliothek. |
| Abnahme-Schalter in Rust | `device_info` meldet `acceptanceBuild: false`, ein Download von `http://127.0.0.1` wird abgelehnt |
| Klartext | `usesCleartextTraffic=false`, `network_security_config`: Klartext nur zu `127.0.0.1` und `localhost`. Begruendung: dort lauscht die eigene Engine (8127, 8128), die Seite spricht sie direkt an. Alles andere geht ueber https oder ueber Rust. |
| `allowBackup` | `false` |
| Exportiert | nur `MainActivity` (Start und `lu://`). Der `FileProvider` ist nicht exportiert. |

Rechte im zusammengefuehrten Manifest und wozu:

| Recht | Wozu | Fragt das System nach? |
|---|---|---|
| `INTERNET` | Modelle laden, Cloud, Remote | nein |
| `ACCESS_NETWORK_STATE` | wartende Downloads setzen fort, wenn das Netz zurueck ist | nein |
| `RECORD_AUDIO` | Diktat und Sprach-Chat | ja, beim ersten Gebrauch |
| `MODIFY_AUDIO_SETTINGS` | Tonweg beim Sprach-Chat (kommt mit der WebView-Aufnahme) | nein |
| `POST_NOTIFICATIONS` | Fortschritt eines Downloads als Benachrichtigung | ja, ab Android 13, beim ersten Download. Seit Runde 16 fragt die App vorher mit einem Satz (`m-dialog-notify`); ein Nein wird nicht wiederholt, der Schalter in Settings, Storage fuehrt dann in die Einstellungen des Systems |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC` | der Download ueberlebt das Verlassen der App | nein |
| `WAKE_LOCK` | das Geraet schlaeft waehrend eines Downloads nicht ein | nein |
| `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | von androidx erzeugt, schuetzt eigene Empfaenger | nein |

Kein Kamera-Recht: Fotos laufen ueber die Kamera-App des Systems (`IMAGE_CAPTURE` steht nur unter `queries`), Kamera und Mikrofon sind als `uses-feature` nicht verlangt. Kein Speicher-Recht, kein Standort.

iOS, `Info.plist` des gewoehnlichen Simulator-Release, jede Angabe mit Text:

| Schluessel | Text |
|---|---|
| `NSCameraUsageDescription` | "LU uses the camera when you choose to take a photo for a chat or an image request." Mit Fernzugriff verlaengert um ", and to scan the QR code that pairs this phone with LU on your computer." |
| `NSMicrophoneUsageDescription` | "LU records your voice when you start dictation or voice chat. The recording is sent to LU Cloud to be turned into text." |
| `NSPhotoLibraryAddUsageDescription` | "LU saves images and videos to your photo library when you choose to save them." |
| `NSLocalNetworkUsageDescription` | nur mit Fernzugriff: "LU connects to LU on your own computer over your local network when you set up Remote." |

Die Berechtigungstexte haengen am Store-Preset (seit Runde 11). `src-tauri/Info.ios.plist` gilt fuer jeden Bau und nennt keinen Fernzugriff. Was der Fernzugriff braucht (der Schluessel fuer das lokale Netz, der QR-Satz im Kameratext), steht in `src-tauri/Info.ios.fernzugriff.plist` und kommt nur in einen Bau, dessen Preset den Schalter `remoteDesktop` hat (`open`, `play`), nicht in `appstore`. Die Bauskripte rufen dafuer `scripts/mobile/ios/preset-plist.mjs vorbereiten <preset>`: der Aufruf nimmt zuerst aus der Info.plist des Xcode-Projekts heraus, was ein frueherer Bau hineingemischt hat (die CLI nimmt nie einen Schluessel heraus), und nennt dann das Argument fuer `--config` (`bundle.iOS.infoPlist`). `pruefe-paket.sh` prueft am fertigen Paket beides je Preset. Wer die CLI von Hand startet (`npx tauri ios dev`), bekommt den Stand ohne Fernzugriff.

Dazu `NSAppTransportSecurity` mit nur `NSAllowsLocalNetworking` (Klartext nur im eigenen Netz: Engine auf der Schleife, Remote zum eigenen Rechner), `ITSAppUsesNonExemptEncryption=false`, das Schema `lu`, `UIFileSharingEnabled` und `LSSupportsOpeningDocumentsInPlace` (der Ordner Dokumente der App ist in der Dateien-App sichtbar). Kein Lesezugriff auf die Fotomediathek, kein Standort, keine Kontakte, kein Tracking. Inspizierbar: der Treiber findet am gewoehnlichen Bau keine Seite ("Die WKWebView erlaubt kein Debugging"), die Zeichenkette `isInspectable` kommt im Programm 0-mal vor, im Abnahmebau 1-mal.

## 5. iOS

Stand 08.10.2026: Die App laeuft im iOS-Simulator (iOS 26.5), Debug und Release, auf einem kleinen und einem grossen iPhone. Alles hier ist **im Simulator belegt**, nichts am iPhone. Der Weg selbst (Werkzeuge, Harness, Grenzen) steht ausfuehrlich in `IOS-BAUWEG.md`.

### 5.1 Einmalig

```sh
brew install cocoapods xcodegen ios-webkit-debug-proxy
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
```

`src-tauri/gen/apple` ist eingecheckt, `npx tauri ios init` muss niemand ausfuehren. Wer das Projekt doch neu erzeugt, liest 5.7.

### 5.2 Bauen fuer den Simulator

```sh
scripts/mobile/ios/bauen.sh debug              # rund 25 s nach einer kleinen Aenderung
# Wie auf Android: ein Release nennt sein Preset, appstore braucht die Meldeadresse.
VITE_LU_STORE_PRESET=appstore VITE_LU_REPORT_URL=https://... scripts/mobile/ios/bauen.sh release   # rund 3 min (lto), Paket 19 MB
VITE_LU_STORE_PRESET=open scripts/mobile/ios/bauen.sh release abnahme    # Release mit inspizierbarer WebView, NIE fuer den Store
                                               # setzt auch VITE_LU_ABNAHME=1: der Testhaken window.__LU_TEST__ ist drin (mobile-tests/TESTIDS.md)
# Ergebnis immer: src-tauri/gen/apple/build/arm64-sim/LU.app
```

Das Skript setzt `LANG=en_US.UTF-8`, `IPHONEOS_DEPLOYMENT_TARGET=17.0`, legt node aus nvm in den PATH, beruehrt `tauri.conf.json` und raeumt das alte Paket weg. Der Simulator-Bau ist ad hoc signiert, ein Team oder Zertifikat braucht er nicht. Ein Team steht nie im Repo, es kommt nur ueber `APPLE_DEVELOPMENT_TEAM` aus der Umgebung.

Nie `xcodebuild` allein aufrufen und nicht aus der Xcode-Oberflaeche bauen: die Bauphase "Build Rust Code" braucht die laufende Tauri-CLI und node im PATH.

Nach jedem Handy-Bau: `git checkout -- src-tauri/gen/schemas` (Falle 6).

### 5.3 Simulatoren

Eigene Geraete mit festen Namen, damit niemand fremde anfasst: `LU-iOS-klein` (iPhone SE, 3. Generation, 375 x 667) und `LU-iOS-gross` (iPhone 17 Pro Max, 440 x 956), beide iOS 26.5. Sie laufen ohne Simulator-Fenster.

```sh
scripts/mobile/ios/simulator.sh anlegen                 # legt beide an, falls sie fehlen
scripts/mobile/ios/simulator.sh hoch beide              # booten und warten
scripts/mobile/ios/simulator.sh einspielen src-tauri/gen/apple/build/arm64-sim/LU.app \
  com.purpledoubled.lu beide            # beenden, installieren, starten
scripts/mobile/ios/simulator.sh runter beide            # herunterfahren, nicht loeschen
xcrun simctl io LU-iOS-klein screenshot /tmp/lu.png
```

Weitere Griffe (Dunkel, Schrift, Deeplink, Hintergrund, Statusleiste): `scripts/mobile/ios/steuerung.sh`.

### 5.4 Die WebView fernsteuern

Geht nur, wenn die WebView inspizierbar ist: Debug-Bau, oder Release mit dem Feature `abnahme`.

```sh
node scripts/mobile/ios/eval.mjs LU-iOS-klein 'document.title'
node scripts/mobile/ios/eval.mjs LU-iOS-klein --invoke bundled_engine_status
node scripts/mobile/ios/startbeleg.mjs LU-iOS-klein /tmp/start.png --neustart
```

`startbeleg.mjs` liest die Startseite aus dem DOM, sammelt Konsole und Netzfehler und endet nur dann mit 0, wenn die Konsole keinen Fehler ausser den dokumentierten zeigt. Dokumentiert ist genau einer: `Command sync_custom_model_paths not found`. Der Desktop-Code meldet beim Start seine Modellordner an ComfyUI, das Kommando gibt es auf dem Handy nicht (Abschnitt 8), der Aufruf wird abgelehnt und ueber `console.error` als Warnung protokolliert. Ohne Folgen, verschwindet mit der Mobile-Shell.

Echte Finger und System-Dialoge gehen ueber WebDriverAgent: `scripts/mobile/ios/appium-start.sh`, `ios-wda.mjs`, Einzelheiten in `IOS-BAUWEG.md` A4.

### 5.5 Engine im Simulator belegen

Ein GGUF liegt im Modellordner der App, wenn es unter `Library/Application Support/com.purpledoubled.lu/models` im Daten-Container liegt. Der Container ist ein normaler Ordner auf dem Mac:

```sh
xcrun simctl get_app_container LU-iOS-klein com.purpledoubled.lu data
```

Das Belegskript kopiert die Modelle selbst dorthin, startet die Engine ueber `start_bundled_engine`, fragt sie aus der WebView per `fetch` (am Stueck und als Strom), prueft die Einbettung (768 Werte auf 8128) und loescht am Ende das geladene Modell:

```sh
node scripts/mobile/ios/engine-beleg.mjs LU-iOS-klein /pfad/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf \
  /pfad/nomic-embed-text-v1.5.Q4_K_M.gguf

# Metal im Simulator erzwingen: der Selbsttest muss den Unsinn fangen und auf den Prozessor zurueckfallen
node scripts/mobile/ios/engine-beleg.mjs LU-iOS-klein /pfad/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf --gpu-erzwingen

# Modell am Ende behalten, fuer Messungen am Lebenszyklus
node scripts/mobile/ios/engine-beleg.mjs LU-iOS-klein /pfad/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf --behalten
```

Eine Umgebungsvariable erreicht die App im Simulator ueber das Praefix `SIMCTL_CHILD_`, zum Beispiel `SIMCTL_CHILD_LU_INPROC_FORCE_GPU=1 xcrun simctl launch <udid> <kennung>`.

Vom Mac aus ist der Server der App direkt erreichbar, weil der Simulator das Netz des Macs teilt: `curl http://127.0.0.1:8127/health`. Das gilt nur im Simulator. Laufen zwei Simulatoren mit geladener Engine zugleich, streiten sie um denselben Port.

Tokens pro Sekunde aus diesen Laeufen sind **Simulatorwerte**: der Simulator rechnet auf dem Prozessor des Macs. Sie sagen nichts ueber ein iPhone.

### 5.6 Release-Paket pruefen

```sh
APP=src-tauri/gen/apple/build/arm64-sim/LU.app
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' -c 'Print :CFBundleVersion' \
  -c 'Print :MinimumOSVersion' -c 'Print :NSMicrophoneUsageDescription' "$APP/Info.plist"
ls "$APP"                                    # Assets.car, LaunchScreen.storyboardc, PrivacyInfo.xcprivacy
codesign -dv "$APP" 2>&1 | grep -E 'Signature|TeamIdentifier'   # adhoc, not set
codesign -d --entitlements - "$APP" 2>&1 | grep -c increased-memory   # 0 im Simulator-Bau
otool -L "$APP/LU" | grep -E 'Accelerate|Metal'
scripts/mobile/check-ios-minos.sh aarch64-apple-ios-sim release 17.0
```

Ein Simulator-Paket laeuft auf keinem iPhone und laesst sich nicht hochladen. Ein signierter Geraete-Bau (`npx tauri ios build`, IPA) braucht Team, Zertifikat und Profil, das macht David.

Dass das Geraeteziel ueberhaupt baut und linkt (andere Bibliotheken, Metal an, eigenes Entitlement), belegt ein unsignierter Bau ohne Konto:

```sh
# Immer ein Release: ohne VITE_LU_STORE_PRESET bricht das Skript ab.
VITE_LU_STORE_PRESET=appstore VITE_LU_REPORT_URL=https://... scripts/mobile/ios/geraet-bauen.sh   # gewoehnlicher Release fuer aarch64-apple-ios, unsigniert
VITE_LU_STORE_PRESET=open scripts/mobile/ios/geraet-bauen.sh abnahme     # dasselbe inspizierbar, NIE fuer den Store
# Ergebnis: src-tauri/gen/apple/build/geraet-unsigniert/LU.app
```

Gemessen am 08.10.2026: 232 s beim ersten Mal, Paket 20 MB, `platform IOS`, `minos 17.0`, `arm64`, `code object is not signed at all`. Die CLI endet dabei mit Fehler, weil ihr Export eine Signatur braucht. Das Skript erwartet genau das, nimmt die App aus dem Archiv und bricht ab, wenn das Paket doch eine Signatur traegt. Das Paket laeuft auf keinem Geraet. Der Weg: ein Vorschalter vor `xcodebuild` haengt `CODE_SIGNING_ALLOWED=NO` an die Kommandozeile. Eine xcconfig-Datei ueber `XCODE_XCCONFIG_FILE` reicht nicht, die Einstellungen des Ziels gewinnen ("requires a development team").

Der Bau schreibt `gen/apple/locally-uncensored_iOS/Info.plist` und die Entitlements um. Vor einem Commit: `git checkout -- src-tauri/gen/apple`.

### 5.7 Was in `gen/apple` von Hand gepflegt ist

Das Projekt ist das Ergebnis von `npx tauri ios init` auf v3.0.5, plus:

- `Assets.xcassets/AppIcon.appiconset` (18 PNG ohne Alpha), `LaunchLogo.imageset` (je Massstab ein dunkles und ein weisses Motiv), `LaunchBackground.colorset` (Any `#F3F4F6`, Dark `#141414`), `LaunchScreen.storyboard`: Icon und Startbild. Das Startbild folgt dem System wie auf Android. Fenster und WKWebView nehmen denselben Farbsatz (`StartTheme.swift` im Plugin lu-native), siehe `mobile-docs/r5/start.md`. iOS haelt das Startbild einer installierten App im Zwischenspeicher: nach einer Aenderung die App loeschen und neu einspielen, sonst zeigt das Geraet das alte.
- `locally-uncensored_iOS/PrivacyInfo.xcprivacy`: Datenschutz-Manifest, Entwurf. Vor dem ersten Upload mit `scripts/mobile/release/pruefe-required-reason-apis.sh` gegen den echten Bau pruefen.
- `locally-uncensored_iOS/LU-Geraet.entitlements` mit `com.apple.developer.kernel.increased-memory-limit`, und in `project.yml` die Zeile `"CODE_SIGN_ENTITLEMENTS[sdk=iphoneos*]"`. Nur der Geraete-Bau bekommt das Entitlement, es braucht ein Profil. Die Standarddatei `locally-uncensored_iOS.entitlements`, die der Simulator-Bau nimmt, bleibt leer.
- `locally-uncensored_iOS/Info.plist` ist das Ergebnis des Einmischens von `src-tauri/Info.ios.plist` und aendert sich bei jedem Bau nur, wenn sich die Quelle aendert.

Nach einer Aenderung an `project.yml` das Xcode-Projekt neu schreiben, **mit leerem `Externals`**:

```sh
cd src-tauri/gen/apple && rm -rf Externals/* build && xcodegen generate --spec project.yml
```

Wer `gen/apple` ganz neu erzeugt (`npx tauri ios init`), holt danach diese Dateien mit `git checkout` zurueck und fuehrt denselben `xcodegen`-Aufruf aus. Linker-Einstellungen muss niemand nachtragen, sie stehen in `src-tauri/src/lib.rs`.

### 5.8 Nur die Rust-Kiste pruefen

```sh
(cd src-tauri && cargo check --target aarch64-apple-ios-sim --lib)
(cd src-tauri && cargo build --target aarch64-apple-ios --lib)     # Geraeteziel, ohne iPhone nur baubar
scripts/mobile/check-ios-minos.sh aarch64-apple-ios debug 17.0
```

`IPHONEOS_DEPLOYMENT_TARGET=17.0` kommt aus `src-tauri/.cargo/config.toml` und muss nicht exportiert werden.

### 5.9 Lebenszyklus, gemessen im Simulator am 08.10.2026

Nur gemessen, nichts gebaut. Belege unter `mobile-docs/belege/ios-lebenszyklus-*.log`.

| Fall | Beobachtung |
|---|---|
| App in den Hintergrund (andere App nach vorn) | Nach 2 s antwortet der Server auf 8127 noch, ab dem naechsten Messpunkt (rund 5 s) nicht mehr: `curl` laeuft in die Zeitgrenze. Der Prozess lebt weiter, er ist angehalten. Gemessen bis 60 s. |
| Zurueck in den Vordergrund | Derselbe Prozess, derselbe Socket: `/health` antwortet sofort, ein Chat liefert richtigen Text, der Status meldet `running` und `healthy`. Das Modell bleibt geladen. Der Socket war im Simulator also nicht tot, eine Wiederbelebung des Listeners wurde deshalb nicht gebaut. |
| `simctl terminate`, dann Neustart | Port 8127 ist zu. Nach dem Neustart startet die Engine nicht von selbst: `running: false`, `model_path: null`. Die Modelldateien liegen noch im Ordner (`list_bundled_models` nennt sie mit `loaded: false`), `localStorage` ist erhalten. Das Laden stoesst die Oberflaeche an, nicht die Rust-Seite. |
| Speicherwarnung | Ausgeloest ueber `lldb` und den privaten Selektor `_performMemoryWarning` (der Weg ueber `notifyutil` wirkt nicht, `IOS-BAUWEG.md` Teil B). Die App reagiert nicht: Prozess lebt, Engine bleibt geladen und antwortet. Der Speicher des Prozesses sank von 929 auf 851 MB, das ist das System, nicht die App. Ob die Warnung in der App ankam, laesst sich ohne Beobachter nicht beweisen: tao hat keinen Handler dafuer. |

Folgen fuer die naechsten Straenge: Ein laufender Strom steht im Hintergrund mit, er muss vor dem Anhalten beendet und gespeichert werden (Lebenszyklus-Plugin). Auf die Speicherwarnung reagiert erst ein eigenes Plugin. Ob der Socket auf einem echten iPhone nach laengerer Zeit im Hintergrund noch lebt, gehoert auf die iPhone-Pruefliste: der Status prueft `healthy` ueber HTTP, ein toter Socket faellt dort auf.

## 6. Die Engine mit Metal auf dem Mac testen

Dieselbe Datei `engine_inproc.rs` wie auf dem iPhone, als macOS-Bau mit dem Feature `inproc-engine`:

```sh
cd src-tauri
LU_TEST_GGUF=/pfad/zum/modell.gguf \
  cargo test --features inproc-engine inproc -- --nocapture --test-threads=1

# Zweiter Lauf auf dem Kernpfad der aelteren Chips (A14 bis A18):
LU_TEST_GGUF=/pfad/zum/modell.gguf GGML_METAL_TENSOR_DISABLE=1 \
  cargo test --features inproc-engine inproc -- --nocapture --test-threads=1
```

Ohne `LU_TEST_GGUF` laufen nur die Tests, die kein Modell brauchen, die zwei Modelltests melden "skipped". Der zweite Modelltest spielt eine Karte, die Unsinn rechnet, und belegt den Rueckfall auf den Prozessor.

Schalter der Engine (Umgebungsvariablen, nur zum Testen):

| Variable | Wirkung |
|---|---|
| `LU_INPROC_FORCE_GPU=1` | laesst auch den iOS-Simulator die Karte nehmen, damit der Selbsttest dort den Rueckfall ausloest |
| `LU_INPROC_AVAILABLE_MB=<zahl>` | gibt der Speicherwache einen festen Wert, sonst ist im Simulator nie etwas zu gross |

## 7. Bekannte Fallen

1. **llama-Kisten laufen auseinander (Falle A).** `llama-cpp-2` haengt mit Caret an `llama-cpp-sys-2`. 0.1.154 uebersetzt nicht gegen 0.1.159. Beide stehen mit `=0.1.154` im Manifest. Nie nur eine anheben.
2. **iOS-Mindestversion (Falle B).** Ohne `IPHONEOS_DEPLOYMENT_TARGET` baut CMake llama.cpp fuer die SDK-Version. Die Variable steht in `src-tauri/.cargo/config.toml`. Das Build-Skript bemerkt eine Aenderung des Werts NICHT. Nach einer Aenderung:
   ```sh
   (cd src-tauri && cargo clean --target aarch64-apple-ios -p llama-cpp-sys-2)
   (cd src-tauri && cargo clean --target aarch64-apple-ios-sim -p llama-cpp-sys-2)
   ```
   Danach mit `scripts/mobile/check-ios-minos.sh` pruefen.
3. **libc gegen sysinfo (Falle C).** `libc` 0.2.190 bricht `sysinfo` 0.33.1 auf iOS. `libc` steht mit `=0.2.183` im Manifest. Nur zusammen mit `sysinfo` anheben.
4. **Kein blindes `cargo update`.** Es reisst 1 bis 3 wieder auf. Waechter fuer alle drei: `npx vitest run src/lib/__tests__/mobile-bau-fallen.test.ts`.
5. **Altes Frontend im Paket.** `tauri-build` beobachtet `../dist` nicht. Vor jedem Handy-Bau `touch src-tauri/tauri.conf.json`.
6. **Generierte Schemata kippen.** Ein Handy-Bau schreibt `src-tauri/gen/schemas/capabilities.json` und `acl-manifests.json` um. Vor einem Commit: `git checkout -- src-tauri/gen/schemas`.
7. **Metal im iOS-Simulator rechnet still falsch** (48 Ausrufezeichen, kein Fehler). Die Engine bleibt dort auf dem Prozessor. Nicht "reparieren".
8. **`devtools` gehoert nur in den Desktop-Block** von `Cargo.toml`. Im gemeinsamen Block oeffnet ein Release-APK einen WebView-Debug-Socket. Waechter: `release-opens-no-debug-socket.test.ts`.
9. **Tauri npm und Crate** muessen auf derselben major.minor liegen. Waechter: `tauri-versions-agree.test.ts`.
10. **Pfade.** Auf dem Handy nie `dirs::` fuer app-eigene Pfade. Alles ueber `os_paths`. Vor `setup` kennt die App ihren Datenordner noch nicht.
11. **Zwei cargo-Laeufe zugleich** im selben `src-tauri/target` warten aufeinander. Einen Handy-Bau nicht neben `cargo test` starten.
12. **`key.properties`** kann lokal in `src-tauri/gen/android/` liegen. Nie lesen lassen, nie committen. Der Bau liest sie nicht von selbst, nur ueber `LU_ANDROID_KEY_PROPERTIES` (4.3). Vor jedem Commit `git status` und `git diff --cached --stat`, nie `git add -A`.

13. **Android erzeugt die Activity neu, und tao startet die App dann ein zweites Mal im selben Prozess.** tao 0.34.8 ruft `run()` aus jedem `Activity.onCreate`. Android erzeugt die Activity im laufenden Prozess neu, wenn sich eine Konfiguration aendert, die das Manifest nicht fuer sich beansprucht. Getroffen hat die Aenderung der Ressourcen-Overlays (`Config changes=80000000`): das System wendet Overlays direkt nach dem ersten Hochfahren eines Geraets an. Folge war ein Absturz mit Dialog, je nach Wettlauf `FORTIFY: pthread_mutex_lock called on a destroyed mutex` oder ein wry-`Timeout` nach 10 s. Nachstellen (vor der Behebung):
    ```sh
    adb shell cmd overlay enable com.android.internal.systemui.navbar.threebutton
    ```
    Drei Riegel, von aussen nach innen: `assetsPaths` und der Rest der Liste in `android:configChanges` (die Activity wird gar nicht neu erzeugt), `MainActivity.onDestroy` (falls doch: frischer Prozess statt zweitem `run()`), `android_entry.rs` (falls auch das ausbleibt: der zweite `run()` baut nichts, und das Prozessende laeuft ueber `_exit`). Waechter: `a-setting-change-is-not-a-restart.test.ts` und die Tests in `android_entry.rs`.
14. **iOS: der zweite Bau scheitert am alten Paket.** `failed to rename app ... Directory not empty`. `bauen.sh` raeumt `gen/apple/build/arm64-sim` vorher weg.
15. **iOS: Xcode linkt, nicht cargo.** Die `cargo:rustc-link-lib=framework=...` von `llama-cpp-sys-2` kommen nirgends an. Ohne Zutun fehlen zehn `_vDSP_*`-Symbole (Accelerate). Die Frameworks stehen als Linker-Optionen in `src-tauri/src/lib.rs` (`.linker_option`, direkt vor `run()`). Nicht ins Xcode-Projekt eintragen, dort gingen sie beim Neuerzeugen verloren.
16. **iOS: `xcodegen` nimmt eine gebaute `libapp.a` als Ressource auf.** Liegt beim Erzeugen etwas unter `gen/apple/Externals`, kopiert das Projekt die Rust-Bibliothek ins App-Paket. Vorher leeren (5.7).
17. **iOS: Mindestversion friert beim `init` ein.** Sie steht an fuenf Stellen (`tauri.ios.conf.json`, `project.yml`, `project.pbxproj`, `Podfile`, `.cargo/config.toml`). Alle zusammen aendern, danach Falle 2.
18. **iOS: CSP braucht `ipc:`.** Die WebView ruft Kommandos auf iOS ueber `ipc://localhost`. Die CSP in `tauri.ios.conf.json` ist die des Desktops plus `ipc:`. Bekommt der Desktop einen neuen Host, muss er dort mit hinein, der Waechter vergleicht beide.
19. **Die WebView ist cross-origin zur Engine.** `tauri://localhost` (iOS) und `http://tauri.localhost` (Android) gegen `http://127.0.0.1:8127`. Der eingebaute Server laesst genau diese Herkuenfte zu (`WEBVIEW_ORIGINS` in `engine_inproc.rs`), nie `*`.
20. **Weisser Blitz nach dem Startbild.** Ohne Hintergrundfarbe ist die WebView bis zum ersten Bild weiss, auf iOS und auf Android. iOS: `backgroundColor` in `tauri.ios.conf.json` macht die WKWebView durchsichtig, das Plugin lu-native legt den Farbsatz des Startbilds dahinter (`StartTheme.swift`). Android: `tauri.android.conf.json` setzt bewusst KEINE Farbe, weil wry sie nach `MainActivity.onWebViewCreate` anwenden und die dort gesetzte Farbe ueberschreiben wuerde. Die Werte sind hell `#F3F4F6` und dunkel `#141414` und stehen in Startbild, Fenster, WebView und `public/first-paint.js` gleich (Waechter `start-colours.test.ts`).
21. **Feature `abnahme` nie ausliefern.** Es macht die WebView eines Release-Baus inspizierbar (iOS: privater Schluessel `developerExtrasEnabled`, Android: Debug-Socket).
22. **`target` von einem anderen Arbeitsbaum geklont: iOS bricht am Swift-Modulcache.** Die `.pcm`-Dateien unter `target/*/build/*/out/swift-rs` tragen absolute Pfade des alten Ordners. Abhilfe: diese `swift-rs`-Ordner loeschen und `cargo clean --target aarch64-apple-ios-sim -p tauri -p tauri-plugin-shell -p tauri-plugin-lu-native -p tauri-plugin-deep-link` (fuer `--release` noch einmal).
23. **Der Emulator zeigt einen Debug-Socket, auch beim gewoehnlichen Bau.** Die Abbilder `google_apis` sind `userdebug` (`ro.debuggable=1`), dort oeffnet die WebView des Systems `@webview_devtools_remote_<pid>` fuer jede App. Das sagt nichts ueber das Paket. Der Beleg fuer das Paket steht in 4.7.
24. **Testserver am Emulator: `adb reverse`, nicht `10.0.2.2`.** Klartext ist im Release ausser zu `127.0.0.1` und `localhost` verboten, auch im Abnahmebau. Ein Download von `http://10.0.2.2:...` bleibt auf "waiting" haengen (`Cleartext HTTP traffic to 10.0.2.2 not permitted` im logcat). Mit `adb reverse tcp:8799 tcp:8799` ist der Server des Macs unter `http://127.0.0.1:8799` zu erreichen. Der iOS-Simulator teilt das Netz des Macs und braucht nichts.
25. **Kein `null_glob` in den zsh-Skripten.** Trifft ein Muster nichts, wird aus `ls -d <muster>` ein `ls -d` des aktuellen Ordners. `geraet-bauen.sh` hat so am 08.10.2026 den ganzen Arbeitsbaum in sich selbst kopiert, bis die Platte fast voll war. Dateien mit `find` suchen und das Ergebnis pruefen, bevor kopiert wird.
26. **Die CLI uebersetzt die App zweimal.** Erst selbst, dann noch einmal aus Gradle bzw. Xcode heraus (`android-studio-script`, `xcode-script`). Im zweiten Lauf werden `tauri` und `wry` teils noch einmal uebersetzt. In den vier Paketen vom 08.10.2026 war das Feature `abnahme` jedes Mal so drin oder draussen wie verlangt. Trotzdem nach jedem Bau am Paket pruefen, was drin ist (4.7, 5.6), nicht am Protokoll.

## 8. Was auf dem Handy anders ist als am Desktop

Kommandos, die auf dem Handy nicht registriert sind (ein `invoke` darauf wird abgelehnt): `comfy_ws_*`, alle `install::*` (ComfyUI, Ollama, LM Studio, Python, Whisper, Piper, Custom Nodes, git), `trainer::*`, alle `media_cmds::*` (MLX-Bild und -Video), `trash_comfy_output`, `self_migrate_*`, `list_importable_models`, `import_local_model`, `sync_custom_model_paths`.

Kommandos mit gleichem Namen und anderer Antwort:

| Kommando | Desktop | Handy |
|---|---|---|
| `start_bundled_engine`, `swap_bundled_model` | startet `llama-server` | laedt das Modell in den Prozess. Gleiche Antwort (`status`, `port`, `model_path`, `ctx`). `ctx` ist hoechstens 4096. Von `tuning` wirken nur `ctx_size` und `gpu_layers`. Eine Sichtdatei (`mmproj`) wird ignoriert, die Engine ist rein Text. Nach einem Rueckfall zusaetzlich `retried`, `garbled`, `cpuOnly`, `note`. |
| `bundled_engine_status` | wie bisher | dieselben Schluessel, zusaetzlich `inProcess: true` und `accelerator` (`"gpu"`, `"cpu"` oder `null`) |
| `start_bundled_embed` | zweiter `llama-server` | In-Prozess, immer auf dem Prozessor |
| `delete_bundled_model` | verweigert das geladene Modell | stoppt die Engine und loescht dann. Zusaetzlicher Schluessel `stopped` |
| `kv_slot_action` | spricht mit `llama-server` | die In-Prozess-Engine hat keine Slot-Routen, die Anfrage endet mit einem HTTP-Fehler |
| `save_text_file_dialog`, `save_binary_file_dialog`, `export_chats_dialog`, `import_chats_dialog`, `save_chat_attachment_dialog`, `pick_folder` | nativer Dialog | Fehler "This device has no file dialog ..." (Teilen-Blatt folgt) |
| `show_window` | zeigt das Fenster nach der Onboarding-Regel | tut nichts, das eine Fenster ist sichtbar |
| `onboarding_window_open` | wahr, solange das Zweitfenster lebt | immer falsch |
| `secret_*` | Schluesselbund (Windows, macOS) | Stub "nicht unterstuetzt" wie unter Linux |

Der eingebaute Server der Engine (8127, 8128) beantwortet auf dem Handy auch den direkten `fetch` aus der Seite, mit CORS nur fuer die Herkuenfte der eigenen WebView.

## 9. Erster Start am Geraet (Abnahme nach einer Zusammenfuehrung)

Zwei Werkzeuge, beide ueber die Treiber aus `mobile-tests/driver/` und damit mit echten Touches:

```sh
# der ganze Ablauf: Onboarding, kleinstes Modell laden (echter Download), eine lokale Antwort,
# Teilen-Blatt aus dem Chat-Export, Deep Link warm und kalt, Hintergrund und zurueck, Abschuss und Neustart
PLATFORM=android ANDROID_SERIAL=emulator-5572 APP_PKG=com.purpledoubled.locallyuncensored \
  node scripts/mobile/erster-start.mjs merge-android-klein
APPIUM_PORT=4751 PLATFORM=ios IOS_UDID=<udid> APP_PKG=com.purpledoubled.lu \
  node scripts/mobile/erster-start.mjs merge-ios-klein

# ein einzelner Schritt, zum Erkunden. --ohne verbindet nicht mit der WebView (gewoehnlicher Bau)
PLATFORM=android ANDROID_SERIAL=emulator-5572 APP_PKG=com.purpledoubled.locallyuncensored \
  node scripts/mobile/geraet-schritt.mjs 'return d.viewport()'
```

Voraussetzung fuer `erster-start.mjs`: ein Abnahmebau, frisch installiert (Android: `adb shell pm clear <paket>`, iOS: `simctl uninstall` und `install`), die App laeuft nicht. Ergebnis ist ein JSON mit jedem Schritt, die Bilder liegen unter `mobile-docs/belege/<praefix>-NN-<name>.png`. iOS braucht einen laufenden Appium-Server (`mobile-tests/ios/appium.sh start`, eigener Port ueber `APPIUM_PORT`). Der Deep Link im Ablauf ist `lu://remote?url=...&code=...` mit einer Adresse, die es nicht gibt. Das Angebot wird gezeigt und abgelehnt, nie angenommen. Ein nacktes `lu://remote` ohne Adresse holt die App nur nach vorn und zeigt nichts, das ist so gewollt (`src/mobile/nav/deeplink.ts`).

Stand 08.10.2026, Abnahmebau des zusammengefuehrten Stands, alle neun Schritte gruen:

| Geraet | Sicht | Download 258 MB | erste Antwort | Bilder |
|---|---|---|---|---|
| Android 14, Emulator 1440x3120 | 412x827 | 61 s | 2 s | `merge-android-gross-*` (von Hand gefahren, dieselben Schritte) |
| Android 14, Emulator 720x1280 | 360x592 | 55 s | 4 s | `merge-android-klein-*` |
| iOS 26.5, iPhone SE 3 | 375x667 | 78 s | 21 s | `merge-ios-klein-*` |
| iOS 26.5, iPhone 17 Pro Max | 440x956 | 152 s | 15 s | `merge-ios-gross-*` |

Die Zeiten sind Emulator- und Simulatorwerte auf einem belasteten Mac und sagen nichts ueber ein Geraet. Was dabei an der Seite auffiel, steht in `mobile-docs/r2/rust.md`.

## 10. Netzregeln, die in Rust und im Plugin sitzen

**Eigene Anbieter (OpenAI-kompatibel, beliebiger https-Host).** Die CSP bleibt eng: `connect-src` nennt nur die festen Hosts, ein `fetch` aus der Seite zu einem fremden Host wird abgelehnt (am Geraet gesehen: "Refused to connect to https://example.com/ ..."). Der Weg fuer vom Nutzer eingetragene Hosts ist der Rust-Proxy, und den gibt es schon: `register_openai_host` meldet den Host an, `proxy_localhost` holt eine Antwort am Stueck, `proxy_localhost_stream_chunked` liefert sie stueckweise ueber einen Kanal. Die Seite nimmt ihn von selbst (`localFetch`, `localFetchStream`, `ensureProxyAllowsHost` in `src/api/backend.ts`). Der Waechter `the_csp_and_the_direct_list_of_the_frontend_name_the_same_hosts` haelt die CSP beider Plattformen und die Liste `CSP_DIRECT_HOSTS` der Seite gleich. Regeln des Proxys: angemeldet werden nur Namen und Adressen des eigenen Netzes, nie Metadaten-Adressen, nie oeffentliche IP-Literale, nie Zahlenformen einer Adresse (`2852039166`, `0x7f000001`). Jede Anfrage wird neu aufgeloest und gegen private Adressen geprueft, Umleitungen folgt der Proxy von Hand und prueft jede Station. Neu auf dem Handy: ein angemeldeter oeffentlicher Host wird nur ueber https angesprochen ("This phone only connects to '<host>' over https. ..."), Klartext bleibt dem eigenen Netz vorbehalten. Am Geraet belegt (Android und iOS): direkter `fetch` gesperrt, Proxy ohne Anmeldung abgelehnt, nach Anmeldung Antwort von `https://example.com/`, `http://example.com/` abgelehnt, `169.254.169.254` und ein IP-Literal nicht anmeldbar, Strom aus fuenf Stuecken im Abstand von 300 ms kommt Stueck fuer Stueck an (302, 603, 904, 1204, 1504 ms).

**DNS im langsamen Netz.** Der Desktop-Download (`do_download`) fragt den Namen jetzt bis zu dreimal ab, mit 5, 10 und 20 s Frist und 1,5 s Pause, und wiederholt einen gescheiterten Verbindungsaufbau still nach 1,5 und 4 s. Eine spaete Antwort eines frueheren Versuchs zaehlt. Scheitert alles, heisst der Fehler "Could not look up '<host>'. The network seems to be slow or offline. Check the connection and try again." Das Wort "Blocked" steht nur noch dort, wo wirklich eine Adresse gesperrt ist. Die kurzen Wege (`hub_get`, `web_fetch`, die Groessenabfrage) fragen weiter einmal mit 5 s und tragen denselben neuen Text. Auf dem Handy laeuft der Modell-Download nicht ueber diesen Weg, sondern ueber den Hintergrund-Download des Systems, der bei fehlendem Netz von selbst wartet.

**Umleitungen eines Hintergrund-Downloads.** Jede Station wird nach derselben Regel geprueft wie die erste Adresse (https zu einem oeffentlichen Host, private Adressen nur im Abnahmebau, Metadaten-Adressen nie). Android prueft vor jeder Verbindung (`NetGuard.kt`), iOS geht die Kette vor dem Start und vor dem Fortsetzen in Rust ab und prueft danach die antwortende Adresse (`NetGuard.swift`). Fehlercode `blocked`, Text "This download was redirected to an address that is not allowed." Die drei Sprachen teilen eine Tabelle mit 65 Adressen:

```sh
scripts/mobile/native-guard-tests.sh           # Rust und Swift
scripts/mobile/native-guard-tests.sh kotlin    # dazu Kotlin ueber Gradle (5 Tests)
```

Am Geraet belegt mit einem Testserver auf dem Mac, der auf `http://169.254.169.254/` umleitet, direkt und ueber eine zweite Station: beide Plattformen lehnen ab, kein Byte wird gespeichert, eine Umleitung auf eine erlaubte Adresse laeuft durch (6 MB vollstaendig).

**Kopfzeilen auf der Platte.** Beide Plattformen versiegeln die Kopfzeilen eines laufenden Downloads, iOS auch die Fortsetzungsdaten. Belegt im Simulator: ein Download mit `Authorization: Bearer <Marke>` laeuft, die Marke steht in keiner Datei des App-Containers (`grep -r`, 0 Treffer), die Liste traegt nur `headersSealed`, die Fortsetzungsdatei beginnt mit `LUS1`. Nach Pause, Abschuss, Neustart und Fortsetzen kommt beim Server wieder `Authorization` an, mit `Range: bytes=2162688-`.
