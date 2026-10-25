import { PrismaClient } from '@prisma/client';

const EXPECTED_DATABASE = 'sistema_motos_integration_test';

let client: PrismaClient | undefined;
let verified = false;

function testDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error('TEST_DATABASE_URL es obligatoria para las pruebas de integración.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL no es una URL válida; no se intentó conectar.');
  }

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.pathname !== `/${EXPECTED_DATABASE}`
  ) {
    throw new Error(
      `La conexión de integración debe apuntar exactamente a ${EXPECTED_DATABASE}; no se intentó conectar.`,
    );
  }

  return value;
}

export async function connectIntegrationDatabase(): Promise<PrismaClient> {
  if (client && verified) return client;

  const datasourceUrl = testDatabaseUrl();
  const candidate = new PrismaClient({ datasourceUrl });

  try {
    await candidate.$connect();
    const rows = await candidate.$queryRaw<Array<{ database_name: string }>>`
      SELECT current_database() AS database_name
    `;

    if (rows[0]?.database_name !== EXPECTED_DATABASE) {
      throw new Error('La base conectada no coincide con la base de integración esperada.');
    }

    client = candidate;
    verified = true;
    return candidate;
  } catch {
    await candidate.$disconnect().catch(() => undefined);
    throw new Error(
      'Falló la conexión o la verificación de la base de integración; los detalles de conexión se omitieron.',
    );
  }
}

export function getIntegrationPrisma(): PrismaClient {
  if (!client || !verified) {
    throw new Error('La base de integración no pasó la verificación previa a la prueba.');
  }
  return client;
}

export async function disconnectIntegrationDatabase(): Promise<void> {
  if (client) await client.$disconnect();
  client = undefined;
  verified = false;
}
