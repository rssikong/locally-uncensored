package com.purpledoubled.lunative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TtsTextTest {
  @Test
  fun aShortTextIsOnePiece() {
    assertEquals(listOf("Hello there."), TtsText.chunks("  Hello there.  ", 3999))
    assertTrue(TtsText.chunks("   ", 3999).isEmpty())
  }

  @Test
  fun aLongTextIsCutAtSentencesAndNothingIsLost() {
    val sentence = "This is one sentence of the answer. "
    val text = sentence.repeat(40).trim()
    val parts = TtsText.chunks(text, 200)
    assertTrue(parts.size > 1)
    for (part in parts) {
      assertTrue("piece too long: ${part.length}", part.length <= 200)
      assertTrue("cut inside a sentence: $part", part.endsWith("."))
    }
    assertEquals(text, parts.joinToString(" "))
  }

  @Test
  fun aTextWithoutSpacesIsCutAnywayAndNeverInsideACharacter() {
    val text = "\uD83D\uDE00".repeat(300)
    val parts = TtsText.chunks(text, 201)
    assertEquals(text, parts.joinToString(""))
    for (part in parts) {
      assertTrue(part.length <= 201)
      assertTrue(!Character.isHighSurrogate(part.last()))
      assertTrue(!Character.isLowSurrogate(part.first()))
    }
  }

  @Test
  fun theIdOfAPieceNamesItsTextAndItsPlace() {
    assertEquals(Pair("a-b#c", 3), TtsText.split(TtsText.utteranceId("a-b#c", 3)))
    assertNull(TtsText.split("no-index"))
    assertNull(TtsText.split(null))
    assertNull(TtsText.split("#1"))
  }
}
