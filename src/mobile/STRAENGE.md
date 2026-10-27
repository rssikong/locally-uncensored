# Straenge der Mobile-Shell

Das Geruest steht. Sechs Straenge fuellen es parallel, jeder in seinem eigenen Worktree. Diese Datei sagt, wem welche Datei gehoert und wie ein Strang etwas am Geruest aendern laesst, ohne es selbst anzufassen.

Grundlage: `mobile-docs/design/DESIGN.md` (was der Nutzer sieht) und `mobile-docs/design/ARCHITEKTUR.md` Abschnitt 9 (wie gebaut wird).

## 1. Die eine Regel

Ein Strang schreibt nur in seine eigenen Ordner und Dateien (Tabelle in 2). Alles andere liest er nur. Braucht er dort eine Aenderung, schreibt er sie auf (Abschnitt 5) und baut solange in seinem eigenen Ordner einen Ersatz.

## 2. Wem was gehoert

| Strang | Inhalt | Schreibt nur in |
|---|---|---|
| 1 chat | C1, C2, C3, C4, C6, C7, C14 | `screens/chat/`, `strings/chat.ts` |
| 2 agent | C5, C8 bis C13, E6 bis E10, die drei Steckplaetze in C2 | `screens/agent/`, `strings/agent.ts` |
| 3 create | K1 bis K14 | `screens/create/`, `strings/create.ts` |
| 4 models und onboarding | A1 bis A4, M1 bis M4, E13, E14, G9, G10 | `screens/onboarding/`, `screens/models/`, `strings/models.ts`, `resilience/StorageDialog.tsx`, `resilience/EngineNotices.tsx` |
| 5 settings | E1 bis E5, E11, E12, E15 bis E21, G5, G6, G11, G13, G14 | `screens/settings/`, `strings/settings.ts`, `strings/release-notes.ts`, `resilience/CreditsSheet.tsx`, `resilience/SessionSheet.tsx`, `resilience/LinkOfferSheet.tsx` |
| 6 remote | R1 bis R5, G4, G7, G8, G12 | `screens/remote/`, `strings/remote.ts`, `resilience/OfflineBanner.tsx`, `resilience/ResumeNotice.tsx`, `resilience/StorageToast.tsx`, `resilience/FatalScreen.tsx`, `resilience/useOnline.ts` |

Jeder Screen und jedes Blatt aus dem Design liegt schon als Platzhalter an seinem endgueltigen Pfad. Der Kopfkommentar der Datei traegt die Elementliste aus DESIGN.md. Der Strang ersetzt den Rumpf. Pfad, Standardexport und `data-testid` bleiben.

Tests eines Strangs liegen in seinem Ordner unter `__tests__/`. Kleine Bausteine, die nur ein Strang braucht, liegen unter `screens/<strang>/parts/`.

## 3. Was nur das Geruest aendert

Kein Strang schreibt in diese Dateien und Ordner:

- `nav/` (Router, Routentabelle `routes.ts`, Blatt-Tabelle `sheets.ts`, `loaders.ts`)
- `ui/` (Basiskomponenten)
- `platform/` (Naht zur nativen Schicht)
- `boot/`, `MobileRoot.tsx`
- `styles/` (Tokens und das gesamte CSS)
- `strings/common.ts`, `strings/policy.ts`
- `policy/` (Store-Bausteine: Presets, Melden, Einwilligung, Altersabfrage, siehe Abschnitt 9.6)
- `dev/` (Katalog `/dev/ui`, Liste `/dev/routes`)
- `lib/`, `data/` (Passt-Rechnung und Geraetedaten)
- `__tests__/` direkt unter `src/mobile` (die Waechter)
- alles ausserhalb von `src/mobile`: `src/main.tsx`, `src/index.css`, `index.html`, `src/stores`, `src/hooks`, `src/api`, `src/lib`, `src-tauri`, `playwright.config.ts`, `e2e/mobile/support.ts`, `e2e/mobile/shell.mobile.ts`

Eigene Playwright-Dateien eines Strangs heissen `e2e/mobile/<strang>.mobile.ts`. Das Projekt `mobile` nimmt jede Datei mit der Endung `.mobile.ts`.

## 4. Was ein Strang ohne das Geruest erweitern kann

### 4.1 Eine zusaetzliche Seite oder ein zusaetzliches Blatt

Jeder Strang hat drei eigene Registerdateien, die das Geruest schon einbindet:

- `screens/<strang>/routes.ts`: Name, Titel, Art, Reiter und `screen` der Seite.
- `screens/<strang>/sheets.ts`: Name und Titel des Blatts. Die Kennung beginnt mit dem Strangnamen.
- `screens/<strang>/loaders.ts`: unter demselben Schluessel die Datei, `() => import('./ExamplePage')`.

Danach kennt der Compiler `nav.push('/...')` und `nav.openSheet('...')`. Fehlt der Lader zu einem Eintrag, baut es nicht.

Namen und Dateien stehen mit Absicht in zwei Dateien. Jeder Screen importiert `nav`, und `nav` liest seine Kennungen aus den Tabellen. Stuende der Import des Screens in der Tabelle, laege jeder Screen in einem Kreis mit sich selbst (`npm run cycles`).

### 4.2 Steckplaetze

Wo ein Strang in den Screen eines anderen hineinragt, gibt es eine Datei mit festem Pfad. Der eine Strang bindet sie ein, der andere fuellt sie. Die Eigenschaften der Komponente sind der Vertrag. Bis sie gefuellt ist, liefert sie nichts.

| Datei | bindet ein | fuellt |
|---|---|---|
| `screens/agent/ChatNoticeSlot.tsx` | 1 chat, im Hinweisbereich von C2 | 2 agent |
| `screens/agent/MessageBlocks.tsx` | 1 chat, im Verlauf von C2 | 2 agent |
| `screens/agent/ComposerStatus.tsx` | 1 chat, als `status` von `ui/Composer` | 2 agent |
| `screens/remote/RemoteHome.tsx` | 1 chat, im Segment "Remote desktop" von C1 | 6 remote |
| `screens/settings/cloud/CloudSwitch.tsx` | 1 chat und 3 create, in `actions` der Wurzelseite | 5 settings |
| `screens/models/downloads-badge.ts` | Geruest, in der Reiterleiste | 4 models |
| `resilience/EngineNotices.tsx` | 1 chat in C2, 4 models in E13 | 4 models |
| `resilience/OfflineBanner.tsx` | Geruest in `MobileRoot` | 6 remote |

Das Modell-Blatt C3 gehoert Strang 1. Andere oeffnen es nur ueber `nav.openSheet('model', { onPick })`.

`ui/Composer` gehoert dem Geruest. C2, C9, R4 und K1 benutzen es ueber seine Eigenschaften.

## 5. So wuenscht ein Strang eine Aenderung am Geruest

Der Strang aendert das Geruest nie selbst. Er schreibt den Wunsch in seine Datei `mobile-docs/geruest-wuensche/<strang>.md` (also `chat.md`, `agent.md`, `create.md`, `models.md`, `settings.md`, `remote.md`). Nur diese eine Datei, damit sich zwei Straenge dort nie begegnen. Wuensche an die native Schicht stehen in `rust.md`, die das Geruest angelegt hat; ein Strang ergaenzt dort nichts, sondern nennt den Bedarf in seiner eigenen Datei.

Ein Eintrag hat diese Form:

```
## <kurzer Titel>
- Datei: <Pfad im Geruest, zum Beispiel src/mobile/ui/List.tsx>
- Wunsch: <was sich aendern soll>
- Warum: <welches Element aus DESIGN.md es braucht, mit Nummer>
- Solange: <der Ersatz im eigenen Ordner, mit Pfad>
```

Bis der Wunsch erfuellt ist, baut der Strang den Ersatz unter `screens/<strang>/parts/`. Nach der Zusammenfuehrung zieht der Integrator Doppeltes nach `ui/` und loescht den Ersatz.

Dasselbe gilt fuer `src/stores`, `src/hooks`, `src/api` und `src/lib`: aufschreiben, Adapter im eigenen Ordner, nicht aendern.

## 6. Regeln, die Waechter pruefen

Die Waechter liegen unter `src/mobile/__tests__/` und laufen mit `npx vitest run`.

- Kein Import aus `src/components/layout/` und `src/components/onboarding/` (`keine-desktop-shell.test.ts`).
- Kein Desktop-Code importiert aus `src/mobile`, ausser dem einen dynamischen Import in `src/main.tsx` (`ein-weg-nach-mobile.test.ts`).
- Kein Text mit "click", kein Name einer Desktop-Engine, kein langer Strich, auch nicht in Kommentaren (`nutzertexte.test.ts`).
- Kein `@tauri-apps`, kein `window.open`, kein `navigator.clipboard`, kein `navigator.share` ausserhalb von `platform/` (`platform-naht.test.ts`). Natives geht immer ueber eine Funktion aus `platform/`.
- Tokens hell und dunkel haben denselben Schluesselsatz (`styles/__tests__/tokens.test.ts`).
- Jede Route und jedes Blatt hat eine Datei, jeder Screen eine eigene Kennung (`nav/__tests__/tabellen.test.ts`).

## 7. Regeln, die kein Waechter prueft

- Texte sind englisch und stehen in `strings/<strang>.ts`, nicht im JSX.
- Gestaltet wird mit den Komponenten aus `ui/` und den Klassen `m-*`. Kein Tailwind unter `src/mobile`: der Scan von Tailwind nimmt den Ordner aus, eine Utility-Klasse haette dort keine Wirkung. Fehlt eine Klasse, ist das ein Wunsch nach Abschnitt 5.
- Farben und Masse kommen aus den Tokens `--m-*`. Schrift in rem, Abstaende in px.
- Jedes Ziel ist mindestens 44 mal 44 px gross. Nichts haengt allein an Hover.
- Jedes Element aus DESIGN.md traegt seine Nummer als `data-el` (Eigenschaft `el` der Komponenten) und ein `data-testid` (Eigenschaft `testid`). Schema: `m-<screen>-screen` fuer die Seite, `m-sheet-<id>` fuer das Blatt, `m-<screen>-<teil>` fuer Teile.
- Navigiert wird nur ueber `nav` aus `src/mobile/nav`. Blaetter und Rueckfragen oeffnet nur `nav.openSheet`, `nav.confirm` und `nav.prompt`, sonst schliesst die Zurueck-Geste sie nicht.
- Vorgaenge, die beim Verlassen der App sichern muessen, haengen sich an `useAppLifecycle` aus `platform/`. `onBackground` laeuft synchron: was beim Ruecksprung nicht geschrieben ist, ist verloren.

## 8. Ansehen und pruefen

- Shell im Browser: `npm run dev:mobile` (setzt `VITE_LU_BUILD_TARGET=mobile`), dann `/?mobile=1&dev=1&onboarding=skip`. Mit dem gewoehnlichen `npm run dev` ist die Handy-Oberflaeche nicht im Paket, `?mobile=1` zeigt dann den Desktop.
- Weitere Schalter: `route=/dev/ui` (Katalog aller Komponenten), `route=/dev/routes` (alle Seiten und Blaetter), `theme=dark|light`, `fs=200` (Schrift in Prozent), `os=ios|android`. Dazu `device=ios:6` oder `device=iPhone15,4` (Geraet fuer die Passt-Rechnung, auch als `localStorage` `lu-mobile-device`) und `store=play|appstore` (Store-Preset, nur am Vite-Server).
- Rauchtest: `npx playwright test --project=mobile`.
- Nur einzelne Dateien: `LU_E2E_ONLY=shell,agent npx playwright test --project=mobile` (Namen ohne `.mobile.ts`, Regel in `e2e/mobile/filter.ts`). Der Filter haengt nicht mehr am Namen des Worktrees. Eigener Port neben anderen Laeufen: `LU_E2E_PORT=5612`.
- Entwicklerseiten fuer das Kit: `route=/dev/frame` (langer Titel, hoher Fuss, Toast), `route=/dev/composer` (Composer mit Liste, auch quer), `route=/dev/viewer` (Betrachter mit langem Dateinamen).
- Aufnahmen: `LU_MOBILE_SHOTS=1 npx playwright test --project=mobile shots`, Ablage `mobile-docs/design/shell-shots/`.
- Abnahme eines Strangs: alle Elementnummern als `data-el` vorhanden und im Projekt `mobile` ausgeloest, Zustaende leer, laedt und Fehler belegt, Waechter gruen, `npm run cycles` ohne Kreis, Desktop gruen.

## 9. Was das Geruest jetzt bereitstellt

Stand 08.10.2026, nach dem ersten Geraetelauf. Alles hier ist verdrahtet und getestet. Ein Strang benutzt es, er baut es nicht nach. Die Nahtstellen der Logik (`logik-an-shell.md`) ruft das Geruest einmal in `boot/wiring.ts`; ein Waechter (`__tests__/geruest-verdrahtung.test.ts`) schlaegt an, wenn ein Screen eine davon ein zweites Mal ruft.

### 9.1 Schon verdrahtet, nichts zu tun

- Lebenszyklus: `installMobileLifecycle` laeuft einmal. `recoverInterruptedRuns` und `resumePendingCloudJobs` startet kein Screen selbst.
- Konto: `useCloudAuth` haengt einmal in `MobileRoot`. Ein Screen liest `useCloudAuthStore`.
- Links: Startlink und spaetere Links gehen durch `reportIncomingUrl` (`nav/deeplink.ts`). Die Rueckkehr vom Anmelden kommt von selbst an, alles andere wird als Angebot G14 gezeigt.
- Fertige Cloud-Auftraege nach der Rueckkehr: Guthaben wird neu gelesen, ein Toast "Your result is in the gallery" mit "Open" fuehrt nach `/create/gallery`.
- Teilen und Sichern der Logik (`setMobileShareHandler`), Kontextgrenze und Passung des Dokument-Modells (`setMobileContextCap`, `setEmbedderFitCheck`), Schluesselbund (`setMobileKeychainAvailable`), dauerhafter Speicher (`requestPersistentStorage` beim ersten Start).
- `lu:credits-exhausted` oeffnet das Blatt `credits` (Strang 5 fuellt es, die Angaben stehen in `useSheet().props`).
- Das Modell wurde ohne Zutun des Nutzers ersetzt: ein Toast sagt es (`boot/ModelNotes.tsx`).
- Geht eine Seite zurueck, gleitet sie kurz hinaus (320 ms, bei reduzierter Bewegung ein kurzes Ausblenden). Kein Screen animiert das selbst.
- Liegt ein Blatt oder eine Rueckfrage offen, steht der Toast oben statt ueber deren Knoepfen.

### 9.2 Speicherhinweise (fuer Strang 6, `resilience/StorageToast.tsx`)

```ts
// lib/storage-alerts.ts
useStorageAlerts(): {
  writeFailures: StorageWriteFailure[]   // was gerade nicht gespeichert werden konnte
  losingData: boolean                    // true: etwas geht beim Schliessen verloren
  quotaExceeded: boolean                 // lu:storage-quota-exceeded kam an
  quotaKey: string | null
  dismissQuota(): void
}
```

Solange keine Komponente `useStorageAlerts()` benutzt, zeigt das Geruest seinen einfachen Ersatz (`boot/StorageFallback.tsx`: Toast "Storage is full" mit "Manage storage", Zeile "Not saved" bei drohendem Verlust). Sobald Strang 6 den Hook einhaengt, verschwindet der Ersatz von selbst.

### 9.3 Diagnose (fuer Strang 5, Seite Fehlersuche, und Strang 1 fuer die Messung)

```ts
// lib/diagnostics.ts
useDiagnostics(): { data: Diagnostics | null; loading: boolean; refresh(): Promise<void>; report: string }
buildDiagnosticsReport(): string            // sofort, aus der letzten Lesung
readDiagnosticsReport(): Promise<string>    // liest neu, dann der Text
reportGenerationSpeed({ tokens, ms, model, where? }): GenerationSpeed | null
lastGenerationSpeed(): GenerationSpeed | null
```

`Diagnostics` traegt `device` (Modell, RAM, freier Speicher, Chip, Systemversion, App-Version, Simulator), `fit` (was die Passt-Rechnung daraus macht), `engine` (Zustand, Modell, Kontext, Beschleuniger), `speed` (letzte Tokens je Sekunde), `fontScale`, `theme`, `persistentStorage`, `nativeBridge`. Strang 1 ruft `reportGenerationSpeed` am Ende jeder lokalen Antwort; ohne den Aufruf steht im Bericht "Last speed: not measured yet". Die Datei `pruefliste.md`, auf die der Auftrag verwies, gibt es im Repo nicht; gebaut ist nach dem Wortlaut des Auftrags.

### 9.4 Plattform (`platform/`, alles ueber `platform/index.ts`)

Jede Funktion fragt zuerst die Bruecke `src/lib/lu-native.ts` (sobald sie im Bau liegt), dann das alte Kommando, dann den Web-Ersatz. Keine meldet einen stillen Erfolg.

```ts
shareFile({ name, mime, data, title? }): Promise<ShareResult>          // { completed, via }
shareUrl({ url, name, mime, title? }): Promise<ShareResult>          // grosse Dateien als Adresse, ohne Umweg durch den WebView
saveToDevice({ name, mime, data, target: 'photos' | 'files' }): Promise<SaveResult>
saveUrlToPhotos({ url, name, mime }): Promise<SaveResult>
canShareUrl(): Promise<boolean>
openExternal(url): Promise<{ opened: true } | { opened: false; reason: 'blocked' | 'unavailable' | 'failed' }>
getDeviceInfo(): Promise<DeviceInfo>      getFitDevice(): Promise<{ info, resolved }>      getFreeStorageBytes(): Promise<number | null>
qrScanSupport(): Promise<'native' | 'web' | 'none'>      scanQr(): Promise<string | null>      detectQr(source): Promise<string | null>
currentFontScale(): number      onFontScaleChange(fn: (scale: number) => void): () => void      // dazu das Fensterereignis lu:font-scale
exitApp(): Promise<boolean>
nativeBridge(): Promise<LuNativeBridge | null>      tryBridge(call): Promise<{ ok: true; value } | { ok: false }>      onBridgeEvent(event, handler)
```

Schriftgroesse: die Shell misst, was am Bildschirm steht, und deckelt bei 200 Prozent. `html[data-font-scale]` traegt die Zahl in Prozent. Ein Screen rechnet nie selbst einen Faktor ein, er nimmt rem.

### 9.5 Geraet fuer die Passt-Rechnung

Im Simulator meldet iOS 0 und Android den RAM des Rechners. `lib/device-fit.ts` nimmt dann den Nennwert des simulierten Modells. Zum Ansehen eines anderen Geraets: `?device=ios:6` oder `localStorage` `lu-mobile-device` (nur mit dem Entwicklerschalter).

### 9.6 Store-Bausteine (`policy/`, erklaert in `mobile-docs/STORE-BAUSTEINE.md`)

```ts
// policy/index.ts
storePolicy(): StorePolicy               // preset, reportContent, accountDeletion, contactInfo, aiDisclosureConsent,
                                         // ageGate, contentLevels, purchase, unfilteredCatalog, customModelUrl
setStorePresetForTests(p: StorePreset | null): void
openReport({ kind: 'message' | 'image' | 'video' | 'audio', id, model, source: 'local' | 'cloud', excerpt? }): void
ensureAiConsent(): Promise<boolean>      hasAiConsent(): boolean      revokeAiConsent(): void      useAiConsent(): boolean
```

Pflichten der Straenge daraus:

- 1 chat und 3 create: ein Eintrag "Report" an jeder KI-Antwort (C6) und an jedem erzeugten Medium (K8, Viewer), der `openReport` ruft, solange `storePolicy().reportContent` gilt.
- 1, 2, 3 und 5: `if (!(await ensureAiConsent())) return` vor dem ersten Senden von Inhalten an LU Cloud (Antwort, Diktat, Vorlesen, Werkzeug, Auftrag in Create, Einschalten des Cloud-Schalters). Es gibt keine zentrale Stelle dafuer, der Grund steht in STORE-BAUSTEINE.md 3.2.
- 5 settings: Zeile zum Zuruecknehmen der Einwilligung in E-Privacy (`useAiConsent`, `revokeAiConsent`), "Delete account" bei `accountDeletion`, Kontakt in About bei `contactInfo`, Inhaltsstufen nach `contentLevels`, Kaufflaechen nach `purchase` (auch im Blatt G5).
- 4 models: Katalog nach `unfilteredCatalog`, Suche und Adressfeld nach `customModelUrl`.

Die Altersabfrage haengt das Geruest selbst ein (`policy/AgeGate.tsx` in `MobileRoot`), kein Strang tut dafuer etwas.

### 9.7 Kit seit Runde 2 (`ui/`, `nav/`)

Alles ueber `ui/index.ts` bzw. `nav/index.ts`, Ausnahme Markdown (eigener Importpfad, damit die Bibliotheken nicht in den Start geraten). Jedes Teil steht im Katalog `/dev/ui`.

```ts
// Kennzeichen fuer Inventur und Abnahme: schreibt data-m-risk auf das Ziel selbst
<Button risk="paid" />  <IconButton risk="destructive" />  <Chip risk />  <Row risk />  <Composer risk />   // Composer: nur der Senden-Knopf

// Zeile
<Row id="gemma" state="loaded" />                        // data-m-id, data-state
<Row radio={{ checked, onSelect, reselect: true }} />    // reselect: onSelect auch fuer die schon gewaehlte Zeile (Blatt schliesst)

// Neue Teile
<Fold title detail? open? onToggle? defaultOpen?>        // aufklappbarer Abschnitt, aria-expanded, Inhalt als region
<PermissionRow title detail? value onChange options? />  // Sperren, Fragen, Erlauben; Kennungen <testid>-row und <testid>-<wert>
<NumberField label showLabel? hint? integer? min max step value onChange />   // Feld darf leer sein, klemmt und rundet sofort
<SecretField kind="password" | "key" label value onChange />   // Passwort mit Zeigen, Schluessel nie sichtbar, mit Einfuegen
<Block title? hint?>  <Hint strong?>  <Heading>  <Strip label>   // Strip ist die seitliche Leiste, traegt data-m-scroll-x
<MiddleEllipsis text />                                  // eine Zeile, Auslassung in der Mitte, Endung bleibt sichtbar
<Banner action={{ label, onPress, testid }} />  <Banner actions={[a, b]} />   // hoechstens zwei
useScreenShape(): 'tall' | 'wide' | 'low'                // Form des Fensters in Einheiten der Schrift
useGuardedLeave(dirty): () => void                       // nav: fragt bei Zurueck, die Rueckgabe geht ohne Frage (nach Speichern)

// Markdown mit farbigem Code: import { Markdown, CodeBlock, askAndOpenLink } from '../../ui/Markdown'
<Markdown content onLink? onPreview? idPrefix? els? />   // Kennungen <idPrefix>-code, -code-copy, -code-preview, -link; Standard m-md
// ui/markdown-blocks.ts: fencedBlocks, fencedBlockIndex, previewBlockId, parsePreviewBlockId, findPreviewBlock, answerText
// ui/highlight.ts: highlightLanguage, shouldHighlight (bis 20000 Zeichen, sonst schlicht)
```

Was sich ohne Zutun aendert:

- Titel (Seite, Zeile, Karte, Blatt, Dialog, Leerzustand, Banner) brechen nicht mehr mitten im Wort. Die Trennstellen setzt `ui/hyphenate.tsx` selbst (leere Spannen `.m-shy`, der Text und der Name fuer Vorlesehilfen bleiben das ganze Wort), weil die Maschine nicht ueberall ein englisches Woerterbuch hat. Eigene Titel ausserhalb des Kits: `hyphenated(text)`.
- Der Seitentitel nimmt hoechstens zwei Zeilen, der Rest wird ausgelassen. Der ganze Titel bleibt der Name der Seite.
- Der Seitenfuss nimmt hoechstens 46 Prozent der Seite und rollt darueber hinaus in sich.
- Der Composer nimmt im Querformat hoechstens ein Drittel der Hoehe: Statuszeile und Bedienzeile liegen dann nebeneinander.
- Ein Toast liegt oben im Inhalt, sobald die oberste Seite unter dem Inhalt etwas Festes hat (Composer, Fuss), sonst unten. Antippen nimmt ihn weg. Ein Toast ohne Knopf steht ab 150 Prozent Schrift 2,4 statt 3 Sekunden.
- `Segmented` stellt alle Wahlen untereinander, sobald sie nicht in eine Zeile passen (`data-stacked`).
- `Chip` ist mindestens 44 px breit.
- Kennungen: `m-page-back`, `m-sheet-close`, `m-sheet-back` und `m-sheet-scrim` gibt es im Dokument genau einmal, am obersten Element. Die Seite darunter traegt `m-page-back-under`, eine Seite auf dem Weg hinaus `m-page-back-leaving`, ein Blatt darunter `m-sheet-close-under-<n>` (n = Zahl der Blaetter darueber). Ein Test, der ueber die Seite ging, laeuft weiter.
- Die ungesehene Kopie von `<EngineNotices />` in `MobileRoot` tritt zurueck, sobald eine gemountete Seite die Hinweise selbst zeigt (Chat, Engine-Seite, Regel in `boot/engine-notices.ts`). Damit steht keine Kennung `m-engine-notice-*` mehr doppelt im Dokument. Auf allen anderen Seiten bleibt sie, weil sie den Stand der Engine aktuell haelt und der Test der Modelle (`models.mobile.ts`, "notice lines for the chat") sie dort liest.
- Jedes Blatt heisst `m-sheet-<id>` (Kennung aus `nav/sheets.ts`), am Element mit `role="dialog"`. Gibt ein Blatt eine eigene Kennung mit (`m-options`, `m-account-credits-empty`, `m-account-session-expired`), bleibt sie als zweite Marke am Rahmen um das Blatt und steht am Blatt als `data-m-sheet-alias`.
- Der Inhalt eines Blatts nimmt Tipps erst an, wenn es steht (`data-m-settling` am Blatt, solange es hereinfaehrt). Schliessen geht sofort.
- `preloadScreen(load)` in `nav/LazyScreen`: die Datei eines Schirms vorab laden, damit er ohne Gerippe aufgeht. Das Link-Angebot nutzt es.
- Der Griff oben am Blatt ist `aria-hidden` und traegt `data-m-decor`: Ziehen ist eine Abkuerzung fuer den Finger, geschlossen wird ueber `m-sheet-close` oder Zurueck.

Hilfen fuer Tests in `e2e/mobile/support.ts`: `CLEAN_LAYOUT`, `topPage(page)`, `textLines(page, selector)` (Zeilenzahl und zerrissene Woerter).

### 9.8 Testhaken `window.__LU_TEST__`, Vertrag Version 2 (`dev/test-hook.ts`)

Nur im Abnahmebau (`VITE_LU_ABNAHME=1`). Neu gegenueber Version 1:

| Haken | Wirkung |
|---|---|
| `version` | `2` |
| `where()` | zusaetzlich `storePreset` (`open`, `play`, `appstore`) und `account` (Zustand des Kontos, zum Beispiel `signed-in`, `signed-out`) |
| `geraet({ ramBytes?, freeBytes? })` | Taeuscht ein Geraet vor. `ramBytes` wirkt auf die Passt-Rechnung auf jedem Weg (ueber die Antwort des Geraets und als Geraet von `lib/device-fit.ts`, das auch die Simulator-Regel schlaegt). Die Modell-Schirme fragen danach neu. `geraet(null)` ist wieder das echte Geraet. |
| `speicherVoll(bool)`, `freeBytes` | Wirken auf das, was die WebView fragt (`getDeviceInfo`, `getFreeStorageBytes`: Diagnose, Speicherzeile ohne nativen Ordner). Sie wirken NICHT auf die Frage vor einem Download: die beantwortet die native Pruefung hinter `checkDownloadSpace` (`src/api/discover.ts`). "Speicher voll vor dem Download" ist nur nativ pruefbar, mit einem wirklich vollen Speicher. Die Antwort des Hakens nennt das in `nichtAuf`. |

Ereignis `lu-test-device` am Fenster nach jeder Aenderung des vorgetaeuschten Geraets.

