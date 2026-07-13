// Publication du flux caméra du téléphone vers le serveur, en direct.
//
// Le téléphone devient une SOURCE vidéo temps réel : il publie sa caméra en
// WebRTC via le protocole WHIP (WebRTC-HTTP Ingestion Protocol) vers MediaMTX
// (déjà utilisé côté serveur pour les caméras fixes). MediaMTX ré-expose alors
// le flux en RTSP, que le worker ML (`stream_worker.py` via `POST /streams`)
// consomme pour appliquer le pipeline complet : mouvement → suivi ByteTrack →
// plaque → vote temporel. Contrairement au scan photo-par-photo, le suivi et le
// vote deviennent possibles car le serveur reçoit un flux continu.
//
// Contrainte : WebRTC est natif (`react-native-webrtc`), donc indisponible dans
// Expo Go — il faut un *development build*. On charge le module dynamiquement et
// on expose `isLiveStreamAvailable()` ; sinon l'app retombe sur le scan photo.

// Interfaces minimales de react-native-webrtc (évite une dépendance de types au
// module natif, potentiellement absent à la compilation).
interface RTCSessionDescriptionInit {
  type: string;
  sdp?: string;
}
interface RTCPeerConnectionLike {
  addTrack(track: unknown, stream: unknown): void;
  createOffer(options?: unknown): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  close(): void;
}
interface MediaStreamLike {
  getTracks(): Array<{ stop(): void }>;
}
interface WebRtcModule {
  RTCPeerConnection: new (config?: unknown) => RTCPeerConnectionLike;
  mediaDevices: { getUserMedia(constraints: unknown): Promise<MediaStreamLike> };
}

export interface LiveSession {
  /** URL de la ressource WHIP (pour arrêter la publication côté serveur). */
  resourceUrl: string | null;
  /** Coupe la publication : ferme la connexion et libère la caméra. */
  stop(): Promise<void>;
}

export interface StartPublishingOptions {
  facingMode?: 'user' | 'environment'; // caméra avant / arrière (défaut arrière)
  withAudio?: boolean;
}

let _module: WebRtcModule | null | undefined;

function loadModule(): WebRtcModule | null {
  if (_module !== undefined) return _module;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _module = require('react-native-webrtc') as WebRtcModule;
  } catch {
    _module = null;
  }
  return _module;
}

/** Vrai si la publication WebRTC est disponible (development build). */
export function isLiveStreamAvailable(): boolean {
  return loadModule() != null;
}

/**
 * Démarre la publication de la caméra vers un endpoint WHIP (MediaMTX).
 * `whipUrl` est fourni par l'API (`POST /cameras/:id/live/start`).
 * Lève une erreur explicite si WebRTC n'est pas disponible.
 */
export async function startPublishing(
  whipUrl: string,
  options: StartPublishingOptions = {},
): Promise<LiveSession> {
  const webrtc = loadModule();
  if (webrtc == null) {
    throw new Error(
      "Diffusion en direct indisponible : 'react-native-webrtc' requiert un development build (voir docs mobile).",
    );
  }

  const stream = await webrtc.mediaDevices.getUserMedia({
    video: { facingMode: options.facingMode ?? 'environment' },
    audio: options.withAudio ?? false,
  });

  const pc = new webrtc.RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  for (const track of stream.getTracks()) {
    pc.addTrack(track, stream);
  }

  const offer = await pc.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: false });
  await pc.setLocalDescription(offer);

  // Échange WHIP : POST de l'offre SDP, réponse = answer SDP (+ Location =
  // URL de la ressource à supprimer pour arrêter).
  const response = await fetch(whipUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: offer.sdp ?? '',
  });
  if (!response.ok) {
    pc.close();
    for (const track of stream.getTracks()) track.stop();
    throw new Error(`Échec de la publication WHIP: ${response.status}`);
  }

  const answerSdp = await response.text();
  const location = response.headers.get('Location');
  const resourceUrl = location ? new URL(location, whipUrl).toString() : null;

  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

  return {
    resourceUrl,
    async stop() {
      try {
        if (resourceUrl) {
          await fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
        }
      } finally {
        pc.close();
        for (const track of stream.getTracks()) track.stop();
      }
    },
  };
}
