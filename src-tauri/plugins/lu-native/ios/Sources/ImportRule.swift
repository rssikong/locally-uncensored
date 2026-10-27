import Foundation

// The two rules of a model file on the phone that need no screen and no
// Tauri, so they are run on the build machine too
// (scripts/mobile/native-guard-tests.sh).

/// A model is gigabytes that can be fetched or brought in again. It does not
/// belong in the user's iCloud backup or in the backup on a computer.
///
/// The model folder lies in the data folder of the app, and that folder is
/// part of the backup. The exclusion hangs on each file, so every way a
/// model file comes to be has to set it: the download did, the import of a
/// file of the user's own did not (review of round 6, finding 5).
enum BackupRule {
  /// Take the file or folder at `path` out of the backup. True when the mark
  /// is there afterwards. The mark stays on a file that is renamed.
  @discardableResult
  static func exclude(_ path: String) -> Bool {
    var url = URL(fileURLWithPath: path)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
    return isExcluded(path)
  }

  static func isExcluded(_ path: String) -> Bool {
    var url = URL(fileURLWithPath: path)
    // Asked fresh: the value of a URL is cached per object.
    url.removeAllCachedResourceValues()
    return (try? url.resourceValues(forKeys: [.isExcludedFromBackupKey]))?.isExcludedFromBackup ?? false
  }
}

/// Whether the import that is running was cancelled.
///
/// Cleared when an import BEGINS (the picker opens), not when the copy
/// begins. Cleared at the copy, a Cancel that arrived while the file was
/// still being picked and judged was wiped out, and the copy ran although the
/// user had stopped it (review of round 6, finding 12).
enum ImportCancel {
  private static let lock = NSLock()
  private static var flag = false

  /// A new import starts: whatever was cancelled before does not concern it.
  static func begin() {
    lock.lock(); flag = false; lock.unlock()
  }

  static func cancel() {
    lock.lock(); flag = true; lock.unlock()
  }

  static var cancelled: Bool {
    lock.lock(); defer { lock.unlock() }
    return flag
  }
}
