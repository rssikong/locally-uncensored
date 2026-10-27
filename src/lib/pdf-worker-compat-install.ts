// First import of lib/pdf-worker-compat.ts: a module of its own, because
// imports run in the order they stand in and before the body of the module
// that names them.
import { installWebViewPolyfills } from './webview-polyfills'

installWebViewPolyfills()
