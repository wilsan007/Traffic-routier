/**
 * Format des plaques d'immatriculation djiboutiennes.
 *
 * Deux familles, de structures différentes :
 *
 *  - Véhicules privés : la lettre `D` est INTERCALÉE entre les chiffres,
 *    3 chiffres · D · 2 chiffres — ex. « 123 D 45 ».
 *  - Véhicules officiels : la lettre TERMINE la plaque, précédée de 3 à 5
 *    chiffres, et rien après — ex. « 1234 A ».
 *    `A` et `B` = gouvernement, `C` = entreprises publiques.
 *
 * Ces deux familles couvrent l'intégralité du parc visé. Les plaques ONG,
 * ambassades et armée suivent d'autres conventions et sont VOLONTAIREMENT hors
 * périmètre : elles ne seront jamais reconnues, et c'est un choix, pas un oubli.
 *
 * Les plaques sont bilingues latin/arabe et portent le même numéro dans les deux
 * graphies : lire la partie latine suffit (ML Kit n'a de toute façon pas de
 * modèle arabe).
 *
 * Ce format strict est notre meilleur filtre : l'OCR embarqué lit TOUT le texte
 * visible (panneaux, publicités, inscriptions sur les camions), et seule une
 * validation de format permet d'écarter ce bruit.
 *
 * Module pur (aucune dépendance native) → testable en isolation.
 */

export type PlateCategory = 'PRIVE' | 'GOUVERNEMENT' | 'ENTREPRISE_PUBLIQUE';

/** Lettre de catégorie → nature du véhicule. */
export const PLATE_CATEGORIES: Readonly<Record<string, PlateCategory>> = {
  D: 'PRIVE',
  A: 'GOUVERNEMENT',
  B: 'GOUVERNEMENT',
  C: 'ENTREPRISE_PUBLIQUE',
};

/** Privé : `123D45` — la lettre D est au milieu. */
const PRIVATE_RE = /^\d{3}D\d{2}$/;
/** Officiel : `1234A` — la lettre finale, précédée de 3 à 5 chiffres. */
const OFFICIAL_RE = /^\d{3,5}[ABC]$/;

/** Index de la lettre `D` dans une plaque privée normalisée. */
const PRIVATE_LETTER_INDEX = 3;
/** Longueur d'une plaque privée normalisée (`123D45`). */
const PRIVATE_PLATE_LENGTH = 6;

/**
 * Confusions OCR classiques, appliquées uniquement aux positions qui DOIVENT
 * être des chiffres. La police FE-Schrift limite les ambiguïtés, mais l'angle,
 * le flou et les glyphes arabes voisins en produisent encore.
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
 * La correction des confusions est guidée par la position : un `O` à une
 * position numérique est forcément un `0`. On ne devine donc jamais à l'aveugle.
 *
 * En revanche, on ne corrige JAMAIS un chiffre vers une lettre de catégorie :
 * `123456` deviendrait `123A56`, une plaque parfaitement valide — n'importe quel
 * numéro à 6 chiffres croisé dans la rue passerait pour une immatriculation. Un
 * faux positif déclenche une vérification hotlist sur un véhicule innocent, donc
 * on exige une vraie lettre lue à la bonne position. La police FE-Schrift est
 * précisément conçue pour lever ces ambiguïtés, et le consensus temporel
 * rattrape les lectures manquées.
 *
 * @returns la plaque normalisée (`123D45` ou `1234A`), ou `null` si ce n'est pas
 *          une plaque.
 */
export function normalizeDjiboutiPlate(raw: string): string | null {
  if (!raw) return null;

  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Officiel : la lettre finale décide. On la teste en premier car elle est sans
  // ambiguïté — une plaque privée ne se termine jamais par A, B ou C.
  const last = cleaned.slice(-1);
  if (last === 'A' || last === 'B' || last === 'C') {
    const digits = digitsOnly(cleaned.slice(0, -1));
    if (digits === null) return null;
    const candidate = digits + last;
    return OFFICIAL_RE.test(candidate) ? candidate : null;
  }

  // Privé : `D` intercalée, entourée de chiffres — toujours 6 caractères.
  if (cleaned.length !== PRIVATE_PLATE_LENGTH) return null;
  if (cleaned[PRIVATE_LETTER_INDEX] !== 'D') return null;
  const head = digitsOnly(cleaned.slice(0, PRIVATE_LETTER_INDEX));
  const tail = digitsOnly(cleaned.slice(PRIVATE_LETTER_INDEX + 1));
  if (head === null || tail === null) return null;
  const candidate = `${head}D${tail}`;
  return PRIVATE_RE.test(candidate) ? candidate : null;
}

/** Catégorie d'une plaque normalisée, ou `null` si la plaque est invalide. */
export function plateCategory(plate: string): PlateCategory | null {
  if (PRIVATE_RE.test(plate)) return PLATE_CATEGORIES[plate[PRIVATE_LETTER_INDEX]] ?? null;
  if (OFFICIAL_RE.test(plate)) return PLATE_CATEGORIES[plate.slice(-1)] ?? null;
  return null;
}

/**
 * Mise en forme lisible d'une plaque normalisée.
 * `123D45` → `123 D 45` · `1234A` → `1234 A`
 */
export function formatDjiboutiPlate(plate: string): string {
  if (PRIVATE_RE.test(plate)) {
    return `${plate.slice(0, 3)} ${plate[PRIVATE_LETTER_INDEX]} ${plate.slice(4)}`;
  }
  if (OFFICIAL_RE.test(plate)) {
    return `${plate.slice(0, -1)} ${plate.slice(-1)}`;
  }
  return plate;
}
