/**
 * Simplified Chinese dictionary, keyed by the English source string.
 *
 * Add an entry only together with the call site that asks for it — an entry
 * nobody asks for is dead weight that survives merges and reads as translated
 * work that does not exist. `node scripts/i18n-report.mjs` lists both
 * directions (asked but missing, present but unused).
 *
 * House style, so the screens read as one app:
 *   - Buttons and menu items: verb first, no trailing period ("保存", "删除").
 *   - Sentences: full-width punctuation, one space between Chinese and Latin
 *     words or digits is NOT used; the font handles it.
 *   - Product nouns stay as the app names them in its own UI: "ComfyUI",
 *     "Ollama", "LU Cloud" are not translated.
 */
export const ZH_CN: Record<string, string> = {
  // ── Main navigation (Header.tsx) ────────────────────────────────────────
  Chat: '聊天',
  Create: '创作',
  Voice: '语音',
  Compare: '对比',
  Benchmark: '跑分',
  Models: '模型',
  Settings: '设置',
}
