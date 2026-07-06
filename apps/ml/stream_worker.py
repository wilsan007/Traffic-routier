"""Worker de traitement continu des flux vidéo (RTSP/HTTP/fichier).

Pour chaque flux enregistré :
- lit les frames en continu (cv2.VideoCapture),
- analyse une frame toutes les SAMPLE_INTERVAL secondes via le pipeline ALPR,
- déduplique (une même plaque n'est pas renvoyée pendant COOLDOWN secondes),
- envoie chaque lecture à l'API TrafficGuard (clé de service) qui gère
  correspondances, hotlist, péages et alertes.
"""
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass, field

import cv2
import requests

logger = logging.getLogger("stream_worker")

API_URL = os.environ.get("API_URL", "http://api:3001")
SERVICE_API_KEY = os.environ.get("SERVICE_API_KEY", "dev-service-key")
SAMPLE_INTERVAL = float(os.environ.get("STREAM_SAMPLE_INTERVAL", "2.0"))
PLATE_COOLDOWN = float(os.environ.get("STREAM_PLATE_COOLDOWN", "60.0"))
MIN_CONFIDENCE = float(os.environ.get("STREAM_MIN_CONFIDENCE", "0.5"))


@dataclass
class StreamInfo:
    id: str
    url: str
    camera_id: str | None
    running: bool = True
    frames_processed: int = 0
    plates_sent: int = 0
    last_error: str | None = None
    last_plate: str | None = None
    started_at: float = field(default_factory=time.time)


class StreamWorker(threading.Thread):
    def __init__(self, info: StreamInfo):
        super().__init__(daemon=True)
        self.info = info
        self._recent_plates: dict[str, float] = {}

    def stop(self):
        self.info.running = False

    def _should_send(self, plate: str) -> bool:
        last = self._recent_plates.get(plate)
        now = time.time()
        if last is not None and now - last < PLATE_COOLDOWN:
            return False
        self._recent_plates[plate] = now
        return True

    def _send_capture(self, frame, plate: str, confidence: float):
        ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            return
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
        except Exception as exc:  # noqa: BLE001
            self.info.last_error = f"envoi API: {exc}"
            logger.warning("Flux %s : échec envoi API (%s)", self.info.id, exc)

    def run(self):
        from dl_detector import detect_plate_dl
        from plate_detector import detect_plate

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

                result = detect_plate_dl(frame)
                if result is None or not result.plate_text:
                    ok, jpeg = cv2.imencode(".jpg", frame)
                    if ok:
                        result = detect_plate(jpeg.tobytes())
                if (
                    result
                    and result.plate_text
                    and result.confidence >= MIN_CONFIDENCE
                    and self._should_send(result.plate_text)
                ):
                    self._send_capture(frame, result.plate_text, result.confidence)

            capture.release()
            if self.info.running:
                time.sleep(5)  # coupure : on retente
        logger.info("Flux %s arrêté", self.info.id)


class StreamManager:
    def __init__(self):
        self._workers: dict[str, StreamWorker] = {}
        self._lock = threading.Lock()

    def start(self, url: str, camera_id: str | None) -> StreamInfo:
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
