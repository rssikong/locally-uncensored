package com.purpledoubled.lunative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.InetAddress
import java.net.URL

// The address rule of a download, against the table Rust and Swift are
// pinned to as well (testdata/net-vectors.tsv). Run from src-tauri/gen/android:
//   ./gradlew :tauri-plugin-lu-native:testDebugUnitTest
class NetGuardTest {
  private fun table(): List<List<String>> {
    // Gradle runs unit tests in the folder of the module (android/).
    val file = listOf(File("../testdata/net-vectors.tsv"), File("testdata/net-vectors.tsv")).first { it.isFile }
    return file.readLines().filter { it.isNotBlank() && !it.startsWith("#") }.map { it.split('\t') }
  }

  private fun word(kind: NetGuard.Kind?): String = when (kind) {
    NetGuard.Kind.LOOPBACK -> "loopback"
    NetGuard.Kind.PRIVATE -> "private"
    NetGuard.Kind.LOCAL_NAME -> "localname"
    NetGuard.Kind.TUNNEL -> "tunnel"
    NetGuard.Kind.RESERVED -> "reserved"
    NetGuard.Kind.PUBLIC -> "public"
    null -> "invalid"
  }

  @Test
  fun theSharedTableHolds() {
    val rows = table()
    assertTrue("the table lost rows: ${rows.size}", rows.size >= 60)
    for (cols in rows) {
      assertEquals("four columns separated by one tab: $cols", 4, cols.size)
      val (raw, kind, store, acceptance) = cols
      val url = try { URL(raw) } catch (_: Exception) { null }
      val host = url?.host
      val actual = if (url == null || host.isNullOrEmpty()) "invalid" else word(NetGuard.classifyHost(host))
      assertEquals("kind of $raw", kind, actual)
      assertEquals("store build, $raw", store == "yes", url != null && NetGuard.refuseByText(url, false) == null)
      assertEquals("acceptance build, $raw", acceptance == "yes", url != null && NetGuard.refuseByText(url, true) == null)
    }
  }

  private fun answers(vararg ips: String): (String) -> Array<InetAddress> = { _ -> ips.map { InetAddress.getByName(it) }.toTypedArray() }

  @Test
  fun aNameIsJudgedByTheAddressItAnswersWith() {
    val url = URL("https://models.attacker.example/m.gguf")
    // Nothing about the text is suspicious.
    assertNull(NetGuard.refuseByText(url, false))
    for (hostile in listOf("192.168.1.1", "10.0.0.5", "127.0.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "100.64.0.1")) {
      assertNotNull("$hostile was let through", NetGuard.refuse(url, false, answers(hostile)))
    }
    // One poisoned record among good ones is enough.
    assertNotNull(NetGuard.refuse(url, false, answers("93.184.216.34", "192.168.1.1")))
    assertNull(NetGuard.refuse(url, false, answers("93.184.216.34")))
    assertNull(NetGuard.refuse(url, false, answers("93.184.216.34", "2606:4700::1111")))
  }

  @Test
  fun theAcceptanceSwitchOpensTestServersAndNeverTheMetadataAddress() {
    val test = URL("http://10.0.2.2:8799/a.bin")
    assertNotNull(NetGuard.refuse(test, false, answers("10.0.2.2")))
    assertNull(NetGuard.refuse(test, true, answers("10.0.2.2")))
    assertNotNull(NetGuard.refuse(URL("http://169.254.169.254/latest/"), true, answers("169.254.169.254")))
    // A name that resolves to the metadata address stays closed as well.
    assertNotNull(NetGuard.refuse(URL("https://cdn.example/x"), true, answers("169.254.169.254")))
    // Plain http to the public internet is never a download.
    assertNotNull(NetGuard.refuse(URL("http://example.com/a.bin"), true, answers("93.184.216.34")))
  }

  @Test
  fun aNameThatCannotBeLookedUpIsAnErrorOfTheNetworkAndNotARefusal() {
    val url = URL("https://huggingface.co/m.gguf")
    val failing: (String) -> Array<InetAddress> = { throw java.net.UnknownHostException(it) }
    var thrown = false
    try { NetGuard.refuse(url, false, failing) } catch (_: java.io.IOException) { thrown = true }
    assertTrue("the transfer has to see an IOException and wait for the network", thrown)
  }

  @Test
  fun numbersInEverySpellingAreRead() {
    assertEquals(listOf(127, 0, 0, 1), NetGuard.parseV4("127.0.0.1")!!.toList())
    assertEquals(listOf(127, 0, 0, 1), NetGuard.parseV4("0x7f.1")!!.toList())
    assertEquals(listOf(127, 0, 0, 1), NetGuard.parseV4("2130706433")!!.toList())
    assertEquals(listOf(127, 0, 0, 1), NetGuard.parseV4("017700000001")!!.toList())
    assertEquals(listOf(169, 254, 169, 254), NetGuard.parseV4("0xA9FEA9FE")!!.toList())
    assertEquals(listOf(10, 1, 0, 5), NetGuard.parseV4("10.1.5")!!.toList())
    for (name in listOf("huggingface.co", "desktop", "1.2.3.4.5", "256.1.1.1", "1..2", "", "0x", "4294967296", "a.1")) {
      assertNull(name, NetGuard.parseV4(name))
    }
  }
}
