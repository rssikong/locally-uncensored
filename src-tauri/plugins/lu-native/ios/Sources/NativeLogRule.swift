import Foundation

// Where the log of the native layer lies (LuNativePlugin.log). It hangs on
// Foundation only, so scripts/mobile/native-guard-tests.sh runs it on the Mac.
//
// The app shows its Documents folder in the Files app, as the folder "LU":
// that is where a model file of the user's own may lie. A log file there is
// something the user sees and did not put there (check on the iPhone,
// round 22, N6). So the log lies in Library/Caches, which no app shows and
// no backup takes.
enum NativeLogRule {
  static let name = "lu-native.log"

  /// The file the plugin writes: in the caches folder of the app.
  static func file(caches: URL) -> URL {
    return caches.appendingPathComponent(name)
  }

  /// Where an older build wrote it. Removed when it is found.
  static func oldFile(documents: URL) -> URL {
    return documents.appendingPathComponent(name)
  }

  /// A folder the Files app can show: Documents and everything below it.
  static func userVisible(_ path: String) -> Bool {
    return path.split(separator: "/").contains("Documents")
  }
}
