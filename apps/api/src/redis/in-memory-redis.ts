// Repli en mémoire quand aucun Redis n'est configuré (REDIS_URL absent), par
// ex. sur une offre d'hébergement gratuite sans Redis. Implémente uniquement
// le sous-ensemble de commandes utilisé par l'application (cache + healthcheck)
// avec expiration (EX) approximative. Non partagé entre instances : parfait
// pour un déploiement mono-instance ; à remplacer par un vrai Redis pour scaler.
export class InMemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private isExpired(entry: { expiresAt: number | null }): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  // Signature alignée sur ioredis : set(key, value, 'EX', seconds).
  async set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<'OK'> {
    const expiresAt =
      mode?.toUpperCase() === 'EX' && ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }

  // Glob simple façon Redis (`*` = n'importe quelle séquence).
  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    const out: string[] = [];
    for (const [k, entry] of this.store) {
      if (this.isExpired(entry)) {
        this.store.delete(k);
        continue;
      }
      if (regex.test(k)) out.push(k);
    }
    return out;
  }

  async ping(): Promise<'PONG'> {
    return 'PONG';
  }

  disconnect(): void {
    this.store.clear();
  }
}
