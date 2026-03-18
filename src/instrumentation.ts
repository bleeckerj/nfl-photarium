export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { installLocalTimestampConsole } = await import('@/server/localTimestampConsole.node');
  installLocalTimestampConsole();
}
