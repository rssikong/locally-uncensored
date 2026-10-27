/**
 * Keep the paths of this machine out of the words a phone shows.
 *
 * The engine and the file import answer in their own sentences, and some of
 * them carry the full path of a file inside the app container. That path says
 * nothing a person can use and reads like a leak. On the phone only the file
 * name is shown. Pure and desktop-free: the desktop texts do not call this.
 */

/**
 * A path with at least one folder in front of the file name, unix or drive style.
 * The look-behind keeps "Settings/Models" and "and/or" alone: a path starts
 * after a space, a quote, a bracket or the start of the text.
 */
const PATH = /(?<![\w/.\\-])(?:\/(?:[^\s"'<>\\/:()[\]]+\/)+|[A-Za-z]:\\(?:[^\s"'<>\\/:()[\]]+\\)+)([^\s"'<>\\/:()[\]]+)/g

/** Every path in the text, cut down to its file name. */
export function withoutPaths(text: string): string {
  return text.replace(PATH, '$1')
}

/** The file name of a path, without the folder and without the ".gguf". */
export function modelNameOfPath(path: string): string {
  const last = path.trim().split(/[\\/]/).pop() ?? ''
  return last.replace(/\.gguf$/i, '')
}
