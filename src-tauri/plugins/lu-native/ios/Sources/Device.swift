import Foundation
import MachO
import UIKit
import os

// Facts about the device, and the question whether this build carries the
// entitlement for a higher memory limit.
enum Device {
  static var isSimulator: Bool {
    #if targetEnvironment(simulator)
    return true
    #else
    return false
    #endif
  }

  /// `hw.machine`, for example "iPhone17,1". In the simulator that is the
  /// architecture of the Mac, the model being simulated is in the
  /// environment.
  static var machine: String {
    var size = 0
    sysctlbyname("hw.machine", nil, &size, nil, 0)
    guard size > 0 else { return "" }
    var buffer = [CChar](repeating: 0, count: size)
    sysctlbyname("hw.machine", &buffer, &size, nil, 0)
    return String(cString: buffer)
  }

  static var model: String {
    if isSimulator, let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
      return simulated
    }
    return machine
  }

  static func diskSpace(at path: String?) -> (free: Int64, total: Int64) {
    let url = URL(fileURLWithPath: path ?? NSHomeDirectory())
    // "For important usage" counts what the system would clear to make room
    // for something the user asked for. That is the number a download can
    // really use, and it is larger than what statfs reports.
    let keys: Set<URLResourceKey> = [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey, .volumeAvailableCapacityKey]
    var probe = url
    while !FileManager.default.fileExists(atPath: probe.path) && probe.path != "/" {
      probe = probe.deletingLastPathComponent()
    }
    guard let values = try? probe.resourceValues(forKeys: keys) else { return (0, 0) }
    let important = values.volumeAvailableCapacityForImportantUsage ?? 0
    let plain = Int64(values.volumeAvailableCapacity ?? 0)
    return (important > 0 ? important : plain, Int64(values.volumeTotalCapacity ?? 0))
  }

  /// 1.0 at the standard text size. The same factor UIKit applies to a 17 pt
  /// body font.
  static var fontScale: Double {
    let scaled = UIFontMetrics(forTextStyle: .body).scaledValue(for: 17.0)
    return (Double(scaled) / 17.0 * 1000).rounded() / 1000
  }

  static func info(path: String?) -> [String: Any?] {
    let disk = diskSpace(at: path)
    let process = ProcessInfo.processInfo
    let category = UIApplication.shared.preferredContentSizeCategory
    return [
      "platform": "ios",
      "model": model,
      "machine": machine,
      "systemVersion": UIDevice.current.systemVersion,
      "isEmulator": isSimulator,
      "totalMemoryBytes": NSNumber(value: process.physicalMemory),
      // 0 in the simulator: there is no limit per app there.
      "availableMemoryBytes": NSNumber(value: UInt64(os_proc_available_memory())),
      "lowMemory": false,
      "increasedMemoryLimit": Entitlements.has("com.apple.developer.kernel.increased-memory-limit"),
      "diskFreeBytes": NSNumber(value: disk.free),
      "diskTotalBytes": NSNumber(value: disk.total),
      "contentSizeCategory": category.rawValue,
      "isAccessibilityTextSize": category.isAccessibilityCategory,
      "fontScale": fontScale,
      "lowPowerMode": process.isLowPowerModeEnabled,
      "thermalState": process.thermalState.rawValue,
      "processorCount": process.activeProcessorCount,
    ]
  }
}

// Reads the entitlements this binary was signed with, from the binary
// itself. There is no public call on iOS that answers "do I have entitlement
// X", so the answer is taken from where the system takes it:
//
//   * a device build carries them in its code signature (LC_CODE_SIGNATURE,
//     the blob with the magic 0xfade7171, an XML property list),
//   * a simulator build is signed ad hoc without them, and Xcode puts them
//     into the section __TEXT,__entitlements instead.
//
// Only the simulator half can be shown without a signed device build.
enum Entitlements {
  private static var cached: [String: Any]?

  static func has(_ key: String) -> Bool {
    if let value = all()[key] as? Bool {
      return value
    }
    return false
  }

  static func all() -> [String: Any] {
    if let cached = cached { return cached }
    let found = fromSection() ?? fromSignature() ?? [:]
    cached = found
    return found
  }

  private static func plist(_ data: Data) -> [String: Any]? {
    return (try? PropertyListSerialization.propertyList(from: data, options: [], format: nil)) as? [String: Any]
  }

  private static func mainHeader() -> UnsafePointer<mach_header_64>? {
    for i in 0..<_dyld_image_count() {
      guard let header = _dyld_get_image_header(i) else { continue }
      if header.pointee.filetype == MH_EXECUTE {
        return UnsafeRawPointer(header).assumingMemoryBound(to: mach_header_64.self)
      }
    }
    return nil
  }

  private static func fromSection() -> [String: Any]? {
    guard let header = mainHeader() else { return nil }
    var size: UInt = 0
    guard let pointer = getsectiondata(header, "__TEXT", "__entitlements", &size), size > 0 else { return nil }
    return plist(Data(bytes: pointer, count: Int(size)))
  }

  private static func fromSignature() -> [String: Any]? {
    guard let path = Bundle.main.executablePath,
      let handle = FileHandle(forReadingAtPath: path),
      let header = mainHeader()
    else { return nil }
    defer { try? handle.close() }

    // Find LC_CODE_SIGNATURE among the load commands of the loaded image.
    var offset: UInt32 = 0
    var length: UInt32 = 0
    var cursor = UnsafeRawPointer(header).advanced(by: MemoryLayout<mach_header_64>.size)
    for _ in 0..<header.pointee.ncmds {
      let command = cursor.assumingMemoryBound(to: load_command.self).pointee
      if command.cmd == UInt32(LC_CODE_SIGNATURE) {
        let data = cursor.assumingMemoryBound(to: linkedit_data_command.self).pointee
        offset = data.dataoff
        length = data.datasize
        break
      }
      cursor = cursor.advanced(by: Int(command.cmdsize))
    }
    guard length > 12, length < 16 * 1024 * 1024 else { return nil }

    // The offset is relative to this architecture's slice. An app binary of
    // one architecture starts at 0, a fat one would need the slice offset.
    handle.seek(toFileOffset: UInt64(offset))
    let blob = handle.readData(ofLength: Int(length))
    guard blob.count >= 12 else { return nil }

    func be32(_ at: Int) -> UInt32 {
      guard at + 4 <= blob.count else { return 0 }
      return blob.subdata(in: at..<(at + 4)).withUnsafeBytes { $0.load(as: UInt32.self).bigEndian }
    }
    // Superblob: magic 0xfade0cc0, length, count, then (type, offset) pairs.
    guard be32(0) == 0xfade_0cc0 else { return nil }
    let count = Int(be32(8))
    guard count < 64 else { return nil }
    for i in 0..<count {
      let entryOffset = Int(be32(12 + i * 8 + 4))
      if be32(entryOffset) == 0xfade_7171 {
        let entryLength = Int(be32(entryOffset + 4))
        guard entryLength > 8, entryOffset + entryLength <= blob.count else { return nil }
        return plist(blob.subdata(in: (entryOffset + 8)..<(entryOffset + entryLength)))
      }
    }
    return nil
  }
}
