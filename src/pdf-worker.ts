// PDF.js 6 used this proposed Map helper. Keep the worker safe if an older
// cached PDF.js module is ever resumed by a mobile browser during an update.
const mapPrototype = Map.prototype as Map<unknown, unknown> & {
  getOrInsertComputed?: <T>(key: unknown, factory: () => T) => T;
};

if (!mapPrototype.getOrInsertComputed) {
  Object.defineProperty(mapPrototype, "getOrInsertComputed", {
    configurable: true,
    value<T>(key: unknown, factory: () => T): T {
      if (this.has(key)) return this.get(key) as T;
      const value = factory();
      this.set(key, value);
      return value;
    },
  });
}

import "pdfjs-dist/build/pdf.worker.min.mjs";
