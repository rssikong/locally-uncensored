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

  // ── Chat composer (ChatInput.tsx) ───────────────────────────────────────
  Unavailable: '不可用',
  'Drop files here...': '拖放到此处…',
  'Transcribing...': '转写中…',
  'Recording...': '录音中…',
  'Message...': '说点什么…',
  'Attach images, clips, audio or files': '添加图片、视频、音频或文件',
  'Attach images or files': '添加图片或文件',
  Remove: '移除',
  Think: '思考',
  'Thinking is always on for this model': '该模型的思考始终开启',
  'Thinking ON': '思考已开',
  'Thinking OFF': '思考已关',
  'Model does not support thinking': '该模型不支持思考',
  'Reasoning effort': '推理强度',
  'Click to cycle. Higher effort spends more output tokens.':
    '点击切换。强度越高，消耗的输出 token 越多。',
  "Cloud mode: this message runs on LU's hosted GPUs and is billed to your lu-labs.ai credits. The Cloud switch up in the header turns it off.":
    '云端模式：这条消息在 LU 托管的 GPU 上运行，并计入你的 lu-labs.ai 额度。顶栏的 Cloud 开关可以关掉它。',
  Cloud: '云端',
  'Stop generation': '停止生成',
  'Send message': '发送消息',
}
