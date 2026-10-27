import AVFoundation
import Foundation
import Tauri

// Read aloud with the speech synthesis of the system.
//
// WKWebView has speechSynthesis, so on iOS this is the way back for the case
// that it is missing or stays silent. Same three commands and three events
// as on Android (Tts.kt): `tts-start` when the voice begins, `tts-end` when
// it is done or was stopped, `tts-error` when the text could not be spoken.
// One text at a time, every event carries the id of its text.

class TtsSpeakArgs: Decodable {
  let id: String
  let text: String
  let voice: String?
  let lang: String?
  let rate: Float?
}

final class Tts: NSObject, AVSpeechSynthesizerDelegate {
  static let shared = Tts()

  var emit: (String, JsonObject) -> Void = { _, _ in }
  var log: (String) -> Void = { _ in }

  /// Only touched on the main queue. Created with the first text, not with
  /// the app: the plugin wires the events at its start, and the start of
  /// the app does not pay for a voice nobody asked for.
  private lazy var synthesizer: AVSpeechSynthesizer = {
    let made = AVSpeechSynthesizer()
    made.delegate = self
    return made
  }()
  private var used = false
  /// Which text an utterance belongs to. The system does not promise a
  /// queue for its callbacks, so this has its own lock.
  private var ids: [ObjectIdentifier: String] = [:]
  /// Texts that were stopped by a command. iOS 26 reports such an end as
  /// "finished", not as "cancelled" (seen in the simulator), so the page
  /// would take a stopped text for one that was read to its end.
  private var halted: Set<String> = []
  private let lock = NSLock()

  /// Stop what is being spoken and remember that it was stopped.
  private func halt() {
    guard used, synthesizer.isSpeaking || synthesizer.isPaused else { return }
    lock.lock()
    halted.formUnion(ids.values)
    lock.unlock()
    synthesizer.stopSpeaking(at: .immediate)
  }

  private func remember(_ utterance: AVSpeechUtterance, _ id: String) {
    lock.lock(); defer { lock.unlock() }
    ids[ObjectIdentifier(utterance)] = id
  }

  private func id(of utterance: AVSpeechUtterance, forget: Bool) -> (id: String, last: Bool, halted: Bool)? {
    lock.lock(); defer { lock.unlock() }
    let key = ObjectIdentifier(utterance)
    guard let id = forget ? ids.removeValue(forKey: key) : ids[key] else { return nil }
    let wasHalted = forget ? halted.remove(id) != nil : halted.contains(id)
    return (id, ids.isEmpty, wasHalted)
  }

  /// `{ available, voices: [{ id, name, lang, local, default }] }`.
  static func voices() -> JsonObject {
    let standard = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())?.identifier
    let list: [JsonObject] = AVSpeechSynthesisVoice.speechVoices().map { voice in
      [
        "id": voice.identifier,
        "name": voice.name,
        "lang": voice.language,
        "local": true,
        "default": voice.identifier == standard,
      ]
    }
    return ["available": !list.isEmpty, "voices": list]
  }

  /// 1.0 is the normal speed. iOS counts from 0 to 1 with the normal speed
  /// at one half, and the upper half grows much faster than it reads.
  static func systemRate(_ rate: Float) -> Float {
    let normal = AVSpeechUtteranceDefaultSpeechRate
    let wanted = rate <= 1 ? normal * rate : normal + (rate - 1) * (AVSpeechUtteranceMaximumSpeechRate - normal) * 0.5
    return min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, wanted))
  }

  /// Nil when the text was handed to the system, else the sentence that says why not.
  func speak(_ args: TtsSpeakArgs, done: @escaping (String?) -> Void) {
    DispatchQueue.main.async {
      var voice: AVSpeechSynthesisVoice?
      if let wanted = args.voice, !wanted.isEmpty {
        voice = AVSpeechSynthesisVoice(identifier: wanted)
        if voice == nil {
          return done("That voice is not on this phone any more. Pick another voice.")
        }
      } else if let lang = args.lang, !lang.isEmpty {
        voice = AVSpeechSynthesisVoice(language: lang.replacingOccurrences(of: "_", with: "-"))
      }
      if voice == nil {
        voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
      }
      if voice == nil && AVSpeechSynthesisVoice.speechVoices().isEmpty {
        return done("This phone has no voice for reading aloud.")
      }
      // The text before this one ends, and its own callback reports that.
      self.halt()
      self.used = true
      // Spoken text is what the user asked to hear: it plays with the
      // silent switch on, and other sound gets quieter for it.
      let session = AVAudioSession.sharedInstance()
      if session.category != .playAndRecord {
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
      }
      try? session.setActive(true)

      let utterance = AVSpeechUtterance(string: args.text)
      utterance.voice = voice
      utterance.rate = Tts.systemRate(args.rate ?? 1)
      self.remember(utterance, args.id)
      self.synthesizer.speak(utterance)
      self.log("tts speak id=\(args.id) chars=\(args.text.count) voice=\(voice?.identifier ?? "system")")
      done(nil)
    }
  }

  func stop() {
    DispatchQueue.main.async { self.halt() }
  }

  private func ended(_ utterance: AVSpeechUtterance, stopped: Bool) {
    guard let (id, last, halted) = id(of: utterance, forget: true) else { return }
    let stopped = stopped || halted
    log("tts end id=\(id) stopped=\(stopped)")
    emit("tts-end", ["id": id, "stopped": stopped])
    if last {
      try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
    guard let (id, _, _) = id(of: utterance, forget: false) else { return }
    log("tts start id=\(id)")
    emit("tts-start", ["id": id])
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    ended(utterance, stopped: false)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    ended(utterance, stopped: true)
  }
}

// The three commands. They live here, next to what they call, so the file
// of the plugin class does not grow with every service.
//
// The plugin is a static library, and the linker takes a file of it only
// when something refers to it. Methods in an extension are found by name at
// run time, which is no reference: without the call to `wireSpeech()` in the
// init of the plugin this whole file is left out of the app and the three
// commands answer "No command ttsSpeak found".
extension LuNativePlugin {
  func wireSpeech() {
    Tts.shared.emit = { [weak self] event, payload in self?.emit(event, payload) }
    Tts.shared.log = { [weak self] text in self?.log(text) }
  }

  @objc public func ttsVoices(_ invoke: Invoke) throws {
    invoke.resolve(Tts.voices())
  }

  @objc public func ttsSpeak(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(TtsSpeakArgs.self)
    Tts.shared.speak(args) { problem in
      if let problem = problem { invoke.reject(problem) } else { invoke.resolve(["ok": true]) }
    }
  }

  @objc public func ttsStop(_ invoke: Invoke) throws {
    Tts.shared.stop()
    invoke.resolve(["ok": true])
  }
}
