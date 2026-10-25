import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  ApplicationStatus,
  IdentifierStatus,
  IdentifierType,
  MotorcycleStatus,
  RecordStatus,
  SaleStatus,
  SaleType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/database/prisma.service';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { ExpensesService } from '../../src/modules/expenses/expenses.service';
import { MotorcyclesService } from '../../src/modules/motorcycles/motorcycles.service';
import { PercentagesService } from '../../src/modules/percentages/percentages.service';
import { ProceduresService } from '../../src/modules/procedures/procedures.service';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { SalesService } from '../../src/modules/sales/sales.service';
import {
  connectIntegrationDatabase,
  disconnectIntegrationDatabase,
  getIntegrationPrisma,
} from './database';

describe('SistemaMotos PostgreSQL integration', () => {
  let prisma: PrismaService;
  let customers: CustomersService;
  let motorcycles: MotorcyclesService;
  let sales: SalesService;
  let procedures: ProceduresService;
  let expenses: ExpensesService;
  let percentages: PercentagesService;
  let reports: ReportsService;

  const token = () => randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
  const today = () => new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    await connectIntegrationDatabase();
    prisma = getIntegrationPrisma() as unknown as PrismaService;
    customers = new CustomersService(prisma);
    motorcycles = new MotorcyclesService(prisma);
    sales = new SalesService(prisma);
    procedures = new ProceduresService(prisma);
    expenses = new ExpensesService(prisma);
    percentages = new PercentagesService(prisma);
    reports = new ReportsService(prisma);
  });

  afterAll(async () => disconnectIntegrationDatabase());

  async function createBrand() {
    const suffix = token();
    return prisma.brand.create({
      data: { name: `Integration ${suffix}`, normalized: `INTEGRATION_${suffix}` },
    });
  }

  async function createCustomer(fullName = `Cliente ${token()}`) {
    return customers.create({
      fullName,
      documentType: 'CC',
      documentNumber: token(),
    });
  }

  async function createMotorcycle(brandId: string, available = true, engineNumber = `ENG-${token()}`) {
    const suffix = token();
    const motorcycle = await motorcycles.create({
      brandId,
      line: 'Integration line',
      modelYear: 2026,
      color: 'Negro',
      displacementCc: 200,
      salePriceCop: '15000000.00',
      acquisitionCostCop: '11000000.00',
      engineNumber,
      chassisNumber: `CH-${suffix}`,
      plate: `I${suffix.slice(0, 5)}`,
    });
    if (available) return motorcycles.markAvailable(motorcycle.id, true);
    return motorcycle;
  }

  async function createConfirmedSale(options: { brandId?: string; customerId?: string } = {}) {
    const brand = options.brandId ? undefined : await createBrand();
    const customer = options.customerId ? undefined : await createCustomer();
    const motorcycle = await createMotorcycle(options.brandId ?? brand!.id, true);
    const draft = await sales.createDraft({
      motorcycleId: motorcycle.id,
      customerId: options.customerId ?? customer!.id,
      type: 'CASH',
    });
    const confirmed = await sales.confirm(draft.id);
    return { brand: brand ?? (await prisma.brand.findUniqueOrThrow({ where: { id: options.brandId! } })), customer, motorcycle, sale: confirmed };
  }

  async function createConfirmedProcedure(saleId: string, customerAmountCop = '1234567.89', businessCostCop = '100000.00') {
    const procedureType = await procedures.createType(`Trámite ${token()}`);
    const draft = await procedures.create(saleId, {
      procedureTypeId: procedureType.id,
      customerAmountCop,
      businessCostCop,
      procedureDate: today(),
    });
    return procedures.confirm(draft.id);
  }

  async function withFailingAudit(entityType: string, operation: string, run: () => Promise<unknown>) {
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `integration_fail_audit_${suffix}`;
    const triggerName = `integration_fail_audit_${suffix}`;
    const entityLiteral = entityType.replaceAll("'", "''");
    const operationLiteral = operation.replaceAll("'", "''");
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."entityType" = '${entityLiteral}' AND NEW."operation" = '${operationLiteral}' THEN
          RAISE EXCEPTION 'forced integration audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${functionName}"();`,
    );
    try {
      await expect(run()).rejects.toBeDefined();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "AuditEvent";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
    }
  }

  it('applied the migration and created essential tables, foreign keys and partial unique indexes', async () => {
    const migration = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      WHERE migration_name = '20261024000000_initial' AND rolled_back_at IS NULL
    `;
    expect(migration).toHaveLength(1);
    const appliedMigration = migration[0];
    if (!appliedMigration) throw new Error('No se encontró la migración inicial aplicada.');
    expect(appliedMigration.finished_at).toBeInstanceOf(Date);

    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(ARRAY[
          'Brand', 'Motorcycle', 'MotorcycleIdentifier', 'Customer', 'Sale',
          'ProcedureType', 'SaleProcedure', 'ExpenseCategory', 'MotorcycleExpense',
          'GeneralExpense', 'PercentageRule', 'PercentageApplication',
          'PercentageAdjustment', 'AuditEvent'
        ])
    `;
    expect(tables).toHaveLength(14);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'Customer_normalizedDocType_normalizedDocNumber_key',
          'MotorcycleIdentifier_active_unique',
          'Sale_one_confirmed_per_motorcycle',
          'GeneralExpense_replacesId_key'
        )
    `;
    const definitions = new Map(indexes.map((row) => [row.indexname, row.indexdef]));
    expect(definitions.size).toBe(4);
    expect(definitions.get('MotorcycleIdentifier_active_unique')?.replaceAll('"', '').toLowerCase()).toContain("where (status = 'active'::identifierstatus)");
    expect(definitions.get('Sale_one_confirmed_per_motorcycle')?.replaceAll('"', '').toLowerCase()).toContain("where (status = 'confirmed'::salestatus)");

    const foreignKeys = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM pg_constraint
      WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    `;
    const foreignKeyRow = foreignKeys[0];
    if (!foreignKeyRow) throw new Error('No se obtuvo el recuento de claves foráneas.');
    expect(Number(foreignKeyRow.count)).toBeGreaterThan(0);
    const foreignKeyDefinitions = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    `;
    expect(foreignKeyDefinitions.some((row) => row.definition.includes('ON DELETE RESTRICT'))).toBe(true);
  });

  it('normalizes customer documents and enforces their unique normalized pair in PostgreSQL', async () => {
    const document = token();
    const formattedDocument = `${document.slice(0, 5)}-${document.slice(5)}`;
    const first = await customers.create({
      fullName: `Documento ${token()}`,
      documentType: 'c.c.',
      documentNumber: formattedDocument,
    });
    expect(first.normalizedDocType).toBe('CC');
    expect(first.normalizedDocNumber).toBe(document);

    await expect(customers.create({
      fullName: `Duplicado ${token()}`,
      documentType: 'CC',
      documentNumber: document,
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('enforces active identifier uniqueness and allows reuse after the former identifier is replaced', async () => {
    const brand = await createBrand();
    const originalIdentifier = `ENG-${token()}`;
    const first = await createMotorcycle(brand.id, true, originalIdentifier);

    await expect(createMotorcycle(brand.id, true, originalIdentifier.toLowerCase())).rejects.toBeInstanceOf(ConflictException);

    await motorcycles.update(first.id, {
      engineNumber: `ENG-${token()}`,
      identifierChangeReason: 'Corrección de identificación en prueba de integración',
    });
    const historical = await prisma.motorcycleIdentifier.findFirstOrThrow({
      where: { motorcycleId: first.id, type: IdentifierType.ENGINE, status: IdentifierStatus.REPLACED },
    });
    expect(historical.replacedAt).toBeInstanceOf(Date);
    expect(historical.reason).toBe('Corrección de identificación en prueba de integración');

    const second = await createMotorcycle(brand.id, true, originalIdentifier);
    expect(await prisma.motorcycleIdentifier.findFirst({
      where: { motorcycleId: second.id, type: IdentifierType.ENGINE, status: IdentifierStatus.ACTIVE },
    })).not.toBeNull();
  });

  it('enforces foreign keys and restricted deletion for referenced business records', async () => {
    const brand = await createBrand();
    const customer = await createCustomer();
    const motorcycle = await createMotorcycle(brand.id);
    await sales.createDraft({ motorcycleId: motorcycle.id, customerId: customer.id, type: 'CASH' });
    await expect(prisma.brand.delete({ where: { id: brand.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.customer.delete({ where: { id: customer.id } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('keeps drafts non-reserving, confirms one sale, and requires an explicit return after cancellation', async () => {
    const brand = await createBrand();
    const customer = await createCustomer();
    const motorcycle = await createMotorcycle(brand.id);
    const firstDraft = await sales.createDraft({ motorcycleId: motorcycle.id, customerId: customer.id, type: 'CASH' });
    const secondDraft = await sales.createDraft({ motorcycleId: motorcycle.id, customerId: customer.id, type: 'CREDIT' });
    expect(await prisma.motorcycle.findUniqueOrThrow({ where: { id: motorcycle.id } })).toMatchObject({ status: MotorcycleStatus.AVAILABLE });

    await sales.confirm(firstDraft.id);
    await expect(sales.confirm(secondDraft.id)).rejects.toBeInstanceOf(ConflictException);
    const duplicateConfirmed = await prisma.sale.create({
      data: { motorcycleId: motorcycle.id, customerId: customer.id, type: SaleType.CASH, motorcyclePriceCop: '15000000.00' },
    });
    await expect(prisma.sale.update({ where: { id: duplicateConfirmed.id }, data: { status: SaleStatus.CONFIRMED } })).rejects.toMatchObject({ code: 'P2002' });

    await expect(sales.cancel(firstDraft.id, '   ')).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.sale.findUniqueOrThrow({ where: { id: firstDraft.id } })).toMatchObject({ status: SaleStatus.CONFIRMED });
    await sales.cancel(firstDraft.id, 'Cancelación de prueba');
    expect(await prisma.motorcycle.findUniqueOrThrow({ where: { id: motorcycle.id } })).toMatchObject({ status: MotorcycleStatus.SOLD });
    expect(await prisma.auditEvent.findFirst({ where: { entityType: 'Sale', entityId: firstDraft.id, operation: 'CANCEL' } })).not.toBeNull();

    await sales.returnAvailable(motorcycle.id, 'Revisión física aprobada');
    expect(await prisma.motorcycle.findUniqueOrThrow({ where: { id: motorcycle.id } })).toMatchObject({ status: MotorcycleStatus.AVAILABLE });
  });

  it('rolls back sale confirmation and motorcycle state when the transactional audit insert fails', async () => {
    const brand = await createBrand();
    const nextMotorcycle = await createMotorcycle(brand.id);
    const customer = await createCustomer();
    const draft = await sales.createDraft({ motorcycleId: nextMotorcycle.id, customerId: customer.id, type: 'CASH' });

    await withFailingAudit('Sale', 'CONFIRM', () => sales.confirm(draft.id));
    expect(await prisma.sale.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: SaleStatus.DRAFT });
    expect(await prisma.motorcycle.findUniqueOrThrow({ where: { id: nextMotorcycle.id } })).toMatchObject({ status: MotorcycleStatus.AVAILABLE });
    expect(await prisma.auditEvent.findFirst({ where: { entityType: 'Sale', entityId: draft.id, operation: 'CONFIRM' } })).toBeNull();

    const confirmed = await createConfirmedSale();
    await withFailingAudit('Sale', 'CANCEL', () => sales.cancel(confirmed.sale.id, 'Fallo de auditoría esperado'));
    expect(await prisma.sale.findUniqueOrThrow({ where: { id: confirmed.sale.id } })).toMatchObject({ status: SaleStatus.CONFIRMED });
    expect(await prisma.motorcycle.findUniqueOrThrow({ where: { id: confirmed.motorcycle.id } })).toMatchObject({ status: MotorcycleStatus.SOLD });
    expect(await prisma.auditEvent.findFirst({ where: { entityType: 'Sale', entityId: confirmed.sale.id, operation: 'CANCEL' } })).toBeNull();
  });

  it('voids and replaces a procedure with a reason, preserving the original and audit history', async () => {
    const { sale } = await createConfirmedSale();
    const original = await createConfirmedProcedure(sale.id);
    await expect(procedures.void(original.id, '   ')).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.saleProcedure.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ status: RecordStatus.CONFIRMED });

    await procedures.void(original.id, 'Dato corregido');
    const replacement = await procedures.create(sale.id, {
      procedureTypeId: original.procedureTypeId,
      customerAmountCop: '1234567.89',
      businessCostCop: '100000.00',
      procedureDate: today(),
      replacesId: original.id,
    });
    expect(replacement.replacesId).toBe(original.id);
    await expect(prisma.saleProcedure.create({
      data: {
        saleId: sale.id,
        procedureTypeId: original.procedureTypeId,
        nameSnapshot: original.nameSnapshot,
        customerAmountCop: '1.00',
        businessCostCop: '0.00',
        procedureDate: new Date(`${today()}T00:00:00.000Z`),
        replacesId: original.id,
      },
    })).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.auditEvent.findFirst({ where: { entityType: 'SaleProcedure', entityId: original.id, operation: 'VOID' } })).not.toBeNull();
  });

  it('voids and replaces motorcycle and general expenses using real foreign keys and unique replacement constraints', async () => {
    const brand = await createBrand();
    const motorcycle = await createMotorcycle(brand.id);
    const motoCategory = await expenses.createCategory({ name: `Moto ${token()}`, scope: 'MOTORCYCLE' });
    const generalCategory = await expenses.createCategory({ name: `General ${token()}`, scope: 'GENERAL' });

    const motoExpense = await expenses.createMotorcycle(motorcycle.id, { categoryId: motoCategory.id, expenseDate: today(), description: 'Gasto moto', amountCop: '250000.00' });
    await expenses.confirmMotorcycle(motoExpense.id);
    await expect(expenses.voidMotorcycle(motoExpense.id, '   ')).rejects.toBeInstanceOf(BadRequestException);
    await expenses.voidMotorcycle(motoExpense.id, 'Corrección documentada');
    const motoReplacement = await expenses.createMotorcycle(motorcycle.id, { categoryId: motoCategory.id, expenseDate: today(), description: 'Reemplazo moto', amountCop: '250000.00', replacesId: motoExpense.id });
    expect(motoReplacement.replacesId).toBe(motoExpense.id);

    const generalExpense = await expenses.createGeneral({ categoryId: generalCategory.id, expenseDate: today(), description: 'Gasto general', amountCop: '500000.00' });
    await expenses.confirmGeneral(generalExpense.id);
    await expenses.voidGeneral(generalExpense.id, 'Corrección documentada');
    const generalReplacement = await expenses.createGeneral({ categoryId: generalCategory.id, expenseDate: today(), description: 'Reemplazo general', amountCop: '500000.00', replacesId: generalExpense.id });
    expect(generalReplacement.replacesId).toBe(generalExpense.id);

    await expect(prisma.generalExpense.create({
      data: { categoryId: generalCategory.id, expenseDate: new Date(`${today()}T00:00:00.000Z`), description: 'Segundo reemplazo', amountCop: '1.00', replacesId: generalExpense.id },
    })).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.auditEvent.findFirst({ where: { entityType: 'MotorcycleExpense', entityId: motoExpense.id, operation: 'VOID' } })).not.toBeNull();
    expect(await prisma.auditEvent.findFirst({ where: { entityType: 'GeneralExpense', entityId: generalExpense.id, operation: 'VOID' } })).not.toBeNull();
  });

  it('commits procedure and expense state transitions only together with their audit events', async () => {
    const { sale } = await createConfirmedSale();
    const procedureType = await procedures.createType(`Atomic ${token()}`);
    const procedure = await procedures.create(sale.id, {
      procedureTypeId: procedureType.id,
      customerAmountCop: '10.00',
      businessCostCop: '2.00',
      procedureDate: today(),
    });

    await withFailingAudit('SaleProcedure', 'CONFIRM', () => procedures.confirm(procedure.id));
    expect(await prisma.saleProcedure.findUniqueOrThrow({ where: { id: procedure.id } })).toMatchObject({ status: RecordStatus.DRAFT });
    expect(await prisma.auditEvent.count({ where: { entityType: 'SaleProcedure', entityId: procedure.id } })).toBe(0);
    await procedures.confirm(procedure.id);
    await expect(procedures.confirm(procedure.id)).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.auditEvent.count({ where: { entityType: 'SaleProcedure', entityId: procedure.id, operation: 'CONFIRM' } })).toBe(1);

    await withFailingAudit('SaleProcedure', 'VOID', () => procedures.void(procedure.id, 'Fallo controlado'));
    expect(await prisma.saleProcedure.findUniqueOrThrow({ where: { id: procedure.id } })).toMatchObject({ status: RecordStatus.CONFIRMED, voidReason: null });
    expect(await prisma.auditEvent.count({ where: { entityType: 'SaleProcedure', entityId: procedure.id, operation: 'VOID' } })).toBe(0);
    await procedures.void(procedure.id, 'Anulación comprobada');

    const brand = await createBrand();
    const motorcycle = await createMotorcycle(brand.id);
    const motoCategory = await expenses.createCategory({ name: `Atomic moto ${token()}`, scope: 'MOTORCYCLE' });
    const generalCategory = await expenses.createCategory({ name: `Atomic general ${token()}`, scope: 'GENERAL' });
    const motoExpense = await expenses.createMotorcycle(motorcycle.id, { categoryId: motoCategory.id, expenseDate: today(), description: 'Atomic motorcycle expense', amountCop: '20.00' });
    const generalExpense = await expenses.createGeneral({ categoryId: generalCategory.id, expenseDate: today(), description: 'Atomic general expense', amountCop: '30.00' });

    await withFailingAudit('MotorcycleExpense', 'CONFIRM', () => expenses.confirmMotorcycle(motoExpense.id));
    expect(await prisma.motorcycleExpense.findUniqueOrThrow({ where: { id: motoExpense.id } })).toMatchObject({ status: RecordStatus.DRAFT });
    expect(await prisma.auditEvent.count({ where: { entityType: 'MotorcycleExpense', entityId: motoExpense.id } })).toBe(0);
    await expenses.confirmMotorcycle(motoExpense.id);
    await expect(expenses.confirmMotorcycle(motoExpense.id)).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.auditEvent.count({ where: { entityType: 'MotorcycleExpense', entityId: motoExpense.id, operation: 'CONFIRM' } })).toBe(1);

    await withFailingAudit('MotorcycleExpense', 'VOID', () => expenses.voidMotorcycle(motoExpense.id, 'Fallo controlado'));
    expect(await prisma.motorcycleExpense.findUniqueOrThrow({ where: { id: motoExpense.id } })).toMatchObject({ status: RecordStatus.CONFIRMED, voidReason: null });
    expect(await prisma.auditEvent.count({ where: { entityType: 'MotorcycleExpense', entityId: motoExpense.id, operation: 'VOID' } })).toBe(0);
    await expenses.voidMotorcycle(motoExpense.id, 'Anulación comprobada');

    await withFailingAudit('GeneralExpense', 'CONFIRM', () => expenses.confirmGeneral(generalExpense.id));
    expect(await prisma.generalExpense.findUniqueOrThrow({ where: { id: generalExpense.id } })).toMatchObject({ status: RecordStatus.DRAFT });
    expect(await prisma.auditEvent.count({ where: { entityType: 'GeneralExpense', entityId: generalExpense.id } })).toBe(0);
    await expenses.confirmGeneral(generalExpense.id);
    await expect(expenses.confirmGeneral(generalExpense.id)).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.auditEvent.count({ where: { entityType: 'GeneralExpense', entityId: generalExpense.id, operation: 'CONFIRM' } })).toBe(1);

    await withFailingAudit('GeneralExpense', 'VOID', () => expenses.voidGeneral(generalExpense.id, 'Fallo controlado'));
    expect(await prisma.generalExpense.findUniqueOrThrow({ where: { id: generalExpense.id } })).toMatchObject({ status: RecordStatus.CONFIRMED, voidReason: null });
    expect(await prisma.auditEvent.count({ where: { entityType: 'GeneralExpense', entityId: generalExpense.id, operation: 'VOID' } })).toBe(0);
    await expenses.voidGeneral(generalExpense.id, 'Anulación comprobada');
  });

  it('persists concurrent percentage rule versions without duplicates', async () => {
    const brand = await createBrand();
    const attempts = Array.from({ length: 6 }, (_, index) => percentages.createRule({
      brandId: brand.id,
      ratePercent: `${index + 1}.0000`,
      effectiveFrom: today(),
      approvedBusinessRule: true,
    }));
    const results = await Promise.allSettled(attempts);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected.every((result) => result.reason instanceof ConflictException)).toBe(true);

    const persisted = await prisma.percentageRule.findMany({ where: { brandId: brand.id }, orderBy: { version: 'asc' } });
    expect(persisted.length).toBeGreaterThan(0);
    expect(new Set(persisted.map((rule) => rule.version)).size).toBe(persisted.length);
    expect(persisted.map((rule) => rule.version)).toEqual(Array.from({ length: persisted.length }, (_, i) => i + 1));
  });

  it('rejects rules for inactive brands and applications with wrong-brand or expired rules', async () => {
    const inactive = await createBrand();
    await prisma.brand.update({ where: { id: inactive.id }, data: { active: false } });
    await expect(percentages.createRule({ brandId: inactive.id, ratePercent: '4.0000', effectiveFrom: today(), approvedBusinessRule: true })).rejects.toBeInstanceOf(BadRequestException);

    const { brand, sale } = await createConfirmedSale();
    await createConfirmedProcedure(sale.id);
    const expired = await percentages.createRule({ brandId: brand.id, ratePercent: '4.0000', effectiveFrom: '2020-01-01', approvedBusinessRule: true });
    await percentages.closeRule(expired.id, '2020-01-02');
    const otherBrand = await createBrand();
    const otherRule = await percentages.createRule({ brandId: otherBrand.id, ratePercent: '5.0000', effectiveFrom: today(), approvedBusinessRule: true });

    await expect(percentages.apply(sale.id, { ruleId: expired.id, confirmed: true, reason: 'Regla vencida' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(percentages.apply(sale.id, { ruleId: otherRule.id, confirmed: true, reason: 'Marca incorrecta' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.percentageApplication.findUnique({ where: { saleId: sale.id } })).toBeNull();
  });

  it('persists percentage snapshots, signed adjustments and audit events without calculating an adjusted total', async () => {
    const { brand, sale } = await createConfirmedSale();
    const procedure = await createConfirmedProcedure(sale.id);
    const rule = await percentages.createRule({ brandId: brand.id, ratePercent: '4.0000', effectiveFrom: today(), approvedBusinessRule: true });
    const application = await percentages.apply(sale.id, { ruleId: rule.id, confirmed: true, reason: 'Aplicación aprobada para integración' });
    const persisted = await prisma.percentageApplication.findUniqueOrThrow({ where: { id: application.id } });
    expect(persisted.brandNameSnapshot).toBe(brand.name);
    expect(persisted.ratePercentSnapshot.toFixed(4)).toBe('4.0000');
    expect(persisted.baseCop.toFixed(2)).toBe('1134567.89');
    expect(persisted.amountCop.toFixed(2)).toBe('45383.00');
    expect(persisted.appliedAt).toBeInstanceOf(Date);
    expect(persisted.status).toBe(ApplicationStatus.APPLIED);
    expect(procedure.status).toBe(RecordStatus.CONFIRMED);

    await percentages.adjust(application.id, { amountDeltaCop: '100.00', reason: 'Ajuste positivo auditado' });
    await percentages.adjust(application.id, { amountDeltaCop: '-50.00', reason: 'Ajuste negativo auditado' });
    const adjustments = await prisma.percentageAdjustment.findMany({ where: { applicationId: application.id }, orderBy: { createdAt: 'asc' } });
    expect(adjustments.map((row) => row.amountDeltaCop.toFixed(2))).toEqual(['100.00', '-50.00']);
    const listed = await percentages.listApplications(sale.id);
    expect(listed[0]?.amountCop.toFixed(2)).toBe('45383.00');
    expect(listed[0]?.currentAmountCop).toBe('45433.00');
    expect(await prisma.auditEvent.count({ where: { entityType: 'PercentageApplication', entityId: application.id, operation: 'MANUAL_ADJUSTMENT' } })).toBe(2);
    // The business rule for applying adjustment deltas to a current report total remains undecided.
  });

  it('stores a non-positive percentage base for manual review with zero automatic amount', async () => {
    const { brand, sale } = await createConfirmedSale();
    await createConfirmedProcedure(sale.id, '0.00', '1.00');
    const rule = await percentages.createRule({ brandId: brand.id, ratePercent: '4.0000', effectiveFrom: today(), approvedBusinessRule: true });
    const application = await percentages.apply(sale.id, { ruleId: rule.id, confirmed: true, reason: 'Revisión manual del caso' });
    expect(application.baseCop.toFixed(2)).toBe('-1.00');
    expect(application.amountCop.toFixed(2)).toBe('0.00');
    expect(application.status).toBe(ApplicationStatus.REVIEW_REQUIRED);
  });

  it('rolls back percentage applications and adjustments when their transactional audit insert fails', async () => {
    const { brand, sale } = await createConfirmedSale();
    await createConfirmedProcedure(sale.id);
    const rule = await percentages.createRule({ brandId: brand.id, ratePercent: '3.5000', effectiveFrom: today(), approvedBusinessRule: true });

    await withFailingAudit('PercentageApplication', 'MANUAL_APPLY', () => percentages.apply(sale.id, { ruleId: rule.id, confirmed: true, reason: 'Fallo de auditoría esperado' }));
    expect(await prisma.percentageApplication.findUnique({ where: { saleId: sale.id } })).toBeNull();

    const { brand: brand2, sale: sale2 } = await createConfirmedSale();
    await createConfirmedProcedure(sale2.id);
    const rule2 = await percentages.createRule({ brandId: brand2.id, ratePercent: '3.5000', effectiveFrom: today(), approvedBusinessRule: true });
    const app = await percentages.apply(sale2.id, { ruleId: rule2.id, confirmed: true, reason: 'Aplicación previa' });
    await withFailingAudit('PercentageApplication', 'MANUAL_ADJUSTMENT', () => percentages.adjust(app.id, { amountDeltaCop: '-2.00', reason: 'Fallo de auditoría esperado' }));
    expect(await prisma.percentageAdjustment.count({ where: { applicationId: app.id } })).toBe(0);
  });

  it('reads reports and CSV from PostgreSQL, including cancelled sales by saleDate and decimal amounts', async () => {
    const { sale, brand } = await createConfirmedSale();
    const procedureType = await procedures.createType(`CSV ${token()}`);
    const procedureDraft = await procedures.create(sale.id, {
      procedureTypeId: procedureType.id,
      customerAmountCop: '1.25',
      businessCostCop: '0.25',
      procedureDate: today(),
      description: '=HYPERLINK("https://example.invalid","x")',
    });
    await procedures.confirm(procedureDraft.id);
    const expenseCategory = await expenses.createCategory({ name: `CSV ${token()}`, scope: 'GENERAL' });
    const expense = await expenses.createGeneral({ categoryId: expenseCategory.id, expenseDate: today(), description: 'CSV expense', amountCop: '1234.56' });
    await expenses.confirmGeneral(expense.id);
    const rule = await percentages.createRule({ brandId: brand.id, ratePercent: '5.0000', effectiveFrom: today(), approvedBusinessRule: true });
    const application = await percentages.apply(sale.id, { ruleId: rule.id, confirmed: true, reason: 'Reporte de integración' });

    const reviewSale = await createConfirmedSale({ brandId: brand.id });
    await createConfirmedProcedure(reviewSale.sale.id, '0.00', '1.00');
    const reviewRule = await percentages.createRule({ brandId: brand.id, ratePercent: '6.0000', effectiveFrom: today(), approvedBusinessRule: true });
    await percentages.apply(reviewSale.sale.id, { ruleId: reviewRule.id, confirmed: true, reason: 'Base negativa para exportación' });

    const cancelled = await createConfirmedSale();
    await sales.cancel(cancelled.sale.id, 'Cancelación para reporte');
    const from = today();
    const salesReport = await reports.sales(from, from);
    expect(salesReport.some((row) => row.id === sale.id)).toBe(true);
    expect(salesReport.some((row) => row.id === cancelled.sale.id && row.status === SaleStatus.CANCELLED)).toBe(true);

    const summary = await reports.summary(from, from);
    expect(summary.historicalCancelledSales.some((row) => row.id === cancelled.sale.id)).toBe(true);
    const percentageReport = await reports.percentages(from, from);
    expect(percentageReport.current.some((row) => row.id === application.id)).toBe(true);
    expect(percentageReport.current.find((row) => row.id === application.id)?.currentAmountCop).toBe('0.00');

    const csv = await reports.export('sales', from, from);
    expect(csv).toContain('15000000');
    expect(csv).toContain(sale.id);
    const percentagesCsv = await reports.export('percentages', from, from);
    expect(percentagesCsv).toContain('"5"');
    expect(percentagesCsv).toContain(application.id);
    expect(percentagesCsv).toContain('currentAmountCop');
    expect(percentagesCsv).toContain('"-1"');

    const proceduresCsv = await reports.export('procedures', from, from);
    expect(proceduresCsv).toContain(procedureDraft.id);
    expect(proceduresCsv).toContain("'=HYPERLINK(");
    expect(proceduresCsv).toContain('""https://example.invalid""');
    const expensesCsv = await reports.export('expenses', from, from);
    expect(expensesCsv).toContain(expense.id);
    expect(expensesCsv).toContain('1234.56');

    const empty = await reports.sales('1900-01-01', '1900-01-01');
    expect(empty).toEqual([]);
    expect(rule.brandId).toBe(brand.id);
  });
});
