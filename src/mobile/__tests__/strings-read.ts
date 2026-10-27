/**
 * Reading every text of src/mobile/strings in the preset that is set. Not a test itself.
 */

/** Every text of src/mobile/strings, read in the preset that is set: getters are read, functions are called with sample values. */
export async function allTexts(): Promise<Array<{ path: string; text: string }>> {
  const modules = import.meta.glob('../strings/*.ts')
  const out: Array<{ path: string; text: string }> = []
  const walk = (value: unknown, at: string, depth: number) => {
    if (depth > 8) return
    if (typeof value === 'string') out.push({ path: at, text: value })
    else if (typeof value === 'function') {
      try {
        const result = (value as (...args: unknown[]) => unknown)('2', '3', '4')
        if (typeof result === 'string') out.push({ path: at, text: result })
      } catch {
        /* a text function that wants other values: its literal parts are read by the source scan */
      }
    } else if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) walk((value as Record<string, unknown>)[key], `${at}.${key}`, depth + 1)
    }
  }
  for (const [file, load] of Object.entries(modules)) {
    const mod = (await load()) as Record<string, unknown>
    for (const [name, value] of Object.entries(mod)) walk(value, `${file.replace('../strings/', '')}:${name}`, 0)
  }
  return out
}
