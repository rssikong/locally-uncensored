package com.purpledoubled.lunative

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QrReadTest {
  private fun picture(text: String, size: Int, rotate: Boolean = false): IntArray {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 4))
    val out = IntArray(size * size)
    for (y in 0 until size) for (x in 0 until size) {
      val (sx, sy) = if (rotate) Pair(y, size - 1 - x) else Pair(x, y)
      // A grey screen, not paper: dark modules at 0x30, light at 0xd0.
      out[y * size + x] = if (matrix.get(sx, sy)) 0xff303030.toInt() else 0xffd0d0d0.toInt()
    }
    return out
  }

  @Test
  fun readsThePairingLinkOfTheDesktop() {
    val link = "lu://remote?v=2&id=or24zD2Qk4Z7byxTVSh6WQ&k=BfxuiDY3CQ1PxDDevIm115xptCqC1tiwC6DVMShSvy4&t=MzMzMzMzMzMzMzMzMzMzMw&n=Studio+PC"
    assertEquals(link, QrRead.decode(picture(link, 600), 600, 600))
  }

  @Test
  fun readsAPhotoTakenSideways() {
    val link = "lu://remote?url=http%3A%2F%2F192.168.1.20%3A11435"
    assertEquals(link, QrRead.decode(picture(link, 400, rotate = true), 400, 400))
  }

  @Test
  fun answersNullForAPictureWithoutACode() {
    assertNull(QrRead.decode(IntArray(300 * 300) { 0xff808080.toInt() }, 300, 300))
    assertNull(QrRead.decode(IntArray(0), 0, 0))
  }
}
