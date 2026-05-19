type SilenceEntry = {
  project: string;
  service: string | null; // null = toàn bộ project
  expiresAt: number;
};

class SilenceManager {
  #entries = new Map<string, SilenceEntry>();

  #key(project: string, service: string | null): string {
    return `${project}::${service ?? "*"}`;
  }

  silence(project: string, service: string | null, durationMs: number): void {
    const key = this.#key(project, service);
    this.#entries.set(key, { project, service, expiresAt: Date.now() + durationMs });
  }

  isSilenced(project: string, service: string): boolean {
    const now = Date.now();
    return (
      this.#isActive(this.#key(project, service), now) ||
      this.#isActive(this.#key(project, null), now)
    );
  }

  #isActive(key: string, now: number): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= now) {
      this.#entries.delete(key);
      return false;
    }
    return true;
  }

  clear(project: string, service: string | null): void {
    this.#entries.delete(this.#key(project, service));
  }

  listActive(): Array<SilenceEntry & { remainingMs: number }> {
    const now = Date.now();
    const result: Array<SilenceEntry & { remainingMs: number }> = [];
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt > now) {
        result.push({ ...entry, remainingMs: entry.expiresAt - now });
      } else {
        this.#entries.delete(key);
      }
    }
    return result;
  }
}

export const silenceManager = new SilenceManager();
