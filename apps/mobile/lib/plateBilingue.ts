/**
 * Vérification croisée latin/arabe d'une lecture de plaque djiboutienne.
 *
 * Portage TypeScript de `tools/plate-dataset/crosscheck.py`, validé côté
 * atelier sur photos réelles — les deux implémentations doivent rester
 * jumelles, et les cas de test en bas de fichier sont la copie exacte de la
 * suite Python.
 *
 * Principe : les deux graphies d'une plaque portent le même numéro. Leur
 * concordance VALIDE une lecture, leur désaccord la REJETTE — et c'est
 * l'arabe qui lève la seule ambiguïté insoluble du latin : en police
 * 7 segments, le `D` est gravé comme un `0` (« 252 D 105 » se lit
 * « 2520105 »), et seul le `ج` dit qu'un D s'y cache.
 *
 * Deux subtilités découvertes sur le terrain, sans lesquelles ce module
 * rejette des plaques parfaitement lues :
 *
 *   - l'ORDRE des groupes arabes varie selon le fabricant : la plupart des
 *     plaques portent l'ordre inversé (suffixe, lettre, préfixe — « ١٠٥ج٢٥٢ »
 *     pour 252 D 105), mais « 163 D 69 » porte « ١٦٣ج٦٩ », l'ordre direct.
 *     On essaie les deux, le latin arbitre ;
 *   - un glyphe halluciné peut tomber dans la BONNE écriture (« ب٥٦ج٢٣٤ »
 *     observé pour « ٥٦ج٢٣٤ ») : seul le COMPTAGE l'attrape, car les deux
 *     graphies ont toujours exactement autant de caractères.
 *
 * Module pur (aucune dépendance) → testable en isolation.
 */

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const AR_LETTERS: Record<string, string> = { 'ج': 'D', 'ا': 'A', 'ب': 'B', 'ت': 'C' };
const LATIN_CHARS = new Set('0123456789ABCDT');

export interface Lecture {
  plate: string | null;
  agreed: boolean;
  reason: string;
}

/** Sépare une lecture brute en partie latine et partie arabe. */
export function splitScripts(raw: string): { latin: string; arabic: string } {
  let latin = '';
  let arabic = '';
  for (const c of raw) {
    if (LATIN_CHARS.has(c)) latin += c;
    else if (AR_DIGITS.includes(c) || c in AR_LETTERS) arabic += c;
  }
  return { latin, arabic };
}

function arDigitsOf(segment: string): string {
  let out = '';
  for (const c of segment) {
    const i = AR_DIGITS.indexOf(c);
    if (i >= 0) out += String(i);
  }
  return out;
}

/**
 * Interprétations possibles de la partie arabe — il peut y en avoir DEUX,
 * une par ordre de fabricant. La concordance avec le latin tranchera.
 */
export function parseArabic(arabic: string): Set<string> {
  const letters = [...arabic].filter((c) => c in AR_LETTERS);
  if (letters.length === 0) return new Set();

  // Plusieurs lettres DIFFÉRENTES : lecture corrompue, on refuse de choisir.
  if (new Set(letters.map((c) => AR_LETTERS[c])).size > 1) return new Set();

  // « تت » = TT. L'ordre des groupes ne change pas la lecture.
  if (letters.length === 2 && letters[0] === 'ت' && letters[1] === 'ت') {
    const digits = arDigitsOf(arabic);
    return digits ? new Set([`${digits}TT`]) : new Set();
  }
  if (letters.length !== 1) return new Set();

  const letter = AR_LETTERS[letters[0]];
  const i = arabic.indexOf(letters[0]);
  const left = arDigitsOf(arabic.slice(0, i));
  const right = arDigitsOf(arabic.slice(i + 1));

  if (letter === 'D') {
    const out = new Set<string>();
    if (left && right) {
      out.add(`${right}D${left}`); // inversé : gauche = suffixe
      out.add(`${left}D${right}`); // direct  : gauche = préfixe
    }
    return out;
  }
  // Officiel : le nombre est d'UN seul côté de la lettre.
  if (right && !left) return new Set([`${right}${letter}`]);
  if (left && !right) return new Set([`${left}${letter}`]);
  return new Set();
}

/** Confronte les deux graphies et n'accepte que si elles concordent. */
export function reconcile(raw: string): Lecture {
  const { latin, arabic } = splitScripts(raw.toUpperCase());

  if (!latin) return { plate: null, agreed: false, reason: 'aucun latin lu' };
  if (!arabic) return { plate: null, agreed: false, reason: 'aucun arabe lu' };

  // Même numéro des deux côtés ⇒ exactement autant de caractères. Ce test
  // attrape les glyphes hallucinés que le tri par alphabet ne voit pas.
  if (latin.length !== arabic.length) {
    return {
      plate: null,
      agreed: false,
      reason: `compte inégal : ${latin.length} latin vs ${arabic.length} arabe`,
    };
  }

  const candidats = parseArabic(arabic);
  if (candidats.size === 0) {
    return { plate: null, agreed: false, reason: 'arabe illisible ou sans lettre' };
  }

  const concordances = new Map<string, string>();
  for (const cand of candidats) {
    if (latin === cand) {
      concordances.set(cand, 'latin et arabe identiques');
    } else if (latin === cand.replace('D', '0')) {
      // 7 segments : le latin porte un `0` là où l'arabe dit `D`.
      concordances.set(cand, "D reconstruit depuis l'arabe (7 segments)");
    }
  }

  if (concordances.size === 1) {
    const [plate, reason] = [...concordances.entries()][0];
    return { plate, agreed: true, reason };
  }
  if (concordances.size > 1) {
    return {
      plate: null,
      agreed: false,
      reason: `ambigu : les deux ordres concordent (${[...concordances.keys()].sort().join('/')})`,
    };
  }
  return {
    plate: null,
    agreed: false,
    reason: `désaccord : latin=${latin} arabe=${[...candidats].sort().join('/')}`,
  };
}

/**
 * Suite de tests jumelle de `crosscheck.py` — les DEUX implémentations
 * doivent donner exactement ces résultats. Retourne les échecs (vide = OK).
 */
export function selfTest(): string[] {
  const cases: [string, string | null][] = [
    ['252D105١٠٥ج٢٥٢', '252D105'], // standard : concordance directe
    ['2520105١٠٥ج٢٥٢', '252D105'], // 7 segments : D gravé 0, arabe tranche
    ['7240053٥٣ج٧٢٤', null], //       désaccord (compte inégal) -> rejet
    ['3044Cت٣٠٤٤', '3044C'], //       officiel, ordre inversé
    ['48009TTتت٤٨٠٠٩', '48009TT'], // transit
    ['163069', null], //              arabe manquant -> rejet
    ['163D69١٦٣ج٦٩', '163D69'], //    ordre direct
    ['163069١٦٣ج٦٩', '163D69'], //    7 segments + ordre direct
    ['3725C٣٧٢٥ت', '3725C'], //       officiel, ordre direct
    ['163D69٦٩ج١٦٣', '163D69'], //    ordre inversé du même numéro
    ['234D56ب٥٦ج٢٣٤', null], //       glyphe halluciné -> compte inégal
  ];
  const echecs: string[] = [];
  for (const [raw, attendu] of cases) {
    const r = reconcile(raw);
    if (r.plate !== attendu) {
      echecs.push(`${raw} -> ${r.plate} (attendu ${attendu}) [${r.reason}]`);
    }
  }
  return echecs;
}
