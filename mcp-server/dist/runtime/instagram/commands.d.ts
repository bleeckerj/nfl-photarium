export interface InstagramCommandResult {
    ok: boolean;
    exitCode: number;
    command: string[];
    stdout: string;
    stderr: string;
}
export declare function runInstagramAuth(options: {
    username: string;
    profileDir?: string;
    headful?: boolean;
    verbose?: boolean;
    noColor?: boolean;
}): Promise<InstagramCommandResult>;
export declare function runInstagramProfileIngest(options: {
    username: string;
    namespace: string;
    apiBase?: string;
    profileDir?: string;
    count?: number;
    maxPages?: number;
    delayMs?: number;
    requestDelayMs?: number;
    output?: string;
    checkpoint?: string;
    downloadDir?: string;
    pushCloudflare?: boolean;
    aiDisplayName?: boolean;
    skipVideoPush?: boolean;
    noResume?: boolean;
    headful?: boolean;
    verbose?: boolean;
    noColor?: boolean;
}): Promise<InstagramCommandResult>;
export declare function runInstagramSingleUrlIngest(options: {
    url: string;
    username?: string;
    namespace?: string;
    apiBase?: string;
    profileDir?: string;
    output?: string;
    requestDelayMs?: number;
    pushCloudflare?: boolean;
    noPushCloudflare?: boolean;
    headful?: boolean;
    verbose?: boolean;
    noColor?: boolean;
}): Promise<InstagramCommandResult>;
export declare function runInstagramVideoReplay(options: {
    input: string;
    namespace: string;
    username?: string;
    apiBase?: string;
    requestDelayMs?: number;
    verbose?: boolean;
    noColor?: boolean;
}): Promise<InstagramCommandResult>;
export declare function runInstagramVideoRecovery(options: {
    input: string;
    namespace: string;
    username?: string;
    apiBase?: string;
    requestDelayMs?: number;
    profileDir?: string;
    limit?: number;
    headful?: boolean;
    skipResolve?: boolean;
    skipReplay?: boolean;
    dryRun?: boolean;
    verbose?: boolean;
}): Promise<InstagramCommandResult>;
