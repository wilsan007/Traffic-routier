FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-ml.txt ./

# Détection de véhicules deep learning (ultralytics YOLO) optionnelle : par
# défaut désactivée (image légère, repli heuristique). Construire avec
#     docker build --build-arg ENABLE_VEHICLE_DL=1 ...
# pour installer ultralytics + torch CPU et pré-embarquer les poids YOLO.
ARG ENABLE_VEHICLE_DL=0
ARG VEHICLE_MODEL=yolo11n.pt

RUN pip install --no-cache-dir -r requirements.txt \
    && if [ "$ENABLE_VEHICLE_DL" = "1" ]; then \
         pip install --no-cache-dir -r requirements-ml.txt; \
       fi

# Pré-téléchargement des modèles ONNX (détecteur YOLOv9 plaques + OCR ViT)
# pour que le conteneur démarre sans dépendre du réseau.
RUN python -c "from fast_alpr import ALPR; ALPR(detector_model='yolo-v9-t-384-license-plate-end2end', ocr_model='global-plates-mobile-vit-v2-model')"

# Pré-téléchargement des poids YOLO véhicules quand le DL véhicule est activé,
# pour éviter tout accès réseau au premier flux. Non fatal si indisponible.
RUN if [ "$ENABLE_VEHICLE_DL" = "1" ]; then \
      python -c "from ultralytics import YOLO; YOLO('$VEHICLE_MODEL')" || \
      echo "Avertissement: poids YOLO véhicules non pré-téléchargés (réseau)"; \
    fi

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
