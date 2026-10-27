# Wuensche der iPhone-Pruefliste an die Mobile-Shell

Stand 08.10.2026. Geschrieben beim Bau von `mobile-docs/IPHONE-PRUEFLISTE.md`. Die Pruefliste soll eine Person ohne Codekenntnis in rund 30 Minuten an einem echten iPhone abarbeiten. Dafuer muss die App ein paar Dinge selbst zeigen, die heute nur ueber Logs oder die Fernsteuerung der WebView lesbar sind. Am echten iPhone gibt es beides nicht: der Store-Bau ist nicht inspizierbar.

Unter `src/` und `src-tauri/` hat dieser Strang dafuer nichts geaendert. Alles hier ist Anforderung.

## Status am 08.10.2026 nach Runde 2

Nachgetragen am Stand `7f0d97f1` (`feat/mobile`). Der Text darunter ist unveraendert und beschreibt den Stand beim Schreiben des Wunsches. Die Nummern bleiben, wie sie sind, weil Kommentare im Code auf sie verweisen. "Am Baum geprueft" heisst: im Stand `7f0d97f1` nachgesehen. Ohne diesen Zusatz stammt der Status aus dem Commit und der Notiz des Bereichs unter `mobile-docs/r2/`. Gesamtbild je Bereich: `mobile-docs/OFFEN-NACH-MERGE.md`.

| Abschnitt | Status |
|---|---|
| 1 Diagnose-Seite | gebaut (`452a034b`, Strang Settings): Settings, "Troubleshooting", Abschnitt "Diagnostics". Zeilen "Device", "System", "App version", "Memory", "Memory available to LU", "Storage free", "Storage used by LU", "Text size", "Accelerator", "Model loaded", "Last speed", "Engine self test", "Last unexpected end". Knoepfe "Run engine self test", "Copy report", "Share report", "Refresh" |
| 1 Was davon fehlt | offen: der Knopf "Run speed test" (Ersatz ist der Benchmark im Reiter Models), die Zeilen "Thermal state", "Battery", "Higher memory limit", "Last memory warning", "Last background pause". Statt "Last exit" gibt es "Last unexpected end". Waermezustand und erhoehte Speichergrenze liefert das Plugin, die Seite zeigt sie nicht |
| 2 Geschwindigkeit an der Antwort | nicht gebaut. "Last speed" in der Diagnose und der Benchmark zeigen sie |
| 3 Sichtbare Zustaende | die Texte gibt es in `src/mobile/strings/`. `IPHONE-PRUEFLISTE.md` nennt seit dem 08.10. den Wortlaut der gebauten App |
| 4 Offene Entscheidungen | alle vier offen, stehen in `mobile-docs/FUER-DAVID.md` Punkt 8 (Nummern 14 bis 17) |

`IPHONE-PRUEFLISTE.md` hat jetzt 31 Schritte und nennt an jeder Stelle, an der ein gewuenschtes Teil fehlt, den Ersatz.

## 1. Diagnose-Seite unter Settings

Ort: Reiter Settings, Gruppe Help, als eigene Zeile "Diagnostics" oder als Abschnitt der Seite Troubleshooting (E19 im Entwurf). Vorschlag: eigene Seite `/settings/diagnostics`, erreichbar aus E19 ueber "Diagnostics" und aus der Zustandskarte E13.1 ueber "Details".

Die Seite zeigt nur Werte, sie stellt nichts ein. Jede Zeile hat einen Namen in Worten und einen Wert, der sich vorlesen laesst.

| Zeile (Vorschlag im Wortlaut) | Wert | Quelle |
|---|---|---|
| Device | Modellkennung und Klartext, zum Beispiel "iPhone16,2 (iPhone 15 Pro Max)", dazu die iOS-Version | `device_info` (`model`), `geruest-wuensche/rust.md` |
| App version | "3.0.5 (30005001)" | Tauri `getVersion`, Baunummer aus der nativen Schicht |
| Memory | Gesamt-RAM des Geraets in GB | `device_info.ramTotalBytes` |
| Memory available to LU | der Wert von `os_proc_available_memory` in MB, mit Uhrzeit der Messung | `device_info.ramAvailableBytes` |
| Higher memory limit | "Granted" oder "Not granted" | `device_info.increasedMemoryLimit` |
| Storage free | freier Speicher in GB | `device_info.storageFreeBytes` |
| Accelerator | "GPU (Metal)", "CPU" oder "CPU, graphics acceleration failed the self test" | `bundled_engine_status` (`accelerator`, `cpuOnly`, `sanityNote`) |
| Model loaded | Name, Dateigroesse, geladenes Kontextfenster, Schichten auf der Karte | `bundled_engine_status` |
| Last speed | Tokens pro Sekunde der letzten lokalen Antwort, Zahl der Tokens, Zeit bis zum ersten Token, Uhrzeit | Messung der Shell am Strom, siehe 2 |
| Thermal state | "Normal", "Fair", "Serious", "Critical" | `ProcessInfo.thermalState`, neuer Wunsch an die native Schicht |
| Battery | Ladestand in Prozent und "Charging" oder "On battery" | `UIDevice.batteryLevel`, neuer Wunsch an die native Schicht |
| Last memory warning | Uhrzeit der letzten Speicherwarnung oder "None since start" | Ereignis `lu:memory-warning` |
| Last background pause | Uhrzeit und Dauer des letzten Aufenthalts im Hintergrund | Ereignisse `lu:background`, `lu:foreground` |
| Last exit | "Closed by you", "Closed by the system" oder "Unknown" | Merker der Shell beim Start (5.5 im Entwurf) |

Knoepfe:

1. **"Run engine self test"**: laedt das aktive Modell (falls keines geladen ist), stellt die feste Pruef-Frage der Engine und zeigt das Urteil in Worten: "Passed on GPU", "Passed on CPU after the GPU failed" oder "Failed", dazu die gemessenen Tokens pro Sekunde. Laeuft ein Chat, ist der Knopf gesperrt und nennt den Grund.
2. **"Run speed test"**: erzeugt mit dem geladenen Modell eine feste Zahl Tokens (Vorschlag 128) aus einem festen Prompt bei Temperatur 0 und zeigt Tokens pro Sekunde und die Zeit bis zum ersten Token. Das ist die Zahl fuer die Pruefliste, je Modellgroesse einmal. Gekennzeichnet als "Measured on this phone".
3. **"Copy report"**: legt alle Zeilen der Seite als Klartext in die Zwischenablage, ohne Kontodaten, ohne Chat-Inhalte, ohne Pfade mit Nutzernamen. Toast "Report copied" nur bei Erfolg. Erste Zeile des Berichts: "LU diagnostics report", dann Datum und Uhrzeit.
4. **"Share report"**: derselbe Text ueber das Teilen-Blatt.

Zustaende: kein Modell geladen (die Engine-Zeilen zeigen "No model loaded", der Selbsttest bietet "Load <Modell> and test" an), Messung laeuft (Fortschritt, "Keep LU open"), Messung gescheitert (Grund in einem Satz).

Warum das noetig ist: Die Schritte 1, 2, 3, 6, 7 und 22 der Pruefliste fragen genau diese Werte ab. Ohne die Seite muesste die Person einen Mac mit Xcode anschliessen und Logs lesen.

## 2. Geschwindigkeit an der Antwort

Unter jeder lokalen Antwort, im Blatt "More" (C6), eine Zeile "Speed: 23 tokens per second, 412 tokens, first token after 0.4 s". Der Entwurf zeigt Tokens pro Sekunde bisher nur im Benchmark (M4). Die Pruefliste braucht die Zahl aus einem echten Chat, weil der Benchmark kurze Antworten erzeugt und die Waerme-Drosselung erst im langen Lauf sichtbar wird.

Die Shell misst selbst: Zeitpunkt des Sendens, Zeitpunkt des ersten Teils, Zeitpunkt von `[DONE]`, Zahl der Tokens aus `usage` des Stroms. Liefert die Engine `usage` im Strom nicht, ist das ein Wunsch an `engine_inproc.rs` (letzter Teil des Stroms mit `usage.completion_tokens`).

## 3. Sichtbare Zustaende, auf die sich die Pruefliste verlaesst

Diese Texte stehen im Entwurf. Die Pruefliste nennt sie im Wortlaut. Aendert die Shell einen Text, muss die Pruefliste mit.

| Zustand | Text im Entwurf | Schritt der Pruefliste |
|---|---|---|
| Engine laeuft nach Ausfall der Karte auf dem Prozessor | "Graphics acceleration is not available. LU is running on the processor, which is slower." | 2, 22 |
| Modell zu gross | "Too large for this phone" | 4 |
| Modell wurde nach Speicherwarnung entladen | "The model was unloaded to free memory." mit "Load again" | 7 |
| Rueckkehr aus dem Hintergrund waehrend einer Antwort | "Paused while LU was in the background." mit "Continue" | 8, 9, 23 |
| App wurde vom System beendet | "LU was closed while answering. Your phone needed the memory. The answer is saved up to this point and the model has been loaded again." | 5, 23 |
| Download nach Neustart | "Resumed after restart" | 10 |
| Download wartet auf Netz | "Waiting for network" | 11 |

## 4. Offene Entscheidungen, die beim Schreiben der Pruefliste aufgefallen sind

1. **Stummschalter.** Der Entwurf sagt nicht, ob Vorlesen bei eingeschaltetem Stummschalter hoerbar sein soll. Die Pruefliste nimmt an: ja, wie ein Video in Safari (Audio-Kategorie Wiedergabe). Soll es stumm bleiben, muss Schritt 15 umgedreht werden.
2. **Anruf waehrend Vorlesen.** Der Entwurf sagt nicht, ob das Vorlesen nach dem Anruf von selbst weiterlaeuft. Die Pruefliste (Schritt 16) verlangt nur: kein Absturz, kein Ton ueber den Anruf, danach laesst sich "Read aloud" neu starten.
3. **Geschwindigkeit als Zahl im Chat.** Siehe 2. Bis das entschieden ist, misst die Pruefliste ueber "Run speed test" und ueber den Benchmark (M4).
4. **Waerme.** Die Engine reagiert heute nicht auf `thermalState`. Die Pruefliste haelt nur fest, was passiert. Ob die App bei "Serious" drosseln oder warnen soll, ist offen.
