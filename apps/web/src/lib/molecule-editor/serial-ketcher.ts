/**
 * Ketcher's standalone structure service talks to Indigo through one worker channel. Observed with 3.12.0
 * (isolated geometry run): when two requests are in flight at once their answers can cross, so `getSmiles()`
 * returned a MOL block and `getMolfile()` returned "CCN". The editor reads the drawing from several places (live
 * read-outs, Generate 3D, export, tests), so every asynchronous Ketcher/Indigo call is queued and runs one at a time.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
}

const ASYNC_TOP_LEVEL = new Set([
  "getMolfile", "getSmiles", "getExtendedSmiles", "getKet", "getInchi", "getInChIKey", "getSdf", "getRxn", "getSmarts", "getCml",
  "calculate", "generateImage", "setMolecule", "addFragment", "layout", "recognize",
]);

function queueMethods<T extends object>(target: T, queue: SerialQueue, only?: ReadonlySet<string>): T {
  return new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key, object) as unknown;
      if (typeof value !== "function") return value;
      if (only && !(typeof key === "string" && only.has(key))) return (value as (...args: unknown[]) => unknown).bind(object);
      return (...args: unknown[]) => queue.run(async () => (value as (...a: unknown[]) => unknown).apply(object, args));
    },
    has: (object, key) => Reflect.has(object, key),
    set: (object, key, value) => Reflect.set(object, key, value, object),
  }) as T;
}

type WithServices = {
  indigo?: object;
  formatterFactory?: { create: (...args: unknown[]) => object };
};

/** Wrap a Ketcher instance so its asynchronous calls never overlap. Synchronous members (editor, changeEvent) are untouched. */
export function serializeKetcher<T extends object>(ketcher: T, queue = new SerialQueue()): T {
  const services = ketcher as T & WithServices;
  return new Proxy(ketcher, {
    get(object, key) {
      const value = Reflect.get(object, key, object) as unknown;
      if (key === "indigo" && services.indigo) return queueMethods(services.indigo, queue);
      if (key === "formatterFactory" && services.formatterFactory) {
        const factory = services.formatterFactory;
        return { create: (...args: unknown[]) => queueMethods(factory.create(...args), queue) };
      }
      if (typeof value === "function") {
        const fn = value as (...a: unknown[]) => unknown;
        if (typeof key === "string" && ASYNC_TOP_LEVEL.has(key)) return (...args: unknown[]) => queue.run(async () => fn.apply(object, args));
        return fn.bind(object);
      }
      return value;
    },
  });
}
