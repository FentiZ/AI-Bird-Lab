"""Необов'язково: завантажити 15 фото з Wikipedia для шкільного тесту."""
import csv
import json
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent
DEST = ROOT.parent / "samples"


def get_thumbnail(pages):
    page = next(iter(pages.values()))
    link = page.get("thumbnail", {}).get("source")
    if not link:
        raise ValueError("На сторінці немає фотографії")
    return link


def save_jpeg(data, path):
    if len(data) > 10 * 1024 * 1024:
        raise ValueError("Фотографія завелика")
    with Image.open(BytesIO(data)) as image:
        image.load()
        image.convert("RGB").save(path, format="JPEG", quality=85)


def main():
    DEST.mkdir(exist_ok=True)
    birds = json.loads((ROOT.parent / "server" / "birds.json").read_text(encoding="utf-8"))
    sources = []
    session = requests.Session()
    session.headers["User-Agent"] = "AI-Bird-Lab/1.0 (educational school project)"
    for index, bird in enumerate(birds, start=1):
        title = bird["english_name"]
        try:
            response = session.get("https://en.wikipedia.org/w/api.php", params={
                "action": "query", "format": "json", "redirects": "1",
                "prop": "pageimages", "pithumbsize": "900", "titles": title,
            }, timeout=20)
            response.raise_for_status()
            picture_url = get_thumbnail(response.json()["query"]["pages"])
            photo_response = session.get(picture_url, timeout=25)
            photo_response.raise_for_status()
            filename = f"{index:02d}_{title.replace(' ', '_')}.jpg"
            save_jpeg(photo_response.content, DEST / filename)
            sources.append({"filename": filename, "species": title,
                            "source": bird["source_url"], "photo_url": picture_url})
            print(f"OK {index:02d}/15: {title}")
        except (requests.RequestException, ValueError, OSError, KeyError, StopIteration) as exc:
            print(f"ПОМИЛКА {index:02d}/15: {title}: {exc}")

    with (DEST / "sources.csv").open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, ["filename", "species", "source", "photo_url"])
        writer.writeheader()
        writer.writerows(sources)

    print(f"Готово: {len(sources)}/15 фото. Відкрийте застосунок і завантажте їх через форму.")
    if len(sources) < 15:
        print("Якщо фото не завантажились, додайте відсутні з власних джерел і перевірте ліцензії.")


if __name__ == "__main__":
    main()
