import Foundation

// The part of the sign-in sheet for a web page that needs no screen
// (WebAuth.swift has the rest). It hangs on Foundation only, so
// scripts/mobile/native-guard-tests.sh runs it on the Mac.
//
// The sheet is ASWebAuthenticationSession: the page of Google or GitHub
// opens over the app, and the sheet closes by itself when the page ends on
// a link of the app (`lu://oauth/callback?code=...`). The link is handed
// back to the page of the app and nothing of it is kept here.
enum WebAuthRule {
  /// The sheet shares the cookies of Safari: who is signed in to Google
  /// there is not asked for the password again. The system asks once
  /// whether the app may use the sign-in of that website.
  static let ephemeral = false

  /// The page the sheet opens: an https address with a host, nothing else.
  static func page(_ raw: String) -> URL? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text.utf8.count <= 4096,
      let url = URL(string: text), url.scheme?.lowercased() == "https",
      let host = url.host, !host.isEmpty
    else { return nil }
    return url
  }

  /// Schemes a browser follows itself. With one of them as the way back the
  /// sheet would close on the first page it loads.
  private static let ofTheSystem: Set<String> = ["http", "https", "file", "ftp", "mailto", "tel", "sms", "data", "javascript", "about", "blob", "tauri"]

  /// The scheme the sheet waits for, in lower case: a letter, then letters,
  /// digits, plus, dash or dot, at most 32 characters, and one of the app.
  static func scheme(_ raw: String) -> String? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let bytes = Array(text.utf8)
    guard let first = bytes.first, first >= 97, first <= 122, bytes.count <= 32 else { return nil }
    let fits = bytes.allSatisfy { byte in
      (byte >= 97 && byte <= 122) || (byte >= 48 && byte <= 57) || byte == 43 || byte == 45 || byte == 46
    }
    guard fits, !ofTheSystem.contains(text) else { return nil }
    return text
  }

  /// Is this the link the sheet was waiting for. Anything else the system
  /// hands back is not passed on to the page.
  static func isCallback(_ url: URL?, scheme: String) -> Bool {
    guard let got = url?.scheme?.lowercased() else { return false }
    return got == scheme
  }

  enum Outcome: Equatable {
    /// The user closed the sheet. Not an error, the page says nothing.
    case cancelled
    /// One English sentence the page shows as it is.
    case failed(String)
  }

  /// ASWebAuthenticationSessionErrorDomain, spelled out so this file needs no screen framework.
  static let errorDomain = "com.apple.AuthenticationServices.WebAuthenticationSession"

  static let failedText = "The sign-in page did not work. Try again."
  static let noWindow = "The sign-in page could not be shown. Try again."
  static let notStarted = "The sign-in page could not be opened. Try again."
  static let noAnswer = "The sign-in page did not come back to LU. Try again."
  static let busy = "A sign-in page is already open."
  static let badRequest = "The sign-in page could not be started. Try again."

  /// What an error of the sheet means. The codes are the ones of
  /// ASWebAuthenticationSessionError: 1 canceledLogin,
  /// 2 presentationContextNotProvided, 3 presentationContextInvalid.
  static func outcome(domain: String, code: Int) -> Outcome {
    guard domain == errorDomain else { return .failed(failedText) }
    switch code {
    case 1:
      return .cancelled
    case 2, 3:
      return .failed(noWindow)
    default:
      return .failed(failedText)
    }
  }
}
