import { describe, expect, it } from 'vitest'
import { classifyHost, displayAddress, normalizePasscode, normalizeRemoteBase, parsePairingInput } from '../pairingLink'

describe('normalizeRemoteBase', () => {
  it('macht aus getippten Adressen den Server-Ursprung', () => {
    expect(normalizeRemoteBase('192.168.1.20')).toBe('http://192.168.1.20:11435')
    expect(normalizeRemoteBase('192.168.1.20:11435')).toBe('http://192.168.1.20:11435')
    expect(normalizeRemoteBase('  192.168.1.20:8080  ')).toBe('http://192.168.1.20:8080')
    expect(normalizeRemoteBase('my-desktop.local')).toBe('http://my-desktop.local:11435')
    expect(normalizeRemoteBase('HTTP://192.168.1.20:11435/mobile')).toBe('http://192.168.1.20:11435')
  })

  it('nimmt keine Zahlenformen, die der URL-Parser still in eine IP umrechnet', () => {
    for (const bad of ['3232235796', '0xC0A80114', 'http://0x7f.1', '192.168.1', '010.0.0.1', 'http://3232235796:11435/mobile']) {
      expect(normalizeRemoteBase(bad), bad).toBeNull()
    }
    expect(normalizeRemoteBase('[fd12:3456::1]:11435')).toBe('http://[fd12:3456::1]:11435')
    expect(normalizeRemoteBase('http://[fd12:3456::1]')).toBe('http://[fd12:3456::1]:11435')
  })

  it('laesst https seinen eigenen Port', () => {
    expect(normalizeRemoteBase('https://quiet-river-12.trycloudflare.com/mobile')).toBe('https://quiet-river-12.trycloudflare.com')
    expect(normalizeRemoteBase('https://example.com:8443/x?y=1#z')).toBe('https://example.com:8443')
  })

  it('lehnt ab, was keine Adresse ist', () => {
    for (const bad of ['', '   ', '123456', 'ftp://192.168.1.20', 'http://user:pw@192.168.1.20', 'two words', '999.1.1.1', '1.2.3', 'http://', '169.254.169.254', '0.0.0.0']) {
      expect(normalizeRemoteBase(bad), bad).toBeNull()
    }
  })
})

describe('normalizePasscode', () => {
  it('nimmt sechs Ziffern, auch mit Leerzeichen oder Bindestrich', () => {
    expect(normalizePasscode('123456')).toBe('123456')
    expect(normalizePasscode(' 123 456 ')).toBe('123456')
    expect(normalizePasscode('123-456')).toBe('123456')
    expect(normalizePasscode('000001')).toBe('000001')
  })

  it('lehnt alles andere ab', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12a456', null, undefined]) {
      expect(normalizePasscode(bad), String(bad)).toBeNull()
    }
  })
})

describe('classifyHost', () => {
  it('ordnet Adressen wie die Rust-Seite ein', () => {
    expect(classifyHost('127.0.0.1')).toBe('loopback')
    expect(classifyHost('localhost')).toBe('loopback')
    expect(classifyHost('10.0.0.5')).toBe('lan')
    expect(classifyHost('172.16.4.4')).toBe('lan')
    expect(classifyHost('172.32.4.4')).toBe('public')
    expect(classifyHost('192.168.178.20')).toBe('lan')
    expect(classifyHost('100.72.1.1')).toBe('lan')
    expect(classifyHost('desktop.local')).toBe('lan')
    expect(classifyHost('desktop')).toBe('lan')
    expect(classifyHost('[fd12:3456::1]')).toBe('lan')
    expect(classifyHost('abc.trycloudflare.com')).toBe('tunnel')
    expect(classifyHost('example.com')).toBe('public')
    expect(classifyHost('8.8.8.8')).toBe('public')
  })
})

describe('parsePairingInput', () => {
  it('liest den QR-Inhalt des Desktops im WLAN', () => {
    expect(parsePairingInput('http://192.168.1.20:11435/mobile')).toEqual({
      baseUrl: 'http://192.168.1.20:11435',
      code: null,
      route: 'lan',
      secure: false,
      host: '192.168.1.20',
      source: 'url',
    })
  })

  it('liest den QR-Inhalt des Desktops ueber den Tunnel', () => {
    expect(parsePairingInput('https://quiet-river-12.trycloudflare.com/mobile')).toEqual({
      baseUrl: 'https://quiet-river-12.trycloudflare.com',
      code: null,
      route: 'tunnel',
      secure: true,
      host: 'quiet-river-12.trycloudflare.com',
      source: 'url',
    })
  })

  it('liest eine getippte Adresse', () => {
    expect(parsePairingInput('192.168.1.20:11435')).toMatchObject({ baseUrl: 'http://192.168.1.20:11435', code: null, source: 'address' })
    expect(parsePairingInput('192.168.1.20')).toMatchObject({ baseUrl: 'http://192.168.1.20:11435', route: 'lan' })
  })

  it('liest lu://remote mit Adresse und Code', () => {
    const link = `lu://remote?url=${encodeURIComponent('http://192.168.1.20:11435/mobile')}&code=123456`
    expect(parsePairingInput(link)).toEqual({
      baseUrl: 'http://192.168.1.20:11435',
      code: '123456',
      route: 'lan',
      secure: false,
      host: '192.168.1.20',
      source: 'deep-link',
    })
  })

  it('liest die anderen Schreibweisen von lu://remote', () => {
    expect(parsePairingInput('lu:///remote?u=192.168.1.20')).toMatchObject({ baseUrl: 'http://192.168.1.20:11435', code: null })
    expect(parsePairingInput('lu:remote?url=192.168.1.20%3A11435&code=000042')).toMatchObject({ baseUrl: 'http://192.168.1.20:11435', code: '000042' })
    expect(parsePairingInput('LU://remote?host=192.168.1.20&port=11435&code=123456')).toMatchObject({ baseUrl: 'http://192.168.1.20:11435', code: '123456' })
    expect(parsePairingInput('lu://remote?host=abc.trycloudflare.com&tls=1')).toMatchObject({ baseUrl: 'https://abc.trycloudflare.com', route: 'tunnel', secure: true })
  })

  it('uebernimmt aus einem Link nur einen Code aus genau sechs Ziffern', () => {
    expect(parsePairingInput('lu://remote?url=192.168.1.20&code=12345')?.code).toBeNull()
    expect(parsePairingInput('lu://remote?url=192.168.1.20&code=abcdef')?.code).toBeNull()
    expect(parsePairingInput('http://192.168.1.20:11435/mobile?code=654321')?.code).toBe('654321')
    expect(parsePairingInput('http://192.168.1.20:11435/mobile#code=654321')?.code).toBe('654321')
  })

  it('liest Adresse und Code aus einer Zeile, wie aus einer Nachricht kopiert', () => {
    expect(parsePairingInput('http://192.168.1.20:11435/mobile 123456')).toMatchObject({ baseUrl: 'http://192.168.1.20:11435', code: '123456' })
    expect(parsePairingInput('123456 192.168.1.20')).toMatchObject({ baseUrl: 'http://192.168.1.20:11435', code: '123456' })
    expect(parsePairingInput('192.168.1.20:11435, 123 456')).toMatchObject({ baseUrl: 'http://192.168.1.20:11435', code: '123456' })
  })

  it('gibt null zurueck fuer alles, woraus keine Adresse wird', () => {
    for (const bad of [
      '',
      '123456',
      'lu://chat?url=192.168.1.20',
      'lu://remote',
      'lu://remote?url=ftp%3A%2F%2Fx',
      'lu://remote?host=192.168.1.20&port=abc',
      'lu://remote?url=http%3A%2F%2Fuser%3Apw%40192.168.1.20',
      'javascript:alert(1)',
      'hello there friend',
      'https://',
    ]) {
      expect(parsePairingInput(bad), bad).toBeNull()
    }
  })
})

describe('displayAddress', () => {
  it('zeigt die Adresse ohne Schema', () => {
    expect(displayAddress('http://192.168.1.20:11435')).toBe('192.168.1.20:11435')
    expect(displayAddress('https://abc.trycloudflare.com')).toBe('abc.trycloudflare.com')
  })
})

describe('A17: Adressen, die keine WLAN-Adressen sind', () => {
  it('erkennt Hamachi (25.0.0.0/8) und 100.64.0.0/10 in jeder Schreibweise', async () => {
    const { isNotWifiAddress } = await import('../pairingLink')
    expect(isNotWifiAddress('25.12.34.56')).toBe(true)
    expect(isNotWifiAddress('25.12.34.56:11435')).toBe(true)
    expect(isNotWifiAddress('http://25.1.2.3:11435/mobile')).toBe(true)
    expect(isNotWifiAddress('100.72.1.1')).toBe(true)
    expect(isNotWifiAddress('100.101.102.103')).toBe(true)
    expect(isNotWifiAddress('100.128.0.1')).toBe(false)
    expect(isNotWifiAddress('192.168.1.20')).toBe(false)
    expect(isNotWifiAddress('10.0.0.2')).toBe(false)
    expect(isNotWifiAddress('')).toBe(false)
    expect(isNotWifiAddress(null)).toBe(false)
  })

  it('die Meldung sagt, welche Adresse gemeint ist, und ein Schritt landet in detail', async () => {
    const { NOT_WIFI_TEXT, RemoteUnreachableError, RemoteTimeoutError, atPairStep } = await import('../remoteErrors')
    expect(NOT_WIFI_TEXT).toContain('usually 192.168.x.x')
    expect(NOT_WIFI_TEXT).not.toMatch(/[\u2013\u2014]/)
    const e = atPairStep(new RemoteUnreachableError(false, 'Failed to fetch'), { step: 'probe', call: 'GET /remote-api/status', notWifi: true }) as InstanceType<typeof RemoteUnreachableError>
    expect(e.detail).toBe('probe: GET /remote-api/status: Failed to fetch')
    expect(e.userMessage).toContain(NOT_WIFI_TEXT)
    expect(e.step).toBe('probe')
    const t = atPairStep(new RemoteTimeoutError(), { step: 'bootstrap', call: 'GET /api/tags' }) as InstanceType<typeof RemoteTimeoutError>
    expect(t.detail).toBe('bootstrap: GET /api/tags')
    expect(t.userMessage).toMatch(/Tap Try again/)
    // Der Tunnel behaelt seinen Satz, andere Fehler bleiben, wie sie sind.
    const tunnel = new RemoteUnreachableError(true)
    expect(atPairStep(tunnel, { step: 'probe', call: 'x' })).toBe(tunnel)
    const other = new Error('x')
    expect(atPairStep(other, { step: 'probe', call: 'x' })).toBe(other)
  })
})
