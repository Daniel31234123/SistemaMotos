import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
async function main(): Promise<void> {
  for (const name of ['Bajaj', 'Auteco']) {
    const normalized = name.toLocaleLowerCase('es-CO');
    await prisma.brand.upsert({ where: { normalized }, update: {}, create: { name, normalized } });
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
