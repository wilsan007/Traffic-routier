import { useRef, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, ScrollView, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { api, API_URL, getToken } from '../../lib/api';
import { getAlertsSocket } from '../../lib/socket';
import { PhotoRecognizer } from 'react-native-vision-camera-text-recognition';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { readLineFromJpegBase64 } from '../../lib/plateReaderOnnx';
import { reconcile } from '../../lib/plateBilingue';
import { addScan } from '../../lib/scanHistory';

interface InfractionTypeOption {
  id: string;
  label: string;
  category?: string;
  baseAmount: number;
  points: number;
}

interface ScanResult {
  capture: { id: string; plateNumberNormalized: string; confidence: number; imageUrl: string } | null;
  plateNumberNormalized: string;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  vehicleMatch: { id: string; plateNumber: string; make?: string; model?: string; stolen: boolean } | null;
  hotlistAlerts: { id: string; hotlistEntry: { reason: string; priority: string } }[];
  persisted: boolean;
}

export default function CaptureScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [livePlate, setLivePlate] = useState<string | null>(null);
  const [liveConfidence, setLiveConfidence] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Verbalisation terrain
  const [types, setTypes] = useState<InfractionTypeOption[] | null>(null);
  const [pvCreated, setPvCreated] = useState<string | null>(null);
  const [pvLoading, setPvLoading] = useState(false);
  // Mode scan continu
  const [continuous, setContinuous] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  const continuousRef = useRef(false);
  const scanningRef = useRef(false);
  // Enregistrement vidéo
  const [recording, setRecording] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);

  // Notifications locales pour les alertes en mode continu
  useEffect(() => {
    if (!continuous) return;
    let cleanup: (() => void) | undefined;
    getAlertsSocket().then((socket) => {
      const handler = (alert: { capture: { plateNumberNormalized: string }; hotlistEntry: { reason: string; priority: string } }) => {
        Notifications.scheduleNotificationAsync({
          content: {
            title: `🚨 Alerte ${alert.hotlistEntry.priority}`,
            body: `${alert.capture.plateNumberNormalized} — ${alert.hotlistEntry.reason}`,
            sound: 'default',
          },
          trigger: null,
        });
        setLastAlert(`${alert.capture.plateNumberNormalized} — ${alert.hotlistEntry.reason}`);
      };
      socket.on('alert.new', handler);
      cleanup = () => socket.off('alert.new', handler);
    });
    return () => cleanup?.();
  }, [continuous]);

  // Boucle de scan continu
  const runContinuousScan = useCallback(async () => {
    if (!continuousRef.current || scanningRef.current || !cameraRef.current) return;
    scanningRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      if (!photo) return;

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
      const res = await fetch(`${API_URL}/captures/scan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Client-Type': 'mobile' },
        body: form,
      });
      if (!res.ok) return;
      const data: ScanResult = await res.json();
      setScanCount((c) => c + 1);

      if (data.plateNumberNormalized) {
        setLivePlate(data.plateNumberNormalized);
        setLiveConfidence(data.confidence);
      } else {
        setLivePlate(null);
      }

      if (data.hotlistAlerts.length > 0) {
        setPhotoUri(photo.uri);
        setResult(data);
        continuousRef.current = false;
        setContinuous(false);
        Notifications.scheduleNotificationAsync({
          content: {
            title: `🚨 ${data.plateNumberNormalized} — Liste de surveillance`,
            body: data.hotlistAlerts.map((a) => a.hotlistEntry.reason).join(', '),
            sound: 'default',
          },
          trigger: null,
        });
      }
    } catch {
      // erreur ponctuelle, on continue
    } finally {
      scanningRef.current = false;
    }
  }, []);

  useEffect(() => {
    continuousRef.current = continuous;
    if (!continuous) return;
    const interval = setInterval(runContinuousScan, 1000);
    return () => clearInterval(interval);
  }, [continuous, runContinuousScan]);

  async function toggleRecording() {
    if (!cameraRef.current) return;
    if (recording) {
      cameraRef.current.stopRecording();
      setRecording(false);
    } else {
      setRecording(true);
      try {
        const video = await cameraRef.current.recordAsync({ maxDuration: 60 });
        if (video) setVideoUri(video.uri);
      } catch {
        setError('Erreur enregistrement vidéo');
      } finally {
        setRecording(false);
      }
    }
  }

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
    if (!result?.vehicleMatch || !result?.capture) return;
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
      const res = await fetch(`${API_URL}/captures/scan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Client-Type': 'mobile' },
        body: form,
      });
      if (!res.ok) throw new Error("Échec de l'analyse de la plaque");
      const data: ScanResult = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  // --- Lecture embarquée (CRNN bilingue) -----------------------------------
  // ML Kit sert de LOCALISATEUR : il trouve les zones de texte même quand il
  // les lit mal (sur la police 7 segments il sort du charabia, mais il trouve
  // la zone). Le CRNN lit chaque zone, puis la vérification croisée
  // latin/arabe ne laisse passer que les lectures concordantes.
  interface LectureEmbarquee {
    plate: string | null;
    reason: string;
    brutes: string[];
  }
  const [onDevice, setOnDevice] = useState<LectureEmbarquee | null>(null);
  const [onDeviceLoading, setOnDeviceLoading] = useState(false);

  const lireSurAppareil = useCallback(async (uri: string) => {
    setOnDeviceLoading(true);
    setOnDevice(null);
    try {
      const reco = (await PhotoRecognizer({ uri })) as unknown as {
        blocks?: unknown;
      };

      // Les types du plugin sont des tuples approximatifs ; on extrait les
      // cadres de ligne défensivement, quelle que soit la forme réelle.
      type Cadre = { x: number; y: number; width: number; height: number };
      const lignes: Cadre[] = [];
      const visiter = (node: unknown) => {
        if (Array.isArray(node)) {
          for (const n of node) visiter(n);
          return;
        }
        if (node && typeof node === 'object') {
          const o = node as Record<string, unknown>;
          const f = (o.lineFrame ?? o.blockFrame) as Cadre | undefined;
          if (
            f &&
            typeof f.x === 'number' &&
            typeof f.width === 'number' &&
            f.width > 40 &&
            f.width / Math.max(1, f.height) > 1.4
          ) {
            lignes.push(f);
          }
          for (const v of Object.values(o)) visiter(v);
        }
      };
      visiter(reco.blocks);

      // Bornage : chaque lecture coûte ~100 ms — dix zones suffisent, les
      // plaques sont parmi les plus larges.
      const zones = lignes
        .sort((a, b) => b.width - a.width)
        .slice(0, 10);

      const brutes: string[] = [];
      for (const z of zones) {
        // Marge autour de la boîte : mesuré en atelier, un recadrage collé au
        // texte fait perdre le premier caractère.
        const mx = z.width * 0.12;
        const my = z.height * 0.25;
        const crop = await manipulateAsync(
          uri,
          [
            {
              crop: {
                originX: Math.max(0, z.x - mx),
                originY: Math.max(0, z.y - my),
                width: z.width + 2 * mx,
                height: z.height + 2 * my,
              },
            },
            { resize: { width: 192, height: 48 } },
          ],
          { format: SaveFormat.JPEG, base64: true, compress: 0.9 },
        );
        if (!crop.base64) continue;
        const lu = await readLineFromJpegBase64(crop.base64);
        if (lu) brutes.push(lu);
      }

      // Une plaque rectangulaire tient dans UNE zone (latin+arabe côte à
      // côte) ; une carrée est répartie sur DEUX zones superposées. On essaie
      // donc chaque lecture seule, puis chaque paire.
      let verdict: LectureEmbarquee = {
        plate: null,
        reason: brutes.length ? 'aucune concordance latin/arabe' : 'aucun texte lisible',
        brutes,
      };
      exterieur: for (let i = 0; i < brutes.length; i++) {
        const seul = reconcile(brutes[i]);
        if (seul.plate) {
          verdict = { plate: seul.plate, reason: seul.reason, brutes };
          break;
        }
        for (let j = 0; j < brutes.length; j++) {
          if (i === j) continue;
          const paire = reconcile(brutes[i] + brutes[j]);
          if (paire.plate) {
            verdict = { plate: paire.plate, reason: paire.reason, brutes };
            break exterieur;
          }
        }
      }

      setOnDevice(verdict);
      if (verdict.plate) {
        // Versée au journal en « hors ligne » : l'onglet Historique la
        // re-vérifiera côté serveur en un bouton.
        addScan({ plate: verdict.plate, at: Date.now(), status: 'offline' }).catch(() => {});
      }
    } catch (e) {
      setOnDevice({
        plate: null,
        reason: e instanceof Error ? e.message : 'échec de la lecture embarquée',
        brutes: [],
      });
    } finally {
      setOnDeviceLoading(false);
    }
  }, []);

  function reset() {
    setPhotoUri(null);
    setResult(null);
    setError(null);
    setTypes(null);
    setPvCreated(null);
    setVideoUri(null);
    setLastAlert(null);
    setLivePlate(null);
    setOnDevice(null);
  }

  function resetContinuous() {
    setScanCount(0);
    setLastAlert(null);
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
            <Text style={styles.plateText}>{result.plateNumberNormalized || 'Aucune plaque détectée'}</Text>
            <Text style={styles.confidenceText}>
              Confiance OCR : {(result.confidence * 100).toFixed(0)}%
              {result.persisted ? ' · ⚠️ Capture sauvegardée (alerte)' : ' · Éphémère (non sauvegardée)'}
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
        {/* Lecture embarquée : CRNN bilingue + vérification croisée, sans serveur */}
        <TouchableOpacity
          style={styles.onDeviceButton}
          onPress={() => photoUri && lireSurAppareil(photoUri)}
          disabled={onDeviceLoading}
        >
          {onDeviceLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.actionText}>🔤 Lire sur l’appareil (CRNN)</Text>
          )}
        </TouchableOpacity>
        {onDevice && (
          <View style={styles.resultCard}>
            {onDevice.plate ? (
              <>
                <Text style={styles.plateText}>{onDevice.plate}</Text>
                <Text style={styles.confidenceText}>
                  ✅ Latin et arabe concordants — {onDevice.reason}
                </Text>
                <Text style={styles.matchTextMuted}>
                  Versée à l’Historique (à re-vérifier en ligne).
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.matchTextMuted}>Lecture embarquée : {onDevice.reason}</Text>
                {onDevice.brutes.map((b, i) => (
                  <Text key={i} style={styles.matchTextMuted}>
                    · {b}
                  </Text>
                ))}
              </>
            )}
          </View>
        )}
        {/* Verbalisation depuis la capture (PV terrain) */}
        {result?.persisted && result?.capture && result?.vehicleMatch && !pvCreated && (
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

  if (videoUri) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.sectionTitle}>Vidéo enregistrée</Text>
        <View style={styles.videoPlaceholder}>
          <Text style={styles.hint}>Vidéo sauvegardée :</Text>
          <Text style={styles.videoPath}>{videoUri}</Text>
        </View>
        <TouchableOpacity style={styles.actionButton} onPress={() => setVideoUri(null)}>
          <Text style={styles.actionText}>Retour à la caméra</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode={recording ? 'video' : 'picture'}
      />
      {/* Accès au flux continu on-device (reconnaissance live sans serveur OCR) */}
      {!recording && (
        <TouchableOpacity style={styles.streamButton} onPress={() => router.push('/stream-scan')}>
          <Text style={styles.streamButtonText}>🎥 Flux continu on-device</Text>
        </TouchableOpacity>
      )}
      {/* Overlay live — plaque détectée en temps réel */}
      {livePlate && (
        <View style={styles.liveOverlay}>
          <Text style={styles.livePlate}>{livePlate}</Text>
          <Text style={styles.liveConfidence}>
            {(liveConfidence * 100).toFixed(0)}% · {continuous ? 'scan live 1 fps' : 'appuyez pour capturer'}
          </Text>
        </View>
      )}
      {/* Bandeau mode continu */}
      {continuous && (
        <View style={styles.continuousBanner}>
          <Text style={styles.continuousText}>
            🔍 Scan live — {scanCount} plaque(s) vérifiée(s) · éphémère
          </Text>
          {lastAlert && <Text style={styles.continuousAlert}>⚠️ {lastAlert}</Text>}
        </View>
      )}
      {error && (
        <View style={styles.cameraErrorBanner}>
          <Text style={styles.cameraErrorText}>{error}</Text>
        </View>
      )}
      {/* Contrôles mode continu + enregistrement */}
      <View style={styles.controlsRow}>
        <View style={styles.continuousToggle}>
          <Text style={styles.toggleLabel}>Scan live 1 fps</Text>
          <Switch
            value={continuous}
            onValueChange={(v) => { setContinuous(v); if (v) resetContinuous(); }}
            trackColor={{ true: '#2f5fdb' }}
          />
        </View>
        <TouchableOpacity
          style={[styles.recordButton, recording && styles.recordButtonActive]}
          onPress={toggleRecording}
        >
          <View style={styles.recordInner} />
        </TouchableOpacity>
      </View>
      {/* Bouton capture manuelle */}
      {!continuous && !recording && (
        <TouchableOpacity style={styles.shutterButton} onPress={takePhotoAndAnalyze}>
          <View style={styles.shutterInner} />
        </TouchableOpacity>
      )}
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
  onDeviceButton: { backgroundColor: '#7a3fb8', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 },
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
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#0f1f4a', marginBottom: 16 },
  videoPlaceholder: { backgroundColor: 'white', borderRadius: 12, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  videoPath: { color: '#64748b', fontSize: 12, marginTop: 4 },
  liveOverlay: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(15, 31, 74, 0.85)',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  livePlate: { color: 'white', fontSize: 22, fontWeight: 'bold', letterSpacing: 2 },
  liveConfidence: { color: '#94a3b8', fontSize: 11, marginTop: 4 },
  continuousBanner: {
    position: 'absolute',
    top: 120,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(47, 95, 219, 0.92)',
    borderRadius: 10,
    padding: 10,
  },
  continuousText: { color: 'white', fontWeight: '600', textAlign: 'center', fontSize: 13 },
  continuousAlert: { color: '#fef3c7', fontSize: 12, marginTop: 4, textAlign: 'center' },
  controlsRow: {
    position: 'absolute',
    bottom: 32,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  continuousToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toggleLabel: { color: '#0f1f4a', fontWeight: '600', fontSize: 14 },
  recordButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonActive: { backgroundColor: '#dc2626' },
  recordInner: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#dc2626' },
  streamButton: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(47, 95, 219, 0.92)',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  streamButtonText: { color: 'white', fontWeight: '700', fontSize: 14 },
});
