export declare function runCommandCapture(command: string, args: string[], options?: {
    cwd?: string;
}): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
}>;
