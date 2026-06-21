export const organizationTools = [
    // ===== Organization =====
    {
        name: 'photarium_list_folders',
        description: 'List all available folders in the gallery, optionally filtered by namespace.',
        inputSchema: {
            type: 'object',
            properties: {
                namespace: {
                    type: 'string',
                    description: 'Filter folders by namespace',
                },
            },
        },
    },
    {
        name: 'photarium_create_folder',
        description: 'Create a new folder in the gallery for organizing images.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the folder to create',
                },
            },
            required: ['name'],
        },
    },
    {
        name: 'photarium_list_namespaces',
        description: 'List all registered namespaces. Namespaces allow multi-tenant image organization.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'photarium_rename_namespace',
        description: 'Preview or apply a namespace rename. Live runs move all image/video assets from the source namespace to the target namespace.',
        inputSchema: {
            type: 'object',
            properties: {
                namespace: {
                    type: 'string',
                    description: 'Source namespace to rename',
                },
                targetNamespace: {
                    type: 'string',
                    description: 'New namespace name',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'Preview counts and affected asset IDs without mutating. Defaults to true.',
                },
                confirm: {
                    type: 'string',
                    description: 'Required for live runs with dryRun=false. Must be "RENAME_NAMESPACE".',
                },
            },
            required: ['namespace', 'targetNamespace'],
        },
    },
    {
        name: 'photarium_delete_namespace',
        description: 'Preview or delete a namespace. Live runs move all image/video assets in the namespace to cf-default, then remove the namespace.',
        inputSchema: {
            type: 'object',
            properties: {
                namespace: {
                    type: 'string',
                    description: 'Namespace to delete',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'Preview counts and affected asset IDs without mutating. Defaults to true.',
                },
                confirm: {
                    type: 'string',
                    description: 'Required for live runs with dryRun=false. Must be "DELETE_NAMESPACE".',
                },
            },
            required: ['namespace'],
        },
    },
    {
        name: 'photarium_update_metadata',
        description: 'Update metadata for an image including folder, tags, description, alt text, and namespace. Can also set parent-child relationships for image variants.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to update',
                },
                folder: {
                    type: 'string',
                    description: 'Move image to this folder',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Replace tags with this array',
                },
                description: {
                    type: ['string', 'null'],
                    description: 'Set description (use null to clear)',
                },
                displayName: {
                    type: ['string', 'null'],
                    description: 'Set display name (use null or empty to clear)',
                },
                altTag: {
                    type: 'string',
                    description: 'Set accessibility alt text',
                },
                originalUrl: {
                    type: ['string', 'null'],
                    description: 'Set the original source URL (use null or empty to clear)',
                },
                sourceUrl: {
                    type: ['string', 'null'],
                    description: 'Set the page/source URL (use null or empty to clear)',
                },
                namespace: {
                    type: 'string',
                    description: 'Move image to this namespace',
                },
                parentId: {
                    type: 'string',
                    description: 'Set as variant of another image (parent ID)',
                },
                variationSort: {
                    type: 'number',
                    description: 'Set ordering value for variants within a family',
                },
                clearExif: {
                    type: 'boolean',
                    description: 'If true, remove stored EXIF metadata',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_extras_get',
        description: 'Get additional image extras (stored outside Cloudflare metadata), such as custom descriptions or alt text overrides.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to retrieve extras for',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_extras_update',
        description: 'Update image extras (stored outside Cloudflare metadata). Set description/altText to null to clear.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to update',
                },
                description: {
                    type: ['string', 'null'],
                    description: 'Override description (null clears)',
                },
                altText: {
                    type: ['string', 'null'],
                    description: 'Override alt text (null clears)',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_swap_parent',
        description: 'Swap the parent image for a family of variants. New parent must be in the same family.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'Any image ID in the family (the requested target)',
                },
                newParentId: {
                    type: 'string',
                    description: 'The image ID that should become the new parent',
                },
                concurrency: {
                    type: 'number',
                    description: 'Max concurrent Cloudflare updates (default: 3, max: 8)',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, returns planned updates without applying changes',
                },
            },
            required: ['imageId', 'newParentId'],
        },
    },
    {
        name: 'photarium_delete_family',
        description: 'Delete an image family (parent + variants). Can run async and returns a jobId for polling.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'Image ID belonging to the family to delete',
                },
                confirm: {
                    type: 'string',
                    description: 'Required unless dryRun=true. Must be "DELETE_FAMILY"',
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, returns which IDs would be deleted without deleting',
                },
                concurrency: {
                    type: 'number',
                    description: 'Max concurrent Cloudflare deletes (default: 3, max: 8)',
                },
                async: {
                    type: 'boolean',
                    description: 'If true, run in background and return a jobId',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_delete_family_job',
        description: 'Fetch status for an async delete-family job by jobId.',
        inputSchema: {
            type: 'object',
            properties: {
                jobId: {
                    type: 'string',
                    description: 'Job ID returned from photarium_delete_family with async=true',
                },
            },
            required: ['jobId'],
        },
    },
    {
        name: 'photarium_share_url',
        description: 'Get a share URL for an image and variant size (redirect endpoint).',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The image ID to share',
                },
                variant: {
                    type: 'string',
                    description: 'Variant to use (e.g., public, thumbnail, small, medium, large, xlarge)',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_rotate',
        description: 'Rotate an image server-side and re-upload it as a new Cloudflare image.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The image ID to rotate',
                },
                direction: {
                    type: 'string',
                    enum: ['left', 'right'],
                    description: 'Rotate 90° left or right',
                },
                degrees: {
                    type: 'number',
                    description: 'Custom rotation degrees (overrides direction)',
                },
                auto: {
                    type: 'boolean',
                    description: 'If true, auto-rotate based on EXIF orientation',
                },
            },
            required: ['imageId'],
        },
    },
    {
        name: 'photarium_delete',
        description: 'Delete an image from the gallery. This action is permanent and cannot be undone.',
        inputSchema: {
            type: 'object',
            properties: {
                imageId: {
                    type: 'string',
                    description: 'The ID of the image to delete',
                },
            },
            required: ['imageId'],
        },
    },
];
