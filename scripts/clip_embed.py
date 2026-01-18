#!/usr/bin/env python3
import base64
import json
import sys
from io import BytesIO

from PIL import Image
from sentence_transformers import SentenceTransformer

MODEL_NAME = "clip-ViT-B-32"


def load_model():
    return SentenceTransformer(MODEL_NAME)


def encode_image(model, image_base64: str):
    image_bytes = base64.b64decode(image_base64)
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    image = image.resize((224, 224))
    embedding = model.encode(image)
    if hasattr(embedding, "tolist"):
        return embedding.tolist()
    return embedding


def encode_text(model, text: str):
    embedding = model.encode([text])
    if hasattr(embedding, "tolist"):
        embedding = embedding.tolist()
    if isinstance(embedding, list) and len(embedding) > 0 and isinstance(embedding[0], list):
        return embedding[0]
    return embedding


def main():
    try:
        payload = json.load(sys.stdin)
        mode = payload.get("mode")
        if not mode:
            raise ValueError("Missing mode")

        model = load_model()

        if mode == "image":
            image_base64 = payload.get("imageBase64")
            if not image_base64:
                raise ValueError("Missing imageBase64")
            output = encode_image(model, image_base64)
        elif mode == "text":
            text = payload.get("text", "")
            output = encode_text(model, text)
        else:
            raise ValueError(f"Unsupported mode: {mode}")

        json.dump(output, sys.stdout)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
