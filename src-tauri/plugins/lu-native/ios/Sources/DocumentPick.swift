import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

// "File" in the sheet "Add to message": the picker of the system for files,
// asked directly. What is decided without a screen is in
// DocumentPickRule.swift.
//
// A file field of the webview puts a menu of iOS in front of it ("Photo
// Library", "Take Photo", "Choose Files") as soon as one of its types could
// be a picture or a video (check on the iPhone, round 22, N2). This picker
// is the Files app and nothing else.
//
// `asCopy: true`: the system hands out copies, so no security scoped access
// has to be held while the page reads. The copies are moved into the temp
// folder Rust named, the page reads them in pieces and removes them.

class DocumentPickArgs: Decodable {
  let dir: String
  let maxFiles: Int?
}

/// Keeps the invoke alive until the picker reports back. UIKit holds its
/// delegate weakly.
final class DocumentPickDelegate: NSObject, UIDocumentPickerDelegate {
  private let done: ([URL]?) -> Void
  private var answered = false
  var keepAlive: DocumentPickDelegate?

  init(done: @escaping ([URL]?) -> Void) {
    self.done = done
  }

  private func finish(_ urls: [URL]?) {
    if answered { return }
    answered = true
    done(urls)
    keepAlive = nil
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish(urls)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish(nil)
  }
}

enum DocumentPick {
  static func pick(_ invoke: Invoke, root: UIViewController?) {
    guard let args = try? invoke.parseArgs(DocumentPickArgs.self), args.dir.hasPrefix("/") else {
      invoke.reject(DocumentPickRule.badRequest)
      return
    }
    let limit = DocumentPickRule.limit(args.maxFiles)
    DispatchQueue.main.async {
      guard let host = Share.topController(root) else {
        invoke.reject(DocumentPickRule.noPicker)
        return
      }
      // `.item` is every file. Folders and packages are not offered.
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
      picker.allowsMultipleSelection = limit > 1
      let delegate = DocumentPickDelegate { urls in
        guard let urls = urls, !urls.isEmpty else {
          invoke.resolve(["cancelled": true])
          return
        }
        DispatchQueue.global(qos: .userInitiated).async {
          answer(invoke, urls: urls, dir: args.dir, limit: limit)
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

  /// Move the copies of the system into the temp folder and tell the page
  /// where they are. A copy that is not taken is removed.
  private static func answer(_ invoke: Invoke, urls: [URL], dir: String, limit: Int) {
    let manager = FileManager.default
    var files: [JsonObject] = []
    let taken = DocumentPickRule.taken(urls, limit: limit)
    for url in urls.dropFirst(taken.count) { try? manager.removeItem(at: url) }
    for url in taken {
      guard let path = DocumentPickRule.target(dir: dir, folder: UUID().uuidString.lowercased(), pathExtension: url.pathExtension) else {
        try? manager.removeItem(at: url)
        continue
      }
      let target = URL(fileURLWithPath: path)
      do {
        try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        do {
          try manager.moveItem(at: url, to: target)
        } catch {
          try manager.copyItem(at: url, to: target)
          try? manager.removeItem(at: url)
        }
      } catch {
        try? manager.removeItem(at: target.deletingLastPathComponent())
        continue
      }
      let size = ((try? manager.attributesOfItem(atPath: path))?[.size] as? NSNumber)?.int64Value ?? 0
      let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
      files.append(["path": path, "name": DocumentPickRule.displayName(url.lastPathComponent), "bytes": size, "mime": mime ?? ""])
    }
    if files.isEmpty {
      invoke.reject(DocumentPickRule.notRead)
      return
    }
    invoke.resolve(["cancelled": false, "files": files, "more": urls.count > taken.count])
  }
}
