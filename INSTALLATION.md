# Installation

This guide covers a full local setup of Photarium (Next.js app, Redis, optional Python embeddings, and Docker).

## Prerequisites

- Node.js 18+ and npm
- Docker Desktop (or Docker Engine + Compose)
- Python 3.10+ (only needed for local CLIP embeddings)
- ffmpeg (required for animated WebP generation)
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: https://ffmpeg.org/download.html

## 1) Clone & install Node dependencies

```bash
git clone https://github.com/bleeckerj/nfl-photarium.git
cd nfl-photarium
npm install
```

## 2) Configure environment variables

Copy the example file and edit values:

```bash
cp .env.example .env.local
```

Required values (from your Cloudflare dashboard):

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` (Cloudflare Images:Edit)
- `NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH`

Optional values:

- `IMAGE_NAMESPACE` / `NEXT_PUBLIC_IMAGE_NAMESPACE`
- `OPENAI_API_KEY` (AI alt text)
- `HUGGINGFACE_API_TOKEN` (remote CLIP embeddings)

## 3) Start Redis with Docker

Redis Stack is used for vector search and embeddings.

```bash
npm run redis:start
```

Check status:

```bash
npm run redis:status
```

## 4) (Optional) Local Python embeddings

If you want local CLIP embeddings instead of HuggingFace:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

Set these in `.env.local`:

```bash
EMBEDDING_PROVIDER=local
NEXT_PUBLIC_EMBEDDING_PROVIDER=local
PYTHON_EXECUTABLE=python3
```

Note: The app will prefer `.venv/bin/python` if it exists.

## 5) Run the app

```bash
npm run dev
```

Open http://localhost:3000

## Docker-only workflow (optional)

This repo currently uses Docker for Redis only. If you want a full containerized setup,
you can add a Next.js app service to `docker-compose.yml`, but it is not included today.

## Useful commands

- Start/stop Redis: `npm run redis:start` / `npm run redis:stop`
- Follow Redis logs: `npm run redis:logs`
- Generate embeddings: `npm run embeddings:generate`
