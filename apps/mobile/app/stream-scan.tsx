// Écran « Flux continu » (reconnaissance ON-DEVICE en temps réel).
//
// La caméra reste ouverte en continu (VisionCamera) et on capture des
// instantanés rapides du flux (takeSnapshot = capture GPU de l'aperçu, bien
// plus rapide qu'une vraie photo, sans obturateur) plusieurs fois par seconde.
// Chaque instantané passe par l'OCR embarqué ML Kit (aucun réseau), on ne
// retient que ce qui a la forme d'une plaque, et une plaque n'est « confirmée »
// que lorsqu'elle apparaît sur plusieurs captures successives (un vrai véhicule
// qui passe) — voir lib/plateStreamVote.ts. Marche hors-ligne ; les plaques
// confirmées sont mises en file (offlineQueue) et synchronisées ensuite.
//
// Choix technique : on n'utilise pas de frame processor natif (fragile selon
// les versions) — juste VisionCamera pour le flux + captures, et le module OCR
// ML Kit image (@react-native-ml-kit/text-recognition). Les deux modules sont
// chargés dynamiquement ; absents (Expo Go), l'écran l'indique et l'app reste
// utilisable.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { bestPlateCandidate } from '../lib/plate';
import { StreamPlateAggregator } from '../lib/plateStreamVote';
import { enqueueCapture, queueSize } from '../lib/offlineQueue';

// Chargement dynamique des modules natifs (absents d'Expo Go).
let VisionCamera: any = null;
let TextRecognition: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  VisionCamera = require('react-native-vision-camera');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mlkit = require('@react-native-ml-kit/text-recognition');
  TextRecognition = mlkit?.default ?? mlkit;
} catch {
  VisionCamera = null;
}

const nativeAvailable = () => VisionCamera != null && TextRecognition != null;

// Cadence des captures (ms). ~2.5 captures/seconde : compromis fluidité / charge.
const SNAPSHOT_INTERVAL_MS = 400;

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

export default function StreamScanScreen() {
  const router = useRouter();
  const available = nativeAvailable();

  const cameraRef = useRef<any>(null);
  const aggregatorRef = useRef(new StreamPlateAggregator());
  const scanningRef = useRef(false);
  const activeRef = useRef(true);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [pending, setPending] = useState(0);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const device = available ? VisionCamera.useCameraDevice('back') : null;

  useEffect(() => {
    if (!available) return;
    (async () => {
      const status = await VisionCamera.Camera.requestCameraPermission();
      setPermissionGranted(status === 'granted');
    })();
  }, [available]);

  useEffect(() => {
    queueSize().then(setPending);
  }, []);

  // Analyse un instantané : OCR ML Kit -> candidats plaque -> consensus.
  const analyzeSnapshot = useCallback(async () => {
    if (scanningRef.current || !cameraRef.current) return;
    scanningRef.current = true;
    try {
      const snapshot = await cameraRef.current.takeSnapshot({ quality: 85 });
      const uri = snapshot?.path ? `file://${snapshot.path}` : null;
      if (!uri) return;

      const result: MlkitResult = await TextRecognition.recognize(uri);
      const lines = (result.blocks ?? [])
        .flatMap((b) => (b.lines?.length ? b.lines.map((l) => l.text) : [b.text]))
        .concat((result.text ?? '').split('\n'));

      const candidate = bestPlateCandidate(lines);
      if (!candidate) return;

      const plate = aggregatorRef.current.observe([candidate]);
      if (plate) {
        setConfirmed((prev) => (prev.includes(plate) ? prev : [plate, ...prev].slice(0, 20)));
        enqueueCapture({ plate, confidence: 0.8, imageUri: uri }).then(setPending);
      }
    } catch {
      // capture/OCR ratée sur cette frame : on ignore, la suivante réessaiera
    } finally {
      scanningRef.current = false;
    }
  }, []);

  // Boucle de capture tant que l'écran est actif et la caméra prête.
  useEffect(() => {
    if (!available || !permissionGranted || !device) return;
    activeRef.current = true;
    const id = setInterval(() => {
      if (activeRef.current) analyzeSnapshot();
      aggregatorRef.current.prune();
    }, SNAPSHOT_INTERVAL_MS);
    return () => {
      activeRef.current = false;
      clearInterval(id);
    };
  }, [available, permissionGranted, device, analyzeSnapshot]);

  if (!available) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Flux continu indisponible</Text>
        <Text style={styles.note}>
          La reconnaissance temps réel embarquée nécessite un development build
          (VisionCamera + ML Kit). Utilisez le scan serveur en attendant.
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!permissionGranted || !device) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2f5fdb" />
        <Text style={styles.note}>Initialisation de la caméra…</Text>
      </View>
    );
  }

  const Cam = VisionCamera.Camera;
  return (
    <View style={styles.container}>
      <Cam ref={cameraRef} style={styles.camera} device={device} isActive={true} photo={true} />
      <View style={styles.hud}>
        <Text style={styles.hudTitle}>🎥 Flux continu · {pending} en attente de sync</Text>
      </View>
      <ScrollView style={styles.list} contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.listTitle}>Plaques confirmées</Text>
        {confirmed.length === 0 && <Text style={styles.note}>Pointez la caméra vers la circulation…</Text>}
        {confirmed.map((p, i) => (
          <Text key={`${p}-${i}`} style={styles.plate}>{p}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1220' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0f1220' },
  camera: { flex: 2 },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 12 },
  note: { color: '#aab', fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  button: { backgroundColor: '#2f5fdb', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hud: { position: 'absolute', top: 50, left: 16, right: 16, backgroundColor: 'rgba(15,18,32,0.72)', borderRadius: 10, padding: 10 },
  hudTitle: { color: '#fff', fontWeight: '600', fontSize: 13 },
  list: { flex: 1, backgroundColor: '#0f1220' },
  listTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  plate: { color: '#6fd08a', fontSize: 20, fontWeight: '700', marginBottom: 6 },
});
