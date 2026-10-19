/**
 * One entry per model name. KoboldCpp in Ollama mode reports its model twice
 * under the same name (GH #165), and every row the app draws is keyed by that
 * name: the picker, the Models tab and the group menu each showed two
 * identical rows, ticking one ticked both, and the group header counted the
 * model twice. The first entry wins.
 */
export function oneEntryPerName<T extends { name: string }>(entries: readonly T[]): T[] {
  const seen = new Set<string>()
  return entries.filter((e) => {
    if (seen.has(e.name)) return false
    seen.add(e.name)
    return true
  })
}
