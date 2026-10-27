// The worker of pdf.js for a web view that misses functions pdf.js calls.
//
// Only started where something is missing (api/rag.ts asks
// lib/webview-polyfills.ts). Everywhere else pdf.js starts its own worker
// file exactly as before. The order of the two imports is the whole point:
// the functions have to stand before the code of pdf.js runs.
import './pdf-worker-compat-install'
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
