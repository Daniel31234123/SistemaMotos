import { spawnSync } from 'node:child_process';
import { connectIntegrationDatabase, disconnectIntegrationDatabase } from './database';

async function main(): Promise<void> {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL es obligatoria; no se ejecutaron migraciones.');
  }

  // This performs both the URL-name guard and SELECT current_database() check.
  await connectIntegrationDatabase();
  await disconnectIntegrationDatabase();

  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error('Ejecuta esta operación con npm run test:integration:migrate.');
  }

  const result = spawnSync(
    process.execPath,
    [npmCli, 'run', 'prisma:migrate:deploy'],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: 'inherit',
      windowsHide: true,
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error('Falló prisma:migrate:deploy para la base de integración; revisa el error del comando.');
  }
}

main().catch((error: unknown) => {
  // Avoid printing environment-derived connection strings from driver errors.
  const message = error instanceof Error ? error.message : 'Error desconocido';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
