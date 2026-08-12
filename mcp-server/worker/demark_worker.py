#!/usr/bin/env python3
"""Process a Photarium demarking batch through the local noai-watermark API."""

from __future__ import annotations

import contextlib
import json
import os
import sys
from pathlib import Path
from typing import Any


def _error_message(error: BaseException) -> str:
    return str(error) or error.__class__.__name__


def _dimensions(path: Path) -> tuple[int, int]:
    from PIL import Image

    with Image.open(path) as image:
        width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError(f"Invalid output dimensions: {width}x{height}")
    return width, height


def _load_noai(root: Path) -> dict[str, Any]:
    source_path = root / "src"
    if not source_path.is_dir():
        raise FileNotFoundError(f"noai-watermark source directory not found: {source_path}")
    sys.path.insert(0, str(source_path))

    from __init__ import __version__
    from cleaner import remove_ai_metadata
    from extractor import has_ai_metadata
    from watermark_profiles import get_model_id_for_profile
    from watermark_remover import WatermarkRemover

    return {
        "version": __version__,
        "remove_ai_metadata": remove_ai_metadata,
        "has_ai_metadata": has_ai_metadata,
        "get_model_id_for_profile": get_model_id_for_profile,
        "WatermarkRemover": WatermarkRemover,
    }


def _failure(item: dict[str, Any], stage: str, error: BaseException) -> dict[str, Any]:
    return {
        "imageId": item["imageId"],
        "ok": False,
        "stage": stage,
        "error": _error_message(error),
    }


def process(payload: dict[str, Any]) -> dict[str, Any]:
    root_value = os.environ.get("PHOTARIUM_NOAI_WATERMARK_ROOT", "").strip()
    if not root_value:
        raise RuntimeError("PHOTARIUM_NOAI_WATERMARK_ROOT is required")
    root = Path(root_value).expanduser().resolve()
    settings = payload["settings"]
    items = payload["items"]
    api = _load_noai(root)

    remover = None
    if settings["mode"] == "demark":
        model_id = api["get_model_id_for_profile"](settings["modelProfile"])
        remover = api["WatermarkRemover"](
            model_id=model_id,
            device=settings["device"],
        )

    results: list[dict[str, Any]] = []
    for item in items:
        source_path = Path(item["sourcePath"])
        output_path = Path(item["outputPath"])
        try:
            if settings["mode"] == "demark":
                assert remover is not None
                remover.remove_watermark(
                    image_path=source_path,
                    output_path=output_path,
                    strength=settings["strength"],
                    num_inference_steps=settings["steps"],
                )
            else:
                api["remove_ai_metadata"](
                    source_path=source_path,
                    output_path=output_path,
                    keep_standard=not settings["removeAllMetadata"],
                )

            if settings["mode"] == "demark" and settings["removeAllMetadata"]:
                api["remove_ai_metadata"](
                    source_path=output_path,
                    output_path=output_path,
                    keep_standard=False,
                )

            width, height = _dimensions(output_path)
            ai_metadata_present = bool(api["has_ai_metadata"](output_path))
            if ai_metadata_present:
                raise RuntimeError("AI metadata remains in the output")
            results.append(
                {
                    "imageId": item["imageId"],
                    "ok": True,
                    "width": width,
                    "height": height,
                    "aiMetadataPresent": False,
                }
            )
        except Exception as error:  # per-item continuation is part of the MCP contract
            results.append(_failure(item, "process", error))

    return {
        "ok": all(item["ok"] for item in results),
        "version": api["version"],
        "items": results,
    }


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        if not isinstance(payload, dict):
            raise ValueError("Worker payload must be a JSON object")
        with contextlib.redirect_stdout(sys.stderr):
            response = process(payload)
        print(json.dumps(response), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": _error_message(error), "items": []}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
