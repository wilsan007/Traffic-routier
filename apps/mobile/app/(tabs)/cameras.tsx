import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import Constants from 'expo-constants';
import { api, ApiError } from '../../lib/api';

const HLS_BASE =
  process.env.EXPO_PUBLIC_HLS_URL ?? (Constants.expoConfig?.extra?.hlsUrl as string) ?? 'http://localhost:8888';

interface CameraDiag {
  id: string;
  name: string;
  type: string;
  region: { name: string };
  stream: { configured: boolean; ready?: boolean; readers?: number };
  online: boolean;
}

export default function CamerasScreen() {
  const [cameras, setCameras] = useState<CameraDiag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CameraDiag | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<CameraDiag[]>('/cameras/diagnostics');
      setCameras(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les caméras');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 20_000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#2f5fdb" /></View>;
  }

  if (selected) {
    const hlsUrl = `${HLS_BASE}/${selected.id}/index.m3u8`;
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
        <TouchableOpacity style={styles.backButton} onPress={() => setSelected(null)}>
          <Text style={styles.backText}>← Retour à la liste</Text>
        </TouchableOpacity>
        <Text style={styles.cameraName}>{selected.name}</Text>
        <Text style={styles.cameraMeta}>
          {selected.type === 'FIXED' ? 'Fixe' : 'Mobile'} · {selected.region.name}
          {' · '}
          {selected.online ? '🟢 En ligne' : '⚫ Hors ligne'}
        </Text>

        <View style={styles.streamBox}>
          <Text style={styles.streamTitle}>Flux HLS en direct</Text>
          <Text style={styles.streamUrl}>{hlsUrl}</Text>
          <Text style={styles.streamHint}>
            Le flux vidéo est accessible depuis le centre de commandement web.
            Sur mobile, utilisez l'application avec un lecteur vidéo compatible HLS.
          </Text>
          <TouchableOpacity
            style={styles.openButton}
            onPress={() => {
              // Ouvre le flux dans le navigateur du device (lecteur natif)
              import('expo-linking').then(({ default: Linking }) => Linking.openURL(hlsUrl));
            }}
          >
            <Text style={styles.openText}>Ouvrir le flux</Text>
          </TouchableOpacity>
        </View>

        {selected.stream.readers != null && (
          <Text style={styles.readers}>
            👥 {selected.stream.readers} spectateur(s) connecté(s)
          </Text>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Caméras</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={cameras}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 20 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.online && styles.cardOffline]}
            onPress={() => setSelected(item)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardName}>{item.name}</Text>
              <View style={[styles.statusDot, item.online ? styles.dotOnline : styles.dotOffline]} />
            </View>
            <Text style={styles.cardMeta}>
              {item.type === 'FIXED' ? 'Fixe' : 'Mobile'} · {item.region.name}
            </Text>
            <View style={styles.badges}>
              <Text style={[styles.badge, item.online ? styles.badgeOnline : styles.badgeOffline]}>
                {item.online ? 'En ligne' : 'Hors ligne'}
              </Text>
              {item.stream.configured && (
                <Text style={[styles.badge, item.stream.ready ? styles.badgeReady : styles.badgePending]}>
                  Flux {item.stream.ready ? 'prêt' : 'en attente'}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Aucune caméra enregistrée.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0f1f4a', padding: 20 },
  error: { color: '#dc2626', fontSize: 13, paddingHorizontal: 20, marginBottom: 8 },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardOffline: { opacity: 0.6 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardName: { fontSize: 16, fontWeight: '600', color: '#0f1f4a' },
  cardMeta: { color: '#64748b', fontSize: 12, marginTop: 4 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  dotOnline: { backgroundColor: '#22c55e' },
  dotOffline: { backgroundColor: '#94a3b8' },
  badges: { flexDirection: 'row', gap: 8, marginTop: 8 },
  badge: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeOnline: { backgroundColor: '#dcfce7', color: '#15803d' },
  badgeOffline: { backgroundColor: '#f1f5f9', color: '#64748b' },
  badgeReady: { backgroundColor: '#dbeafe', color: '#1d4ed8' },
  badgePending: { backgroundColor: '#fef3c7', color: '#b45309' },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 24 },
  backButton: { marginBottom: 16 },
  backText: { color: '#2f5fdb', fontWeight: '600' },
  cameraName: { fontSize: 20, fontWeight: 'bold', color: '#0f1f4a' },
  cameraMeta: { color: '#64748b', fontSize: 13, marginTop: 4, marginBottom: 20 },
  streamBox: { backgroundColor: 'white', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  streamTitle: { fontSize: 16, fontWeight: '600', color: '#0f1f4a', marginBottom: 8 },
  streamUrl: { fontSize: 12, color: '#64748b', fontFamily: 'monospace', marginBottom: 12 },
  streamHint: { fontSize: 12, color: '#94a3b8', marginBottom: 16, lineHeight: 18 },
  openButton: { backgroundColor: '#2f5fdb', borderRadius: 10, padding: 12, alignItems: 'center' },
  openText: { color: 'white', fontWeight: '600' },
  readers: { color: '#64748b', fontSize: 13, marginTop: 12 },
});
