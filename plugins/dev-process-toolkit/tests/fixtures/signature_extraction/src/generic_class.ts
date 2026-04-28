export class Container<T extends string | number> {
  readonly value: T;
  constructor(value: T) {
    this.value = value;
  }
  get<K extends keyof this>(key: K): this[K] {
    return this[key];
  }
}
