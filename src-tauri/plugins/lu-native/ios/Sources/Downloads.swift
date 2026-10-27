import CryptoKit
import Foundation
import Network
import UIKit

// Background downloads on iOS.
//
// The transfer belongs to the system: a URLSession with a background
// configuration hands it to a daemon that keeps going while the app is
// suspended or has been ended by the system, and that starts the app again
// in the background when a transfer is finished. The app's part is the
// bookkeeping around it:
//
//   * a list of downloads in a file, so the list survives the process,
//   * resume data kept in a file for Pause and for errors,
//   * the check at the end (HTTP status, size, SHA-256) and the rename of
//     `<name>.download` into place.
//
// States and transitions are the table in src/download.rs (`next_state`).
// The one rule repeated here because it is the easy one to break: a callback
// that arrives late never revives a download the user stopped.

struct DownloadRecord: Codable {
  var id: String
  var url: String
  /// Relative to the app's home folder when it lies inside. The absolute
  /// path of the container changes with every update of the app.
  var dest: String
  var partial: String
  var state: String
  var receivedBytes: Int64 = 0
  var totalBytes: Int64 = 0
  var expectedBytes: Int64 = 0
  var expectedBytesExact: Bool = false
  var sha256: String?
  /// The request headers. They can carry the user's Hugging Face token, so
  /// they never go to disk as they are: `encode` writes them sealed
  /// (Seal.swift) under `headersSealed`, and writes nothing when they cannot
  /// be sealed.
  var headers: [String: String] = [:]
  /// Sealed headers that could not be opened when the list was read (the
  /// Keychain was not available yet). Written back as they are and opened
  /// when the headers are needed.
  var unopenedSeal: String?
  /// True when this line was read from a file of before the sealing, with
  /// the headers in plain text. The list is rewritten at once then.
  var hadPlainHeaders = false
  /// The rule of an acceptance build: test servers on private addresses may
  /// be reached. Set by Rust from the build.
  var allowLocal: Bool = false
  /// "Download on Wi-Fi only": this line has no task right now, because the
  /// phone is on mobile data. It is launched again when Wi-Fi is back.
  var heldForWifi: Bool = false
  /// The request of the running or stopped task may use mobile data. Resume
  /// data carries the original request, so this stays what it was at launch.
  var cellularAtLaunch: Bool = true
  var error: String?
  var errorCode: String?
  var resumable: Bool = false
  var createdAt: Int64 = 0
  var updatedAt: Int64 = 0
  var bytesPerSecond: Double = 0
  var lastProgressAt: Int64 = 0

  init(id: String, url: String, dest: String, partial: String, state: String) {
    self.id = id
    self.url = url
    self.dest = dest
    self.partial = partial
    self.state = state
  }

  enum CodingKeys: String, CodingKey {
    case id, url, dest, partial, state, receivedBytes, totalBytes, expectedBytes, expectedBytesExact, sha256
    case headers, headersSealed, allowLocal, heldForWifi, cellularAtLaunch
    case error, errorCode, resumable, createdAt, updatedAt, bytesPerSecond, lastProgressAt
  }

  static func sealName(_ id: String) -> String { "bg-download-headers:" + id }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    url = try c.decode(String.self, forKey: .url)
    dest = try c.decode(String.self, forKey: .dest)
    partial = try c.decode(String.self, forKey: .partial)
    state = try c.decode(String.self, forKey: .state)
    receivedBytes = try c.decodeIfPresent(Int64.self, forKey: .receivedBytes) ?? 0
    totalBytes = try c.decodeIfPresent(Int64.self, forKey: .totalBytes) ?? 0
    expectedBytes = try c.decodeIfPresent(Int64.self, forKey: .expectedBytes) ?? 0
    expectedBytesExact = try c.decodeIfPresent(Bool.self, forKey: .expectedBytesExact) ?? false
    sha256 = try c.decodeIfPresent(String.self, forKey: .sha256)
    allowLocal = try c.decodeIfPresent(Bool.self, forKey: .allowLocal) ?? false
    heldForWifi = try c.decodeIfPresent(Bool.self, forKey: .heldForWifi) ?? false
    cellularAtLaunch = try c.decodeIfPresent(Bool.self, forKey: .cellularAtLaunch) ?? true
    error = try c.decodeIfPresent(String.self, forKey: .error)
    errorCode = try c.decodeIfPresent(String.self, forKey: .errorCode)
    resumable = try c.decodeIfPresent(Bool.self, forKey: .resumable) ?? false
    createdAt = try c.decodeIfPresent(Int64.self, forKey: .createdAt) ?? 0
    updatedAt = try c.decodeIfPresent(Int64.self, forKey: .updatedAt) ?? 0
    bytesPerSecond = try c.decodeIfPresent(Double.self, forKey: .bytesPerSecond) ?? 0
    lastProgressAt = try c.decodeIfPresent(Int64.self, forKey: .lastProgressAt) ?? 0
    if let sealed = try c.decodeIfPresent(String.self, forKey: .headersSealed) {
      unopenedSeal = sealed
      openHeaders()
    } else if let plain = try? c.decodeIfPresent([String: String].self, forKey: .headers), !plain.isEmpty {
      // A list from before the sealing. Taken over once.
      headers = plain
      hadPlainHeaders = true
    }
  }

  /// Open the sealed headers, if there are any waiting and the Keychain can
  /// be asked now.
  mutating func openHeaders() {
    guard headers.isEmpty, let sealed = unopenedSeal,
      let text = Seal.openText(sealed, name: DownloadRecord.sealName(id)),
      let map = try? JSONDecoder().decode([String: String].self, from: Data(text.utf8))
    else { return }
    headers = map
    unopenedSeal = nil
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(url, forKey: .url)
    try c.encode(dest, forKey: .dest)
    try c.encode(partial, forKey: .partial)
    try c.encode(state, forKey: .state)
    try c.encode(receivedBytes, forKey: .receivedBytes)
    try c.encode(totalBytes, forKey: .totalBytes)
    try c.encode(expectedBytes, forKey: .expectedBytes)
    try c.encode(expectedBytesExact, forKey: .expectedBytesExact)
    try c.encodeIfPresent(sha256, forKey: .sha256)
    if allowLocal { try c.encode(true, forKey: .allowLocal) }
    if heldForWifi { try c.encode(true, forKey: .heldForWifi) }
    if !cellularAtLaunch { try c.encode(false, forKey: .cellularAtLaunch) }
    try c.encodeIfPresent(error, forKey: .error)
    try c.encodeIfPresent(errorCode, forKey: .errorCode)
    try c.encode(resumable, forKey: .resumable)
    try c.encode(createdAt, forKey: .createdAt)
    try c.encode(updatedAt, forKey: .updatedAt)
    try c.encode(bytesPerSecond, forKey: .bytesPerSecond)
    try c.encode(lastProgressAt, forKey: .lastProgressAt)
    // The key `headers` is never written. Sealed or not at all.
    if !headers.isEmpty, let plain = try? JSONEncoder().encode(headers), let text = String(data: plain, encoding: .utf8),
      let sealed = Seal.sealText(text, name: DownloadRecord.sealName(id)) {
      try c.encode(sealed, forKey: .headersSealed)
    } else if headers.isEmpty, let waiting = unopenedSeal {
      try c.encode(waiting, forKey: .headersSealed)
    }
  }
}

/// One UIKit background task. Only touched on the main queue.
final class BackgroundHold {
  private var token = UIBackgroundTaskIdentifier.invalid

  func begin(_ name: String) {
    token = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in self?.end() }
  }

  func end() {
    if token != .invalid {
      UIApplication.shared.endBackgroundTask(token)
      token = .invalid
    }
  }
}

final class Downloads: NSObject, URLSessionDownloadDelegate {
  static let shared = Downloads()

  /// Serial. Every read and write of `records` happens here, and the
  /// session delivers its callbacks here too.
  let queue = DispatchQueue(label: "lu-native.downloads")
  private var records: [String: DownloadRecord] = [:]
  private var session: URLSession!
  private var started = false
  private var lastEmit: [String: Int64] = [:]
  private var lastSave: Int64 = 0
  private var lastSample: [String: (at: Int64, bytes: Int64)] = [:]
  private let monitor = NWPathMonitor()
  private var online = true
  /// The path is mobile data and nothing better.
  private var onCellular = false
  /// What the last path was, for `connectionInfo`.
  private var pathKind = "other"
  private var pathExpensive = false
  /// Set by the app delegate hook, called when the session has delivered
  /// everything it had. Tells iOS the app is done and may sleep again.
  var backgroundCompletion: [String: () -> Void] = [:]
  var emit: (String, [String: Any?]) -> Void = { _, _ in }
  var log: (String) -> Void = { _ in }

  static var sessionIdentifier: String {
    return (Bundle.main.bundleIdentifier ?? "lu") + ".lu-native.downloads"
  }

  // ── files ─────────────────────────────────────────────────────────────

  private static var folder: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let folder = base.appendingPathComponent("lu-native", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
  }

  private static var listFile: URL { folder.appendingPathComponent("bg-downloads.json") }

  private static func resumeFile(_ id: String) -> URL {
    let digest = SHA256.hash(data: Data(id.utf8)).map { String(format: "%02x", $0) }.joined()
    return folder.appendingPathComponent("resume-\(digest.prefix(24)).data")
  }

  static func relative(_ path: String) -> String {
    let home = NSHomeDirectory()
    if path.hasPrefix(home + "/") {
      return "~" + path.dropFirst(home.count)
    }
    return path
  }

  static func absolute(_ path: String) -> String {
    if path.hasPrefix("~/") {
      return NSHomeDirectory() + path.dropFirst(1)
    }
    return path
  }

  private func load() {
    guard let data = try? Data(contentsOf: Downloads.listFile),
      let list = try? JSONDecoder().decode([DownloadRecord].self, from: data)
    else { return }
    records = Dictionary(list.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
    if list.contains(where: { $0.hadPlainHeaders }) {
      // The file still has headers in plain text. Rewrite it now, sealed.
      for id in records.keys { records[id]?.hadPlainHeaders = false }
      save()
      log("download list rewritten with sealed headers")
    }
  }

  // ── resume data ───────────────────────────────────────────────────────
  //
  // What iOS hands out for a stopped transfer contains the whole original
  // request, the Authorization header included. It is kept sealed, like the
  // headers of the list.

  private static func resumeName(_ id: String) -> String { "bg-download-resume:" + id }

  /// False when the data could not be sealed. Nothing is written then.
  @discardableResult
  private func writeResumeData(_ data: Data, id: String) -> Bool {
    let file = Downloads.resumeFile(id)
    guard let sealed = Seal.seal(data, name: Downloads.resumeName(id)) else {
      try? FileManager.default.removeItem(at: file)
      log("resume data of \(id) could not be sealed and is not kept")
      return false
    }
    do {
      try sealed.write(to: file, options: .atomic)
      return true
    } catch {
      return false
    }
  }

  /// Reads and removes. A file from before the sealing is used once as it is.
  private func takeResumeData(id: String) -> Data? {
    let file = Downloads.resumeFile(id)
    guard let stored = try? Data(contentsOf: file) else { return nil }
    try? FileManager.default.removeItem(at: file)
    if Seal.isSealed(stored) {
      return Seal.open(stored, name: Downloads.resumeName(id))
    }
    return stored
  }

  // ── where the bytes really come from ──────────────────────────────────

  /// Tasks whose answering address has been looked at.
  private var checkedTasks: Set<Int> = []

  /// A background session follows redirects without asking. So the address
  /// that finally answers is checked here, as soon as the task has a
  /// response. False when the transfer was thrown away because of it.
  private func answeringAddressAllowed(_ task: URLSessionTask, id: String) -> Bool {
    if checkedTasks.contains(task.taskIdentifier) { return true }
    guard let answered = task.response?.url ?? task.currentRequest?.url else { return true }
    guard var record = records[id] else { return true }
    if NetGuard.refuse(answered.absoluteString, allowLocal: record.allowLocal) == nil {
      checkedTasks.insert(task.taskIdentifier)
      return true
    }
    // State first, then the cancel: what the task still reports is late.
    record.state = "error"
    record.errorCode = "blocked"
    record.error = NetGuard.redirectRefused
    record.resumable = false
    record.bytesPerSecond = 0
    record.updatedAt = Downloads.now()
    records[id] = record
    save()
    task.cancel()
    try? FileManager.default.removeItem(at: Downloads.resumeFile(id))
    try? FileManager.default.removeItem(atPath: Downloads.absolute(record.partial))
    log("download refused id=\(id): redirected to \(answered.host ?? "?")")
    emitError(record)
    return false
  }

  private func save(force: Bool = true) {
    let now = Downloads.now()
    if !force && now - lastSave < 2000 { return }
    lastSave = now
    guard let data = try? JSONEncoder().encode(Array(records.values)) else { return }
    try? data.write(to: Downloads.listFile, options: .atomic)
  }

  static func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  /// The app's own User-Agent, unless the caller set one.
  static func withUserAgent(_ headers: [String: String], _ userAgent: String?) -> [String: String] {
    guard let userAgent = userAgent, !userAgent.isEmpty else { return headers }
    if headers.keys.contains(where: { $0.lowercased() == "user-agent" }) { return headers }
    var out = headers
    out["User-Agent"] = userAgent
    return out
  }

  // ── start of the process ──────────────────────────────────────────────

  /// Create the session again under the same identifier. Only then does iOS
  /// deliver what finished while the app was not running. Called as soon as
  /// the event channel to Rust exists.
  func start() {
    queue.async {
      if self.started { return }
      self.started = true
      self.load()
      let config = URLSessionConfiguration.background(withIdentifier: Downloads.sessionIdentifier)
      config.sessionSendsLaunchEvents = true
      config.isDiscretionary = false
      config.allowsCellularAccess = true
      config.timeoutIntervalForResource = 7 * 24 * 60 * 60
      let callbacks = OperationQueue()
      callbacks.maxConcurrentOperationCount = 1
      callbacks.underlyingQueue = self.queue
      self.session = URLSession(configuration: config, delegate: self, delegateQueue: callbacks)
      self.monitor.pathUpdateHandler = { [weak self] path in
        self?.queue.async {
          guard let self = self else { return }
          let satisfied = path.status == .satisfied
          let wifi = path.usesInterfaceType(.wifi)
          let wired = path.usesInterfaceType(.wiredEthernet)
          let cellular = path.usesInterfaceType(.cellular)
          self.pathKind = WifiRule.kind(satisfied: satisfied, wifi: wifi, wired: wired, cellular: cellular)
          self.pathExpensive = path.isExpensive
          self.onCellular = WifiRule.onCellular(satisfied: satisfied, wifi: wifi, wired: wired, cellular: cellular)
          self.networkChanged(satisfied)
          self.applyWifiRule()
        }
      }
      self.monitor.start(queue: self.queue)
      self.session.getAllTasks { tasks in
        // Already on `queue`.
        self.reconcile(tasks)
      }
    }
  }

  /// Bring the list in line with what the system really has.
  private func reconcile(_ tasks: [URLSessionTask]) {
    let alive = Set(tasks.filter { $0.state == .running || $0.state == .suspended }.compactMap { $0.taskDescription })
    for (id, var record) in records {
      switch record.state {
      case "verifying":
        // The app went away between the last byte and the check.
        finishVerification(id)
      case "queued", "running", "waiting":
        if alive.contains(id) { continue }
        // Held until Wi-Fi is back: no task on purpose. The first report of
        // the network path launches it again or leaves it waiting.
        if record.heldForWifi { continue }
        let dest = Downloads.absolute(record.dest)
        let partial = Downloads.absolute(record.partial)
        if FileManager.default.fileExists(atPath: partial) {
          record.state = "verifying"
          records[id] = record
          finishVerification(id)
        } else if !FileManager.default.fileExists(atPath: dest) {
          // No task, no file. The callbacks that explain it may still be
          // on their way (they are delivered right after this), so give
          // them a moment before calling it an error.
          queue.asyncAfter(deadline: .now() + 3) { self.markVanished(id) }
        }
      default:
        break
      }
    }
    save()
    log("downloads reconciled records=\(records.count) tasks=\(tasks.count)")
  }

  private func markVanished(_ id: String) {
    guard var record = records[id], ["queued", "running", "waiting"].contains(record.state) else { return }
    session.getAllTasks { tasks in
      if tasks.contains(where: { $0.taskDescription == id && ($0.state == .running || $0.state == .suspended) }) { return }
      guard let current = self.records[id], ["queued", "running", "waiting"].contains(current.state) else { return }
      record = current
      record.state = "error"
      record.errorCode = "interrupted"
      record.error = "This download was interrupted. Start it again to continue."
      record.resumable = FileManager.default.fileExists(atPath: Downloads.resumeFile(id).path)
      record.updatedAt = Downloads.now()
      self.records[id] = record
      self.save()
      self.emitError(record)
    }
  }

  private func networkChanged(_ nowOnline: Bool) {
    if nowOnline == online { return }
    online = nowOnline
    for (id, var record) in records where record.state == "running" || record.state == "queued" || record.state == "waiting" {
      // Offline: running becomes waiting. Online again: the system
      // continues by itself, the first bytes turn it back into running.
      if !nowOnline && record.state != "waiting" {
        record.state = "waiting"
        record.bytesPerSecond = 0
        record.updatedAt = Downloads.now()
        records[id] = record
        emitProgress(record, force: true)
      }
    }
    save()
  }

  // ── "Download on Wi-Fi only" ──────────────────────────────────────────
  //
  // The switch and the downloads the user allowed on mobile data by name
  // live in UserDefaults: the rule has to hold after a restart, before the
  // page has loaded. Three things keep it:
  //
  //   * a fresh request under the rule is created with
  //     `allowsCellularAccess = false`. The system then waits for Wi-Fi by
  //     itself, also while the app is suspended or not running.
  //   * a continue from resume data carries its ORIGINAL request. If that
  //     one allowed mobile data, the line is held without a task while the
  //     phone is on mobile data and launched when Wi-Fi is back.
  //   * while the app runs, a task whose request allows mobile data is
  //     stopped (resume data kept) the moment the phone leaves the Wi-Fi.
  //
  // What is left open: a download started BEFORE the switch was turned on
  // can go on over mobile data while the app is suspended, because iOS
  // cannot change the request of a task it already has.

  private static let wifiOnlyKey = "lu-native.downloads.wifiOnly"
  private static let meteredOkKey = "lu-native.downloads.meteredOk"

  private var wifiOnly: Bool { UserDefaults.standard.bool(forKey: Downloads.wifiOnlyKey) }
  private var meteredOk: Set<String> {
    Set(UserDefaults.standard.stringArray(forKey: Downloads.meteredOkKey) ?? [])
  }

  /// The rule applies to this download.
  private func ruled(_ id: String) -> Bool {
    return WifiRule.applies(wifiOnly: wifiOnly, allowedOnMobileData: meteredOk.contains(id))
  }

  func setWifiOnly(_ on: Bool) {
    queue.async {
      UserDefaults.standard.set(on, forKey: Downloads.wifiOnlyKey)
      self.applyWifiRule()
    }
  }

  func allowMetered(_ id: String, _ allow: Bool) {
    queue.sync {
      var set = self.meteredOk
      if allow { set.insert(id) } else { set.remove(id) }
      UserDefaults.standard.set(Array(set), forKey: Downloads.meteredOkKey)
      if self.started { self.applyWifiRule() }
    }
  }

  private func dropMeteredOk(_ id: String) {
    var set = meteredOk
    if set.remove(id) != nil {
      UserDefaults.standard.set(Array(set), forKey: Downloads.meteredOkKey)
    }
  }

  func connectionInfo() -> [String: Any] {
    return queue.sync { ["kind": pathKind, "metered": pathExpensive, "wifiOnly": wifiOnly] }
  }

  /// Bring every line in step with the rule and the network that is there.
  /// On `queue`. Safe to call as often as wanted.
  private func applyWifiRule() {
    guard started, session != nil else { return }
    for (id, record) in records {
      switch WifiRule.step(ruled: ruled(id), onCellular: onCellular, online: online, held: record.heldForWifi,
                           cellularAtLaunch: record.cellularAtLaunch, state: record.state) {
      case .release: releaseHeld(id)
      case .hold: hold(id)
      case .nothing: break
      }
    }
  }

  /// Stop the task and keep its bytes, until Wi-Fi is back.
  private func hold(_ id: String) {
    guard var record = records[id] else { return }
    record.heldForWifi = true
    record.state = "waiting"
    record.bytesPerSecond = 0
    record.updatedAt = Downloads.now()
    records[id] = record
    save()
    emitProgress(record, force: true)
    task(for: id) { task in
      guard let task = task else { return }
      task.cancel(byProducingResumeData: { data in
        self.queue.async {
          var kept = false
          if let data = data { kept = self.writeResumeData(data, id: id) }
          if var current = self.records[id], current.heldForWifi {
            current.resumable = kept
            self.records[id] = current
            self.save()
          }
          self.log("download held for Wi-Fi id=\(id) resumeData=\(kept)")
        }
      })
    }
  }

  private func releaseHeld(_ id: String) {
    guard var record = records[id], record.heldForWifi else { return }
    record.heldForWifi = false
    guard ["queued", "running", "waiting"].contains(record.state), let url = URL(string: record.url) else {
      records[id] = record
      save()
      return
    }
    let data = takeResumeData(id: id)
    record.openHeaders()
    if data == nil {
      record.receivedBytes = 0
      record.cellularAtLaunch = !ruled(id)
    }
    record.state = "queued"
    record.updatedAt = Downloads.now()
    record.lastProgressAt = record.updatedAt
    records[id] = record
    save()
    launch(record, request: request(url, record.headers, id: id), resumeData: data)
    emitProgress(record, force: true)
    log("download released from Wi-Fi hold id=\(id) resume=\(data != nil)")
  }

  // ── commands ──────────────────────────────────────────────────────────

  func list() -> [[String: Any?]] {
    return queue.sync {
      records.values.sorted { $0.createdAt < $1.createdAt }.map { self.json($0) }
    }
  }

  private func json(_ r: DownloadRecord) -> [String: Any?] {
    var state = r.state
    // The system does not say when a transfer stalls because the server
    // went away, it just keeps trying. No byte for 15 seconds reads as
    // waiting, so the interface can say so.
    if state == "running", r.lastProgressAt > 0, Downloads.now() - r.lastProgressAt > 15_000 {
      state = "waiting"
    }
    return [
      "id": r.id,
      "url": r.url,
      "dest": Downloads.absolute(r.dest),
      "state": state,
      "receivedBytes": NSNumber(value: r.receivedBytes),
      "totalBytes": NSNumber(value: r.totalBytes),
      "expectedBytes": NSNumber(value: r.expectedBytes),
      "bytesPerSecond": state == "running" ? r.bytesPerSecond : 0,
      "sha256": r.sha256,
      "error": r.error,
      "errorCode": r.errorCode,
      "resumable": r.resumable,
      "createdAt": NSNumber(value: r.createdAt),
      "updatedAt": NSNumber(value: r.updatedAt),
    ]
  }

  func startDownload(id: String, url: String, dest: String, partial: String, expectedBytes: Int64, exact: Bool,
                     sha256: String?, headers: [String: String], allowLocal: Bool = false) -> String? {
    guard let parsed = URL(string: url) else { return "That address is not valid." }
    return queue.sync {
      guard self.started else { return "The download service is not ready yet." }
      if let old = records[id], ["queued", "running", "waiting", "verifying"].contains(old.state) {
        return nil
      }
      // A new start under an id whose earlier attempt was paused or broke
      // off continues from its bytes, when it is the same address and the
      // same file and iOS handed out resume data for it. The Android side
      // does the same (DownloadEngine.start). The page starts a download by
      // path again when the user taps Resume, so without this every Resume
      // threw the resume data away and began at the first byte.
      if let old = records[id], old.state == "paused" || old.state == "error",
        old.url == url, old.dest == Downloads.relative(dest),
        let data = takeResumeData(id: id) {
        var record = old
        record.expectedBytes = expectedBytes
        record.expectedBytesExact = exact
        record.sha256 = sha256
        record.headers = headers
        record.unopenedSeal = nil
        record.allowLocal = allowLocal
        record.state = "queued"
        record.error = nil
        record.errorCode = nil
        record.updatedAt = Downloads.now()
        record.lastProgressAt = record.updatedAt
        records[id] = record
        save()
        launch(record, request: nil, resumeData: data)
        emitProgress(record, force: true)
        return nil
      }
      // A fresh start under an id that had an earlier attempt: that
      // attempt's leftovers belong to another transfer.
      try? FileManager.default.removeItem(at: Downloads.resumeFile(id))
      try? FileManager.default.removeItem(atPath: partial)
      let now = Downloads.now()
      var record = DownloadRecord(id: id, url: url, dest: Downloads.relative(dest), partial: Downloads.relative(partial), state: "queued")
      record.expectedBytes = expectedBytes
      record.expectedBytesExact = exact
      record.sha256 = sha256
      record.headers = headers
      record.allowLocal = allowLocal
      record.createdAt = now
      record.updatedAt = now
      record.lastProgressAt = now
      // Under "Download on Wi-Fi only" the request itself forbids mobile
      // data. On mobile data the system then waits, and the line says so.
      record.cellularAtLaunch = !ruled(id)
      if ruled(id) && onCellular { record.state = "waiting" }
      records[id] = record
      save()
      launch(record, request: self.request(parsed, headers, id: id))
      return nil
    }
  }

  private func request(_ url: URL, _ headers: [String: String], id: String) -> URLRequest {
    var request = URLRequest(url: url)
    request.allowsCellularAccess = !ruled(id)
    // The system follows redirects of this transfer without asking. Only a
    // header it drops at a redirect by itself goes on the request, so a key
    // meant for the first host never reaches the next (NetGuard.swift).
    for (name, value) in NetGuard.headersForSystemTransfer(headers) {
      request.setValue(value, forHTTPHeaderField: name)
    }
    return request
  }

  private func launch(_ record: DownloadRecord, request: URLRequest?, resumeData: Data? = nil) {
    let task: URLSessionDownloadTask
    if let data = resumeData {
      task = session.downloadTask(withResumeData: data)
    } else if let request = request {
      task = session.downloadTask(with: request)
    } else {
      return
    }
    task.taskDescription = record.id
    if record.expectedBytes > 0 {
      task.countOfBytesClientExpectsToReceive = record.expectedBytes
    }
    task.resume()
    log("download launch id=\(record.id) task=\(task.taskIdentifier) resume=\(resumeData != nil)")
  }

  private func task(for id: String, _ body: @escaping (URLSessionDownloadTask?) -> Void) {
    session.getAllTasks { tasks in
      body(tasks.first { $0.taskDescription == id && ($0.state == .running || $0.state == .suspended) } as? URLSessionDownloadTask)
    }
  }

  func pause(_ id: String, done: @escaping (String?) -> Void) {
    queue.async {
      guard var record = self.records[id] else { return done("That download is not known.") }
      guard ["queued", "running", "waiting"].contains(record.state) else { return done(nil) }
      // State first: whatever the task still reports from here on is late.
      record.state = "paused"
      record.heldForWifi = false
      record.bytesPerSecond = 0
      record.updatedAt = Downloads.now()
      self.records[id] = record
      self.save()
      self.task(for: id) { task in
        guard let task = task else {
          self.emitProgress(record, force: true)
          return done(nil)
        }
        task.cancel(byProducingResumeData: { data in
          self.queue.async {
            var kept = false
            if let data = data {
              kept = self.writeResumeData(data, id: id)
            }
            if var current = self.records[id], current.state == "paused" {
              current.resumable = kept
              self.records[id] = current
              self.save()
              self.emitProgress(current, force: true)
            }
            done(nil)
          }
        })
      }
    }
  }

  func resume(_ id: String, done: @escaping (String?) -> Void) {
    queue.async {
      guard var record = self.records[id] else { return done("That download is not known.") }
      guard record.state == "paused" || record.state == "error" else { return done(nil) }
      guard let url = URL(string: record.url) else { return done("That address is not valid.") }
      let hasResumeData = FileManager.default.fileExists(atPath: Downloads.resumeFile(id).path)
      if self.ruled(id) && self.onCellular && hasResumeData && record.cellularAtLaunch {
        // "Download on Wi-Fi only", the phone is on mobile data, and the
        // bytes on disk belong to a request that may use mobile data: wait
        // without a task. `applyWifiRule` launches it when Wi-Fi is back.
        record.state = "waiting"
        record.heldForWifi = true
        record.error = nil
        record.errorCode = nil
        record.updatedAt = Downloads.now()
        self.records[id] = record
        self.save()
        self.emitProgress(record, force: true)
        return done(nil)
      }
      let data = self.takeResumeData(id: id)
      record.openHeaders()
      if data == nil {
        // Nothing to continue from: this is a start from the first byte.
        record.receivedBytes = 0
        record.cellularAtLaunch = !self.ruled(id)
      }
      record.state = self.ruled(id) && self.onCellular ? "waiting" : "queued"
      record.heldForWifi = false
      record.error = nil
      record.errorCode = nil
      record.updatedAt = Downloads.now()
      record.lastProgressAt = record.updatedAt
      self.records[id] = record
      self.save()
      self.launch(record, request: self.request(url, record.headers, id: id), resumeData: data)
      self.emitProgress(record, force: true)
      done(nil)
    }
  }

  func cancel(_ id: String, done: @escaping (String?) -> Void) {
    queue.async {
      guard let record = self.records[id] else { return done(nil) }
      self.records.removeValue(forKey: id)
      self.dropMeteredOk(id)
      self.save()
      try? FileManager.default.removeItem(at: Downloads.resumeFile(id))
      try? FileManager.default.removeItem(atPath: Downloads.absolute(record.partial))
      self.task(for: id) { task in
        task?.cancel()
        var gone = record
        gone.state = "cancelled"
        self.emit("bg-download-progress", self.json(gone))
        done(nil)
      }
    }
  }

  func forget(_ id: String) {
    queue.sync {
      guard let record = records[id], ["paused", "done", "error", "cancelled"].contains(record.state) else { return }
      records.removeValue(forKey: id)
      dropMeteredOk(id)
      // The resume data is bookkeeping of this line. The partial file on
      // disk is the user's bytes and stays.
      save()
    }
  }

  // ── events ────────────────────────────────────────────────────────────

  private func emitProgress(_ record: DownloadRecord, force: Bool = false) {
    let now = Downloads.now()
    if !force, let last = lastEmit[record.id], now - last < 500 { return }
    lastEmit[record.id] = now
    emit("bg-download-progress", json(record))
  }

  private func emitError(_ record: DownloadRecord) {
    emit("bg-download-error", json(record))
  }

  // ── URLSession ────────────────────────────────────────────────────────

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                  totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    guard let id = downloadTask.taskDescription, var record = records[id] else { return }
    // Late progress of a task that was paused or cancelled a moment ago.
    guard ["queued", "running", "waiting"].contains(record.state), !record.heldForWifi else { return }
    guard answeringAddressAllowed(downloadTask, id: id) else { return }
    let now = Downloads.now()
    if let sample = lastSample[id], now - sample.at >= 1000 {
      let speed = Double(totalBytesWritten - sample.bytes) / (Double(now - sample.at) / 1000.0)
      record.bytesPerSecond = record.bytesPerSecond == 0 ? speed : record.bytesPerSecond * 0.6 + speed * 0.4
      lastSample[id] = (now, totalBytesWritten)
    } else if lastSample[id] == nil {
      lastSample[id] = (now, totalBytesWritten)
    }
    record.state = "running"
    record.receivedBytes = totalBytesWritten
    if totalBytesExpectedToWrite > 0 {
      record.totalBytes = totalBytesExpectedToWrite
    }
    record.updatedAt = now
    record.lastProgressAt = now
    records[id] = record
    save(force: false)
    emitProgress(record)
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didResumeAtOffset fileOffset: Int64,
                  expectedTotalBytes: Int64) {
    log("download resumed id=\(downloadTask.taskDescription ?? "") offset=\(fileOffset) total=\(expectedTotalBytes)")
  }

  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    // The file at `location` is gone when this method returns. Everything
    // that needs it happens before the return.
    guard let id = downloadTask.taskDescription, var record = records[id] else {
      try? FileManager.default.removeItem(at: location)
      return
    }
    guard ["queued", "running", "waiting"].contains(record.state) else {
      try? FileManager.default.removeItem(at: location)
      return
    }
    // A transfer too small for a progress callback is looked at here.
    guard answeringAddressAllowed(downloadTask, id: id) else {
      try? FileManager.default.removeItem(at: location)
      return
    }
    let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
    // A 404 page is a "successful download" as far as the session is
    // concerned. It is not the file.
    if status != 0 && !(200...299).contains(status) {
      try? FileManager.default.removeItem(at: location)
      record.state = "error"
      record.errorCode = "http-\(status)"
      record.error = "The server refused this download (HTTP \(status))."
      record.resumable = false
      record.updatedAt = Downloads.now()
      records[id] = record
      save()
      emitError(record)
      log("download refused id=\(id) status=\(status)")
      return
    }
    let partial = URL(fileURLWithPath: Downloads.absolute(record.partial))
    do {
      try FileManager.default.createDirectory(at: partial.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? FileManager.default.removeItem(at: partial)
      try FileManager.default.moveItem(at: location, to: partial)
    } catch {
      record.state = "error"
      record.errorCode = Downloads.isDiskFull(error) ? "disk" : "io"
      record.error = Downloads.isDiskFull(error)
        ? "There is not enough free storage on this device."
        : "The downloaded file could not be moved into the app's folder."
      record.updatedAt = Downloads.now()
      records[id] = record
      save()
      emitError(record)
      return
    }
    // The total was taken from the progress callbacks, where it is the size
    // of the whole file also after a resume. Only a transfer too small to
    // have had a progress callback needs the header.
    if record.totalBytes <= 0, status == 200,
      let length = (downloadTask.response as? HTTPURLResponse)?.expectedContentLength, length > 0 {
      record.totalBytes = length
    }
    record.state = "verifying"
    record.updatedAt = Downloads.now()
    records[id] = record
    save()
    emitProgress(record, force: true)
    finishVerification(id)
  }

  static func isDiskFull(_ error: Error) -> Bool {
    let ns = error as NSError
    if ns.domain == NSCocoaErrorDomain && ns.code == NSFileWriteOutOfSpaceError { return true }
    if ns.domain == NSPOSIXErrorDomain && ns.code == Int(ENOSPC) { return true }
    if let under = ns.userInfo[NSUnderlyingErrorKey] as? NSError { return isDiskFull(under) }
    return false
  }

  /// Size, SHA-256, rename. Runs on a worker, with a background task around
  /// it so iOS lets it finish when the app was only woken for this.
  private func finishVerification(_ id: String) {
    guard let record = records[id], record.state == "verifying" else { return }
    // Begun and ended on the main queue, in that order, and never waited
    // for: this method runs on `queue`, and the main thread may be waiting
    // for `queue` at this very moment.
    let hold = BackgroundHold()
    DispatchQueue.main.async { hold.begin("lu-verify") }

    DispatchQueue.global(qos: .utility).async {
      let partial = Downloads.absolute(record.partial)
      let dest = Downloads.absolute(record.dest)
      let outcome = Downloads.verifyAndRename(partial: partial, dest: dest, total: record.totalBytes,
                                              expected: record.expectedBytesExact ? record.expectedBytes : 0,
                                              sha256: record.sha256)
      self.queue.async {
        defer { DispatchQueue.main.async { hold.end() } }
        guard var current = self.records[id], current.state == "verifying" else { return }
        current.updatedAt = Downloads.now()
        current.bytesPerSecond = 0
        switch outcome {
        case .ok(let bytes):
          current.state = "done"
          current.receivedBytes = bytes
          current.totalBytes = bytes
          current.error = nil
          current.errorCode = nil
          // The token has done its work. A finished line keeps none.
          current.headers = [:]
          current.unopenedSeal = nil
          self.records[id] = current
          self.save()
          try? FileManager.default.removeItem(at: Downloads.resumeFile(id))
          self.log("download done id=\(id) bytes=\(bytes)")
          self.emit("bg-download-done", self.json(current))
        case .failed(let code, let text):
          current.state = "error"
          current.errorCode = code
          current.error = text
          current.resumable = false
          self.records[id] = current
          self.save()
          self.log("download check failed id=\(id) code=\(code)")
          self.emitError(current)
        }
      }
    }
  }

  enum Outcome {
    case ok(Int64)
    case failed(String, String)
  }

  static func sha256(ofFile path: String) -> String? {
    guard let handle = FileHandle(forReadingAtPath: path) else { return nil }
    defer { try? handle.close() }
    var hasher = SHA256()
    while true {
      let piece = autoreleasepool { handle.readData(ofLength: 1024 * 1024) }
      if piece.isEmpty { break }
      hasher.update(data: piece)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  static func verifyAndRename(partial: String, dest: String, total: Int64, expected: Int64, sha256: String?) -> Outcome {
    let manager = FileManager.default
    guard let attributes = try? manager.attributesOfItem(atPath: partial),
      let size = (attributes[.size] as? NSNumber)?.int64Value
    else {
      // Verified and renamed in an earlier run that did not get to write
      // the list any more.
      if manager.fileExists(atPath: dest), let done = try? manager.attributesOfItem(atPath: dest),
        let bytes = (done[.size] as? NSNumber)?.int64Value {
        return .ok(bytes)
      }
      return .failed("io", "The downloaded file is not there any more.")
    }
    for promised in [total, expected] where promised > 0 && promised != size {
      // Too short or too long, either way not the file. It cannot be
      // continued either: the session has no resume data for it.
      try? manager.removeItem(atPath: partial)
      return .failed("size", "The download ended early: \(size) of \(promised) bytes arrived. Start it again.")
    }
    if let wanted = sha256, !wanted.isEmpty {
      guard let actual = Downloads.sha256(ofFile: partial) else {
        return .failed("io", "The downloaded file could not be read.")
      }
      if actual.lowercased() != wanted.lowercased() {
        try? manager.removeItem(atPath: partial)
        return .failed("checksum", "The downloaded file is damaged: its checksum does not match. It was removed, start the download again.")
      }
    }
    // rename(2) replaces an existing file in one step. A reader sees the
    // old file or the new one, never half of either.
    if rename(partial, dest) != 0 {
      return .failed(errno == ENOSPC ? "disk" : "io", "The finished download could not be moved into place.")
    }
    // A model is gigabytes that can be downloaded again. It does not belong
    // in the user's iCloud backup. The same rule as for a file the user
    // brought in (ImportRule.swift).
    BackupRule.exclude(dest)
    return .ok(size)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let id = task.taskDescription else { return }
    lastSample.removeValue(forKey: id)
    checkedTasks.remove(task.taskIdentifier)
    guard let error = error as NSError? else { return }
    let resumeData = error.userInfo[NSURLSessionDownloadTaskResumeData] as? Data
    guard var record = records[id] else { return }

    if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled {
      let reason = error.userInfo[NSURLErrorBackgroundTaskCancelledReasonKey] as? Int
      // Pause and Cancel end here too. They have already written the state.
      guard ["queued", "running", "waiting"].contains(record.state) else { return }
      if record.heldForWifi {
        // Stopped by `hold` until Wi-Fi is back. The line stays waiting.
        if let data = resumeData { writeResumeData(data, id: id) }
        return
      }
      // What is left: the system cancelled it. The user swiped the app away
      // (iOS stops all transfers of an app then), or background refresh is
      // off. Both are a pause the user caused, not a failure.
      var kept = false
      if let data = resumeData {
        kept = writeResumeData(data, id: id)
      }
      record.state = "paused"
      record.resumable = kept
      record.bytesPerSecond = 0
      record.updatedAt = Downloads.now()
      records[id] = record
      save()
      log("download cancelled by system id=\(id) reason=\(reason ?? -1) resumeData=\(resumeData != nil)")
      emitProgress(record, force: true)
      return
    }

    guard ["queued", "running", "waiting"].contains(record.state) else { return }
    var kept = false
    if let data = resumeData {
      kept = writeResumeData(data, id: id)
    }
    let full = Downloads.isDiskFull(error)
    record.state = "error"
    record.errorCode = full ? "disk" : (error.domain == NSURLErrorDomain ? "network" : "unknown")
    record.error = full
      ? "There is not enough free storage on this device."
      : "The download stopped because the connection failed. Start it again to continue."
    record.resumable = kept
    record.bytesPerSecond = 0
    record.updatedAt = Downloads.now()
    records[id] = record
    save()
    log("download error id=\(id) domain=\(error.domain) code=\(error.code) resumeData=\(resumeData != nil)")
    emitError(record)
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    log("urlSessionDidFinishEvents")
    let identifier = session.configuration.identifier ?? ""
    DispatchQueue.main.async {
      if let completion = self.backgroundCompletion.removeValue(forKey: identifier) {
        completion()
      }
    }
  }
}
