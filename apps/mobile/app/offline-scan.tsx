// Écran « Scan hors-ligne » (option inférence embarquée / on-device).
//
// Lit la plaque directement sur le téléphone (ML Kit, aucun réseau), met la
// capture en file locale, puis la synchronise avec le serveur quand la
// connectivité revient. Nécessite un development build (ML Kit natif) — sinon
// l'écran l'indique et l'utilisateur reste sur le scan serveur classique.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { API_URL, getToken } from '../lib/api';
import { isOnDeviceAvailable, recognizePlateOnDevice } from '../lib/onDeviceAlpr';
import { enqueueCapture, flushQueue, queueSize, type QueuedCapture } from '../lib/offlineQueue';

export default function OfflineScanScreen() {
  const router = useRouter();
  const available = isOnDeviceAvailable();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [lastPlate, setLastPlate] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const refreshPending = useCallback(async () => {
    setPending(await queueSize());
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  // Envoie une capture en file vers le serveur (endpoint scan existant).
  const upload = useCallback(async (item: QueuedCapture): Promise<boolean> => {
    const token = await getToken();
    const form = new FormData();
    form.append('image', { uri: item.imageUri, name: 'capture.jpg', type: 'image/jpeg' } as never);
    form.append('plateText', item.plate);
    form.append('confidence', String(item.confidence));
    if (item.latitude != null) form.append('latitude', String(item.latitude));
    if (item.longitude != null) form.append('longitude', String(item.longitude));
    try {
      const res = await fetch(`${API_URL}/captures/scan`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      return res.ok;
    } catch {
      return false; // hors-ligne : on garde la capture pour plus tard
    }
  }, []);

  const capture = useCallback(async () => {
    if (!cameraRef.current) return;
    setBusy(true);
    setMessage(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      if (!photo) return;
      const result = await recognizePlateOnDevice(photo.uri);
      if (!result) {
        setMessage('Aucune plaque détectée.');
        return;
      }
      let coords: { latitude?: number; longitude?: number } = {};
      try {
        const loc = await Location.getCurrentPositionAsync({});
        coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      } catch {
        // localisation indisponible : on enregistre sans coordonnées
      }
      await enqueueCapture({ plate: result.plate, confidence: result.confidence, imageUri: photo.uri, ...coords });
      setLastPlate(result.plate);
      await refreshPending();
    } finally {
      setBusy(false);
    }
  }, [refreshPending]);

  const sync = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { synced, remaining } = await flushQueue(upload);
      setMessage(
        synced > 0
          ? `${synced} capture(s) synchronisée(s).${remaining ? ` ${remaining} en attente.` : ''}`
          : 'Aucune capture synchronisée (hors-ligne ?).',
      );
      await refreshPending();
    } finally {
      setBusy(false);
    }
  }, [upload, refreshPending]);

  if (!available) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Scan hors-ligne indisponible</Text>
        <Text style={styles.note}>
          La reconnaissance embarquée nécessite un development build avec ML Kit
          (voir docs mobile). Utilisez le scan serveur en attendant.
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.note}>Autorisez la caméra pour scanner hors-ligne.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Autoriser la caméra</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <View style={styles.panel}>
        <Text style={styles.status}>
          En attente de synchronisation : <Text style={styles.bold}>{pending}</Text>
        </Text>
        {lastPlate && <Text style={styles.plate}>Dernière plaque : {lastPlate}</Text>}
        {message && <Text style={styles.note}>{message}</Text>}
        <View style={styles.row}>
          <TouchableOpacity style={[styles.button, styles.flex]} onPress={capture} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? '…' : '📸 Scanner'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.sync, styles.flex]} onPress={sync} disabled={busy || pending === 0}>
            <Text style={styles.buttonText}>Synchroniser</Text>
          </TouchableOpacity>
        </View>
      </View>
      {busy && <ActivityIndicator style={styles.spinner} size="large" color="#2f5fdb" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1220' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0f1220' },
  camera: { flex: 1 },
  panel: { padding: 20, backgroundColor: '#0f1220' },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 12 },
  status: { color: '#fff', fontSize: 15, marginBottom: 6 },
  plate: { color: '#6fd08a', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  note: { color: '#aab', fontSize: 14, marginBottom: 12, lineHeight: 20 },
  bold: { fontWeight: '700', color: '#fff' },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  button: { backgroundColor: '#2f5fdb', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  sync: { backgroundColor: '#1f8a54' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  spinner: { position: 'absolute', top: '45%', alignSelf: 'center' },
});
