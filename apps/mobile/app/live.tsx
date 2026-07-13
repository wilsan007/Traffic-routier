// Écran « Diffusion en direct » (option streaming téléphone → serveur).
//
// Le téléphone publie sa caméra en WebRTC/WHIP vers MediaMTX ; le serveur
// applique le pipeline ML complet (suivi ByteTrack + vote temporel) sur le flux
// continu. Nécessite un development build (react-native-webrtc) — sinon l'écran
// affiche un message et l'utilisateur reste sur le scan photo classique.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { api, ApiError } from '../lib/api';
import { isLiveStreamAvailable, startPublishing, type LiveSession } from '../lib/liveStream';

interface CameraDiag {
  id: string;
  name: string;
  type: string;
  region: { name: string };
}

export default function LiveScreen() {
  const router = useRouter();
  const available = isLiveStreamAvailable();
  const [cameras, setCameras] = useState<CameraDiag[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<LiveSession | null>(null);
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<CameraDiag[]>('/cameras/diagnostics');
      // On propose en priorité les caméras mobiles (terrain).
      setCameras(data.filter((c) => c.type === 'MOBILE').concat(data.filter((c) => c.type !== 'MOBILE')));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les caméras');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startLive = useCallback(async (cameraId: string) => {
    setBusy(true);
    setError(null);
    try {
      // 1. Le serveur prépare l'ingestion et démarre le worker ML, renvoie l'URL WHIP.
      const { whipUrl } = await api.post<{ whipUrl: string; streamId: string | null }>(
        `/cameras/${cameraId}/live/start`,
      );
      // 2. Le téléphone publie sa caméra sur cette URL.
      const live = await startPublishing(whipUrl, { facingMode: 'environment' });
      setSession(live);
      setActiveCameraId(cameraId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du démarrage de la diffusion');
    } finally {
      setBusy(false);
    }
  }, []);

  const stopLive = useCallback(async () => {
    setBusy(true);
    try {
      await session?.stop();
      if (activeCameraId) await api.post(`/cameras/${activeCameraId}/live/stop`).catch(() => undefined);
    } finally {
      setSession(null);
      setActiveCameraId(null);
      setBusy(false);
    }
  }, [session, activeCameraId]);

  // Coupe proprement la diffusion si l'écran est quitté.
  useEffect(() => {
    return () => {
      session?.stop().catch(() => undefined);
    };
  }, [session]);

  if (!available) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Diffusion en direct indisponible</Text>
        <Text style={styles.note}>
          Cette fonction nécessite un <Text style={styles.bold}>development build</Text> avec
          react-native-webrtc (voir docs mobile). En attendant, utilisez le scan photo.
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#2f5fdb" /></View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.title}>Diffusion en direct</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      {session ? (
        <View style={styles.liveBox}>
          <Text style={styles.liveDot}>🔴 EN DIRECT</Text>
          <Text style={styles.note}>
            Votre caméra est diffusée vers le serveur, qui analyse le flux en continu
            (suivi + lecture de plaques).
          </Text>
          <TouchableOpacity style={[styles.button, styles.stop]} onPress={stopLive} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? '…' : 'Arrêter la diffusion'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.note}>Choisissez la caméra terrain à diffuser :</Text>
          {cameras.map((camera) => (
            <TouchableOpacity
              key={camera.id}
              style={styles.cameraRow}
              onPress={() => startLive(camera.id)}
              disabled={busy}
            >
              <Text style={styles.cameraName}>{camera.name}</Text>
              <Text style={styles.cameraMeta}>
                {camera.type === 'MOBILE' ? 'Mobile' : 'Fixe'} · {camera.region.name}
              </Text>
            </TouchableOpacity>
          ))}
          {cameras.length === 0 && <Text style={styles.note}>Aucune caméra disponible.</Text>}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1220' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0f1220' },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 12 },
  note: { color: '#aab', fontSize: 14, marginBottom: 16, lineHeight: 20 },
  bold: { fontWeight: '700', color: '#fff' },
  error: { color: '#ff6b6b', marginBottom: 12 },
  button: { backgroundColor: '#2f5fdb', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  stop: { backgroundColor: '#c0392b' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  liveBox: { backgroundColor: '#1a1f36', borderRadius: 12, padding: 20 },
  liveDot: { color: '#ff6b6b', fontWeight: '700', fontSize: 18, marginBottom: 10 },
  cameraRow: { backgroundColor: '#1a1f36', borderRadius: 10, padding: 16, marginBottom: 10 },
  cameraName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cameraMeta: { color: '#889', fontSize: 13, marginTop: 4 },
});
