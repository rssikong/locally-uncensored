import Foundation

// The part of "File" in the sheet "Add to message" that needs no screen
// (DocumentPick.swift has the rest). It hangs on Foundation only, so
// scripts/mobile/native-guard-tests.sh runs it on the Mac.
//
// The picker of the system hands out copies of the chosen files. They are
// moved into the temp folder of the app, each into a folder of its own, and
// the page reads them from there. What this file decides: how many files are
// taken, where one lands, and what the page is told about it.
enum DocumentPickRule {
  static let noPicker = "The file picker could not be shown."
  static let badRequest = "The file picker could not be started. Try again."
  static let notRead = "The file could not be read. Try again."

  /// How many files one visit brings: 1 to 20, 1 unless said.
  static func limit(_ raw: Int?) -> Int {
    return min(max(raw ?? 1, 1), 20)
  }

  /// The files that are taken, in the order the picker named them.
  static func taken<T>(_ picked: [T], limit: Int) -> [T] {
    return Array(picked.prefix(max(limit, 0)))
  }

  /// The name the page shows: the last part of the address, never empty and
  /// never a path.
  static func displayName(_ lastPathComponent: String) -> String {
    let name = lastPathComponent.replacingOccurrences(of: "/", with: "_").trimmingCharacters(in: .whitespacesAndNewlines)
    return name.isEmpty || name == "." || name == ".." ? "file" : name
  }

  /// Where a picked file lands: `<dir>/<folder>/file` plus its extension.
  /// The name of the user is not part of the path, so no name can lead out
  /// of the folder. `folder` is a fresh UUID.
  static func target(dir: String, folder: String, pathExtension: String) -> String? {
    guard dir.hasPrefix("/"), !folder.isEmpty, !folder.contains("/"), !folder.contains("..") else { return nil }
    let ext = pathExtension.lowercased()
    let plain = !ext.isEmpty && ext.utf8.count <= 16 && ext.utf8.allSatisfy { ($0 >= 97 && $0 <= 122) || ($0 >= 48 && $0 <= 57) }
    let base = dir.hasSuffix("/") ? String(dir.dropLast()) : dir
    return base + "/" + folder + "/file" + (plain ? "." + ext : "")
  }
}
