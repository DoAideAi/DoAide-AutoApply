import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount and clear the DOM between tests so component trees don't leak.
afterEach(() => {
  cleanup();
});

// Node 22+ ships its own `localStorage` global, which is unusable unless Node
// is started with --localstorage-file and shadows jsdom's. Give tests a
// working in-memory Storage when that happens.
if (typeof globalThis.localStorage?.clear !== "function") {
  const store = new Map();
  const memoryStorage = {
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(String(k)),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true });
  Object.defineProperty(window, "localStorage", { value: memoryStorage, configurable: true });
}
