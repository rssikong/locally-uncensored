/**
 * Ein Plattform-Overlay der Tauri-Konfiguration, das `bundle.resources`
 * setzt, ersetzt die Liste des Basis-Configs, es ergaenzt sie nicht.
 *
 * 3.0.8 (A23 beim Release-Probelauf): A14 trug sein Skript
 * resources/abliterate/lu_abliterate.py nur in tauri.conf.json ein. Die
 * Overlays fuer Windows und Linux fuehren ihre eigene Liste (fuer die
 * llama-Bibliotheken) und kannten es nicht, also waere die Abliteration im
 * Windows- und Linux-Paket mit "Skript nicht gefunden" gescheitert. Mac und
 * Handy setzen keine Liste beziehungsweise bewusst eine leere.
 *
 * Gegenprobe: ohne die drei Zeilen in tauri.windows.conf.json ist der erste
 * Fall rot.
 *
 * Lauf: npx vitest run src/lib/__tests__/plattform-overlays-tragen-jede-ressource.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')
const conf = (name: string) => JSON.parse(readFileSync(resolve(ROOT, 'src-tauri', name), 'utf8'))
const base: string[] = conf('tauri.conf.json').bundle.resources

describe('jede Ressource des Basis-Configs steht in jedem Overlay, das die Liste ersetzt', () => {
  for (const name of ['tauri.windows.conf.json', 'tauri.linux.conf.json']) {
    it(name, () => {
      const own = Object.keys(conf(name).bundle.resources)
      const missing = base.filter((r) => !own.includes(r))
      expect(missing, `${name} ersetzt die Liste und laesst weg`).toEqual([])
    })
  }

  it('die Handy-Overlays setzen bewusst keine Ressourcen, der Mac erbt die Basis', () => {
    expect(conf('tauri.ios.conf.json').bundle.resources).toEqual([])
    expect(conf('tauri.android.conf.json').bundle.resources).toEqual([])
    expect(conf('tauri.macos.conf.json').bundle.resources).toBeUndefined()
  })
})
