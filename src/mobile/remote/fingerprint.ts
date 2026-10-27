/**
 * Fingerabdruck eines gekoppelten Handys (PROTOKOLL 5.4). Eigene Datei ohne
 * weitere Abhaengigkeiten, damit auch die e2e-Tests sie laden koennen.
 */
/**
 * Der Fingerabdruck dieses Handys, wie ihn der Desktop in seiner Rueckfrage
 * zeigt ("Device ID 3F2A 9C01, the same as on the phone"): `device_id`
 * base64url streng dekodiert (genau 16 Byte), die ersten 4 Bytes als Hex in
 * Grossbuchstaben, zwei Gruppen. Dieselbe Rechnung wie `device_fingerprint` in
 * `remote_sealed.rs` des Desktops; bei einer Kennung, die nicht genau so
 * dekodiert, gibt sie wie dort '' zurueck.
 */
export function deviceFingerprint(deviceId: string): string {
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(deviceId)) return ''
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  // 22 Zeichen tragen 132 Bit, 128 davon zaehlen: die letzten 4 Bit muessen 0 sein (kanonisch).
  if ((alphabet.indexOf(deviceId[21]) & 0x0f) !== 0) return ''
  let bits = 0
  let acc = 0
  const bytes: number[] = []
  for (const ch of deviceId) {
    acc = (acc << 6) | alphabet.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 0xff)
    }
  }
  if (bytes.length !== 16) return ''
  const hex = bytes
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('')
  return `${hex.slice(0, 4)} ${hex.slice(4)}`
}
