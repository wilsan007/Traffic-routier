import Constants from 'expo-constants';

// Clé API Plate Recognizer — configurable via app.json extra ou env var.
// Obtenez une clé gratuite sur https://platerecognizer.com (1000 req/mois).
// Mettez-la dans app.json → extra → plateRecognizerKey, ou dans .env → EXPO_PUBLIC_PLATE_RECOGNIZER_KEY
const PLATE_RECOGNIZER_KEY =
  process.env.EXPO_PUBLIC_PLATE_RECOGNIZER_KEY ??
  (Constants.expoConfig?.extra?.plateRecognizerKey as string) ??
  '';

const PLATE_RECOGNIZER_URL = 'https://api.platerecognizer.com/v1/plate-reader/';

export interface DemoPlateResult {
  plate: string;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  vehicle?: { make?: string; model?: string; color?: string };
}

export function hasDemoApiKey(): boolean {
  return PLATE_RECOGNIZER_KEY.length > 0;
}

export async function detectPlateDemo(imageUri: string): Promise<DemoPlateResult | null> {
  if (!PLATE_RECOGNIZER_KEY) {
    throw new Error('Clé API Plate Recognizer manquante. Ajoutez EXPO_PUBLIC_PLATE_RECOGNIZER_KEY dans votre environnement.');
  }

  const form = new FormData();
  form.append('upload', { uri: imageUri, name: 'capture.jpg', type: 'image/jpeg' } as any);

  const res = await fetch(PLATE_RECOGNIZER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Token ${PLATE_RECOGNIZER_KEY}`,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Plate Recognizer error: ${res.status} ${text}`);
  }

  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    return null;
  }

  const best = data.results[0];
  return {
    plate: (best.plate as string).toUpperCase().replace(/\s+/g, ''),
    confidence: best.score ?? 0,
    boundingBox: best.box
      ? {
          x: best.box.xmin,
          y: best.box.ymin,
          width: best.box.xmax - best.box.xmin,
          height: best.box.ymax - best.box.ymin,
        }
      : undefined,
    vehicle: best.vehicle
      ? {
          make: best.vehicle.make,
          model: best.vehicle.model,
          color: best.vehicle.color,
        }
      : undefined,
  };
}
