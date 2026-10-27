import Foundation

// "Download on Wi-Fi only", the deciding half.
//
// Downloads.swift asks the system (NWPathMonitor, UserDefaults) and does what
// is decided here. The decisions are pure and depend on Foundation alone, so
// scripts/mobile/native-guard-tests.sh compiles this file for the Mac and
// runs it: the simulator has no mobile data, and without this the rule could
// only be tried on a phone with a SIM.
enum WifiRule {
  /// The word `connection_info` answers with.
  static func kind(satisfied: Bool, wifi: Bool, wired: Bool, cellular: Bool) -> String {
    if !satisfied { return "none" }
    if wifi { return "wifi" }
    if wired { return "ethernet" }
    if cellular { return "cellular" }
    return "other"
  }

  /// Mobile data is what carries the traffic: a path with Wi-Fi or a cable
  /// next to the mobile one is not "on mobile data".
  static func onCellular(satisfied: Bool, wifi: Bool, wired: Bool, cellular: Bool) -> Bool {
    return satisfied && cellular && !wifi && !wired
  }

  /// The rule holds for a download: the switch is on and the user did not
  /// say "Download anyway" for this one.
  static func applies(wifiOnly: Bool, allowedOnMobileData: Bool) -> Bool {
    return wifiOnly && !allowedOnMobileData
  }

  /// `allowsCellularAccess` of a fresh request. False makes the system wait
  /// for Wi-Fi by itself, also while the app is suspended or not running.
  static func requestAllowsCellular(wifiOnly: Bool, allowedOnMobileData: Bool) -> Bool {
    return !applies(wifiOnly: wifiOnly, allowedOnMobileData: allowedOnMobileData)
  }

  enum Step: String { case nothing, hold, release }

  /// What to do with one line when the network or the switch changed.
  ///
  ///   hold     the rule applies, the phone is on mobile data, and the task
  ///            that runs was created with a request that allows mobile
  ///            data (it was started before the switch was turned on, or
  ///            continued from such resume data): stop it, keep its bytes.
  ///   release  a held line, and the rule no longer blocks it: launch it.
  ///
  /// A line whose request already forbids mobile data needs nothing: the
  /// system keeps it waiting.
  static func step(ruled: Bool, onCellular: Bool, online: Bool, held: Bool, cellularAtLaunch: Bool, state: String) -> Step {
    let blocked = ruled && onCellular
    if held && !blocked && online { return .release }
    if blocked && !held && cellularAtLaunch && ["queued", "running", "waiting"].contains(state) { return .hold }
    return .nothing
  }
}
