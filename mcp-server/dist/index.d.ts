/**
 * Photarium MCP Server
 *
 * Exposes the Photarium image gallery API as MCP tools for AI agents.
 * This enables LLMs to browse, search, manage, and curate a Cloudflare Images catalog.
 *
 * Tools - Discovery & Search:
 *   - photarium_search: Semantic text search using CLIP embeddings
 *   - photarium_search_color: Find images by dominant color
 *   - photarium_similar: Find visually similar images
 *   - photarium_antipode: Find semantic/color opposites
 *   - photarium_list: List images with filters
 *   - photarium_get: Get detailed image info
 *
 * Tools - Organization:
 *   - photarium_list_folders: List available folders
 *   - photarium_create_folder: Create a new folder
 *   - photarium_list_namespaces: List namespaces
 *   - photarium_update_metadata: Update image metadata
 *
 * Tools - Upload:
 *   - photarium_upload_url: Upload from URL
 *
 * Tools - AI Features:
 *   - photarium_generate_alt: Generate alt text
 *   - photarium_generate_description: Generate description
 *   - photarium_generate_prompt: Generate text-to-image prompt
 *   - photarium_concepts: Get semantic concept scores
 *
 * Tools - System:
 *   - photarium_vector_status: Check embedding/search system status
 *   - photarium_generate_embeddings: Generate embeddings for an image
 *
 * Configuration:
 *   PHOTARIUM_BASE_URL - Base URL of Photarium instance (default: http://localhost:3000)
 */
export {};
