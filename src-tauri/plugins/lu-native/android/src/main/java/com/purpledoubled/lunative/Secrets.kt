package com.purpledoubled.lunative

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Secure storage on Android.
//
// One AES-256-GCM key lives in the Android Keystore and never leaves it: the
// app can ask the Keystore to encrypt and decrypt, it cannot read the key.
// The values are encrypted with it and kept in SharedPreferences that only
// this app can open. Every value has its own random nonce, and the account
// name is authenticated with it, so an entry that is copied under another
// name does not decrypt.
//
// Lifetime: key and file survive a restart and an update of the app. Both
// are removed when the app is uninstalled, Android does that by itself. The
// file is not part of a backup (the app sets allowBackup to false, and the
// key could not be restored to another device anyway).
//
// No user authentication is tied to the key. The values are session tokens
// that the app has to read while a download finishes in the background.
class Secrets(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  class SecretException(message: String) : Exception(message)

  /** The key, made on first use. Only a write may make one. */
  private fun key(): SecretKey {
    existingKey()?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  private fun existingKey(): SecretKey? {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    return store.getKey(ALIAS, null) as? SecretKey
  }

  /** Base64 of nonce (12 bytes) followed by ciphertext and tag. */
  @Synchronized
  fun encrypt(name: String, value: String): String {
    try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      // The Keystore picks the nonce. It refuses a caller-chosen one unless
      // told otherwise, which is the safe default.
      cipher.init(Cipher.ENCRYPT_MODE, key())
      cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
      val sealed = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
      return Base64.encodeToString(cipher.iv + sealed, Base64.NO_WRAP)
    } catch (e: Exception) {
      throw SecretException("The secure storage of this device reported an error (${e.javaClass.simpleName}).")
    }
  }

  /**
   * The value, or an exception. Which exception decides what happens to the
   * entry, see `isGoneForGood`. A read never makes a new key: that would
   * replace the one every other entry was written with.
   */
  @Synchronized
  private fun open(name: String, stored: String): String {
    val raw = try {
      Base64.decode(stored, Base64.NO_WRAP)
    } catch (e: IllegalArgumentException) {
      throw MalformedEntry()
    }
    if (raw.size <= NONCE_BYTES) throw MalformedEntry()
    val key = existingKey() ?: throw KeyNotThere()
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, raw, 0, NONCE_BYTES))
    cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
    return String(cipher.doFinal(raw, NONCE_BYTES, raw.size - NONCE_BYTES), Charsets.UTF_8)
  }

  /** Null when the text was not written by this key under this name. Throws when the Keystore did not answer. */
  fun decrypt(name: String, stored: String): String? {
    return readWithCare(read = { open(name, stored) }, forget = {})
  }

  fun set(account: String, value: String) {
    val sealed = encrypt(account, value)
    if (!prefs.edit().putString(account, sealed).commit()) {
      throw SecretException("The secure storage could not be written.")
    }
  }

  /**
   * Null: nothing is stored under this name. Throws when the Keystore did not
   * answer, and then nothing is removed: the sign-in, the Remote token and
   * the keys are still there for the next try.
   */
  fun get(account: String): String? {
    val stored = prefs.getString(account, null) ?: return null
    return readWithCare(
      read = { open(account, stored) },
      // Proven unreadable for good (the key that wrote it is invalid, or the
      // text is not ours). The app sees "nothing stored", which it knows how
      // to handle: the user signs in again.
      forget = { prefs.edit().remove(account).commit() },
    )
  }

  fun delete(account: String) {
    if (!prefs.edit().remove(account).commit()) {
      throw SecretException("The secure storage could not be written.")
    }
  }

  /** The stored text is not something this class wrote. */
  internal class MalformedEntry : Exception("malformed entry")

  /** The Keystore answered and has no key under our name. Not proof that it is gone: after a boot it may not be reachable yet. */
  internal class KeyNotThere : Exception("no key")

  companion object {
    /** Shown when the Keystore did not answer. Says that nothing was lost. */
    const val NOT_ANSWERING =
      "The secure storage of this device is not answering right now. Nothing was deleted. Try again in a moment. If this stays, sign in again."

    /**
     * True only when the entry can never be read again: the tag does not
     * match (another key wrote it, or it was copied under another name), the
     * system declared the key permanently invalid, or the text is not ours.
     * Everything else (the Keystore service restarting, not ready after a
     * boot, any error nobody knows) may pass, and deleting on it cost the
     * user every sign-in and key at once (review M10).
     *
     * Matched by name through the chain of causes, so the rule can be tested
     * on a plain JVM without the Android classes.
     */
    internal fun isGoneForGood(error: Throwable): Boolean {
      var at: Throwable? = error
      var depth = 0
      while (at != null && depth < 8) {
        if (at is MalformedEntry) return true
        if (at.javaClass.name in GONE_FOR_GOOD) return true
        at = at.cause
        depth++
      }
      return false
    }

    private val GONE_FOR_GOOD = setOf(
      "javax.crypto.AEADBadTagException",
      "android.security.keystore.KeyPermanentlyInvalidatedException",
    )

    /**
     * Read once, and once more after a short pause when the first try failed
     * for a reason that may pass. `forget` runs only for an entry that is
     * gone for good. A failure that stays is thrown, nothing is removed.
     */
    internal fun readWithCare(
      read: () -> String,
      forget: () -> Unit,
      pause: () -> Unit = { try { Thread.sleep(RETRY_PAUSE_MS) } catch (e: InterruptedException) { Thread.currentThread().interrupt() } },
    ): String? {
      var last: Throwable? = null
      for (attempt in 0 until READ_ATTEMPTS) {
        if (attempt > 0) pause()
        try {
          return read()
        } catch (e: Exception) {
          if (isGoneForGood(e)) {
            forget()
            return null
          }
          last = e
        }
      }
      throw SecretException("$NOT_ANSWERING (${last?.javaClass?.simpleName ?: "unknown"})")
    }

    private const val READ_ATTEMPTS = 2
    private const val RETRY_PAUSE_MS = 250L

    const val FILE = "lu_native_secrets"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "lu-native-secrets-v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val NONCE_BYTES = 12
    private const val TAG_BITS = 128
  }
}
