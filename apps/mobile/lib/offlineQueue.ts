// File d'attente HORS-LIGNE des captures.
//
// En mode embarqué (option on-device), une lecture de plaque faite sans réseau
// doit être conservée puis synchronisée avec le serveur dès que la connectivité
// revient (rapprochement véhicule/hotlist, création d'alerte, audit — tout cela
// reste côté serveur). On stocke donc les captures en attente dans AsyncStorage
// (persistant, survit au redémarrage de l'app) et on les rejoue à la demande.

import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'tg_offline_captures';

export interface QueuedCapture {
  localId: string;
  plate: string;
  confidence: number;
  imageUri: string;
  latitude?: number;
  longitude?: number;
  capturedAt: string; // ISO 8601
  source: 'on-device';
}

async function readQueue(): Promise<QueuedCapture[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedCapture[]) : [];
  } catch {
    // Donnée corrompue : on repart d'une file vide plutôt que de planter.
    return [];
  }
}

async function writeQueue(items: QueuedCapture[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

/** Ajoute une capture à la file hors-ligne. Renvoie la taille résultante. */
export async function enqueueCapture(
  item: Omit<QueuedCapture, 'localId' | 'capturedAt' | 'source'> &
    Partial<Pick<QueuedCapture, 'capturedAt'>>,
): Promise<number> {
  const queue = await readQueue();
  queue.push({
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    plate: item.plate,
    confidence: item.confidence,
    imageUri: item.imageUri,
    latitude: item.latitude,
    longitude: item.longitude,
    capturedAt: item.capturedAt ?? new Date().toISOString(),
    source: 'on-device',
  });
  await writeQueue(queue);
  return queue.length;
}

/** Nombre de captures en attente de synchronisation. */
export async function queueSize(): Promise<number> {
  return (await readQueue()).length;
}

export interface FlushOutcome {
  synced: number;
  remaining: number;
}

/**
 * Rejoue les captures en attente via `upload`. Une capture est retirée de la
 * file dès que son upload réussit ; en cas d'échec (toujours hors-ligne, 5xx),
 * elle est conservée et on s'arrête (on réessaiera plus tard) pour préserver
 * l'ordre chronologique et éviter de marteler un serveur injoignable.
 */
export async function flushQueue(
  upload: (item: QueuedCapture) => Promise<boolean>,
): Promise<FlushOutcome> {
  const queue = await readQueue();
  let index = 0;
  let synced = 0;
  for (; index < queue.length; index++) {
    let ok = false;
    try {
      ok = await upload(queue[index]);
    } catch {
      ok = false;
    }
    if (!ok) break; // on garde celle-ci et les suivantes pour un prochain flush
    synced++;
  }
  const rest = queue.slice(synced);
  await writeQueue(rest);
  return { synced, remaining: rest.length };
}
