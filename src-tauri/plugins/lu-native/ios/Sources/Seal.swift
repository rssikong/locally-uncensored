import CryptoKit
import Foundation

// What the download list keeps on disk and nobody else may read.
//
// A download of a gated model carries the user's Hugging Face token in its
// request headers. The list of downloads has to survive the process, so the
// headers have to be written somewhere, and iOS additionally hands out
// "resume data" for a paused transfer, which contains the whole original
// request, headers included. Both used to lie in the app's folder as plain
// text. Now both are sealed the way the Android side seals its headers:
//
//   * one random 256 bit key lives in the Keychain (Secrets.swift, this
//     device only, readable after the first unlock) and never touches a file,
//   * the data is encrypted with it (ChaCha20-Poly1305), every time with a
//     fresh nonce, and the name of the entry is authenticated with it, so a
//     blob copied under another download does not open.
//
// Without the key there is nothing to read: a backup of the app folder, a
// file dump or another process that can see the container gets ciphertext.
// When the Keychain cannot be used (before the first unlock after a restart,
// or in the first moments of a start) nothing new is written. Headers that
// were sealed earlier are carried along unopened and opened when they are
// needed. New headers then live as long as the process does, and a transfer
// paused in that state starts again from its first byte, which is the price
// of not falling back to plain text.
enum Seal {
  /// Not in the list of accounts the app's `secret_*` commands accept, so
  /// no page can ask for it.
  static let keyAccount = "lu-native.seal-key.v1"
  /// In front of everything this file writes. A file without it is from
  /// before the sealing and is plain.
  static let magic = Data("LUS1".utf8)

  private static let lock = NSLock()
  private static var cached: SymmetricKey?

  private static func key(create: Bool) -> SymmetricKey? {
    lock.lock()
    defer { lock.unlock() }
    if let key = cached { return key }
    // Until the Keychain has been checked for the leftovers of an earlier
    // installation, an access to it may hop to the main thread, and the
    // download queue this is called from must never wait for that one. So
    // the answer here is "not available yet". The check runs right after the
    // start of the app (LuNativePlugin.attach).
    guard Secrets.isSettled else { return nil }
    if case .success(let stored) = Secrets.get(keyAccount), let text = stored, let raw = Data(base64Encoded: text), raw.count == 32 {
      cached = SymmetricKey(data: raw)
      return cached
    }
    guard create else { return nil }
    // Only a clear "there is none" may lead to a new key. A Keychain that
    // cannot answer right now must not make the old key unreachable.
    guard case .success(nil) = Secrets.get(keyAccount) else { return nil }
    let fresh = SymmetricKey(size: .bits256)
    let raw = fresh.withUnsafeBytes { Data($0) }
    guard case .success = Secrets.set(keyAccount, raw.base64EncodedString()) else { return nil }
    cached = fresh
    return fresh
  }

  /// Nil when the Keychain is not available. The caller then writes nothing.
  static func seal(_ plain: Data, name: String) -> Data? {
    guard let key = key(create: true),
      let box = try? ChaChaPoly.seal(plain, using: key, authenticating: Data(name.utf8))
    else { return nil }
    return magic + box.combined
  }

  /// Nil when this was not written by this key under this name.
  static func open(_ sealed: Data, name: String) -> Data? {
    guard isSealed(sealed), let key = key(create: false),
      let box = try? ChaChaPoly.SealedBox(combined: sealed.dropFirst(magic.count)),
      let plain = try? ChaChaPoly.open(box, using: key, authenticating: Data(name.utf8))
    else { return nil }
    return plain
  }

  static func isSealed(_ data: Data) -> Bool {
    return data.count > magic.count && data.prefix(magic.count) == magic
  }

  static func sealText(_ text: String, name: String) -> String? {
    return seal(Data(text.utf8), name: name)?.base64EncodedString()
  }

  static func openText(_ stored: String, name: String) -> String? {
    guard let raw = Data(base64Encoded: stored), let plain = open(raw, name: name) else { return nil }
    return String(data: plain, encoding: .utf8)
  }
}
