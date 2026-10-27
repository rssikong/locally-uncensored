/**
 * The open source software LU on the phone is built with, and the license
 * each part is published under. A short, hand kept list of the parts that
 * make up the app; the full texts are in the source repository.
 */
export interface LicenseEntry {
  name: string
  license: string
}

export const LICENSES: readonly LicenseEntry[] = [
  { name: 'llama.cpp', license: 'MIT' },
  { name: 'Tauri', license: 'MIT or Apache 2.0' },
  { name: 'React', license: 'MIT' },
  { name: 'Zustand', license: 'MIT' },
  { name: 'Supabase JS', license: 'MIT' },
  { name: 'Lucide', license: 'ISC' },
  { name: 'react-markdown', license: 'MIT' },
  { name: 'KaTeX', license: 'MIT' },
  { name: 'PDF.js', license: 'Apache 2.0' },
  { name: 'Mammoth', license: 'BSD 2 Clause' },
  { name: 'JSZip', license: 'MIT' },
  { name: 'Vite', license: 'MIT' },
]
