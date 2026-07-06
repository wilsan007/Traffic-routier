import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { api, ApiError } from '../../lib/api';
import type { SearchType } from '@trafficguard/shared';

interface SearchResult {
  vehicles: { id: string; plateNumber: string; make?: string; model?: string; stolen: boolean }[];
  owners: { id: string; firstName: string; lastName: string; licenseStatus: string }[];
}

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('PLATE');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<SearchResult>(`/search?q=${encodeURIComponent(query)}&type=${type}`);
      setResults(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de recherche');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Recherche rapide</Text>

      <View style={styles.typeRow}>
        {(['PLATE', 'VIN', 'OWNER'] as SearchType[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.typeChip, type === t && styles.typeChipActive]}
            onPress={() => setType(t)}
          >
            <Text style={type === t ? styles.typeChipTextActive : styles.typeChipText}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Plaque, nom, VIN…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="characters"
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch} disabled={loading}>
          <Text style={styles.searchButtonText}>{loading ? '…' : 'OK'}</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}
      {loading && <ActivityIndicator size="large" color="#2f5fdb" style={{ marginTop: 20 }} />}

      {!loading && (
        <FlatList
        data={[...(results?.vehicles ?? []), ...(results?.owners ?? [])]}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.resultRow}>
            {'plateNumber' in item ? (
              <>
                <Text style={styles.resultTitle}>{item.plateNumber}</Text>
                <Text style={styles.resultSubtitle}>
                  {item.make} {item.model} {item.stolen ? '⚠️ VOLÉ' : ''}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.resultTitle}>{item.firstName} {item.lastName}</Text>
                <Text style={styles.resultSubtitle}>Permis : {item.licenseStatus}</Text>
              </>
            )}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Aucun résultat</Text>}
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 20 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0f1f4a', marginBottom: 16 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#cbd5e1' },
  typeChipActive: { backgroundColor: '#2f5fdb', borderColor: '#2f5fdb' },
  typeChipText: { color: '#334155', fontSize: 12 },
  typeChipTextActive: { color: 'white', fontSize: 12 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  input: { flex: 1, backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  searchButton: { backgroundColor: '#2f5fdb', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  searchButtonText: { color: 'white', fontWeight: '600' },
  resultRow: { backgroundColor: 'white', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  resultTitle: { fontWeight: '600', color: '#0f1f4a' },
  resultSubtitle: { color: '#64748b', fontSize: 12 },
  errorText: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 24 },
});
