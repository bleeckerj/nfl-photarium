import { apiRequest } from '../shared/api-client.js';
export async function createBackup(options = {}) {
    return apiRequest('/api/backup', {
        method: 'POST',
        body: JSON.stringify(options),
    });
}
export async function listBackups() {
    return apiRequest('/api/backup');
}
