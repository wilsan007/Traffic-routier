/**
 * Consensus temporel on-device pour la reconnaissance de plaques en flux continu.
 *
 * Principe : l'OCR embarqué produit du texte brut par frame (souvent bruité).
 * Une plaque n'est confirmée QUE si elle est vue de manière cohérente sur
 * plusieurs frames dans une fenêtre temporelle (= un vrai véhicule qui passe),
 * puis mise en cooldown pour éviter les doublons tant qu'elle reste visible.
 *
 * Module pur (aucune dépendance native) → testable en isolation.
 */

import { normalizeDjiboutiPlate } from './djiboutiPlate';

export interface PlateVoteConfig {
  /** Nombre minimum de frames confirmant la plaque dans la fenêtre. */
  minSightings: number;
  /** Largeur de la fenêtre glissante de vote (ms). */
  windowMs: number;
  /** Durée pendant laquelle une plaque confirmée ne peut pas re-déclencher (ms). */
  cooldownMs: number;
}

export const DEFAULT_PLATE_VOTE_CONFIG: PlateVoteConfig = {
  minSightings: 3,
  windowMs: 2500,
  cooldownMs: 8000,
};

interface Sighting {
  plate: string;
  timestamps: number[];
  lastConfirmedAt: number | null;
}

export interface ConfirmedPlate {
  plate: string;
  sightings: number;
  at: number;
}

/**
 * Normalise un fragment de texte en plaque candidate.
 *
 * Délègue au format national (voir `djiboutiPlate`) : c'est lui qui décide ce
 * qui est une plaque. L'OCR embarqué lit tout le texte visible — panneaux,
 * publicités, inscriptions sur les camions — et seule une validation de format
 * stricte permet d'écarter ce bruit.
 *
 * Retourne null si ce n'est pas une plaque valide.
 */
export function normalizePlateCandidate(raw: string): string | null {
  return normalizeDjiboutiPlate(raw);
}

/**
 * Extrait les plaques candidates depuis les blocs de texte OCR d'une frame.
 * Chaque ligne/bloc est traité séparément car une plaque tient sur une ligne.
 */
export function extractCandidates(texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    // Une plaque est lue « 123 D 45 » : c'est la ligne entière recollée qui
    // correspond, pas les tokens isolés. On tente quand même les tokens, au cas
    // où l'OCR agrège la plaque avec du texte voisin sur la même ligne.
    const joined = normalizePlateCandidate(t);
    if (joined) out.add(joined);
    for (const token of t.split(/\s+/)) {
      const n = normalizePlateCandidate(token);
      if (n) out.add(n);
    }
  }
  return [...out];
}

/**
 * Machine à vote temporel. Alimentée frame par frame avec les plaques
 * candidates ; émet une plaque confirmée quand le consensus est atteint.
 */
export class PlateStreamVoter {
  private readonly cfg: PlateVoteConfig;
  private readonly sightings = new Map<string, Sighting>();

  constructor(cfg: Partial<PlateVoteConfig> = {}) {
    this.cfg = { ...DEFAULT_PLATE_VOTE_CONFIG, ...cfg };
  }

  /**
   * Ingère les plaques candidates d'une frame à l'instant `now`.
   * Retourne la liste des plaques nouvellement CONFIRMÉES lors de cet appel.
   */
  ingest(candidates: string[], now: number): ConfirmedPlate[] {
    const confirmed: ConfirmedPlate[] = [];
    const unique = new Set(candidates);

    for (const plate of unique) {
      let s = this.sightings.get(plate);
      if (!s) {
        s = { plate, timestamps: [], lastConfirmedAt: null };
        this.sightings.set(plate, s);
      }
      s.timestamps.push(now);
      // fenêtre glissante : ne garder que les vues récentes.
      s.timestamps = s.timestamps.filter((ts) => now - ts <= this.cfg.windowMs);

      const inCooldown =
        s.lastConfirmedAt !== null && now - s.lastConfirmedAt < this.cfg.cooldownMs;

      if (!inCooldown && s.timestamps.length >= this.cfg.minSightings) {
        s.lastConfirmedAt = now;
        confirmed.push({ plate, sightings: s.timestamps.length, at: now });
      }
    }

    this.evict(now);
    return confirmed;
  }

  /** Nettoyage : oublie les plaques inactives (hors fenêtre et hors cooldown). */
  private evict(now: number): void {
    for (const [plate, s] of this.sightings) {
      const staleWindow = s.timestamps.every((ts) => now - ts > this.cfg.windowMs);
      const staleCooldown =
        s.lastConfirmedAt === null || now - s.lastConfirmedAt > this.cfg.cooldownMs;
      if (staleWindow && staleCooldown) {
        this.sightings.delete(plate);
      }
    }
  }

  /** Réinitialise complètement l'état du voteur. */
  reset(): void {
    this.sightings.clear();
  }

  /** Nombre de plaques actuellement suivies (pour debug/affichage). */
  get tracked(): number {
    return this.sightings.size;
  }
}
