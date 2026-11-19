"""Lightweight tests without downloading a model."""
from io import BytesIO
from fastapi.testclient import TestClient
from PIL import Image
import main

client = TestClient(main.app)


def make_image():
    buffer = BytesIO()
    Image.new("RGB", (12, 12), "blue").save(buffer, format="JPEG")
    return buffer.getvalue()


def test_health():
    assert client.get("/health").status_code == 200


def test_reject_bad_image():
    result = client.post("/predict", files={"file": ("bad.jpg", b"not an image", "image/jpeg")})
    assert result.status_code == 400


def test_predict(monkeypatch):
    class FakeModel:
        def __call__(self, image, top_k):
            assert image.mode == "RGB"
            assert top_k == 3
            return [
                {"label": "001.European_Robin", "score": 0.9},
                {"label": "House Sparrow", "score": 0.08},
                {"label": "Barn Owl", "score": 0.02},
            ]

    monkeypatch.setattr(main, "get_bird_detector", lambda: lambda photo, candidate_labels: [
        {"label": "a bird", "score": 0.92}, {"label": "a cat", "score": 0.08}
    ])
    monkeypatch.setattr(main, "get_classifier", lambda: FakeModel())
    result = client.post("/predict", files={"file": ("photo.JPG", make_image(), "image/jpeg")})
    assert result.status_code == 200
    assert result.json()["predictedSpecies"] == "European Robin"
    assert len(result.json()["top3"]) == 3
    assert result.json()["isBird"] is True
