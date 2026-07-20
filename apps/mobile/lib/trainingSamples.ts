/**
 * File des échantillons d'entraînement certifiés par l'agent.
 *
 * C'est la moitié « terrain » de la boucle d'amélioration (data engine) :
 * l'app propose une lecture, l'agent — qui est DEVANT le véhicule — confirme
 * ou corrige, et l'échantillon (recadrages + lectures brutes + verdict) part
 * vers la base centrale où il est contrôlé (vérification croisée, corpus)
 * avant tout réentraînement. L'entraînement lui-même ne se fait JAMAIS ici :
 * un modèle qui apprendrait localement divergerait par appareil et
 * échapperait à tout contrôle qualité.
 *
 * Même contrat hors-ligne que le journal des scans : tout est écrit
 * localement d'abord, l'envoi se tente quand le réseau le permet, et rien ne
 * se perd entre-temps. Les recadrages (JPEG 192×48, ~7 Ko pièce) tiennent
 * dans AsyncStorage — une clé par échantillon pour ne jamais buter sur la
 * taille d'une entrée unique.
 *
 * Priorité aux échecs : une correction ou un rejet vaut bien plus qu'une
 * confirmation (l'app n'apprend rien de ce qu'elle sait déjà lire). Le champ
 * `verdict` permet au serveur de trier — et si un tri s'impose côté
 * téléphone, les confirmations sont éliminées les premières.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

const INDEX_KEY = 'training-samples-index-v1';
const SAMPLE_PREFIX = 'training-sample-v1:';
const MAX_SAMPLES = 200;

export type VerdictAgent = 'confirmee' | 'corrigee';

export interface TrainingSample {
  id: string;
  at: number;
  /** Plaque proposée par la lecture embarquée — null si l'app avait rejeté. */
  lectureApp: string | null;
  /** Lectures brutes du CRNN, une par zone recadrée. */
  brutes: string[];
  /** Recadrages JPEG en base64 (192×48), alignés sur `brutes`. */
  crops: string[];
  verdict: VerdictAgent;
  /** Le numéro certifié par l'agent, seule vérité terrain. */
  plaqueCertifiee: string;
  envoye: boolean;
}

async function lireIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function addSample(
  sample: Omit<TrainingSample, 'id' | 'envoye'>,
): Promise<void> {
  const id = `${sample.plaqueCertifiee}-${sample.at}`;
  const index = await lireIndex();
  if (index.includes(id)) return;

  // Plafond : on élimine d'abord les échantillons déjà envoyés, puis les plus
  // anciennes CONFIRMATIONS — jamais une correction non envoyée, ce sont les
  // données les plus précieuses.
  let nouvelIndex = [id, ...index];
  if (nouvelIndex.length > MAX_SAMPLES) {
    const tous = await Promise.all(nouvelIndex.map(chargerUn));
    const garder = tous
      .filter((s): s is TrainingSample => s !== null)
      .sort((a, b) => {
        const poids = (s: TrainingSample) =>
          (s.envoye ? 0 : 2) + (s.verdict === 'corrigee' ? 1 : 0);
        return poids(b) - poids(a) || b.at - a.at;
      })
      .slice(0, MAX_SAMPLES);
    const garderIds = new Set(garder.map((s) => s.id));
    for (const vieux of nouvelIndex) {
      if (!garderIds.has(vieux) && vieux !== id) {
        await AsyncStorage.removeItem(SAMPLE_PREFIX + vieux);
      }
    }
    nouvelIndex = nouvelIndex.filter((i) => garderIds.has(i) || i === id);
  }

  await AsyncStorage.setItem(
    SAMPLE_PREFIX + id,
    JSON.stringify({ ...sample, id, envoye: false } satisfies TrainingSample),
  );
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(nouvelIndex));
}

async function chargerUn(id: string): Promise<TrainingSample | null> {
  try {
    const raw = await AsyncStorage.getItem(SAMPLE_PREFIX + id);
    return raw ? (JSON.parse(raw) as TrainingSample) : null;
  } catch {
    return null;
  }
}

/** Nombre d'échantillons en attente d'envoi. */
export async function countPending(): Promise<number> {
  const index = await lireIndex();
  const tous = await Promise.all(index.map(chargerUn));
  return tous.filter((s) => s && !s.envoye).length;
}

/**
 * Tente d'envoyer les échantillons en attente — corrections d'abord.
 * S'arrête au premier échec réseau : le reste attendra la prochaine fois.
 */
export async function syncSamples(): Promise<{ envoyes: number; restants: number }> {
  const index = await lireIndex();
  const tous = (await Promise.all(index.map(chargerUn))).filter(
    (s): s is TrainingSample => s !== null && !s.envoye,
  );
  tous.sort((a, b) => (b.verdict === 'corrigee' ? 1 : 0) - (a.verdict === 'corrigee' ? 1 : 0));

  let envoyes = 0;
  for (const s of tous) {
    try {
      await api.post('/captures/training-sample', {
        at: s.at,
        lectureApp: s.lectureApp,
        brutes: s.brutes,
        cropsBase64: s.crops,
        verdict: s.verdict,
        plaqueCertifiee: s.plaqueCertifiee,
      });
      await AsyncStorage.setItem(
        SAMPLE_PREFIX + s.id,
        // Le recadrage est déjà au serveur : on libère la place locale.
        JSON.stringify({ ...s, crops: [], envoye: true }),
      );
      envoyes += 1;
    } catch {
      break;
    }
  }
  return { envoyes, restants: tous.length - envoyes };
}
