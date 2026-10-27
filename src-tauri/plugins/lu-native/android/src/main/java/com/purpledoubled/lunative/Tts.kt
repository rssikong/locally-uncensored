package com.purpledoubled.lunative

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

// Read aloud with the speech engine of the system.
//
// The Android WebView has no speechSynthesis, so the page cannot speak by
// itself. This is the way around it: android.speech.tts.TextToSpeech.
//
// One text at a time. A text is cut into pieces the engine accepts and the
// pieces are queued; `tts-start` is sent when the first one begins,
// `tts-end` when the last one is done or the text was stopped, `tts-error`
// when the engine gives up. Every event carries the id of its text.
//
// The engine is bound on the first use and kept. Binding takes a moment and
// can fail (a device without any engine): everything that waited for it is
// answered then.
/** The part without Android in it, so a plain unit test can run it. */
object TtsText {
  /** Cut at the end of a sentence or a word, so no piece is longer than the engine takes. */
  fun chunks(text: String, max: Int): List<String> {
    val limit = if (max < 200) 200 else max
    val out = ArrayList<String>()
    var rest = text.trim()
    while (rest.length > limit) {
      val window = rest.substring(0, limit)
      var cut = maxOf(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "), window.lastIndexOf('\n'))
      if (cut < limit / 2) cut = window.lastIndexOf(' ')
      if (cut < limit / 2) cut = limit - 1
      // Never between the two halves of one character.
      if (Character.isHighSurrogate(rest[cut])) cut -= 1
      out.add(rest.substring(0, cut + 1).trim())
      rest = rest.substring(cut + 1).trim()
    }
    if (rest.isNotEmpty()) out.add(rest)
    return out.filter { it.isNotEmpty() }
  }

  /** `<id>#<index>`: the id of the text and which piece of it. */
  fun utteranceId(id: String, index: Int): String = "$id#$index"

  fun split(utteranceId: String?): Pair<String, Int>? {
    val text = utteranceId ?: return null
    val at = text.lastIndexOf('#')
    if (at <= 0) return null
    val index = text.substring(at + 1).toIntOrNull() ?: return null
    return Pair(text.substring(0, at), index)
  }
}

object Tts {
  private const val TAG = "LuNative"
  private val main = Handler(Looper.getMainLooper())

  /** Set by the plugin: where the three events go. */
  @Volatile var listener: ((String, JSONObject) -> Unit)? = null

  private val lock = Any()
  private var engine: TextToSpeech? = null
  /** null while binding, then whether the engine answered. */
  private var ready: Boolean? = null
  private var binding = false
  private val waiting = ArrayList<(Boolean) -> Unit>()

  /** The text that is being read: its id and how many pieces it has. */
  private var currentId: String? = null
  private var pieces = 0
  private var started = false

  /** Run `body` once the engine is bound. False: the device has none. */
  private fun withEngine(context: Context, body: (Boolean) -> Unit) {
    // 0: bound, run now. 1: someone is binding, wait. 2: bind.
    val state: Int
    synchronized(lock) {
      state = if (ready == true) {
        0
      } else {
        waiting.add(body)
        if (binding) 1 else {
          binding = true
          2
        }
      }
    }
    if (state == 0) {
      body(true)
      return
    }
    if (state == 1) return
    var created: TextToSpeech? = null
    try {
      created = TextToSpeech(context.applicationContext) { status ->
        // Posted, so `created` is set also when an engine answers inside
        // its own constructor.
        main.post { bound(created, status == TextToSpeech.SUCCESS) }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "speech engine could not be created: ${e.javaClass.simpleName}")
      main.post { bound(null, false) }
    }
  }

  private fun bound(created: TextToSpeech?, answered: Boolean) {
    val ok = answered && created != null
    val callbacks: List<(Boolean) -> Unit>
    synchronized(lock) {
      binding = false
      if (ok) {
        engine = created
        ready = true
        created?.setOnUtteranceProgressListener(progress)
      } else {
        // Not remembered as "never": an engine can be installed later.
        ready = null
      }
      callbacks = ArrayList(waiting)
      waiting.clear()
    }
    if (!ok) {
      try { created?.shutdown() } catch (_: Throwable) {}
    }
    for (callback in callbacks) callback(ok)
  }

  private fun send(event: String, id: String, more: (JSONObject) -> Unit = {}) {
    val payload = JSONObject()
    payload.put("id", id)
    more(payload)
    listener?.invoke(event, payload)
  }

  private val progress = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String?) {
      val (id, _) = TtsText.split(utteranceId) ?: return
      synchronized(lock) {
        if (id != currentId || started) return
        started = true
      }
      send("tts-start", id)
    }

    override fun onDone(utteranceId: String?) {
      val (id, index) = TtsText.split(utteranceId) ?: return
      synchronized(lock) {
        if (id != currentId || index < pieces - 1) return
        currentId = null
      }
      send("tts-end", id) { it.put("stopped", false) }
    }

    /** The text was stopped or replaced. `interrupted` is true when it had begun. */
    override fun onStop(utteranceId: String?, interrupted: Boolean) {
      val (id, _) = TtsText.split(utteranceId) ?: return
      synchronized(lock) {
        if (id != currentId) return
        currentId = null
      }
      send("tts-end", id) { it.put("stopped", true) }
    }

    @Deprecated("Deprecated in Java")
    override fun onError(utteranceId: String?) {
      fail(utteranceId, TextToSpeech.ERROR)
    }

    override fun onError(utteranceId: String?, errorCode: Int) {
      fail(utteranceId, errorCode)
    }
  }

  private fun fail(utteranceId: String?, code: Int) {
    val (id, _) = TtsText.split(utteranceId) ?: return
    synchronized(lock) {
      if (id != currentId) return
      currentId = null
    }
    try { engine?.stop() } catch (_: Throwable) {}
    send("tts-error", id) {
      it.put("message", errorText(code))
      it.put("code", code)
    }
  }

  private fun errorText(code: Int): String = when (code) {
    TextToSpeech.ERROR_NETWORK, TextToSpeech.ERROR_NETWORK_TIMEOUT -> "This voice needs the internet and could not reach it."
    TextToSpeech.ERROR_NOT_INSTALLED_YET -> "This voice is not downloaded yet. Pick another voice or install it in the system settings."
    TextToSpeech.ERROR_INVALID_REQUEST -> "The voice could not read this text."
    TextToSpeech.ERROR_OUTPUT -> "The phone could not play the voice."
    else -> "The voice of this phone stopped with an error."
  }

  private fun usable(voice: Voice): Boolean {
    val features = voice.features ?: return true
    return !features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
  }

  /**
   * `{ available, voices: [{ id, name, lang, local, default }] }`.
   *
   * An engine that was bound a moment ago answers with an empty list until
   * it has read its voices (Google's engine on the emulator: none at the
   * first call, 17 a second later). So an empty list is asked for again a
   * few times before it counts as the answer.
   */
  fun voices(context: Context, done: (JSONObject) -> Unit) {
    withEngine(context) { ok ->
      if (!ok) {
        val answer = JSONObject()
        answer.put("available", false)
        answer.put("voices", JSONArray())
        done(answer)
      } else {
        voicesNow(VOICE_TRIES, done)
      }
    }
  }

  private const val VOICE_TRIES = 8
  private const val VOICE_WAIT_MS = 250L

  private fun voicesNow(triesLeft: Int, done: (JSONObject) -> Unit) {
    val list = JSONArray()
    try {
      val tts = engine
      val standard = try { tts?.defaultVoice?.name } catch (_: Throwable) { null }
      for (voice in tts?.voices ?: emptySet()) {
        if (!usable(voice)) continue
        val entry = JSONObject()
        entry.put("id", voice.name)
        entry.put("name", label(voice))
        entry.put("lang", voice.locale.toLanguageTag())
        entry.put("local", !voice.isNetworkConnectionRequired)
        entry.put("default", voice.name == standard)
        list.put(entry)
      }
    } catch (e: Throwable) {
      Log.w(TAG, "voices could not be listed: ${e.javaClass.simpleName}")
    }
    if (list.length() == 0 && triesLeft > 1) {
      main.postDelayed({ voicesNow(triesLeft - 1, done) }, VOICE_WAIT_MS)
      return
    }
    val answer = JSONObject()
    answer.put("available", true)
    answer.put("voices", list)
    done(answer)
  }

  /** "English (United States), en-us-x-sfg-local": the engines give their voices no real names. */
  private fun label(voice: Voice): String {
    val language = voice.locale.getDisplayName(Locale.ENGLISH)
    return if (language.isNullOrBlank()) voice.name else "$language, ${voice.name}"
  }

  /** Null when the text was handed to the engine, else the sentence that says why not. */
  fun speak(context: Context, id: String, text: String, voiceId: String?, lang: String?, rate: Float, done: (String?) -> Unit) {
    withEngine(context) { ok ->
      val tts = engine
      if (!ok || tts == null) {
        done("This phone has no voice for reading aloud. Install a text to speech engine in the system settings.")
        return@withEngine
      }
      try {
        // Which voice, before anything is touched: a request that is refused
        // must not end the text that is being read.
        var chosen: Voice? = null
        var language: Locale? = null
        if (!voiceId.isNullOrEmpty()) {
          chosen = tts.voices?.firstOrNull { it.name == voiceId && usable(it) }
          if (chosen == null) {
            done("That voice is not on this phone any more. Pick another voice.")
            return@withEngine
          }
        } else if (!lang.isNullOrEmpty()) {
          val locale = Locale.forLanguageTag(lang.replace('_', '-'))
          if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) language = locale
        }
        // The text before this one ends. Its own callback reports that.
        val before: String?
        synchronized(lock) { before = currentId }
        if (before != null) {
          tts.stop()
          val ended: Boolean
          synchronized(lock) {
            ended = currentId == before
            if (ended) currentId = null
          }
          // An engine that does not call onStop for a queue it dropped.
          if (ended) send("tts-end", before) { it.put("stopped", true) }
        }

        when {
          chosen != null -> tts.voice = chosen
          language != null -> tts.language = language
          else -> try { tts.defaultVoice?.let { tts.voice = it } } catch (_: Throwable) {}
        }
        tts.setSpeechRate(rate)
        tts.setPitch(1.0f)

        val parts = TtsText.chunks(text, TextToSpeech.getMaxSpeechInputLength() - 1)
        if (parts.isEmpty()) {
          done("There is no text to read aloud.")
          return@withEngine
        }
        synchronized(lock) {
          currentId = id
          pieces = parts.size
          started = false
        }
        for ((index, part) in parts.withIndex()) {
          val result = tts.speak(part, if (index == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, Bundle(), TtsText.utteranceId(id, index))
          if (result != TextToSpeech.SUCCESS) {
            synchronized(lock) { if (currentId == id) currentId = null }
            try { tts.stop() } catch (_: Throwable) {}
            done("The voice of this phone did not accept the text.")
            return@withEngine
          }
        }
        done(null)
      } catch (e: Throwable) {
        Log.w(TAG, "speak failed: ${e.javaClass.simpleName}")
        synchronized(lock) { if (currentId == id) currentId = null }
        done("The voice of this phone stopped with an error.")
      }
    }
  }

  fun stop() {
    val tts: TextToSpeech?
    val id: String?
    synchronized(lock) {
      tts = engine
      id = currentId
    }
    if (tts == null || id == null) return
    try { tts.stop() } catch (_: Throwable) {}
    // onStop reports the end. This is for an engine that does not call it:
    // a text that was stopped must never stay "speaking" on the page.
    main.postDelayed({
      val silent: Boolean
      synchronized(lock) {
        silent = currentId == id
        if (silent) currentId = null
      }
      if (silent) send("tts-end", id) { it.put("stopped", true) }
    }, 400)
  }
}
