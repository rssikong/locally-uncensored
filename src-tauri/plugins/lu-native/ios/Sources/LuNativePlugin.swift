import Foundation
import SwiftRs
import Tauri
import UIKit
import WebKit

// The iOS half of the native layer. See src/lib.rs for the whole picture.
//
// Commands arrive on the thread Rust called from, which is never the main
// thread for the commands of this plugin. Everything that touches UIKit goes
// to the main queue explicitly.

class AttachArgs: Decodable {
  let channel: Channel
}

class AccountArgs: Decodable {
  let account: String
  let value: String?
}

class DeviceArgs: Decodable {
  let path: String?
}

class TaskArgs: Decodable {
  let name: String?
  let id: Int?
}

class IdArgs: Decodable {
  let id: String
}

class StartArgs: Decodable {
  let id: String
  let url: String
  let dest: String
  let partial: String
  let expectedBytes: Int64?
  let expectedBytesExact: Bool?
  let sha256: String?
  let headers: [String: String]?
  let userAgent: String?
  let allowLocal: Bool?
}

class TextArgs: Decodable {
  let text: String
}

class WifiOnlyArgs: Decodable {
  let wifiOnly: Bool?
}

class AllowMeteredArgs: Decodable {
  let id: String
  let allow: Bool?
}

class BarsArgs: Decodable {
  let theme: String?
}

class LuNativePlugin: Plugin {
  private var channel: Channel?
  /// Events that happened before Rust opened the channel.
  private var backlog: [(String, JsonObject)] = []
  private let lock = NSLock()
  private var observers: [NSObjectProtocol] = []
  private var backgroundTasks: [Int: UIBackgroundTaskIdentifier] = [:]
  private var nextTaskId = 1

  override init() {
    super.init()
    // A17: taps on notices of the computer come back as links of the app's own.
    RemoteNoteDelegate.shared.install(self)
    // Created inside application(_:didFinishLaunchingWithOptions:), because
    // that is where Tauri runs its setup. So this observer is in place
    // before the notification that carries the launch options is posted.
    observe(UIApplication.didFinishLaunchingNotification) { [weak self] note in
      if let url = note.userInfo?[UIApplication.LaunchOptionsKey.url] as? URL {
        self?.noteLaunchUrl(url.absoluteString, source: "launch-options")
      }
    }
    observe(UIApplication.didEnterBackgroundNotification) { [weak self] _ in
      self?.emit("app-background", ["reason": "background"])
    }
    observe(UIApplication.willEnterForegroundNotification) { [weak self] _ in
      self?.emit("app-foreground", ["reason": "foreground"])
    }
    observe(UIApplication.willTerminateNotification) { [weak self] _ in
      self?.emit("app-will-terminate", [:])
    }
    observe(UIApplication.didReceiveMemoryWarningNotification) { [weak self] _ in
      self?.emit("memory-warning", [
        "source": "system",
        "level": "critical",
        "availableMemoryBytes": NSNumber(value: UInt64(os_proc_available_memory())),
      ])
    }
    observe(UIContentSizeCategory.didChangeNotification) { [weak self] _ in
      self?.emit("font-scale-changed", [
        "fontScale": Device.fontScale,
        "contentSizeCategory": UIApplication.shared.preferredContentSizeCategory.rawValue,
      ])
    }
    // The colour of the window before the page has drawn (StartTheme.swift).
    // Posted inside makeKeyAndVisible, so before the first frame of the app.
    observe(UIWindow.didBecomeVisibleNotification) { note in
      if let window = note.object as? UIWindow { StartTheme.apply(window: window) }
    }
    AppDelegateHooks.install()
    AppDelegateHooks.onOpenUrl = { [weak self] url in
      self?.noteLaunchUrl(url, source: "open-url")
    }
    // Reading aloud (Tts.swift). This call is also what links that file in.
    wireSpeech()
    log("plugin init")
  }

  /// Called by Tauri as soon as the web view exists, before it has loaded
  /// anything: its ground and the window behind it take the colour the page
  /// is going to have (StartTheme.swift).
  @objc public override func load(webview: WKWebView) {
    StartTheme.apply(webview: webview)
    // The page comes back by itself after iOS ended the process that draws
    // it (ContentGuard.swift, finding N3 of the iPhone review).
    ContentGuard.shared.log = { [weak self] text in self?.log(text) }
    ContentGuard.shared.watch(webview)
  }

  private func observe(_ name: NSNotification.Name, _ body: @escaping (Notification) -> Void) {
    observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main, using: body))
  }

  /// A line in Library/Caches/lu-native.log. Only written in the simulator,
  /// where the acceptance scripts read it from the Mac; a device build logs
  /// nothing to disk. Never in Documents: that folder is the one the Files
  /// app shows the user as "LU" (NativeLogRule.swift, round 22, N6).
  func log(_ text: String) {
    #if targetEnvironment(simulator)
    let line = "\(ISO8601DateFormatter().string(from: Date())) pid=\(ProcessInfo.processInfo.processIdentifier) \(text)\n"
    let manager = FileManager.default
    let file = NativeLogRule.file(caches: manager.urls(for: .cachesDirectory, in: .userDomainMask)[0])
    // What an older build left where the user sees it.
    if let visible = manager.urls(for: .documentDirectory, in: .userDomainMask).first {
      let old = NativeLogRule.oldFile(documents: visible)
      if manager.fileExists(atPath: old.path) { try? manager.removeItem(at: old) }
    }
    if let handle = try? FileHandle(forWritingTo: file) {
      handle.seekToEndOfFile()
      handle.write(Data(line.utf8))
      try? handle.close()
    } else {
      try? Data(line.utf8).write(to: file)
    }
    #endif
  }

  // ── events ────────────────────────────────────────────────────────────

  func emit(_ event: String, _ payload: JsonObject) {
    lock.lock()
    let target = channel
    if target == nil {
      if backlog.count < 64 { backlog.append((event, payload)) }
      lock.unlock()
      return
    }
    lock.unlock()
    target?.send(["event": event, "payload": payload])
  }

  private func noteLaunchUrl(_ url: String, source: String) {
    // Not kept here. If Rust is not listening yet the event waits in the
    // backlog, and Rust is where the link is remembered until a page asks.
    log("deep link source=\(source) url=\(url)")
    emit("deep-link", ["url": url, "source": source])
  }

  @objc public func attach(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AttachArgs.self)
    lock.lock()
    channel = args.channel
    let waiting = backlog
    backlog = []
    lock.unlock()
    for (event, payload) in waiting {
      args.channel.send(["event": event, "payload": payload])
    }
    // From here on a finished download has somewhere to report to.
    let downloads = Downloads.shared
    downloads.emit = { [weak self] event, payload in self?.emit(event, payload) }
    downloads.log = { [weak self] text in self?.log(text) }
    downloads.start()
    log("attached backlog=\(waiting.count)")
    invoke.resolve(["attached": true])
    // The first moment at which UIKit can say whether protected data is
    // readable. Off the calling thread: the check goes through the main one.
    DispatchQueue.global(qos: .utility).async { [weak self] in
      let state = Secrets.clearIfFreshInstall()
      self?.log("keychain=\(state)")
    }
  }

  // ── secure storage ────────────────────────────────────────────────────

  @objc public func secretGet(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AccountArgs.self)
    switch Secrets.get(args.account) {
    case .success(let value): invoke.resolve(["value": value])
    case .failure(let error): invoke.reject(error.text)
    }
  }

  @objc public func secretSet(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AccountArgs.self)
    switch Secrets.set(args.account, args.value ?? "") {
    case .success: invoke.resolve(["ok": true])
    case .failure(let error): invoke.reject(error.text)
    }
  }

  @objc public func secretDelete(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AccountArgs.self)
    switch Secrets.delete(args.account) {
    case .success: invoke.resolve(["ok": true])
    case .failure(let error): invoke.reject(error.text)
    }
  }

  // ── sharing and saving ────────────────────────────────────────────────

  @objc public func shareFile(_ invoke: Invoke) throws {
    Share.share(invoke, root: manager.viewController)
  }

  @objc public func saveToPhotos(_ invoke: Invoke) throws {
    Share.saveToPhotos(invoke)
  }

  @objc public func saveToFiles(_ invoke: Invoke) throws {
    Share.saveToFiles(invoke, root: manager.viewController)
  }

  // ── device ────────────────────────────────────────────────────────────

  @objc public func deviceInfo(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(DeviceArgs.self)
    DispatchQueue.main.async {
      invoke.resolve(Device.info(path: args.path))
    }
  }

  /// Acceptance builds only, Rust refuses the call otherwise. In the
  /// simulator this makes UIKit deliver its real memory warning, through a
  /// selector that is not public and is therefore compiled for the
  /// simulator only. On a device the event is sent as if the system had.
  @objc public func simulateMemoryWarning(_ invoke: Invoke) throws {
    #if targetEnvironment(simulator)
    DispatchQueue.main.async {
      let selector = Selector(("_perform" + "MemoryWarning"))
      if UIApplication.shared.responds(to: selector) {
        UIApplication.shared.perform(selector)
        invoke.resolve(["triggered": true, "source": "system"])
      } else {
        invoke.resolve(["triggered": false])
      }
    }
    #else
    emit("memory-warning", ["source": "simulated", "level": "critical",
                            "availableMemoryBytes": NSNumber(value: UInt64(os_proc_available_memory()))])
    invoke.resolve(["triggered": true, "source": "simulated"])
    #endif
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  @objc public func beginBackgroundTask(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TaskArgs.self)
    DispatchQueue.main.async {
      let id = self.nextTaskId
      self.nextTaskId += 1
      let token = UIApplication.shared.beginBackgroundTask(withName: args.name ?? "lu-flush") { [weak self] in
        // Out of time. End it, or iOS ends the app.
        self?.endTask(id)
      }
      if token == .invalid {
        invoke.resolve(["id": 0, "remainingSeconds": 0])
        return
      }
      self.backgroundTasks[id] = token
      let remaining = UIApplication.shared.backgroundTimeRemaining
      invoke.resolve(["id": id, "remainingSeconds": remaining.isFinite && remaining < 1_000_000 ? remaining : -1])
    }
  }

  private func endTask(_ id: Int) {
    if let token = backgroundTasks.removeValue(forKey: id) {
      UIApplication.shared.endBackgroundTask(token)
    }
  }

  @objc public func endBackgroundTask(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TaskArgs.self)
    DispatchQueue.main.async {
      self.endTask(args.id ?? 0)
      invoke.resolve(["ok": true])
    }
  }

  // iOS has no back key. The three commands exist so that one JavaScript
  // bridge serves both platforms.
  @objc public func backArm(_ invoke: Invoke) throws { invoke.resolve(["ok": true]) }
  @objc public func backAck(_ invoke: Invoke) throws { invoke.resolve(["ok": true]) }
  @objc public func backExit(_ invoke: Invoke) throws { invoke.resolve(["ok": true]) }

  // ── small services for the shell ──────────────────────────────────────

  @objc public func haptic(_ invoke: Invoke) throws {
    Extras.haptic(invoke)
  }

  @objc public func openExternal(_ invoke: Invoke) throws {
    Extras.openExternal(invoke)
  }

  /// The theme the user chose in the app (`dark`, `light`, `system`). Kept
  /// for the next start and put on the window now.
  @objc public func setSystemBars(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(BarsArgs.self)
    if let theme = args.theme {
      StartTheme.store(theme)
      DispatchQueue.main.async { StartTheme.refresh() }
    }
    invoke.resolve(["ok": true])
  }

  @objc public func openSystemSettings(_ invoke: Invoke) throws {
    Extras.openSystemSettings(invoke)
  }

  @objc public func scanQr(_ invoke: Invoke) throws {
    Extras.scanQr(invoke, root: manager.viewController)
  }

  // ── sign in with Apple (AppleSignIn.swift) ────────────────────────────

  @objc public func appleSignIn(_ invoke: Invoke) throws {
    AppleSignIn.start(invoke, root: manager.viewController)
  }

  // ── sign in with Google or GitHub, the sheet of the system (WebAuth.swift) ──

  @objc public func webAuth(_ invoke: Invoke) throws {
    WebAuth.start(invoke, root: manager.viewController)
  }

  // ── documents for a message, from the Files app (DocumentPick.swift) ──

  @objc public func pickDocuments(_ invoke: Invoke) throws {
    DocumentPick.pick(invoke, root: manager.viewController)
  }

  // ── credits as an in-app purchase (Iap.swift) ─────────────────────────

  /// The store reports through the one channel of the plugin, like every other event.
  private func iap() -> Iap {
    let iap = Iap.shared
    if iap.emit == nil { iap.emit = { [weak self] event, payload in self?.emit(event, payload) } }
    return iap
  }

  @objc public func iapProducts(_ invoke: Invoke) throws {
    iap().products(invoke)
  }

  @objc public func iapPurchase(_ invoke: Invoke) throws {
    iap().purchase(invoke)
  }

  @objc public func iapUnfinished(_ invoke: Invoke) throws {
    iap().unfinished(invoke)
  }

  @objc public func iapFinish(_ invoke: Invoke) throws {
    iap().finish(invoke)
  }

  // ── background downloads ──────────────────────────────────────────────

  @objc public func bgStart(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(StartArgs.self)
    if let problem = Downloads.shared.startDownload(
      id: args.id, url: args.url, dest: args.dest, partial: args.partial,
      expectedBytes: args.expectedBytes ?? 0, exact: args.expectedBytesExact ?? false,
      sha256: args.sha256, headers: Downloads.withUserAgent(args.headers ?? [:], args.userAgent),
      allowLocal: args.allowLocal ?? false)
    {
      invoke.reject(problem)
    } else {
      invoke.resolve(["ok": true])
    }
  }

  private func answer(_ invoke: Invoke) -> (String?) -> Void {
    return { problem in
      if let problem = problem { invoke.reject(problem) } else { invoke.resolve(["ok": true]) }
    }
  }

  @objc public func bgPause(_ invoke: Invoke) throws {
    Downloads.shared.pause(try invoke.parseArgs(IdArgs.self).id, done: answer(invoke))
  }

  @objc public func bgResume(_ invoke: Invoke) throws {
    Downloads.shared.resume(try invoke.parseArgs(IdArgs.self).id, done: answer(invoke))
  }

  @objc public func bgCancel(_ invoke: Invoke) throws {
    Downloads.shared.cancel(try invoke.parseArgs(IdArgs.self).id, done: answer(invoke))
  }

  @objc public func bgForget(_ invoke: Invoke) throws {
    Downloads.shared.forget(try invoke.parseArgs(IdArgs.self).id)
    invoke.resolve(["ok": true])
  }

  /// The switch "Download on Wi-Fi only". Kept natively, so it holds without the page.
  @objc public func bgNetworkRule(_ invoke: Invoke) throws {
    Downloads.shared.setWifiOnly(try invoke.parseArgs(WifiOnlyArgs.self).wifiOnly ?? false)
    invoke.resolve(["ok": true])
  }

  /// "Download anyway" for one download, or taking that back.
  @objc public func bgAllowMetered(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AllowMeteredArgs.self)
    Downloads.shared.allowMetered(args.id, args.allow ?? true)
    invoke.resolve(["ok": true])
  }

  /// Which kind of network the phone is on.
  @objc public func connectionInfo(_ invoke: Invoke) throws {
    invoke.resolve(Downloads.shared.connectionInfo())
  }

  @objc public func bgList(_ invoke: Invoke) throws {
    invoke.resolve(["downloads": Downloads.shared.list()])
  }

  // ── a model file of the user's own (ModelImport.swift) ────────────────

  @objc public func importPick(_ invoke: Invoke) throws {
    ModelImport.pick(invoke, root: manager.viewController)
  }

  @objc public func importRelease(_ invoke: Invoke) throws {
    ModelImport.release(try invoke.parseArgs(ImportTokenArgs.self).token)
    invoke.resolve(["ok": true])
  }

  @objc public func importCopy(_ invoke: Invoke) throws {
    ModelImport.copy(invoke) { [weak self] event, payload in self?.emit(event, payload) }
  }

  @objc public func importCancel(_ invoke: Invoke) throws {
    ModelImport.cancel()
    invoke.resolve(["ok": true])
  }

  // ── clipboard ─────────────────────────────────────────────────────────
  //
  // UIPasteboard wants the main queue. Reading a text that another app put
  // there makes iOS 16 and newer ask "Allow Paste" once per text; that
  // question belongs to the system and cannot be answered for the user.
  // `hasStrings` does not ask, so an empty clipboard never shows it.

  @objc public func clipboardReadText(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      let board = UIPasteboard.general
      guard board.hasStrings, let text = board.string, !text.isEmpty else {
        invoke.resolve(["text": ""])
        return
      }
      invoke.resolve(["text": text])
    }
  }

  @objc public func clipboardWriteText(_ invoke: Invoke) throws {
    let text = try invoke.parseArgs(TextArgs.self).text
    DispatchQueue.main.async {
      UIPasteboard.general.string = text
      invoke.resolve(["ok": true])
    }
  }

  /// The download needs no permission on iOS: the system carries it and LU
  /// shows no notification, neither for the progress nor for "finished"
  /// (Downloads.swift posts none). So there is nothing to ask for here, and
  /// the page shows no switch for it. Should a note "Download finished" ever
  /// be added, the question belongs here, with the rule of NotifyRule.kt.
  @objc public func requestNotificationPermission(_ invoke: Invoke) throws {
    invoke.resolve(["granted": true, "needed": false, "asked": false])
  }
}

// Two methods the app delegate of tao does not have, added to its class at
// run time:
//
//   * application(_:handleEventsForBackgroundURLSession:completionHandler:)
//     iOS calls it when it starts the app for a finished download and
//     expects the handler to be called once the app has dealt with it.
//   * application(_:open:options:) is there already. It is wrapped, not
//     replaced: the link is noted and the original runs.
enum AppDelegateHooks {
  static var onOpenUrl: ((String) -> Void)?
  private static var installed = false

  static func install() {
    if installed { return }
    installed = true
    guard let delegate = UIApplication.shared.delegate else { return }
    let cls: AnyClass = type(of: delegate)

    let sessionSelector = NSSelectorFromString("application:handleEventsForBackgroundURLSession:completionHandler:")
    if !cls.instancesRespond(to: sessionSelector) {
      let block: @convention(block) (AnyObject, UIApplication, NSString, @escaping () -> Void) -> Void = { _, _, identifier, completion in
        Downloads.shared.backgroundCompletion[identifier as String] = completion
        Downloads.shared.log("handleEventsForBackgroundURLSession \(identifier)")
      }
      class_addMethod(cls, sessionSelector, imp_implementationWithBlock(block), "v@:@@@?")
    }

    let openSelector = NSSelectorFromString("application:openURL:options:")
    if let method = class_getInstanceMethod(cls, openSelector) {
      typealias Original = @convention(c) (AnyObject, Selector, UIApplication, NSURL, NSDictionary) -> Bool
      let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
      let block: @convention(block) (AnyObject, UIApplication, NSURL, NSDictionary) -> Bool = { me, app, url, options in
        if let text = url.absoluteString {
          AppDelegateHooks.onOpenUrl?(text)
        }
        return original(me, openSelector, app, url, options)
      }
      method_setImplementation(method, imp_implementationWithBlock(block))
    }
  }
}

@_cdecl("init_plugin_lu_native")
func initPlugin() -> Plugin {
  return LuNativePlugin()
}
