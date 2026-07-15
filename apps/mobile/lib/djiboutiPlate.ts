/**
 * Format des plaques d'immatriculation djiboutiennes.
 *
 * Trois familles reconnues, de structures différentes :
 *
 *   - Privé      `243 D 95`, `886 D 100`  — D intercalée, 3 chiffres avant,
 *                                            2 ou 3 après.
 *   - Officiel   `1234 A`                 — 3 à 5 chiffres puis la lettre finale.
 *                                            A et B = gouvernement,
 *                                            C = entreprises publiques.
 *   - Transit    `3090 TT`                — 3 à 5 chiffres puis TT.
 *
 * Les plaques sont bilingues latin/arabe et portent le même numéro dans les deux
 * graphies : lire la partie latine suffit (ML Kit n'a de toute façon pas de
 * modèle arabe).
 *
 * Hors périmètre : ONG (fond bleu), corps consulaire et diplomatique CC/CD
 * (fond vert), armée. Leurs conventions diffèrent et ne seront jamais
 * reconnues — c'est un choix, pas un oubli.
 *
 * ⚠️ Deux pièges vérifiés sur photos de plaques réelles :
 *
 *   1. Deux polices coexistent, au choix du client. En police « digitale »
 *      (7 segments), le `D` est visuellement indiscernable d'un `0` : la même
 *      plaque `163 D 69` se lit `163069`. Voir `normalizeDjiboutiPlate`.
 *   2. La couleur du fond est porteuse de sens, pas décorative — un format
 *      A/B/C/D sur un fond non noir est suspect. Voir `isBackgroundSuspicious`.
 *
 * Module pur (aucune dépendance native) → testable en isolation.
 */

export type PlateCategory = 'PRIVE' | 'GOUVERNEMENT' | 'ENTREPRISE_PUBLIQUE' | 'TRANSIT';

/** Couleur de fond d'une plaque, telle qu'observée sur l'image. */
export type PlateBackground = 'NOIR' | 'ROUGE' | 'BLEU' | 'VERT' | 'INCONNU';

/** Privé : `243D95` ou `886D100` — D intercalée. */
const PRIVATE_RE = /^\d{3}D\d{2,3}$/;
/** Officiel : `1234A` — lettre finale A, B ou C, précédée de 3 à 5 chiffres. */
const OFFICIAL_RE = /^\d{3,5}[ABC]$/;
/** Transit : `3090TT` — suffixe TT, précédé de 3 à 5 chiffres. */
const TRANSIT_RE = /^\d{3,5}TT$/;

/** Index de la lettre `D` dans une plaque privée normalisée. */
const PRIVATE_LETTER_INDEX = 3;

/**
 * Confusions OCR classiques, appliquées uniquement aux positions qui DOIVENT
 * être des chiffres.
 */
const TO_DIGIT: Readonly<Record<string, string>> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  Z: '2',
  A: '4',
  S: '5',
  G: '6',
  T: '7',
  B: '8',
};

/** Convertit en chiffres les caractères d'un fragment, ou `null` si impossible. */
function digitsOnly(fragment: string): string | null {
  let out = '';
  for (const c of fragment) {
    if (c >= '0' && c <= '9') {
      out += c;
      continue;
    }
    const fixed = TO_DIGIT[c];
    if (!fixed) return null;
    out += fixed;
  }
  return out;
}

/**
 * Normalise un fragment de texte OCR en plaque djiboutienne valide.
 *
 * `trusted` indique que le texte provient d'une région déjà identifiée comme une
 * plaque par le détecteur. Ce drapeau change ce qu'on s'autorise à corriger :
 *
 *   - `false` (défaut) — le texte vient de l'image entière, il peut s'agir de
 *     n'importe quoi. On exige une vraie lettre lue : corriger un chiffre vers
 *     une lettre transformerait `163069` en `163D69`… mais aussi n'importe quel
 *     numéro à 6 chiffres croisé dans la rue. Un faux positif déclenche une
 *     vérification hotlist sur un véhicule innocent.
 *   - `true` — le texte vient d'une plaque avérée. `163069` EST alors une
 *     plaque, et rétablir le `D` masqué par la police digitale devient sûr.
 *     Sans cela, toutes les plaques en police 7 segments seraient ignorées.
 *
 * @returns la plaque normalisée (`123D45`, `1234A`, `3090TT`), ou `null`.
 */
export function normalizeDjiboutiPlate(raw: string, trusted = false): string | null {
  if (!raw) return null;

  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Transit : le suffixe TT est sans ambiguïté, on le teste en premier.
  if (cleaned.endsWith('TT')) {
    const digits = digitsOnly(cleaned.slice(0, -2));
    if (digits === null) return null;
    const candidate = `${digits}TT`;
    return TRANSIT_RE.test(candidate) ? candidate : null;
  }

  // Officiel : la lettre finale décide. Une plaque privée ne finit jamais par
  // A, B ou C, donc aucun conflit avec la famille ci-dessous.
  const last = cleaned.slice(-1);
  if (last === 'A' || last === 'B' || last === 'C') {
    const digits = digitsOnly(cleaned.slice(0, -1));
    if (digits === null) return null;
    const candidate = digits + last;
    return OFFICIAL_RE.test(candidate) ? candidate : null;
  }

  // Privé : `D` intercalée. En police digitale, elle a pu être lue comme un `0`,
  // que l'on ne rétablit que si la région est une plaque avérée.
  const head = digitsOnly(cleaned.slice(0, PRIVATE_LETTER_INDEX));
  const tail = digitsOnly(cleaned.slice(PRIVATE_LETTER_INDEX + 1));
  if (head === null || tail === null) return null;

  const letter = cleaned[PRIVATE_LETTER_INDEX];
  const isD = letter === 'D' || (trusted && (letter === '0' || letter === 'O'));
  if (!isD) return null;

  const candidate = `${head}D${tail}`;
  return PRIVATE_RE.test(candidate) ? candidate : null;
}

/** Catégorie d'une plaque normalisée, ou `null` si la plaque est invalide. */
export function plateCategory(plate: string): PlateCategory | null {
  if (PRIVATE_RE.test(plate)) return 'PRIVE';
  if (TRANSIT_RE.test(plate)) return 'TRANSIT';
  if (OFFICIAL_RE.test(plate)) {
    const letter = plate.slice(-1);
    return letter === 'C' ? 'ENTREPRISE_PUBLIQUE' : 'GOUVERNEMENT';
  }
  return null;
}

/** Couleur de fond réglementaire pour une catégorie. */
export function expectedBackground(category: PlateCategory): PlateBackground {
  return category === 'TRANSIT' ? 'ROUGE' : 'NOIR';
}

/**
 * Signale une plaque dont le fond ne correspond pas à sa catégorie.
 *
 * La couleur n'est pas décorative : chaque catégorie a son fond réglementaire
 * (noir pour privé/gouvernement/entreprises, rouge pour le transit, bleu pour
 * les ONG, vert pour CC/CD). Un numéro au format privé ou officiel affiché sur
 * un fond non noir est donc une anomalie — plaque contrefaite, ou remontée sur
 * un autre véhicule. C'est un signal à remonter à l'agent, pas à écarter
 * silencieusement.
 *
 * `INCONNU` ne déclenche rien : mal éclairée ou de biais, la couleur n'est pas
 * toujours mesurable, et l'incertitude ne doit pas devenir une accusation.
 */
export function isBackgroundSuspicious(plate: string, observed: PlateBackground): boolean {
  if (observed === 'INCONNU') return false;
  const category = plateCategory(plate);
  if (!category) return false;
  return observed !== expectedBackground(category);
}

/**
 * Mise en forme lisible d'une plaque normalisée.
 * `123D45` → `123 D 45` · `1234A` → `1234 A` · `3090TT` → `3090 TT`
 */
export function formatDjiboutiPlate(plate: string): string {
  if (PRIVATE_RE.test(plate)) {
    return `${plate.slice(0, 3)} ${plate[PRIVATE_LETTER_INDEX]} ${plate.slice(4)}`;
  }
  if (TRANSIT_RE.test(plate)) return `${plate.slice(0, -2)} TT`;
  if (OFFICIAL_RE.test(plate)) return `${plate.slice(0, -1)} ${plate.slice(-1)}`;
  return plate;
}
