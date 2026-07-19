// Consensus temporel des plaques lues EN CONTINU sur le flux caméra (on-device).
//
// La reconnaissance de texte tourne sur chaque frame vidéo (VisionCamera). Une
// lecture isolée est bruitée ; mais une vraie plaque de véhicule qui traverse
// le champ apparaît sur PLUSIEURS frames consécutives. On confirme donc une
// plaque uniquement quand elle a été vue au moins MIN_SIGHTINGS fois dans une
// fenêtre glissante, puis on applique un cooldown pour ne pas la ré-émettre en
// boucle tant que le même véhicule reste visible. C'est l'équivalent client du
// vote temporel serveur (plate_vote.py), sans suivi par identifiant (on
// déduplique par texte de plaque).

import { isPlausiblePlate, normalizePlate } from './plate';

export interface StreamVoteConfig {
  minSightings: number; // nb de frames où la plaque doit apparaître pour confirmer
  windowMs: number; // fenêtre glissante de comptage
  cooldownMs: number; // durée avant de pouvoir re-confirmer la même plaque
}

export const DEFAULT_STREAM_VOTE: StreamVoteConfig = {
  minSightings: 3,
  windowMs: 4000,
  cooldownMs: 8000,
};

export class StreamPlateAggregator {
  private sightings = new Map<string, number[]>(); // plaque -> timestamps (ms)
  private confirmedAt = new Map<string, number>(); // plaque -> dernier instant confirmé

  constructor(private config: StreamVoteConfig = DEFAULT_STREAM_VOTE) {}

  /**
   * Enregistre les candidats d'une frame et renvoie une plaque nouvellement
   * confirmée (consensus atteint) le cas échéant, sinon null. `now` est
   * injectable pour les tests.
   */
  observe(candidates: string[], now: number = Date.now()): string | null {
    const { minSightings, windowMs, cooldownMs } = this.config;

    for (const raw of candidates) {
      const plate = normalizePlate(raw);
      if (plate.length < 4 || plate.length > 10 || !isPlausiblePlate(plate)) continue;

      const times = this.sightings.get(plate) ?? [];
      times.push(now);
      // Ne garder que les observations dans la fenêtre glissante.
      const fresh = times.filter((t) => now - t <= windowMs);
      this.sightings.set(plate, fresh);

      const lastConfirmed = this.confirmedAt.get(plate);
      const onCooldown = lastConfirmed != null && now - lastConfirmed < cooldownMs;

      if (fresh.length >= minSightings && !onCooldown) {
        this.confirmedAt.set(plate, now);
        return plate; // consensus atteint : une plaque confirmée par appel
      }
    }
    return null;
  }

  /** Nettoie les entrées périmées (à appeler périodiquement pour borner la mémoire). */
  prune(now: number = Date.now()): void {
    const { windowMs, cooldownMs } = this.config;
    const horizon = Math.max(windowMs, cooldownMs);
    for (const [plate, times] of this.sightings) {
      const fresh = times.filter((t) => now - t <= windowMs);
      if (fresh.length === 0) this.sightings.delete(plate);
      else this.sightings.set(plate, fresh);
    }
    for (const [plate, t] of this.confirmedAt) {
      if (now - t > horizon) this.confirmedAt.delete(plate);
    }
  }
}
