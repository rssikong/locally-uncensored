package com.purpledoubled.lunative

import android.webkit.WebViewClient
import java.lang.reflect.Modifier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The end of the renderer (RenderGuard.kt, the Android half of finding N3 of
// the iPhone review). Run from src-tauri/gen/android:
//   ./gradlew :tauri-plugin-lu-native:testDebugUnitTest
class RenderGuardTest {
  @Test
  fun onTheScreenTheAppStartsAgainAtOnce() {
    assertEquals(RenderGone.Step.RESTART, RenderGone.step(visible = true, now = 1_000_000, earlier = emptyList()))
  }

  @Test
  fun inTheBackgroundTheRestartWaitsForTheWayBack() {
    assertEquals(RenderGone.Step.RESTART_ON_RETURN, RenderGone.step(visible = false, now = 1_000_000, earlier = emptyList()))
  }

  @Test
  fun aRendererThatDiesOnEveryStartIsNotALoop() {
    val now = 1_000_000L
    assertEquals(RenderGone.Step.RESTART, RenderGone.step(true, now, listOf(now - 50_000, now - 10_000)))
    assertEquals(RenderGone.Step.END, RenderGone.step(true, now, listOf(now - 50_000, now - 20_000, now - 10_000)))
    assertEquals(RenderGone.Step.END, RenderGone.step(false, now, listOf(now - 50_000, now - 20_000, now - 10_000)))
  }

  @Test
  fun oldRestartsDoNotCountForEver() {
    val now = 1_000_000L
    assertEquals(RenderGone.Step.RESTART, RenderGone.step(true, now, listOf(now - 300_000, now - 200_000, now - 61_000)))
    // A clock that was set back must not lock the app out.
    assertEquals(RenderGone.Step.RESTART, RenderGone.step(true, now, listOf(now + 5_000, now + 6_000, now + 7_000)))
    assertEquals(listOf(now - 1_000), RenderGone.recent(now, listOf(now - 70_000, now - 1_000, now + 1)))
  }

  // Acceptance android-4gb, F14: after the third end in a row the app closed
  // without a word, and the next start said nothing.
  @Test
  fun theEndOfTheLoopOwesASentenceAndARestartDoesNot() {
    val now = 1_000_000L
    val third = RenderGone.step(true, now, listOf(now - 15_000, now - 8_000, now - 1_000))
    assertEquals(RenderGone.Step.END, third)
    assertTrue(RenderGone.owesWord(third))
    assertTrue(!RenderGone.owesWord(RenderGone.Step.RESTART))
    assertTrue(!RenderGone.owesWord(RenderGone.Step.RESTART_ON_RETURN))
  }

  @Test
  fun theNextStartSaysItOnce() {
    assertEquals("LU closed because the page kept failing. Your chats are saved.", RenderGone.sayAtStart(1_000_000L))
    // Nothing was noted, or the note was taken at the start before: nothing to say.
    assertEquals(null, RenderGone.sayAtStart(null))
    assertEquals(null, RenderGone.sayAtStart(0L))
    // English, one line, no dash of the long kind.
    assertTrue(!RenderGone.ENDED_TEXT.contains('\u2014') && !RenderGone.ENDED_TEXT.contains('\u2013'))
  }

  @Test
  fun theCountSurvivesTheDisk() {
    assertEquals(listOf(1L, 22L, 333L), RenderGone.parse(RenderGone.format(listOf(1L, 22L, 333L))))
    assertEquals(emptyList<Long>(), RenderGone.parse(null))
    assertEquals(emptyList<Long>(), RenderGone.parse(""))
    assertEquals(listOf(7L), RenderGone.parse("x, 7,,"))
  }

  // The client in front has to pass on every call the system makes, or wry
  // stops hearing about it (pages, requests, the links it opens). The forms
  // listed here are the old ones the client behind reaches by itself.
  @Test
  fun theClientInFrontPassesOnEveryCallOfTheSystem() {
    val reachedThroughTheNewerForm = setOf(
      "shouldOverrideUrlLoading(WebView,String)",
      "shouldInterceptRequest(WebView,String)",
      "onReceivedError(WebView,int,String,String)",
      "onTooManyRedirects(WebView,Message,Message)",
    )
    fun name(m: java.lang.reflect.Method) = m.name + m.parameterTypes.joinToString(",", "(", ")") { it.simpleName }
    val system = WebViewClient::class.java.declaredMethods
      .filter { Modifier.isPublic(it.modifiers) && !Modifier.isStatic(it.modifiers) && !it.isSynthetic }
      .map(::name).toSet()
    val passedOn = GuardedWebViewClient::class.java.declaredMethods
      .filter { Modifier.isPublic(it.modifiers) && !it.isSynthetic && !it.isBridge }
      .map(::name).toSet()
    assertTrue("the SDK lost the calls this test knows: $system", system.contains("onRenderProcessGone(WebView,RenderProcessGoneDetail)"))
    val missing = system - passedOn - reachedThroughTheNewerForm
    assertEquals("calls of the system that never reach wry's client", emptySet<String>(), missing)
    for (old in reachedThroughTheNewerForm) {
      assertTrue("$old would run twice", !passedOn.contains(old))
      assertTrue("$old is not a call of WebViewClient any more", system.contains(old))
    }
  }
}
