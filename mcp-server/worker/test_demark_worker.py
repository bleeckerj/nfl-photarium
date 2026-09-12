"""Worker integration tests using real WebP codecs and the configured library."""
import os
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
import demark_worker


class DemarkWorkerTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.settings = dict(mode="metadata", modelProfile="ctrlregen", device="cpu",
                             strength=0.04, steps=1, removeAllMetadata=False)

    def run_image(self, source, mode="metadata"):
        output = self.root / f"output{source.suffix}"
        result = demark_worker.process({"settings": {**self.settings, "mode": mode}, "items": [
            {"imageId": "test", "sourcePath": str(source), "outputPath": str(output)}]})
        return result["items"][0], output

    def test_real_webp_cleanup_preserves_alpha_and_pixels(self):
        source = self.root / "source.webp"
        Image.new("RGBA", (19, 23), (80, 120, 160, 90)).save(source, lossless=True)
        before = source.read_bytes()
        chunk = b"C2PA" + struct.pack("<I", 4) + b"test"
        source.write_bytes(before[:4] + struct.pack("<I", len(before) + len(chunk) - 8) + before[8:] + chunk)
        result, output = self.run_image(source)
        self.assertTrue(result["ok"], result)
        self.assertEqual(output.read_bytes(), before)
        self.assertTrue(result["verification"]["inspection_complete"])
        self.assertFalse(result["verification"]["c2pa_present"])
        self.assertIsNone(result["verification"]["pixel_watermark_present"])

    def test_png_and_jpeg_cleanup_keep_explicit_inspection_limits(self):
        for suffix in (".png", ".jpg"):
            with self.subTest(suffix=suffix):
                source = self.root / f"source{suffix}"
                Image.new("RGB", (19, 23), "green").save(source)
                result, output = self.run_image(source)
                self.assertTrue(result["ok"], result)
                with Image.open(output) as image:
                    self.assertEqual(image.size, (19, 23))
                if suffix == ".jpg":
                    self.assertFalse(result["verification"]["inspection_complete"])
                    self.assertIsNone(result["verification"]["ai_metadata_present"])

    def test_animation_metadata_preserves_all_frames(self):
        source = self.root / "animation.webp"
        first = Image.new("RGBA", (19, 23), "red")
        second = Image.new("RGBA", (19, 23), "blue")
        first.save(source, save_all=True, append_images=[second], duration=[100, 200], loop=2, lossless=True)
        result, output = self.run_image(source)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["frames"], 2)
        self.assertEqual(source.read_bytes(), output.read_bytes())

    def test_animation_rejected_before_model_creation(self):
        source = self.root / "animation.webp"
        Image.new("RGB", (19, 23), "red").save(source, save_all=True,
            append_images=[Image.new("RGB", (19, 23), "blue")], duration=100, lossless=True)
        api = demark_worker._load_noai(Path(os.environ["PHOTARIUM_NOAI_WATERMARK_ROOT"]))
        with patch.object(demark_worker, "_load_noai", return_value=api), patch.dict(api, {"WatermarkRemover": unittest.mock.Mock()}):
            result, output = self.run_image(source, "demark")
            api["WatermarkRemover"].assert_not_called()
        self.assertFalse(result["ok"])
        self.assertIn("Animated WebP is not supported", result["error"])
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
