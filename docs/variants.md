# Recommended Image Variants

This project uses Cloudflare Images transformations to serve multiple sizes of the same image. Below are recommended presets and when to use them.

- Small (300px): Good for email thumbnails, small preview images in newsletters, and avatars.
- Medium (600px): Good for in-body email images and small website hero images on mobile.
- Large (900px): Good for main website content images and medium-resolution displays.
- X-Large (1200px): Good for large hero images and high-resolution content where quality matters.
- Original: Full resolution copy — use sparingly (downloads, print, or when quality is critical).

Usage guidance:
- Email: prefer `Small` or `Medium` to keep size down and ensure quick loads in mail clients.
- Website: use `responsive` `srcset` for images and serve `Medium`/`Large` depending on layout; `X-Large` for full-width hero images.
- Thumbnails: use `thumbnail` preset when available.

## Gallery Grid Default

The gallery grid requests `Medium` (`w=600`) by default — roughly 2x DPR for the
tile sizes the grid renders. The default lives in `DEFAULT_GALLERY_VARIANT`
([src/components/gallery/constants.ts](../src/components/gallery/constants.ts)).

The grid previously defaulted to `Full (No Resize)`, so a 30-tile page downloaded
30 full-resolution originals into ~300px boxes. `next/image` runs with
`unoptimized: true` (Cloudflare does the resizing), so it emits no `srcset` and
the requested variant is exactly what the browser downloads.

`Full` remains available in the **Image Size** selector and is unchanged on the
image detail page.

### Stored preference migration

Gallery preferences carry a `prefsVersion` field
([src/components/gallery/storedPreferences.ts](../src/components/gallery/storedPreferences.ts)).
On read, a pre-v2 blob holding `full` is rewritten to the new default and stamped
`prefsVersion: 2`. A `Full` selected *after* that stamp is a deliberate choice and
is preserved.

When changing the grid default again, bump `GALLERY_PREFERENCES_VERSION` and add
the corresponding migration branch — otherwise existing users keep the old value
forever.

Example (copyable):

- Small: `https://imagedelivery.net/{ACCOUNT_HASH}/{IMAGE_ID}/w=300`
- Medium: `https://imagedelivery.net/{ACCOUNT_HASH}/{IMAGE_ID}/w=600`
- Large: `https://imagedelivery.net/{ACCOUNT_HASH}/{IMAGE_ID}/w=900`
- X-Large: `https://imagedelivery.net/{ACCOUNT_HASH}/{IMAGE_ID}/w=1200`
- Original: `https://imagedelivery.net/{ACCOUNT_HASH}/{IMAGE_ID}/public`

Considerations:
- Resized images are cached at the edge. Purging the original image will purge resized variants.
- Avoid using `original` in email; use smaller sizes to improve deliverability and load times.

## Crop Variants

Crop variants are separate uploaded child images, not Cloudflare delivery-size transformations. Use **Crop variant** on a parent image detail page when a real derivative asset is needed for a specific composition. The crop is generated from original bytes, preserves source width, outputs WebP, and supports still images plus animated WebP/GIF sources.

Supported preset ratios are `1:1`, `3:2`, `4:5`, `5:4`, `9:16`, and `16:9`, with custom `width:height` values available through the modal/API. Crops can anchor from the top, center, or bottom. If the requested full-width crop would be taller than the source image or animation frame, Photarium rejects it instead of padding or scaling.
