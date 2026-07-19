// Écran « Flux continu » (reconnaissance ON-DEVICE en temps réel).
//
// Contrairement au scan photo-par-photo, la caméra est traitée IMAGE PAR IMAGE
// sur l'appareil : VisionCamera + un frame processor ML Kit lisent le texte de
// chaque frame, on ne retient que ce qui a la forme d'une plaque, et une plaque
// n'est « confirmée » que lorsqu'elle apparaît sur plusieurs frames (un vrai
// véhicule qui passe) — voir lib/plateStreamVote.ts. Aucune requête réseau
// n'est nécessaire : ça marche hors-ligne. Les plaques confirmées sont mises en
// file (lib/offlineQueue) et synchronisées avec le serveur quand possible.
//
// Native : VisionCamera + react-native-vision-camera-text-recognition →
// development build requis. Les modules sont chargés dynamiquement ; si absents,
// l'écran l'indique et l'app reste utilisable (scan serveur / photo).
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { bestPlateCandidate } from '../lib/plate';
import { StreamPlateAggregator } from '../lib/plateStreamVote';
import { enqueueCapture, queueSize } from '../lib/offlineQueue';

// Chargement dynamique des modules natifs (absents d'Expo Go).
let VisionCamera: any = null;
let TextRecognitionCamera: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  VisionCamera = require('react-native-vision-camera');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  TextRecognitionCamera = require('react-native-vision-camera-text-recognition').Camera;
} catch {
  VisionCamera = null;
}

const nativeAvailable = () => VisionCamera != null && TextRecognitionCamera != null;

// Bloc de texte reconnu renvoyé par le plugin (on n'exploite que resultText).
interface RecognizedBlock {
  resultText: string;
}

export default function StreamScanScreen() {
  const router = useRouter();
  const available = nativeAvailable();

  const aggregatorRef = useRef(new StreamPlateAggregator());
  const lastProcessRef = useRef(0);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [pending, setPending] = useState(0);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const device = available ? VisionCamera.useCameraDevice('back') : null;

  // Demande la permission caméra (API VisionCamera).
  useEffect(() => {
    if (!available) return;
    (async () => {
      const status = await VisionCamera.Camera.requestCameraPermission();
      setPermissionGranted(status === 'granted');
    })();
  }, [available]);

  useEffect(() => {
    queueSize().then(setPending);
    const id = setInterval(() => aggregatorRef.current.prune(), 5000);
    return () => clearInterval(id);
  }, []);

  // Callback appelé par le plugin à chaque frame analysée. On throttle le
  // traitement JS (~150 ms) pour ne pas saturer le thread, et le consensus
  // temporel fait le reste.
  const onText = useCallback((data: string | RecognizedBlock[]) => {
    const now = Date.now();
    if (now - lastProcessRef.current < 150) return;
    lastProcessRef.current = now;

    const blocks = Array.isArray(data) ? data : [];
    const lines = blocks
      .map((b) => b?.resultText ?? '')
      .flatMap((t) => t.split('\n'));
    const candidate = bestPlateCandidate(lines);
    if (!candidate) return;

    const plate = aggregatorRef.current.observe([candidate], now);
    if (plate) {
      setConfirmed((prev) => (prev.includes(plate) ? prev : [plate, ...prev].slice(0, 20)));
      // File hors-ligne : synchronisée plus tard vers le serveur.
      enqueueCapture({ plate, confidence: 0.8, imageUri: '' }).then(setPending);
    }
  }, []);

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

  const Cam = TextRecognitionCamera;
  return (
    <View style={styles.container}>
      <Cam
        style={styles.camera}
        device={device}
        isActive={true}
        mode="recognize"
        options={{ language: 'latin' }}
        callback={onText}
      />
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
