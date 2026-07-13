import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { Camera } from 'react-native-vision-camera-text-recognition';
import { api } from '../lib/api';
import {
  PlateStreamVoter,
  extractCandidates,
  DEFAULT_PLATE_VOTE_CONFIG,
} from '../lib/plateStreamVote';

// Le plugin n'exporte pas publiquement son type `Text` ; on modélise le minimum
// consommé (chaque bloc reconnu fournit `resultText`).
type OcrText = { resultText: string };

interface ScanPlateResult {
  plateNumberNormalized: string;
  vehicleMatch: { id: string; plateNumber: string; make?: string; model?: string; stolen: boolean } | null;
  hotlistAlerts: { id: string; hotlistEntry: { reason: string; priority: string } }[];
  persisted: boolean;
}

interface FeedItem {
  plate: string;
  at: number;
  status: 'checking' | 'clear' | 'alert' | 'known';
  detail?: string;
}

export default function StreamScanScreen() {
  const router = useRouter();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  const [active, setActive] = useState(true);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [tracked, setTracked] = useState(0);

  const voterRef = useRef(new PlateStreamVoter());
  const coordsRef = useRef<Location.LocationObjectCoords | null>(null);
  // Évite les vérifications serveur concurrentes pour une même plaque.
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // Position récupérée une fois puis rafraîchie périodiquement (léger).
  useEffect(() => {
    let cancelled = false;
    async function fix() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      const pos = await Location.getCurrentPositionAsync({});
      if (!cancelled) coordsRef.current = pos.coords;
    }
    fix();
    const id = setInterval(fix, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const verifyPlate = useCallback(async (plate: string) => {
    if (inFlightRef.current.has(plate)) return;
    inFlightRef.current.add(plate);
    setConfirmedCount((c) => c + 1);
    const pending: FeedItem = { plate, at: Date.now(), status: 'checking' };
    setFeed((f) => [pending, ...f].slice(0, 30));
    try {
      const res = await api.post<ScanPlateResult>('/captures/scan-plate', {
        plate,
        latitude: coordsRef.current?.latitude,
        longitude: coordsRef.current?.longitude,
      });
      if (res.hotlistAlerts.length > 0) {
        const detail = res.hotlistAlerts.map((a) => a.hotlistEntry.reason).join(', ');
        const priority = res.hotlistAlerts[0]?.hotlistEntry.priority ?? '';
        setFeed((f) => f.map((it): FeedItem => (it.plate === plate && it.status === 'checking' ? { ...it, status: 'alert', detail } : it)));
        Notifications.scheduleNotificationAsync({
          content: {
            title: `🚨 ${plate} — Liste de surveillance ${priority}`,
            body: detail,
            sound: 'default',
          },
          trigger: null,
        });
      } else if (res.vehicleMatch) {
        const v = res.vehicleMatch;
        const detail = `${v.make ?? ''} ${v.model ?? ''}`.trim() + (v.stolen ? ' — ⚠️ VOLÉ' : '');
        setFeed((f) => f.map((it): FeedItem => (it.plate === plate && it.status === 'checking' ? { ...it, status: v.stolen ? 'alert' : 'known', detail } : it)));
      } else {
        setFeed((f) => f.map((it): FeedItem => (it.plate === plate && it.status === 'checking' ? { ...it, status: 'clear' } : it)));
      }
    } catch {
      setFeed((f) => f.map((it): FeedItem => (it.plate === plate && it.status === 'checking' ? { ...it, status: 'clear', detail: 'hors ligne' } : it)));
    } finally {
      // Laisse le cooldown du voteur gérer la re-vérification.
      setTimeout(() => inFlightRef.current.delete(plate), DEFAULT_PLATE_VOTE_CONFIG.cooldownMs);
    }
  }, []);

  // Callback OCR du plugin : appelé à chaque frame analysée.
  const onOcr = useCallback(
    (data: string | OcrText[]) => {
      if (!active || typeof data === 'string') return;
      const lines = data.map((t) => t.resultText).filter(Boolean);
      const candidates = extractCandidates(lines);
      const now = Date.now();
      const confirmed = voterRef.current.ingest(candidates, now);
      setTracked(voterRef.current.tracked);
      for (const c of confirmed) verifyPlate(c.plate);
    },
    [active, verifyPlate],
  );

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Autorisation caméra requise pour le flux continu.</Text>
        <TouchableOpacity style={styles.actionButton} onPress={requestPermission}>
          <Text style={styles.actionText}>Autoriser la caméra</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={() => router.back()}>
          <Text style={styles.linkText}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#2f5fdb" />
        <Text style={styles.permissionText}>Initialisation de la caméra…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={active}
        mode="recognize"
        options={{ language: 'latin' }}
        callback={onOcr}
      />

      {/* En-tête */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backChip}>
          <Text style={styles.backText}>‹ Retour</Text>
        </TouchableOpacity>
        <View style={styles.statusChip}>
          <Text style={styles.statusText}>
            {active ? '🔍 Flux continu on-device' : '⏸ En pause'}
          </Text>
        </View>
      </View>

      {/* Cadre de visée */}
      <View style={styles.reticle} pointerEvents="none">
        <Text style={styles.reticleHint}>Pointez vers la circulation</Text>
      </View>

      {/* Métriques */}
      <View style={styles.metrics}>
        <Text style={styles.metricText}>{confirmedCount} confirmée(s)</Text>
        <Text style={styles.metricDot}>·</Text>
        <Text style={styles.metricText}>{tracked} en cours</Text>
        <Text style={styles.metricDot}>·</Text>
        <Text style={styles.metricText}>OCR embarqué</Text>
      </View>

      {/* Journal des plaques */}
      <View style={styles.feed}>
        <ScrollView>
          {feed.length === 0 && (
            <Text style={styles.feedEmpty}>Aucune plaque confirmée pour l'instant…</Text>
          )}
          {feed.map((it) => (
            <View key={`${it.plate}-${it.at}`} style={[styles.feedItem, statusStyle(it.status)]}>
              <Text style={styles.feedPlate}>{it.plate}</Text>
              <Text style={styles.feedStatus}>
                {it.status === 'checking' && '… vérification'}
                {it.status === 'clear' && (it.detail ? `✓ ${it.detail}` : '✓ RAS')}
                {it.status === 'known' && `🚗 ${it.detail}`}
                {it.status === 'alert' && `🚨 ${it.detail}`}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Pause / reprise */}
      <TouchableOpacity
        style={[styles.pauseButton, !active && styles.pauseButtonActive]}
        onPress={() => setActive((a) => !a)}
      >
        <Text style={styles.pauseText}>{active ? 'Pause' : 'Reprendre'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function statusStyle(status: FeedItem['status']) {
  switch (status) {
    case 'alert':
      return { borderLeftColor: '#dc2626' };
    case 'known':
      return { borderLeftColor: '#2f5fdb' };
    case 'clear':
      return { borderLeftColor: '#16a34a' };
    default:
      return { borderLeftColor: '#94a3b8' };
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0f172a' },
  permissionText: { textAlign: 'center', marginVertical: 16, color: '#e2e8f0' },
  actionButton: { backgroundColor: '#2f5fdb', borderRadius: 12, padding: 16, alignItems: 'center', alignSelf: 'stretch' },
  actionText: { color: 'white', fontWeight: '600', fontSize: 16 },
  linkButton: { padding: 12, marginTop: 8 },
  linkText: { color: '#94a3b8' },
  header: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backChip: { backgroundColor: 'rgba(15,23,42,0.7)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  backText: { color: 'white', fontWeight: '600' },
  statusChip: { backgroundColor: 'rgba(47,95,219,0.85)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  statusText: { color: 'white', fontWeight: '600', fontSize: 12 },
  reticle: {
    position: 'absolute',
    top: '30%',
    left: '10%',
    right: '10%',
    height: 120,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
  },
  reticleHint: { color: 'rgba(255,255,255,0.7)', fontSize: 11 },
  metrics: {
    position: 'absolute',
    top: 100,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  metricText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  metricDot: { color: '#64748b' },
  feed: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    maxHeight: 220,
    backgroundColor: 'rgba(15,23,42,0.82)',
    borderRadius: 12,
    padding: 10,
  },
  feedEmpty: { color: '#94a3b8', textAlign: 'center', paddingVertical: 12, fontSize: 13 },
  feedItem: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderLeftWidth: 4,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
  },
  feedPlate: { color: 'white', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  feedStatus: { color: '#cbd5e1', fontSize: 12, marginTop: 2 },
  pauseButton: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    backgroundColor: 'white',
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  pauseButtonActive: { backgroundColor: '#16a34a' },
  pauseText: { color: '#0f1f4a', fontWeight: '700', fontSize: 15 },
});
