import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// One root .env for local launches. Explicit environment variables take precedence.
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const [service, mode] = process.argv.slice(2);
const require = createRequire(`${process.cwd()}/package.json`);
let command = process.execPath;
let args;
if (service === 'web' && ['dev', 'start'].includes(mode)) {
  args = [
    require.resolve('next/dist/bin/next'),
    mode,
    '--port',
    process.env.WEB_PORT ?? '3000',
    '--hostname',
    process.env.WEB_HOST ?? '127.0.0.1',
  ];
} else if (service === 'api' && mode === 'dev') {
  args = [require.resolve('@nestjs/cli/bin/nest.js'), 'start', '--watch'];
} else if (service === 'api' && mode === 'start') {
  args = ['dist/main.js'];
} else if (service === 'ai' && ['dev', 'start'].includes(mode)) {
  command = 'uv';
  args = [
    'run',
    '--locked',
    'uvicorn',
    'app.main:app',
    '--host',
    process.env.AI_HOST ?? '127.0.0.1',
    '--port',
    process.env.AI_PORT ?? '8000',
  ];
  if (mode === 'dev') args.push('--reload');
} else {
  throw new Error('Expected a known service and dev/start mode');
}

const child = spawn(command, args, { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  console.error(`Cannot start ${service}: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
