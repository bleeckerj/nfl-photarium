# Photarium MCP Server

MCP server that exposes the Photarium image gallery to AI agents.

## Tools

| Tool | Description |
|------|-------------|
| `photarium_search` | Semantic search for images using natural language |
| `photarium_similar` | Find visually similar images (by CLIP or color) |
| `photarium_list` | List images with folder/namespace filters |
| `photarium_get` | Get details for a specific image |
| `photarium_upload_url` | Upload an image from a URL |
| `photarium_list_folders` | List available folders |

## Setup

```bash
cd mcp-server
npm install
npm run build
```

## Configuration

Set the base URL of your Photarium instance:

```bash
export PHOTARIUM_BASE_URL=http://localhost:3000
```

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "photarium": {
      "command": "node",
      "args": ["/path/to/photarium/mcp-server/dist/index.js"],
      "env": {
        "PHOTARIUM_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Usage with VS Code

Add to your VS Code settings or MCP configuration:

```json
{
  "mcp.servers": {
    "photarium": {
      "command": "node",
      "args": ["${workspaceFolder}/mcp-server/dist/index.js"],
      "env": {
        "PHOTARIUM_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Example Queries

Once connected, you can ask the AI:

- "Find images related to urban futurism"
- "Show me images similar to image ID abc123"
- "List all images in the 'blog-posts' folder"
- "Upload this image URL to the 'editorial' namespace"
- "What folders are available in the gallery?"

## Integration with Editorial Workflow

The Photarium MCP works well alongside the editorial MCP:

```
User: "Write a draft about mundane futurism and include relevant images"

AI workflow:
1. mcp_editorial_generate_draft → creates article text
2. photarium_search("mundane futurism everyday objects") → finds FPO images
3. Combines draft with image URLs
```
