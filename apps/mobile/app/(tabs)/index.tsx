import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

interface Overview {
  vehicles: number;
  activeHotlist: number;
  newAlerts: number;
  capturesToday: number;
}

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Overview>('/analytics/overview');
      setOverview(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les données');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.greeting}>Bonjour {user?.firstName}</Text>
      <Text style={styles.subtitle}>Matricule {user?.badgeNumber}</Text>

      {error && <Text style={styles.errorText}>{error}</Text>}
      {loading && <ActivityIndicator size="large" color="#2f5fdb" style={{ marginTop: 20 }} />}

      {!loading && !error && (
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{overview?.newAlerts ?? '—'}</Text>
            <Text style={styles.statLabel}>Nouvelles alertes</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{overview?.capturesToday ?? '—'}</Text>
            <Text style={styles.statLabel}>Captures du jour</Text>
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/(tabs)/capture')}>
        <Text style={styles.actionText}>📷 Scanner une plaque</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionButtonSecondary} onPress={() => router.push('/(tabs)/search')}>
        <Text style={styles.actionTextSecondary}>🔍 Recherche rapide</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionButtonSecondary} onPress={() => router.push('/(tabs)/alerts')}>
        <Text style={styles.actionTextSecondary}>🚨 Voir les alertes actives</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={logout} style={{ marginTop: 32 }}>
        <Text style={{ color: '#94a3b8', textAlign: 'center' }}>Se déconnecter</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  greeting: { fontSize: 24, fontWeight: 'bold', color: '#0f1f4a' },
  subtitle: { color: '#64748b', marginBottom: 20 },
  errorText: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statCard: { flex: 1, backgroundColor: 'white', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  statValue: { fontSize: 28, fontWeight: 'bold', color: '#0f1f4a' },
  statLabel: { color: '#64748b', fontSize: 12, marginTop: 4 },
  actionButton: { backgroundColor: '#2f5fdb', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  actionText: { color: 'white', fontWeight: '600', fontSize: 16 },
  actionButtonSecondary: { backgroundColor: 'white', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  actionTextSecondary: { color: '#0f1f4a', fontWeight: '600', fontSize: 16 },
});
