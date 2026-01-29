import React from 'react';
import Link from 'next/link';

export default function FAQPage() {
  return (
    <main className="prose mx-auto px-4 py-8">
      <h1>Photarium FAQ</h1>
      <h2>Why do some images not show up in semantic search for certain keywords?</h2>
      <p>
        Photarium uses two different search systems:
      </p>
      <ul>
        <li>
          <b>Semantic search</b> (the search bar with "semantic" or "CLIP" mode):
          <ul>
            <li>Uses OpenAI CLIP embeddings to find images that are conceptually similar to your query.</li>
            <li>CLIP encodes the <i>entire scene</i> (objects, style, context, mood) into a vector.</li>
            <li>A query like "dog" will find images that look like typical dogs, but a painting of dogs playing poker may not rank highly unless you search for "dogs playing poker" or something more specific.</li>
            <li>This is because CLIP considers all aspects of the image, not just the presence of a single object.</li>
          </ul>
        </li>
        <li>
          <b>Text filter</b> (the gallery filter bar):
          <ul>
            <li>Searches literal text fields: filename, tags, description, alt text, Prompt This, etc.</li>
            <li>Finds images where the word appears in metadata, regardless of visual content.</li>
          </ul>
        </li>
      </ul>
      <p><b>Tip:</b> Use semantic search for "find images like this concept" and text filter for "find images where someone wrote this word".</p>
      <hr />
      <h2>How do I set up Redis for Photarium?</h2>
      <ol>
        <li>Install Docker Desktop (if not already installed)</li>
        <li>Start Redis Stack using Docker Compose:
          <pre><code>docker compose up -d</code></pre>
          (This uses the <code>docker-compose.yml</code> in the repo, which sets up Redis Stack with persistence enabled.)
        </li>
        <li>Check Redis is running:
          <pre><code>docker compose ps</code></pre>
          You should see a <code>redis</code> service listed as running.
        </li>
        <li>Backups:
          <ul>
            <li>Use the provided <code>scripts/backup-redis.sh</code> to create backups (includes both RDB and AOF files).</li>
            <li>See <Link href="/docs/redis-backup">docs/redis-backup.md</Link> for details.</li>
          </ul>
        </li>
      </ol>
      <hr />
      <h2>What are namespaces and how do I use them?</h2>
      <ul>
        <li>Namespaces let you organize images into logical groups (e.g., by project, client, or source).</li>
        <li>Each image has a <code>namespace</code> field in its metadata.</li>
        <li>The gallery and API support filtering by namespace (e.g., <code>/?gns=my-namespace</code>).</li>
        <li>Namespaces are especially useful for large installations or multi-tenant setups.</li>
        <li>You can view, create, and manage namespaces via the UI or API.</li>
      </ul>
      <p><b>Tip:</b> Use namespaces to keep unrelated image sets separate and to speed up search/filtering.</p>
      <hr />
      <p>For more, see the <Link href="/docs">Docs</Link> or the <Link href="/">main page</Link>.</p>
    </main>
  );
}
