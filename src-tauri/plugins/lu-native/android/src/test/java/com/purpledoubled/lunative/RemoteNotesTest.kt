package com.purpledoubled.lunative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Notices of the computer (A17, RemoteNotes.kt): only a link back into LU,
// and a stable id inside the range of these notices.
// Run from src-tauri/gen/android:
//   ./gradlew :tauri-plugin-lu-native:testDebugUnitTest
class RemoteNotesTest {
  @Test
  fun aNoticeOpensOnlyLu() {
    assertTrue(RemoteNotes.linkAllowed(null))
    assertTrue(RemoteNotes.linkAllowed("lu://remote/notice?chat=chat_1"))
    assertFalse(RemoteNotes.linkAllowed("https://example.com"))
    assertFalse(RemoteNotes.linkAllowed("lu://oauth/callback?code=x"))
    assertFalse(RemoteNotes.linkAllowed("lu://remote/notice?" + "x".repeat(300)))
  }

  @Test
  fun theSameNoticeKeepsItsId() {
    assertEquals(RemoteNotes.noteId("answer_chat_1"), RemoteNotes.noteId("answer_chat_1"))
    val id = RemoteNotes.noteId("render_res_1")
    assertTrue(id in 0x4d00..0x4dff)
  }
}
