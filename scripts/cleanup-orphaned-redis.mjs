#!/usr/bin/env node

/**
 * Cleanup Orphaned Redis Entries
 * 
 * Finds and removes Redis embedding entries for images that no longer exist
 * in Cloudflare. This can happen when images are deleted from Cloudflare
 * but the Redis vector store isn't updated.
 * 
 * Usage:
 *   node scripts/cleanup-orphaned-redis.mjs         # Dry run
 *   node scripts/cleanup-orphaned-redis.mjs --apply # Actually delete orphans
 */

import Redis from 'ioredis';

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const KEY_PREFIX = 'image:';
const dryRun = !process.argv.includes('--apply');

if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

async function checkImageExistsInCloudflare(imageId) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/images/v1/${imageId}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      },
    });
    
    if (response.status === 404) {
      return false;
    }
    
    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error(`Error checking image ${imageId}:`, error.message);
    return null; // Unknown - don't delete
  }
}

async function main() {
  console.log('🔍 Cleanup Orphaned Redis Entries');
  console.log(`Mode: ${dryRun ? 'DRY RUN (use --apply to delete)' : '⚠️  APPLYING CHANGES'}`);
  console.log('');

  const redis = new Redis(REDIS_URL);

  try {
    // Get all image keys from Redis
    const keys = await redis.keys(`${KEY_PREFIX}*`);
    console.log(`Found ${keys.length} image entries in Redis`);
    
    const orphans = [];
    const verified = [];
    const errors = [];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const imageId = key.replace(KEY_PREFIX, '');
      
      process.stdout.write(`\rChecking ${i + 1}/${keys.length}: ${imageId}...`);
      
      // Get filename for display
      const filename = await redis.hget(key, 'filename');
      
      const exists = await checkImageExistsInCloudflare(imageId);
      
      if (exists === false) {
        orphans.push({ imageId, filename, key });
      } else if (exists === true) {
        verified.push(imageId);
      } else {
        errors.push(imageId);
      }
      
      // Rate limit to avoid hitting Cloudflare API limits
      await new Promise(r => setTimeout(r, 100));
    }

    console.log('\n');
    console.log('━'.repeat(60));
    console.log(`✅ Verified in Cloudflare: ${verified.length}`);
    console.log(`❌ Orphans (in Redis, not in CF): ${orphans.length}`);
    console.log(`⚠️  Errors (couldn't check): ${errors.length}`);
    console.log('━'.repeat(60));

    if (orphans.length > 0) {
      console.log('\nOrphaned entries:');
      for (const orphan of orphans) {
        console.log(`  - ${orphan.imageId} (${orphan.filename || 'unknown'})`);
      }

      if (!dryRun) {
        console.log('\n🗑️  Deleting orphaned entries...');
        for (const orphan of orphans) {
          await redis.del(orphan.key);
          console.log(`  Deleted: ${orphan.imageId}`);
        }
        console.log(`\n✅ Deleted ${orphans.length} orphaned entries`);
      } else {
        console.log('\n💡 Run with --apply to delete these entries');
      }
    } else {
      console.log('\n✨ No orphans found - database is clean!');
    }

  } finally {
    await redis.quit();
  }
}

main().catch(console.error);
