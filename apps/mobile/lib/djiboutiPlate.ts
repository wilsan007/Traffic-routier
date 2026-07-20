/**
 * Format des plaques d'immatriculation djiboutiennes.
 *
 * Trois familles reconnues, de structures différentes :
 *
 *   - Privé      `243 D 95`, `886 D 100`  — D intercalée.
 *   - Officiel   `1234 A`                 — 3 à 5 chiffres puis la lettre finale.
 *                                            A et B = gouvernement,
 *                                            C = entreprises publiques.
 *   - Transit    `3090 TT`                — 3 à 5 chiffres puis TT.
 *
 * Numérotation des plaques privées : le nombre avant le `D` court de 1 à 999 ;
 * arrivé à 999, il repart à 1 et le nombre après le `D` s'incrémente. Les deux
 * parties font donc 1 à 3 chiffres, sans zéros de complément (`243 D 95` et
 * `886 D 100` coexistent). N'exiger que des préfixes à 3 chiffres écarterait
 * 10 % du parc — ceux du début de chaque cycle (`1 D 5`, `47 D 12`).
 *
 * Les plaques sont bilingues latin/arabe et portent le même numéro dans les deux
 * graphies : lire la partie latine suffit (ML Kit n'a de toute façon pas de
 * modèle arabe).
 *
 * Hors périmètre — c'est un choix, pas un oubli : catégorie IT, ONG (fond bleu),
 * corps consulaire et diplomatique CC/CD (fond vert), et armée.
 *
 * Les plaques militaires sont de longs numéros — 10 à 12 chiffres, éventuellement
 * préfixés `GN` ou `GR`. Elles sont écartées par les seules bornes de longueur
 * ci-dessous : élargir ces bornes « pour mieux capter » se mettrait à les
 * reconnaître, sans que rien ne le signale.
 *
 * Deux formats physiques coexistent, et ils ne se valent pas à la lecture :
 * le format CARRÉ porte le latin et l'arabe sur deux lignes superposées, le
 * format RECTANGULAIRE les met sur une seule ligne, côte à côte. Mesuré sur
 * photos réelles, le rectangulaire est nettement plus difficile : la frontière
 * entre les deux graphies n'y est marquée par aucun blanc franc, alors que le
 * carré offre une séparation horizontale nette.
 *
 * ⚠️ Trois pièges vérifiés sur photos de plaques réelles :
 *
 *   1. Deux polices coexistent, au choix du client. En police « digitale »
 *      (7 segments), le `D` est visuellement indiscernable d'un `0` : la même
 *      plaque `163 D 69` se lit `163069`. Voir `normalizeDjiboutiPlate`.
 *   2. La couleur du fond est porteuse de sens, pas décorative — un format
 *      A/B/C/D sur un fond non noir est suspect. Voir `isBackgroundSuspicious`.
 *   3. Une plaque ne portant qu'une seule graphie est non conforme, et prive
 *      la lecture de toute vérification croisée. Voir
 *      `isSingleScriptSuspicious`.
 *
 * Module pur (aucune dépendance native) → testable en isolation.
 */

export type PlateCategory = 'PRIVE' | 'GOUVERNEMENT' | 'ENTREPRISE_PUBLIQUE' | 'TRANSIT';

/** Couleur de fond d'une plaque, telle qu'observée sur l'image. */
export type PlateBackground = 'NOIR' | 'ROUGE' | 'BLEU' | 'VERT' | 'INCONNU';

/**
 * Privé : `243D95`, `886D100`, `7D5` — D intercalée, 1 à 3 chiffres de chaque
 * côté. Les nombres vont de 1 à 999 sans zéro de complément : un `069` est donc
 * invalide, et cette contrainte est ce qui lève l'ambiguïté du découpage.
 */
const PRIVATE_RE = /^[1-9]\d{0,2}D[1-9]\d{0,2}$/;
/** Officiel : `1234A` — lettre finale A, B ou C, précédée de 3 à 5 chiffres. */
const OFFICIAL_RE = /^\d{3,5}[ABC]$/;
/** Transit : `3090TT` — suffixe TT, précédé de 3 à 5 chiffres. */
const TRANSIT_RE = /^\d{3,5}TT$/;

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

  // Privé : la position du `D` varie avec la longueur du préfixe, et en police
  // digitale il a pu être lu comme un `0`. On essaie donc chaque position
  // plausible et on ne retient que les découpages réellement valides.
  const found: string[] = [];
  for (let i = 1; i < cleaned.length - 1; i++) {
    const c = cleaned[i];
    const isD = c === 'D' || (trusted && (c === '0' || c === 'O'));
    if (!isD) continue;

    const head = digitsOnly(cleaned.slice(0, i));
    const tail = digitsOnly(cleaned.slice(i + 1));
    if (head === null || tail === null) continue;

    const candidate = `${head}D${tail}`;
    if (PRIVATE_RE.test(candidate) && !found.includes(candidate)) found.push(candidate);
  }

  // Plusieurs découpages valides : on refuse plutôt que de deviner. Une plaque
  // inventée vaut bien pire qu'une plaque manquée — le consensus temporel
  // rattrapera la lecture suivante.
  return found.length === 1 ? found[0] : null;
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

/** Ce que le lecteur est parvenu à lire sur la plaque. */
export type ScriptsLus = { latin: boolean; arabe: boolean };

/**
 * Signale une plaque qui ne porte qu'une seule graphie.
 *
 * Une plaque djiboutienne est bilingue par construction : le même numéro y
 * figure en latin ET en arabe. Une plaque n'en portant qu'une est donc
 * non conforme — contrefaçon, plaque artisanale, ou graphie effacée.
 *
 * ⚠️ Le retour est `true` pour ANOMALIE À VÉRIFIER, jamais pour infraction
 * établie, et la distinction est essentielle. Le lecteur ne sait pas faire la
 * différence entre :
 *
 *   - la plaque ne porte effectivement qu'une graphie — non-conformité réelle ;
 *   - l'autre graphie existe mais n'a pas été lue — angle, ombre portée, boue,
 *     recadrage trop serré, ligne hors champ.
 *
 * Mesuré sur le corpus de photos réelles : deux plaques n'exposaient aucun
 * arabe lisible, sans qu'on puisse trancher entre les deux causes. Verbaliser
 * sur ce seul signal sanctionnerait un conducteur pour une plaque sale ou une
 * photo mal cadrée. L'agent tranche, l'application signale.
 *
 * Conséquence pratique : ces plaques n'ont AUCUNE vérification croisée
 * possible — leur numéro repose sur une lecture unique, donc sans filet. Elles
 * méritent doublement un contrôle visuel.
 */
export function isSingleScriptSuspicious(lus: ScriptsLus): boolean {
  return lus.latin !== lus.arabe;
}

/**
 * Mise en forme lisible d'une plaque normalisée.
 * `123D45` → `123 D 45` · `1234A` → `1234 A` · `3090TT` → `3090 TT`
 */
export function formatDjiboutiPlate(plate: string): string {
  if (PRIVATE_RE.test(plate)) {
    const i = plate.indexOf('D');
    return `${plate.slice(0, i)} D ${plate.slice(i + 1)}`;
  }
  if (TRANSIT_RE.test(plate)) return `${plate.slice(0, -2)} TT`;
  if (OFFICIAL_RE.test(plate)) return `${plate.slice(0, -1)} ${plate.slice(-1)}`;
  return plate;
}
