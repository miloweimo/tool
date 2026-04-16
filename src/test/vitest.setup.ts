/** 测试环境下 Node 可能注入不完整的 `localStorage`；用内存实现保证与 `theme` 等模块一致 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.get(key) ?? null
    },
    key(index: number) {
      return [...map.keys()][index] ?? null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(String(key), String(value))
    }
  } as Storage
}

const testLocalStorage = createMemoryStorage()
Object.defineProperty(globalThis, 'localStorage', {
  value: testLocalStorage,
  configurable: true,
  writable: true
})
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: testLocalStorage,
    configurable: true,
    writable: true
  })
}
