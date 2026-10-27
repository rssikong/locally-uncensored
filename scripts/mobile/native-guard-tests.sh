#!/bin/zsh
# Prueft die Adressregel der nativen Schicht gegen die gemeinsame Tabelle
# src-tauri/plugins/lu-native/testdata/net-vectors.tsv, in allen drei Sprachen,
# dazu die WLAN-Regel, die Farbe des Starts (StartTheme), die Wache ueber die Seite
# (ContentGuardRule, ContentProxy) und der Teil von "Sign in with Apple" ohne Bildschirm
# (AppleSignInRule: Nonce, Fehlerabbildung) und der Teil des In-App-Kaufs ohne Store
# (IapRule: was ein Kauf antwortet, was wann beendet wird; Runde 17).
# Runde 22: das Anmeldeblatt des Systems fuer Google und GitHub (WebAuthRule) und der
# Dateiwaehler fuer "File" (DocumentPickRule).
#
#   scripts/mobile/native-guard-tests.sh            Rust und Swift
#   scripts/mobile/native-guard-tests.sh kotlin     dazu Kotlin (braucht das Gradle-Projekt
#                                                   nach einem `npx tauri android build`)
#   OHNE_RUST=1 scripts/mobile/native-guard-tests.sh    ohne den Rust-Teil (kein cargo)
#
# Swift: NetGuard.swift, WifiRule.swift, ImportRule.swift und der reine Teil von
# StartTheme.swift haengen nur an Foundation und werden hier fuer den Mac uebersetzt, zusammen
# mit einem kleinen Pruefprogramm. Der iOS-Bau selbst uebersetzt dieselben
# Dateien.
set -euo pipefail
WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
PLUGIN="$WURZEL/src-tauri/plugins/lu-native"
TABELLE="$PLUGIN/testdata/net-vectors.tsv"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT

if [ "${OHNE_RUST:-}" = "1" ]; then
  # Fuer einen Lauf, waehrend ein anderer im Rust-Cache baut. Kein Beleg fuer die Rust-Seite.
  echo "== Rust: ausgelassen (OHNE_RUST=1)"
else
  echo "== Rust"
  (cd "$PLUGIN" && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$WURZEL/src-tauri/target/plugin}" cargo test --quiet net:: 2>&1 | tail -4)
fi

echo "== Swift"
cat > "$ARBEIT/main.swift" <<'SWIFT'
import AuthenticationServices
import Foundation

let path = CommandLine.arguments[1]
let text = try! String(contentsOfFile: path, encoding: .utf8)
var rows = 0
var wrong: [String] = []
for line in text.split(separator: "\n") where !line.hasPrefix("#") && !line.trimmingCharacters(in: .whitespaces).isEmpty {
  let cols = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
  guard cols.count == 4 else { wrong.append("four columns: \(line)"); continue }
  let (raw, kind, store, acceptance) = (cols[0], cols[1], cols[2], cols[3])
  var actual = "invalid"
  if let parts = NetGuard.parts(raw), !parts.host.isEmpty, let k = NetGuard.classifyHost(parts.host) {
    actual = k.rawValue
  }
  if actual != kind { wrong.append("kind of \(raw): \(actual), expected \(kind)") }
  if (NetGuard.refuse(raw, allowLocal: false) == nil) != (store == "yes") { wrong.append("store build, \(raw)") }
  if (NetGuard.refuse(raw, allowLocal: true) == nil) != (acceptance == "yes") { wrong.append("acceptance build, \(raw)") }
  rows += 1
}
if rows < 60 { wrong.append("the table lost rows: \(rows)") }
// Spellings of one number.
for (text, want) in [("127.0.0.1", [127, 0, 0, 1]), ("0x7f.1", [127, 0, 0, 1]), ("2130706433", [127, 0, 0, 1]),
                     ("017700000001", [127, 0, 0, 1]), ("0xA9FEA9FE", [169, 254, 169, 254]), ("10.1.5", [10, 1, 0, 5])] {
  if NetGuard.parseV4(text).map({ $0.map(Int.init) }) != want { wrong.append("parseV4 \(text)") }
}
for name in ["huggingface.co", "desktop", "1.2.3.4.5", "256.1.1.1", "1..2", "", "0x", "4294967296", "a.1"] {
  if NetGuard.parseV4(name) != nil { wrong.append("parseV4 took the name \(name)") }
}
// A transfer the system follows redirects for carries Authorization only.
let kept = NetGuard.headersForSystemTransfer(["Authorization": "Bearer hf_x", "X-Api-Key": "k", "Cookie": "c", "accept": "*/*"])
if kept != ["Authorization": "Bearer hf_x"] { wrong.append("headersForSystemTransfer kept \(kept.keys.sorted())") }
if NetGuard.headersForSystemTransfer(["AUTHORIZATION": "Bearer hf_x"]).count != 1 { wrong.append("headersForSystemTransfer is case sensitive") }
if !NetGuard.headersForSystemTransfer([:]).isEmpty { wrong.append("headersForSystemTransfer made a header up") }
// "Download on Wi-Fi only": the decisions Downloads.swift acts on (WifiRule.swift).
// The simulator has no mobile data, so the rule is run here.
if WifiRule.kind(satisfied: true, wifi: false, wired: false, cellular: true) != "cellular" { wrong.append("kind: mobile data") }
if WifiRule.kind(satisfied: true, wifi: true, wired: false, cellular: true) != "wifi" { wrong.append("kind: wifi next to mobile data") }
if WifiRule.kind(satisfied: true, wifi: false, wired: true, cellular: false) != "ethernet" { wrong.append("kind: cable") }
if WifiRule.kind(satisfied: false, wifi: true, wired: false, cellular: true) != "none" { wrong.append("kind: no network") }
if WifiRule.kind(satisfied: true, wifi: false, wired: false, cellular: false) != "other" { wrong.append("kind: other") }
if !WifiRule.onCellular(satisfied: true, wifi: false, wired: false, cellular: true) { wrong.append("onCellular: mobile data alone") }
if WifiRule.onCellular(satisfied: true, wifi: true, wired: false, cellular: true) { wrong.append("onCellular: wifi is there") }
if WifiRule.onCellular(satisfied: false, wifi: false, wired: false, cellular: true) { wrong.append("onCellular: no network") }
// The switch on: a fresh request forbids mobile data, unless the user said "Download anyway" for it.
if WifiRule.requestAllowsCellular(wifiOnly: true, allowedOnMobileData: false) { wrong.append("request: switch on must forbid mobile data") }
if !WifiRule.requestAllowsCellular(wifiOnly: true, allowedOnMobileData: true) { wrong.append("request: Download anyway") }
if !WifiRule.requestAllowsCellular(wifiOnly: false, allowedOnMobileData: false) { wrong.append("request: switch off") }
// A task started before the switch was turned on is stopped when the phone is on mobile data.
if WifiRule.step(ruled: true, onCellular: true, online: true, held: false, cellularAtLaunch: true, state: "running") != .hold { wrong.append("step: hold a running line") }
if WifiRule.step(ruled: true, onCellular: true, online: true, held: false, cellularAtLaunch: true, state: "queued") != .hold { wrong.append("step: hold a queued line") }
// Its own request already forbids mobile data: the system keeps it waiting, nothing to do.
if WifiRule.step(ruled: true, onCellular: true, online: true, held: false, cellularAtLaunch: false, state: "running") != .nothing { wrong.append("step: request already forbids") }
// Paused, done or failed lines are left alone.
for state in ["paused", "done", "error"] {
  if WifiRule.step(ruled: true, onCellular: true, online: true, held: false, cellularAtLaunch: true, state: state) != .nothing { wrong.append("step: \(state) must be left alone") }
}
// On Wi-Fi nothing is held, and a held line goes on: Wi-Fi back, switch off, or "Download anyway".
if WifiRule.step(ruled: true, onCellular: false, online: true, held: false, cellularAtLaunch: true, state: "running") != .nothing { wrong.append("step: wifi") }
if WifiRule.step(ruled: true, onCellular: false, online: true, held: true, cellularAtLaunch: true, state: "waiting") != .release { wrong.append("step: release on wifi") }
if WifiRule.step(ruled: false, onCellular: true, online: true, held: true, cellularAtLaunch: true, state: "waiting") != .release { wrong.append("step: release when the rule is off") }
// Held, still on mobile data, or no network at all: it stays held.
if WifiRule.step(ruled: true, onCellular: true, online: true, held: true, cellularAtLaunch: true, state: "waiting") != .nothing { wrong.append("step: stays held on mobile data") }
if WifiRule.step(ruled: true, onCellular: false, online: false, held: true, cellularAtLaunch: true, state: "waiting") != .nothing { wrong.append("step: stays held offline") }
// The colour of the window before the page has drawn (StartTheme.swift): a
// fixed choice of the user wins, otherwise the system decides, and the two
// colours are the canvas of the phone shell.
if !StartTheme.isDark(pref: "dark", systemDark: false) { wrong.append("start theme: a fixed dark must win over a light system") }
if StartTheme.isDark(pref: "light", systemDark: true) { wrong.append("start theme: a fixed light must win over a dark system") }
for pref in [nil, "system", "", "Dark", "blue"] as [String?] {
  if !StartTheme.isDark(pref: pref, systemDark: true) || StartTheme.isDark(pref: pref, systemDark: false) {
    wrong.append("start theme: \(pref ?? "nil") must follow the system")
  }
  if StartTheme.parse(pref) != "system" { wrong.append("start theme: \(pref ?? "nil") must read as system") }
}
if StartTheme.canvas(dark: false) != 0xF3F4F6 || StartTheme.canvas(dark: true) != 0x141414 { wrong.append("start theme: canvas colours") }
// A model file never goes into the backup, whichever way it came (ImportRule.swift,
// review of round 6, finding 5). The half file of an import gets the mark when it is
// created, and the mark has to survive the rename into place that Rust does afterwards.
do {
  let dir = NSTemporaryDirectory() + "lu-backup-rule-" + UUID().uuidString
  try! FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
  let partial = dir + "/model.import"
  let dest = dir + "/model.gguf"
  FileManager.default.createFile(atPath: partial, contents: Data("GGUF".utf8))
  if BackupRule.isExcluded(partial) { wrong.append("backup: a fresh file must not carry the mark by itself") }
  if !BackupRule.exclude(partial) { wrong.append("backup: the half file of an import is not excluded") }
  if rename(partial, dest) != 0 { wrong.append("backup: rename failed") }
  if !BackupRule.isExcluded(dest) { wrong.append("backup: the mark did not survive the rename into place") }
  if BackupRule.exclude(dir + "/missing.gguf") { wrong.append("backup: a file that is not there cannot be excluded") }
  try? FileManager.default.removeItem(atPath: dir)
}
// A Cancel holds from the moment an import begins until the copy reads it
// (ImportRule.swift, review of round 6, finding 12).
ImportCancel.begin()
if ImportCancel.cancelled { wrong.append("import: a new import must begin uncancelled") }
ImportCancel.cancel()
if !ImportCancel.cancelled { wrong.append("import: a Cancel before the copy begins is lost") }
ImportCancel.begin()
if ImportCancel.cancelled { wrong.append("import: a Cancel of an earlier import stops the next one") }
// The page comes back after iOS ended the process that draws it
// (ContentGuardRule.swift, finding N3 of the iPhone review).
typealias CG = ContentGuardRule
if CG.afterProbe(.answered("tauri://localhost/chat/1"), attempt: 1, viewHasAddress: true) != .nothing { wrong.append("content guard: a page that answers is left alone") }
for empty in [nil, "", "  ", "about:blank", "About:srcdoc"] as [String?] {
  if CG.afterProbe(.answered(empty), attempt: 1, viewHasAddress: true) != .reload { wrong.append("content guard: an empty document (\(empty ?? "nil")) must be loaded again") }
}
if CG.afterProbe(.processGone, attempt: 1, viewHasAddress: true) != .reload { wrong.append("content guard: a process that is gone needs no second question") }
for silent in [CG.Probe.failed, .timeout] {
  if CG.afterProbe(silent, attempt: 1, viewHasAddress: true) != .probeAgain { wrong.append("content guard: one slow answer must not reload the page (\(silent))") }
  if CG.afterProbe(silent, attempt: CG.probes, viewHasAddress: true) != .reload { wrong.append("content guard: a page that stays silent is loaded again (\(silent))") }
  if CG.afterProbe(silent, attempt: 1, viewHasAddress: false) != .reload { wrong.append("content guard: silent and without an address is loaded again at once (\(silent))") }
}
if CG.probe(errorDomain: "WKErrorDomain", errorCode: 2) != .processGone || CG.probe(errorDomain: "WKErrorDomain", errorCode: 3) != .processGone { wrong.append("content guard: the two errors that say the process is gone") }
if CG.probe(errorDomain: "WKErrorDomain", errorCode: 4) != .failed || CG.probe(errorDomain: "NSURLErrorDomain", errorCode: 2) != .failed { wrong.append("content guard: any other error is a failed call") }
// In the background the reload waits for the way back: a page loaded there loads its model there.
if CG.whenGone(inBackground: true) != .reloadOnForeground || CG.whenGone(inBackground: false) != .reloadNow { wrong.append("content guard: when to load again") }
// A page that ends its process on every load is not loaded forever.
if !CG.mayReload(now: 100, earlier: []) || !CG.mayReload(now: 100, earlier: [90, 95]) { wrong.append("content guard: the first reloads are allowed") }
if CG.mayReload(now: 100, earlier: [80, 90, 95]) { wrong.append("content guard: a fourth reload inside a minute must be refused") }
if !CG.mayReload(now: 200, earlier: [80, 90, 95]) { wrong.append("content guard: old reloads must not count for ever") }
// A web view that lost its address is not reloaded in place (that does nothing), it gets an address.
if CG.target(current: "tauri://localhost/settings", lastGood: "tauri://localhost/", start: "tauri://localhost") != CG.Target(inPlace: true, address: "tauri://localhost/settings") { wrong.append("content guard: reload in place") }
if CG.target(current: nil, lastGood: "tauri://localhost/chat/1", start: "tauri://localhost") != CG.Target(inPlace: false, address: "tauri://localhost/chat/1") { wrong.append("content guard: the last good address") }
if CG.target(current: "about:blank", lastGood: nil, start: "tauri://localhost") != CG.Target(inPlace: false, address: "tauri://localhost") { wrong.append("content guard: the start of the app") }
// Giving up is said, with a sentence and a button to load again (acceptance iPhone, second part, P2; the iOS half of F14).
if CG.saysGaveUp(mayReload: true, shown: false) { wrong.append("content guard: nothing to say while reloads are allowed") }
if !CG.saysGaveUp(mayReload: false, shown: false) { wrong.append("content guard: a page that is not loaded again must be said") }
if CG.saysGaveUp(mayReload: false, shown: true) { wrong.append("content guard: the surface is put up once, not on every failure") }
if CG.gaveUpText != "LU ran into a problem. Your chats are saved." || CG.gaveUpButton != "Reload" { wrong.append("content guard: the sentence and the button") }
if !CG.gaveUpEnds(userReloads: true, pageAnswers: false) || !CG.gaveUpEnds(userReloads: false, pageAnswers: true) || CG.gaveUpEnds(userReloads: false, pageAnswers: false) { wrong.append("content guard: when the surface goes") }
// The user's reload is always allowed: after it the count is empty, so the page is loaded.
if CG.mayReload(now: 100, earlier: [80, 90, 95]) || !CG.mayReload(now: 100, earlier: CG.afterUserReload([80, 90, 95])) { wrong.append("content guard: Reload of the user is not held against the count") }
// Check on the iPhone, M1: the answer "under 18" outlives a new installation, nothing else does.
if !FreshInstallRule.survives(account: "parked-key:lu-age-declaration", value: "minor") { wrong.append("fresh install: the answer under 18 is cleared") }
for (account, value) in [("parked-key:lu-age-declaration", "adult"), ("parked-key:lu-age-declaration", nil), ("parked-key:lu-age-declaration", ""),
                         ("parked-key:lu-age-declaration", "Minor"), ("lu-cloud-session", "minor"), ("parked-key:openai", "minor"), ("", "minor")] as [(String, String?)] {
  if FreshInstallRule.survives(account: account, value: value) { wrong.append("fresh install: \(account) with \(value ?? "nil") is kept") }
}
// "Sign in with Apple" without the screen (AppleSignInRule.swift, round 15).
// Apple gets the SHA-256 of the nonce as lower case hex, the account server the nonce itself.
typealias AS = AppleSignInRule
if AS.hashedNonce("abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" { wrong.append("apple: the hash of abc") }
if AS.hashedNonce("") != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" { wrong.append("apple: the hash of nothing") }
do {
  let nonce = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  let hashed = AS.hashedNonce(nonce)
  if hashed.count != 64 || hashed != hashed.lowercased() || hashed == nonce { wrong.append("apple: the hashed nonce is 64 lower case hex digits and not the nonce") }
  if AS.hashedNonce(nonce) != hashed || AS.hashedNonce(nonce + "0") == hashed { wrong.append("apple: the hash follows the nonce") }
  if !AS.acceptable(nonce) || !AS.acceptable(String(repeating: "A", count: 32)) || !AS.acceptable("a-b_c.d" + String(repeating: "9", count: 30)) { wrong.append("apple: a nonce of the page is refused") }
}
for bad in ["", "short", String(repeating: "a", count: 31), String(repeating: "a", count: 129), String(repeating: "a", count: 31) + " ", String(repeating: "a", count: 31) + "\u{e4}", String(repeating: "a", count: 31) + "+", String(repeating: "a", count: 31) + "\n"] {
  if AS.acceptable(bad) { wrong.append("apple: took the nonce \(bad.debugDescription)") }
}
// Closing the sheet is no error. Everything else ends in one English sentence.
if AS.errorDomain != ASAuthorizationErrorDomain { wrong.append("apple: the error domain is \(ASAuthorizationErrorDomain)") }
if ASAuthorizationError.canceled.rawValue != 1001 || ASAuthorizationError.unknown.rawValue != 1000 || ASAuthorizationError.invalidResponse.rawValue != 1002
  || ASAuthorizationError.notHandled.rawValue != 1003 || ASAuthorizationError.failed.rawValue != 1004 { wrong.append("apple: the codes of the system moved") }
if AS.outcome(domain: AS.errorDomain, code: 1001) != .cancelled { wrong.append("apple: closing the sheet must be cancelled") }
if AS.outcome(domain: "NSCocoaErrorDomain", code: 1001) != .failed(AS.failedText) { wrong.append("apple: 1001 of another domain is not a cancel") }
if AS.outcome(domain: AS.errorDomain, code: 1000) != .failed(AS.notAvailable) { wrong.append("apple: 1000 is the sentence about the Apple Account") }
if AS.outcome(domain: AS.errorDomain, code: 1002) != .failed(AS.noAnswer) || AS.outcome(domain: AS.errorDomain, code: 1003) != .failed(AS.noAnswer) { wrong.append("apple: no answer") }
if AS.outcome(domain: AS.errorDomain, code: 1005) != .failed(AS.noWindow) { wrong.append("apple: not interactive") }
for code in [1004, 1006, 0, -1, 9999] {
  if AS.outcome(domain: AS.errorDomain, code: code) != .failed(AS.failedText) { wrong.append("apple: code \(code) must end in the plain sentence") }
}
for sentence in [AS.notAvailable, AS.noAnswer, AS.failedText, AS.noWindow, AS.busy, AS.badRequest] {
  // A sentence a person reads: a full stop, no dash, no code, no word of the framework.
  if !sentence.hasSuffix(".") || sentence.contains("\u{2014}") || sentence.contains("\u{2013}") || sentence.range(of: "[0-9]{3}|ASAuthorization|error", options: .regularExpression) != nil { wrong.append("apple: not a sentence for a person: \(sentence)") }
}
// Credits as an in-app purchase without the store (IapRule.swift, round 17).
// The one rule: a purchase is never finished by the purchase itself, only after the server credited it.
typealias IR = IapRule
if IR.answer(.success(verified: true)) != .outcome(.success) { wrong.append("iap: a signed purchase is success") }
if IR.answer(.success(verified: false)) != .failed(IR.text(.unverified)) { wrong.append("iap: a purchase the store did not sign is not handed on as bought") }
if IR.answer(.userCancelled) != .outcome(.userCancelled) { wrong.append("iap: closing the sheet is no error") }
if IR.answer(.pending) != .outcome(.pending) { wrong.append("iap: Ask to Buy is pending") }
if IR.answer(.unknown) != .failed(IR.text(.other)) { wrong.append("iap: an answer the app does not know is a failure, not a purchase") }
for outcome in [IR.Outcome.success, .userCancelled, .pending] {
  if IR.finishesAtPurchase(outcome) { wrong.append("iap: the purchase itself finishes \(outcome.rawValue)") }
}
if IR.Outcome.success.rawValue != "success" || IR.Outcome.userCancelled.rawValue != "userCancelled" || IR.Outcome.pending.rawValue != "pending" { wrong.append("iap: the three words the page reads moved") }
if IR.event != "iap-transaction" { wrong.append("iap: the name of the event moved") }
// What the store reports: handed on unfinished, ended quietly, or left alone.
if IR.handling(verified: true, revoked: false, consumable: true) != .handOver { wrong.append("iap: an open purchase of credits goes to the page") }
if IR.handling(verified: true, revoked: true, consumable: true) != .finishQuietly { wrong.append("iap: a purchase the store took back has nothing to credit") }
if IR.handling(verified: true, revoked: true, consumable: false) != .finishQuietly { wrong.append("iap: taken back is taken back") }
if IR.handling(verified: true, revoked: false, consumable: false) != .leave { wrong.append("iap: what the app did not sell is not its to end") }
for revoked in [false, true] {
  for consumable in [false, true] {
    if IR.handling(verified: false, revoked: revoked, consumable: consumable) != .leave { wrong.append("iap: an unsigned transaction is touched (revoked \(revoked), consumable \(consumable))") }
  }
}
// What the page may hand in.
if IR.productIds(["app.credits.small", "app.credits.large"]) ?? [] != ["app.credits.small", "app.credits.large"] { wrong.append("iap: two product ids, in order") }
if IR.productIds(["a", "a", "b"]) ?? [] != ["a", "b"] { wrong.append("iap: no product id twice") }
for bad in [[], [""], ["has space"], ["a/b"], ["9,99"], ["\u{e4}"], [String(repeating: "a", count: 129)], Array(repeating: "x", count: 21).enumerated().map { "\($0.element)\($0.offset)" }] as [[String]] {
  if IR.productIds(bad) != nil { wrong.append("iap: took the product ids \(bad)") }
}
if IR.productIds([String(repeating: "a", count: 128)]) == nil || IR.productIds(Array(repeating: "x", count: 20).enumerated().map { "\($0.element)\($0.offset)" }) == nil { wrong.append("iap: the limits are 128 characters and 20 ids") }
if IR.accountToken("0b0e7a52-6f0c-4c3e-9a51-3d2f1c9a7e10")?.uuidString.lowercased() != "0b0e7a52-6f0c-4c3e-9a51-3d2f1c9a7e10" { wrong.append("iap: the id of an account is a UUID") }
for bad in ["", "someone@example.com", "0b0e7a52-6f0c-4c3e-9a51-3d2f1c9a7e1", "0b0e7a526f0c4c3e9a513d2f1c9a7e10", " 0b0e7a52-6f0c-4c3e-9a51-3d2f1c9a7e10", "0b0e7a52-6f0c-4c3e-9a51-3d2f1c9a7e1g"] {
  if IR.accountToken(bad) != nil { wrong.append("iap: took the account \(bad.debugDescription)") }
}
if IR.transactionId("2000000123456789") != 2000000123456789 || IR.transactionId("18446744073709551615") != UInt64.max { wrong.append("iap: the id of a transaction is a whole number") }
for bad in ["", "0", "-1", "1.5", "12a", " 12", "18446744073709551616", "000000000000000000001"] {
  if IR.transactionId(bad) != nil { wrong.append("iap: took the transaction id \(bad.debugDescription)") }
}
for sentence in [IR.text(.notAllowed), IR.text(.productUnavailable), IR.text(.network), IR.text(.storefront), IR.text(.unverified), IR.text(.other), IR.busy, IR.badRequest, IR.noAccount] {
  // A sentence a person reads: a capital letter, a full stop, no dash, no code, no word of the framework, no other place to buy.
  if sentence.first?.isUppercase != true || !sentence.hasSuffix(".") || sentence.contains("\u{2014}") || sentence.contains("\u{2013}") || sentence.count > 220
    || sentence.range(of: "[0-9]{2}|StoreKit|SKError|error|website|lu-labs|http", options: [.regularExpression, .caseInsensitive]) != nil { wrong.append("iap: not a sentence for a person: \(sentence)") }
}
// Sign in with Google or GitHub in the sheet of the system (WebAuthRule.swift, round 22, N5).
typealias WA = WebAuthRule
if WA.ephemeral { wrong.append("web auth: the sheet must share the sign-in of Safari, not start empty") }
if WA.page("https://auth.example.org/authorize?provider=google")?.absoluteString != "https://auth.example.org/authorize?provider=google" { wrong.append("web auth: a secure page is refused") }
if WA.page("  https://a.b/c  ")?.host != "a.b" { wrong.append("web auth: spaces around the page") }
for bad in ["", " ", "http://a.b/c", "lu://oauth/callback", "mailto:hi@example.com", "file:///etc/passwd", "https://", "javascript:alert(1)", "https://" + String(repeating: "a", count: 4100)] {
  if WA.page(bad) != nil { wrong.append("web auth: took the page \(bad.prefix(40).debugDescription)") }
}
if WA.scheme("lu") != "lu" || WA.scheme(" LU ") != "lu" || WA.scheme("com.example.app") != "com.example.app" || WA.scheme("a+b-c.d1") != "a+b-c.d1" { wrong.append("web auth: a scheme of the app is refused") }
for bad in ["", " ", "http", "https", "HTTPS", "file", "javascript", "data", "mailto", "tel", "tauri", "about", "1lu", "lu:", "lu://", "l u", "l\u{e4}", "a/b", String(repeating: "x", count: 33)] {
  if WA.scheme(bad) != nil { wrong.append("web auth: took the scheme \(bad.debugDescription)") }
}
if !WA.isCallback(URL(string: "lu://oauth/callback?code=abc"), scheme: "lu") || !WA.isCallback(URL(string: "LU://oauth/callback?code=abc"), scheme: "lu") { wrong.append("web auth: the link of the app is not taken") }
for other in ["https://auth.example.org/authorize", "lux://oauth/callback?code=abc", "oauth/callback?code=abc"] {
  if WA.isCallback(URL(string: other), scheme: "lu") { wrong.append("web auth: took \(other) for the link of the app") }
}
if WA.isCallback(nil, scheme: "lu") { wrong.append("web auth: no link is not the link of the app") }
// Closing the sheet is no error. Everything else ends in one English sentence.
if WA.errorDomain != ASWebAuthenticationSessionErrorDomain { wrong.append("web auth: the error domain is \(ASWebAuthenticationSessionErrorDomain)") }
if ASWebAuthenticationSessionError.canceledLogin.rawValue != 1 || ASWebAuthenticationSessionError.presentationContextNotProvided.rawValue != 2
  || ASWebAuthenticationSessionError.presentationContextInvalid.rawValue != 3 { wrong.append("web auth: the codes of the system moved") }
if WA.outcome(domain: WA.errorDomain, code: 1) != .cancelled { wrong.append("web auth: closing the sheet must be cancelled") }
if WA.outcome(domain: "NSCocoaErrorDomain", code: 1) != .failed(WA.failedText) { wrong.append("web auth: code 1 of another domain is not a cancel") }
if WA.outcome(domain: WA.errorDomain, code: 2) != .failed(WA.noWindow) || WA.outcome(domain: WA.errorDomain, code: 3) != .failed(WA.noWindow) { wrong.append("web auth: no window") }
for code in [0, 4, -1, 1001, 9999] {
  if WA.outcome(domain: WA.errorDomain, code: code) != .failed(WA.failedText) { wrong.append("web auth: code \(code) must end in the plain sentence") }
}
for sentence in [WA.failedText, WA.noWindow, WA.notStarted, WA.noAnswer, WA.busy, WA.badRequest] {
  if sentence.first?.isUppercase != true || !sentence.hasSuffix(".") || sentence.contains("\u{2014}") || sentence.contains("\u{2013}")
    || sentence.range(of: "[0-9]|ASWeb|error|Safari|browser", options: .regularExpression) != nil { wrong.append("web auth: not a sentence for a person: \(sentence)") }
}
// "File" opens the Files app itself (DocumentPickRule.swift, round 22, N2).
typealias DP = DocumentPickRule
if DP.limit(nil) != 1 || DP.limit(0) != 1 || DP.limit(-4) != 1 || DP.limit(3) != 3 || DP.limit(500) != 20 { wrong.append("document pick: the limit is 1 to 20, 1 unless said") }
if DP.taken(["a", "b", "c", "d"], limit: 3) != ["a", "b", "c"] || DP.taken(["a"], limit: 3) != ["a"] || !DP.taken(["a"], limit: 0).isEmpty { wrong.append("document pick: the first files, in order") }
if DP.displayName("notes.txt") != "notes.txt" || DP.displayName("  Bericht 2026.pdf ") != "Bericht 2026.pdf" { wrong.append("document pick: the name of the user") }
for empty in ["", " ", ".", ".."] { if DP.displayName(empty) != "file" { wrong.append("document pick: \(empty.debugDescription) is not a name") } }
if DP.displayName("a/b.txt").contains("/") { wrong.append("document pick: a name is never a path") }
if DP.target(dir: "/tmp/lu-native-tmp", folder: "abc", pathExtension: "PDF") != "/tmp/lu-native-tmp/abc/file.pdf" { wrong.append("document pick: where a file lands") }
if DP.target(dir: "/tmp/lu-native-tmp/", folder: "abc", pathExtension: "") != "/tmp/lu-native-tmp/abc/file" { wrong.append("document pick: a file without an extension") }
// The extension of the user never leads out of the folder: anything but letters and digits is dropped.
for ext in ["../x", "a/b", "t x", "\u{e4}", String(repeating: "a", count: 17)] {
  if DP.target(dir: "/tmp/t", folder: "abc", pathExtension: ext) != "/tmp/t/abc/file" { wrong.append("document pick: took the extension \(ext.debugDescription)") }
}
for (dir, folder) in [("tmp", "abc"), ("/tmp", ""), ("/tmp", "a/b"), ("/tmp", ".."), ("", "abc")] {
  if DP.target(dir: dir, folder: folder, pathExtension: "txt") != nil { wrong.append("document pick: took the place \(dir) / \(folder)") }
}
for sentence in [DP.noPicker, DP.badRequest, DP.notRead] {
  if sentence.first?.isUppercase != true || !sentence.hasSuffix(".") || sentence.contains("\u{2014}") || sentence.contains("\u{2013}") { wrong.append("document pick: not a sentence for a person: \(sentence)") }
}
// The log of the native layer is not in the folder the Files app shows (NativeLogRule.swift, round 22, N6).
do {
  let home = URL(fileURLWithPath: "/var/mobile/Containers/Data/Application/0000")
  let file = NativeLogRule.file(caches: home.appendingPathComponent("Library/Caches"))
  if file.path != "/var/mobile/Containers/Data/Application/0000/Library/Caches/lu-native.log" { wrong.append("native log: the file is \(file.path)") }
  if NativeLogRule.userVisible(file.path) { wrong.append("native log: the file lies where the Files app shows it") }
  let old = NativeLogRule.oldFile(documents: home.appendingPathComponent("Documents"))
  if old.path != "/var/mobile/Containers/Data/Application/0000/Documents/lu-native.log" || !NativeLogRule.userVisible(old.path) { wrong.append("native log: the old place is Documents") }
  if NativeLogRule.userVisible("/x/Library/Application Support/models") || !NativeLogRule.userVisible("/x/Documents/models/a.gguf") { wrong.append("native log: what the Files app shows") }
}
// Notices of the computer open only LU itself (RemoteNoteRule.swift, A17).
if !RemoteNoteRule.linkAllowed(nil) || !RemoteNoteRule.linkAllowed("lu://remote/notice?chat=chat_1") { wrong.append("remote notice: a link of LU was refused") }
if RemoteNoteRule.linkAllowed("https://example.com") || RemoteNoteRule.linkAllowed("lu://oauth/callback?code=x") || RemoteNoteRule.linkAllowed("lu://remote/notice?" + String(repeating: "x", count: 300)) { wrong.append("remote notice: a foreign or long link was taken") }
if wrong.isEmpty {
  print("ok, \(rows) rows")
} else {
  for w in wrong { print("FALSCH: \(w)") }
  exit(1)
}
SWIFT
swiftc -O -o "$ARBEIT/guard" "$PLUGIN/ios/Sources/NetGuard.swift" "$PLUGIN/ios/Sources/WifiRule.swift" "$PLUGIN/ios/Sources/StartTheme.swift" "$PLUGIN/ios/Sources/ImportRule.swift" "$PLUGIN/ios/Sources/ContentGuardRule.swift" "$PLUGIN/ios/Sources/FreshInstallRule.swift" "$PLUGIN/ios/Sources/AppleSignInRule.swift" "$PLUGIN/ios/Sources/IapRule.swift" "$PLUGIN/ios/Sources/WebAuthRule.swift" "$PLUGIN/ios/Sources/DocumentPickRule.swift" "$PLUGIN/ios/Sources/NativeLogRule.swift" "$PLUGIN/ios/Sources/RemoteNoteRule.swift" "$ARBEIT/main.swift"
"$ARBEIT/guard" "$TABELLE"

# Der Stellvertreter vor wrys Delegate (ContentProxy.swift) haengt nur an WebKit und
# laeuft hier gegen eine echte Webansicht des Macs: alles geht an das Delegate dahinter
# weiter, das Ende des Inhaltsprozesses kommt an, und danach laedt die Seite wieder.
echo "== Swift, Webansicht (Ende des Inhaltsprozesses)"
mkdir -p "$ARBEIT/webansicht"
cat > "$ARBEIT/webansicht/main.swift" <<'SWIFT'
import Foundation
import WebKit
import AppKit

// A real web view on the Mac: the delegate in front passes everything on,
// and the end of the content process arrives.
final class Inner: NSObject, WKNavigationDelegate {
  var finished = 0
  var decided = 0
  var ended = 0
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finished += 1 }
  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    decided += 1
    decisionHandler(.allow)
  }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { ended += 1 }
}

var wrong: [String] = []
func spin(_ seconds: TimeInterval, until done: () -> Bool) {
  let end = Date().addingTimeInterval(seconds)
  while !done() && Date() < end { RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.02)) }
}

_ = NSApplication.shared
let inner = Inner()
let proxy = ContentProxy()
let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 200, height: 200))
view.navigationDelegate = inner
proxy.adopt(view)
proxy.adopt(view)
if proxy.inner !== inner { wrong.append("proxy: adopting twice lost the delegate behind it") }
if view.navigationDelegate !== proxy { wrong.append("proxy: is not the delegate of the web view") }
// What it answers to is what the delegate behind it answers to, plus the one call.
if !proxy.responds(to: #selector(WKNavigationDelegate.webView(_:didFinish:))) { wrong.append("proxy: hides didFinish") }
if proxy.responds(to: #selector(WKNavigationDelegate.webView(_:didCommit:))) { wrong.append("proxy: claims a call the delegate behind it does not take") }
if !proxy.responds(to: #selector(WKNavigationDelegate.webViewWebContentProcessDidTerminate(_:))) { wrong.append("proxy: does not take the end of the process") }

var endedFor = 0
proxy.onProcessEnded = { _ in endedFor += 1 }
view.loadHTMLString("<html><body><p id='a'>first</p></body></html>", baseURL: URL(string: "https://lu.test/"))
spin(15) { inner.finished >= 1 }
if inner.finished != 1 { wrong.append("proxy: didFinish did not reach the delegate behind it (\(inner.finished))") }
if inner.decided < 1 { wrong.append("proxy: the navigation decision did not reach the delegate behind it") }

if wrong.isEmpty {
  // End the content process the way the system does, from outside the page.
  let pidKey = NSSelectorFromString("_webProcessIdentifier")
  let pid = view.responds(to: pidKey) ? (view.value(forKey: "_webProcessIdentifier") as? Int32 ?? 0) : 0
  if pid > 0 {
    kill(pid, SIGKILL)
    spin(15) { endedFor >= 1 }
    if endedFor != 1 { wrong.append("proxy: the end of the process was not reported (\(endedFor))") }
    if inner.ended != 1 { wrong.append("proxy: the delegate behind it was not told about the end of the process") }
    // The probe of the guard: a dead page gives an error or an empty address, never the address of the app.
    var probe: ContentGuardRule.Probe?
    view.evaluateJavaScript("location.href") { value, error in
      if let error = error as NSError? { probe = ContentGuardRule.probe(errorDomain: error.domain, errorCode: error.code) }
      else { probe = .answered(value as? String) }
    }
    spin(ContentGuardRule.probeTimeout) { probe != nil }
    let step = ContentGuardRule.afterProbe(probe ?? .timeout, attempt: 1, viewHasAddress: ContentGuardRule.isAppPage(view.url?.absoluteString))
    if step != .reload { wrong.append("guard: a page without a process is not loaded again (\(String(describing: probe)))") }
    // And loading again brings a page back that answers.
    let before = inner.finished
    view.loadHTMLString("<html><body><p id='a'>second</p></body></html>", baseURL: URL(string: "https://lu.test/"))
    spin(15) { inner.finished > before }
    var text: String?
    view.evaluateJavaScript("document.getElementById('a').textContent") { value, _ in text = value as? String ?? "?" }
    spin(10) { text != nil }
    if text != "second" { wrong.append("guard: the page did not come back after loading again (\(text ?? "nil"))") }
  } else {
    print("HINWEIS: dieses WebKit nennt die Nummer seines Inhaltsprozesses nicht, das Ende des Prozesses wurde nicht nachgestellt")
  }
}
if wrong.isEmpty { print("ok") } else { for w in wrong { print("FALSCH: \(w)") }; exit(1) }
SWIFT
swiftc -O -o "$ARBEIT/webansicht/probe" "$PLUGIN/ios/Sources/ContentProxy.swift" "$PLUGIN/ios/Sources/ContentGuardRule.swift" "$ARBEIT/webansicht/main.swift"
"$ARBEIT/webansicht/probe"

# Die Regeln oben sind nur etwas wert, wenn die Dateien mit Bildschirm sie auch
# rufen. ModelImport.swift und Downloads.swift haengen an Tauri und UIKit und
# lassen sich hier nicht uebersetzen, also wird ihr Text geprueft.
echo "== Swift, Aufrufstellen"
IMPORT="$PLUGIN/ios/Sources/ModelImport.swift"
LADEN="$PLUGIN/ios/Sources/Downloads.swift"
pruefe() { # pruefe <Datei> <Muster> <Satz>
  if ! grep -q -- "$2" "$1"; then echo "FALSCH: $3"; exit 1; fi
}
pruefe "$IMPORT" 'BackupRule.exclude(target.path)' "ModelImport.swift nimmt die eingebrachte Datei nicht aus dem Backup"
pruefe "$LADEN" 'BackupRule.exclude(dest)' "Downloads.swift nimmt das geladene Modell nicht aus dem Backup"
pruefe "$IMPORT" 'ImportCancel.begin()' "ModelImport.swift setzt den Abbruch nicht am Beginn des Imports zurueck"
# Der Ausschluss muss VOR der Kopierschleife stehen (die halbe Datei), und der
# Abbruch darf nur in pick zurueckgesetzt werden, nie in copy.
awk '/static func copy\(/{c=1} c&&/BackupRule.exclude\(target.path\)/&&!e{e=NR} c&&/while true/&&!w{w=NR} END{exit !(e&&w&&e<w)}' "$IMPORT" \
  || { echo "FALSCH: der Ausschluss aus dem Backup steht nicht vor der Kopierschleife"; exit 1; }
awk '/static func copy\(/{c=1} c&&/ImportCancel.begin\(\)/{bad=1} END{exit bad}' "$IMPORT" \
  || { echo "FALSCH: copy setzt den Abbruch zurueck, ein Abbruch vor Kopierbeginn ginge verloren"; exit 1; }
WACHE="$PLUGIN/ios/Sources/ContentGuard.swift"
pruefe "$PLUGIN/ios/Sources/LuNativePlugin.swift" 'ContentGuard.shared.watch(webview)' "LuNativePlugin.swift haengt die Wache ueber die Seite nicht ein"
pruefe "$WACHE" 'proxy.adopt(webview)' "ContentGuard.swift stellt sich nicht vor wrys Delegate"
pruefe "$WACHE" 'ContentGuardRule.whenGone' "ContentGuard.swift fragt die Regel nicht, wann neu geladen wird"
pruefe "$WACHE" 'ContentGuardRule.afterProbe' "ContentGuard.swift fragt die Regel nicht nach der Antwort der Seite"
pruefe "$WACHE" 'ContentGuardRule.mayReload' "ContentGuard.swift zaehlt die Neuladungen nicht"
pruefe "$WACHE" 'UIApplication.willEnterForegroundNotification' "ContentGuard.swift fragt die Seite nicht, wenn die App nach vorn kommt"
pruefe "$WACHE" 'ContentGuardRule.saysGaveUp' "ContentGuard.swift sagt nicht, wenn es die Seite nicht mehr neu laedt"
pruefe "$WACHE" 'ContentGuardRule.gaveUpText' "ContentGuard.swift zeigt den Satz der Regel nicht"
# Die Altersantwort "under 18" uebersteht die Neuinstallation (Gegenpruefung iPhone, M1): Secrets.swift liest
# sie VOR dem Leeren, fragt die Regel und legt sie danach wieder ab.
GEHEIM="$PLUGIN/ios/Sources/Secrets.swift"
pruefe "$GEHEIM" 'rawGet(FreshInstallRule.ageAccount)' "Secrets.swift liest die Altersantwort nicht vor dem Leeren"
pruefe "$GEHEIM" 'FreshInstallRule.survives(account: FreshInstallRule.ageAccount, value: age)' "Secrets.swift fragt die Regel nicht, was die Neuinstallation uebersteht"
pruefe "$GEHEIM" 'rawSet(FreshInstallRule.ageAccount, age)' "Secrets.swift legt die Altersantwort nach dem Leeren nicht wieder ab"
awk '/static func clearIfFreshInstall/{c=1} c&&/rawGet\(FreshInstallRule.ageAccount\)/&&!r{r=NR} c&&/SecItemDelete\(query\(nil\)/&&!d{d=NR} c&&/rawSet\(FreshInstallRule.ageAccount/&&!w{w=NR} END{exit !(r&&d&&w&&r<d&&d<w)}' "$GEHEIM" \
  || { echo "FALSCH: lesen, leeren, wieder ablegen stehen in Secrets.swift nicht in dieser Reihenfolge"; exit 1; }
# "Sign in with Apple" (Runde 15): AppleSignIn.swift haengt an AuthenticationServices, UIKit und Tauri.
# Geprueft wird, dass es die Regel fragt und nichts davon selbst entscheidet.
APPLE="$PLUGIN/ios/Sources/AppleSignIn.swift"
pruefe "$PLUGIN/ios/Sources/LuNativePlugin.swift" 'AppleSignIn.start(invoke, root: manager.viewController)' "LuNativePlugin.swift ruft die Anmeldung mit Apple nicht"
pruefe "$APPLE" 'request.nonce = AppleSignInRule.hashedNonce(args.nonce)' "AppleSignIn.swift gibt Apple nicht den Hash der Nonce"
pruefe "$APPLE" 'AppleSignInRule.acceptable(args.nonce)' "AppleSignIn.swift prueft die Nonce der Seite nicht"
pruefe "$APPLE" 'request.requestedScopes = \[.email\]' "AppleSignIn.swift fragt nicht genau nach der E-Mail"
if grep -q 'fullName\|givenName\|familyName' "$APPLE" "$PLUGIN/ios/Sources/AppleSignInRule.swift"; then echo "FALSCH: die Anmeldung mit Apple fasst einen Namen an, gefragt wird nur nach der E-Mail"; exit 1; fi
pruefe "$APPLE" 'AppleSignInRule.outcome(domain: problem.domain, code: problem.code)' "AppleSignIn.swift fragt die Regel nicht, was ein Fehler bedeutet"
pruefe "$APPLE" '"cancelled": true' "AppleSignIn.swift meldet den Abbruch nicht als Antwort"
if grep -q 'UserDefaults\|Secrets\.\|SecItem' "$APPLE"; then echo "FALSCH: AppleSignIn.swift bewahrt etwas auf, das Token gehoert nur in die Antwort"; exit 1; fi
# In-App-Kauf von Guthaben (Runde 17): Iap.swift haengt an StoreKit und Tauri und wird hier nicht uebersetzt.
# Geprueft wird, dass es die Regel fragt, dass ein Kauf sich nicht selbst beendet, und dass nichts davon beim Start laeuft.
KAUF="$PLUGIN/ios/Sources/Iap.swift"
STECKER="$PLUGIN/ios/Sources/LuNativePlugin.swift"
for befehl in products purchase unfinished finish; do
  pruefe "$STECKER" "iap().$befehl(invoke)" "LuNativePlugin.swift ruft Iap.$befehl nicht"
done
pruefe "$KAUF" 'IapRule.productIds(args.ids)' "Iap.swift prueft die Produktkennungen der Seite nicht"
pruefe "$KAUF" 'IapRule.accountToken(args.accountToken)' "Iap.swift prueft die Kennung des Kontos nicht"
pruefe "$KAUF" 'purchase(options: \[.appAccountToken(account)\])' "Iap.swift bindet den Kauf nicht an das Konto"
pruefe "$KAUF" 'IapRule.answer(sheet)' "Iap.swift fragt die Regel nicht, was ein Kauf antwortet"
pruefe "$KAUF" 'IapRule.handling(verified: verified, revoked: transaction.revocationDate != nil, consumable: transaction.productType == .consumable)' "Iap.swift fragt die Regel nicht, was mit einer gemeldeten Transaktion geschieht"
pruefe "$KAUF" 'IapRule.transactionId(args.transactionId)' "Iap.swift prueft die Kennung der Transaktion nicht"
pruefe "$KAUF" 'verification.jwsRepresentation' "Iap.swift gibt die signierte Transaktion des Kaufs nicht weiter"
pruefe "$KAUF" '"accountToken": transaction.appAccountToken?.uuidString.lowercased()' "Iap.swift sagt der Seite nicht, fuer welches Konto ein offener Kauf gemacht wurde"
pruefe "$KAUF" '"displayPrice": product.displayPrice' "Iap.swift gibt den Preistext des Stores nicht weiter"
pruefe "$KAUF" 'for await result in Transaction.updates' "Iap.swift lauscht nicht auf Transaction.updates"
pruefe "$KAUF" 'for await result in Transaction.unfinished' "Iap.swift fragt nicht nach den offenen Kaeufen"
# Beendet wird an genau zwei Stellen: auf Wunsch der Seite (finish) und still bei einer zurueckgenommenen Transaktion (sort).
# Der Kauf selbst (buy) beendet nie: sonst waere ein Kauf ohne Gutschrift fuer immer verloren.
ENDEN=$(grep -c '\.finish()' "$KAUF")
if [ "$ENDEN" != "2" ]; then echo "FALSCH: Iap.swift beendet an $ENDEN Stellen, erlaubt sind genau zwei (finish und sort)"; exit 1; fi
if awk '/private func buy\(/{c=1} /func unfinished\(/{c=0} c' "$KAUF" | grep -q 'finish()'; then echo "FALSCH: der Kauf beendet sich in Iap.swift selbst, vor der Gutschrift"; exit 1; fi
if ! awk '/private func buy\(/{c=1} /func unfinished\(/{c=0} c' "$KAUF" | grep -q 'jwsRepresentation'; then echo "FALSCH: die Pruefung des Kaufs in Iap.swift hat den Kauf nicht gefunden"; exit 1; fi
if ! awk '/private func sort\(/{c=1} /private static func failure\(/{c=0} c' "$KAUF" | grep -q 'case .finishQuietly:'; then echo "FALSCH: das stille Beenden in Iap.swift haengt nicht an der Regel"; exit 1; fi
if ! awk '/func finish\(_ invoke/{c=1} c' "$KAUF" | grep -q 'transaction.id == wanted'; then echo "FALSCH: finish in Iap.swift beendet nicht genau die genannte Transaktion"; exit 1; fi
# Kein eigener Preis: nur der fertige Text des Stores. Nichts wird aufbewahrt.
if grep -q '\.price\b\|priceFormatStyle\|UserDefaults\|Secrets\.\|SecItem' "$KAUF"; then echo "FALSCH: Iap.swift rechnet mit einem Preis oder bewahrt etwas auf"; exit 1; fi
# Nichts fragt den Store, bevor die Seite einen der vier Befehle ruft: der Start des Plugins fasst Iap nicht an.
if awk '/override init\(\)/{c=1} /public override func load\(/{c=0} c' "$STECKER" | grep -q 'Iap\|iap()'; then echo "FALSCH: LuNativePlugin.swift fasst den Kauf schon beim Start an"; exit 1; fi
if [ "$(grep -c 'listen()' "$KAUF")" != "4" ]; then echo "FALSCH: der Lauscher in Iap.swift startet nicht genau mit den drei Befehlen products, purchase und unfinished"; exit 1; fi
# Anmeldung mit Google und GitHub im Blatt des Systems (Runde 22, N5): WebAuth.swift haengt an
# AuthenticationServices, UIKit und Tauri. Geprueft wird, dass es die Regel fragt und nichts selbst entscheidet.
BLATT="$PLUGIN/ios/Sources/WebAuth.swift"
pruefe "$STECKER" 'WebAuth.start(invoke, root: manager.viewController)' "LuNativePlugin.swift ruft das Anmeldeblatt nicht"
pruefe "$BLATT" 'WebAuthRule.page(args.url)' "WebAuth.swift prueft die Seite nicht"
pruefe "$BLATT" 'WebAuthRule.scheme(args.callbackScheme)' "WebAuth.swift prueft das Schema der Rueckkehr nicht"
pruefe "$BLATT" 'ASWebAuthenticationSession(url: page, callbackURLScheme: scheme)' "WebAuth.swift oeffnet nicht das Anmeldeblatt des Systems"
pruefe "$BLATT" 'session.presentationContextProvider = me' "WebAuth.swift nennt dem Blatt kein Fenster"
pruefe "$BLATT" 'session.prefersEphemeralWebBrowserSession = WebAuthRule.ephemeral' "WebAuth.swift fragt die Regel nicht, ob das Blatt die Anmeldung von Safari teilt"
pruefe "$BLATT" 'if !session.start()' "WebAuth.swift merkt nicht, wenn das Blatt nicht aufgeht"
pruefe "$BLATT" 'WebAuthRule.outcome(domain: problem.domain, code: problem.code)' "WebAuth.swift fragt die Regel nicht, was ein Fehler bedeutet"
pruefe "$BLATT" 'WebAuthRule.isCallback(back, scheme: scheme)' "WebAuth.swift prueft die Rueckkehr-Adresse nicht"
pruefe "$BLATT" '"cancelled": true' "WebAuth.swift meldet den Abbruch nicht als Antwort"
if grep -q 'UserDefaults\|Secrets\.\|SecItem\|NSLog\|print(\|os_log\|Logger' "$BLATT"; then echo "FALSCH: WebAuth.swift bewahrt die Rueckkehr-Adresse auf oder schreibt sie ins Log"; exit 1; fi
if grep -q 'UIApplication.shared.open' "$BLATT"; then echo "FALSCH: WebAuth.swift verlaesst die App, das Blatt bleibt in der App"; exit 1; fi
# "File" oeffnet die Dateien-App selbst (Runde 22, N2): DocumentPick.swift haengt an UIKit und Tauri.
WAEHLER="$PLUGIN/ios/Sources/DocumentPick.swift"
pruefe "$STECKER" 'DocumentPick.pick(invoke, root: manager.viewController)' "LuNativePlugin.swift ruft den Dateiwaehler nicht"
pruefe "$WAEHLER" 'UIDocumentPickerViewController(forOpeningContentTypes: \[.item\], asCopy: true)' "DocumentPick.swift oeffnet nicht den Dateiwaehler des Systems fuer alle Dateien als Kopie"
pruefe "$WAEHLER" 'DocumentPickRule.limit(args.maxFiles)' "DocumentPick.swift fragt die Regel nicht, wie viele Dateien kommen"
pruefe "$WAEHLER" 'DocumentPickRule.taken(urls, limit: limit)' "DocumentPick.swift nimmt mehr Dateien als erlaubt"
pruefe "$WAEHLER" 'DocumentPickRule.target(dir: dir, folder: UUID().uuidString.lowercased(), pathExtension: url.pathExtension)' "DocumentPick.swift fragt die Regel nicht, wohin eine Datei kommt"
pruefe "$WAEHLER" 'DocumentPickRule.displayName(url.lastPathComponent)' "DocumentPick.swift gibt den Namen nicht ueber die Regel weiter"
if grep -q 'PHPicker\|UIImagePickerController\|\.image\b\|\.movie\b' "$WAEHLER"; then echo "FALSCH: DocumentPick.swift fasst die Fotomediathek an, es ist der Waehler fuer Dateien"; exit 1; fi
# Das Log der nativen Schicht liegt nicht im Ordner, den die Dateien-App zeigt (Runde 22, N6).
pruefe "$STECKER" 'NativeLogRule.file(caches: manager.urls(for: .cachesDirectory, in: .userDomainMask)\[0\])' "LuNativePlugin.swift schreibt sein Log nicht in den Cache-Ordner"
pruefe "$STECKER" 'NativeLogRule.oldFile(documents: visible)' "LuNativePlugin.swift raeumt das alte Log im sichtbaren Ordner nicht weg"
if grep -n 'documentDirectory' "$STECKER" | grep -v 'if let visible = manager.urls(for: .documentDirectory' | grep -q .; then echo "FALSCH: LuNativePlugin.swift schreibt in den Dokumente-Ordner, den die Dateien-App zeigt"; exit 1; fi
if grep -q 'appendingPathComponent("lu-native.log")' "$STECKER"; then echo "FALSCH: der Ort des Logs gehoert in NativeLogRule.swift"; exit 1; fi
if grep -q 'isExcludedFromBackup' "$IMPORT" "$LADEN"; then echo "FALSCH: der Ausschluss gehoert in ImportRule.swift, nicht daneben"; exit 1; fi
echo "ok"

if [ "${1:-}" = "kotlin" ]; then
  echo "== Kotlin"
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  ERGEBNISSE="$PLUGIN/android/build/test-results/testDebugUnitTest"
  (cd "$WURZEL/src-tauri/gen/android" && ./gradlew --quiet :tauri-plugin-lu-native:testDebugUnitTest)
  # Zaehlen, was wirklich lief: ein gruenes Gradle ohne Tests waere kein Beleg.
  ANZAHL=$(grep -ho 'tests="[0-9]*"' "$ERGEBNISSE"/*.xml | tr -dc '0-9\n' | paste -sd+ - | bc)
  FEHLER=$(grep -ho 'failures="[0-9]*"\|errors="[0-9]*"' "$ERGEBNISSE"/*.xml | tr -dc '0-9\n' | paste -sd+ - | bc)
  echo "ok, $ANZAHL Tests, $FEHLER Fehler"
  [ "$ANZAHL" -gt 0 ] && [ "$FEHLER" -eq 0 ]
  # Der HTML-Bericht von Gradle enthaelt JavaScript. Bleibt er liegen, lintet
  # eslint ihn mit und der Waechter das-gate-bleibt-scharf wird rot.
  rm -rf "$PLUGIN/android/build/reports"
fi
