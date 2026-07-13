// Normalisation et validation de plaques, côté mobile.
//
// Aligné sur le pipeline serveur : le service ML nettoie le texte OCR en
// `[A-Z0-9]` majuscules (cf. plate_detector.py `_clean_plate_text`) et l'API
// normalise en majuscules sans espaces (captures.service.ts). On applique donc
// la même normalisation ici pour que les lectures on-device (option hors-ligne)
// produisent exactement les mêmes clés de plaque que le serveur.

// Formats connus, repris de la configuration ML (plate_detector.py).
const GENERIC_PLATE = /^[A-Z0-9]{4,10}$/;
const FR_PLATE = /^[A-Z]{2}-?\d{3}-?[A-Z]{2}$/;

const KNOWN_PATTERNS = [GENERIC_PLATE, FR_PLATE];

/** Nettoie un texte OCR : majuscules, uniquement des caractères alphanumériques. */
export function normalizePlate(text: string): string {
  return (text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Vrai si la plaque normalisée correspond à au moins un format connu. */
export function isPlausiblePlate(normalized: string): boolean {
  return KNOWN_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Choisit la meilleure ligne de plaque parmi plusieurs candidats OCR (une image
 * peut contenir plusieurs lignes de texte). On privilégie une longueur
 * plausible (4–10) et la correspondance à un format connu.
 */
export function bestPlateCandidate(lines: string[]): string {
  let best = '';
  let bestScore = -1;
  for (const line of lines) {
    const norm = normalizePlate(line);
    if (norm.length < 4 || norm.length > 10) continue;
    let score = norm.length; // à défaut, une ligne plus longue est plus probable
    if (isPlausiblePlate(norm)) score += 100; // bonus fort si le format colle
    if (score > bestScore) {
      best = norm;
      bestScore = score;
    }
  }
  return best;
}
