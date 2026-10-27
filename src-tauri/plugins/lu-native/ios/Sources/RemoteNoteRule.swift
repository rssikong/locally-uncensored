import Foundation

// The deciding half of the notices of the computer (A17, RemoteNotes.swift).
// Depends on Foundation alone, so scripts/mobile/native-guard-tests.sh
// compiles it for the Mac and checks it.
enum RemoteNoteRule {
  /// Only a link back into LU may sit behind a notice.
  static func linkAllowed(_ url: String?) -> Bool {
    guard let url = url else { return true }
    return url.hasPrefix("lu://remote/notice?") && url.count <= 300
  }
}
