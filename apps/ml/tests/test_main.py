"""Tests pour main.py (endpoints FastAPI) via TestClient.

detect_plate_dl / detect_plate / stream_manager sont mockes : aucun modele
reel ni aucune vraie connexion video n'est necessaire.
"""
import io

import pytest
from fastapi.testclient import TestClient

import main
from plate_detector import BoundingBox, DetectionResult
from stream_worker import StreamInfo

client = TestClient(main.app)

AUTH_HEADERS = {"x-api-key": "dev-service-key"}  # valeur par defaut de SERVICE_API_KEY


def _png_bytes():
    import cv2
    import numpy as np

    image = np.full((100, 200, 3), 255, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", image)
    assert ok
    return buf.tobytes()


# --------------------------------------------------------------------------
# /health
# --------------------------------------------------------------------------

class TestHealth:
    def test_health_ok_no_auth_required(self, mocker):
        mocker.patch.object(main, "dl_available", return_value=True)
        mocker.patch.object(main.stream_manager, "list", return_value=[])
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["deep_learning"] is True
        assert body["active_streams"] == 0

    def test_health_reports_active_stream_count(self, mocker):
        mocker.patch.object(main, "dl_available", return_value=False)
        fake_info = StreamInfo(id="s1", url="u", camera_id=None)
        mocker.patch.object(main.stream_manager, "list", return_value=[fake_info])
        resp = client.get("/health")
        assert resp.json()["active_streams"] == 1
        assert resp.json()["deep_learning"] is False


# --------------------------------------------------------------------------
# /detect
# --------------------------------------------------------------------------

class TestDetect:
    def test_requires_api_key(self):
        resp = client.post(
            "/detect", files={"image": ("plate.png", _png_bytes(), "image/png")}
        )
        assert resp.status_code == 401

    def test_rejects_wrong_api_key(self):
        resp = client.post(
            "/detect",
            files={"image": ("plate.png", _png_bytes(), "image/png")},
            headers={"x-api-key": "wrong-key"},
        )
        assert resp.status_code == 401

    def test_uses_deep_learning_result_when_available(self, mocker):
        dl_result = DetectionResult(
            plate_text="AB123CD",
            confidence=0.9,
            bounding_box=BoundingBox(x=1, y=2, width=3, height=4),
        )
        mocker.patch.object(main, "detect_plate_dl", return_value=dl_result)
        classic_mock = mocker.patch.object(main, "detect_plate")

        resp = client.post(
            "/detect",
            files={"image": ("plate.png", _png_bytes(), "image/png")},
            headers=AUTH_HEADERS,
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["plate_text"] == "AB123CD"
        assert body["confidence"] == 0.9
        assert body["engine"] == "deep_learning"
        assert body["bounding_box"] == {"x": 1, "y": 2, "width": 3, "height": 4}
        classic_mock.assert_not_called()

    def test_falls_back_to_classic_when_dl_returns_none(self, mocker):
        mocker.patch.object(main, "detect_plate_dl", return_value=None)
        classic_result = DetectionResult(plate_text="XY999ZZ", confidence=0.6, bounding_box=None)
        mocker.patch.object(main, "detect_plate", return_value=classic_result)

        resp = client.post(
            "/detect",
            files={"image": ("plate.png", _png_bytes(), "image/png")},
            headers=AUTH_HEADERS,
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["plate_text"] == "XY999ZZ"
        assert body["engine"] == "classic"
        assert body["bounding_box"] is None

    def test_falls_back_to_classic_when_dl_plate_text_empty(self, mocker):
        empty_dl_result = DetectionResult(plate_text="", confidence=0.0, bounding_box=None)
        mocker.patch.object(main, "detect_plate_dl", return_value=empty_dl_result)
        classic_result = DetectionResult(plate_text="ZZ111AA", confidence=0.4, bounding_box=None)
        mocker.patch.object(main, "detect_plate", return_value=classic_result)

        resp = client.post(
            "/detect",
            files={"image": ("plate.png", _png_bytes(), "image/png")},
            headers=AUTH_HEADERS,
        )
        assert resp.json()["engine"] == "classic"
        assert resp.json()["plate_text"] == "ZZ111AA"

    def test_rejects_non_image_content_type(self, mocker):
        mocker.patch.object(main, "detect_plate_dl", return_value=None)
        mocker.patch.object(main, "detect_plate")
        resp = client.post(
            "/detect",
            files={"image": ("plate.txt", b"hello world", "text/plain")},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 400

    def test_rejects_empty_file(self, mocker):
        mocker.patch.object(main, "detect_plate_dl", return_value=None)
        mocker.patch.object(main, "detect_plate")
        resp = client.post(
            "/detect",
            files={"image": ("plate.png", b"", "image/png")},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 400

    def test_rejects_unreadable_image(self, mocker):
        mocker.patch.object(main, "detect_plate_dl", return_value=None)
        mocker.patch.object(main, "detect_plate")
        resp = client.post(
            "/detect",
            files={"image": ("plate.png", b"not really a png", "image/png")},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 400

    def test_rejects_oversized_image(self, mocker):
        mocker.patch.object(main, "detect_plate_dl", return_value=None)
        mocker.patch.object(main, "detect_plate")
        mocker.patch.object(main, "MAX_IMAGE_SIZE_BYTES", 10)
        resp = client.post(
            "/detect",
            files={"image": ("plate.png", _png_bytes(), "image/png")},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 413


# --------------------------------------------------------------------------
# /streams
# --------------------------------------------------------------------------

class TestStreams:
    def test_start_stream_requires_auth(self):
        resp = client.post("/streams", json={"url": "rtsp://example/cam"})
        assert resp.status_code == 401

    def test_start_stream_returns_status(self, mocker):
        fake_info = StreamInfo(id="abcd1234", url="rtsp://example/cam", camera_id="cam-1")
        mocker.patch.object(main.stream_manager, "start", return_value=fake_info)

        resp = client.post(
            "/streams",
            json={"url": "rtsp://example/cam", "camera_id": "cam-1"},
            headers=AUTH_HEADERS,
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "abcd1234"
        assert body["url"] == "rtsp://example/cam"
        assert body["camera_id"] == "cam-1"
        assert body["running"] is True

    def test_start_stream_returns_429_when_at_capacity(self, mocker):
        mocker.patch.object(
            main.stream_manager, "start", side_effect=ValueError("Nombre maximum de flux simultanés atteint (20)")
        )
        resp = client.post(
            "/streams",
            json={"url": "rtsp://example/cam"},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 429

    def test_list_streams_requires_auth(self):
        resp = client.get("/streams")
        assert resp.status_code == 401

    def test_list_streams_returns_all(self, mocker):
        fake_infos = [
            StreamInfo(id="a1", url="u1", camera_id=None),
            StreamInfo(id="a2", url="u2", camera_id="cam-2"),
        ]
        mocker.patch.object(main.stream_manager, "list", return_value=fake_infos)

        resp = client.get("/streams", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        ids = [item["id"] for item in resp.json()]
        assert ids == ["a1", "a2"]

    def test_stop_stream_requires_auth(self):
        resp = client.delete("/streams/abc")
        assert resp.status_code == 401

    def test_stop_stream_success(self, mocker):
        mocker.patch.object(main.stream_manager, "stop", return_value=True)
        resp = client.delete("/streams/abc", headers=AUTH_HEADERS)
        assert resp.status_code == 200
        assert resp.json() == {"stopped": "abc"}

    def test_stop_stream_not_found(self, mocker):
        mocker.patch.object(main.stream_manager, "stop", return_value=False)
        resp = client.delete("/streams/does-not-exist", headers=AUTH_HEADERS)
        assert resp.status_code == 404
