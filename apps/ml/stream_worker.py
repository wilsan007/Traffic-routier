"""Worker de traitement continu des flux vidéo (RTSP/HTTP/fichier).

Pipeline temps réel à trois étages (« gates ») pour chaque frame échantillonnée,
au lieu de lancer aveuglément l'OCR sur chaque image :

1. MOUVEMENT (motion_detector) : sur une caméra fixe, la route est vide la
   plupart du temps. On ignore les frames sans mouvement significatif → on ne
   dépense du CPU que quand quelque chose bouge.
2. VÉHICULE (vehicle_detector) : parmi ce qui bouge, on ne garde que ce qui
   ressemble à un véhicule (piéton, vélo, animal écartés) → moins de faux
   positifs OCR. On recadre sur le véhicule avant la lecture.
3. PLAQUE (dl_detector → plate_detector) : ALPR sur la région du véhicule.

Chaque lecture retenue est dédupliquée (cooldown par plaque) puis envoyée à
l'API TrafficGuard (clé de service) qui gère correspondances, hotlist, péages
et alertes.
"""
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass, field

import cv2
import requests

from motion_detector import MotionDetector

logger = logging.getLogger("stream_worker")

API_URL = os.environ.get("API_URL", "http://api:3001")
SERVICE_API_KEY = os.environ.get("SERVICE_API_KEY", "dev-service-key")
SAMPLE_INTERVAL = float(os.environ.get("STREAM_SAMPLE_INTERVAL", "2.0"))
PLATE_COOLDOWN = float(os.environ.get("STREAM_PLATE_COOLDOWN", "60.0"))
MIN_CONFIDENCE = float(os.environ.get("STREAM_MIN_CONFIDENCE", "0.5"))
# Marge (fraction) ajoutée autour de la boîte du véhicule avant l'ALPR : la
# détection de mouvement/véhicule peut rogner légèrement la plaque (pare-chocs,
# bord de la boîte), on élargit un peu le recadrage pour ne pas la couper.
VEHICLE_CROP_MARGIN = float(os.environ.get("STREAM_VEHICLE_CROP_MARGIN", "0.15"))
# Nombre max de flux traités en parallèle : empêche qu'un appelant (légitime
# ou non, cf. authentification sur /streams) n'épuise les ressources
# (threads, décodage vidéo) en démarrant un nombre illimité de flux.
MAX_CONCURRENT_STREAMS = int(os.environ.get("STREAM_MAX_CONCURRENT", "20"))


@dataclass
class StreamInfo:
    id: str
    url: str
    camera_id: str | None
    running: bool = True
    frames_processed: int = 0
    motion_events: int = 0
    vehicles_detected: int = 0
    plates_sent: int = 0
    last_error: str | None = None
    last_plate: str | None = None
    started_at: float = field(default_factory=time.time)


class StreamWorker(threading.Thread):
    def __init__(self, info: StreamInfo):
        super().__init__(daemon=True)
        self.info = info
        self._recent_plates: dict[str, float] = {}
        self._motion = MotionDetector()

    def stop(self):
        self.info.running = False

    def _should_send(self, plate: str) -> bool:
        """True si la plaque doit être envoyée (jamais vue ou cooldown expiré).

        Enregistre l'instant de l'envoi autorisé pour dédupliquer les lectures
        successives de la même plaque pendant PLATE_COOLDOWN secondes. En cas
        d'échec d'envoi, l'appelant annule l'enregistrement (voir run) pour
        pouvoir réessayer au prochain passage."""
        now = time.time()
        last = self._recent_plates.get(plate)
        if last is not None and now - last < PLATE_COOLDOWN:
            return False
        self._recent_plates[plate] = now
        return True

    def _crop_vehicle(self, frame, box):
        """Recadre la frame sur la boîte du véhicule, avec une marge, en
        restant dans les limites de l'image."""
        h, w = frame.shape[:2]
        mx = int(box.width * VEHICLE_CROP_MARGIN)
        my = int(box.height * VEHICLE_CROP_MARGIN)
        x1 = max(0, box.x - mx)
        y1 = max(0, box.y - my)
        x2 = min(w, box.x + box.width + mx)
        y2 = min(h, box.y + box.height + my)
        if x2 <= x1 or y2 <= y1:
            return frame
        return frame[y1:y2, x1:x2]

    def _read_plate(self, image_bgr):
        """ALPR sur une image BGR : deep learning d'abord, repli OpenCV +
        Tesseract. Retourne un DetectionResult ou None."""
        from dl_detector import detect_plate_dl
        from plate_detector import detect_plate

        result = detect_plate_dl(image_bgr)
        if result is None or not result.plate_text:
            ok, jpeg = cv2.imencode(".jpg", image_bgr)
            if ok:
                result = detect_plate(jpeg.tobytes())
        return result

    def _send_capture(self, frame, plate: str, confidence: float) -> bool:
        """Envoie une capture à l'API. Retourne True si l'envoi a réussi."""
        ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            return False
        data = {"plateText": plate, "confidence": str(confidence)}
        if self.info.camera_id:
            data["cameraId"] = self.info.camera_id
        try:
            response = requests.post(
                f"{API_URL}/captures/stream",
                headers={"x-api-key": SERVICE_API_KEY},
                data=data,
                files={"image": ("frame.jpg", jpeg.tobytes(), "image/jpeg")},
                timeout=15,
            )
            response.raise_for_status()
            self.info.plates_sent += 1
            self.info.last_plate = plate
            logger.info("Flux %s : plaque %s (%.0f%%) envoyée", self.info.id, plate, confidence * 100)
            return True
        except Exception as exc:  # noqa: BLE001
            self.info.last_error = f"envoi API: {exc}"
            logger.warning("Flux %s : échec envoi API (%s)", self.info.id, exc)
            return False

    def _process_frame(self, frame):
        """Applique le pipeline mouvement → véhicule → plaque à une frame et
        envoie les plaques retenues. Isolé pour être testable unitairement."""
        import vehicle_detector

        # 1. Mouvement : rien ne bouge → on n'analyse pas.
        motion_regions = self._motion.detect(frame)
        if not motion_regions:
            return
        self.info.motion_events += 1

        # 2. Véhicule : on ne garde que ce qui ressemble à un véhicule.
        vehicles = vehicle_detector.classify(frame, motion_regions)
        if not vehicles:
            return
        self.info.vehicles_detected += 1

        # 3. Plaque : ALPR sur chaque véhicule (recadré), dédup + envoi.
        for box in vehicles:
            crop = self._crop_vehicle(frame, box)
            result = self._read_plate(crop)
            if (
                result
                and result.plate_text
                and result.confidence >= MIN_CONFIDENCE
                and self._should_send(result.plate_text)
            ):
                # On envoie la frame complète (contexte utile côté opérateur),
                # pas seulement le recadrage.
                if not self._send_capture(frame, result.plate_text, result.confidence):
                    # Échec transitoire : on annule le cooldown pour réessayer
                    # au prochain passage plutôt que de taire la plaque.
                    self._recent_plates.pop(result.plate_text, None)

    def run(self):
        logger.info("Démarrage du flux %s (%s)", self.info.id, self.info.url)
        while self.info.running:
            capture = cv2.VideoCapture(self.info.url)
            if not capture.isOpened():
                self.info.last_error = "flux injoignable"
                logger.warning("Flux %s injoignable, nouvel essai dans 10 s", self.info.id)
                time.sleep(10)
                continue

            last_analysis = 0.0
            while self.info.running:
                grabbed, frame = capture.read()
                if not grabbed:
                    self.info.last_error = "fin de flux / frame illisible"
                    break

                now = time.time()
                if now - last_analysis < SAMPLE_INTERVAL:
                    continue
                last_analysis = now
                self.info.frames_processed += 1

                self._process_frame(frame)

            capture.release()
            if self.info.running:
                time.sleep(5)  # coupure : on retente
        logger.info("Flux %s arrêté", self.info.id)


class StreamManager:
    def __init__(self):
        self._workers: dict[str, StreamWorker] = {}
        self._lock = threading.Lock()

    def start(self, url: str, camera_id: str | None) -> StreamInfo:
        with self._lock:
            if len(self._workers) >= MAX_CONCURRENT_STREAMS:
                raise ValueError(
                    f"Nombre maximum de flux simultanés atteint ({MAX_CONCURRENT_STREAMS})"
                )
        stream_id = uuid.uuid4().hex[:8]
        info = StreamInfo(id=stream_id, url=url, camera_id=camera_id)
        worker = StreamWorker(info)
        with self._lock:
            self._workers[stream_id] = worker
        worker.start()
        return info

    def stop(self, stream_id: str) -> bool:
        with self._lock:
            worker = self._workers.pop(stream_id, None)
        if worker is None:
            return False
        worker.stop()
        return True

    def list(self) -> list[StreamInfo]:
        with self._lock:
            return [w.info for w in self._workers.values()]


manager = StreamManager()
