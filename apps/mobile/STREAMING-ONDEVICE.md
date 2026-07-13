# Mobile avancé : diffusion en direct & reconnaissance embarquée

Deux modes terrain au-delà du scan photo → serveur :

| | **Option 2 — Diffusion en direct** | **Option 3 — Scan hors-ligne (on-device)** |
|---|---|---|
| Écran | `app/live.tsx` | `app/offline-scan.tsx` |
| Où tourne l'IA | serveur (pipeline complet : suivi ByteTrack + vote) | sur le téléphone (ML Kit) |
| Réseau | requis (flux WebRTC) | fonctionne **hors-ligne**, sync différée |
| Dépendance native | `react-native-webrtc` | `@react-native-ml-kit/text-recognition` |

> ⚠️ Ces deux fonctions utilisent des **modules natifs absents d'Expo Go**. Il
> faut un **development build** (`npx expo run:android` ou un build EAS). Sans
> les modules, les écrans s'affichent mais indiquent que la fonction est
> indisponible, et l'app continue de fonctionner (scan serveur classique). Le
> code charge ces modules dynamiquement et retombe proprement sinon
> (`isLiveStreamAvailable()`, `isOnDeviceAvailable()`).

## Installation

```bash
cd apps/mobile
# Option 2 (diffusion)
npx expo install react-native-webrtc @config-plugins/react-native-webrtc
# Option 3 (embarqué)
npx expo install @react-native-ml-kit/text-recognition
```

`app.json` → ajouter les config plugins (permissions caméra/micro générées par le plugin webrtc) :

```json
{
  "expo": {
    "plugins": [
      "@config-plugins/react-native-webrtc",
      "@react-native-ml-kit/text-recognition"
    ]
  }
}
```

Puis un development build :

```bash
npx expo run:android          # build local (Android SDK requis)
# ou
eas build --profile development --platform android   # build cloud (eas.json déjà présent)
```

## Option 2 — Diffusion en direct (`/live`)

Enchaînement (le téléphone devient une source vidéo temps réel) :

1. L'app appelle `POST /cameras/:id/live/start` → le serveur prépare un chemin
   MediaMTX en ingestion **WHIP** et démarre le worker ML sur l'URL RTSP
   correspondante, puis renvoie l'`whipUrl`.
2. `lib/liveStream.ts` publie la caméra en WebRTC (WHIP) sur cette URL.
3. MediaMTX ré-expose le flux en RTSP ; `stream_worker.py` applique le pipeline
   complet (mouvement → suivi ByteTrack → plaque → **vote temporel**). Les
   captures reviennent via `POST /captures/stream`.
4. `POST /cameras/:id/live/stop` arrête le worker ML et libère le chemin.

Côté serveur, activer WebRTC/WHIP dans MediaMTX (fait dans `docker-compose.yml` :
`MTX_WEBRTC=yes`, port 8889) et configurer :

```
MEDIAMTX_WHIP_URL=http://<hôte-joignable-par-les-mobiles>:8889
MEDIAMTX_RTSP_URL=rtsp://mediamtx:8554
```

> Réalité de charge : plusieurs mobiles qui streament en continu vers un serveur
> **CPU** ne passeront pas à l'échelle en temps réel — prévoir un serveur GPU
> pour un usage soutenu (cf. discussion ONNX/TensorRT).

## Option 3 — Scan hors-ligne embarqué (`/offline-scan`)

1. `lib/onDeviceAlpr.ts` lit la plaque sur l'appareil via ML Kit (aucun réseau).
2. `lib/plate.ts` normalise le texte **exactement comme le serveur**
   (`[A-Z0-9]`, formats FR/génériques) pour des clés de plaque cohérentes.
3. `lib/offlineQueue.ts` stocke la capture dans AsyncStorage (persistant).
4. Au retour du réseau, « Synchroniser » rejoue la file vers `POST /captures/scan`
   (rapprochement véhicule/hotlist, alertes, audit restent côté serveur). Une
   capture n'est retirée de la file qu'après un envoi réussi, dans l'ordre
   chronologique.

Limite : ML Kit fait de l'OCR de texte générique — moins précis qu'un modèle
dédié plaques. Pour améliorer, on pourra ajouter un détecteur de plaque embarqué
(YOLO→TFLite/NCNN) en amont de l'OCR, sans changer l'interface `onDeviceAlpr`.

## Navigation

Les deux écrans sont des routes expo-router autonomes, atteignables via
`router.push('/live')` et `router.push('/offline-scan')` (par ex. depuis un
bouton de l'écran Capture ou de l'accueil).

## État de vérification

- **Modules `lib/` (logique)** : typecheck strict + tests runtime (normalisation,
  file hors-ligne, repli gracieux) — voir la validation dans l'historique de PR.
- **Écrans et glue serveur** : écrits selon les patterns du dépôt mais **non
  compilés dans l'environnement de CI** (pas de toolchain mobile/Nest ici). À
  vérifier sur un development build + appareil réel avant mise en production.
