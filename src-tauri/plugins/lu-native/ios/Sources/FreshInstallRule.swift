import Foundation

// What the clearing of the Keychain on the first start of an installation
// leaves in place.
//
// iOS keeps Keychain entries when an app is deleted, and Secrets.swift clears
// them on the first start of a new installation: the session and the keys of
// the installation before must not be found by this one. One entry is the
// exception. The answer "under 18" to the age question is kept for good, and
// deleting and installing the app again was a way around it (check on the
// iPhone, M1: 2 of 2, the log of the first start said "keychain=cleared").
//
// Only that answer stays. "adult" goes with everything else: an installation
// that finds nothing asks again, and that is right for a phone that may have
// changed hands.
//
// Foundation only, so scripts/mobile/native-guard-tests.sh can compile and
// run it on the Mac.
enum FreshInstallRule {
  /// The account of the age answer. The shell names it "lu-age-declaration"
  /// (src/mobile/policy/age-vault.ts) and the commands put the prefix for
  /// parked values in front (src-tauri/src/commands/secret.rs, PARKED_PREFIX).
  static let ageAccount = "parked-key:lu-age-declaration"
  /// The one value that outlives a new installation.
  static let lasting = "minor"

  /// Does this entry stay when the Keychain of an earlier installation is cleared.
  static func survives(account: String, value: String?) -> Bool {
    return account == ageAccount && value == lasting
  }
}
