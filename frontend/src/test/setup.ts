import '@testing-library/jest-dom/vitest'

// Node 25 injects an experimental global `localStorage` that shadows jsdom's and
// lacks working methods in this env. Replace it with a simple in-memory store so
// component code (and tests) get a spec-compliant Storage.
class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() {
    return this.m.size
  }
  clear() {
    this.m.clear()
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  key(i: number) {
    return Array.from(this.m.keys())[i] ?? null
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v))
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemStorage(),
  configurable: true,
  writable: true,
})

// antd's auto-size textarea observes element size; jsdom has no ResizeObserver.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// antd's responsive hooks call window.matchMedia, which jsdom doesn't implement.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
