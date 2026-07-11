import { useRef, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { detectPlateDemo, hasDemoApiKey, type DemoPlateResult } from '../lib/demo-alpr';

export default function DemoCaptureScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DemoPlateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const liveRef = useRef(false);
  const scanningRef = useRef(false);
  const apiKeyOk = hasDemoApiKey();

  // Scan continu — prend une photo toutes les 1.5s, envoie à Plate Recognizer
  // Garde la caméra active, met à jour l'overlay en temps réel
  const runLiveScan = useCallback(async () => {
    if (!liveRef.current || scanningRef.current || !cameraRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      if (!photo) return;
      const detected = await detectPlateDemo(photo.uri);
      setScanCount((c) => c + 1);
      setLastScanTime(new Date().toLocaleTimeString());

      if (detected) {
        setResult(detected);
        setMatchCount((c) => c + 1);
      } else {
        setResult(null);
      }
    } catch {
      // Erreur ponctuelle en mode live — on continue silencieusement
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    liveRef.current = live;
    if (!live) return;
    runLiveScan();
    const interval = setInterval(runLiveScan, 1500);
    return () => clearInterval(interval);
  }, [live, runLiveScan]);

  // Capture manuelle unique
  async function captureOnce() {
    if (!cameraRef.current) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo) return;
      setPhotoUri(photo.uri);
      const detected = await detectPlateDemo(photo.uri);
      setScanCount((c) => c + 1);
      if (detected) {
        setResult(detected);
      } else {
        setError('Aucune plaque détectée sur cette image.');
      }
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
  }

  if (!permission) return <View style={styles.center}><ActivityIndicator /></View>;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Autorisation caméra requise.</Text>
        <TouchableOpacity style={styles.actionButton} onPress={requestPermission}>
          <Text style={styles.actionText}>Autoriser la caméra</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!apiKeyOk) {
    return (
      <View style={styles.center}>
        <Text style={styles.warningTitle}>⚠️ Clé API manquante</Text>
        <Text style={styles.warningText}>
          Pour utiliser la reconnaissance de plaques en mode démo, vous avez besoin d'une clé API gratuite Plate Recognizer.
        </Text>
        <Text style={styles.warningStep}>1. Inscrivez-vous sur platerecognizer.com</Text>
        <Text style={styles.warningStep}>2. Copiez votre clé API (token)</Text>
        <Text style={styles.warningStep}>3. Ajoutez-la dans app.json → extra → plateRecognizerKey</Text>
        <Text style={styles.warningStep}>4. Rebuildez l'APK</Text>
      </View>
    );
  }

  // Vue résultat — uniquement pour capture manuelle (pas en mode live)
  if (!live && photoUri && result) {
    return (
      <View style={styles.container}>
        <Image source={{ uri: photoUri }} style={styles.camera} resizeMode="cover" />
        <View style={styles.resultOverlay}>
          <View style={styles.resultCard}>
            <Text style={styles.plateText}>{result.plate}</Text>
            <Text style={styles.confidenceText}>
              Confiance : {(result.confidence * 100).toFixed(0)}%
            </Text>
            {result.vehicle && (result.vehicle.make || result.vehicle.model) && (
              <Text style={styles.vehicleText}>
                {result.vehicle.make} {result.vehicle.model}
                {result.vehicle.color ? ` · ${result.vehicle.color}` : ''}
              </Text>
            )}
          </View>
          <TouchableOpacity style={styles.actionButton} onPress={reset}>
            <Text style={styles.actionText}>Nouvelle capture</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Vue caméra — utilisée pour live ET capture manuelle
  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        mode="picture"
      />

      {/* Overlay plaque détectée — temps réel */}
      {result && (
        <View style={styles.liveOverlay}>
          <Text style={styles.livePlate}>{result.plate}</Text>
          <Text style={styles.liveConfidence}>
            {(result.confidence * 100).toFixed(0)}% de confiance
          </Text>
          {result.vehicle && (result.vehicle.make || result.vehicle.model) && (
            <Text style={styles.liveVehicle}>
              {result.vehicle.make} {result.vehicle.model}
              {result.vehicle.color ? ` · ${result.vehicle.color}` : ''}
            </Text>
          )}
        </View>
      )}

      {/* Badge flux live */}
      {live && (
        <View style={styles.liveBadge}>
          <View style={styles.liveBadgeRow}>
            <Text style={styles.liveBadgeText}>� FLUX LIVE</Text>
            <Text style={styles.liveBadgeCount}>{scanCount} scans · {matchCount} plaques</Text>
          </View>
          {lastScanTime && (
            <Text style={styles.liveBadgeTime}>Dernier scan : {lastScanTime}</Text>
          )}
          {scanning && (
            <Text style={styles.liveBadgeScanning}>Analyse en cours…</Text>
          )}
        </View>
      )}

      {/* Indicateur de scan en cours (mode manuel) */}
      {!live && loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#2f5fdb" />
          <Text style={styles.loadingText}>Analyse de la plaque…</Text>
        </View>
      )}

      {/* Erreur (mode manuel uniquement) */}
      {error && !live && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Bouton retour */}
      <TouchableOpacity style={styles.backButton} onPress={() => { setLive(false); reset(); }}>
        <Text style={styles.backText}>← Retour</Text>
      </TouchableOpacity>

      {/* Contrôles */}
      {live ? (
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={styles.stopButton}
            onPress={() => { setLive(false); setResult(null); }}
          >
            <Text style={styles.stopText}>⏹ Arrêter le flux</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={styles.startLiveButton}
              onPress={() => { setLive(true); setScanCount(0); setMatchCount(0); setResult(null); setPhotoUri(null); setError(null); }}
            >
              <Text style={styles.startLiveText}>▶ Démarrer le flux vidéo live</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou capture manuelle</Text>
            <View style={styles.dividerLine} />
          </View>
          <TouchableOpacity style={styles.shutterButton} onPress={captureOnce} disabled={loading}>
            {loading ? <ActivityIndicator color="#2f5fdb" /> : <View style={styles.shutterInner} />}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  camera: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#f8fafc' },
  permissionText: { textAlign: 'center', marginBottom: 16, color: '#334155', fontSize: 16 },
  warningTitle: { fontSize: 20, fontWeight: 'bold', color: '#dc2626', marginBottom: 12 },
  warningText: { color: '#64748b', fontSize: 14, textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  warningStep: { color: '#334155', fontSize: 13, marginTop: 6, textAlign: 'left' },

  liveOverlay: {
    position: 'absolute',
    top: 70,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(15, 31, 74, 0.90)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#22c55e',
  },
  livePlate: { color: '#22c55e', fontSize: 28, fontWeight: 'bold', letterSpacing: 3 },
  liveConfidence: { color: '#94a3b8', fontSize: 13, marginTop: 4 },
  liveVehicle: { color: '#cbd5e1', fontSize: 13, marginTop: 4 },

  liveBadge: {
    position: 'absolute',
    top: 15,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(47, 95, 219, 0.95)',
    borderRadius: 10,
    padding: 10,
  },
  liveBadgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  liveBadgeText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  liveBadgeCount: { color: '#dbeafe', fontSize: 12 },
  liveBadgeTime: { color: '#bfdbfe', fontSize: 11, marginTop: 4 },
  liveBadgeScanning: { color: '#fde68a', fontSize: 11, marginTop: 2 },

  loadingOverlay: {
    position: 'absolute',
    top: 70,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(15, 31, 74, 0.85)',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  loadingText: { color: 'white', marginTop: 8, fontSize: 14 },

  errorBanner: {
    position: 'absolute',
    top: 70,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
    borderRadius: 10,
    padding: 12,
  },
  errorText: { color: 'white', textAlign: 'center', fontWeight: '600' },

  backButton: {
    position: 'absolute',
    bottom: 130,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backText: { color: 'white', fontSize: 14, fontWeight: '500' },

  controlsRow: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  startLiveButton: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    width: '100%',
  },
  startLiveText: { color: 'white', fontWeight: 'bold', fontSize: 17 },
  stopButton: {
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    width: '100%',
  },
  stopText: { color: 'white', fontWeight: 'bold', fontSize: 17 },

  dividerRow: {
    position: 'absolute',
    bottom: 120,
    left: 40,
    right: 40,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  dividerText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginHorizontal: 8 },

  shutterButton: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#2f5fdb' },

  resultOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 20,
    paddingBottom: 40,
  },
  resultCard: { backgroundColor: 'rgba(15, 31, 74, 0.95)', borderRadius: 12, padding: 20, marginBottom: 16, alignItems: 'center' },
  plateText: { fontSize: 32, fontWeight: 'bold', color: '#22c55e', letterSpacing: 3 },
  confidenceText: { color: '#94a3b8', marginTop: 8, fontSize: 16 },
  vehicleText: { color: '#cbd5e1', fontWeight: '500', marginTop: 8, fontSize: 15 },
  actionButton: { backgroundColor: '#2f5fdb', borderRadius: 12, padding: 16, alignItems: 'center' },
  actionText: { color: 'white', fontWeight: '600', fontSize: 16 },
});
