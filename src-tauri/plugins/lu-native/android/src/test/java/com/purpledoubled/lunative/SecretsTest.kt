package com.purpledoubled.lunative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.security.KeyStoreException
import java.security.ProviderException
import javax.crypto.AEADBadTagException

// Review M10: a Keystore that does not answer for a moment must not cost the
// user the sign-in, the Remote token and every key. Only an entry that is
// proven unreadable for good is removed. Run from src-tauri/gen/android:
//   ./gradlew :tauri-plugin-lu-native:testDebugUnitTest
class SecretsTest {
  @Test
  fun onlyAWrongKeyOrAForeignTextCountsAsGoneForGood() {
    assertTrue(Secrets.isGoneForGood(AEADBadTagException("tag")))
    assertTrue(Secrets.isGoneForGood(RuntimeException("wrapped", AEADBadTagException("tag"))))
    assertTrue(Secrets.isGoneForGood(Secrets.MalformedEntry()))

    assertFalse(Secrets.isGoneForGood(KeyStoreException("the service restarted")))
    assertFalse(Secrets.isGoneForGood(ProviderException("Keystore not ready")))
    assertFalse(Secrets.isGoneForGood(Secrets.KeyNotThere()))
    assertFalse(Secrets.isGoneForGood(IllegalStateException("anything nobody knows")))
    assertFalse(Secrets.isGoneForGood(NullPointerException()))
  }

  @Test
  fun aKeystoreThatDoesNotAnswerDeletesNothingAndSaysSo() {
    var forgotten = 0
    var reads = 0
    var pauses = 0
    try {
      Secrets.readWithCare(
        read = { reads++; throw KeyStoreException("the service restarted") },
        forget = { forgotten++ },
        pause = { pauses++ },
      )
      fail("a read that failed twice is an error, not an empty answer")
    } catch (e: Secrets.SecretException) {
      assertTrue(e.message!!.contains("Nothing was deleted"))
      assertTrue(e.message!!.contains("sign in again"))
    }
    assertEquals(0, forgotten)
    assertEquals(2, reads)
    assertEquals(1, pauses)
  }

  @Test
  fun aSecondTryThatWorksGivesTheValue() {
    var forgotten = 0
    var reads = 0
    val value = Secrets.readWithCare(
      read = { if (reads++ == 0) throw ProviderException("not ready") else "token" },
      forget = { forgotten++ },
      pause = {},
    )
    assertEquals("token", value)
    assertEquals(0, forgotten)
    assertEquals(2, reads)
  }

  @Test
  fun anEntryWrittenByAnotherKeyIsRemovedAndReadsAsNothing() {
    var forgotten = 0
    var reads = 0
    val value = Secrets.readWithCare(
      read = { reads++; throw AEADBadTagException("tag") },
      forget = { forgotten++ },
      pause = { fail("no second try for an entry that is gone for good") },
    )
    assertNull(value)
    assertEquals(1, forgotten)
    assertEquals(1, reads)
  }

  @Test
  fun aKeyThatIsMissingAtTheMomentDeletesNothing() {
    var forgotten = 0
    try {
      Secrets.readWithCare(read = { throw Secrets.KeyNotThere() }, forget = { forgotten++ }, pause = {})
      fail("a missing key is an error")
    } catch (e: Secrets.SecretException) {
      assertEquals(0, forgotten)
    }
  }
}
