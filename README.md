# Cloudflare Image Uploader

A simple, modern web application for uploading and managing images using Cloudflare Images. Perfect for hosting images that you need to use in email blasts, websites, or any other online content.

## Features

- 🎯 **Drag & Drop Interface** - Simple file upload with drag and drop support
- � **Folder Organization** - Organize images into folders (email-campaigns, website-images, etc.)
- 🏷️ **Tagging System** - Tag images for easy categorization and searching
- 🔍 **Advanced Search & Filter** - Search by filename, folder, or tags with real-time filtering
- 🖼️ **Dual View Modes** - Switch between grid and list views for different workflows
- 🔗 **URL Management** - Copy image URLs with one click
- 📝 **AI ALT Text** - Generate or refresh accessible descriptions with GPT-4o mini (requires `OPENAI_API_KEY`)
- 📅 **Date-Aware Pagination** - Page through uploads 12 at a time with sticky filters and date range cues
- 📱 **Responsive Design** - Works great on desktop and mobile devices
- 🗑️ **Image Deletion** - Remove images you no longer need
- 🎨 **Multiple Variants** - Access different image sizes (thumbnail, medium, large)
- 🔄 **Auto-Refresh Gallery** - Gallery automatically updates when new images are uploaded
- ⚡ **Fast CDN Delivery** - Powered by Cloudflare's global CDN

## Setup Instructions

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd cloudflare-image-uploader
npm install
```

### 2. Configure Cloudflare Images

1. **Get your Cloudflare Account ID**:
   - Go to your Cloudflare dashboard
   - Copy the Account ID from the right sidebar

2. **Create an API Token**:
   - Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
   - Click "Create Token"
   - Use "Custom token" template
   - Add permission: **Cloudflare Images:Edit**
   - Account resources: Include your specific account
   - Click "Continue to summary" and "Create Token"
   - Copy the token (you won't see it again!)

3. **Get your Account Hash** (for image URLs):
   - Go to Cloudflare Images in your dashboard
   - Copy the Account Hash from the Images overview page

### 3. Environment Configuration

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Cloudflare credentials:

```env
CLOUDFLARE_ACCOUNT_ID=your_account_id_here
CLOUDFLARE_API_TOKEN=your_api_token_here
NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH=your_account_hash_here
```

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Usage

### Uploading Images
1. **Choose Organization** (Optional):
   - Select an existing folder or create a new one
   - Add tags (comma-separated) like "logo, header, banner"
2. **Upload Images**: Drag and drop image files onto the upload area, or click to select files
3. **Track Progress**: Watch upload progress and see immediate confirmation

### Managing Your Image Library
1. **Browse & Search**: 
   - Use the search box to find images by name, folder, or tags
   - Filter by specific folders or tags using the dropdowns
2. **View Modes**: 
   - **Grid View**: Perfect for browsing and visual selection
   - **List View**: Great for detailed information and bulk operations
3. **Copy URLs**: Click on any image URL to copy it to your clipboard
4. **Delete Images**: Use the trash icon to remove images you no longer need
5. **Image Variants**: Switch between different sizes (thumbnail, medium, large, public)
6. **AI ALT Text**: Click the **AI ALT** button on any card to generate or refresh stored alt text (requires `OPENAI_API_KEY` and updates metadata in Cloudflare)
7. **Pagination**: Use the date-labeled controls to jump between pages of 12 images while the filters stay pinned to the top

### Organization Tips
- **Email Campaigns**: Use folder "email-campaigns" with tags like "newsletter", "promo", "header"
- **Website Images**: Use folder "website-images" with tags like "hero", "about", "testimonial"  
- **Social Media**: Use folder "social-media" with tags like "instagram", "facebook", "linkedin"
- **Blog Posts**: Use folder "blog-posts" with tags by topic or date

## External Upload API

You can push images into this service from other local tools (Astro, scripts, etc.) via the new endpoint:

- **Endpoint**: `POST http://localhost:3000/api/upload/external`
- **CORS**: Open to any origin (handy for local multi-port setups)
- **Content-Type**: `multipart/form-data`

| Field | Required | Notes |
| --- | --- | --- |
| `file` | ✅ | Binary image file (max 10 MB, must be `image/*`). |
| `folder` | ❌ | Optional folder name (e.g., `astro-uploads`). |
| `tags` | ❌ | Comma-separated list (`landing, hero`). |
| `description` | ❌ | Brief text description. |
| `originalUrl` | ❌ | Reference URL of the source image. |

**Sample response**

```json
{
   "id": "abc123",
   "filename": "photo.png",
   "url": "https://imagedelivery.net/<hash>/abc123/public",
   "variants": ["…/public", "…/thumbnail"],
   "uploaded": "2025-11-28T17:05:12.345Z",
   "folder": "astro-uploads",
   "tags": ["astro", "cloudflare"],
   "description": "Hero image"
}
```

**cURL example**

```bash
curl -X POST http://localhost:3000/api/upload/external \
   -F "file=@./photo.png" \
   -F "folder=astro-uploads" \
   -F "tags=astro,cloudflare"
```

## Drop-off Folder Watcher

If you want a simple file-system watcher that uploads new images automatically, run:

```bash
npm run watch:drop-off
```

By default it watches `./drop-off`, uploads images to the `drop-off` folder with tag `found`, and then calls the ALT generator (`/api/images/:id/alt`). You can override behavior with environment variables:

```env
DROP_OFF_DIR=/absolute/path/to/watch
DROP_OFF_BASE_URL=http://localhost:3000
DROP_OFF_FOLDER=drop-off
DROP_OFF_TAGS=found
DROP_OFF_STATE_FILE=/absolute/path/to/.watcher-state.json
DROP_OFF_PROCESS_EXISTING=true
```

### Astro Integration Example

Below is an Astro component snippet that adds a button below each thumbnail. Clicking the button fetches the image blob in the **browser**, builds `FormData`, and posts it to the external API. (Astro can stay static—this script runs client-side.)

```astro
---
const API_BASE = import.meta.env.PUBLIC_IMAGE_HANDLER_URL ?? 'http://localhost:3000';
const images = [
   { src: '/images/example-1.jpg', filename: 'example-1.jpg' },
   { src: '/images/example-2.jpg', filename: 'example-2.jpg' }
];
---

<ul>
   {images.map((image) => (
      <li>
         <img src={image.src} alt={image.filename} width="300" />
         <button
            class="upload-btn"
            data-src={image.src}
            data-filename={image.filename}
         >
            Upload to Cloudflare
         </button>
      </li>
   ))}
</ul>

<script is:inline>
   const API_BASE = 'http://localhost:3000';

   async function sendToCloudflare(src, filename) {
      const blobResponse = await fetch(src);
      const blob = await blobResponse.blob();
      const file = new File([blob], filename, { type: blob.type || 'image/png' });
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'astro-uploads');

      const uploadResponse = await fetch(`${API_BASE}/api/upload/external`, {
         method: 'POST',
         body: formData,
      });

      if (!uploadResponse.ok) {
         const error = await uploadResponse.json();
         alert(`Upload failed: ${error.error}`);
         return;
      }

      const result = await uploadResponse.json();
      console.log('Uploaded to Cloudflare Images:', result);
   }

   document.querySelectorAll('.upload-btn').forEach((button) => {
      button.addEventListener('click', () => {
         const src = button.getAttribute('data-src');
         const filename = button.getAttribute('data-filename');
         sendToCloudflare(src, filename);
      });
   });
</script>
```

> **Note:** The button + fetch logic runs in the browser. Astro can remain static; you only need to include this inline script (or a client-loaded component) in the page displaying your images.

For server-side or authenticated flows, you can create a small Astro API route that proxies requests to `POST /api/upload/external` and attaches any required credentials.

## Image Variants

Cloudflare automatically creates multiple variants of your images:
- **Public** - Original size, optimized
- **Thumbnail** - Small preview size
- **Medium** - Medium size for web use
- **Large** - Large size for high-quality displays

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Connect your repository to [Vercel](https://vercel.com)
3. Add your environment variables in the Vercel dashboard
4. Deploy!

### Other Platforms

This Next.js application can be deployed to any platform that supports Node.js:
- Netlify
- Railway
- Render
- DigitalOcean App Platform

Make sure to set your environment variables on your chosen platform.

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **File Handling**: React Dropzone
- **Image Hosting**: Cloudflare Images
- **Language**: TypeScript

## Testing

- Run the vitest suite (includes coverage for the external upload API):

```bash
npm run test
```

*(If you see `vitest: command not found`, run `npm install` to pull the new dev dependency.)*

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - feel free to use this project for any purpose.
- [docs/api/README.md](docs/api/README.md) – how to query/search the image API programmatically (GET `/api/images`, `/api/uploads`, etc.) including retrieving Cloudflare URLs at all sizes.
