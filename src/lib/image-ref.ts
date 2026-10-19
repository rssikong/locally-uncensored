/**
 * A source image for Create. `filename` is the backend handle (a ComfyUI
 * /upload/image name on the local path, or a render-inputs storage path on
 * the cloud path); `url` is a local object/data URL for preview. Runtime-only,
 * never persisted. Lives here so lib code can name it without importing the
 * store.
 */
export interface ImageRef {
  filename: string; url: string; width: number; height: number
  /** The name of the file the user picked, where there was one. `filename` is
   *  the staged name of the local backend and is empty on cloud. */
  name?: string
}
