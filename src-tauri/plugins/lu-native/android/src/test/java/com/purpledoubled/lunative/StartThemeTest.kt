package com.purpledoubled.lunative

import android.app.UiModeManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// The colour of the window before the page has drawn (StartTheme.kt). Run
// from src-tauri/gen/android:
//   ./gradlew :tauri-plugin-lu-native:testDebugUnitTest
class StartThemeTest {
  @Test
  fun aFixedChoiceWinsOverTheSystem() {
    assertTrue(StartTheme.isDark("dark", systemDark = false))
    assertFalse(StartTheme.isDark("light", systemDark = true))
  }

  @Test
  fun withoutAChoiceTheSystemDecides() {
    for (pref in listOf(null, "system", "", "Dark", "blue")) {
      assertTrue("$pref", StartTheme.isDark(pref, systemDark = true))
      assertFalse("$pref", StartTheme.isDark(pref, systemDark = false))
      assertEquals("system", StartTheme.parse(pref))
    }
  }

  @Test
  fun theTwoGroundColoursAreTheCanvasOfThePhoneShell() {
    assertEquals(0xFFF3F4F6.toInt(), StartTheme.canvas(dark = false))
    assertEquals(0xFF141414.toInt(), StartTheme.canvas(dark = true))
  }

  // A-06, D3 and D4: the start screen of the system and its bar symbols take
  // the theme the user chose, because the system is told about it.
  @Test
  fun aFixedChoiceBecomesTheNightModeOfTheApp() {
    assertEquals(UiModeManager.MODE_NIGHT_YES, StartTheme.nightMode("dark"))
    assertEquals(UiModeManager.MODE_NIGHT_NO, StartTheme.nightMode("light"))
  }

  @Test
  fun withoutAChoiceTheAppFollowsTheSystemAgain() {
    for (pref in listOf(null, "system", "", "Dark", "blue")) {
      assertEquals("$pref", UiModeManager.MODE_NIGHT_AUTO, StartTheme.nightMode(pref))
    }
  }

  @Test
  fun theSystemIsToldOncePerChange() {
    // Nothing known (fresh install, cleared data): told once, also for "system", so an old fixed mode is taken back.
    assertTrue(StartTheme.mustTellSystem("system", null))
    assertTrue(StartTheme.mustTellSystem("dark", null))
    assertFalse(StartTheme.mustTellSystem("dark", "dark"))
    assertFalse(StartTheme.mustTellSystem(null, "system"))
    assertTrue(StartTheme.mustTellSystem("light", "dark"))
    assertTrue(StartTheme.mustTellSystem("system", "dark"))
  }
}
