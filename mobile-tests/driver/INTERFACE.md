# Treiber-Vertrag

Jeder Treiber (`android.mjs`, `ios.mjs`, fuer den Trockenlauf `vorschau.mjs`) bietet dieselben Funktionsnamen mit derselben Bedeutung.
Wo iOS etwas anders loest oder gar nicht kann, steht es im Abschnitt "Unterschiede Android und iOS".
Die Werkzeuge (`inventory.mjs`, `sweep.mjs`, `checks/*`, `flows/*`) kennen nur diesen Vertrag und keine Plattform.

Auswahl: `PLATFORM=android|ios|vorschau`, dann `const d = await ladeTreiber()` aus `driver/index.mjs`.
`ladeTreiber` prueft, dass alle Pflichtfunktionen da sind, und bricht sonst mit der Liste der fehlenden ab.

Ein Treibermodul exportiert `createDriver()`, das ein Objekt mit den Funktionen unten liefert.
Beide Module exportieren die Funktionen zusaetzlich einzeln (`import { connect, tap } from './driver/android.mjs'`), gebunden an eine Standardinstanz.

Die Spalte "Hinweis fuer iOS" unten ist die Vorgabe von vor dem Bau des iOS-Treibers. Was daraus wirklich wurde, steht im Abschnitt "Unterschiede Android und iOS".

## Pflicht

| Funktion | Bedeutung | Android | Hinweis fuer iOS |
|---|---|---|---|
| `connect({pkg, urlFilter, socket, start, timeoutMs})` | Verbindung zur WebView der laufenden App. `pkg` ist Paketname bzw. Bundle-ID. Gibt `{pkg, pid, url, title}` zurueck. Ab hier laufen die Mitschnitte. | adb forward auf `webview_devtools_remote_<pid>`, `/json`, WebSocket | WebKit Remote Inspector oder Appium (`mobile: getContexts`) |
| `disconnect()` | Verbindung und Weiterleitung abbauen | | |
| `evalJs(src)` | JavaScript in der Seite auswerten, Promises abwarten, Wert als JSON zurueck. Wirft bei Ausnahme in der Seite. | `Runtime.evaluate` | `Runtime.evaluate` bzw. `executeScript` |
| `evalFn(fn, ...args)` | Eine echte Funktion in der Seite ausfuehren. Erster Parameter ist die Seitenbibliothek `L` aus `lib/seite.mjs`. Baut auf `evalJs` auf: `return this.evalJs(seitenAufruf(fn, ...args))`. | | genauso |
| `tap(ziel, {dauerMs, auchVerdeckt})` | Echter Touch. `ziel` ist CSS-Selektor, sichtbarer Text bzw. Name, oder `{x, y}` in CSS-px. Kein `el.click()`. Scrollt das Ziel vorher in die Mitte. Gibt `{x, y, name, verdeckt, verdecktVon}` zurueck, wirft wenn nichts gefunden. | `Input.dispatchTouchEvent` | Appium `mobile: tap` in Geraetepunkten, Umrechnung ueber die Lage der WebView Seit Runde 16: Liegt am Trefferpunkt etwas anderes (eine Fusszeile, eine Leiste), wirft der Tipp, auch ohne `nurWennFrei`; `auchVerdeckt: true` nimmt das bewusst aus. Ein Ziel ausserhalb des Bildes oder unter einer festen Leiste wird vorher mit einer Wischgeste hereingeholt (`lib/tipp.mjs`). |
| `type(text)` | Text in das fokussierte Feld, mit `beforeinput` und `input` | `Input.insertText` | Appium `sendKeys` bzw. `mobile: keys` |
| `key(name)` | Taste: Enter, Tab, Backspace, Delete, Escape, Space, Pfeile, Home, End, oder ein Zeichen | `Input.dispatchKeyEvent` | |
| `back()` | Zurueck wie der Mensch es macht | `input keyevent 4` | Wischgeste vom linken Rand |
| `screenshot(pfad, {quelle})` | PNG schreiben. `quelle: 'geraet'` (Standard) mit Statusleiste, Tastatur, nativen Dialogen. `'webview'` nur die Seite. | `screencap` bzw. `Page.captureScreenshot` | `xcrun simctl io booted screenshot` |
| `consoleLog(ab)` | Mitschnitt der Konsole seit `connect`: `[{zeit, typ, text}]`. `typ` ist `log`, `error`, `exception`, `log.error` und so weiter. `ab` ist ein Index. | | |
| `netzFehler(ab)` | Mitschnitt: `[{zeit, art: 'status'/'fehlgeschlagen', status, fehler, abgebrochen, url, methode}]` | | |
| `marke()` | `{konsole, netz}`: aktuelle Laengen der Mitschnitte, fuer Vorher und Nachher | | |
| `waitFor(bedingungJs, timeoutMs)` | Pollt den JS-Ausdruck, gibt den Wert zurueck, wirft nach Ablauf | | |
| `rotate('portrait'/'landscape')` | Geraet drehen | `settings put system user_rotation` | `simctl` bzw. Appium `orientation` |
| `setFontScale(x)` | Schriftgroesse des Systems (1.0, 1.3, 2.0) | `settings put system font_scale` | `simctl ui booted content_size <stufe>` |
| `setDark(bool)` | Dunkelmodus des Systems | `cmd uimode night yes/no` | `simctl ui booted appearance dark/light` |
| `network(an)` | Netz an oder aus (`true`, `false`, `'on'`, `'off'`). Die Verbindung zum Treiber muss dabei stehen bleiben. | `svc wifi`, `svc data` | Network Link Conditioner oder Paketfilter auf dem Mac |
| `kill()` | Harter Abschuss | `am force-stop` | `simctl terminate` |
| `launch({verbinden})` | App starten bzw. nach vorn holen und neu verbinden | `am start` mit Launcher-Flags | `simctl launch` |
| `clearData()` | Alle App-Daten loeschen (frische Installation) | `pm clear` | App loeschen und neu installieren |
| `installApk(pfad)` | Paket installieren (iOS: `.app` bzw. `.ipa`, der Name bleibt gleich) | `adb install -r` | `simctl install` |
| `pushFile(lokal, ziel)` | Datei auf das Geraet legen | `adb push` | `simctl addmedia` bzw. Dateien-App |
| `lowMemory(stufe)` | Speicherdruck melden | `am send-trim-memory` | `simctl spawn booted notifyutil` bzw. Menue "Simulate Memory Warning" |
| `sleep(ms)` | Warten. Laeuft ueber das Geraet, weil reines Warten im Aufrufer in manchen Umgebungen gesperrt ist. | `adb shell sleep` | `simctl spawn booted sleep` |
| `snapshotSettings()` | Alle Einstellungen lesen, die der Treiber veraendern kann | | |
| `restoreSettings(snap)` | Auf den Schnappschuss zurueckstellen und den neuen Stand zurueckgeben. Muss denselben Wert liefern wie `snapshotSettings()` davor. | | |
| `viewport()` | `{w, h, dpr, vvH, vvW, vvTop, skala, quer, url}` | | |
| `info()` | `{plattform, pkg, pid, ...}` | | |

Eigenschaft `plattform`: `'android'` oder `'ios'`.

## Optional

Die Werkzeuge fragen mit `typeof d.x === 'function'` nach und kommen ohne aus, dann fehlt nur der jeweilige Befund.

| Funktion | Wozu |
|---|---|
| `axInfo(selector)` | `{name, rolle, ignoriert}` aus dem Accessibility-Baum. Das Inventar nimmt diesen Namen statt des DOM-Namens. |
| `foreground()` | `{fenster, pkg, istApp}`. Der Sweep erkennt daran native Fenster und ob die App noch vorn ist. |
| `keyboard()` | `{sichtbar, obenPx}`. Fuer "Feld unter der Tastatur". |
| `webviewBounds()` | Lage der WebView in Geraetepixeln. |
| `backgroundKill()` | App in den Hintergrund und vom System beenden lassen. Fuer Fehlerfall 5. |
| `home()`, `swipe(von, nach)`, `navigate(url)`, `logcat()`, `geraet()` | Hilfen |
| `installApp(pfad)` | Derselbe Aufruf wie `installApk`, unter einem Namen, der zu beiden Plattformen passt. |
| `openUrl(url)` | Deeplink oeffnen. Gibt `{dialog}` zurueck: ob das System nachgefragt hat und der Treiber bestaetigt hat. |
| `background()`, `activate()` | App in den Hintergrund und wieder nach vorn, ohne neu zu verbinden. `foreground()` ist die Abfrage, nicht die Handlung. |
| `hideKeyboard()` | Tastatur schliessen. Die Layoutpruefung nimmt das statt `back()`, wenn es da ist. |
| `dismissNative()` | Natives Fenster ueber der WebView schliessen. Der Sweep nimmt das statt `back()`, wenn es da ist. |
| `toScreen({x, y})` | Punkt aus `getBoundingClientRect` in Bildschirmpunkte umrechnen. Die Layoutpruefung misst damit, ob ein Feld unter der Tastatur liegt. Nur iOS. |
| `reboot()` | Geraet neu starten. Prueft vorher die Geraetegrenze der Maschine (das eigene Geraet zaehlt nicht mit). Die Persistenzpruefung braucht es fuer die Variante `neustart`. iOS: Simulator herunterfahren und booten. Android: `adb reboot`, dann warten, bis `sys.boot_completed` 1 ist und der Paketdienst antwortet (seit Runde 9, am Geraet noch nicht gelaufen). Die App startet danach nicht von selbst. |
| `berechtigung(dienst, aktion)` | Berechtigung der App vorab setzen (`mikrofon`, `kamera`, `fotos`, auf Android auch `benachrichtigungen`; `grant`, `revoke`, auf iOS auch `reset` und `alle`). Damit kommt im Sweep kein Systemdialog. Android: `pm grant`, iOS: `simctl privacy`. |
| `raeumeSystemDialog({art})`, `systemDialoge(ab)` | Nur iOS. Beantwortet einen offenen Systemdialog nach Vorgabe (`annehmen`, `ablehnen`, `melden`, Standard aus `IOS_SYSTEMDIALOG`) und fuehrt Buch darueber. `tap` ruft es selbst, wenn ein Tipp nicht in der Seite ankommt. |

## Unterschiede Android und iOS

Stand: `ios.mjs` ist im Simulator iOS 26.5 gebaut und gemessen (iPhone SE 3 und iPhone 17 Pro Max). Ein echtes iPhone bedient der Treiber nicht.

| Funktion | Android | iOS | Grenze auf iOS |
|---|---|---|---|
| Weg in die Seite | Chrome DevTools Protocol ueber adb | WebKit Remote Inspector ueber `ios_webkit_debug_proxy` | Eigenes Protokoll: kein `Page.navigate`, kein `awaitPromise`, kein `Input`. Der Treiber gleicht das aus. |
| Weg zum Finger | CDP `Input.dispatchTouchEvent` | WebDriverAgent ueber Appium | Braucht einen laufenden Appium-Server (`ios/appium.sh`). Die erste Sitzung je Simulator baut WebDriverAgent (gemessen rund 20 s), jede weitere braucht 1 bis 2 s. |
| `connect` | Socket `webview_devtools_remote_<pid>` | Seite mit `appId` `PID:<pid>` | Geraet ueber `IOS_SIM` (Name) oder `IOS_UDID`. Laufen mehrere Simulatoren ohne Angabe, bricht der Treiber ab. |
| `evalJs` | ein Aufruf | auswerten, dann `Runtime.awaitPromise` bzw. Wert nachholen | keine |
| `tap` | Touch-Ereignisse per CDP | echter Fingertipp in Bildschirmpunkten. Die Lage der Seite auf dem Bildschirm misst der Treiber je Lage einmal mit einem Probetipp, den die Seite schluckt. | WebKit liefert `touchstart` und `pointerdown` nur an Seiten mit passenden Listenern. Der Treiber setzt deshalb einmal je Dokument einen stillen Zeugen. Der erste Tipp je Lage dauert rund 1 s laenger. |
| `type` | `Input.insertText` | Zeichen ueber die Bildschirmtastatur | Das Feld muss durch einen echten Tipp den Fokus haben. Ohne offene Tastatur faellt der Treiber auf `execCommand('insertText')` zurueck. |
| `key` | alle Tasten der Liste | Enter, Tab, Backspace, Space, einzelne Zeichen | Delete, Escape, Pfeile, Home, End: Fehler `nicht-unterstuetzt`. Die iOS-Tastatur hat sie nicht, WebDriverAgent nimmt sie an, in der Seite kommt nichts an (gemessen). |
| `back` | Zurueck-Taste (`keyevent 4`) | Wischgeste vom linken Rand, in zwoelf Schritten | Wirkt nur, wenn die App die Geste anbietet (`allowsBackForwardNavigationGestures` oder eigene Randgeste). Schliesst weder Tastatur noch native Fenster. Ob iOS die kuenstliche Geste erkennt, haengt an ihrer Form: ohne Halt 4 von 12, mit 150 ms Halt am Anfang und 200 ms am Ende 20 von 20 (gemessen am SE 3). Der Treiber nimmt die Form mit Halt und wiederholt die Geste bis zu dreimal, solange sich Adresse, Verlauf und sichtbarer Text nicht aendern. Auf der ersten Seite wird deshalb dreimal gewischt (rund 9 s), die App bleibt offen. |
| `screenshot` | `screencap` bzw. CDP | `simctl io screenshot` bzw. `Page.snapshotRect` | Das Geraetebild ist immer hochkant, auch im Querformat. |
| `consoleLog`, `netzFehler` | CDP-Ereignisse | `Console.messageAdded`, `Network.*` | Typen sind angeglichen (`exception`, `error`, `log.error`). WebKit spielt beim Verbinden auch aeltere Meldungen der Seite nach. |
| `rotate` | `user_rotation` | WebDriverAgent `orientation` | `env(safe-area-inset-*)` bleibt nach dem Drehen auf den Werten des Hochformats (Befund aus dem Bauweg, betrifft die App, nicht den Treiber). |
| `setFontScale(x)` | freier Faktor | naechste der zwoelf Stufen von Dynamic Type: 1.0 `large`, 1.3 `extra-extra-extra-large` (1,35), 2.0 `accessibility-large` (1,94) | Wirkt nur auf Schriften, die an `-apple-system-body` und Verwandten haengen. `rem` und Pixel bleiben gleich. `snapshotSettings().fontScale` nennt den Faktor der Stufe, nicht den gewuenschten. |
| `setDark` | `cmd uimode night` | `simctl ui appearance` | keine |
| `network(false)` | WLAN und Mobilfunk aus | Ersatz: Der Inspector faengt jede Anfrage der Seite ab und laesst sie scheitern. `navigator.onLine` meldet `false`, die Ereignisse `offline` und `online` werden ausgeloest. Der Zustand uebersteht ein Neuladen. | Der Simulator hat keinen Netzschalter. Der Ersatz wirkt NUR auf Anfragen aus der WebView. Anfragen der Rust-Seite, WebSockets und Hintergrund-Downloads laufen weiter. `navigator.onLine` ist ueberschrieben, nicht echt. Naht fuer den Rest: Der Treiber ruft `window.__LU_TEST__.netz(bool)`, falls die App es anbietet. Adressen auf dem Geraet selbst bleiben frei, mit `{lokalFrei: false}` auch die nicht. |
| `kill` | `am force-stop` | `simctl terminate` | keine |
| `launch` | `am start` | `simctl launch` | keine |
| `clearData` | `pm clear` | App sichern, deinstallieren, wieder einspielen | Eintraege im Schluesselbund ueberleben das, wie auf dem Geraet. |
| `installApk` / `installApp` | `adb install -r` | `simctl install` einer `.app` fuer den Simulator, auch aus `.ipa` oder `.zip` | Nur Simulator-Bauten. Ein Paket fuer das echte Geraet laeuft im Simulator nicht. |
| `pushFile(lokal, ziel)` | beliebiger Pfad | `fotos`, `dateien[/name]` (Dateien-App), `app/<pfad>` (Daten-Container) | Jeder andere Pfad: Fehler `nicht-unterstuetzt`. iOS hat kein `/sdcard`. |
| `lowMemory` | `am send-trim-memory` mit Stufe | Naht: `window.__LU_TEST__.speicherWarnung()` in der App, oder ein JS-Aufruf in `IOS_LOWMEM_JS` | Von aussen geht es nicht: `notifyutil -p UISimulatedMemoryWarningNotification` kommt nicht an. Ohne Naht: Fehler `nicht-unterstuetzt`. iOS kennt keine Stufen. |
| `backgroundKill` | Home, dann `am kill` | Home, dann `simctl terminate` | Speicherdruck des Systems laesst sich nicht herstellen. Der Prozess endet aber genauso ohne Vorwarnung. |
| `openUrl` | `am start -a VIEW` | `simctl openurl`, der Dialog "In ... oeffnen?" wird bestaetigt, wenn er kommt | Befund aus dem Bauweg: Bei beendeter App kommt der Deeplink in einer Tauri-App nicht an. Das ist ein Fehler der App-Seite, der Treiber liefert die Adresse ab. |
| `background`, `activate` | Home-Taste, `am start` | Home-Taste, `mobile: activateApp` | Im Hintergrund haelt iOS die App nach wenigen Sekunden an. Der Inspector antwortet dann nicht, bis sie wieder vorn ist. |
| `sleep` | `adb shell sleep` | Zeitgeber im Treiber | keine |
| `snapshotSettings` | Schrift, Drehung, Nacht, WLAN, Daten | `appearance`, `contentSize`, `fontScale`, `orientation`, `netz` | Die Schluessel heissen anders. Werkzeuge vergleichen nur den ganzen Schnappschuss. |
| `foreground` | `dumpsys window` | `mobile: activeAppInfo`, dazu offener Dialog und native Auswahlfenster | keine |
| `keyboard`, `webviewBounds` | Geraetepixel | Punkte | Im Querformat meldet WebDriverAgent den Rahmen der Tastatur hochkant, der Treiber rechnet um. Die Oberkante liegt rund 17 Punkte unter der sichtbaren Rundung der Tastatur. |
| `axInfo` | `Accessibility.getPartialAXTree` | `DOM.getAccessibilityPropertiesForNode` | keine |
| `logcat` | `logcat` | `log show` des Simulators | keine |

Der Android-Treiber hat `installApp`, `openUrl`, `background` und `activate` am 08.10.2026 dazubekommen. Diese vier sind am Emulator noch nicht gelaufen.

### Naehte, die die App fuer iOS anbieten muss

Nur im Pruefbau, nie im Store-Paket (siehe `TESTIDS.md`, Abschnitt Testhaken):

| Naht | Wozu |
|---|---|
| `window.__LU_TEST__.speicherWarnung()` | Loest im Simulator die echte Speicherwarnung aus (`didReceiveMemoryWarning`). Vorlage: `fixture/ios-testbett/plugin`. |
| `window.__LU_TEST__.netz(bool)` | Schaltet die Rust-Seite und die Hintergrund-Downloads offline, weil der Ersatz von `network` nur die WebView erreicht. |
| Zurueck-Geste | Die App muss sie anbieten, sonst hat `back()` nichts, was es ausloesen kann. |

## Der dritte Treiber: vorschau

`vorschau.mjs` ist kein Geraet. Er steuert die Shell im Vite-Entwicklungsserver in einem kopflosen Chromium (`trocken/server.mjs` startet den Server) und dient nur dem Trockenlauf des Rahmens (`README.md`, Abschnitt "Trockenlauf ohne Geraet"). Ein Lauf damit ist nie ein Beleg.

| Funktion | In der Vorschau |
|---|---|
| `tap`, `type`, `key`, `swipe` | echte Touch- und Tastenereignisse ueber das Chrome DevTools Protocol, wie auf Android |
| `launch({schalter})` | laedt die Seite neu. `schalter` sind die Entwicklerschalter der Shell in der Adresse (`route`, `store`, `onboarding`, `theme`, `fs`) |
| `kill`, `backgroundKill` | verwirft die Seite. Ersatz: Es gibt keinen Prozess der App |
| `back` | `history.back()` |
| `network(false)` | Ersatz: `navigator.onLine` meldet offline und Anfragen der Seite scheitern |
| `clearData` | loescht den Speicher der Herkunft |
| `rotate`, `setDark` | ueber die Emulation des Browsers |
| `setFontScale` | ueber den Entwicklerschalter `fs` der Shell, wirkt nach einem Neuladen |
| `installApk`, `pushFile`, `lowMemory` | Fehler mit `code: 'nicht-unterstuetzt'` |
| zusaetzlich `gesperrteAnfragen()`, `nativeAufrufe()` | was die Seite an fremde Adressen schicken wollte (alles gesperrt) und was sie von der nativen Seite wollte (leise mit 404 beantwortet) |

## Inspizierbarkeit: was die App dafuer setzen muss

Ohne Debugging der WebView gibt es keinen Socket, `connect` scheitert dann mit "kein DevTools-Socket".

- Android: Die WebView braucht `WebView.setWebContentsDebuggingEnabled(true)`. Tauri setzt das in Debug-Bauten immer und in Release-Bauten nur mit dem Cargo-Feature `devtools`.
- iOS: `WKWebView.isInspectable = true` (ab iOS 16.4), in Tauri ebenfalls ueber `devtools`. Ein Debug-Bau ist ohne Zutun inspizierbar, ein Release-Bau ohne das Feature nicht (`connect` meldet dann "keine inspizierbare Seite").
- Das Feature gehoert NICHT in den gemeinsamen Cargo-Block. Ueber den Socket erreicht jede adb-Verbindung Token und alle Kommandos (Lektion 1 in `mobile-docs/INVENTUR-UEBERNAHME.md`). Vorgabe: ein eigenes Build-Flag nur fuer Pruefbauten, zum Beispiel ein Cargo-Feature `inspect`, das `tauri/devtools` einschaltet. Das Store-Paket wird ohne gebaut.
- Abnahme am Release-Paket heisst also: Release-Profil plus Pruef-Flag. Dass das Store-Paket keinen Socket hat, wird getrennt belegt: auf einem `user`-Abbild `adb shell cat /proc/net/unix | grep devtools` muss leer sein.
- Achtung Emulator: Ein `userdebug`-Abbild oeffnet das Debugging fuer JEDE App (Lektion 6). Dass der Treiber dort verbindet, sagt nichts ueber das Paket. Der Bericht schreibt die Bauart des Abbilds in den Kopf.

## Bekannte Fallen

- `\s` in Template-Strings: `` `/\s+/` `` wird zu `/s+/`. Entweder doppelt escapen (`\\s`) oder `evalFn` mit einer echten Funktion benutzen. Alle Seitenfunktionen in `lib/seite.mjs` gehen diesen zweiten Weg.
- `const` und `let` auf oberster Ebene in `evalJs` bleiben in der Seite deklariert. Der zweite Aufruf mit demselben Namen scheitert mit "already declared". Immer in `(() => { ... })()` einpacken.
- Eine Systemeinstellung (Schrift, Dunkel, Drehung) kann die Activity neu starten (Lektion 12). Die Verbindung reisst dann ab. Der Android-Treiber verbindet beim naechsten Aufruf selbst neu, der Zustand der Seite ist aber weg. Nach jeder Umstellung die Route neu oeffnen.
- Liegt ein natives Fenster ueber der WebView (Systemdialog, Berechtigungsfrage, Auswahlliste), bestaetigt die Seite einen Touch nie. `tap` bricht dann nach 8 s mit einer klaren Meldung ab. Im Selbsttest einmal direkt nach einem Kaltstart von Chrome beobachtet.
- Ist eine Seite breiter als der Schirm, zeigt Chromium sie herausgezoomt und `innerWidth` waechst mit (gemessen 612 statt 412). Bezugsbreite ist deshalb `document.documentElement.clientWidth`.
- Mehrere Geraete: Der Android-Treiber nimmt `ANDROID_SERIAL`, sonst den Emulator mit dem AVD-Namen aus `ANDROID_AVD`, sonst das einzige Geraet. Bei mehreren ohne Angabe bricht er ab, damit nie das falsche Geraet verstellt wird.
- `adb shell monkey -p <pkg> 1` holt eine laufende App nicht verlaesslich nach vorn. `launch` nimmt `am start` mit den Flags des Launchers.
- `lowMemory`: Das System nimmt fuer eine App im Vordergrund nur die Stufen `RUNNING_*` an.
- iOS: Ein Listener fuer `touchstart` oder `pointerdown`, der erst nach dem Laden gesetzt wird, bekommt nichts, bis die Seite das naechste Bild zeichnet. Wer in einem Test selbst lauscht, setzt den Listener und ruft dann einmal `tap`, der Treiber erzwingt dabei das Bild.
- iOS: Nach einer abgebrochenen Wischgeste vom Rand kamen Tipps direkt danach nicht in der Seite an (beobachtet, vermutlich liegt kurz ein Standbild der Geste ueber der WebView). Nach einem Neustart der App ging es wieder.
- iOS: Bei offener Tastatur passt `visualViewport.offsetTop` nicht zur Lage auf dem Bildschirm. Fuer "liegt das Feld unter der Tastatur" zaehlt `toScreen`, nicht die Rechnung in der Seite.
- iOS: `localStorage` wird verzoegert auf die Platte geschrieben. Eine Einstellung, die in derselben Sekunde vor dem Herunterfahren des Geraets geschrieben wurde, war danach weg (zweimal gemessen, mit 1 s Abstand nicht mehr). Ein Abschuss nur der App verliert nichts. IndexedDB war in beiden Faellen vollstaendig.
- WLAN aus trennt weder adb noch die CDP-Verbindung. Seiten, die ueber `adb reverse` von `localhost` kommen, laden auch ohne Netz weiter.
