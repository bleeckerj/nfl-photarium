# Photarium Search Features

This document describes Photarium's search capabilities, including semantic similarity search, color search, and the underlying embedding architecture.

> **Status:** Most features described in this document are now **implemented** on the `redis` branch. See [Implementation Status](#implementation-status) for details.

## Table of Contents

- [Implementation Status](#implementation-status)
- [Search Exclusion Tags](#search-exclusion-tags)
- [Current Search Capabilities](#current-search-capabilities)
- [Similarity Search](#similarity-search)
  - [How It Works](#how-it-works)
  - [Embedding Types](#embedding-types)
  - [Implementation Options](#implementation-options)
  - [Embedding Cost Estimates](#embedding-cost-estimates)
  - [Recommended Approach](#recommended-approach)
- [Redis Setup](#redis-setup)
  - [Local Development](#local-development)
  - [Docker Compose](#docker-compose)
  - [Production Options](#production-options)
- [Implementation Roadmap](#implementation-roadmap)

---

## Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Redis Stack vector search | ✅ Implemented | Using RediSearch |
| CLIP embedding generation | ✅ Implemented | HuggingFace API or local Python |
| Color embedding generation | ✅ Implemented | Local JavaScript extraction |
| Text-to-image search | ✅ Implemented | "Find sunset photos" |
| Image similarity search | ✅ Implemented | CLIP and color modes |
| Color hex search | ✅ Implemented | "#3B82F6" queries |
| Antipode search | ✅ Implemented | Find semantic/color opposites |
| Search exclusion tags | ✅ Implemented | x-clip, x-color, x-search |
| Backfill script | ✅ Implemented | `backfill-embeddings.mjs` |
| UI: Semantic Cluster | ✅ Implemented | Image detail page |
| UI: Antipode Search | ✅ Implemented | Image detail page |
| Combined filters | 🔄 Partial | Basic filtering available |
| Bulk similarity grouping | ❌ Not started | Find near-duplicates |

---

## Search Exclusion Tags

Photarium supports special tags to exclude images from search results:

### Available Tags

| Tag | Effect | Use Case |
|-----|--------|----------|
| `x-clip` | Exclude from CLIP/semantic search | Hide sensitive images from "find similar" |
| `x-color` | Exclude from color search | Hide from color-based queries |
| `x-search` | Exclude from ALL vector searches | Complete search exclusion |

### How Tags Work

```
Image with tags: ["vacation", "beach", "x-clip"]
  │
  ├── Text search "sunset" → NOT FOUND (x-clip excludes)
  ├── Similar images (CLIP) → NOT FOUND (x-clip excludes)
  ├── Color search "#FFD700" → FOUND (not excluded from color)
  └── Similar images (color) → FOUND (not excluded from color)

Image with tags: ["product", "x-search"]
  │
  ├── Text search → NOT FOUND
  ├── Similar (CLIP) → NOT FOUND
  ├── Color search → NOT FOUND
  └── Similar (color) → NOT FOUND
```

### Applying Exclusion Tags

**Via UI:**
1. Open image detail page (`/images/{id}`)
2. Find "Search Exclusions" section
3. Toggle desired exclusions (Semantic, Color, All Search)

**Via API:**
```bash
# Add x-clip tag to existing tags
curl -X PATCH http://localhost:3000/api/images/{id}/update \
  -H "Content-Type: application/json" \
  -d '{"tags":["existing-tag","x-clip"]}'
```

**Via Gallery CLI:**
```
# Filter to see images that could be excluded
show tag x-clip
show tag x-search
```

### Implementation Details

Tags are checked at query time in the vector search functions:

```typescript
// src/utils/searchExclusion.ts
export const EXCLUDE_CLIP_TAG = 'x-clip';
export const EXCLUDE_COLOR_TAG = 'x-color';
export const EXCLUDE_ALL_SEARCH_TAG = 'x-search';

export function shouldExcludeFromCLIP(tags: string[]): boolean {
  return tags.some(tag => 
    tag === EXCLUDE_CLIP_TAG || 
    tag === EXCLUDE_ALL_SEARCH_TAG
  );
}

export function shouldExcludeFromColor(tags: string[]): boolean {
  return tags.some(tag => 
    tag === EXCLUDE_COLOR_TAG || 
    tag === EXCLUDE_ALL_SEARCH_TAG
  );
}
```

---

## Current Search Capabilities

### Implemented Search Types

| Search Type | API | UI Location |
|-------------|-----|-------------|
| **Text/Semantic** | `POST /api/images/search` | Gallery search bar |
| **Color (hex)** | `POST /api/images/search` | Gallery search bar |
| **Similar (CLIP)** | `GET /api/images/{id}/similar?type=clip` | Semantic Cluster |
| **Similar (color)** | `GET /api/images/{id}/similar?type=color` | Semantic Cluster |
| **Antipode (CLIP)** | `POST /api/images/{id}/antipode` | Antipode Search |
| **Antipode (color)** | `POST /api/images/{id}/antipode` | Antipode Search |

### Search API Examples

```bash
# Text search
curl -X POST http://localhost:3000/api/images/search \
  -H "Content-Type: application/json" \
  -d '{"type":"text","query":"dog playing in park","limit":24}'

# Color search
curl -X POST http://localhost:3000/api/images/search \
  -H "Content-Type: application/json" \
  -d '{"type":"color","query":"#3B82F6","limit":24}'

# Similar images
curl "http://localhost:3000/api/images/{id}/similar?type=clip&limit=12"

# Antipode search
curl -X POST http://localhost:3000/api/images/{id}/antipode \
  -H "Content-Type: application/json" \
  -d '{"type":"clip","limit":8}'
```

### Legacy Text Search

The gallery also supports client-side text filtering based on:
- Filename
- Display name
- Description
- Alt text
- Folder
- Tags
- Original/Source URLs
- Image ID

This works well for text matching but doesn't support:
- **Visual similarity** ("find images that look like this")
- **Semantic search** ("find images of sunsets")
- **Color-based search** ("find blue images")

---

## Similarity Search

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    Similarity Search Flow                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. EMBEDDING GENERATION (on upload or batch process)           │
│     ┌─────────┐      ┌──────────────┐      ┌─────────────┐     │
│     │  Image  │ ───► │  CLIP Model  │ ───► │  512-dim    │     │
│     │         │      │              │      │  Vector     │     │
│     └─────────┘      └──────────────┘      └─────────────┘     │
│                                                                  │
│  2. STORAGE                                                      │
│     Store vector alongside image metadata in vector database     │
│                                                                  │
│  3. QUERY                                                        │
│     ┌─────────────┐      ┌─────────────┐      ┌─────────────┐  │
│     │  Query      │ ───► │  KNN Search │ ───► │  Top 10     │  │
│     │  Image      │      │  (cosine    │      │  Similar    │  │
│     │  Vector     │      │  similarity)│      │  Images     │  │
│     └─────────────┘      └─────────────┘      └─────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Embedding Types

Different embeddings enable different search capabilities:

| Embedding Type | Dimensions | Feature Search | Color Search | Text Query | Best For |
|----------------|------------|----------------|--------------|------------|----------|
| **CLIP** | 512 | ✅ Great | 🟡 Moderate | ✅ Yes | Semantic similarity, text-to-image |
| **Color Histogram** | 64-128 | ❌ No | ✅ Excellent | ❌ No | "Find blue images" |
| **Average Color** | 3 (RGB) | ❌ No | ✅ Good | ❌ No | Simple color matching |
| **ResNet/VGG** | 2048 | ✅ Great | 🟡 Moderate | ❌ No | Pure visual similarity |
| **BLIP-2** | 768 | ✅ Great | 🟡 Moderate | ✅ Better | Detailed scene understanding |

#### CLIP Capabilities

CLIP understands **semantic concepts**, not just pixels:

| Query Type | Works? | Example |
|------------|--------|---------|
| Visual similarity | ✅ | "Find images that look like this sunset" |
| Text-to-image | ✅ | "Find images of people smiling" |
| Object search | ✅ | "Find images with cars" |
| Scene search | ✅ | "Find outdoor photos" |
| Style matching | ✅ | "Find vintage-looking photos" |
| Color (semantic) | 🟡 | "blue sky" works, "blue images" is unreliable |
| Exact color match | ❌ | Won't find all images with hex #3B82F6 |

#### Color Embeddings

For reliable color-based search, use dedicated color embeddings:

```typescript
// Color histogram extraction (64-bin RGB)
function extractColorHistogram(imageData: ImageData): number[] {
  const histogram = new Array(64).fill(0); // 4x4x4 RGB bins
  const pixels = imageData.data;
  
  for (let i = 0; i < pixels.length; i += 4) {
    const r = Math.floor(pixels[i] / 64);     // 0-3
    const g = Math.floor(pixels[i + 1] / 64); // 0-3
    const b = Math.floor(pixels[i + 2] / 64); // 0-3
    const bin = r * 16 + g * 4 + b;
    histogram[bin]++;
  }
  
  // Normalize
  const total = pixels.length / 4;
  return histogram.map(count => count / total);
}

// Dominant color extraction
function extractDominantColors(imageData: ImageData, k = 5): RGB[] {
  // K-means clustering on pixel colors
  return kMeansClustering(imageData, k);
}
```

#### Recommended: Hybrid Embeddings

Store multiple embeddings per image for comprehensive search:

| Embedding | Dimensions | Storage (6500 images) | Purpose |
|-----------|------------|----------------------|---------|
| CLIP | 512 | ~13 MB | Semantic search |
| Color histogram | 64 | ~1.6 MB | Color palette matching |
| Average color | 3 | ~78 KB | Quick color filter |
| **Total** | **579** | **~15 MB** | Full search capability |

### Implementation Options

#### Option 1: Cloudflare Vectorize + Workers AI

**Best for:** Staying in the Cloudflare ecosystem

| Pros | Cons |
|------|------|
| Native Cloudflare integration | Requires Workers (not Next.js API routes) |
| Uses CLIP model via Workers AI | Newer service, less documentation |
| Scales automatically | May require architecture changes |
| Pay-per-use pricing | |

**Setup:**
```bash
# Create vector index
wrangler vectorize create photarium-images --dimensions=512 --metric=cosine

# Generate embeddings via Workers AI
const embedding = await env.AI.run('@cf/openai/clip-vit-base-patch32', {
  image: imageBytes
});

# Store in Vectorize
await env.VECTORIZE.insert([{
  id: imageId,
  values: embedding,
  metadata: { filename, folder }
}]);

# Query similar
const similar = await env.VECTORIZE.query(queryEmbedding, { topK: 10 });
```

**Estimated Cost:** ~$0.01 per 1000 queries + $0.05 per 1M stored vectors

---

#### Option 2: Redis Stack (Vector Search)

**Best for:** Self-hosted, already using Redis for caching

| Pros | Cons |
|------|------|
| Already have Redis for caching | Need Redis Stack (not plain Redis) |
| Fast vector search | Self-host embedding generation |
| No additional service | More operational overhead |
| Works with existing infrastructure | |

**Setup:**
```bash
# Use Redis Stack instead of plain Redis
docker run -d -p 6379:6379 redis/redis-stack:latest

# Create vector index
FT.CREATE idx:images ON HASH PREFIX 1 image:
  SCHEMA
    filename TEXT
    folder TAG
    embedding VECTOR FLAT 6 TYPE FLOAT32 DIM 512 DISTANCE_METRIC COSINE

# Store image with embedding
HSET image:abc123 filename "sunset.jpg" embedding <binary_vector>

# Query similar (KNN)
FT.SEARCH idx:images "*=>[KNN 10 @embedding $vec AS score]"
  PARAMS 2 vec <query_vector>
  SORTBY score
  RETURN 2 filename score
```

**Cost:** Free (self-hosted) or ~$5-15/mo (managed)

---

#### Option 3: Pinecone

**Best for:** Managed solution, minimal ops

| Pros | Cons |
|------|------|
| Fully managed | Another service to manage |
| Excellent documentation | Cost per vector stored |
| Easy to integrate | Vendor lock-in |
| Free tier available | |

**Setup:**
```typescript
import { Pinecone } from '@pinecone-database/pinecone';

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index('photarium-images');

// Upsert
await index.upsert([{
  id: imageId,
  values: embedding,
  metadata: { filename, folder, uploaded }
}]);

// Query
const results = await index.query({
  vector: queryEmbedding,
  topK: 10,
  includeMetadata: true
});
```

**Cost:** Free tier: 100K vectors, then ~$70/mo for 1M vectors

---

#### Option 4: Qdrant

**Best for:** Open-source, self-hosted with great features

| Pros | Cons |
|------|------|
| Open source | Another service to run |
| Rich filtering capabilities | |
| Good performance | |
| Docker-friendly | |

**Setup:**
```bash
# Run Qdrant
docker run -d -p 6333:6333 qdrant/qdrant

# Create collection
curl -X PUT 'http://localhost:6333/collections/images' \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": { "size": 512, "distance": "Cosine" }
  }'
```

**Cost:** Free (self-hosted) or ~$25/mo (Qdrant Cloud)

---

#### Option 5: pgvector (PostgreSQL)

**Best for:** Already using PostgreSQL

| Pros | Cons |
|------|------|
| Use existing database | Slower than dedicated vector DBs |
| SQL interface | Limited to ~1M vectors efficiently |
| Familiar tooling | |

**Setup:**
```sql
-- Enable extension
CREATE EXTENSION vector;

-- Add column
ALTER TABLE images ADD COLUMN embedding vector(512);

-- Create index
CREATE INDEX ON images USING ivfflat (embedding vector_cosine_ops);

-- Query
SELECT id, filename, embedding <=> query_embedding AS distance
FROM images
ORDER BY distance
LIMIT 10;
```

**Cost:** Depends on existing PostgreSQL setup

---

### Embedding Cost Estimates

#### For Your Library (~6,500 images)

##### One-Time Batch Processing (Existing Images)

| Provider | Model | Cost per Image | Total (6,500) | Notes |
|----------|-------|----------------|---------------|-------|
| **Cloudflare Workers AI** | CLIP | ~$0.00001 | **~$0.07** | 10M free neurons/day |
| **OpenAI** | CLIP (via API) | ~$0.0001 | ~$0.65 | Not officially supported |
| **Replicate** | CLIP | ~$0.0001 | ~$0.65 | Pay per second |
| **Hugging Face Inference** | CLIP | ~$0.00006 | ~$0.39 | Free tier available |
| **Self-hosted** | CLIP | $0 | **$0** | Requires GPU or slow CPU |
| **Color histogram** | Local JS | $0 | **$0** | Runs in browser/Node |

**Recommended:** Cloudflare Workers AI - essentially free for your scale.

##### Ongoing Costs (New Uploads)

Assuming ~100 new images/month:

| Provider | Monthly Cost | Notes |
|----------|--------------|-------|
| **Cloudflare Workers AI** | ~$0.001 | Negligible |
| **Self-hosted color extraction** | $0 | Local processing |

##### Vector Storage Costs

| Provider | Cost (6,500 vectors) | Cost (100K vectors) | Notes |
|----------|---------------------|---------------------|-------|
| **Redis Stack (self-hosted)** | $0 | $0 | Just RAM usage (~15MB) |
| **Upstash** | Free | Free | 10K vectors free |
| **Pinecone** | Free | Free | 100K vectors free |
| **Qdrant Cloud** | Free | ~$25/mo | 1GB free |
| **Cloudflare Vectorize** | ~$0.01/mo | ~$0.05/mo | $0.05/1M vectors |

##### Query Costs

| Provider | Cost per Query | 1000 Queries/mo |
|----------|----------------|-----------------|
| **Redis Stack (self-hosted)** | $0 | $0 |
| **Cloudflare Vectorize** | $0.01/1000 | $0.01 |
| **Pinecone** | Free (starter) | Free |
| **Qdrant Cloud** | ~$0.0001 | ~$0.10 |

#### Total Estimated Costs

##### Self-Hosted (Recommended for your scale)

| Component | One-Time | Monthly |
|-----------|----------|---------|
| CLIP embeddings (CF Workers AI) | $0.07 | ~$0.001 |
| Color embeddings | $0 | $0 |
| Vector storage (Redis Stack) | $0 | $0 |
| Queries | $0 | $0 |
| **Total** | **~$0.07** | **~$0** |

##### Fully Managed

| Component | One-Time | Monthly |
|-----------|----------|---------|
| CLIP embeddings (CF Workers AI) | $0.07 | ~$0.001 |
| Color embeddings | $0 | $0 |
| Vector storage (Pinecone free) | $0 | $0 |
| Queries (Pinecone free) | $0 | $0 |
| **Total** | **~$0.07** | **~$0** |

#### At Scale (100K+ images)

| Component | 100K images | 1M images |
|-----------|-------------|-----------|
| CLIP embeddings (one-time) | ~$1 | ~$10 |
| Vector storage (Pinecone) | Free | ~$70/mo |
| Vector storage (self-hosted) | ~$5/mo VPS | ~$20/mo VPS |

---

### Recommended Approach

For Photarium, I recommend a **phased approach**:

#### Phase 1: Redis Stack (Immediate)
Since we're already using Redis for caching, upgrade to Redis Stack for vector search:
- Minimal infrastructure changes
- Unified caching + vector search
- Self-hostable

#### Phase 2: CLIP Embedding Generation
Add embedding generation on image upload:
- Use Cloudflare Workers AI for CLIP embeddings
- Or run CLIP locally via Replicate/Hugging Face API

#### Phase 3: UI Integration
Add "Find Similar" button to image detail page:
- Query vector index
- Display results in modal or side panel

---

## Redis Setup

### Local Development

**macOS:**
```bash
# Install Redis Stack
brew tap redis-stack/redis-stack
brew install redis-stack

# Start Redis Stack
redis-stack-server
```

**Linux:**
```bash
# Add repository
curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list

# Install
sudo apt-get update
sudo apt-get install redis-stack-server

# Start
sudo systemctl start redis-stack-server
```

**Verify:**
```bash
redis-cli ping
# Should return: PONG

redis-cli MODULE LIST
# Should show: search, ReJSON, etc.
```

### Docker Compose

Add to your `docker-compose.yml`:

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - CACHE_STORAGE_TYPE=redis
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  redis:
    image: redis/redis-stack:latest
    ports:
      - "6379:6379"
      - "8001:8001"  # RedisInsight UI
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  redis_data:
```

Access RedisInsight UI at `http://localhost:8001` for visual management.

### Production Options

#### Self-Hosted (VPS/Docker)
```bash
# .env
CACHE_STORAGE_TYPE=redis
REDIS_URL=redis://localhost:6379
```

#### Upstash (Serverless Redis)
```bash
# Create at upstash.com, then:
CACHE_STORAGE_TYPE=redis
REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379
```

#### Redis Cloud
```bash
# Create at redis.com/cloud, then:
CACHE_STORAGE_TYPE=redis
REDIS_URL=redis://default:xxx@xxx.redis.cloud:6379
```

---

## Implementation Roadmap

### Phase 1: Foundation ✅ COMPLETE
- [x] File-based persistent cache
- [x] Redis cache storage adapter
- [x] Redis Stack deployment (Docker)
- [x] npm scripts for Redis management

### Phase 2: Vector Search Infrastructure ✅ COMPLETE
- [x] Redis Stack with RediSearch
- [x] Vector index schema (CLIP 512-dim + color embeddings)
- [x] Embedding fields in Redis
- [x] Cosine similarity search

### Phase 3: CLIP Embedding Generation ✅ COMPLETE
- [x] HuggingFace API integration (recommended)
- [x] Local Python CLIP option
- [x] Generate CLIP embeddings on image upload
- [x] Batch processing script (`backfill-embeddings.mjs`)
- [x] Store embeddings in Redis

### Phase 4: Color Embedding Generation ✅ COMPLETE
- [x] Color histogram extraction (server-side)
- [x] Dominant colors extraction
- [x] Average color calculation
- [x] Store color embeddings alongside CLIP vectors

### Phase 5: Search API ✅ COMPLETE
- [x] `/api/images/search` unified endpoint
- [x] `/api/images/{id}/similar` endpoint (CLIP + color modes)
- [x] `/api/images/{id}/antipode` endpoint (find opposites)
- [x] Text-to-image queries
- [x] Hex color queries
- [x] Return top N with similarity scores

### Phase 6: UI Integration ✅ COMPLETE
- [x] Semantic Cluster component (similar images)
- [x] Antipode Search component (opposite images)
- [x] Toggle between CLIP/color modes
- [x] Hover previews with distance scores
- [x] Click to navigate
- [x] Copy image lists to clipboard

### Phase 7: Search Exclusions ✅ COMPLETE
- [x] `x-clip` tag (exclude from semantic search)
- [x] `x-color` tag (exclude from color search)
- [x] `x-search` tag (exclude from all searches)
- [x] UI toggles on image detail page
- [x] Query-time filtering

### Phase 8: Advanced Features 🔄 IN PROGRESS
- [x] Gallery CLI embedding filter commands
- [ ] Bulk similarity grouping (find near-duplicates)
- [ ] Combined filters (similar + folder + date range)
- [ ] Color palette display on image detail
- [ ] Mood/tone search (warm, cool, vibrant)

---

## Future Enhancements

Potential features not yet implemented:

- **Bulk duplicate detection** — Find visually similar images across library
- **Auto-tagging** — Suggest tags based on CLIP concepts
- **Color palette extraction** — Show dominant colors on detail page
- **Mood classification** — Warm/cool/vibrant/muted filters
- **Face detection** — Group images by detected faces
- **OCR search** — Find images containing specific text

---

## Resources

- [Redis Vector Similarity Search](https://redis.io/docs/stack/search/reference/vectors/)
- [HuggingFace Inference API](https://huggingface.co/docs/api-inference/index)
- [OpenAI CLIP](https://openai.com/research/clip)
- [Photarium Features Guide](./features_and_operations.md)
- [Redis Backup Guide](./redis-backup.md)
