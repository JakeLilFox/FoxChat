export class SelectiveCache<Key, Value> {
  private values = new Map<Key, Value>()

  get(key: Key, create: () => Value): Value {
    if (this.values.has(key)) return this.values.get(key)!
    const value = create()
    this.values.set(key, value)
    return value
  }

  invalidate(keys: Iterable<Key>) {
    for (const key of keys) this.values.delete(key)
  }

  clear() {
    this.values.clear()
  }

  retain(keys: ReadonlySet<Key>) {
    for (const key of this.values.keys()) {
      if (!keys.has(key)) this.values.delete(key)
    }
  }
}
