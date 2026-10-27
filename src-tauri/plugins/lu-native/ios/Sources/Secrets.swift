import Foundation
import Security
import UIKit

// Secure storage on iOS: the Keychain.
//
// Every value is a generic password under one service name, readable after
// the first unlock following a restart and never copied to another device
// (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly). "After first unlock"
// and not "when unlocked", because a background download that finishes while
// the phone is locked may need the token of the next one.
//
// iOS keeps Keychain entries when an app is deleted. A new installation
// would find the session of the previous one, on a phone that may have
// changed hands in between. So the first start of an installation clears the
// service, recognised by a marker in UserDefaults, which IS deleted with the
// app.
//
// One entry is put back after the clearing: the answer "under 18" to the age
// question (FreshInstallRule.swift). Everything else goes, the session, the
// keys and an answer "adult" included.
enum Secrets {
  static let installMarker = "lu-native.keychain.installed"

  static var service: String {
    return (Bundle.main.bundleIdentifier ?? "lu") + ".lu-native"
  }

  private static func query(_ account: String?) -> [String: Any] {
    var q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
    ]
    if let account = account {
      q[kSecAttrAccount as String] = account
    }
    return q
  }

  private static let lock = NSLock()
  private static var settled = false
  /// What the last attempt did, for the log: "kept", "cleared", "cleared, age answer kept" or "skipped".
  private(set) static var lastOutcome = "pending"

  private static func protectedDataAvailable() -> Bool {
    if Thread.isMainThread {
      return UIApplication.shared.isProtectedDataAvailable
    }
    return DispatchQueue.main.sync { UIApplication.shared.isProtectedDataAvailable }
  }

  /// Whether the question "is this a fresh installation" has been answered
  /// in this process. Until then an access may have to ask the main thread
  /// (see below), which code on a serial queue must not do. Seal.swift waits
  /// for this instead of asking.
  static var isSettled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return settled
  }

  /// Runs before every access until it has come to a decision once in this
  /// process. Not at plugin load: that early UIKit still reports protected
  /// data as unavailable, on every start, and the marker would never be set.
  @discardableResult
  static func clearIfFreshInstall() -> String {
    lock.lock()
    if settled {
      lock.unlock()
      return lastOutcome
    }
    lock.unlock()
    let defaults = UserDefaults.standard
    var outcome = "kept"
    if !defaults.bool(forKey: installMarker) {
      // Before the first unlock after a restart UserDefaults can read as
      // empty. Clearing on that evidence would sign the user out of an
      // installation that is months old. Wait for an access that can see.
      if !protectedDataAvailable() {
        lock.lock()
        lastOutcome = "skipped"
        lock.unlock()
        return "skipped"
      }
      // Read what must outlive the clearing first. An entry that cannot be read
      // is not cleared on a guess: the next access tries again.
      let age: String?
      switch rawGet(FreshInstallRule.ageAccount) {
      case .success(let value):
        age = value
      case .failure:
        lock.lock()
        lastOutcome = "skipped"
        lock.unlock()
        return "skipped"
      }
      SecItemDelete(query(nil) as CFDictionary)
      if FreshInstallRule.survives(account: FreshInstallRule.ageAccount, value: age), let age = age {
        _ = rawSet(FreshInstallRule.ageAccount, age)
        outcome = "cleared, age answer kept"
      } else {
        outcome = "cleared"
      }
      defaults.set(true, forKey: installMarker)
    }
    lock.lock()
    settled = true
    lastOutcome = outcome
    lock.unlock()
    return outcome
  }

  static func message(_ status: OSStatus) -> String {
    switch status {
    case errSecInteractionNotAllowed:
      return "The secure storage is locked until the phone has been unlocked once."
    case errSecMissingEntitlement:
      return "This build is not allowed to use the secure storage."
    default:
      return "The secure storage reported an error (\(status))."
    }
  }

  static func get(_ account: String) -> Result<String?, SecretError> {
    clearIfFreshInstall()
    return rawGet(account)
  }

  /// The read itself, without the question about a fresh installation: that question uses it.
  private static func rawGet(_ account: String) -> Result<String?, SecretError> {
    var q = query(account)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &out)
    if status == errSecItemNotFound {
      return .success(nil)
    }
    guard status == errSecSuccess, let data = out as? Data else {
      return .failure(SecretError(text: message(status)))
    }
    return .success(String(data: data, encoding: .utf8))
  }

  static func set(_ account: String, _ value: String) -> Result<Void, SecretError> {
    clearIfFreshInstall()
    return rawSet(account, value)
  }

  private static func rawSet(_ account: String, _ value: String) -> Result<Void, SecretError> {
    let data = Data(value.utf8)
    let update: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    var status = SecItemUpdate(query(account) as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
      var add = query(account)
      add.merge(update) { _, new in new }
      status = SecItemAdd(add as CFDictionary, nil)
    }
    return status == errSecSuccess ? .success(()) : .failure(SecretError(text: message(status)))
  }

  static func delete(_ account: String) -> Result<Void, SecretError> {
    let status = SecItemDelete(query(account) as CFDictionary)
    if status == errSecSuccess || status == errSecItemNotFound {
      return .success(())
    }
    return .failure(SecretError(text: message(status)))
  }
}

struct SecretError: Error {
  let text: String
}
