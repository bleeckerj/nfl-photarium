import { spawn } from 'node:child_process';
export async function runCommandCapture(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', reject);
        child.on('close', (code) => {
            resolve({
                exitCode: typeof code === 'number' ? code : 1,
                stdout,
                stderr,
            });
        });
    });
}
