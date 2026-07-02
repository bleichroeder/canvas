import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  CANVAS_DB_PATH: z.string().default('./data/canvas.db'),
  CANVAS_WEB_DIR: z.string().default('/app/web'),
  CANVAS_ALLOWED_ORIGINS: z.string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((t) => t.trim()).filter(Boolean)),
  CANVAS_EXTERNAL_PROXY: z.string().optional().transform((v) => v === '1' || v === 'true'),
  CANVAS_DATA_DIR: z.string().default('/data'),
  TELEMETRY_ENABLED: z.string().optional().transform((v) => v !== 'false'),
  TELEMETRY_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  TELEMETRY_MAX_ROWS: z.coerce.number().int().min(1).default(1000),
});

export type Config = z.infer<typeof ConfigSchema> & { version: string };

export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = ConfigSchema.parse(env);
  return { ...parsed, version: env.npm_package_version ?? 'dev' };
}

function load(): Config {
  try {
    return parseConfig(process.env as Record<string, string | undefined>);
  } catch (err) {
    console.error('Invalid configuration:');
    if (err instanceof z.ZodError) {
      for (const issue of err.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`);
      }
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

export const config: Config = load();
