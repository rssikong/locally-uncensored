import Foundation
import StoreKit
import Tauri

// Credits as an in-app purchase: StoreKit 2, consumables.
//
// What is decided here is decided by IapRule.swift. This file asks the store
// and hands on what it says: the products with the price text of the store,
// the sheet of the system, the transactions that are still open.
//
// A purchase is NOT finished by this file on its own. The page gets the
// signed transaction (a JWS), hands it to the account server, and asks for
// the end with `iapFinish` only after the server has credited it. Until then
// the system keeps the transaction and hands it out again: at every start
// through `iapUnfinished`, and while the app runs through the event
// `iap-transaction` (a purchase somebody else approved, "Ask to Buy").
//
// Nothing is kept here: no transaction, no account, no price. The app shows
// no price of its own, only `displayPrice` as the store words it.
//
// Nothing of this runs until the page calls one of the four commands. A build
// whose page never offers the purchase never asks the store anything.

class IapProductsArgs: Decodable {
  let ids: [String]
}

class IapPurchaseArgs: Decodable {
  let id: String
  let accountToken: String
}

class IapFinishArgs: Decodable {
  let transactionId: String
}

final class Iap {
  static let shared = Iap()

  /// Set by the plugin: the way an event reaches Rust and the page.
  var emit: ((String, JsonObject) -> Void)?

  private let lock = NSLock()
  private var buying = false
  private var listener: Task<Void, Never>?

  /// Follow what the store reports while the app runs. Started with the first command of the page, once.
  private func listen() {
    lock.lock()
    defer { lock.unlock() }
    if listener != nil { return }
    listener = Task.detached(priority: .utility) { [weak self] in
      for await result in Transaction.updates {
        guard let me = self else { return }
        if let entry = await me.sort(result) { me.emit?(IapRule.event, entry) }
      }
    }
  }

  /// One transaction the system reports: an entry for the page, or nil when the rule ends it quietly or leaves it alone.
  private func sort(_ result: VerificationResult<Transaction>) async -> JsonObject? {
    let transaction = result.unsafePayloadValue
    var verified = false
    if case .verified = result { verified = true }
    switch IapRule.handling(verified: verified, revoked: transaction.revocationDate != nil, consumable: transaction.productType == .consumable) {
    case .handOver:
      // `accountToken` is the account the purchase was made for, so the page hands it in for that account only.
      return [
        "transactionId": String(transaction.id), "productId": transaction.productID, "transaction": result.jwsRepresentation,
        "accountToken": transaction.appAccountToken?.uuidString.lowercased() ?? "",
      ]
    case .finishQuietly:
      await transaction.finish()
      return nil
    case .leave:
      return nil
    }
  }

  /// What an error of the store means, in the words of the rule.
  private static func failure(_ error: Error) -> IapRule.Failure {
    if let problem = error as? Product.PurchaseError {
      switch problem {
      case .purchaseNotAllowed:
        return .notAllowed
      case .productUnavailable:
        return .productUnavailable
      default:
        return .other
      }
    }
    if let problem = error as? StoreKitError {
      switch problem {
      case .networkError:
        return .network
      case .notAvailableInStorefront:
        return .storefront
      default:
        return .other
      }
    }
    return .other
  }

  // ── the four commands ─────────────────────────────────────────────────

  /// `{ products: [{ id, displayName, description, displayPrice }], canPurchase }`, in the order the page asked.
  func products(_ invoke: Invoke) {
    guard let args = try? invoke.parseArgs(IapProductsArgs.self), let ids = IapRule.productIds(args.ids) else {
      invoke.reject(IapRule.badRequest)
      return
    }
    listen()
    Task {
      do {
        let found = try await Product.products(for: ids)
        var byId: [String: Product] = [:]
        for product in found where product.type == .consumable { byId[product.id] = product }
        var list: [JsonObject] = []
        for id in ids {
          guard let product = byId[id] else { continue }
          list.append(["id": product.id, "displayName": product.displayName, "description": product.description, "displayPrice": product.displayPrice])
        }
        invoke.resolve(["products": list, "canPurchase": AppStore.canMakePayments])
      } catch {
        invoke.reject(IapRule.text(Iap.failure(error)))
      }
    }
  }

  /// The sheet of the system for one product. `{ state: success, transactionId, productId, transaction }`, `{ state: userCancelled }` or `{ state: pending }`.
  func purchase(_ invoke: Invoke) {
    guard let args = try? invoke.parseArgs(IapPurchaseArgs.self), let ids = IapRule.productIds([args.id]) else {
      invoke.reject(IapRule.badRequest)
      return
    }
    guard let account = IapRule.accountToken(args.accountToken) else {
      invoke.reject(IapRule.noAccount)
      return
    }
    lock.lock()
    if buying {
      lock.unlock()
      invoke.reject(IapRule.busy)
      return
    }
    buying = true
    lock.unlock()
    listen()
    Task { @MainActor in
      let answer = await self.buy(ids[0], account: account)
      self.bought()
      switch answer {
      case .success(let entry):
        invoke.resolve(entry)
      case .failure(let problem):
        invoke.reject(problem.text)
      }
    }
  }

  /// The sheet of the system is gone: the next purchase may start.
  private func bought() {
    lock.lock()
    buying = false
    lock.unlock()
  }

  private struct Problem: Error {
    let text: String
  }

  @MainActor
  private func buy(_ id: String, account: UUID) async -> Result<JsonObject, Problem> {
    do {
      guard let product = try await Product.products(for: [id]).first(where: { $0.type == .consumable }) else {
        return .failure(Problem(text: IapRule.text(.productUnavailable)))
      }
      // The account goes into the transaction, signed by the store: the server credits the account that bought.
      let result = try await product.purchase(options: [.appAccountToken(account)])
      var sheet = IapRule.SheetResult.unknown
      var bought: VerificationResult<Transaction>?
      switch result {
      case .success(let verification):
        var verified = false
        if case .verified = verification { verified = true }
        sheet = .success(verified: verified)
        bought = verification
      case .userCancelled:
        sheet = .userCancelled
      case .pending:
        sheet = .pending
      @unknown default:
        sheet = .unknown
      }
      switch IapRule.answer(sheet) {
      case .failed(let text):
        return .failure(Problem(text: text))
      case .outcome(let outcome):
        guard outcome == .success, let verification = bought else { return .success(["state": outcome.rawValue]) }
        // Bought, and left open on purpose (IapRule.finishesAtPurchase): the page asks for the end after the credit.
        let transaction = verification.unsafePayloadValue
        return .success(["state": outcome.rawValue, "transactionId": String(transaction.id), "productId": transaction.productID, "transaction": verification.jwsRepresentation])
      }
    } catch StoreKitError.userCancelled {
      return .success(["state": IapRule.Outcome.userCancelled.rawValue])
    } catch {
      return .failure(Problem(text: IapRule.text(Iap.failure(error))))
    }
  }

  /// `{ transactions: [{ transactionId, productId, transaction }] }`: every purchase the server has not credited yet.
  func unfinished(_ invoke: Invoke) {
    listen()
    Task {
      var list: [JsonObject] = []
      for await result in Transaction.unfinished {
        if let entry = await self.sort(result) { list.append(entry) }
      }
      invoke.resolve(["transactions": list])
    }
  }

  /// End one purchase, by its id. Asked by the page after the server credited it. `{ ok }`, false when no open purchase has that id.
  func finish(_ invoke: Invoke) {
    guard let args = try? invoke.parseArgs(IapFinishArgs.self), let wanted = IapRule.transactionId(args.transactionId) else {
      invoke.reject(IapRule.badRequest)
      return
    }
    Task {
      for await result in Transaction.unfinished {
        if case .verified(let transaction) = result, transaction.id == wanted {
          await transaction.finish()
          invoke.resolve(["ok": true])
          return
        }
      }
      invoke.resolve(["ok": false])
    }
  }
}
