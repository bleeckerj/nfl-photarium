#!/usr/bin/env python3
"""Extend a completed Sora video through the official OpenAI SDK.

The extension endpoint inherits the source video's resolution. Use the existing
Sora creation workflow to choose the initial output size; this command can only
assert that size with --expected-size.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from openai import OpenAI
from openai.types.video import Video


SUPPORTED_SECONDS = ("4", "8", "12")
TERMINAL_STATUSES = {"completed", "failed"}
SUPPORTED_SIZES = {"720x1280", "1280x720", "1024x1792", "1792x1024"}


def build_extension_payload(video_id: str, prompt: str, seconds: str) -> dict[str, Any]:
    """Build the API request without adding size fields the endpoint ignores."""

    return {
        "prompt": prompt,
        "seconds": seconds,
        "video": {"id": video_id},
    }


def read_prompt(prompt: str | None, prompt_file: str | None) -> str:
    if bool(prompt) == bool(prompt_file):
        raise ValueError("Provide exactly one of --prompt or --prompt-file.")

    value = prompt if prompt is not None else Path(prompt_file).read_text(encoding="utf-8")
    value = value.strip()
    if not value:
        raise ValueError("The extension prompt cannot be empty.")
    return value


def as_dict(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: as_dict(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [as_dict(item) for item in value]
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return value


def write_json(path: Path | None, value: Any) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(as_dict(value), indent=2, sort_keys=True) + "\n", encoding="utf-8")


def require_api_key() -> None:
    if not os.environ.get("OPENAI_API_KEY"):
        raise ValueError("OPENAI_API_KEY is not set in this shell environment.")


def create_extension(client: OpenAI, payload: dict[str, Any]) -> Video:
    """Use the SDK transport while targeting the extension endpoint absent in SDK 2.7.2."""

    return client.post("/videos/extensions", cast_to=Video, body=payload)


def poll_extension(client: OpenAI, video_id: str, interval: float, timeout: float | None) -> Video:
    started = time.monotonic()
    last_status: str | None = None

    while True:
        video = client.videos.retrieve(video_id)
        status = video.status or "unknown"
        if status != last_status:
            print(f"Status: {status}", file=sys.stderr)
            last_status = status
        if status in TERMINAL_STATUSES:
            return video
        if timeout is not None and time.monotonic() - started > timeout:
            raise TimeoutError(f"Timed out after {timeout:.1f}s waiting for {video_id}")
        time.sleep(interval)


def download_video(client: OpenAI, video_id: str, output: Path, force: bool) -> None:
    if output.exists() and not force:
        raise FileExistsError(f"Output exists: {output} (use --force to overwrite)")
    output.parent.mkdir(parents=True, exist_ok=True)
    content = client.videos.download_content(video_id, variant="video")
    if hasattr(content, "write_to_file"):
        content.write_to_file(output)
    else:
        data = content.read() if hasattr(content, "read") else content
        output.write_bytes(bytes(data))
    print(f"Wrote {output}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", required=True, help="Completed source video ID")
    prompt = parser.add_mutually_exclusive_group(required=True)
    prompt.add_argument("--prompt", help="Continuation instructions")
    prompt.add_argument("--prompt-file", help="UTF-8 file containing continuation instructions")
    parser.add_argument(
        "--seconds",
        choices=SUPPORTED_SECONDS,
        default="12",
        help="New extension segment length; 12 seconds gives roughly 24 seconds total here",
    )
    parser.add_argument(
        "--expected-size",
        choices=sorted(SUPPORTED_SIZES),
        help="Assert the source size; extensions inherit it and cannot change aspect ratio",
    )
    parser.add_argument("--out", type=Path, help="Output MP4 path")
    parser.add_argument("--json-out", type=Path, help="Write request and final job metadata")
    parser.add_argument("--poll-interval", type=float, default=10.0, help="Status poll interval in seconds")
    parser.add_argument("--timeout", type=float, help="Maximum poll time in seconds")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing MP4")
    parser.add_argument("--dry-run", action="store_true", help="Print the request without calling the API")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    prompt = read_prompt(args.prompt, args.prompt_file)
    payload = build_extension_payload(args.id, prompt, args.seconds)

    if args.dry_run:
        request = {"endpoint": "/v1/videos/extensions", **payload}
        print(json.dumps(request, indent=2, sort_keys=True))
        write_json(args.json_out, {"dry_run": True, "request": request})
        return 0

    require_api_key()
    if args.poll_interval <= 0:
        raise ValueError("--poll-interval must be greater than zero.")
    if args.timeout is not None and args.timeout <= 0:
        raise ValueError("--timeout must be greater than zero.")

    client = OpenAI()
    source = client.videos.retrieve(args.id)
    if args.expected_size and source.size != args.expected_size:
        raise ValueError(
            f"Source video {args.id} is {source.size}; expected {args.expected_size}. "
            "Extensions preserve the source size."
        )

    print(
        f"Extending {args.id}: adding {args.seconds}s, preserving source size {source.size}; "
        "target total is approximately 24s."
    )
    extension = create_extension(client, payload)
    print(f"Submitted extension {extension.id} from {args.id}")
    final = poll_extension(client, extension.id, args.poll_interval, args.timeout)
    if final.status != "completed":
        raise RuntimeError(f"Extension {extension.id} finished with status {final.status}")

    if args.out:
        download_video(client, extension.id, args.out, args.force)
    write_json(args.json_out, {"source": source, "extension": extension, "final": final})
    print(f"Completed extension {extension.id}: total duration field={final.seconds}s, size={final.size}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
