export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  DATABASE_URL: string;
  REDIS_URL: string;
  API_PORT: number;
  API_HOST: string;
  API_CORS_ORIGINS: string[];
}

function requiredUrl(input: Record<string, unknown>, key: string, protocols: string[]): string {
  const value = input[key];
  if (typeof value !== 'string') throw new Error(`${key} is required`);
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol) || !url.hostname) throw new Error();
  } catch {
    throw new Error(`${key} must be a valid ${protocols.join('/')} URL`);
  }
  return value;
}

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const nodeEnv = input.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test or production');
  }
  const port = Number(input.API_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  const rawOrigins = input.API_CORS_ORIGINS ?? '';
  if (typeof rawOrigins !== 'string') throw new Error('API_CORS_ORIGINS must be a string');
  const origins = rawOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error();
    } catch {
      throw new Error('API_CORS_ORIGINS must contain explicit HTTP(S) origins');
    }
  }
  const host = input.API_HOST ?? '127.0.0.1';
  if (typeof host !== 'string' || !host.trim()) throw new Error('API_HOST must be non-empty');

  return {
    NODE_ENV: nodeEnv,
    DATABASE_URL: requiredUrl(input, 'DATABASE_URL', ['postgres:', 'postgresql:']),
    REDIS_URL: requiredUrl(input, 'REDIS_URL', ['redis:', 'rediss:']),
    API_PORT: port,
    API_HOST: host,
    API_CORS_ORIGINS: origins,
  };
}
