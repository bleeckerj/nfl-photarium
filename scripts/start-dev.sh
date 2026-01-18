#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}       ${GREEN}Photarium Development Server${NC}       ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}✖ Docker is not running!${NC}"
    echo ""
    echo -e "${YELLOW}Please start Docker Desktop first:${NC}"
    echo ""
    echo "  macOS:   Open Docker Desktop from Applications"
    echo "           or run: open -a Docker"
    echo ""
    echo "  Linux:   sudo systemctl start docker"
    echo ""
    echo -e "${YELLOW}Then run this command again:${NC}"
    echo "  npm run dev:full"
    echo ""
    exit 1
fi

echo -e "${GREEN}✔ Docker is running${NC}"

# Start Redis with docker compose
echo -e "${BLUE}→ Starting Redis...${NC}"
docker compose up -d --wait

if [ $? -ne 0 ]; then
    echo -e "${RED}✖ Failed to start Redis${NC}"
    exit 1
fi

echo -e "${GREEN}✔ Redis is ready${NC}"
echo ""
echo -e "${BLUE}→ Starting Next.js dev server...${NC}"
echo ""

# Start the dev server
exec npm run dev
