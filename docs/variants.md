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

Example (copyable):

- Small: `https://imagedelivery.net/{ACCOUNT_HASH}/{IMAGE_ID}/w=300`
- Medium: `https://imagedelivery.net/{ACCOUNT_HASH}/{IMAGE_ID}/w=600`
- Large: `https://imagedelivery.net/{ACCOUNT_HASH}/{IMAGE_ID}/w=900`
- X-Large: `https://imagedelivery.net/{ACCOUNT_HASH}/{IMAGE_ID}/w=1200`
- Original: `https://imagedelivery.net/{ACCOUNT_HASH}/{IMAGE_ID}/public`

Considerations:
- Resized images are cached at the edge. Purging the original image will purge resized variants.
- Avoid using `original` in email; use smaller sizes to improve deliverability and load times.
