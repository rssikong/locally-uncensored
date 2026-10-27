# Release-Knopf: die Handy-Apps veroeffentlichen

Stand 10.10.2026, nachgezogen am 14.10.2026 (Runde 28: Keystore, Paket 11, Erklaerung zum Downloaddienst; Runde 32: Meldeadresse, Support- und Loeschseite, Apple-Widerruf). Eine Seite fuer David. Jeder Befehl hat `--dry-run`: er prueft dann nur und sagt, was fehlt. Kein Befehl laedt von selbst hoch.

**Was belegt ist (Probelauf vom 10.10.2026, `mobile-docs/r11/release-probe.md`).** Beide Android-Befehle sind mit einem frischen Probe-Schluessel wirklich durchgelaufen, vom ersten Schritt bis zum abgelegten Paket: das AAB entsteht im selben Lauf wie das APK und ist mit demselben Zertifikat gueltig signiert, APK und AAB tragen `versionName` 3.0.7 und `versionCode` 30007001 (gelesen aus beiden Paketen), nur `arm64-v8a`, kein Testhaken in der Seite im Paket, kein Zeichen des Abnahmebaus in der Bibliothek, und die Paketpruefung endet im Gutfall gruen. Fuer iOS ist der Bau des Geraeteziels mit dem Preset `appstore` gelaufen, unsigniert: Version 3.0.7 und Baunummer 30007001, nur iPhone, Berechtigungstexte ohne Fernzugriff, Privacy Manifest, kein Testhaken. Die Store-Pruefung des iOS-Pakets fiel an genau den Punkten durch, die eine Signatur brauchen, an keinem anderen.

**Was erst mit deinen Schluesseln belegt wird.** Kein Lauf mit dem echten Android-Keystore (der Probe-Schluessel ist geloescht). Mit dem Apple-Team zum ersten Mal: das signierte Archiv (`tauri ios build --export-method app-store-connect`), der Export mit `ExportOptions.vorlage.plist`, das IPA, der Weg `LU_IOS_SIGNING=manual`, der Gutfall aller Signaturpruefungen am IPA (Apple Distribution, Team, kein `get-task-allow`, App-Store-Profil, das Entitlement `increased-memory-limit` in der Signatur) und die Ablage des IPA. Beide Uploads sind nie gelaufen (`altool`, `fastlane supply`). Dein erster Lauf fuer iOS ist deshalb an diesen Stellen auch der erste Test: fahre ihn zuerst ohne `--upload`.

**Probelauf.** Jeder Befehl kennt `--probe`: derselbe Weg mit denselben Pruefungen, nur dass fuer die Store-Presets eine Platzhalter-Adresse an der Stelle der Meldeadresse steht (eine Domain unter `.invalid`, unter der nie ein Rechner antwortet). Ein Probe-Paket heisst `PROBE-...`, liegt in `release-pakete/PROBE-<ziel>-.../`, sein Baubeleg sagt `probe`, es verschwindet aus dem Bauordner, und es wird nie hochgeladen: `--probe` mit `--upload` bricht sofort ab. Ohne `--probe` ist dieselbe Adresse ein Platzhalter und der Befehl baut nicht. Die Paketpruefung laesst ein Probe-Paket nie als veroeffentlichbar durch.

## 1. Was nur du tun kannst, in dieser Reihenfolge

1. **Android-Keystore.** Erledigt am 11.10.2026 (`FUER-DAVID.md` Nr. 21): Es gab nie eine veroeffentlichte Android-App, also keinen alten Schluessel, den die neue App fortsetzen muesste. Signiert wird mit dem neuen Schluessel, der ausserhalb des Repos liegt; das Passwort steht nur im Schluesselbund. Offen ist dort nur eine Kopie ausserhalb dieses Macs. Fuer den Bau ausserhalb des Repos eine `key.properties` anlegen, Vorlage `src-tauri/gen/android/key.properties.example`, vier Felder: `storeFile`, `keyAlias`, `storePassword`, `keyPassword`. Dann `export LU_ANDROID_KEY_PROPERTIES=/pfad/key.properties`.
2. **Apple-Team.** Entwicklerkonto. App-ID neu anlegen: Kennung `com.purpledoubled.lu` (explizit, kein Platzhalter), Beschreibung "LU", Faehigkeiten **Sign in with Apple** und **Increased Memory Limit** einschalten. Die Kennung steht so im Projekt (`src-tauri/tauri.ios.conf.json`, `src-tauri/gen/apple/project.yml`); Android und Desktop haben ihre eigene und bleiben dabei. Danach die App in App Store Connect mit dieser Kennung und dem Namen "LU" anlegen. In Xcode am Team anmelden oder einen Schluessel fuer App Store Connect anlegen. Dann `export APPLE_DEVELOPMENT_TEAM=...` und `export LU_IOS_BUNDLE_ID=com.purpledoubled.lu`. Ein Profil, das vor dem Einschalten der Faehigkeiten erzeugt wurde, neu erzeugen: das Paket traegt beide Entitlements, und `pruefe-ios-ipa.sh` lehnt ein Paket ohne `com.apple.developer.applesignin` ab.
3. **Supabase-Rueckadresse.** `lu://oauth/callback` in die Redirect-Liste des Supabase-Projekts eintragen. Ohne sie keine Anmeldung mit Google und GitHub und kein "Forgot password" in der App. Das prueft kein Skript.
   **Dazu fuer "Sign in with Apple" (seit Runde 15, ausfuehrlich in `mobile-docs/r15/apple-anmeldung.md`):**
   1. Apple: an der App-ID `com.purpledoubled.lu` die Faehigkeit "Sign in with Apple" einschalten (Punkt 2).
   2. Supabase, Authentication, Sign In / Providers, Apple: einschalten und unter "Client IDs" `com.purpledoubled.lu` eintragen. Fuer den Weg der App (Token vom Geraet) genuegt die Bundle-ID; Services ID und Schluessel braucht nur der Web-Weg. Bitte am Dashboard gegenpruefen.
   3. Supabase, Redirect-Liste: `lu://oauth/callback` (dieser Punkt, steht dann schon). Apple selbst braucht ihn nicht, Google, GitHub und "Forgot password" brauchen ihn.
   4. Google-Konsole: der OAuth-Client erlaubt als Rueckadresse die des Supabase-Projekts (`https://<projekt>.supabase.co/auth/v1/callback`). Das ist fuer Android und Desktop schon so, nur nachsehen.
   5. Ein Konto fuer Apples Pruefer anlegen: E-Mail und Passwort, bestaetigt, mit etwas Guthaben. In App Store Connect unter "App Review Information" bei "Sign-in required" eintragen. Ohne Demo-Konto sieht die Pruefung die Funktionen hinter der Anmeldung nicht und lehnt ab (Regel 2.1).
4. **Meldeadresse.** Erledigt am 14.10.2026: lu-labs.ai nimmt Meldungen an, `VITE_LU_REPORT_URL=https://lu-labs.ai/api/reports` steht in den lokalen Release-Werten (`release-lokal/ios.env`, `android.env`). Beide Trockenlaeufe melden die Adresse als gesetzt (`mobile-docs/r32/web-anbindung.md`). Ohne sie baut kein Store-Paket.
5. **Platzhalter.** `mobile-docs/store/PLATZHALTER.md` durchgehen. Support-Seite (`https://lu-labs.ai/support`), Datenschutz, Bedingungen und Loeschseite (`https://lu-labs.ai/delete-account`) sind seit 14.10.2026 eingetragen und live. Offen dort: Anbietername, Testkonto fuer die Pruefer, Ansprechperson.
6. **Version.** Die Handy-Pakete tragen ihre eigene Version, der Desktop behaelt seine. Gesetzt wird sie an einer Stelle: `scripts/mobile/release/version-setzen.sh 3.0.7 1`, `git diff` ansehen, committen. Fuer 3.0.7 mit Baunummer 1 ist das erledigt (`30007001`), du musst hier nur etwas tun, wenn du dieselbe Version noch einmal hochlaedst. Immer ueber das Skript: die Baunummer des iOS-Pakets kommt aus den Dateien des Xcode-Projekts, die es mitschreibt, ein von Hand geaendertes Feld in `tauri.ios.conf.json` allein reicht nicht. Laedst du dieselbe Version noch einmal hoch, zaehlt die letzte Zahl hoch (`3.0.7 2`). `package.json` muss NICHT dieselbe Nummer tragen: ein Handy-Bau reicht der Seite About die Version seines Pakets (`src/dev/phone-version.ts`).

Kein Wert aus 1, 2 und 4 gehoert in eine Datei des Repos. Sie stehen nur in der Umgebung der Shell.

## 2. Der eine Befehl je Ziel

Erst mit `--dry-run`, bis nichts mehr fehlt. Dann ohne.

**Google Play** (Preset `play`, signiertes AAB und APK):

```sh
scripts/mobile/release/android-play.sh --version 3.0.7 --dry-run
scripts/mobile/release/android-play.sh --version 3.0.7
```

Ergebnis: der Ordner `release-pakete/play-3.0.7-<Baunummer>/` neben dem Arbeitsbaum, darin `LU-play-3.0.7-<Baunummer>.aab` (das laedst du hoch), das APK dazu, je ein Baubeleg (`.bau.json`) und `SHA256SUMS`.

**Android, direkter Download** (Preset `open`, signiertes APK, gehoert in keinen Store):

```sh
scripts/mobile/release/android-offen.sh --version 3.0.7 --dry-run
scripts/mobile/release/android-offen.sh --version 3.0.7
```

Ergebnis: der Ordner `release-pakete/offen-3.0.7-<Baunummer>/` mit `LU-offen-3.0.7-<Baunummer>.apk`, Baubeleg und `SHA256SUMS`.

**App Store** (Preset `appstore`, Archiv, Export, IPA):

```sh
scripts/mobile/release/ios-appstore.sh --version 3.0.7 --dry-run
scripts/mobile/release/ios-appstore.sh --version 3.0.7
```

Ergebnis: der Ordner `release-pakete/appstore-3.0.7-<Baunummer>/` mit `LU-appstore-3.0.7-<Baunummer>.ipa`, Baubeleg und `SHA256SUMS`. Signatur des Exports: von Xcode verwaltet (Standard) oder mit `LU_IOS_SIGNING=manual LU_IOS_PROFILE="Name des App-Store-Profils"`.

**Wo die Pakete liegen.** Jeder Befehl kopiert sein Ergebnis am Ende aus dem Bauordner in einen eigenen Ordner und nennt ihn, mit dem SHA-256 jeder Datei. Standard ist `release-pakete/` neben dem Arbeitsbaum, `export LU_RELEASE_PAKETE=/pfad` nennt einen anderen (er darf in keinem Git-Arbeitsbaum liegen). Der Ordner heisst `<ziel>-<version>-<baunummer>`. Play und der offene Bau schreiben ihr APK im Bauordner an dieselbe Stelle; in der Ablage liegen sie getrennt, die Reihenfolge der Bauten ist gleich. Baust du dieselbe Version und Baunummer noch einmal, steht der alte Ordner mit der Endung `.frueher-<Zeit>` daneben.

Nach jedem Bau: `git checkout -- src-tauri/gen/schemas src-tauri/gen/apple` (der Bau schreibt erzeugte Dateien um; im Probelauf war es bei allen drei Bauten nur `src-tauri/gen/schemas/acl-manifests.json`).

## 3. Was der Befehl prueft

Vor dem Bau, alles auf einmal, mit einer englischen Zeile je Luecke:

| Pruefung | Play | offen | App Store |
|---|---|---|---|
| Version genannt (`--version`) und in allen Dateien dieselbe, Baunummer passt dazu | ja | ja | ja |
| Die Seite About liest die Version des Handy-Pakets (Bau-Konstante), `package.json` darf abweichen | ja | ja | ja |
| Meldeadresse `VITE_LU_REPORT_URL`, https, kein Platzhalter (auch keine Adresse unter `.invalid`) | ja | nein, freiwillig | ja |
| Schluessel: `LU_ANDROID_KEY_PROPERTIES` gesetzt, vier Felder, Keystore da, nicht der Wegwerf-Schluessel | ja | ja | |
| Team-ID gesetzt, Kennung gleich der im Projekt, Signaturweg vollstaendig | | | ja |
| Feature `abnahme` ist kein Standard-Feature, `VITE_LU_ABNAHME` wird geloescht, das Skript nimmt keine Features an | ja | ja | ja |
| Werkzeuge (node, cargo, Rust-Ziel, SDK oder Xcode), 40 GB freier Platz | ja | ja | ja |

Nach dem Bau, am fertigen Paket. Scheitert eine Pruefung, endet der Befehl mit Fehler und nennt das Paket nicht als fertig:

| Pruefung | Android | iOS |
|---|---|---|
| Signatur gueltig und echt: kein Wegwerf- und kein Debug-Zertifikat. Mit `LU_ANDROID_CERT_SHA256` auch der Fingerabdruck | ja | |
| Signatur fuer den Store: Apple Distribution, dein Team, kein `get-task-allow`, App-Store-Profil | | ja |
| Kennung, Version und Baunummer wie genannt | ja | ja |
| Die gebaute Seite nennt dieselbe Version wie das Paket (`dist/index.html`, Angabe `lu-phone-version`): About zeigt, was der Store zeigt | ja | ja |
| Baubeleg: Release, genanntes Preset, kein Feature, bei Play mit Meldeadresse | ja | ja (Beleg am IPA) |
| Testhaken: `__LU_TEST__` nicht in der gebauten Seite, keine inspizierbare WebView im Programm | ja | ja |
| nur `arm64-v8a`, nicht debuggable | ja | |
| AAB signiert, dasselbe Zertifikat wie das APK, Signatur gueltig (`jarsigner -verify`); Kennung, Version und Baunummer aus dem Manifest des AAB selbst | Play | |
| Kein Probe-Paket: der Baubeleg sagt nicht `probe` | ja | ja |
| Schema `lu`, Berechtigungstexte passend zum Preset (kein lokales Netz, kein QR-Satz), nur iPhone (`UIDeviceFamily` 1), Privacy Manifest, Metal, Mindest-iOS (`pruefe-paket.sh`, `pruefe-geraete-paket.sh`) | | ja |
| Der lange Produktname steht nicht im Programm: `scripts/mobile/release/pruefe-name-im-paket.sh` (`strings` ueber jede Datei des Pakets, erlaubt sind nur die internen Stellen aus `name-im-paket.erlaubt`). Laeuft im Skript: `pruefe-android-paket.mjs` (APK und AAB) und `pruefe-ios-ipa.sh` rufen es neben `pruefe-testhaken.sh`, bei den Abnahmepaketen `scripts/mobile/ios/pruefe-paket.sh` und `scripts/mobile/android-bauen.sh` (`mobile-docs/r19/name-im-programm.md` Abschnitt 6) | ja | ja |

Was der Befehl nicht prueft: ob die App auf einem Geraet startet, ob die Anmeldung zurueckfindet (Punkt 3 oben), ob der Meldedienst wirklich annimmt.

## 4. Hochladen

Der Upload ist aus. Er laeuft nur mit `--upload` und dem Bestaetigungswort, und erst nach allen Pruefungen. Zugangsdaten kommen aus der Umgebung, kein Skript schreibt sie in eine Datei.

**App Store** (landet in TestFlight, reicht nichts zur Pruefung ein):

```sh
export APPLE_API_KEY=...          # Kennung des Schluessels fuer App Store Connect
export APPLE_API_ISSUER=...       # Aussteller
export APPLE_API_KEY_PATH=/pfad/AuthKey_<Kennung>.p8    # ausserhalb jedes Repos
scripts/mobile/release/ios-appstore.sh --version 3.0.7 --upload --confirm UPLOAD-TO-APP-STORE
```

Ohne Schluessel: das IPA mit der App Transporter hochladen.

**Google Play** (Entwurf in der internen Testspur, nichts geht live):

```sh
export LU_PLAY_SERVICE_ACCOUNT_JSON=/pfad/dienstkonto.json    # ausserhalb jedes Repos
scripts/mobile/release/android-play.sh --version 3.0.7 --upload --confirm UPLOAD-TO-PLAY
```

Braucht `fastlane` (`brew install fastlane`). Das allererste AAB einer App nimmt Google nur ueber die Play Console an: dort von Hand hochladen. Auch sonst ist die Console der einfachere Weg.

## 5. Nach dem Upload im Store noch zu klicken

**Play Console**

1. Store-Eintrag: Texte aus `mobile-docs/store/PLAY-EINTRAG.md` Abschnitte 1 bis 3, Grafiken und Screenshots aus Abschnitt 9, Kategorie und Tags aus 4 und 5, Kontaktdaten.
2. App-Inhalte: Datenschutzerklaerung (`https://lu-labs.ai/privacy`), App-Zugriff mit dem Testkonto (Abschnitt 8), Anzeigen (nein), Altersfreigabe (Fragebogen, Abschnitt 6), Zielgruppe 18+, Datensicherheit (Abschnitt 7), KI-generierte Inhalte, Kontoloeschung mit Adresse (`https://lu-labs.ai/delete-account`).
3. App-Inhalte, Erklaerung zu den Foreground-Service-Berechtigungen. Das Paket fordert `FOREGROUND_SERVICE_DATA_SYNC` fuer den Downloaddienst (`src-tauri/plugins/lu-native/android/src/main/AndroidManifest.xml`). Ohne diese Erklaerung laesst sich die Version nicht zur Pruefung senden. Art: Datensynchronisierung. Beschreibung: "Downloads a language model file that the user started in the app. The download keeps running when the app is in the background and shows its progress in a notification. The user can cancel it in the app, and the service stops when the download ends." Video: ein kurzer Bildschirmmitschnitt vom Tipp auf "Download" bis zur Benachrichtigung mit Fortschritt, auf einem Handy oder Emulator, ohne Konto (Pruefersicht B6).
4. Play App Signing bestaetigen (beim ersten Upload).
5. Release in der internen Testspur pruefen, dann zur geschlossenen oder offenen Spur befoerdern, Laender waehlen, zur Pruefung senden.

**App Store Connect**

1. Warten, bis der Bau unter TestFlight "verarbeitet" ist. Export Compliance erscheint nicht (`ITSAppUsesNonExemptEncryption` ist `false`).
2. App-Information: Name, Untertitel, Kategorie, Altersfreigabe mit Anhebung auf 18+ (`APPSTORE-EINTRAG.md` Abschnitte 1, 6, 7), Content Rights.
3. App Privacy ausfuellen (Abschnitt 8) und veroeffentlichen.
4. Version 3.0.7: Werbetext, Beschreibung, Schlagwoerter, Support URL (`https://lu-labs.ai/support`), Screenshots (Abschnitte 2 bis 5 und 10), den Bau auswaehlen.
5. App Review Information: Testkonto, Ansprechperson, Hinweise (Abschnitt 9).
6. Preis und Verfuegbarkeit festlegen, dann "Zur Pruefung einreichen".

## 6. Offen, bevor eingereicht wird

**Erledigt am 14.10.2026 (Runde 32, Web und App):** Meldedienst und Meldeadresse (Pruefersicht B1), Support-Seite (B5), eigene Loeschseite und der Link der App darauf (R7), Datenschutz und Bedingungen mit der Handy-App (R6), Widerruf von "Sign in with Apple" beim Loeschen in App und Server (R2; die Swift-Zeile ist geschrieben, nicht gebaut: am ersten Paket pruefen). Einzelheiten: `mobile-docs/r32/web-anbindung.md`.

**Offen, nur du:**

1. Supabase: `lu://oauth/callback` in die Redirect-Liste (Pruefersicht B4, Abschnitt 1 Punkt 3).
2. Supabase: Anbieter Apple einschalten, Client-ID `com.purpledoubled.lu` (B3, Abschnitt 1 Punkt 3.2). Fuer den Widerruf beim Loeschen braucht der Server dazu den Schluessel fuer "Sign in with Apple" in seinen Variablen; ohne ihn sagt die App beim Loeschen eines Apple-Kontos ehrlich, dass die Verbindung bei Apple nicht beendet wurde.
3. Demo-Konto fuer die Pruefer mit Passwort und Guthaben (B2, Abschnitt 1 Punkt 3.5).

Ausserdem, wie bisher:

- Die Store-Entscheidungen (`FUER-DAVID.md` Abschnitte 2 und 4, `STORE-BAUSTEINE.md` 8). Die Altersfreigabe bei Google und der Zuschnitt des Play-Pakets haengen daran, ob der Play-Bau Modelle ohne Ablehnungen, eigene Modelldateien und den Cloud-Chat in heutiger Form behaelt (`FUER-DAVID.md` Nr. 4 und Nr. 30, `PLAY-EINTRAG.md` Abschnitt 6).
- Android-Paketkennung vor dem ersten Upload bestaetigen, danach ist sie unveraenderlich (`FUER-DAVID.md` Nr. 29).
- iOS: erledigt am Paket 11. Die Berechtigungstexte nennen keinen Fernzugriff mehr, das Paket meldet nur das iPhone (`UIDeviceFamily` 1), iPad-Screenshots braucht es nicht (`APPSTORE-EINTRAG.md` Abschnitte 9 und 10).
- iOS, Anmeldung: Google und GitHub stehen im App-Store-Paket (David, 10.10.2026), darueber "Sign in with Apple" (Regel 4.8, Runde 15). Gebaut und im Browser und in Vitest belegt, an keinem iPhone gelaufen: das braucht die fuenf Schritte unter Punkt 3 in Abschnitt 1 und ein signiertes Paket (`mobile-docs/r15/apple-anmeldung.md`, "Am Geraet").
- Android: 16-KB-Seiten sind erledigt (Runde 13, am Paket 5 geprueft). Ein Update einer frueheren Android-App gibt es nicht, es wurde nie eine veroeffentlicht (`FUER-DAVID.md` Nr. 21).
- Ein Durchlauf auf einem echten Android-Handy und einem echten iPhone.
