/**
 * A registry of providers.
 *
 * Everything the system does against the outside world — talk to an API, authenticate, read a
 * database, produce a video, stand in for a third party — is a named provider that the config picks by
 * name. The point is not indirection for its own sake: it is that adding a second way of doing any of
 * those things means registering one more implementation, not editing the system.
 *
 * A missing name says what IS available, because the alternative is a stack trace about `undefined`.
 */
export class Registry<T> {
  readonly kind: string;

  private readonly made = new Map<string, T>();

  constructor(kind: string) {
    this.kind = kind;
  }

  register(name: string, provider: T): this {
    this.made.set(name, provider);
    return this;
  }

  get(name: string): T {
    const found = this.made.get(name);
    if (!found) {
      throw new Error(`no ${this.kind} provider "${name}" — registered: ${[...this.made.keys()].join(", ") || "none"}`);
    }
    return found;
  }

  has(name: string): boolean {
    return this.made.has(name);
  }

  get names(): string[] {
    return [...this.made.keys()];
  }
}
