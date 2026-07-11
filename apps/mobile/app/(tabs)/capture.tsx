import { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { api, API_URL, getToken } from '../../lib/api';

interface InfractionTypeOption {
  id: string;
  label: string;
  category?: string;
  baseAmount: number;
  points: number;
}

interface CaptureResult {
  capture: {
    id: string;
    plateNumberNormalized: string;
    confidence: number;
    imageUrl: string;
  };
  vehicleMatch: { id: string; plateNumber: string; make?: string; model?: string; stolen: boolean } | null;
  hotlistAlerts: { id: string; hotlistEntry: { reason: string; priority: string } }[];
}

export default function CaptureScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Verbalisation terrain
  const [types, setTypes] = useState<InfractionTypeOption[] | null>(null);
  const [pvCreated, setPvCreated] = useState<string | null>(null);
  const [pvLoading, setPvLoading] = useState(false);

  async function openVerbalisation() {
    if (types) {
      setTypes(null);
      return;
    }
    try {
      const list = await api.get<InfractionTypeOption[]>('/infraction-types?activeOnly=true');
      setTypes(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger le barème');
    }
  }

  async function verbalize(typeId: string) {
    if (!result?.vehicleMatch) return;
    setPvLoading(true);
    try {
      const pv = await api.post<{ reference: string }>('/infractions', {
        vehicleId: result.vehicleMatch.id,
        typeId,
        captureId: result.capture.id,
      });
      setPvCreated(pv.reference);
      setTypes(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verbalisation impossible');
    } finally {
      setPvLoading(false);
    }
  }

  if (!permission) return <View style={styles.center}><ActivityIndicator /></View>;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Autorisation caméra requise pour scanner une plaque.</Text>
        <TouchableOpacity style={styles.actionButton} onPress={requestPermission}>
          <Text style={styles.actionText}>Autoriser la caméra</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function takePhotoAndAnalyze() {
    if (!cameraRef.current) return;
    setError(null);
    setResult(null);
    let photo: { uri: string } | undefined;
    try {
      photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
    } catch {
      setError("Échec de la prise de photo — réessayez.");
      return;
    }
    if (!photo) return;
    setPhotoUri(photo.uri);
    setLoading(true);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let coords: Location.LocationObjectCoords | null = null;
      if (status === 'granted') {
        const position = await Location.getCurrentPositionAsync({});
        coords = position.coords;
      }

      const form = new FormData();
      form.append('image', { uri: photo.uri, name: 'capture.jpg', type: 'image/jpeg' } as any);
      if (coords) {
        form.append('latitude', String(coords.latitude));
        form.append('longitude', String(coords.longitude));
      }

      const token = await getToken();
      const res = await fetch(`${API_URL}/captures`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error("Échec de l'analyse de la plaque");
      const data: CaptureResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setPhotoUri(null);
    setResult(null);
    setError(null);
    setTypes(null);
    setPvCreated(null);
  }

  if (photoUri) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
        <Image source={{ uri: photoUri }} style={styles.preview} />
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#2f5fdb" />
            <Text style={styles.hint}>Analyse de la plaque en cours…</Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        {result && (
          <View style={styles.resultCard}>
            <Text style={styles.plateText}>{result.capture.plateNumberNormalized || 'Aucune plaque détectée'}</Text>
            <Text style={styles.confidenceText}>
              Confiance OCR : {(result.capture.confidence * 100).toFixed(0)}%
            </Text>
            {result.vehicleMatch ? (
              <Text style={styles.matchText}>
                Véhicule : {result.vehicleMatch.make} {result.vehicleMatch.model}
                {result.vehicleMatch.stolen ? ' — ⚠️ SIGNALÉ VOLÉ' : ''}
              </Text>
            ) : (
              <Text style={styles.matchTextMuted}>Aucun véhicule correspondant trouvé en base.</Text>
            )}
            {result.hotlistAlerts.length > 0 && (
              <View style={styles.alertBox}>
                <Text style={styles.alertTitle}>⚠️ Correspondance liste de surveillance</Text>
                {result.hotlistAlerts.map((a) => (
                  <Text key={a.id} style={styles.alertItem}>
                    {a.hotlistEntry.reason} — priorité {a.hotlistEntry.priority}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
        {/* Verbalisation depuis la capture (PV terrain) */}
        {result?.vehicleMatch && !pvCreated && (
          <TouchableOpacity style={styles.verbalizeButton} onPress={openVerbalisation} disabled={pvLoading}>
            <Text style={styles.actionText}>{types ? 'Fermer le barème' : '📝 Verbaliser ce véhicule'}</Text>
          </TouchableOpacity>
        )}
        {types && !pvCreated && (
          <View style={styles.typeList}>
            {types.map((t) => (
              <TouchableOpacity key={t.id} style={styles.typeItem} onPress={() => verbalize(t.id)} disabled={pvLoading}>
                <Text style={styles.typeLabel}>{t.label}</Text>
                <Text style={styles.typeMeta}>
                  {t.baseAmount} € {t.points ? `· ${t.points} pt(s)` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {pvCreated && (
          <View style={styles.pvBox}>
            <Text style={styles.pvTitle}>✓ PV créé : {pvCreated}</Text>
            <Text style={styles.pvHint}>Soumis à validation du superviseur, avec la photo en preuve.</Text>
          </View>
        )}

        <TouchableOpacity style={styles.actionButton} onPress={reset}>
          <Text style={styles.actionText}>Nouvelle capture</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      {error && (
        <View style={styles.cameraErrorBanner}>
          <Text style={styles.cameraErrorText}>{error}</Text>
        </View>
      )}
      <TouchableOpacity style={styles.shutterButton} onPress={takePhotoAndAnalyze}>
        <View style={styles.shutterInner} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  camera: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  permissionText: { textAlign: 'center', marginBottom: 16, color: '#334155' },
  shutterButton: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#2f5fdb' },
  cameraErrorBanner: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
    borderRadius: 10,
    padding: 12,
  },
  cameraErrorText: { color: 'white', textAlign: 'center', fontWeight: '600' },
  preview: { width: '100%', height: 220, borderRadius: 12, marginBottom: 16, backgroundColor: '#e2e8f0' },
  hint: { marginTop: 8, color: '#64748b' },
  error: { color: '#dc2626', marginBottom: 12 },
  resultCard: { backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  plateText: { fontSize: 24, fontWeight: 'bold', color: '#0f1f4a' },
  confidenceText: { color: '#64748b', marginBottom: 8 },
  matchText: { color: '#0f1f4a', fontWeight: '500' },
  matchTextMuted: { color: '#94a3b8' },
  alertBox: { marginTop: 12, backgroundColor: '#fef2f2', borderRadius: 8, padding: 12 },
  alertTitle: { color: '#b91c1c', fontWeight: 'bold', marginBottom: 4 },
  alertItem: { color: '#b91c1c' },
  actionButton: { backgroundColor: '#2f5fdb', borderRadius: 12, padding: 16, alignItems: 'center' },
  actionText: { color: 'white', fontWeight: '600', fontSize: 16 },
  verbalizeButton: { backgroundColor: '#0f1f4a', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  typeList: { backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12 },
  typeItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  typeLabel: { flex: 1, color: '#0f172a', fontSize: 14, marginRight: 8 },
  typeMeta: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  pvBox: { backgroundColor: '#ecfdf5', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#a7f3d0' },
  pvTitle: { color: '#047857', fontWeight: '700' },
  pvHint: { color: '#059669', fontSize: 12, marginTop: 2 },
});
