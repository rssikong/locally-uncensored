// Which of REA's tools a turn is offered (lib/plugins/rea.ts). REA 6.5.0
// serves 207 tools; offered all at once, as LU offers every external tool,
// their schemas fill a local model's context before the user's words, and on
// the real run (17.10.2026) Qwen 3.5 9B answered nothing at all. A turn gets
// the tools its words point at instead: a core for any reverse engineering
// turn, plus the group of what is examined. The tools that run commands,
// attach a debugger or touch a device (Frida, gdb, Rizin, Cutter, adb) come
// only when the user names them. A tool named verbatim is offered anyway
// (lib/tool-selection mentionedToolNames).

/** The serverId REA's tools carry in the registry. */
export const REA_SERVER_ID = 'plugin:rea'

/** Offered on every turn that is about reverse engineering. REA works on an
 *  open target: `open_binary` with a local path comes first, whatever the
 *  target is, and every other tool answers "No app is open" before it. */
const CORE = ['open_binary', 'binary_session', 'close_binary', 'inspect_artifact', 'binary_overview', 'extract_artifact', 'list_unknowns', 'record_unknown', 'get_evidence_bundle']

interface Group {
  words: RegExp
  tools: string[]
}

const GROUPS: Group[] = [
  {
    words: /electron|\.asar\b|\basar\b|javascript|\bjs\b|node\.?js|webpack|bundle|source ?map/,
    tools: ['analyze_javascript_application', 'inspect_electron_fuses', 'recover_javascript_sources', 'analyze_web_bundle',
      'trace_javascript_semantics', 'trace_application_feature', 'compare_source_to_bundle', 'trace_web_module_imports'],
  },
  {
    words: /\bweb ?(page|site|app)|browser|https?:\/\//,
    tools: ['inspect_web_page', 'observe_web_session', 'analyze_web_bundle', 'inspect_web_network_capture', 'capture_web_screenshot'],
  },
  {
    words: /\.net\b|dotnet|c#|managed|\.dll\b|\.exe\b|windows/,
    tools: ['inspect_managed_artifact', 'inspect_managed_members', 'inspect_managed_native_boundaries', 'inspect_pe_resources', 'inspect_binary_layout'],
  },
  { words: /\bgo(lang)?\b|go binary/, tools: ['inspect_go_binary', 'inspect_binary_layout'] },
  { words: /\brust\b/, tools: ['inspect_rust_binary', 'inspect_binary_layout'] },
  { words: /flutter|\bdart\b/, tools: ['identify_flutter_build', 'inspect_dart_aot'] },
  { words: /sqlite|\.db\b|database/, tools: ['inspect_sqlite_database'] },
  { words: /wasm|webassembly/, tools: ['inspect_wasm_artifact', 'compare_wasm_interfaces'] },
  {
    words: /mach-?o|\.app\b|macos|\bmac\b|dylib|swift|objective-?c|objc|\bios\b|plist|codesign|signature/,
    tools: ['inspect_macho', 'inspect_signature', 'inspect_plist', 'list_architectures', 'demangle_swift',
      'get_objc_classes', 'analyze_swift_types', 'trace_dylib_resolution'],
  },
  {
    words: /android|\.apk\b|dex\b|smali/,
    tools: ['inspect_android_package', 'search_android_classes', 'inspect_android_class', 'inspect_android_method', 'decode_android_resources'],
  },
  {
    words: /disassembl|decompil|\bfunction|procedure|\bbinary\b|native|ghidra|hopper|\bida\b|assembly|xref/,
    tools: ['open_binary', 'binary_session', 'list_procedures', 'procedure_pseudo_code', 'search_strings',
      'xrefs', 'analyze_function', 'get_call_graph', 'close_binary'],
  },
  { words: /pcap|packet|network capture|wireshark/, tools: ['inspect_packet_capture', 'inspect_pcap_capture', 'inspect_packet_fields'] },
  { words: /firmware/, tools: ['inspect_firmware_regions', 'extract_firmware'] },
  { words: /smart contract|\bevm\b|solidity/, tools: ['inspect_evm_interface'] },
  { words: /crash/, tools: ['inspect_recorded_crash'] },
  // Named on purpose only: these run commands, attach to processes or reach a device.
  { words: /\bfrida\b/, tools: ['list_frida_devices', 'list_frida_processes', 'start_frida_session', 'load_frida_script', 'frida_session_status', 'close_frida_session'] },
  { words: /\bgdb\b/, tools: ['start_gdb_session', 'gdb_console', 'gdb_session_status', 'close_gdb_session'] },
  { words: /\brizin\b/, tools: ['execute_rizin_command', 'start_rizin_debug_session', 'rizin_debug_command', 'close_rizin_debug_session'] },
  { words: /\bcutter\b/, tools: ['list_cutter_sessions', 'cutter_command'] },
  { words: /\badb\b/, tools: ['list_adb_devices', 'inspect_adb_device', 'list_adb_packages', 'pull_adb_package', 'read_adb_logcat'] },
]

/** Words that make a turn about reverse engineering, beyond the groups. */
const ABOUT_IT = /\brea\b|reverse[- ]engineer|reverse engineering|untersuch|analys|analyz|inspect|what (does|is) (this|the) (app|file|program)|wie funktioniert/

/** The names of REA's tools this turn is offered, from the user's message. */
export function reaToolsFor(message: string, available: readonly string[]): string[] {
  const msg = message.toLowerCase()
  const groups = GROUPS.filter((g) => g.words.test(msg))
  if (groups.length === 0 && !ABOUT_IT.test(msg)) return []
  const names = new Set(CORE)
  for (const g of groups) for (const t of g.tools) names.add(t)
  const have = new Set(available)
  return [...names].filter((n) => have.has(n))
}
