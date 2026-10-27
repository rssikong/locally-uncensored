package com.purpledoubled.lunative

import java.net.InetAddress
import java.net.URL

// Which addresses a download may fetch from.
//
// The rule is the one of src/net.rs (`check_public_url`): https to a public
// host, and nothing in a private network, on this device, or in a reserved
// range. Rust applies it to the address a download is started with. This
// file applies the SAME rule to every connection the transfer opens after
// that, which is where it was missing: a public address that answers
// "302 Location: https://192.168.1.1/..." was followed. A redirect is
// checked before it is requested, and so is the first address again, because
// here the name can also be judged by what it resolves to.
//
// Plain Kotlin without any Android class on purpose: the download service
// runs without Rust, and the unit test (src/test) runs on the build machine.
// The table both are pinned to is testdata/net-vectors.tsv.
internal object NetGuard {
  enum class Kind { LOOPBACK, PRIVATE, LOCAL_NAME, TUNNEL, RESERVED, PUBLIC }

  /** The sentence a download ends with when a redirect breaks the rule. Same words as net.rs. */
  const val REDIRECT_REFUSED = "This download was redirected to an address that is not allowed."
  const val ADDRESS_REFUSED = "Downloads from a private or local address are not allowed."

  private val LOCAL_SUFFIXES = listOf(".local", ".lan", ".home", ".internal", ".home.arpa", ".fritz.box")

  fun classifyV4(o: IntArray): Kind {
    val a = o[0]; val b = o[1]; val c = o[2]
    return when {
      a == 127 -> Kind.LOOPBACK
      a == 169 && b == 254 -> Kind.RESERVED
      a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 100 && b in 64..127) -> Kind.PRIVATE
      a == 0 || a in 224..239 || a >= 240 -> Kind.RESERVED
      // The three documentation ranges.
      (a == 192 && b == 0 && c == 2) || (a == 198 && b == 51 && c == 100) || (a == 203 && b == 0 && c == 113) -> Kind.RESERVED
      else -> Kind.PUBLIC
    }
  }

  fun classifyV6(bytes: ByteArray): Kind {
    val u = IntArray(16) { bytes[it].toInt() and 0xff }
    // ::ffff:a.b.c.d is that IPv4 address.
    if ((0..9).all { u[it] == 0 } && u[10] == 0xff && u[11] == 0xff) {
      return classifyV4(intArrayOf(u[12], u[13], u[14], u[15]))
    }
    val first = (u[0] shl 8) or u[1]
    return when {
      (0..14).all { u[it] == 0 } && u[15] == 1 -> Kind.LOOPBACK
      u.all { it == 0 } || u[0] == 0xff -> Kind.RESERVED
      (first and 0xfe00) == 0xfc00 || (first and 0xffc0) == 0xfe80 -> Kind.PRIVATE
      else -> Kind.PUBLIC
    }
  }

  fun classifyAddress(address: InetAddress): Kind {
    val raw = address.address
    return if (raw.size == 4) classifyV4(IntArray(4) { raw[it].toInt() and 0xff }) else classifyV6(raw)
  }

  /**
   * An IPv4 address in any of the spellings the system resolver accepts:
   * `127.0.0.1`, `0x7f.1`, `2130706433`, `017700000001`. Null for a name.
   * Written out here, so that no lookup is needed to find out.
   */
  fun parseV4(host: String): IntArray? {
    val parts = host.split('.')
    if (parts.isEmpty() || parts.size > 4 || parts.any { it.isEmpty() }) return null
    val numbers = LongArray(parts.size)
    for ((i, part) in parts.withIndex()) {
      val value = when {
        part.length > 2 && (part.startsWith("0x") || part.startsWith("0X")) -> part.substring(2).toLongOrNull(16)
        part.length > 1 && part.startsWith("0") -> part.toLongOrNull(8)
        part.all { it in '0'..'9' } -> part.toLongOrNull(10)
        else -> null
      } ?: return null
      if (value < 0) return null
      numbers[i] = value
    }
    // All parts but the last are one byte each, the last one fills the rest.
    val last = numbers[numbers.size - 1]
    val room = 4 - (numbers.size - 1)
    if (last >= (1L shl (8 * room))) return null
    var packed = last
    for (i in 0 until numbers.size - 1) {
      if (numbers[i] > 255) return null
      packed = packed or (numbers[i] shl (8 * (3 - i)))
    }
    return intArrayOf(((packed shr 24) and 0xff).toInt(), ((packed shr 16) and 0xff).toInt(), ((packed shr 8) and 0xff).toInt(), (packed and 0xff).toInt())
  }

  /** Where a host points, as far as its text alone can tell. No lookup. */
  fun classifyHost(rawHost: String): Kind? {
    var host = rawHost.trim()
    if (host.isEmpty()) return null
    if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length - 1)
    if (host.contains(':')) {
      // An IPv6 literal. InetAddress parses a literal without asking anyone.
      return try { classifyAddress(InetAddress.getByName(host)) } catch (_: Exception) { null }
    }
    // One dot at the end is the root of the name space, `127.0.0.1.` is
    // still that address.
    val name = host.trimEnd('.').lowercase()
    if (name.isEmpty()) return null
    parseV4(name)?.let { return classifyV4(it) }
    return when {
      name == "localhost" || name.endsWith(".localhost") -> Kind.LOOPBACK
      name.endsWith(".trycloudflare.com") -> Kind.TUNNEL
      LOCAL_SUFFIXES.any { name.endsWith(it) } || !name.contains('.') -> Kind.LOCAL_NAME
      else -> Kind.PUBLIC
    }
  }

  private fun allowed(scheme: String, kind: Kind, allowLocal: Boolean): Boolean = when (kind) {
    Kind.PUBLIC, Kind.TUNNEL -> scheme == "https"
    Kind.PRIVATE, Kind.LOOPBACK, Kind.LOCAL_NAME -> allowLocal && (scheme == "http" || scheme == "https")
    Kind.RESERVED -> false
  }

  /**
   * The rule on the text of an address. `allowLocal` is the switch of an
   * acceptance build, which lets its test servers through. Null when the
   * address may be used, else why not.
   */
  fun refuseByText(url: URL, allowLocal: Boolean): String? {
    val scheme = url.protocol.lowercase()
    if (scheme != "http" && scheme != "https") return "Only https addresses can be downloaded."
    if (!url.userInfo.isNullOrEmpty()) return "An address with a user name or password in it is not allowed."
    val kind = classifyHost(url.host ?: "") ?: return "That address has no host."
    return if (allowed(scheme, kind, allowLocal)) null else ADDRESS_REFUSED
  }

  /**
   * The rule on what the name resolves to: a public looking name whose
   * record is 192.168.1.1 is as private as the number itself. Throws
   * UnknownHostException when the name cannot be looked up, which the
   * transfer treats like any other missing network.
   */
  fun refuseByAddress(url: URL, allowLocal: Boolean, resolve: (String) -> Array<InetAddress> = { InetAddress.getAllByName(it) }): String? {
    val scheme = url.protocol.lowercase()
    var host = url.host ?: return "That address has no host."
    if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length - 1)
    for (address in resolve(host)) {
      if (!allowed(scheme, classifyAddress(address), allowLocal)) return ADDRESS_REFUSED
    }
    return null
  }

  /** Both halves. Null when a connection to this address may be opened. */
  fun refuse(url: URL, allowLocal: Boolean, resolve: (String) -> Array<InetAddress> = { InetAddress.getAllByName(it) }): String? =
    refuseByText(url, allowLocal) ?: refuseByAddress(url, allowLocal, resolve)
}
