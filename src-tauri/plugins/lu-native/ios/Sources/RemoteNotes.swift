import Foundation
import Tauri
import UIKit
import UserNotifications

// Notices of the user's computer (A17): "Answer ready", "Render ready",
// "Approval needed", as local notifications while the app still runs in the
// background. Honest limit: without a push service nothing comes once iOS
// has ended the app. A tap opens the chat or the result through a link of
// the app's own (lu://remote/notice?...), the same "deep-link" event every
// lu:// link takes.

class LocalNotifyArgs: Decodable {
  let id: String
  let title: String
  let body: String?
  let url: String?
}

class RemoteWatchArgs: Decodable {
  let on: Bool?
  let text: String?
}

class RemoteNotifyArgs: Decodable {
  /// false: only read the state, never put the question.
  let ask: Bool?
}

final class RemoteNoteDelegate: NSObject, UNUserNotificationCenterDelegate {
  static let shared = RemoteNoteDelegate()
  weak var plugin: LuNativePlugin?
  var watchTask: UIBackgroundTaskIdentifier = .invalid

  func install(_ plugin: LuNativePlugin) {
    self.plugin = plugin
    UNUserNotificationCenter.current().delegate = self
  }

  // On the screen the page shows what happened itself: no banner.
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    if let url = response.notification.request.content.userInfo["url"] as? String, RemoteNoteRule.linkAllowed(url) {
      plugin?.emit("deep-link", ["url": url, "source": "notification"])
    }
    completionHandler()
  }
}

extension LuNativePlugin {
  @objc func localNotify(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(LocalNotifyArgs.self)
    guard RemoteNoteRule.linkAllowed(args.url) else {
      invoke.resolve(["shown": false])
      return
    }
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
        invoke.resolve(["shown": false])
        return
      }
      let content = UNMutableNotificationContent()
      content.title = args.title
      content.body = args.body ?? ""
      content.sound = .default
      if let url = args.url { content.userInfo = ["url": url] }
      let request = UNNotificationRequest(identifier: "lu-remote-\(args.id)", content: content, trigger: nil)
      center.add(request) { error in
        invoke.resolve(["shown": error == nil])
      }
    }
  }

  /// iOS keeps an app in the background only for the time of a background
  /// task (about 30 seconds). That time is taken while the phone waits for
  /// the computer; longer needs a push service.
  @objc func remoteWatch(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(RemoteWatchArgs.self)
    DispatchQueue.main.async {
      let d = RemoteNoteDelegate.shared
      if args.on == true {
        if d.watchTask == .invalid {
          d.watchTask = UIApplication.shared.beginBackgroundTask(withName: "lu-remote-watch") {
            UIApplication.shared.endBackgroundTask(d.watchTask)
            d.watchTask = .invalid
          }
        }
      } else if d.watchTask != .invalid {
        UIApplication.shared.endBackgroundTask(d.watchTask)
        d.watchTask = .invalid
      }
      invoke.resolve(["ok": true])
    }
  }

  /// The question of the system for alerts, which local notices need. Put
  /// once; after a no only the settings of the system change it.
  @objc func remoteNotifyPermission(_ invoke: Invoke) throws {
    let ask = (try? invoke.parseArgs(RemoteNotifyArgs.self))?.ask ?? true
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      switch settings.authorizationStatus {
      case .authorized, .provisional:
        invoke.resolve(["granted": true, "needed": true, "asked": true])
      case .denied:
        invoke.resolve(["granted": false, "needed": true, "asked": true])
      default:
        if !ask {
          invoke.resolve(["granted": false, "needed": true, "asked": false])
          return
        }
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
          invoke.resolve(["granted": granted, "needed": true, "asked": true])
        }
      }
    }
  }
}
