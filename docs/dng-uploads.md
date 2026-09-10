# DNG uploads

Upload `.dng` files through the main uploader, variation uploader, ZIP archives,
`/api/upload`, `/api/upload/external`, or the Photarium file-upload MCP tools.
`npm run fs:ingest` also discovers DNGs in nested folders. Filenames are matched
without regard to case, including files reported as generic binary data or TIFF.
Pre-upload name and tag suggestions use a decoded WebP preview.

The server decodes each DNG to an sRGB PNG, preserving its full frame and applying
orientation. PNG is retained when it fits Cloudflare's upload limits. Larger
images pass through the existing WebP/JPEG normalization, with proportional
resizing only when required by byte, dimension, or pixel-area limits. The stored
filename extension and MIME type describe the converted image. The raw DNG is
not stored in Cloudflare Images; keep the source file in your archive.

`uploadNormalization` records the original filename, source MIME type, original
byte count, decoded dimensions, final dimensions and format, and conversion
reasons. DNG conversion records are also stored in image extras so they survive
Cloudflare metadata trimming. Existing namespace, folder, parent, duplicate,
source-path, and EXIF handling still applies.

## Server requirements

On macOS, Photarium uses the bundled `/usr/bin/sips` raw decoder. Other hosts need
LibRaw's `dcraw_emu` executable on the server's `PATH`. The LibRaw command uses
camera white balance and TIFF output; see [LibRaw's sample-program documentation](https://www.libraw.org/docs/Samples-LibRaw.html).
No decoder is bundled into browser code.

Raw conversion runs one file at a time per server instance, in private temporary
directories removed on success and failure. Each decoder process has a 120-second
timeout. Source files are limited to 500 MB, decoded files to 600 MB, and the PNG
conversion to 150 million pixels. Unsupported or corrupt DNGs and missing decoders
produce an upload error before Cloudflare storage. Support for individual camera
models depends on the installed decoder.

The separate `npm run dng:ingest` preview workflow keeps its existing behavior.
