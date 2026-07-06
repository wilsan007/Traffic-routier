import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { api, ApiError } from '../../lib/api';
import { getAlertsSocket } from '../../lib/socket';
import type { Alert } from '@trafficguard/shared';

const PRIORITY_COLORS: Record<string, string> = {
  LOW: '#e2e8f0',
  MEDIUM: '#fef3c7',
  HIGH: '#fed7aa',
  CRITICAL: '#fecaca',
};

export default function AlertsScreen() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Alert[]>('/alerts?status=NEW');
      setAlerts(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les alertes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    let cleanup: (() => void) | undefined;
    getAlertsSocket().then((socket) => {
      socket.on('alert.new', refresh);
      cleanup = () => socket.off('alert.new', refresh);
    });
    return () => cleanup?.();
  }, [refresh]);

  async function acknowledge(id: string) {
    try {
      await api.patch(`/alerts/${id}/acknowledge`);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d\'accuser réception');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Alertes actives</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {loading && <ActivityIndicator size="large" color="#2f5fdb" style={{ marginTop: 20 }} />}
      {!loading && (
        <FlatList
          data={alerts}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: PRIORITY_COLORS[item.hotlistEntry.priority] ?? 'white' }]}>
              <Text style={styles.plate}>{item.capture.plateNumberNormalized}</Text>
              <Text style={styles.reason}>{item.hotlistEntry.reason} — {item.hotlistEntry.priority}</Text>
              <TouchableOpacity style={styles.ackButton} onPress={() => acknowledge(item.id)}>
                <Text style={styles.ackButtonText}>Accuser réception</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Aucune alerte active.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 20 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0f1f4a', marginBottom: 16 },
  error: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  card: { borderRadius: 12, padding: 14, marginBottom: 10 },
  plate: { fontSize: 18, fontWeight: 'bold', color: '#0f1f4a' },
  reason: { color: '#334155', marginBottom: 8 },
  ackButton: { alignSelf: 'flex-start', backgroundColor: 'white', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  ackButtonText: { fontSize: 12, color: '#0f1f4a', fontWeight: '600' },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 24 },
});
