package com.purpledoubled.lunative

import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.GlobalHistogramBinarizer
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

// Reads the QR code in a photo (round 57). The Android app scans with the
// camera app of the system, which needs no camera permission, and this pure
// Java decoder: no Google services, no camera stack in the app.
object QrRead {
  private val hints = mapOf(
    DecodeHintType.TRY_HARDER to true,
    DecodeHintType.CHARACTER_SET to "UTF-8",
  )

  /** The text of the first QR code in these ARGB pixels, or null. Never throws. */
  fun decode(pixels: IntArray, width: Int, height: Int): String? {
    if (width <= 0 || height <= 0 || pixels.size < width * height) return null
    val source: LuminanceSource = RGBLuminanceSource(width, height, pixels)
    // A photo of a screen is uneven: the local binarizer first, the global one for flat pictures.
    for (bitmap in listOf(BinaryBitmap(HybridBinarizer(source)), BinaryBitmap(GlobalHistogramBinarizer(source)))) {
      try {
        val text = QRCodeReader().decode(bitmap, hints).text
        if (!text.isNullOrEmpty()) return text
      } catch (_: Exception) {
        // NotFound, Checksum, Format: try the next way.
      }
    }
    return null
  }
}
