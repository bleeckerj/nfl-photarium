import { createBackup, listBackups } from './backup.js';
import { auditImages, batchGenerateEmbeddings, ensureVectorIndex, generateEmbeddings, getColorsBulk, getDebugRaw, getEmbeddingStatus, getVectorStatus, } from './client.js';
export const systemHandlers = {
    'photarium_vector_status': async () => {
        const result = await getVectorStatus();
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_vector_index': async () => {
        const result = await ensureVectorIndex();
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_generate_embeddings': async (args) => {
        const { imageId, clip, color, force } = args;
        const result = await generateEmbeddings(imageId, { clip, color, force });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_embedding_status': async (args) => {
        const { imageId } = args;
        const result = await getEmbeddingStatus(imageId);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_embeddings_batch': async (args) => {
        const { imageIds, clip, color, force } = args;
        const result = await batchGenerateEmbeddings({ imageIds, clip, color, force });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_colors_bulk': async (args) => {
        const { imageIds } = args;
        const result = await getColorsBulk(imageIds);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ colors: result }, null, 2),
                },
            ],
        };
    },
    'photarium_audit': async (args) => {
        const { refresh, limit, offset, concurrency, variant, verbose } = args;
        const result = await auditImages({ refresh, limit, offset, concurrency, variant, verbose });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_backup': async (args) => {
        const { keepCount, dryRun } = args;
        const result = await createBackup({ keepCount, dryRun });
        // Format a nice summary for the LLM
        let summary = '';
        if (result.dryRun) {
            summary = `[DRY RUN] Would create:\n- RDB: ${result.wouldCreate?.rdb}\n- Bundle: ${result.wouldCreate?.bundle}`;
        }
        else if (result.success && result.backup) {
            summary = `✓ Backup completed successfully!\n\n`;
            summary += `RDB Snapshot: ${result.backup.rdb.filename} (${result.backup.rdb.sizeHuman})\n`;
            summary += `Bundle: ${result.backup.bundle.filename} (${result.backup.bundle.sizeHuman})`;
            if (!result.backup.bundle.includesAof) {
                summary += ` [RDB only, no AOF]`;
            }
            summary += `\n\nTimestamp: ${result.timestamp}\n\nSteps:\n${result.steps?.map(s => `  - ${s}`).join('\n')}`;
        }
        return {
            content: [
                {
                    type: 'text',
                    text: summary || JSON.stringify(result, null, 2),
                },
            ],
        };
    },
    'photarium_list_backups': async () => {
        const result = await listBackups();
        // Format a nice summary
        let summary = `📦 Redis Backups (${result.count} backup sets)\n`;
        summary += `Directory: ${result.backupDir}\n`;
        summary += `Retention: ${result.keepCount} backups\n\n`;
        if (result.count === 0) {
            summary += 'No backups found.';
        }
        else {
            const timestamps = Object.keys(result.grouped).sort().reverse();
            for (const ts of timestamps) {
                const group = result.grouped[ts];
                const date = ts.replace(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6');
                summary += `📁 ${date}\n`;
                if (group.rdb) {
                    summary += `   RDB: ${group.rdb.sizeHuman}\n`;
                }
                if (group.bundle) {
                    summary += `   Bundle: ${group.bundle.sizeHuman}\n`;
                }
            }
        }
        return {
            content: [
                {
                    type: 'text',
                    text: summary,
                },
            ],
        };
    },
    'photarium_debug_raw': async () => {
        const result = await getDebugRaw();
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    },
};
