# Nachabnahme auf Geräten

Stand 09.10.2026. Schrittliste für die Nachabnahme aller Befunde aus `mobile-docs/r3/GERAETE-BEFUNDE.md` am neuen Bau, dazu je ein Lauf "frisch installiert bis erstes Ergebnis".

Diese Liste ist am Schreibtisch entstanden: Kein Schritt hier ist an einem Gerät gelaufen. Wo ein Kommando oder eine Kennung am Gerät anders aussieht, gilt das Gerät, und die Abweichung gehört in den Bericht.

Gegliedert in drei Blöcke, je Block ein Gerät. Ein Abnahme-Agent fährt einen Block von Anfang bis Ende und schließt sein Gerät, bevor er den nächsten beginnt. Zwei Agenten können gleichzeitig je einen Block fahren, mehr nicht.

| Block | Gerät | Befunde | Abschnitt |
|---|---|---|---|
| A | Android, eigener Emulator | Frischlauf, AK-H1 bis AK-H4, AN-H1, AN-H2, AN-M1, AN-M2, weitere Punkte | 3 |
| IK | iOS klein (iPhone SE 3) | Frischlauf, IK-B1, IK-H1, IK-H2, Tastatur | 4 |
| IG | iOS groß (iPhone 17 Pro Max) | Frischlauf, IG-H1, IG-H3, IG-H4 bis IG-H6 | 5 |

Vorschlag für zwei Agenten: Agent 1 fährt A, danach IK. Agent 2 fährt IG. So laufen nie mehr als zwei Geräte.

## 1. Regeln, die hier zählen

Vollständig in `mobile-docs/regeln/AGENTEN-REGELN.md`. Für diese Liste:

- Höchstens 2 Emulatoren oder Simulatoren gleichzeitig auf der ganzen Maschine. Geräte starten nur über `node mobile-tests/geraet.mjs`. Das Werkzeug zählt vorher (`adb devices`, Emulatorprozesse, gebootete Simulatoren) und bricht bei 2 ab. Dann warten, nicht fremde Geräte schließen.
- `LU_Phone`, `LU_Fresh`, `LU_Bauer`, `Fernblick` gehören David. Sie zählen mit, werden aber nie gestartet, gestoppt, gelöscht oder als Testgerät benutzt. Die Treiber lehnen sie ab.
- Fremde Prozesse nie beenden. Kein `pkill`, kein `killall`. Appium stoppt `mobile-tests/ios/appium.sh stop` über die gemerkte Prozessnummer.
- Kein Agent gibt ein Passwort ein oder meldet an. Was eine Anmeldung braucht, endet als "nicht prüfbar ohne Anmeldung" und geht an David.
- Bezahltes je Runde höchstens: kleinstes Chat-Modell, 1 Bild (flux-schnell), 1x STT, 1x TTS. Nur mit `ALLOW_PAID=1`, der Kostenwächter zählt. Keine Schleifen.
- Belege liegen im Repo, nicht im Zwischenspeicher: Bilder nach `mobile-docs/belege/`, Ergebnis je Nummer in die Tabelle von Abschnitt 6.
- Nach dem Block: App-Server stoppen, Gerät schließen, eigenes Gerät löschen.

## 2. Gemeinsame Vorbereitung

### 2.1 Selbsttest ohne Gerät

```
node mobile-tests/selbsttest.mjs          # Teil 0: Gerätegrenze, Aufräumen, Erholung des Sweeps. Muss grün sein.
node mobile-tests/geraet.mjs zaehlen      # was läuft gerade auf der Maschine
```

### 2.2 Welche Baue gebraucht werden

Der Bau kommt vom Bau-Agenten bzw. aus dem zusammengeführten Stand, Wege in `mobile-docs/BAUEN.md`. Ein Abnahmebau (Feature `abnahme`) hat eine inspizierbare WebView und den Testhaken `window.__LU_TEST__`. Ohne ihn können die Treiber nicht in die Seite sehen.

| Kürzel | Plattform | Kommando | Wofür |
|---|---|---|---|
| A-open | Android | `VITE_LU_STORE_PRESET=open scripts/mobile/android-bauen.sh release abnahme` | Block A, alles außer AN-M1 |
| A-play | Android | `VITE_LU_STORE_PRESET=play VITE_LU_REPORT_URL=https://... scripts/mobile/android-bauen.sh release abnahme` | AN-M1 (Altersabfrage über einen echten Neustart) |
| I-open | iOS | `VITE_LU_STORE_PRESET=open scripts/mobile/ios/bauen.sh release abnahme` | Block IK und IG |
| I-appstore | iOS | `VITE_LU_STORE_PRESET=appstore VITE_LU_REPORT_URL=https://... scripts/mobile/ios/bauen.sh release` | Gegenprobe IG-H4 bis IG-H6 und IG-H1 am Store-Bau, nur Bildschirmfotos |

Hinweise:

- Ein Android-Release lässt sich nur signiert installieren (`BAUEN.md` 4.3). `src-tauri/gen/android/key.properties` nicht lesen und nicht ändern. Für die Probe gibt es den Wegwerf-Schlüssel aus `scripts/mobile/release/make-wegwerf-keystore.sh`.
- Beide Baue je Plattform schreiben an denselben Ort. Wer zwei braucht, kopiert den ersten weg.
- Das Preset lässt sich am Abnahmebau über den Testhaken umstellen (`storePreset('play' | 'appstore' | 'open')`). Das gilt nur bis zum nächsten Beenden der App: Der Haken merkt es sich in der Sitzung, ein harter Neustart bringt das Preset des Baus zurück. Deshalb braucht AN-M1 einen Bau, der `play` selbst trägt.
- Paketname Android: `com.purpledoubled.locallyuncensored`. Bundle-ID iOS: `com.purpledoubled.lu`.

### 2.3 Der Test-Haken von Hand

Für alles, was kein Flow abdeckt, gibt es `scripts/mobile/geraet-schritt.mjs`: ein Schritt am verbundenen Gerät, `d` ist der Treiber, `tid('m-x')` der Selektor einer Kennung.

```
# Wo steht die App, welches Preset, welches Konto
node scripts/mobile/geraet-schritt.mjs 'return await d.evalJs("window.__LU_TEST__.where()")'

# Route öffnen (Ausgangslage), dann mit echten Touches weiter
node scripts/mobile/geraet-schritt.mjs 'await d.evalJs("window.__LU_TEST__.go(\"/settings\")"); return 1'
node scripts/mobile/geraet-schritt.mjs 'return await d.tap(tid("m-chat-options"))'

# Bildschirmfoto als Beleg
node scripts/mobile/geraet-schritt.mjs 'return await d.screenshot("mobile-docs/belege/nach-A-AK-H1-01.png")'

# Preset umstellen (lädt die Seite neu, danach erst weiter)
node scripts/mobile/geraet-schritt.mjs 'await d.evalJs("window.__LU_TEST__.storePreset(\"appstore\")"); await d.sleep(3000); return await d.evalJs("window.__LU_TEST__.where().storePreset")'
```

Regel: Der Haken stellt Ausgangslagen her und liest Zustand. Was der Kunde tut (tippen, schreiben, zurück), läuft über `d.tap`, `d.type`, `d.back`, also echte Touches. Ein Befund gilt nicht als behoben, weil der Haken etwas direkt gesetzt hat.

Kennungen stehen in `mobile-tests/flows/selektoren.mjs` und `mobile-tests/TESTIDS.md`. Wo unten "Kennung nachschlagen" steht, ist sie dort oder in den Quellen der Shell zu suchen, nicht zu raten.

### 2.4 Berechtigungen und Systemdialoge

- Der iOS-Treiber beantwortet einen Systemdialog, der einen Tipp blockiert, selbst mit dem zustimmenden Knopf (Allow, OK, Open). `IOS_SYSTEMDIALOG=ablehnen` oder `melden` ändert das. Was er gesehen hat, liefert `d.systemDialoge()`.
- Der Sweep lehnt einen Systemdialog ab, den sein Tipp ausgelöst hat (er bestätigt nie etwas). Eine abgelehnte Berechtigung fragt iOS nicht noch einmal. Deshalb vor Sweep und Flows vorab erteilen:

```
node scripts/mobile/geraet-schritt.mjs --ohne 'd.pkg = process.env.APP_PKG; return await d.berechtigung("mikrofon", "grant")'
```

- Im Frischlauf soll der Dialog dagegen zu sehen sein: dort nichts vorab erteilen, auf iOS vorher `d.berechtigung("alle", "reset")`.
- Android: `beantworteBerechtigung(d)` aus `mobile-tests/lib/nativ.mjs` tippt den Knopf der Berechtigungsfrage über seine Kennung.

### 2.5 Wenn etwas hängt

- Ein Tipp "kam in der Seite nicht an": Etwas Natives liegt darüber. Bildschirmfoto machen, dann `d.dismissNative()` (iOS) bzw. `d.back()` (Android).
- Der Sweep räumt selbst auf und wiederholt den Tipp einmal. Nach 4 Rahmenfehlern in Folge endet die Route mit dem Vermerk `abgebrochen`, der Lauf geht mit der nächsten weiter. Solche Routen einzeln nachfahren: `ROUTEN=/pfad node mobile-tests/sweep.mjs`.
- `connect ... gescheitert` unter Last: `MT_CONNECT_MS=90000` setzen.
- Appium antwortet nicht mehr: Der Treiber startet den eigenen Server neu. Bleibt es dabei, `mobile-tests/ios/appium.sh stop` und `start`.
- Nie ein fremdes Gerät oder einen fremden Prozess beenden, um Platz zu schaffen.
- macOS hat kein `timeout`. Eine Zeitgrenze für einen langen Lauf setzt `perl -e 'alarm shift; exec @ARGV' 1500 node mobile-tests/sweep.mjs`. Sweep und Layoutlauf über alle Routen besser in Stücken fahren (`ROUTEN=` mit 12 bis 20 Namen je Aufruf, dasselbe `LAUF_DIR`): Der Sweep schreibt je Route eine Datei, der Layoutlauf schreibt sein Ergebnis erst am Ende eines Aufrufs (`LAYOUT_NAME` je Stück eindeutig setzen).

## 3. Block A: Android

Gerät: ein eigener Emulator, Android 14, Pixel 6. Baue: A-open, für AN-M1 zusätzlich A-play.

### 3.1 Gerät anlegen und starten

```
SDK=${ANDROID_HOME:-$HOME/Library/Android/sdk}
$SDK/cmdline-tools/latest/bin/avdmanager create avd -n LU-Nach-A -k "system-images;android-34;google_apis;arm64-v8a" -d pixel_6
node mobile-tests/geraet.mjs android-start LU-Nach-A        # zählt vorher, bricht bei 2 laufenden Geräten ab

export PLATFORM=android ANDROID_AVD=LU-Nach-A
export APP_PKG=com.purpledoubled.locallyuncensored
export MT_CONFIG=$PWD/mobile-tests/config.mjs
export LAUF_DIR=$PWD/mobile-tests/out/android/nach-A-$(date +%F_%H-%M)
export STORE_PRESET=open
```

### 3.2 Frischlauf A-F: frisch installiert bis erstes Ergebnis

Preset: open. Erwartet: Vom ersten Start bis zur ersten lokalen Antwort führt die App ohne Sackgasse, ohne Fehlerblock und ohne zweite Nachfrage.

1. Installieren, nicht starten: `node scripts/mobile/geraet-schritt.mjs --ohne 'return await d.installApk("<pfad zur apk>")'`
2. Erster Start mit Onboarding, kleinstem Modell (echter Download, 270 MB), erster Antwort, Teilen-Dialog, Deep Link warm und kalt, Hintergrund, Abschuss und Neustart:
   `node scripts/mobile/erster-start.mjs nach-A-frisch`
   Bilder landen in `mobile-docs/belege/nach-A-frisch-NN-*.png`, am Ende steht je Schritt ein Ergebnis.
3. Jedes Bild ansehen. Zu prüfen: keine Altersabfrage (open), Onboarding lesbar, Download mit Fortschritt, Antwort erscheint ohne Fehlerblock davor (das ist AK-H1), nach dem Neustart ist der Chat noch da.
4. Gegenlauf mit dem Flow, auf frischen Daten: `FRISCH=1 BIS=erster-chat node mobile-tests/flows/kundenfluss.mjs`

Von Hand: nichts, wenn beide Läufe grün sind und die Bilder stimmen.

### 3.3 AK-H1: Fehlerblock erscheint vor der Antwort

Preset: open. Abgedeckt durch: Flow `erster-chat`, dazu eine Beobachtung von Hand.

1. `AB=erster-chat BIS=erster-chat node mobile-tests/flows/kundenfluss.mjs`
2. Von Hand, weil der Flow nur das Ende sieht: neue Frage senden und während der Antwort alle 500 ms nachsehen, ob ein Fehlerblock da ist.
   ```
   node scripts/mobile/geraet-schritt.mjs 'await d.tap(tid("m-chat-input")); await d.type("Say hello in one sentence."); await d.tap(tid("m-chat-send")); const gesehen = []; for (let i = 0; i < 60; i++) { gesehen.push(await d.evalJs("[!!document.querySelector(\"[data-testid=m-chat-error]\"), !!document.querySelector(\"[data-testid=m-chat-engine-error]\"), document.querySelectorAll(\"[data-testid=m-chat-message][data-state=done]\").length].join()")); await d.sleep(500) } return gesehen'
   ```
3. Erwartet: In keiner Zeile steht `true` an erster oder zweiter Stelle, die Zahl fertiger Antworten steigt um 1.
4. Dreimal wiederholen, einmal davon direkt nach einem Kaltstart (`d.kill()`, `d.launch()`), weil das Modell dann erst lädt.

### 3.4 AK-H2: Vorlesen stumm

Preset: open. Abgedeckt durch: Flow `sprache-raus` (bezahlt, 1x TTS) nur mit Anmeldung. Ohne Anmeldung von Hand mit der Stimme des Geräts.

1. Einstellungen, Voice öffnen. Erwartet: Die Seite sagt, welche Stimme da ist. Ohne Stimme und ohne Cloud ist "Read aloud" gesperrt und nennt den Grund. Bild machen.
2. Ist eine Stimme da: im Chat an einer fertigen Antwort `m-chat-speak` tippen. Erwartet: `m-chat-speaking` erscheint und verschwindet am Ende wieder.
3. Ton belegen, so weit ein Emulator das kann: während `m-chat-speaking` zu sehen ist `adb -s <serial> shell dumpsys media.audio_flinger | grep -i -A2 "$APP_PKG"` bzw. `dumpsys audio | grep -i -B2 -A6 "player"`. Erwartet: eine aktive Wiedergabe der App.
4. Mit Anmeldung (David): `ALLOW_PAID=1 AB=sprache-raus BIS=sprache-raus node mobile-tests/flows/kundenfluss.mjs`, genau einmal.

Grenze: Ob wirklich etwas zu hören ist, kann kein Agent belegen. Der Punkt bleibt bis zu Davids Ohr "am Emulator plausibel".

### 3.5 AK-H3: Websuche liefert nichts

Preset: open. Abgedeckt durch: Flow `agent` prüft nur, dass ein Werkzeug läuft, nicht die Websuche. Also von Hand.

1. Ein Modell mit Werkzeugen laden: `qwen3.5-2b` (wird auch für AK-H4 gebraucht). `ZWEITES_MODELL=qwen3.5-2b AB=modellwechsel BIS=modellwechsel node mobile-tests/flows/kundenfluss.mjs`
2. Chat-Optionen (`m-chat-options`), Agent einschalten (`m-options-agent`), Blatt schließen.
3. Frage mit echten Touches: "Search the web: what is the capital of Australia? Name your source."
4. Fragt die App um Erlaubnis (`m-sheet-approval`), mit `m-approval-allow` erlauben.
5. Erwartet: ein Werkzeugaufruf (`m-chat-tool`) mit Ergebnis (`m-chat-tool-result`), kein `m-chat-tool-error`. Die Antwort nennt Canberra und eine Quelle. Bild der Antwort und des aufgeklappten Ergebnisses.
6. Verlangt die Suche einen Schlüssel (`m-search-key-hint`), ist das der Befund: festhalten, welcher Anbieter voreingestellt ist und was die App dazu sagt.

### 3.6 AK-H4: Qwen 3.5 2B denkt 10 Minuten

Preset: open. Abgedeckt durch: nichts, von Hand.

1. Modelle, Karte `qwen3.5-2b`, Detail öffnen. Erwartet: die Marke "Thinking" (`m-models-detail-thinking`) und darunter der Satz, wo das Denken geschaltet wird (`m-models-detail-thinking-note`). Die Detailseite hat keinen Schalter: Das Denken ist eine Einstellung des Chats, nicht des Modells (DESIGN.md M2 nennt keinen, der Schalter ist C5.2). Dann im Chat die Optionen öffnen (`m-chat-options`). Erwartet: Der Schalter für das Denken (`m-options-thinking`) steht auf aus. Bild von beidem.
   Auf einem Gerät, auf dem `qwen3.5-2b` als zu groß gilt (4 GB), dieselbe Prüfung mit einer kleineren Packung desselben Modells (Detail, Variante wählen, laden). Die Marken "Thinking" und "Tools" und das Urteil über die Passung müssen nach dem Download in der Liste Installed dieselben sein wie vorher auf der Detailseite (Fund N1 der Nachabnahme Android).
2. Im Chat mit diesem Modell: "What is 17 times 3?" senden, Uhr läuft ab dem Senden.
3. Erwartet: Die fertige Antwort steht nach höchstens 2 Minuten da (Emulator ohne GPU), ohne langen Denkblock davor. Zeit notieren.
4. Gegenprobe: Denken in den Chat-Optionen einschalten (`m-options-thinking`), dieselbe Frage. Erwartet: Es denkt sichtbar, bleibt bedienbar, `m-chat-stop` hält es an.

### 3.7 AN-H1: Einfügen-Knöpfe ohne Wirkung

Preset: open. Abgedeckt durch: Sweep (meldet einen Knopf ohne Wirkung), die Wirkung selbst von Hand.

1. Text in die Zwischenablage des Geräts legen: in einem Textfeld der App "lu-paste-probe" tippen, markieren und kopieren, oder über `adb shell input` in einem beliebigen Feld. Nicht per JavaScript, die Zwischenablage muss die des Systems sein.
2. Jeden Einfügen-Knopf einmal mit echtem Touch tippen. Fundstellen: Remote verbinden (Feld für den Code), Websuche (Feld für den Schlüssel), Anbieter-Detail (`m-settings-provider-key-paste`). Weitere über die Suche nach `pasteable` und `paste=` in `src/mobile`.
3. Erwartet: Das Feld enthält danach "lu-paste-probe". Bei einem Feld für ein Geheimnis zählt, dass es nicht mehr leer ist (Wert nicht auslesen, nur die Länge: `d.evalJs("document.activeElement.value.length")`).
4. Kommt die Systemfrage "Einfügen erlauben", ist das richtig: einmal erlauben, danach muss der Wert drin sein.
5. Echten Schlüssel oder echtes Token nie einfügen.

### 3.8 AN-H2: Teilantwort nach hartem Beenden weg

Preset: open. Abgedeckt durch: Fehlerfall `abschuss-in-der-antwort` und Persistenz `stream`.

```
NUR=abschuss-in-der-antwort node mobile-tests/flows/fehlerfaelle.mjs
VARIANTEN=abschuss,stream node mobile-tests/checks/persistenz.mjs
```

Erwartet: Nach dem Neustart stehen die Frage und der Anfang der Antwort im Chat, die App sagt, wie es weitergeht (Hinweis nach der Rückkehr oder Kasten `m-chat-error` mit `m-chat-error-action`). Bild vor dem Abschuss und danach nebeneinander ansehen: Der Text von davor muss noch da sein, nicht nur die Frage.

### 3.9 AN-M1: Altersabfrage kommt nach Neustart erneut

Preset: play, Bau A-play (das Preset muss einen echten Neustart überleben). Abgedeckt durch: `flows/alter.mjs`, dazu Wiederholungen, weil es ein Wettlauf war.

1. A-play installieren (über die vorhandene App oder nach `d.clearData()`), `export STORE_PRESET=play`.
2. `node mobile-tests/flows/alter.mjs` Erwartet: Frage beim ersten Start, Nein sperrt auch nach Neustart, Ja lässt herein und fragt nach Neustart nicht mehr.
3. Wettlauf: zehnmal hart beenden und starten, jedes Mal sofort nachsehen.
   ```
   node scripts/mobile/geraet-schritt.mjs 'const aus = []; for (let i = 0; i < 10; i++) { await d.kill(); await d.launch(); for (let k = 0; k < 6; k++) { aus.push(i + ":" + await d.evalJs("!!document.querySelector(\"[data-testid=m-age-gate]\")")); await d.sleep(250) } } return aus'
   ```
4. Erwartet: kein einziges `true`, auch nicht in den ersten 250 ms nach dem Start.
5. Danach wieder A-open installieren, wenn der Block weitergeht.

### 3.10 AN-M2: Layout bei Schrift 200 % bricht

Preset: open. Abgedeckt durch: `checks/layout.mjs` (stellt Schrift 1,0, 1,3 und 2,0 ein und zurück).

```
node mobile-tests/checks/layout.mjs
```

Erwartet: Bei 2,0 kein Überlauf und kein abgeschnittener Text in Reiterleiste, Chips und Fußzeilen. Die Bilder der Variante 2,0 für Chat, Create, Models, Settings und ein Blatt ansehen, nicht nur die Zahlen. Am Ende steht die Schrift wieder auf dem Wert von davor (der Lauf prüft das, sonst `d.setFontScale(1)`).

### 3.11 Weitere Punkte aus den Läufen

| Punkt | Schritte | Erwartet | Abdeckung |
|---|---|---|---|
| Speicheranzeige aktualisiert nicht | Models, Storage öffnen, Wert notieren. Ein Modell laden bzw. löschen (Löschen nur das eigene Testmodell), zurück zur Seite | Der Wert hat sich ohne Neustart geändert | von Hand, Kennung `m-settings-storage` und Storage-Seite |
| QR-Sackgasse auf Android | Remote öffnen, QR scannen wählen, Kamera ablehnen bzw. abbrechen | Es gibt einen Weg zurück und einen Weg ohne Kamera (Code eingeben). Zurück-Taste führt zur Seite davor | Flow `remote` bis zur Maske, Rest von Hand |
| Tastatur verdeckt Eingabefelder | `node mobile-tests/checks/layout.mjs` (prüft die Tastatur bei Schrift 1,0 von selbst, `TASTATUR=alle` in jeder Variante) | Jedes fokussierte Feld liegt über der Tastatur, `tastaturVerdeckt` ist 0 | `checks/layout.mjs` |
| Risikomarke fehlt an Bestätigungsknöpfen | `node mobile-tests/inventory.mjs`, je Seite mit einem Lösch- oder Kaufknopf | Jeder solche Knopf trägt `data-m-risk` | Inventar, Abschnitt gesperrt, und `ABWEICHUNGEN.md` |
| Sweep-Einträge "ohne Wirkung" | `node mobile-tests/sweep.mjs`, danach `node mobile-tests/report.mjs $LAUF_DIR` | Kein Eintrag "keine sichtbare Wirkung" ohne Erklärung. Jeden verbliebenen von Hand tippen | `sweep.mjs` |

### 3.12 Gerät schließen

```
node mobile-tests/report.mjs $LAUF_DIR
node mobile-tests/geraet.mjs android-stop LU-Nach-A
node mobile-tests/geraet.mjs android-loeschen LU-Nach-A
node mobile-tests/geraet.mjs zaehlen
```

## 4. Block IK: iOS klein

Gerät: iPhone SE (3. Generation), iOS 26.5, eigener Simulator. Bau: I-open.

### 4.1 Gerät anlegen und starten

```
RT=com.apple.CoreSimulator.SimRuntime.iOS-26-5
xcrun simctl create LU-Nach-klein com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation $RT
node mobile-tests/geraet.mjs ios-start LU-Nach-klein          # zählt vorher, bricht bei 2 laufenden Geräten ab

export PLATFORM=ios IOS_SIM=LU-Nach-klein
export APP_PKG=com.purpledoubled.lu
export APPIUM_PORT=4741                                       # der zweite iOS-Agent nimmt 4742
export MT_CONFIG=$PWD/mobile-tests/config.mjs
export LAUF_DIR=$PWD/mobile-tests/out/ios/nach-IK-$(date +%F_%H-%M)
export STORE_PRESET=open
mobile-tests/ios/appium.sh start
```

Jeder iOS-Agent braucht seinen eigenen `APPIUM_PORT`. Teilen sich zwei einen Server, nimmt der erste beim Stoppen dem zweiten die Verbindung.

### 4.2 Frischlauf IK-F: frisch installiert bis erstes Ergebnis

Preset: open. Erwartet wie in 3.2, dazu: Auf dem kleinen Bildschirm ist nichts abgeschnitten, jeder Knopf des Onboardings ist ohne Scrollen oder mit sichtbarem Scrollen erreichbar.

1. `node scripts/mobile/geraet-schritt.mjs --ohne 'd.pkg = process.env.APP_PKG; return await d.installApp("src-tauri/gen/apple/build/arm64-sim/LU.app")'`
2. Berechtigungen zurücksetzen, damit die Dialoge wie beim Kunden kommen: `node scripts/mobile/geraet-schritt.mjs --ohne 'd.pkg = process.env.APP_PKG; return await d.berechtigung("alle", "reset")'`
3. `node scripts/mobile/erster-start.mjs nach-IK-frisch`
4. Bilder ansehen. Der Deep Link warm fragt "Open in LU?", der Treiber bestätigt. Kalt startet die App ohne Frage.
5. Gegenlauf: `FRISCH=1 BIS=erster-chat node mobile-tests/flows/kundenfluss.mjs` (auf iOS löscht `FRISCH` die App und spielt sie neu ein).

### 4.3 IK-B1: Dokumente im Chat blockieren

Preset: open. Abgedeckt durch: Flow `dokument` (und `onboarding-dokumente`).

1. `AB=dokument BIS=dokument node mobile-tests/flows/kundenfluss.mjs`
2. Erwartet: Das Dokument wird eingebettet und die Frage dazu beantwortet. Einbettung und Chat teilen sich einen Modellplatz: Die App darf dabei nicht stehen bleiben. Während die Einbettung läuft (`m-documents-working`), bleibt der Chat bedienbar oder sagt, worauf er wartet.
3. Von Hand, der eigentliche Befund: Dokument anhängen und sofort eine Frage senden, ohne das Ende der Einbettung abzuwarten. Erwartet: Die Frage wird nach der Einbettung beantwortet oder die App sagt klar, dass sie wartet. Kein Zustand, in dem weder Einbettung noch Antwort vorankommen. Nach 3 Minuten ohne Fortschritt gilt es als blockiert.
4. Bild während der Einbettung und nach der Antwort.

### 4.4 IK-H1: Websuche im Agenten liefert nichts

Wie 3.5, auf diesem Gerät. Das Modell `qwen3.5-2b` braucht auf dem SE Platz und Arbeitsspeicher: Sperrt die App es als zu groß (`m-models-toolarge-hint`), ist der Punkt hier "nicht prüfbar auf diesem Gerät" und wird in Block IG gefahren.

### 4.5 IK-H2: Download setzt nach Abbruch nicht fort

Preset: open. Abgedeckt durch: Fehlerfälle `download-abgebrochen` und `download-app-abschuss`.

```
NUR=download-abgebrochen,download-app-abschuss node mobile-tests/flows/fehlerfaelle.mjs
```

Erwartet: Nach dem Abbruch zeigt die Karte den Stand und einen Weg weiter (`m-models-resume`). Nach dem Fortsetzen läuft der Zähler von der alten Stelle weiter und nicht von 0. Stand vor dem Abbruch und nach dem Fortsetzen notieren.

Grenze auf iOS: Der Treiber kann das Netz nur für die WebView kappen, nicht für den Download der nativen Seite. `download-abgebrochen` kann deshalb als "nicht prüfbar" enden. Dann zählt `download-app-abschuss` und von Hand: Download starten, in der App anhalten bzw. abbrechen, fortsetzen. Für einen langsamen Download, der sich sicher mittendrin treffen lässt, gibt es `scripts/mobile/ios/drossel-server.mjs`.

### 4.6 Tastatur verdeckt Eingabefelder

```
node scripts/mobile/geraet-schritt.mjs --ohne 'd.pkg = process.env.APP_PKG; return await d.berechtigung("mikrofon", "grant")'
node mobile-tests/checks/layout.mjs          # prüft die Tastatur bei Schrift 1,0 von selbst, TASTATUR=alle in jeder Variante
```

Erwartet: `tastaturVerdeckt` ist 0, jedes fokussierte Feld liegt über der Tastatur, auf dem SE vor allem Chat-Eingabe, Remote-Code, Suche in Models. Bilder mit offener Tastatur ansehen.

### 4.7 Gerät schließen

```
node mobile-tests/report.mjs $LAUF_DIR
mobile-tests/ios/appium.sh stop
node mobile-tests/geraet.mjs ios-stop LU-Nach-klein
node mobile-tests/geraet.mjs ios-loeschen LU-Nach-klein
```

## 5. Block IG: iOS groß

Gerät: iPhone 17 Pro Max, iOS 26.5, eigener Simulator. Baue: I-open, für die Gegenprobe I-appstore.

### 5.1 Gerät anlegen und starten

Wie 4.1 mit `LU-Nach-gross`, Gerätetyp `com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max`, `LAUF_DIR=.../nach-IG-...` und, wenn Block IK gleichzeitig läuft, `APPIUM_PORT=4742`.

### 5.2 Frischlauf IG-F: frisch installiert bis erstes Ergebnis

Wie 4.2 mit dem Präfix `nach-IG-frisch`. Zusätzlich ansehen: Auf dem großen Bildschirm liegt nichts unter der Dynamic Island oder dem Balken am unteren Rand, Blätter haben oben einen Griff oder einen Schließen-Knopf.

### 5.3 IG-H1: Schema `lu://` fehlt im iOS-Paket

Preset: jedes, zu prüfen an I-open und an I-appstore. Abgedeckt durch: `erster-start.mjs` (Deep Link warm und kalt), dazu der Blick ins Paket.

1. Im Paket: `/usr/bin/plutil -extract CFBundleURLTypes json -o - src-tauri/gen/apple/build/arm64-sim/LU.app/Info.plist` Erwartet: ein Eintrag mit `CFBundleURLSchemes` und darin `lu`.
2. `node mobile-tests/checks/release.mjs` für das Paket (Info.plist, Baubeleg, Preset).
3. Am Gerät: Die Schritte "Deep Link warm" und "Deep Link kalt" aus 5.2 müssen grün sein. Einzeln: `node scripts/mobile/geraet-schritt.mjs 'return await d.openUrl("lu://remote?url=https%3A%2F%2Fexample.invalid&code=000000")'` Erwartet: `dialog: true` bei laufender App, danach zeigt die App das Angebot zur Verbindung. Das Angebot ablehnen, nie annehmen.
4. Dasselbe am Bau I-appstore, ohne Treiber in der Seite: `xcrun simctl openurl <udid> "lu://remote?..."` und ein Bild über `d.screenshot` mit `--ohne`.

### 5.4 IG-H3: Continue verwirft die Teilantwort

Preset: open. Abgedeckt durch: Fehlerfall `abschuss-in-der-antwort` bis zum Kasten, der Tipp auf Continue von Hand.

1. `NUR=abschuss-in-der-antwort node mobile-tests/flows/fehlerfaelle.mjs` Danach steht im Chat eine unterbrochene Antwort mit dem Kasten `m-chat-error`.
2. Den Text der Teilantwort festhalten: `node scripts/mobile/geraet-schritt.mjs 'return await d.evalJs("[...document.querySelectorAll(\"[data-testid=m-chat-answer]\")].pop().innerText")'`
3. Mit echtem Touch `m-chat-error-action` (Continue) tippen, auf das Ende der Antwort warten.
4. Erwartet: Die fertige Antwort beginnt mit dem Text aus Schritt 2 und geht dahinter weiter. Sie ist nicht kürzer als vorher und fängt nicht von vorn an. Beide Texte in den Bericht.
5. Zweiter Weg: Antwort mit `m-chat-stop` anhalten statt die App abzuschießen, dann fortsetzen. Gleiche Erwartung.

### 5.5 IG-H4, IG-H5, IG-H6: appstore zeigt, was es nicht zeigen darf

Preset: appstore. Zwei Stufen: am Abnahmebau I-open mit über den Haken umgestelltem Preset (jede Seite maschinell), danach die Gegenprobe am echten Store-Bau I-appstore mit Bildern.

| Nr | Darf nicht zu sehen sein |
|---|---|
| IG-H4 | eigene Anbieter (Custom endpoint, API key), Remote, Hugging-Face-Token |
| IG-H5 | "no refusals", "uncensored", Persona "No Filter", Modelle mit "Abliterated" |
| IG-H6 | Kaufwörter (Buy, Upgrade, Subscribe, Plans, Pricing) und Links zu lu-labs.ai |

Stufe 1, Abnahmebau:

```
PRESET_SETZEN=appstore node mobile-tests/checks/storeworte.mjs     # alle Routen, Endwert 1 bei Funden
node mobile-tests/flows/alter.mjs                                  # nur wenn der Bau das Preset selbst trägt
```

- Jeder Fund kommt mit Route, Text und Bild unter `$LAUF_DIR/storeworte/`. Jeden ansehen: Die Liste ist ein Netz, kein Urteil. "Hinweise" (Remote, Plan) sind zu prüfen, aber nicht automatisch ein Befund.
- Am Ende nennt der Lauf die Routen, die er nicht herstellen konnte. Die sind ungeprüft und werden von Hand geöffnet.
- Von Hand, weil kein Text es verrät: Personas durchblättern (keine "No Filter"), Modellkatalog durchscrollen (kein "Abliterated", keine eigene Modell-URL), Create öffnen, Einstellungen jede Zeile, Konto ohne Anmeldung, das Blatt "Guthaben leer" über den Haken (`guthabenLeer(true)`): Es darf keinen Kauf anbieten.
- Das Preset gilt nur bis zum Beenden der App. Nach jedem `d.kill()` neu setzen und mit `where().storePreset` prüfen.

Stufe 2, Store-Bau I-appstore (nicht inspizierbar):

1. Installieren, starten, Altersabfrage mit Ja beantworten (Tipp über Koordinaten mit `d.tapPunkt`, weil der Treiber nicht in die Seite sieht).
2. Je Reiter und je Einstellungsseite ein Bild über `geraet-schritt.mjs --ohne` und `d.screenshot`. Die Fundstellen aus Stufe 1 gezielt aufsuchen.
3. Erwartet: dieselben Seiten wie in Stufe 1, nichts aus der Tabelle oben ist zu sehen.
4. `node mobile-tests/checks/release.mjs`: Der Baubeleg nennt `appstore`, einen Meldedienst und keinen Testhaken.

### 5.6 Gerät schließen

Wie 4.7 mit `LU-Nach-gross`.

## 6. Ergebnis festhalten

Je Block eine Kopie dieser Tabelle nach `mobile-docs/r4/NACHABNAHME-<block>.md`, ausgefüllt. Urteil: behoben, nicht behoben, nicht prüfbar (mit Grund), offen.

| Nr | Gerät | Preset | Bau (Commit) | Urteil | Beleg (Bild, Datei im Lauf) | Bemerkung |
|---|---|---|---|---|---|---|
| A-F | Android | open | | | | |
| AK-H1 | Android | open | | | | |
| AK-H2 | Android | open | | | | |
| AK-H3 | Android | open | | | | |
| AK-H4 | Android | open | | | | |
| AN-H1 | Android | open | | | | |
| AN-H2 | Android | open | | | | |
| AN-M1 | Android | play | | | | |
| AN-M2 | Android | open | | | | |
| Weitere (5 Zeilen aus 3.11) | Android | open | | | | |
| IK-F | iOS klein | open | | | | |
| IK-B1 | iOS klein | open | | | | |
| IK-H1 | iOS klein | open | | | | |
| IK-H2 | iOS klein | open | | | | |
| Tastatur | iOS klein | open | | | | |
| IG-F | iOS groß | open | | | | |
| IG-H1 | iOS groß | open und appstore | | | | |
| IG-H3 | iOS groß | open | | | | |
| IG-H4 | iOS groß | appstore | | | | |
| IG-H5 | iOS groß | appstore | | | | |
| IG-H6 | iOS groß | appstore | | | | |

Ein Befund gilt erst als behoben, wenn der Schritt gelaufen ist, das Bild angesehen wurde und das Erwartete darauf zu sehen ist. Ein grüner Flow allein reicht nicht (`PERSONA-DREHBUCH.md`).

## 7. Was diese Liste nicht abdeckt

- Echtes iPhone und echtes Android-Gerät: Alles hier ist Emulator und Simulator.
- Ton: Ob Vorlesen hörbar ist, belegt nur David.
- Alles mit Anmeldung: Cloud-Chat, Bild, Diktat über Cloud, Guthaben am echten Konto. Die Schritte enden ohne Anmeldung als "nicht prüfbar".
- Netz weg für die native Seite auf iOS: Der Simulator hat keinen Schalter dafür, der Treiber kappt nur die WebView.
- Speicherdruck des Systems (jetsam) auf iOS: Der Simulator stellt ihn nicht her.
