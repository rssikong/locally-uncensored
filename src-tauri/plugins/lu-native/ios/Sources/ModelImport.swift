import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

// A model file of the user's own, picked in the system's document picker.
//
// The picker hands out a security scoped address: the app may read the file
// where it lies (Files, iCloud Drive, another app's folder) while it holds
// the access. This file reads what Rust needs to judge the file (name, size,
// the first bytes, free space) and then copies it into the model folder, in
// pieces, with progress and a way to stop. Whether the file is copied at
// all, and under which name, is decided in Rust (src/import.rs). The bytes
// never pass through the webview.

class ImportPickArgs: Decodable {
  let dir: String?
}

class ImportTokenArgs: Decodable {
  let token: String
}

class ImportCopyArgs: Decodable {
  let token: String
  let id: String
  let partial: String
  let fileName: String?
  let totalBytes: Int64?
}

/// Keeps the invoke alive until the picker reports back. UIKit holds its
/// delegate weakly.
final class ImportPickDelegate: NSObject, UIDocumentPickerDelegate {
  private let done: (URL?) -> Void
  private var answered = false
  var keepAlive: ImportPickDelegate?

  init(done: @escaping (URL?) -> Void) {
    self.done = done
  }

  private func finish(_ url: URL?) {
    if answered { return }
    answered = true
    done(url)
    keepAlive = nil
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish(urls.first)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish(nil)
  }
}

enum ModelImport {
  private static let headBytes = 16
  private static let bufferBytes = 1024 * 1024
  private static let progressEvery: TimeInterval = 0.25

  private struct Picked {
    let url: URL
    /// Whether `startAccessingSecurityScopedResource` said yes and has to be balanced.
    let scoped: Bool
  }

  private static let lock = NSLock()
  private static var picked: [String: Picked] = [:]

  /// The flag itself lives in ImportRule.swift, where it is tested.
  static var cancelled: Bool { ImportCancel.cancelled }

  static func cancel() {
    ImportCancel.cancel()
  }

  private static func take(_ token: String) -> Picked? {
    lock.lock(); defer { lock.unlock() }
    return picked.removeValue(forKey: token)
  }

  static func release(_ token: String) {
    if let entry = take(token), entry.scoped {
      entry.url.stopAccessingSecurityScopedResource()
    }
  }

  /// Open the picker and answer what Rust needs to judge the file.
  static func pick(_ invoke: Invoke, root: UIViewController?) {
    // The first step of every import: a Cancel from before does not concern
    // it, and one that arrives from here on holds until the copy reads it.
    ImportCancel.begin()
    let dir = (try? invoke.parseArgs(ImportPickArgs.self))?.dir
    DispatchQueue.main.async {
      guard let host = Share.topController(root) else {
        invoke.reject("The file picker could not be shown.")
        return
      }
      // No type of its own exists for GGUF. `.data` lets every file be
      // chosen, the first bytes decide what it is. `asCopy: false`: the
      // file is read where it lies, a copy by the system would need the
      // space twice and show no progress.
      var types: [UTType] = [.data]
      if let gguf = UTType(filenameExtension: "gguf") { types.insert(gguf, at: 0) }
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
      picker.allowsMultipleSelection = false
      let delegate = ImportPickDelegate { url in
        guard let url = url else {
          invoke.resolve(["cancelled": true])
          return
        }
        DispatchQueue.global(qos: .userInitiated).async {
          invoke.resolve(describe(url, dir: dir))
        }
      }
      delegate.keepAlive = delegate
      picker.delegate = delegate
      if let popover = picker.popoverPresentationController {
        popover.sourceView = host.view
        popover.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1)
      }
      host.present(picker, animated: true)
    }
  }

  /// Run `body` with an address that can be read now. A file in iCloud
  /// Drive that is not on the phone yet is fetched by the coordinator first.
  private static func coordinated(_ url: URL, _ body: (URL) -> Void) -> Bool {
    var problem: NSError?
    var ran = false
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &problem) { readable in
      ran = true
      body(readable)
    }
    return ran && problem == nil
  }

  private static func describe(_ url: URL, dir: String?) -> JsonObject {
    let scoped = url.startAccessingSecurityScopedResource()
    var size: Int64 = -1
    var head = Data()
    _ = coordinated(url) { readable in
      if let values = try? readable.resourceValues(forKeys: [.fileSizeKey]), let bytes = values.fileSize {
        size = Int64(bytes)
      }
      if let handle = try? FileHandle(forReadingFrom: readable) {
        head = (try? handle.read(upToCount: headBytes)) ?? Data()
        try? handle.close()
      }
    }
    let token = UUID().uuidString
    lock.lock()
    picked[token] = Picked(url: url, scoped: scoped)
    lock.unlock()
    return [
      "cancelled": false,
      "token": token,
      "name": url.lastPathComponent,
      "size": NSNumber(value: size),
      "headBase64": head.base64EncodedString(),
      "freeBytes": NSNumber(value: max(0, Device.diskSpace(at: dir).free)),
    ]
  }

  static func isNoSpace(_ error: Error) -> Bool {
    let ns = error as NSError
    if ns.domain == NSCocoaErrorDomain && ns.code == NSFileWriteOutOfSpaceError { return true }
    if ns.domain == NSPOSIXErrorDomain && ns.code == Int(ENOSPC) { return true }
    if let under = ns.userInfo[NSUnderlyingErrorKey] as? Error { return isNoSpace(under) }
    return false
  }

  /// Copy the picked file to `partial`. Answers `copied`, `cancelled`,
  /// `no-space` or `failed` and the bytes written. Whatever is not `copied`
  /// leaves no file behind.
  static func copy(_ invoke: Invoke, emit: @escaping (String, JsonObject) -> Void) {
    guard let args = try? invoke.parseArgs(ImportCopyArgs.self) else {
      invoke.reject("The import request is not valid.")
      return
    }
    guard let entry = take(args.token) else {
      invoke.resolve(["status": "failed", "bytes": 0])
      return
    }
    // iOS suspends an app a few seconds after it leaves the screen. This asks
    // for the time the system is willing to give, so a short look at another
    // app does not break a copy that is almost done.
    let hold = BackgroundHold()
    DispatchQueue.main.async { hold.begin("lu-model-import") }
    DispatchQueue.global(qos: .userInitiated).async {
      var status = "failed"
      var written: Int64 = 0
      let target = URL(fileURLWithPath: args.partial)
      let total = args.totalBytes ?? 0
      _ = coordinated(entry.url) { readable in
        do {
          // A Cancel that came while the file was picked ends here, with nothing written.
          if cancelled { status = "cancelled"; return }
          try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
          FileManager.default.createFile(atPath: target.path, contents: nil)
          // Out of the backup from the first byte on, the half file included.
          // Rust renames it into place afterwards, and the mark stays on it.
          BackupRule.exclude(target.path)
          let input = try FileHandle(forReadingFrom: readable)
          defer { try? input.close() }
          let output = try FileHandle(forWritingTo: target)
          defer { try? output.close() }
          var lastProgress = Date.distantPast
          while true {
            if cancelled { status = "cancelled"; break }
            // Each piece in its own pool, or a 2 GB file would sit in memory until the loop ends.
            var end = false
            try autoreleasepool {
              let piece = try input.read(upToCount: bufferBytes) ?? Data()
              if piece.isEmpty { end = true; return }
              try output.write(contentsOf: piece)
              written += Int64(piece.count)
            }
            if end { status = "copied"; break }
            if Date().timeIntervalSince(lastProgress) >= progressEvery {
              lastProgress = Date()
              emit("model-import-progress", [
                "id": args.id, "fileName": args.fileName ?? "",
                "receivedBytes": NSNumber(value: written), "totalBytes": NSNumber(value: total),
              ])
            }
          }
          if status == "copied" {
            try output.synchronize()
            // Once more on the finished file: this is the one that stays.
            BackupRule.exclude(target.path)
          }
        } catch {
          status = isNoSpace(error) ? "no-space" : "failed"
        }
      }
      if entry.scoped { entry.url.stopAccessingSecurityScopedResource() }
      if status == "copied" {
        emit("model-import-progress", [
          "id": args.id, "fileName": args.fileName ?? "",
          "receivedBytes": NSNumber(value: written), "totalBytes": NSNumber(value: total),
        ])
      } else {
        try? FileManager.default.removeItem(at: target)
      }
      DispatchQueue.main.async { hold.end() }
      invoke.resolve(["status": status, "bytes": NSNumber(value: written)])
    }
  }
}
