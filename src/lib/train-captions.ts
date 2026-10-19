/**
 * 3.0.8 D28: die Beschriftung jedes Trainingsfotos.
 *
 * Bisher bekam jedes Foto dieselbe feste Zeile `${trigger}, a photo of
 * ${trigger}`. Alles, was auf den Fotos zu sehen ist, landete damit am
 * Triggerwort, auch Jacke, Frisur und Strand. Wer eine Figur mit wechselnder
 * Kleidung trainiert, bekam sie spaeter nur noch in genau dieser Kleidung.
 *
 * Neu: je Foto optional eine kurze eigene Beschreibung dessen, was sich von
 * Foto zu Foto aendert. Was in der Beschriftung steht, erklaert der Text und
 * nicht das Triggerwort, also bleibt am Triggerwort nur das Gleichbleibende
 * (Gesicht, Figur). Leer heisst: genau wie bisher.
 *
 * musubi liest die Zeile aus `<foto>.txt` neben dem Bild
 * (`caption_extension = ".txt"`, src-tauri/src/commands/trainer.rs
 * `stage_image_into`). Das Triggerwort muss vorn stehen, musubi hat keinen
 * eigenen Trigger-Mechanismus.
 */

/** Wie lang eine Beschreibung je Foto werden darf. Der Rust-Teil kappt die
 *  ganze Zeile zusaetzlich bei 600 Zeichen (`caption_file_text`). */
export const TRAIN_CAPTION_MAX = 200

/** Eine Beschreibung, wie sie in die Zeile geht: eine Zeile, ohne doppelte
 *  Leerzeichen, ohne Komma oder Punkt am Ende, gekappt. */
export function cleanTrainDescription(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TRAIN_CAPTION_MAX)
    .replace(/[\s,.;]+$/, '')
}

/** Die Zeile fuer ein Foto. Ohne Beschreibung exakt die bisherige. */
export function buildTrainCaption(trigger: string, description?: string | null): string {
  const base = `${trigger}, a photo of ${trigger}`
  const extra = cleanTrainDescription(description ?? '')
  return extra ? `${base}, ${extra}` : base
}

/** Erklaerzeile ueber den Fotos. UI-Text, also englisch. */
export const TRAIN_CAPTION_HELP =
  'Optional: under each photo, name what changes from photo to photo, like clothes, hair or place. What you name there is not learned into the trigger word, so the character keeps its face and body but not one outfit. Leave it empty for the plain caption.'

/** Platzhalter im Feld unter jedem Foto. */
export const TRAIN_CAPTION_PLACEHOLDER = 'e.g. red jacket, short hair, beach'
