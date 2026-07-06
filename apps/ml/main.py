import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel
from typing import Optional

from plate_detector import detect_plate
from dl_detector import detect_plate_dl, dl_available
from stream_worker import manager as stream_manager

app = FastAPI(
    title="TrafficGuard ML Service",
    description="Service de détection et de lecture de plaques d'immatriculation (ALPR).",
    version="0.2.0",
)


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
    plates_sent: int
    last_plate: Optional[str]
    last_error: Optional[str]


@app.get("/health")
def health():
    return {
        "status": "ok",
        "deep_learning": dl_available(),
        "active_streams": len(stream_manager.list()),
    }


# --- Traitement continu de flux vidéo (RTSP/HTTP/fichier) ---

@app.post("/streams", response_model=StreamStatus)
def start_stream(request: StartStreamRequest):
    info = stream_manager.start(request.url, request.camera_id)
    return StreamStatus(**info.__dict__)


@app.get("/streams", response_model=list[StreamStatus])
def list_streams():
    return [StreamStatus(**i.__dict__) for i in stream_manager.list()]


@app.delete("/streams/{stream_id}")
def stop_stream(stream_id: str):
    if not stream_manager.stop(stream_id):
        raise HTTPException(status_code=404, detail="Flux introuvable")
    return {"stopped": stream_id}


@app.post("/detect", response_model=DetectionResponse)
async def detect(image: UploadFile = File(...)):
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Le fichier fourni doit être une image.")

    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Image vide.")

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
