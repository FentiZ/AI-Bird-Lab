"""Two-stage Hugging Face AI: is this a bird, then which species?"""
from io import BytesIO
import re
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI(title="AI Bird Lab / AI Worker")
MODEL_NAME = "dima806/bird_species_image_detection"
BIRD_MODEL_NAME = "openai/clip-vit-base-patch32"
MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_PIXELS = 25_000_000
BIRD_THRESHOLD = 0.30

# CLIP scores compare THESE labels. They are not calibrated probabilities.
LABELS = [
    "a bird", "a cat", "a dog", "a person", "a fish", "an insect",
    "a reptile", "a mammal", "a flower", "a tree", "a landscape",
    "a building", "a vehicle", "food", "a toy", "a drawing or painting",
]
classifier = None
bird_detector = None


def get_classifier():
    global classifier
    if classifier is None:
        from transformers import pipeline
        classifier = pipeline("image-classification", model=MODEL_NAME, device=-1)
    return classifier


def get_bird_detector():
    global bird_detector
    if bird_detector is None:
        from transformers import pipeline
        bird_detector = pipeline("zero-shot-image-classification", model=BIRD_MODEL_NAME, device=-1)
    return bird_detector


def clean_name(name):
    value = re.sub(r"^\s*\d+[.\-_ ]+", "", str(name))
    return " ".join(value.replace("_", " ").split()).title()


def read_photo(data):
    if not data or len(data) > MAX_FILE_SIZE:
        raise ValueError("Розмір фото має бути від 1 байта до 10 МБ")
    try:
        with Image.open(BytesIO(data)) as test:
            if test.format not in ("JPEG", "PNG"):
                raise ValueError("Дозволені лише фотографії JPG, JPEG або PNG")
            test.verify()
        with Image.open(BytesIO(data)) as img:
            if img.width * img.height > MAX_PIXELS:
                raise ValueError("Занадто великі розміри фото")
            if getattr(img, "n_frames", 1) != 1:
                raise ValueError("Анімовані зображення не підтримуються")
            img.load()
            return ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise ValueError("Пошкоджене або непідтримуване фото") from e


def detect_bird(photo):
    results = get_bird_detector()(photo, candidate_labels=LABELS)
    if not results:
        raise RuntimeError("The bird detection model returned no result")
    ranked = sorted(results, key=lambda item: float(item["score"]), reverse=True)
    bird = next((item for item in ranked if item["label"] == "a bird"), None)
    if bird is None:
        raise RuntimeError("Bird label is missing from model output")
    score = float(bird["score"])
    return ranked[0]["label"] == "a bird" and score >= BIRD_THRESHOLD, round(score * 100, 2)


def predict_bytes(data):
    photo = read_photo(data)
    is_bird, bird_score = detect_bird(photo)
    if not is_bird:
        return {
            "isBird": False, "birdConfidence": bird_score,
            "predictedSpecies": "", "confidence": 0, "top3": [],
            "message": "На фото не виявлено птаха. Завантажте фотографію птаха.",
        }
    results = get_classifier()(photo, top_k=3)
    if not results:
        raise RuntimeError("The species classification model returned no results")
    top3 = [{"species": clean_name(x["label"]), "confidence": round(float(x["score"]) * 100, 2)}
            for x in results[:3]]
    return {
        "isBird": True, "birdConfidence": bird_score,
        "predictedSpecies": top3[0]["species"], "confidence": top3[0]["confidence"],
        "top3": top3,
    }


@app.get('/health')
def health():
    return {"status": "ok", "speciesModel": MODEL_NAME, "birdModel": BIRD_MODEL_NAME}


@app.post('/predict')
async def predict(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(('.png', '.jpg', '.jpeg')):
        raise HTTPException(400, 'Дозволені лише JPG, JPEG та PNG')
    if file.content_type and file.content_type not in ("image/jpeg", "image/png", "application/octet-stream"):
        raise HTTPException(400, "Можна завантажувати лише фото JPG, JPEG або PNG")
    data = await file.read(MAX_FILE_SIZE + 1)
    suffix = file.filename.lower().rsplit(".", 1)[-1]
    detected_format = "image/jpeg" if data[:3] == b"\xff\xd8\xff" else (
        "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else None)
    expected_format = "image/png" if suffix == "png" else "image/jpeg"
    if detected_format != expected_format or (
        file.content_type in ("image/jpeg", "image/png") and file.content_type != detected_format
    ):
        raise HTTPException(400, "Розширення або тип файлу не відповідає формату фото")
    try:
        return predict_bytes(data)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except Exception as error:
        raise HTTPException(503, 'AI unavailable') from error
