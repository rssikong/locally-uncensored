/**
 * A24: Das Hauptfenster darf vor der Onboarding-Übergabe keinen persistierten
 * Store laden.
 *
 * `awaitOnboardingHandover` (lib/host-window.ts) wartet, solange der Assistent
 * im eigenen Fenster läuft, damit das Hauptfenster danach FRISCH aus
 * localStorage liest. Das gilt aber nur, wenn bis dahin kein Store hydriert
 * hat. `main.tsx` lädt einige Module statisch (Shutdown-Hörer), und über
 * `background-shutdown` → `api/backend` und `mcp/shutdown` → `external-client`
 * → `api/backend` hing `settingsStore` daran. Gemessen auf der Testbox am
 * 22.10.2026: nach „Re-run onboarding" und dem Abschluss im kleinen Fenster
 * zeigte das Hauptfenster wieder den Willkommensschirm, obwohl localStorage
 * `onboardingDone: true` hatte. Beim Erststart heilte das meist der Restore
 * in AppShell, beim A12-Echtlauf nicht.
 *
 * Der Test folgt nur statischen Importen (keine `import()`, keine
 * `import type`), genau dem, was beim Seitenstart vor dem Warten ausgeführt
 * wird.
 *
 * Lauf: npx vitest run src/lib/__tests__/main-laedt-vor-der-uebergabe-keinen-store.test.ts
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..', '..')
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = join(dirname(from), spec)
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

/** Statische Importe und Re-Exporte, ohne reine Typ-Importe. */
function staticImports(file: string): string[] {
  const src = codeOnly(readFileSync(file, 'utf8'))
  const specs: string[] = []
  for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)([^;]*?)\bfrom\s+['"]([^'"]+)['"]/gm)) {
    const clause = m[1].trim()
    const onlyTypes = /^\{[\s\S]*\}$/.test(clause)
      && clause.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '))
    if (!onlyTypes) specs.push(m[2])
  }
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specs.push(m[1])
  return specs.map((s) => resolveLocal(file, s)).filter((f): f is string => f !== null)
}

/** Alle Module, die `main.tsx` vor seinem ersten `await` geladen hat, mit Pfad dorthin. */
function staticClosure(entry: string): Map<string, string | null> {
  const prev = new Map<string, string | null>([[entry, null]])
  const queue = [entry]
  while (queue.length) {
    const f = queue.shift()!
    for (const dep of staticImports(f)) {
      if (!prev.has(dep)) {
        prev.set(dep, f)
        queue.push(dep)
      }
    }
  }
  return prev
}

function chain(prev: Map<string, string | null>, f: string): string {
  const out: string[] = []
  for (let t: string | null = f; t; t = prev.get(t) ?? null) out.push(relative(ROOT, t).replace(/\\/g, '/'))
  return out.join(' <- ')
}

describe('main.tsx lädt vor der Onboarding-Übergabe keinen persistierten Store', () => {
  const closure = staticClosure(resolve(ROOT, 'src', 'main.tsx'))

  it('der Graph ist echt (der Test sieht die Shutdown-Hörer)', () => {
    const files = [...closure.keys()].map((f) => relative(ROOT, f).replace(/\\/g, '/'))
    expect(files).toContain('src/lib/background-shutdown.ts')
    expect(files).toContain('src/api/mcp/shutdown.ts')
  })

  it('kein Modul darin ruft zustand persist()', () => {
    const offenders = [...closure.keys()]
      .filter((f) => /\bpersist\s*\(/.test(codeOnly(readFileSync(f, 'utf8'))))
      .map((f) => chain(closure, f))
    expect(offenders).toEqual([])
  })

  it('insbesondere nicht settingsStore, den der Assistent drüben beschreibt', () => {
    const settings = resolve(ROOT, 'src', 'stores', 'settingsStore.ts')
    expect(closure.has(settings) ? chain(closure, settings) : null).toBeNull()
  })
})
