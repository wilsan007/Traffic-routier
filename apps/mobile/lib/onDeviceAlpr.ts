// Reconnaissance de plaque EMBARQUÉE (on-device), pour le mode hors-ligne.
//
// Objectif : lire une plaque directement sur le téléphone, sans serveur, quand
// la connectivité manque sur le terrain. On s'appuie sur la reconnaissance de
// texte ML Kit de Google (`@react-native-ml-kit/text-recognition`), qui tourne
// entièrement sur l'appareil (modèle embarqué, aucune requête réseau).
//
// Contrainte : ML Kit est un module NATIF. Il n'existe pas dans Expo Go — il
// faut un *development build* (`npx expo run:android` ou un build EAS) avec la
// dépendance installée. On charge donc le module DYNAMIQUEMENT et on expose
// `isOnDeviceAvailable()` : si le module natif est absent, l'app continue de
// fonctionner et retombe sur le pipeline serveur (voir capture.tsx).
//
// ML Kit ne fournit pas de score de confiance numérique fiable par bloc ; on
// dérive une confiance heuristique (présence d'un format de plaque plausible).

import { bestPlateCandidate, isPlausiblePlate, normalizePlate } from './plate';

export interface OnDeviceResult {
  plate: string;
  confidence: number;
  source: 'on-device';
}

// Forme minimale du résultat ML Kit qu'on exploite (évite une dépendance de
// types au module natif, qui peut être absent à la compilation).
interface MlkitLine {
  text: string;
}
interface MlkitBlock {
  text: string;
  lines?: MlkitLine[];
}
interface MlkitResult {
  text: string;
  blocks?: MlkitBlock[];
}
interface MlkitTextRecognition {
  recognize(imageUri: string): Promise<MlkitResult>;
}

let _module: MlkitTextRecognition | null | undefined;

/** Charge (une fois) le module natif ML Kit, ou null s'il est indisponible. */
function loadModule(): MlkitTextRecognition | null {
  if (_module !== undefined) return _module;
  try {
    // Import dynamique : ne casse pas le bundle si la dépendance n'est pas là.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-ml-kit/text-recognition');
    _module = (mod?.default ?? mod) as MlkitTextRecognition;
  } catch {
    _module = null;
  }
  return _module;
}

/** Vrai si l'OCR embarqué est disponible (development build avec ML Kit). */
export function isOnDeviceAvailable(): boolean {
  return loadModule() != null;
}

/** Toutes les lignes de texte détectées, aplaties (blocs → lignes). */
function extractLines(result: MlkitResult): string[] {
  const lines: string[] = [];
  for (const block of result.blocks ?? []) {
    if (block.lines && block.lines.length > 0) {
      for (const line of block.lines) lines.push(line.text);
    } else if (block.text) {
      lines.push(block.text);
    }
  }
  if (lines.length === 0 && result.text) {
    lines.push(...result.text.split('\n'));
  }
  return lines;
}

/**
 * Lit une plaque sur une image locale (URI de photo), entièrement sur
 * l'appareil. Renvoie null si ML Kit est indisponible ou si aucune plaque
 * plausible n'est trouvée.
 */
export async function recognizePlateOnDevice(imageUri: string): Promise<OnDeviceResult | null> {
  const mlkit = loadModule();
  if (mlkit == null) return null;

  const result = await mlkit.recognize(imageUri);
  const plate = bestPlateCandidate(extractLines(result));
  if (!plate) return null;

  // Confiance heuristique : ML Kit ne donne pas de score exploitable, on se
  // base sur la validité du format (comme le bonus de format du pipeline ML).
  const confidence = isPlausiblePlate(plate) ? 0.8 : 0.55;
  return { plate: normalizePlate(plate), confidence, source: 'on-device' };
}
