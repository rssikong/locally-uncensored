import Foundation
import Photos
import Tauri
import UIKit
import UniformTypeIdentifiers

// Handing a file out of the app: share sheet, photo library, Files.
//
// All three show UI, so all three run on the main thread and answer when the
// user is done.

class ShareArgs: Decodable {
  let path: String?
  let text: String?
  let filename: String?
  let mime: String?
  let title: String?
}

class PhotosArgs: Decodable {
  let path: String
  let kind: String
  let bytes: Int64?
}

class FilesArgs: Decodable {
  let path: String
  let filename: String?
  let mime: String?
}

/// Keeps the invoke alive until the picker reports back. UIKit holds its
/// delegate weakly.
final class ExportDelegate: NSObject, UIDocumentPickerDelegate {
  private let invoke: Invoke
  private let cleanup: () -> Void
  private var answered = false
  var keepAlive: ExportDelegate?

  init(invoke: Invoke, cleanup: @escaping () -> Void) {
    self.invoke = invoke
    self.cleanup = cleanup
  }

  private func finish(_ data: JsonObject) {
    if answered { return }
    answered = true
    invoke.resolve(data)
    cleanup()
    keepAlive = nil
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finish(["saved": true, "uri": urls.first?.absoluteString ?? ""])
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finish(["saved": false])
  }
}

enum Share {
  static func topController(_ root: UIViewController?) -> UIViewController? {
    var top = root ?? UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.windows.first { $0.isKeyWindow }?.rootViewController }
      .first
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }

  static func share(_ invoke: Invoke, root: UIViewController?) {
    guard let args = try? invoke.parseArgs(ShareArgs.self) else {
      invoke.reject("The share request is not valid.")
      return
    }
    var items: [Any] = []
    if let path = args.path {
      guard FileManager.default.fileExists(atPath: path) else {
        invoke.reject("That file does not exist.")
        return
      }
      items.append(URL(fileURLWithPath: path))
    } else if let text = args.text {
      items.append(text)
    } else {
      invoke.reject("There is nothing to share.")
      return
    }
    DispatchQueue.main.async {
      guard let host = topController(root) else {
        invoke.reject("The share sheet could not be shown.")
        return
      }
      let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
      // An iPad shows the sheet as a popover and crashes without an anchor.
      if let popover = sheet.popoverPresentationController {
        popover.sourceView = host.view
        popover.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1)
        popover.permittedArrowDirections = []
      }
      sheet.completionWithItemsHandler = { activity, completed, _, _ in
        invoke.resolve([
          "presented": true,
          "completed": completed,
          "target": activity?.rawValue ?? "",
        ])
      }
      host.present(sheet, animated: true)
    }
  }

  /// Why the photo library refused a file: `no-space`, `denied` or `failed`.
  ///
  /// The library names both causes itself (PHPhotosError 3305 "not enough
  /// space", 3310 and 3311 for access). Some versions answer a full disk
  /// with a general error instead, so a disk that has less room than the
  /// file needs counts as full too.
  static func photosFailure(_ error: Error?, fileBytes: Int64) -> String {
    var current = error as NSError?
    while let ns = current {
      if ns.domain == PHPhotosErrorDomain {
        if ns.code == 3305 { return "no-space" }
        if ns.code == 3310 || ns.code == 3311 { return "denied" }
      }
      if ns.domain == NSCocoaErrorDomain && ns.code == NSFileWriteOutOfSpaceError { return "no-space" }
      if ns.domain == NSPOSIXErrorDomain && ns.code == Int(ENOSPC) { return "no-space" }
      current = ns.userInfo[NSUnderlyingErrorKey] as? NSError
    }
    if fileBytes > 0 {
      let free = Device.diskSpace(at: nil).free
      if free > 0 && free < fileBytes { return "no-space" }
    }
    return "failed"
  }

  static func saveToPhotos(_ invoke: Invoke) {
    guard let args = try? invoke.parseArgs(PhotosArgs.self) else {
      invoke.reject("The save request is not valid.")
      return
    }
    let url = URL(fileURLWithPath: args.path)
    guard FileManager.default.fileExists(atPath: args.path) else {
      invoke.reject("That file does not exist.", code: "failed")
      return
    }
    // Without the usage text iOS ends the app the moment the library is asked for.
    guard Bundle.main.object(forInfoDictionaryKey: "NSPhotoLibraryAddUsageDescription") != nil else {
      invoke.reject("This build of the app may not add to the photo library.", code: "failed")
      return
    }
    // Add only: the app never reads the library, so it never asks to.
    PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
      guard status == .authorized || status == .limited else {
        invoke.reject(
          "LU is not allowed to add to your photo library. Allow it under Settings, Privacy and Security, Photos.",
          code: "denied")
        return
      }
      var identifier = ""
      PHPhotoLibrary.shared().performChanges({
        let request = PHAssetCreationRequest.forAsset()
        let options = PHAssetResourceCreationOptions()
        options.shouldMoveFile = false
        request.addResource(with: args.kind == "video" ? .video : .photo, fileURL: url, options: options)
        identifier = request.placeholderForCreatedAsset?.localIdentifier ?? ""
      }) { ok, error in
        if ok {
          invoke.resolve(["saved": true, "uri": identifier])
        } else {
          // Three fixed codes, see `photos` in src/commands.rs. The sentences
          // are worded so that a reader of the text alone lands on the same answer.
          switch photosFailure(error, fileBytes: args.bytes ?? 0) {
          case "no-space":
            invoke.reject("There is not enough free space on this phone to save this. Free up space, then try again.", code: "no-space")
          case "denied":
            invoke.reject(
              "LU is not allowed to add to your photo library. Allow it under Settings, Privacy and Security, Photos.",
              code: "denied")
          default:
            let detail = (error as NSError?)?.code ?? 0
            invoke.reject("The photo library did not accept this file (\(detail)). The format may not be supported.", code: "failed")
          }
        }
      }
    }
  }

  static func saveToFiles(_ invoke: Invoke, root: UIViewController?) {
    guard let args = try? invoke.parseArgs(FilesArgs.self) else {
      invoke.reject("The save request is not valid.")
      return
    }
    var source = URL(fileURLWithPath: args.path)
    guard FileManager.default.fileExists(atPath: args.path) else {
      invoke.reject("That file does not exist.")
      return
    }
    // The picker offers the file under its own name. If the caller wants
    // another one, export a copy that carries it.
    var copyFolder: URL?
    if let wanted = args.filename, !wanted.isEmpty, wanted != source.lastPathComponent {
      let folder = FileManager.default.temporaryDirectory.appendingPathComponent("lu-export-\(UUID().uuidString)")
      do {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let copy = folder.appendingPathComponent(wanted)
        try FileManager.default.copyItem(at: source, to: copy)
        source = copy
        copyFolder = folder
      } catch {
        invoke.reject("The file could not be prepared for saving.")
        return
      }
    }
    DispatchQueue.main.async {
      guard let host = topController(root) else {
        invoke.reject("The save dialog could not be shown.")
        return
      }
      let picker = UIDocumentPickerViewController(forExporting: [source], asCopy: true)
      let delegate = ExportDelegate(invoke: invoke) {
        if let folder = copyFolder {
          try? FileManager.default.removeItem(at: folder)
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
}
