# mobile-tests: Abnahmerahmen fuer LU Mobile

Werkzeuge, mit denen die acht Abnahmepunkte aus `MOBILE-ZIEL.md`, Abschnitt 3, am Geraet belegt werden.
Reine `.mjs`-Module, keine Abhaengigkeiten, kein `npm install`. Braucht Node 22 oder neuer (WebSocket und fetch sind eingebaut).
Android braucht dazu `adb`, iOS braucht Xcode mit Simulator, `ios_webkit_debug_proxy` und einen lokalen Appium-Server (Abschnitt "Abnahme starten: iOS").

Zuerst lesen: `MOBILE-ZIEL.md`, `mobile-docs/ABNAHME.md`, dann `driver/INTERFACE.md` und `TESTIDS.md`. Welche Seiten, Blaetter und Kennungen die Shell hat, steht in `TABELLE.md`, wo sie von der Regel abweicht, in `ABWEICHUNGEN.md`.

## Was es gibt

| Datei | Wozu | Abnahmepunkt |
|---|---|---|
| `driver/android.mjs` | Steuert die WebView ueber Chrome DevTools Protocol und das Geraet ueber adb | alle |
| `driver/ios.mjs` | Steuert die WKWebView ueber den WebKit Remote Inspector, Finger und System ueber WebDriverAgent, das Geraet ueber `simctl`. Nur Simulator | alle |
| `driver/index.mjs`, `driver/INTERFACE.md` | Treiberwahl ueber `PLATFORM`, Vertrag und Tabelle der Unterschiede zwischen Android und iOS | alle |
| `ios/appium.sh` | Appium samt XCUITest-Treiber in den ignorierten Ordner `.werkzeug/` einrichten, starten, stoppen | |
| `inventory.mjs` | Inventar des Screens: Name, Rolle, Zustand, Box. Meldet "ohne Namen", "ohne Rolle", "unter 44x44" | 2, 5 |
| `sweep.mjs` | Tippt jedes Element einmal an: wirkung, keine sichtbare Wirkung, fehler | 2 |
| `checks/copy.mjs` | Desktop-Reste und Gedankenstriche in sichtbaren Texten | 2 |
| `checks/layout.mjs` | Ueberlauf, abgeschnittener Text, Safe Area, Tastatur. Hoch und Quer, Schrift 1.0, 1.3, 2.0, hell und dunkel | 5 |
| `checks/zurueck.mjs` | Zurueck fuehrt eine Ebene hoch und schliesst die App nicht | 5 |
| `checks/persistenz.mjs` | Chat und Einstellung schreiben, dann Abschuss, Abschuss im Stream, Neustart des Geraets, Update ueber die Installation. Danach nachsehen | 6 |
| `checks/vollstaendigkeit.mjs` | Liest `mobile-docs/INVENTUR-FUNKTIONEN.md`: keine Zeile ohne Urteil | 1 |
| `messlatte.mjs` | Fuehrt tsc, vitest, vite build und cargo check aus und schreibt `out/messlatte.json` | 7 |
| `checks/release.mjs` | Prueft die Release-Pakete: APK-Signatur und Version, Info.plist der iOS-App, Baubeleg mit dem Store-Preset, keine Schluessel im Repo | 8 |
| `flows/kundenfluss.mjs`, `PERSONA-DREHBUCH.md` | Der ganze Kundenfluss in 26 Schritten, als ausfuehrbarer Fluss und als Drehbuch fuer den Persona-Agenten | 3, 6 |
| `flows/fehlerfaelle.mjs` | Die sieben Fehlerfaelle in 11 Schritten, dazu Abschuss mitten im Download und mitten in der Antwort | 4 |
| `flows/alter.mjs` | Altersabfrage je Store-Preset | 3 |
| `flows/n1.mjs` | N1: die Datei des gewaehlten Chatmodells fehlt. Laedt vorher ein anderes Modell, wenn das Ziel schon geladen ist (F-R10) | 4 |
| `flows/selektoren.mjs`, `flows/freigaben.mjs` | Die Kennungen der Fluesse und die Freigaben fuer gesperrte Knoepfe im Sweep | 2, 3, 4 |
| `tabelle/`, `TABELLE.md`, `ABWEICHUNGEN.md` | Routen, Blaetter, Tippwege und Kennungen aus den Quellen der Shell gelesen. Abweichungen von der Regel `m-<screen>-<element>` | 2 |
| `trocken/`, `driver/vorschau.mjs` | Trockenlauf ohne Geraet: statische Pruefung und Lauf gegen die Vite-Vorschau der Shell | |
| `lib/shell.mjs`, `lib/haken.mjs`, `lib/nativ.mjs` | Aufbau der Shell (Seitenstapel, Blaetter, Rueckfragen), Testhaken `window.__LU_TEST__`, native Fenster (Dateiauswahl) | alle |
| `kosten.mjs` | Kostenregel: `ALLOW_PAID=1`, je Lauf 1 Bild, 1 STT, 1 TTS, billigstes Modell | 3, 4 |
| `lib/sperre.mjs` | Sperrliste fuer kostenpflichtige und zerstoerende Knoepfe | 2 |
| `report.mjs` | `BERICHT.md` mit einer Zeile je Abnahmepunkt | alle |
| `selbsttest.mjs`, `fixture/` | Beweist am Emulator bzw. im Simulator, dass der Rahmen selbst funktioniert | |
| `fixture/ios-testbett/` | Wegwerf-App (Tauri 2) fuer den Selbsttest auf iOS, mit Plugin fuer Speicherwarnung, Lebenslauf und Zurueck-Geste | |

## Trockenlauf ohne Geraet

Bevor ein Emulator oder Simulator laeuft, prueft der Rahmen sich selbst gegen die Shell. Das kostet keinen Akku und kein Geld.

```
npm run tabelle            # liest Routen, Blaetter und Kennungen aus ../../shell/src/mobile, schreibt TABELLE.md und ABWEICHUNGEN.md
npm run aufnahme           # oeffnet jede Seite und jedes Blatt in der Vorschau, schreibt trocken/schnappschuesse/
npm run trocken:statisch   # Sekunden: jede Kennung der Fluesse gegen Tabelle und Schnappschuesse
npm run trocken:rahmen     # eine Minute: Schrittrahmen und Sweep an der Testseite fixture/index.html
npm run trocken            # alles: statisch, Rahmenprobe, dann Altersabfrage, Kundenfluss, Fehlerfaelle und Sweep gegen die Vorschau
```

Aus einem anderen Worktree als `shell` (zum Beispiel einem Zweig der Zusammenfuehrung) brauchen Tabelle UND Aufnahme beide Angaben, sonst liest der Scan `../../shell`, auch wenn die Vorschau schon den eigenen Worktree zeigt, und der Stempel der Schnappschuesse nennt den falschen Stand:

```
QUELLEN=<ordner> VORSCHAU_WT=<pfad zum worktree> npm run tabelle
QUELLEN=<ordner> VORSCHAU_WT=<pfad zum worktree> npm run aufnahme
```

`<ordner>` ist der Name des Worktree-Ordners neben `shell`. Die Vorschau startet den Entwicklungsserver mit `VITE_LU_BUILD_TARGET=mobile` (`trocken/server.mjs`); ohne die Variable zeigt er seit der Zusammenfuehrung mit 3.0.6 den Desktop.

Die drei Teile:

1. **Statisch.** Jede Kennung in `flows/selektoren.mjs` muss in den Quellen der Shell oder in einem Schnappschuss stehen. Jeder Aufruf `S.x.y` in den Fluessen muss es geben. Kein `f.tap` darf auf eine gesperrte Kennung zeigen. Jede Seite hat einen Tippweg oder einen Grund, warum nicht. Ein Tippfehler in einer Kennung faellt hier auf.
2. **Rahmenprobe.** Die Testseite hat absichtliche Fehler (toter Knopf, Knopf mit Ausnahme, Bezahlknopf). Der Sweep muss jeden richtig einordnen, der Schrittrahmen muss jeden Ausgang mit dem richtigen Status melden, und der Server der Testseite zaehlt, dass kein gesperrter Knopf ausgeloest wurde. Das ist der Teil des Selbsttests, der kein Geraet braucht.
3. **Vorschau.** Die echten Fluesse und der Sweep gegen die Shell im Browser.

- Die Vorschau ist die Shell im Vite-Entwicklungsserver (`/?mobile=1&dev=1`), gesteuert in einem kopflosen Chromium mit echten Touch-Ereignissen (`driver/vorschau.mjs`, `PLATFORM=vorschau`). Der Server laeuft mit eigener Konfiguration und eigenem Cache unter `out/trocken/` und schreibt nichts in den Worktree der Shell.
- Braucht `npm ci` im Worktree der Shell und ein Chromium aus dem Playwright-Cache (`CHROME_BIN` nennt ein anderes).
- Jede Adresse ausser der Vorschau ist gesperrt. Es gibt keinen Cloud-Aufruf, der Kostenzaehler muss auf 0 bleiben, sonst ist der Trockenlauf rot.
- Der Testhaken ist in der Vorschau an (`VITE_LU_ABNAHME=1`), `OHNE_HAKEN=1` laesst ihn weg.
- Was die native Seite braucht (Engine, Download, Dateiauswahl), endet in der Vorschau als "nicht pruefbar". Was eine Anmeldung braucht, auch.
- Der Trockenlauf belegt nichts ueber die App auf dem Geraet. Er zeigt, dass Kennungen, Tippwege und Ablauf des Rahmens zu diesem Stand der Shell passen. Der Bericht schreibt fuer einen Lauf in der Vorschau nie "belegt".

Nach jeder Aenderung an der Shell: `npm run tabelle && npm run aufnahme && npm run trocken`.

## Geraetegrenze und Aufraeumen

Auf der Maschine laufen die Geraete mehrerer Agenten. Es gilt (`mobile-docs/regeln/AGENTEN-REGELN.md`):

- Hoechstens 2 Emulatoren oder Simulatoren gleichzeitig. Jeder Start laeuft ueber `node geraet.mjs android-start <avd>` bzw. `ios-start <name>`. Das Werkzeug zaehlt vorher `adb devices`, Emulatorprozesse und gebootete Simulatoren und bricht bei 2 mit einer klaren Meldung ab (`lib/geraete.mjs`). `node geraet.mjs zaehlen` zeigt den Stand.
- `LU_Phone`, `LU_Fresh`, `LU_Bauer` und `Fernblick` gehoeren David. Sie zaehlen mit, werden aber nie gestartet, gestoppt oder geloescht, und die Treiber lehnen sie als Testgeraet ab.
- Gestoppt und geloescht wird nur, was `geraet.mjs` in diesem Arbeitsverzeichnis selbst gestartet hat, ueber die gemerkte Prozessnummer (`lib/prozess.mjs`). Kein `pkill`, kein `killall`: Ein Namensmuster trifft auch die Laeufe anderer.
- `node selbsttest.mjs` ohne genanntes Geraet laeuft nur Teil 0 (Geraetegrenze, Aufraeumen, Erholung des Sweeps, mit gespielten Kommandoausgaben). `node trocken/rahmen.mjs` prueft dazu den echten Sweep mit gespielten Stoerungen im kopflosen Browser.

Die Schrittliste fuer die Nachabnahme der Geraetebefunde steht in `NACHABNAHME.md`.

## Abnahme starten: Android

Voraussetzungen: Android SDK mit `adb` (der Treiber sucht in `ADB`, `ANDROID_HOME`, `ANDROID_SDK_ROOT` und `~/Library/Android/sdk`), ein laufender Emulator oder ein angeschlossenes Geraet, die App installiert und gestartet, WebView-Debugging an (siehe `driver/INTERFACE.md`, Abschnitt Inspizierbarkeit).

Alle Ergebnisse eines Laufs liegen in `out/<plattform>/<zeitstempel>/` (nicht im Repo, siehe `.gitignore`).
Mit `LAUF_DIR` schreiben mehrere Werkzeuge in denselben Lauf und teilen sich Bericht und Kostenzaehler.

```
export PLATFORM=android
node geraet.mjs android-start <eigenes-avd>   # zaehlt vorher, bricht bei 2 laufenden Geraeten ab
export ANDROID_AVD=<eigenes-avd>       # oder ANDROID_SERIAL. Nie LU_Phone, LU_Fresh, LU_Bauer: Die gehoeren David
export APP_PKG=com.purpledoubled.locallyuncensored
export MT_CONFIG=$PWD/config.mjs       # Routen, Sperrliste, billigste Modelle
export LAUF_DIR=$PWD/out/android/$(date +%F_%H-%M-%S)

node inventory.mjs chat                # Inventar des offenen Screens
node sweep.mjs                         # alle Routen aus der Konfiguration
node checks/copy.mjs
node checks/layout.mjs                 # stellt Systemeinstellungen um und zurueck
node checks/persistenz.mjs             # UPDATE_PAKET=<neue.apk> fuer die Variante update
FRISCH=1 STORE_PRESET=play node flows/kundenfluss.mjs   # FRISCH=1 loescht die App-Daten
node flows/fehlerfaelle.mjs
node flows/alter.mjs
node messlatte.mjs                     # einmal je Stand, schreibt out/messlatte.json
node report.mjs $LAUF_DIR              # schreibt BERICHT.md
```

Das Ziel verlangt je Plattform ein kleines und ein grosses Geraet: denselben Ablauf mit einem zweiten `ANDROID_AVD` und einem eigenen `LAUF_DIR` wiederholen.

## Abnahme starten: iOS

Alles hier laeuft im Simulator. Kein Developer-Konto, keine Apple-ID, kein iPhone. Was der Simulator nicht zeigt, steht in `MOBILE-ZIEL.md`, Abschnitt 5.

### Einmalig einrichten

```
xcode-select -p                                   # Xcode mit iOS-Simulator muss da sein
brew install ios-webkit-debug-proxy               # Bruecke zum WebKit Remote Inspector
ios/appium.sh einrichten                          # appium und xcuitest-Treiber nach .werkzeug/appium, rund 2 Minuten

# Zwei eigene Simulatoren, ein kleiner und ein grosser:
RT=com.apple.CoreSimulator.SimRuntime.iOS-26-5
xcrun simctl create LU-Harness-klein com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation $RT
xcrun simctl create LU-Harness-gross com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max $RT
```

`ios/appium.sh einrichten` macht nichts anderes als:

```
mkdir -p .werkzeug/appium && cd .werkzeug/appium
export APPIUM_HOME=$PWD/.appium
npm init -y && npm install appium
npx appium driver install xcuitest
```

Der Ordner `.werkzeug/` steht in `.gitignore`. Er haelt `node_modules`, den Treiber und den gebauten WebDriverAgent (`.werkzeug/wda-derived`), zusammen rund 600 MB.

### Ein Lauf

```
node geraet.mjs ios-start LU-Harness-klein   # zaehlt vorher, bricht bei 2 laufenden Geraeten ab
xcrun simctl install LU-Harness-klein <pfad zur .app fuer den Simulator>
ios/appium.sh start                    # der Treiber startet den Server auch selbst, wenn er fehlt

export PLATFORM=ios
export IOS_SIM=LU-Harness-klein        # oder IOS_UDID=<udid>
export APP_PKG=<bundle-id>              # Bundle-ID, wie sie im Paket steht (CFBundleIdentifier)
export MT_CONFIG=$PWD/config.mjs
export LAUF_DIR=$PWD/out/ios/$(date +%F_%H-%M-%S)

node inventory.mjs chat
node sweep.mjs
node checks/copy.mjs
node checks/layout.mjs
node checks/persistenz.mjs             # UPDATE_PAKET=<neue.app> fuer die Variante update
node flows/kundenfluss.mjs
node flows/fehlerfaelle.mjs
node report.mjs $LAUF_DIR

ios/appium.sh stop
node geraet.mjs ios-stop LU-Harness-klein   # Simulatoren nie laufen lassen, sie kosten Akku
```

Danach dasselbe mit `IOS_SIM=LU-Harness-gross`.

Die App muss fuer den Simulator gebaut sein und ihre WebView muss inspizierbar sein: Debug-Bau (`scripts/mobile/ios/bauen.sh debug abnahme`), oder Release-Bau mit dem Pruef-Feature, das `tauri/devtools` einschaltet (`VITE_LU_STORE_PRESET=open scripts/mobile/ios/bauen.sh release abnahme`). Ein Release ohne `VITE_LU_STORE_PRESET` bricht ab.

### Umgebungsvariablen

| Variable | Wozu | Standard |
|---|---|---|
| `PLATFORM` | `android`, `ios` oder `vorschau` (Trockenlauf im Browser) | `android` |
| `VORSCHAU_WT`, `VORSCHAU_PORT`, `VORSCHAU_URL`, `VORSCHAU_GROESSE`, `OHNE_HAKEN`, `CHROME_BIN` | Trockenlauf: Worktree der Shell, Port, fremder Server, Fenstergroesse, ohne Testhaken, anderes Chromium | `../../shell`, `5411`, keiner, `390x844`, mit Haken, Playwright-Cache |
| `ROUTEN`, `STRANG` | Sweep: nur diese Seiten (`/settings,blatt:model`) oder nur ein Strang | alle |
| `FRISCH`, `STORE_PRESET`, `AB`, `BIS`, `NUR`, `ABMELDEN`, `SITZUNG_ABLAUFEN`, `FEHLER_MODELL` | Fluesse, siehe `flows/README.md` | aus |
| `APP_PKG` | Paketname bzw. Bundle-ID | aus `config.mjs` |
| `MT_CONFIG` | eigene Konfiguration | `config.mjs` |
| `LAUF_DIR` | gemeinsamer Lauf fuer mehrere Werkzeuge | neuer Ordner je Aufruf |
| `ALLOW_PAID` | `1` erlaubt bezahlte Schritte in den Flows | aus |
| `ANDROID_AVD`, `ANDROID_SERIAL`, `ADB` | Android: welches Geraet, welches adb | keiner: ohne `ANDROID_SERIAL` oder `ANDROID_AVD` bricht jedes Skript ab |
| `IOS_SIM`, `IOS_UDID` | iOS: welcher Simulator (Name oder UDID) | keiner: ohne `IOS_UDID` oder `IOS_SIM` bricht jedes Skript ab |
| `APPIUM_URL` | iOS: fremder Appium-Server. Dann startet der Treiber keinen eigenen | `http://127.0.0.1:4741` |
| `APPIUM_PORT`, `APPIUM_ORDNER` | iOS: Port und Ordner fuer `ios/appium.sh` | `4741`, `.werkzeug/appium` |
| `IOS_WEBKIT_DEBUG_PROXY` | iOS: Pfad zum Proxy | Homebrew |
| `IOS_LOWMEM_JS` | iOS: JS-Ausdruck, der in der App die Speicherwarnung ausloest | Testhaken `speicherWarnung` |
| `UPDATE_PAKET`, `VARIANTEN`, `STROM_URL` | Persistenzpruefung: Paket der neuen Version, Auswahl, Adresse eines Streams | alle Varianten |
| `RELEASE_APK`, `RELEASE_IOS_APP` | Release-Pruefung: wo die Pakete liegen | Ausgabeordner von Tauri |
| `PROJEKT`, `NUR`, `MIT_E2E` | Messlatte: Projektwurzel, Auswahl der Schritte, Playwright mitlaufen lassen | Repo, alle, aus |
| `FIXTURE_PORT`, `IOS_TESTBETT_APP`, `IOS_TESTBETT_PKG`, `NUR` | Selbsttest | `8765`, keines, `de.lu.harness.testbett`, beide Teile |

### Was auf iOS anders ist

Die ganze Tabelle steht in `driver/INTERFACE.md`, Abschnitt "Unterschiede Android und iOS". Das Wichtigste:

- `network(false)` ist ein Ersatz. Der Simulator hat keinen Netzschalter, der Treiber laesst die Anfragen der WebView scheitern. Die Rust-Seite merkt davon nichts, dafuer braucht die App den Testhaken `netz`.
- `lowMemory` braucht den Testhaken `speicherWarnung` in der App.
- `back()` ist die Wischgeste vom linken Rand und wirkt nur, wenn die App sie anbietet.
- Grosse Schrift wirkt nur auf Schriften, die an `-apple-system-body` haengen.
- Was iOS nicht kann, wirft einen Fehler mit `code: 'nicht-unterstuetzt'` und einer Begruendung.

## Punkte 1, 7 und 8

Diese drei Punkte haengen nicht am Geraet. Der Bericht liest sie bei jedem Aufruf frisch:

```
node checks/vollstaendigkeit.mjs       # Punkt 1: Inventur, jede Zeile mit Urteil und Begruendung
node messlatte.mjs                     # Punkt 7: tsc, vitest, vite build, cargo check. Braucht npm ci im Projekt
node checks/release.mjs                # Punkt 8: Pakete und Repo
```

- Punkt 8 verlangt neben jedem Paket den Baubeleg `<paket>.bau.json`, den die Bauskripte unter `scripts/mobile/` schreiben. Ein Release nennt sein Preset: fuer die Abnahme `VITE_LU_STORE_PRESET=open scripts/mobile/android-bauen.sh release abnahme` und `VITE_LU_STORE_PRESET=open scripts/mobile/ios/bauen.sh release abnahme`. Ein Paket mit `play` oder `appstore` braucht dazu den Meldedienst und darf den Testhaken nicht tragen. Ein Paket ohne Beleg zaehlt als Bau ohne genanntes Preset.
- Punkt 1 prueft die Form, nicht ob ein Urteil richtig ist.
- Punkt 7 gilt als belegt, wenn alle vier Schritte und die Playwright-Suiten (`MIT_E2E=1`) gruen sind und der Stand zum aktuellen Commit gehoert. Ob jeder behobene Fehler einen Waechtertest hat, misst das Skript nicht.
- Punkt 8 braucht die fertigen Pakete. `apksigner` braucht Java, das Skript sucht `JAVA_HOME` und die Homebrew-Installation.

## Konfiguration

`config.mjs` (oder eine eigene Datei ueber `MT_CONFIG`):

- `routen`: Sie entstehen aus `tabelle/tabelle.json` und `tabelle/wege.mjs`: jede Seite und jedes Blatt der Shell (`blatt:<id>`), je mit `oeffne(d)`. `oeffne` stellt die Seite von einem beliebigen Zustand aus her, der Sweep ruft es vor JEDEM Tipp. Der Weg dorthin: erst der Testhaken (`go`, `openSheet`), sonst der Tippweg aus `wege.mjs`, in der Vorschau zuletzt die Entwicklerseite. Ausnahme: Eine Route mit Parameter (`/chat/:id`, `/models/:id`) nimmt zuerst den Tippweg, weil der Haken mit einem Beispielwert nur die Seite "nicht gefunden" zeigt. Ohne Tippweg steht im Bericht "testhaken (Beispielwert ...)". Seiten ohne Haken und ohne Tippweg (sie brauchen einen Chat, ein Dokument, eine Kopplung) meldet der Sweep als "nicht herstellbar", mit dem Grund aus `OHNE_WEG`.
- `freigaben`: aus `flows/freigaben.mjs`. Ein gesperrter Knopf, den der Sweep trotzdem tippen darf, mit Begruendung und Grenze (`bis-rueckfrage`: tippen, die Rueckfrage sehen, abbrechen).
- `kleinstesModell`, `zweitesModell`, `storePreset`: fuer die Fluesse.
- `sperrliste`: Standard aus `lib/sperre.mjs`.
- `billigsteModelle`: je Kostenart genau ein Modell oder eine Marke. `@guenstigste-zeile` heisst: die Zeile, die die App selbst als guenstigste auszeichnet (`m-chat-model-cloud-cheapest`). `@einziger-dienst` heisst: Die App hat dafuer nur einen Dienst. Bild ist fest `flux-schnell`. Leer heisst: kein bezahlter Aufruf moeglich.

## Wie die Urteile zu lesen sind

- Sweep "wirkung" heisst: Nach dem Tipp hat sich etwas geaendert (DOM, Text, Route, Dialog, Feldwert, Fokus eines Textfelds, Tastatur, Vordergrundfenster). Ob es das Richtige war, beurteilt der Persona-Agent am Screenshot. Aendert sich die Seite von selbst (Uhr, Animation), zaehlen diese Merkmale nicht mit und das Urteil faellt vorsichtig aus.
- Der Sweep stellt zurueck, was er verstellt: Ein Schalter, ein Segment oder ein Filter (`aria-pressed`, `aria-checked`, `aria-selected`), der nach dem Tipp anders steht als davor, wird gleich nach dem Tipp wieder in den Ausgangszustand getippt, bei einem Element in einem Blatt, bevor das Blatt geschlossen wird. Ein Zaehler oder Regler des Kits (Minus, Feld, Plus, etwa "Threads") bekommt seinen alten Wert zurueck. Was sich nicht zurueckstellen liess, steht im Bericht unter "verstellt". Schmuck ohne Aufgabe (`data-m-decor`, der Griff am Blatt) wird nicht getippt. Wartet nach einem Tipp ein "Discard changes?", bestaetigt `zurWurzel` das Verwerfen, damit die naechste Route sauber beginnt.
- Sweep "uebersprungen" ist kein Urteil. Gesperrte, deaktivierte und unsichtbare Elemente sind noch nicht geprueft und halten Punkt 2 auf "in Arbeit".
- Inventar: Der Name kommt aus dem Accessibility-Baum der WebView, wo der Treiber das kann (Lektion aus dem alten Sweep: `title` lesen reicht nicht). Ein Element ohne Rolle hat dort keinen Namen und wird als "ohne Rolle" gemeldet.
- Touch-Ziele: Gemessen wird das Element, bei Kaestchen und Radios zusammen mit ihrem `label`. Links im Fliesstext sind markiert (`imFliesstext`), zaehlen aber mit.
- Layout "Variante ohne Wirkung": Die Systemeinstellung kam in der Seite nicht an, zum Beispiel wenn die App das Querformat sperrt oder die WebView die Schriftgroesse des Systems nicht uebernimmt. Das ist ein Befund, kein Messfehler.
- Der Bericht schreibt "belegt" nur, wenn die Zahlen es hergeben, und nie fuer einen Selbsttest.

## Selbsttest

```
node selbsttest.mjs                                    # nur Teil 0, kein Geraet noetig
ANDROID_AVD=<eigenes-avd> node selbsttest.mjs          # Teil 0, dann Android
```

Ohne genanntes Geraet (`ANDROID_AVD`, `ANDROID_SERIAL`, `IOS_SIM`, `IOS_UDID`) laeuft nur Teil 0 und der Lauf endet danach. Frueher nahm der Selbsttest ohne Angabe `LU_Phone`. Das Geraet gehoert David und ist kein Testgeraet mehr. Mit Geraet laeuft er etwa vier Minuten.

- Teil 0: ohne Geraet, mit gespielten Ausgaben von `adb`, `simctl` und `ps` und gespielten Treibern (`lib/selbsttest-ohne-geraet.mjs`): Geraetegrenze, Schutz der Geraete von David, Beenden nur ueber die Prozessnummer, Erholung des Sweeps, Warten auf den Testhaken, Berechtigungsfrage, Store-Woerter. Dazu eine Durchsicht der Quellen: kein `pkill`, kein Geraetestart an der Grenze vorbei.
- Teil 1: Testseite `fixture/index.html` in Chrome auf dem Geraet. Die Seite hat absichtliche Fehler (toter Knopf, Knopf mit Ausnahme, 404, Knopf ohne Namen, zu kleine Ziele, zu breite Box, abgeschnittener Text, Desktop-Texte, Gedankenstriche, Bezahlknopf). Jeder muss gefunden werden, und die Bezahlknoepfe duerfen nicht ausgeloest werden (der Server zaehlt mit).
- Teil 2: die installierte Tauri-App, nur lesend.
- Teil 3: die Werkzeuge fuer die Punkte 1, 7 und 8, ohne Geraet.

Der Selbsttest installiert und loescht auf Android nichts und stellt Schrift, Dunkelmodus, Drehung und Netz am Ende zurueck. `clearData` und `installApk` fuehrt er dort nicht aus.

```
fixture/ios-testbett/bauen.sh /tmp/lu-ios-testbett     # baut die Wegwerf-App, erster Bau rund 3 Minuten, mehrere GB
node geraet.mjs ios-start LU-Harness-klein
PLATFORM=ios IOS_SIM=LU-Harness-klein \
  IOS_TESTBETT_APP=/tmp/lu-ios-testbett/src-tauri/gen/apple/build/arm64-sim/testbett.app \
  node selbsttest.mjs                                  # iOS, etwa fuenf Minuten
```

Auf iOS laeuft dieselbe Testseite in der WKWebView des Testbetts, mit denselben Pruefungen. Teil 2 ist dort das Testbett selbst. Weil es eine Wegwerf-App auf einem eigenen Simulator ist, laufen dort zusaetzlich Speicherwarnung, Hintergrund und zurueck, Deeplink, Zurueck-Geste, `clearData`, `installApk` und die ganze Persistenzpruefung samt Neustart des Simulators und Update von 0.1.0 auf 0.1.1.
Der Bau des Testbetts braucht `brew install cocoapods xcodegen` und Rust mit dem Ziel `aarch64-apple-ios-sim`. Den Bauordner danach loeschen.

Laufen Android und iOS gleichzeitig auf einem Rechner, braucht einer von beiden einen eigenen `FIXTURE_PORT`.

## Grenzen

- Punkt 6: Die Persistenzpruefung der Standardkonfiguration stellt als Einstellung einen echten Schalter der App um (Settings, Privacy, `m-settings-privacy-counter`): hingehen, tippen, nach dem Unglueck wieder hingehen und ablesen, danach zurueckstellen (`schalterNaht` in `lib/persistenz-naht.mjs`, eingetragen in `config.mjs` unter `persistenz.naht`). Einen eigenen Schluessel in localStorage sichert die App nicht, deshalb meldete die alte Form seit der sofortigen Sicherung der Einstellungen "verloren". Der Chat wird weiter direkt in IndexedDB geschrieben: Das belegt den Speicher der WebView, nicht dass die App ihre Chats dort ablegt, und ergibt im Bericht nie "belegt". Fuer den Beleg braucht es eine Naht, die auch den Chat ueber die Oberflaeche schreibt und liest, samt den Funktionen fuer laufende Downloads. Die Naht `roh` (alles direkt) bleibt fuer Seiten ohne die App (Testbett des Selbsttests).
- Neustart des Geraets: `reboot` gibt es auf iOS und seit Runde 9 auf Android (`adb reboot`, wartet auf `sys.boot_completed` und den Paketdienst). Auf Android ist die Variante `neustart` damit nicht mehr offen, am Geraet gelaufen ist sie noch nicht.
- "Kleines und grosses Geraet" (Punkt 5) heisst zwei Laeufe auf zwei Geraeten.
- Safe Area: Gemessen wird `env(safe-area-inset-*)`. Meldet die WebView dort 0, findet die Pruefung nichts, auch wenn Inhalt unter der Statusleiste liegt. Die Screenshots zeigen es.
- Speicher voll wird nicht echt hergestellt, sondern ueber einen Testhaken (`TESTIDS.md`).
- iOS heisst hier immer Simulator. Niemand meldet etwas als am iPhone geprueft, das nur im Simulator lief.
- Der Android-Selbsttest ist nach dem Umbau auf zwei Plattformen (08.10.2026) nicht erneut gelaufen, weil der Emulator belegt war. Vor der naechsten Abnahme einmal laufen lassen.

## Zeitgrenze ohne `timeout`

macOS hat kein Programm `timeout`. Wer einen Lauf begrenzen will, nimmt den Helfer des Rahmens:

    node mobile-tests/lib/frist.mjs 600 -- node selbsttest.mjs

Der Befehl bekommt nach der Zeit SIGTERM, 5 s spaeter SIGKILL, und der Helfer endet mit 124. Als Funktion: `mitFrist(sekunden, befehl, argumente)` aus `lib/frist.mjs`.

## Was `tap` trifft

Seit Runde 16 gilt fuer jeden Tipp: Liegt am Trefferpunkt etwas anderes als das Ziel (das Feld unter einer Fusszeile), gibt es keinen Erfolg, der Tipp wirft (`lib/tipp.mjs`, `tippVerbot`; `auchVerdeckt: true` nimmt es bewusst aus). Ein Ziel ausserhalb des Bildes oder unter einer festen Leiste holt der Treiber vorher mit einer echten Wischgeste herein (`findeMitRollen`). Der Sweep zaehlt echte Seite und Ersatzseite getrennt (`sweep-seiten.json`, Zeile im Bericht), legt vorher ueber den Testhaken Testdaten ab (`testData`) und tippt "Agree" im Blatt `ai-consent` nur als bewussten Schritt mit Ruecknahme (`flows/ruecknahmen.mjs`).

`tap('kennung')` nimmt den Treffer, der zu sehen und nicht verdeckt ist, auch wenn dieselbe Kennung weiter vorn im Dokument auf einer Seite darunter steht (`ersatzFrei` in der Antwort). Liegt der Punkt unter der Tastatur, tippt `tap` nicht und wirft "liegt unter der Tastatur". Auf iOS schliesst der Treiber die Tastatur vorher selbst.
