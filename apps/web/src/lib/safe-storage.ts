/** localStorage that never throws (private windows, blocked storage, previews): reads return null, writes are dropped. */
export function readStored(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function writeStored(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* optional convenience */ }
}

/** sessionStorage that never throws: reads return null, writes are dropped. */
export function readSessionStored(key: string): string | null {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}
export function writeSessionStored(key: string, value: string): void {
  try { window.sessionStorage.setItem(key, value); } catch { /* optional convenience */ }
}
