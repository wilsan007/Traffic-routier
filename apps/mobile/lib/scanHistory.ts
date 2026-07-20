/**
 * Journal persistant des plaques confirmées par le flux continu.
 *
 * Le fil de `stream-scan` est volontairement éphémère (30 entrées en mémoire) :
 * c'est un affichage temps réel, pas un registre. Or l'agent sur le terrain a
 * besoin de REVOIR ce qui a été lu — y compris après avoir fermé l'app, et y
 * compris ce qui a été scanné hors réseau. Ce module est ce registre.
 *
 * Local d'abord : chaque confirmation est écrite ici AVANT toute vérification
 * serveur, puis son statut est mis à jour quand la réponse arrive. Sans réseau,
 * l'entrée reste en `offline` et pourra être re-vérifiée depuis l'onglet
 * Historique — rien n'est perdu, ce qui est la condition de l'usage autonome.
 *
 * AsyncStorage suffit ici : quelques centaines d'entrées de moins de 200 octets,
 * lues d'un bloc par l'onglet. Une base SQLite serait de la sur-ingénierie.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'scan-history-v1';

/** Plafond d'entrées conservées — les plus anciennes sont éliminées. */
const MAX_ENTRIES = 1000;

export type ScanStatus =
  | 'clear' // vérifiée serveur : rien à signaler
  | 'known' // véhicule connu en base
  | 'alert' // hotlist ou véhicule volé
  | 'offline'; // confirmée localement, vérification serveur impossible

export interface ScanEntry {
  /** Identifiant stable : plaque + horodatage de confirmation. */
  id: string;
  plate: string;
  at: number;
  status: ScanStatus;
  detail?: string;
  latitude?: number;
  longitude?: number;
}

async function readAll(): Promise<ScanEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScanEntry[]) : [];
  } catch {
    // Un stockage corrompu ne doit pas faire tomber le scan : on repart vide.
    return [];
  }
}

async function writeAll(entries: ScanEntry[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
}

/** Ajoute une confirmation (en tête — les plus récentes d'abord). */
export async function addScan(
  entry: Omit<ScanEntry, 'id'>,
): Promise<ScanEntry> {
  const full: ScanEntry = { ...entry, id: `${entry.plate}-${entry.at}` };
  const all = await readAll();
  await writeAll([full, ...all]);
  return full;
}

/** Met à jour le statut d'une entrée après la réponse serveur. */
export async function updateScan(
  id: string,
  patch: Partial<Pick<ScanEntry, 'status' | 'detail'>>,
): Promise<void> {
  const all = await readAll();
  const idx = all.findIndex((e) => e.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch };
  await writeAll(all);
}

/** Toutes les entrées, plus récentes d'abord. */
export function listScans(): Promise<ScanEntry[]> {
  return readAll();
}

/** Les entrées jamais vérifiées côté serveur (scannées hors réseau). */
export async function listOffline(): Promise<ScanEntry[]> {
  return (await readAll()).filter((e) => e.status === 'offline');
}

export async function clearScans(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
