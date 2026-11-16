/** A cancellable presentation transaction. It never reads or writes scientific coordinates. */
export type DisplayBundle = { readonly key: string };
export type DisplaySnapshot<T> = { readonly revision: number; readonly displayed: T; readonly requested: T; readonly phase: "settled" | "out" | "fitting" | "in" };

export class PresentationTransaction<T extends DisplayBundle> {
  private snapshot: DisplaySnapshot<T>;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;

  constructor(initial: T) {
    this.snapshot = { revision: 0, displayed: initial, requested: initial, phase: "settled" };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(snapshot: DisplaySnapshot<T>) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  request(next: T, immediate = false) {
    clearTimeout(this.timer);
    const revision = ++this.revision;
    if (immediate || next.key === this.snapshot.displayed.key) {
      this.publish({ revision, displayed: next, requested: next, phase: "settled" });
      return;
    }
    this.publish({ revision: this.snapshot.revision, displayed: this.snapshot.displayed, requested: next, phase: "out" });
    this.timer = setTimeout(() => {
      if (revision !== this.revision) return;
      // Geometry, provenance, representation and camera commit together while the stage is invisible.
      this.publish({ revision, displayed: next, requested: next, phase: "fitting" });
    }, 140);
  }

  presented(key: string, revision = this.snapshot.revision) {
    if (revision !== this.snapshot.revision || key !== this.snapshot.displayed.key || this.snapshot.phase !== "fitting") return;
    this.publish({ ...this.snapshot, phase: "in" });
    this.timer = setTimeout(() => {
      if (revision === this.revision) this.publish({ ...this.snapshot, phase: "settled" });
    }, 200);
  }

  cancel() {
    clearTimeout(this.timer);
    ++this.revision;
    this.snapshot = { ...this.snapshot, requested: this.snapshot.displayed, phase: "settled" };
  }
}
