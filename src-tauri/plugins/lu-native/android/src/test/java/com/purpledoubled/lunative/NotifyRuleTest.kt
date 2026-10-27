package com.purpledoubled.lunative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// The question for notifications (NotifyRule.kt, acceptance android-4gb, F9).
// Run from src-tauri/gen/android:
//   ./gradlew :tauri-plugin-lu-native:testDebugUnitTest
class NotifyRuleTest {
  @Test
  fun theFirstDownloadOnAndroid13PutsTheQuestion() {
    assertEquals(NotifyRule.Step.ASK, NotifyRule.step(sdk = 34, shown = false, askedBefore = false, ask = true))
    assertEquals(NotifyRule.Step.ASK, NotifyRule.step(sdk = 33, shown = false, askedBefore = false, ask = true))
  }

  @Test
  fun aNoStandsAndIsNotAskedAgain() {
    assertEquals(NotifyRule.Step.REFUSED, NotifyRule.step(sdk = 34, shown = false, askedBefore = true, ask = true))
    assertEquals(NotifyRule.Step.REFUSED, NotifyRule.step(sdk = 34, shown = false, askedBefore = true, ask = false))
  }

  @Test
  fun lookingAtTheStateNeverPutsTheQuestion() {
    assertEquals(NotifyRule.Step.OPEN, NotifyRule.step(sdk = 34, shown = false, askedBefore = false, ask = false))
    assertEquals(NotifyRule.Step.GRANTED, NotifyRule.step(sdk = 34, shown = true, askedBefore = false, ask = false))
  }

  @Test
  fun aYesNeedsNoSecondQuestion() {
    assertEquals(NotifyRule.Step.GRANTED, NotifyRule.step(sdk = 34, shown = true, askedBefore = true, ask = true))
    assertEquals(NotifyRule.Step.GRANTED, NotifyRule.step(sdk = 34, shown = true, askedBefore = false, ask = true))
  }

  @Test
  fun beforeAndroid13ThereIsNoQuestion() {
    assertFalse(NotifyRule.needed(32))
    assertTrue(NotifyRule.needed(33))
    assertEquals(NotifyRule.Step.GRANTED, NotifyRule.step(sdk = 31, shown = true, askedBefore = false, ask = true))
    // Switched off in the system settings: the app cannot ask, only the system settings help.
    assertEquals(NotifyRule.Step.REFUSED, NotifyRule.step(sdk = 31, shown = false, askedBefore = false, ask = true))
  }
}
