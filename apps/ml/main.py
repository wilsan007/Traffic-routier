import hmac
import os

import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel
from typing import Optional

from plate_detector import detect_plate
from dl_detector import detect_plate_dl, dl_available
from vehicle_detector import ml_available as vehicle_ml_available
from stream_worker import manager as stream_manager

app = FastAPI(
    title="TrafficGuard ML Service",
    description="Service de détection et de lecture de plaques d'immatriculation (ALPR).",
    version="0.2.0",
)

# Ce service n'est censé être joignable que depuis le réseau interne Docker
# (appelé par l'API NestJS et par son propre worker de flux). Il n'a
# historiquement aucune authentification : si le port 8000 est jamais exposé
# par erreur (mauvaise configuration réseau/orchestrateur), n'importe qui
# pourrait lancer des flux vidéo arbitraires (cv2.VideoCapture sur une URL
# fournie par l'appelant → risque de type SSRF / épuisement de ressources) ou
# consommer le pipeline de détection gratuitement. On exige donc la même clé
# de service (x-api-key) que celle utilisée côté API pour les endpoints
# sensibles, en défense en profondeur.
SERVICE_API_KEY = os.environ.get("SERVICE_API_KEY", "dev-service-key")
MAX_IMAGE_SIZE_BYTES = int(os.environ.get("MAX_IMAGE_SIZE_BYTES", str(10 * 1024 * 1024)))


def verify_api_key(x_api_key: Optional[str] = Header(default=None)):
    if not x_api_key or not hmac.compare_digest(x_api_key, SERVICE_API_KEY):
        raise HTTPException(status_code=401, detail="Clé de service invalide")
    return True


class BoundingBoxOut(BaseModel):
    x: int
    y: int
    width: int
    height: int


class DetectionResponse(BaseModel):
    plate_text: str
    confidence: float
    bounding_box: Optional[BoundingBoxOut] = None
    engine: str = "classic"


class StartStreamRequest(BaseModel):
    url: str
    camera_id: Optional[str] = None


class StreamStatus(BaseModel):
    id: str
    url: str
    camera_id: Optional[str]
    running: bool
    frames_processed: int
    motion_events: int
    vehicles_detected: int
    active_tracks: int
    plates_sent: int
    tracking: bool
    last_plate: Optional[str]
    last_error: Optional[str]


@app.get("/health")
def health():
    return {
        "status": "ok",
        "deep_learning": dl_available(),
        "vehicle_deep_learning": vehicle_ml_available(),
        "active_streams": len(stream_manager.list()),
    }


# --- Traitement continu de flux vidéo (RTSP/HTTP/fichier) ---

@app.post("/streams", response_model=StreamStatus, dependencies=[Depends(verify_api_key)])
def start_stream(request: StartStreamRequest):
    try:
        info = stream_manager.start(request.url, request.camera_id)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    return StreamStatus(**info.__dict__)


@app.get("/streams", response_model=list[StreamStatus], dependencies=[Depends(verify_api_key)])
def list_streams():
    return [StreamStatus(**i.__dict__) for i in stream_manager.list()]


@app.delete("/streams/{stream_id}", dependencies=[Depends(verify_api_key)])
def stop_stream(stream_id: str):
    if not stream_manager.stop(stream_id):
        raise HTTPException(status_code=404, detail="Flux introuvable")
    return {"stopped": stream_id}


@app.post("/detect", response_model=DetectionResponse, dependencies=[Depends(verify_api_key)])
async def detect(image: UploadFile = File(...)):
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Le fichier fourni doit être une image.")

    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Image vide.")
    if len(contents) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Image trop volumineuse.")

    np_array = np.frombuffer(contents, dtype=np.uint8)
    image_bgr = cv2.imdecode(np_array, cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise HTTPException(status_code=400, detail="Image illisible.")

    # Pipeline deep learning d'abord (YOLOv9 + OCR ViT entraînés sur plaques),
    # repli sur le pipeline classique OpenCV + Tesseract sinon.
    result = detect_plate_dl(image_bgr)
    engine = "deep_learning"
    if result is None or not result.plate_text:
        result = detect_plate(contents)
        engine = "classic"

    return DetectionResponse(
        plate_text=result.plate_text,
        confidence=result.confidence,
        bounding_box=BoundingBoxOut(**result.bounding_box.__dict__) if result.bounding_box else None,
        engine=engine,
    )
