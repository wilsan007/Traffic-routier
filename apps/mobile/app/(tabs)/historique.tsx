/**
 * Registre des plaques confirmées — l'onglet de relecture de l'agent.
 *
 * Le flux continu affiche un fil éphémère ; ici tout est persistant et classé,
 * pour revoir, vérifier et re-vérifier après coup. Les entrées scannées hors
 * réseau restent en « hors ligne » et se re-vérifient d'un bouton dès que la
 * connexion revient — condition de l'usage autonome sur le terrain.
 */
import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api } from '../../lib/api';
import { formatDjiboutiPlate } from '../../lib/djiboutiPlate';
import {
  ScanEntry,
  ScanStatus,
  listScans,
  updateScan,
  clearScans,
} from '../../lib/scanHistory';

type Filtre = 'tout' | ScanStatus;

const FILTRES: { key: Filtre; label: string }[] = [
  { key: 'tout', label: 'Tout' },
  { key: 'alert', label: '🚨 Alertes' },
  { key: 'known', label: 'Connues' },
  { key: 'clear', label: 'RAS' },
  { key: 'offline', label: 'Hors ligne' },
];

const BADGE: Record<ScanStatus, { label: string; color: string }> = {
  alert: { label: 'ALERTE', color: '#d92f2f' },
  known: { label: 'Connue', color: '#2f5fdb' },
  clear: { label: 'RAS', color: '#2e9e5b' },
  offline: { label: 'À vérifier', color: '#b8860b' },
};

interface ScanPlateResult {
  vehicleMatch: { make?: string; model?: string; stolen: boolean } | null;
  hotlistAlerts: { hotlistEntry: { reason: string } }[];
}

export default function HistoriqueScreen() {
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [filtre, setFiltre] = useState<Filtre>('tout');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    listScans().then(setEntries);
  }, []);

  // Rechargé à chaque retour sur l'onglet : le flux continu écrit pendant
  // qu'on est ailleurs.
  useFocusEffect(reload);

  /** Re-vérifie côté serveur les entrées restées hors ligne. */
  const reverifier = useCallback(async () => {
    const offline = entries.filter((e) => e.status === 'offline');
    if (offline.length === 0) return;
    setBusy(true);
    let ok = 0;
    for (const e of offline) {
      try {
        const res = await api.post<ScanPlateResult>('/captures/scan-plate', {
          plate: e.plate,
          latitude: e.latitude,
          longitude: e.longitude,
        });
        if (res.hotlistAlerts.length > 0) {
          await updateScan(e.id, {
            status: 'alert',
            detail: res.hotlistAlerts.map((a) => a.hotlistEntry.reason).join(', '),
          });
        } else if (res.vehicleMatch) {
          const v = res.vehicleMatch;
          await updateScan(e.id, {
            status: v.stolen ? 'alert' : 'known',
            detail: `${v.make ?? ''} ${v.model ?? ''}`.trim() + (v.stolen ? ' — ⚠️ VOLÉ' : ''),
          });
        } else {
          await updateScan(e.id, { status: 'clear' });
        }
        ok += 1;
      } catch {
        // Toujours pas de réseau : l'entrée reste re-vérifiable.
        break;
      }
    }
    setBusy(false);
    reload();
    Alert.alert('Re-vérification', `${ok}/${offline.length} entrée(s) vérifiée(s).`);
  }, [entries, reload]);

  const vider = useCallback(() => {
    Alert.alert('Vider l’historique', 'Supprimer toutes les entrées enregistrées ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Vider',
        style: 'destructive',
        onPress: () => clearScans().then(reload),
      },
    ]);
  }, [reload]);

  const visibles = filtre === 'tout' ? entries : entries.filter((e) => e.status === filtre);
  const nbOffline = entries.filter((e) => e.status === 'offline').length;

  return (
    <View style={styles.container}>
      {/* Filtres */}
      <View style={styles.filtres}>
        {FILTRES.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filtre, filtre === f.key && styles.filtreActif]}
            onPress={() => setFiltre(f.key)}
          >
            <Text style={[styles.filtreText, filtre === f.key && styles.filtreTextActif]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Text style={styles.compteur}>
          {entries.length} plaque(s){nbOffline > 0 ? ` · ${nbOffline} à vérifier` : ''}
        </Text>
        {nbOffline > 0 && (
          <TouchableOpacity style={styles.bouton} onPress={reverifier} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.boutonText}>Re-vérifier</Text>
            )}
          </TouchableOpacity>
        )}
        {entries.length > 0 && (
          <TouchableOpacity style={styles.boutonSecondaire} onPress={vider}>
            <Text style={styles.boutonSecondaireText}>Vider</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={visibles}
        keyExtractor={(e) => e.id}
        ListEmptyComponent={
          <Text style={styles.vide}>
            {entries.length === 0
              ? 'Aucune plaque enregistrée — lancez le flux continu depuis Scanner.'
              : 'Aucune entrée pour ce filtre.'}
          </Text>
        }
        renderItem={({ item }) => {
          const badge = BADGE[item.status];
          return (
            <View style={styles.ligne}>
              <View style={styles.ligneHaut}>
                <Text style={styles.plaque}>{formatDjiboutiPlate(item.plate)}</Text>
                <View style={[styles.badge, { backgroundColor: badge.color }]}>
                  <Text style={styles.badgeText}>{badge.label}</Text>
                </View>
              </View>
              <Text style={styles.meta}>
                {new Date(item.at).toLocaleString('fr-FR')}
                {item.detail ? ` — ${item.detail}` : ''}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fb' },
  filtres: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  filtre: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#e6e9f2',
  },
  filtreActif: { backgroundColor: '#2f5fdb' },
  filtreText: { fontSize: 13, color: '#33415c' },
  filtreTextActif: { color: '#fff', fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  compteur: { flex: 1, fontSize: 13, color: '#5a6478' },
  bouton: {
    backgroundColor: '#b8860b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  boutonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  boutonSecondaire: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c3cad9',
  },
  boutonSecondaireText: { color: '#5a6478', fontSize: 13 },
  ligne: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
  },
  ligneHaut: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  plaque: { fontSize: 18, fontWeight: '700', color: '#16213a', letterSpacing: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  meta: { marginTop: 4, fontSize: 12, color: '#5a6478' },
  vide: { textAlign: 'center', marginTop: 48, color: '#8a93a8', paddingHorizontal: 32 },
});
