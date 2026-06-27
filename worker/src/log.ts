export const log = {
  info: (msg: string, ...args: unknown[]) => console.log('[info]', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn('[warn]', msg, ...args),
  error: (msg: string, ...args: unknown[]) => console.error('[err]', msg, ...args),
};
