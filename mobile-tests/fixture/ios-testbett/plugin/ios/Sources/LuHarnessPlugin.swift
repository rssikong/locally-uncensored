import Foundation
import SwiftRs
import Tauri
import UIKit
import WebKit

// Testnaehte fuer den iOS-Treiber des Abnahmerahmens (mobile-tests/driver/ios.mjs).
//  1. Speicherwarnung ausloesen (nur im Simulator einkompiliert).
//  2. Lebenslauf-Ereignisse mitschreiben und nach JS melden.
//  3. Zurueck-Geste vom linken Rand in der WKWebView einschalten.
// Dieses Plugin gehoert nie in einen Store-Bau.

func dokumente() -> URL {
  return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
}

// Haengt eine Zeile an Documents/luharness.log an. Die Datei ueberlebt den Abschuss
// und ist vom Mac aus ueber simctl get_app_container lesbar.
func protokoll(_ text: String) {
  let zeile = "\(ISO8601DateFormatter().string(from: Date())) pid=\(ProcessInfo.processInfo.processIdentifier) \(text)\n"
  let datei = dokumente().appendingPathComponent("luharness.log")
  if let h = try? FileHandle(forWritingTo: datei) {
    h.seekToEndOfFile()
    h.write(zeile.data(using: .utf8)!)
    try? h.close()
  } else {
    try? zeile.data(using: .utf8)!.write(to: datei)
  }
}

class GesteArgs: Decodable {
  let an: Bool?
}

class LuHarnessPlugin: Plugin {
  var beobachter: [NSObjectProtocol] = []
  weak var seite: WKWebView?

  @objc public override func load(webview: WKWebView) {
    protokoll("plugin load")
    seite = webview
    webview.allowsBackForwardNavigationGestures = true
    let nc = NotificationCenter.default
    let namen: [(NSNotification.Name, String)] = [
      (UIApplication.didEnterBackgroundNotification, "didEnterBackground"),
      (UIApplication.willEnterForegroundNotification, "willEnterForeground"),
      (UIApplication.didBecomeActiveNotification, "didBecomeActive"),
      (UIApplication.willResignActiveNotification, "willResignActive"),
      (UIApplication.didReceiveMemoryWarningNotification, "didReceiveMemoryWarning"),
    ]
    for (n, text) in namen {
      beobachter.append(nc.addObserver(forName: n, object: nil, queue: .main) { [weak self] _ in
        protokoll("lifecycle \(text)")
        self?.trigger("lifecycle", data: ["name": text, "zeit": Date().timeIntervalSince1970])
      })
    }
  }

  @objc public func lifecycleLog(_ invoke: Invoke) throws {
    let datei = dokumente().appendingPathComponent("luharness.log")
    let text = (try? String(contentsOf: datei, encoding: .utf8)) ?? ""
    invoke.resolve(["log": text])
  }

  // Zustand der Zurueck-Geste lesen und, mit an = true oder false, setzen.
  @objc public func backGesture(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(GesteArgs.self)
    DispatchQueue.main.async { [weak self] in
      guard let w = self?.seite else {
        invoke.resolve(["webview": false])
        return
      }
      let vorher = w.allowsBackForwardNavigationGestures
      if let an = args.an { w.allowsBackForwardNavigationGestures = an }
      invoke.resolve(["webview": true, "vorher": vorher, "jetzt": w.allowsBackForwardNavigationGestures, "kannZurueck": w.canGoBack, "verlauf": w.backForwardList.backList.count])
    }
  }

  // Loest die echte Speicherwarnung von UIKit aus. Privater Selektor, deshalb als
  // Zeichenkette zusammengesetzt und nur im Simulator einkompiliert.
  @objc public func simulateMemoryWarning(_ invoke: Invoke) throws {
    #if targetEnvironment(simulator)
    DispatchQueue.main.async {
      let sel = Selector(("_perform" + "MemoryWarning"))
      if UIApplication.shared.responds(to: sel) {
        UIApplication.shared.perform(sel)
        invoke.resolve(["ausgeloest": true])
      } else {
        invoke.resolve(["ausgeloest": false])
      }
    }
    #else
    invoke.reject("nur im Simulator")
    #endif
  }
}

@_cdecl("init_plugin_luharness")
func initPlugin() -> Plugin {
  return LuHarnessPlugin()
}
