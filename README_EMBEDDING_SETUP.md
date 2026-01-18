# Embedding Service Setup

## Overview
The embedding service generates CLIP embeddings for semantic image search using **HuggingFace Inference API**.

## Required Environment Variable

Add this to your `.env.local` file:

```bash
HUGGINGFACE_API_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxxxxxx
```

Optional local mode (runs CLIP locally via python):

```bash
EMBEDDING_PROVIDER=local
NEXT_PUBLIC_EMBEDDING_PROVIDER=local
PYTHON_EXECUTABLE=python3
```

## Getting a HuggingFace API Token

1. Go to [HuggingFace Settings → Tokens](https://huggingface.co/settings/tokens)
2. Click **"New token"**
3. Give it a name like "Photarium"
4. Select **"Read"** access (that's all you need)
5. Click **"Generate"**
6. Copy the token and add it to `.env.local`

**Free Tier**: HuggingFace Inference API has a generous free tier that should be sufficient for most personal use cases.

## Verify Setup

After adding your token, restart the dev server and test:

```bash
# Test with a single image
curl -X POST http://localhost:3000/api/images/{IMAGE_ID}/embeddings \
  -H "Content-Type: application/json" \
  -d '{"clip": true, "color": true}'
```

Note: HuggingFace’s legacy api-inference endpoint is deprecated; the app uses https://router.huggingface.co/hf-inference/* under the hood.

## Local Embeddings (No HF required)

If HuggingFace returns errors, you can run CLIP locally:

1. Install Python deps:
  - `pip install sentence-transformers pillow`
2. Set `EMBEDDING_PROVIDER=local` in your `.env.local`
3. Restart the dev server and run the same test command

Expected output:
```json
{
  "success": true,
  "imageId": "...",
  "clipGenerated": true,
  "colorGenerated": true,
  "hasClipEmbedding": true,
  "hasColorEmbedding": true
}
```

## What This Enables

### CLIP Embeddings (HuggingFace)
- ✅ Image-to-image similarity search
- ✅ 512-dimensional semantic vectors

### Color Embeddings (Local)
- ✅ Always works (no API needed)
- ✅ Color-based similarity search
- ✅ Search by hex color code

## Generating Embeddings

You can generate embeddings from:
- **Gallery view**: Bulk selection → "Embeddings" button
- **Image detail page**: "Generate" button next to embedding status
- **CLI**: `npm run embeddings:generate`

## Optional Test (Local Provider)

Run a local embedding smoke test (downloads the CLIP model on first run):

```bash
RUN_EMBEDDING_E2E=1 EMBEDDING_PROVIDER=local npm run test
```
