import AVFoundation
import Foundation
import Tauri
import UIKit

// Small services for the shell: a haptic tick, a link that leaves the app,
// and the QR scanner for Remote pairing.

class KindArgs: Decodable {
  let kind: String?
}

class UrlArgs: Decodable {
  let url: String
}

enum Extras {
  /// One tick. The system decides whether the phone moves at all (haptics
  /// can be switched off, and an iPad has no motor).
  static func haptic(_ invoke: Invoke) {
    let kind = (try? invoke.parseArgs(KindArgs.self))?.kind ?? "light"
    DispatchQueue.main.async {
      switch kind {
      case "success":
        UINotificationFeedbackGenerator().notificationOccurred(.success)
      case "warning":
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
      default:
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
      }
      invoke.resolve(["performed": true])
    }
  }

  /// Rust has checked the link already. The scheme is looked at again here,
  /// because this is where it leaves the app.
  static func openExternal(_ invoke: Invoke) {
    guard let args = try? invoke.parseArgs(UrlArgs.self), let url = URL(string: args.url),
      let scheme = url.scheme?.lowercased(), ["http", "https", "mailto", "tel"].contains(scheme)
    else {
      invoke.reject("Only web links, mail addresses and phone numbers can be opened from here.")
      return
    }
    DispatchQueue.main.async {
      UIApplication.shared.open(url, options: [:]) { opened in
        if opened {
          invoke.resolve(["ok": true])
        } else {
          invoke.reject("No app on this phone can open this link.")
        }
      }
    }
  }

  /// The page of this app in the system settings, where the permissions are.
  static func openSystemSettings(_ invoke: Invoke) {
    DispatchQueue.main.async {
      guard let url = URL(string: UIApplication.openSettingsURLString) else {
        invoke.reject("The system settings could not be opened.")
        return
      }
      UIApplication.shared.open(url, options: [:]) { opened in
        if opened {
          invoke.resolve(["ok": true])
        } else {
          invoke.reject("The system settings could not be opened.")
        }
      }
    }
  }

  /// Show the camera and answer with the first QR code it sees, or with
  /// `cancelled` when the user closes it.
  static func scanQr(_ invoke: Invoke, root: UIViewController?) {
    // Without the usage text iOS ends the app the moment the camera is asked for.
    guard Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil else {
      invoke.reject("This build of the app may not use the camera.")
      return
    }
    guard AVCaptureDevice.default(for: .video) != nil else {
      invoke.reject("This device has no camera.")
      return
    }
    let present = {
      DispatchQueue.main.async {
        guard let root = root else {
          invoke.reject("The scanner could not be shown.")
          return
        }
        let scanner = QrScannerController(invoke: invoke)
        scanner.modalPresentationStyle = .fullScreen
        var top = root
        while let next = top.presentedViewController { top = next }
        top.present(scanner, animated: true)
      }
    }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      present()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        if granted {
          present()
        } else {
          invoke.reject("The camera is not allowed for this app. Allow it in the system settings to scan a code.")
        }
      }
    default:
      invoke.reject("The camera is not allowed for this app. Allow it in the system settings to scan a code.")
    }
  }
}

/// A full screen camera picture with a close button. Answers once.
final class QrScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  private let invoke: Invoke
  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "lu-native.qr")
  private var preview: AVCaptureVideoPreviewLayer?
  private var answered = false

  init(invoke: Invoke) {
    self.invoke = invoke
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("not used")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black

    guard let camera = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: camera),
      session.canAddInput(input)
    else {
      answer(error: "The camera could not be started.")
      return
    }
    session.addInput(input)
    let output = AVCaptureMetadataOutput()
    guard session.canAddOutput(output) else {
      answer(error: "The camera could not be started.")
      return
    }
    session.addOutput(output)
    guard output.availableMetadataObjectTypes.contains(.qr) else {
      answer(error: "This camera cannot read QR codes.")
      return
    }
    output.metadataObjectTypes = [.qr]
    output.setMetadataObjectsDelegate(self, queue: .main)

    let layer = AVCaptureVideoPreviewLayer(session: session)
    layer.videoGravity = .resizeAspectFill
    layer.frame = view.bounds
    view.layer.addSublayer(layer)
    preview = layer

    let close = UIButton(type: .close)
    close.accessibilityLabel = "Close"
    close.translatesAutoresizingMaskIntoConstraints = false
    close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
    view.addSubview(close)
    NSLayoutConstraint.activate([
      close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
      close.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
      close.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
      close.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
    ])
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    preview?.frame = view.bounds
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    sessionQueue.async { [session] in
      if !session.isRunning { session.startRunning() }
    }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    sessionQueue.async { [session] in
      if session.isRunning { session.stopRunning() }
    }
    // Swiped away or covered: that is a "closed" unless a code came first.
    answer(text: nil)
  }

  @objc private func closeTapped() {
    answer(text: nil)
  }

  func metadataOutput(
    _ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection
  ) {
    for object in objects {
      if let code = object as? AVMetadataMachineReadableCodeObject, code.type == .qr, let text = code.stringValue,
        !text.isEmpty
      {
        answer(text: text)
        return
      }
    }
  }

  private func answer(text: String?) {
    if answered { return }
    answered = true
    if let text = text {
      invoke.resolve(["text": text, "cancelled": false])
    } else {
      invoke.resolve(["cancelled": true])
    }
    if presentingViewController != nil { dismiss(animated: true) }
  }

  private func answer(error: String) {
    if answered { return }
    answered = true
    invoke.reject(error)
    DispatchQueue.main.async { [weak self] in
      if self?.presentingViewController != nil { self?.dismiss(animated: true) }
    }
  }
}
