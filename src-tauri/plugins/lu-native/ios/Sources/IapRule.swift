import Foundation

// The part of the in-app purchase of credits that needs no store (Iap.swift
// has the rest). It hangs on Foundation only, so
// scripts/mobile/native-guard-tests.sh runs it on the Mac.
//
// Credits are consumables. One rule carries everything here: a purchase is
// finished only after the account server has credited it. The system hands
// an unfinished transaction out again at every start, so a purchase whose
// credit did not arrive (no network, the app ended, the server was down) is
// never lost. Finishing first would end that: the money is taken, and nothing
// would ever bring the transaction back.
//
// So a purchase is never finished by the purchase itself. It is finished
// when the page asks for it by its id (after the server said "credited"), and
// in one more case: a transaction the store took back has nothing to credit.
enum IapRule {
  /// The event a transaction of the system is handed to the page with.
  static let event = "iap-transaction"

  /// What the sheet of the system ended in, as the page reads it.
  enum Outcome: String {
    /// Bought. The signed transaction goes to the page, unfinished.
    case success
    /// The user closed the sheet. Not an error, the page says nothing.
    case userCancelled
    /// Waiting for somebody else ("Ask to Buy"). Nothing is bought yet.
    case pending
  }

  /// What the sheet of the system can answer, spelled out so this file needs no store framework.
  enum SheetResult {
    case success(verified: Bool)
    case userCancelled
    case pending
    case unknown
  }

  enum PurchaseAnswer: Equatable {
    case outcome(Outcome)
    case failed(String)
  }

  /// What a purchase answers the page. A purchase the store did not sign is not handed on as bought.
  static func answer(_ result: SheetResult) -> PurchaseAnswer {
    switch result {
    case .success(let verified):
      return verified ? .outcome(.success) : .failed(text(.unverified))
    case .userCancelled:
      return .outcome(.userCancelled)
    case .pending:
      return .outcome(.pending)
    case .unknown:
      return .failed(text(.other))
    }
  }

  /// Does the purchase itself finish the transaction. Never: see the head of this file.
  static func finishesAtPurchase(_ outcome: Outcome) -> Bool {
    return false
  }

  /// What happens to one transaction the system reports (at the start, or while the app runs).
  enum Handling: Equatable {
    /// To the page, unfinished: the server credits it, then the page asks for the end.
    case handOver
    /// Nothing to credit: finished without a word to the page.
    case finishQuietly
    /// Not touched: not handed on and not finished.
    case leave
  }

  static func handling(verified: Bool, revoked: Bool, consumable: Bool) -> Handling {
    // A transaction the store did not sign is nobody's purchase. Left alone: finishing it would hide it.
    if !verified { return .leave }
    // Taken back by the store (a refund). The server learns that from the store itself, the app has nothing to hand in.
    if revoked { return .finishQuietly }
    // The app sells consumables only. Anything else was not sold by this code and is not its to end.
    if !consumable { return .leave }
    return .handOver
  }

  /// The product ids the page may ask for: 1 to 20, each 1 to 128 letters, digits, dots, dashes or underscores, none twice.
  static func productIds(_ raw: [String]) -> [String]? {
    guard !raw.isEmpty, raw.count <= 20 else { return nil }
    var seen = Set<String>()
    var list: [String] = []
    for id in raw {
      guard id.utf8.count >= 1, id.utf8.count <= 128 else { return nil }
      let fine = id.utf8.allSatisfy { byte in
        (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte == 45 || byte == 46 || byte == 95
      }
      guard fine else { return nil }
      if seen.insert(id).inserted { list.append(id) }
    }
    return list
  }

  /// The id of the account the purchase belongs to, as the store binds it into the transaction. A UUID, nothing else: no purchase without an account.
  static func accountToken(_ raw: String) -> UUID? {
    guard raw.utf8.count == 36 else { return nil }
    return UUID(uuidString: raw)
  }

  /// The id of a transaction as the page hands it back: digits only, not zero.
  static func transactionId(_ raw: String) -> UInt64? {
    guard !raw.isEmpty, raw.utf8.count <= 20, raw.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) else { return nil }
    guard let id = UInt64(raw), id > 0 else { return nil }
    return id
  }

  enum Failure {
    /// Buying is switched off on this device (Screen Time, a managed device).
    case notAllowed
    /// The store does not know the product, or does not offer it right now.
    case productUnavailable
    case network
    /// Not sold in the country of this account.
    case storefront
    /// The store answered with a transaction it did not sign.
    case unverified
    case other
  }

  static let busy = "Adding credits is already open."
  static let badRequest = "Adding credits could not be started. Try again."
  static let noAccount = "Sign in to your account, then add credits."

  /// One English sentence the page shows as it is.
  static func text(_ failure: Failure) -> String {
    switch failure {
    case .notAllowed:
      return "In-app purchases are turned off on this device. Check Screen Time in the system settings."
    case .productUnavailable:
      return "This pack is not available right now. Try again later."
    case .network:
      return "The App Store could not be reached. Check your connection, then try again."
    case .storefront:
      return "This pack is not available in your region."
    case .unverified:
      return "The App Store did not confirm this purchase, so no credits were added. Try again."
    case .other:
      return "Adding credits did not work. Try again."
    }
  }
}
