// A web view that is too old to carry the app says so, instead of the app
// breaking somewhere inside.
//
// Android System WebView is a part of Android that updates through the Play
// Store on its own. On a phone that has not seen an update for years, and on
// emulator images, it can be far older than the app expects. The acceptance
// on Android 8 GB met version 113 and "Promise.withResolvers is not a
// function" in the middle of reading a PDF (find B5). Below version 111 the
// style sheet itself does not work any more (no color-mix()), and the user
// would see a broken page with no word about why.
//
// The floor is WEBVIEW_FLOOR in src/dev/webview-target.ts. The number below
// repeats it, and src/dev/__tests__/webview-target.test.ts holds the two
// together.
//
// This file runs before the app is loaded and must run on a web view of any
// age: plain old script, no arrow function, no const, no template string
// (the same test parses it as ECMAScript 5). A file of its own and no inline
// script, because the content security policy allows scripts from the app
// only. It does nothing on a desktop and nothing on iOS, where the store
// installs the app from iOS 17.0 on and the web view comes with the system.
;(function () {
  var FLOOR = 111
  var STORE_PAGE = 'https://play.google.com/store/apps/details?id=com.google.android.webview'

  function chromiumVersion(ua) {
    var m = /(?:Chrome|Chromium)\/(\d+)/.exec(ua || '')
    return m ? parseInt(m[1], 10) : 0
  }

  function styleSheetWorks() {
    try {
      return !!(window.CSS && window.CSS.supports && window.CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'))
    } catch (e) {
      return false
    }
  }

  function make(tag, text, style) {
    var el = document.createElement(tag)
    if (text) el.appendChild(document.createTextNode(text))
    if (style) el.setAttribute('style', style)
    return el
  }

  function show(version) {
    if (document.getElementById('lu-webview-too-old')) return
    var light = /(?:^|\s)lu-first-light(?:\s|$)/.test(document.documentElement.className)
    var ground = light ? '#f3f4f6' : '#141414'
    var ink = light ? '#111827' : '#f3f4f6'
    var soft = light ? '#4b5563' : '#a3a3a3'
    var root = document.getElementById('root')
    if (root) root.style.display = 'none'

    var page = make('div', '', 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;overflow:auto;box-sizing:border-box;padding:48px 24px 32px;font-family:system-ui,sans-serif;background:' + ground + ';color:' + ink)
    page.id = 'lu-webview-too-old'
    page.setAttribute('role', 'alert')
    page.setAttribute('data-testid', 'm-webview-too-old')

    page.appendChild(make('h1', 'Update Android System WebView', 'font-size:22px;line-height:1.3;margin:0 0 16px;font-weight:600'))
    var has = version > 0 ? 'This phone has version ' + version + '.' : 'The version on this phone is too old.'
    page.appendChild(make('p', 'LU is drawn by a part of Android called Android System WebView. ' + has + ' LU needs version ' + FLOOR + ' or newer.', 'font-size:16px;line-height:1.5;margin:0 0 16px;color:' + soft))

    var steps = make('ol', '', 'font-size:16px;line-height:1.5;margin:0 0 16px;padding-left:22px')
    var lines = ['Open the Play Store.', 'Search for Android System WebView.', 'Tap Update.', 'Open LU again.']
    for (var i = 0; i < lines.length; i++) steps.appendChild(make('li', lines[i], 'margin:0 0 6px'))
    page.appendChild(steps)
    page.appendChild(make('p', 'If the Play Store shows no update there, update Chrome the same way. On some phones Chrome is the web view.', 'font-size:14px;line-height:1.5;margin:0 0 24px;color:' + soft))

    var tauri = window.__TAURI_INTERNALS__
    if (tauri && typeof tauri.invoke === 'function') {
      var button = make('button', 'Open Play Store', 'display:block;width:100%;min-height:48px;border:0;border-radius:12px;font-size:16px;font-weight:600;background:' + ink + ';color:' + ground)
      button.setAttribute('type', 'button')
      button.setAttribute('data-testid', 'm-webview-too-old-store')
      var failed = make('p', '', 'font-size:14px;line-height:1.5;margin:12px 0 0;color:' + soft)
      failed.setAttribute('aria-live', 'polite')
      button.onclick = function () {
        var said = function () {
          failed.textContent = 'The Play Store did not open. Open it from the home screen.'
        }
        try {
          // The opener of the phone shell (plugin lu-native, an Intent of the system). Not the shell plugin: a phone starts no program.
          var call = tauri.invoke('plugin:lu-native|open_external', { url: STORE_PAGE })
          if (call && typeof call.then === 'function') call.then(null, said)
        } catch (e) {
          said()
        }
      }
      page.appendChild(button)
      page.appendChild(failed)
    }
    document.body.appendChild(page)
  }

  try {
    var host = window.__LU_HOST__
    var ua = (window.navigator && window.navigator.userAgent) || ''
    var android = host === 'android' || (!host && /Android/.test(ua))
    if (!android) return
    var version = chromiumVersion(ua)
    // A version that can be read decides. Without one, what the floor stands
    // for is asked directly.
    var tooOld = version > 0 ? version < FLOOR : !styleSheetWorks()
    if (!tooOld) return
    // src/main.tsx reads this and does not start the app under the notice.
    window.__LU_WEBVIEW_TOO_OLD__ = true
    var run = function () {
      show(version)
    }
    if (document.body) run()
    else document.addEventListener('DOMContentLoaded', run)
  } catch (e) {
    // Never in the way of the app.
  }
})()
