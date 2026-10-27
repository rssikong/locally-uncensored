import Foundation

// Which addresses a download may fetch from.
//
// The rule is the one of src/net.rs (`check_public_url`): https to a public
// host, and nothing in a private network, on this device, or in a reserved
// range. Rust applies it to the address a download is started with and, on
// iOS, walks the redirects by hand before the system gets the transfer
// (`net::walk_redirects`).
//
// What is left for this file: a background URLSession follows redirects by
// itself and does not ask the app (`willPerformHTTPRedirection` is not
// called for it). So Downloads.swift looks at where the bytes of a transfer
// REALLY come from, as soon as the first of them arrive and again at the
// end, and throws the transfer away when that address breaks the rule.
//
// Only Foundation on purpose: scripts/mobile/native-guard-tests.sh compiles
// this file for the Mac and runs it against testdata/net-vectors.tsv, the
// table Rust and Kotlin are pinned to as well.
enum NetGuard {
  enum Kind: String {
    case loopback, privateRange = "private", localName = "localname", tunnel, reserved, publicHost = "public"
  }

  /// The sentence a download ends with when a redirect breaks the rule. Same words as net.rs.
  static let redirectRefused = "This download was redirected to an address that is not allowed."

  private static let localSuffixes = [".local", ".lan", ".home", ".internal", ".home.arpa", ".fritz.box"]

  static func classifyV4(_ o: [UInt8]) -> Kind {
    let a = o[0], b = o[1], c = o[2]
    if a == 127 { return .loopback }
    if a == 169 && b == 254 { return .reserved }
    if a == 10 || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168) || (a == 100 && (64...127).contains(b)) {
      return .privateRange
    }
    if a == 0 || a >= 224 { return .reserved }
    // The three documentation ranges.
    if (a == 192 && b == 0 && c == 2) || (a == 198 && b == 51 && c == 100) || (a == 203 && b == 0 && c == 113) {
      return .reserved
    }
    return .publicHost
  }

  static func classifyV6(_ u: [UInt8]) -> Kind {
    // ::ffff:a.b.c.d is that IPv4 address.
    if u[0..<10].allSatisfy({ $0 == 0 }) && u[10] == 0xff && u[11] == 0xff {
      return classifyV4(Array(u[12..<16]))
    }
    let first = (UInt16(u[0]) << 8) | UInt16(u[1])
    if u[0..<15].allSatisfy({ $0 == 0 }) && u[15] == 1 { return .loopback }
    if u.allSatisfy({ $0 == 0 }) || u[0] == 0xff { return .reserved }
    if (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80 { return .privateRange }
    return .publicHost
  }

  /// An IPv4 address in any spelling the system resolver accepts:
  /// `127.0.0.1`, `0x7f.1`, `2130706433`, `017700000001`. Nil for a name.
  static func parseV4(_ host: String) -> [UInt8]? {
    let parts = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
    if parts.isEmpty || parts.count > 4 || parts.contains(where: { $0.isEmpty }) { return nil }
    var numbers: [UInt64] = []
    for part in parts {
      let value: UInt64?
      let lower = part.lowercased()
      if lower.count > 2 && lower.hasPrefix("0x") {
        value = UInt64(lower.dropFirst(2), radix: 16)
      } else if part.count > 1 && part.hasPrefix("0") {
        value = UInt64(part, radix: 8)
      } else if part.allSatisfy({ $0.isASCII && $0.isNumber }) {
        value = UInt64(part, radix: 10)
      } else {
        value = nil
      }
      guard let number = value else { return nil }
      numbers.append(number)
    }
    // All parts but the last are one byte each, the last one fills the rest.
    let last = numbers[numbers.count - 1]
    let room = UInt64(4 - (numbers.count - 1))
    if last >= (UInt64(1) << (8 * room)) { return nil }
    var packed = last
    for i in 0..<(numbers.count - 1) {
      if numbers[i] > 255 { return nil }
      packed |= numbers[i] << UInt64(8 * (3 - i))
    }
    return [UInt8((packed >> 24) & 0xff), UInt8((packed >> 16) & 0xff), UInt8((packed >> 8) & 0xff), UInt8(packed & 0xff)]
  }

  static func parseV6(_ host: String) -> [UInt8]? {
    var address = in6_addr()
    // A zone (`fe80::1%en0`) is not part of the address.
    let bare = host.split(separator: "%", maxSplits: 1).first.map(String.init) ?? host
    guard inet_pton(AF_INET6, bare, &address) == 1 else { return nil }
    return withUnsafeBytes(of: &address) { Array($0) }
  }

  /// Where a host points, as far as its text alone can tell. No lookup.
  static func classifyHost(_ rawHost: String) -> Kind? {
    var host = rawHost.trimmingCharacters(in: .whitespaces)
    if host.isEmpty { return nil }
    if host.hasPrefix("[") && host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
    if host.contains(":") {
      guard let bytes = parseV6(host) else { return nil }
      return classifyV6(bytes)
    }
    // One dot at the end is the root of the name space, `127.0.0.1.` is
    // still that address.
    var name = host.lowercased()
    while name.hasSuffix(".") { name.removeLast() }
    if name.isEmpty { return nil }
    if let v4 = parseV4(name) { return classifyV4(v4) }
    if name == "localhost" || name.hasSuffix(".localhost") { return .loopback }
    if name.hasSuffix(".trycloudflare.com") { return .tunnel }
    if localSuffixes.contains(where: { name.hasSuffix($0) }) || !name.contains(".") { return .localName }
    return .publicHost
  }

  /// Scheme, user and host of an address, read with the parser the system
  /// itself uses for a request.
  static func parts(_ raw: String) -> (scheme: String, hasUser: Bool, host: String)? {
    guard let components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
      let scheme = components.scheme?.lowercased()
    else { return nil }
    let hasUser = !(components.user ?? "").isEmpty || components.password != nil
    return (scheme, hasUser, components.host ?? "")
  }

  /// Nil when a download may fetch from this address, else why not.
  /// `allowLocal` is the switch of an acceptance build, which lets its test
  /// servers through.
  static func refuse(_ raw: String, allowLocal: Bool) -> String? {
    guard let (scheme, hasUser, host) = parts(raw) else { return "That address is not valid." }
    if scheme != "http" && scheme != "https" { return "Only https addresses can be downloaded." }
    if hasUser { return "An address with a user name or password in it is not allowed." }
    guard let kind = classifyHost(host) else { return "That address has no host." }
    switch kind {
    case .publicHost, .tunnel:
      return scheme == "https" ? nil : "Downloads need an https address."
    case .privateRange, .loopback, .localName:
      return allowLocal ? nil : "Downloads from a private or local address are not allowed."
    case .reserved:
      return "Downloads from a private or local address are not allowed."
    }
  }

  // ── headers of a transfer the system makes ────────────────────────────
  //
  // A background URLSession follows redirects by itself. The delegate is not
  // asked (`willPerformHTTPRedirection` is called for default and ephemeral
  // sessions only), so the app cannot take a header off before the next host
  // gets the request. What the system does by itself, measured with
  // scripts/mobile/ios-redirect-header-probe.sh: `Authorization` is dropped
  // at every redirect, to the same host as well. Every OTHER header set on
  // the request travels on, to whatever host the redirect names.
  //
  // So a transfer handed to the system carries `Authorization` and nothing
  // else of the caller: the Hugging Face key reaches huggingface.co and not
  // the storage host its answer redirects to, and no later caller can put a
  // second secret under another name on the request without this refusing it.
  // (Android opens every connection itself and keeps all caller headers on
  // the first host, DownloadEngine.kt.)

  /// The only caller header a background transfer may carry.
  static let systemTransferHeader = "authorization"

  /// The caller's headers as they may be set on a request the system follows
  /// redirects for.
  static func headersForSystemTransfer(_ headers: [String: String]) -> [String: String] {
    headers.filter { $0.key.lowercased() == systemTransferHeader }
  }
}
