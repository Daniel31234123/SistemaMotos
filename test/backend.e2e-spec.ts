import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, RecordStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { PrismaService } from '../src/database/prisma.service';
import { getIntegrationPrisma } from './integration/database';

describe('SistemaMotos HTTP end-to-end', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const token = () => randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
  const date = () => new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    prisma = getIntegrationPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new PrismaExceptionFilter());
    await app.init();
  });

  afterAll(async () => app?.close());

  async function createAvailableInventory() {
    const suffix = token();
    const brandResponse = await request(app.getHttpServer())
      .post('/api/v1/brands').send({ name: `E2E ${suffix}` }).expect(201);
    const brandId = brandResponse.body.id as string;
    const motorcycleResponse = await request(app.getHttpServer())
      .post('/api/v1/motorcycles')
      .send({
        brandId,
        line: 'E2E Line',
        modelYear: 2026,
        color: 'Azul',
        displacementCc: 200,
        salePriceCop: '15000000.00',
        acquisitionCostCop: '11000000.00',
        engineNumber: `E-${suffix}`,
        chassisNumber: `C-${suffix}`,
        plate: `P${suffix.slice(0, 5)}`,
      })
      .expect(201);
    const motorcycleId = motorcycleResponse.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/motorcycles/${motorcycleId}/availability`).send({ readyToOffer: true }).expect(201);
    const customerResponse = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .send({ fullName: `E2E Cliente ${suffix}`, documentType: 'CC', documentNumber: suffix })
      .expect(201);
    return { brandId, motorcycleId, customerId: customerResponse.body.id as string };
  }

  it('serves health, brands, motorcycle availability and customer CRUD with DTO validation', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200).expect({ status: 'ok' });
    const inventory = await createAvailableInventory();

    const brands = await request(app.getHttpServer()).get('/api/v1/brands').expect(200);
    expect(brands.body.some((brand: { id: string }) => brand.id === inventory.brandId)).toBe(true);
    const motorcycles = await request(app.getHttpServer())
      .get('/api/v1/motorcycles').query({ brandId: inventory.brandId, status: 'AVAILABLE' }).expect(200);
    expect(motorcycles.body.some((motorcycle: { id: string; status: string }) => motorcycle.id === inventory.motorcycleId && motorcycle.status === 'AVAILABLE')).toBe(true);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${inventory.customerId}`).send({ phone: '+57 300 000 0000' }).expect(200);
    expect(updated.body.phone).toBe('+57 300 000 0000');
    await request(app.getHttpServer()).get(`/api/v1/customers/${inventory.customerId}`).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers').send({ fullName: 'Invalid customer' }).expect(400);

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: inventory.customerId } });
    await request(app.getHttpServer()).post('/api/v1/customers').send({
      fullName: 'Duplicate normalized document',
      documentType: customer.documentType.toLowerCase(),
      documentNumber: `-${customer.documentNumber}-`,
    }).expect(409);
  });

  it('runs sales, procedures, expenses and their audited state changes over HTTP', async () => {
    const inventory = await createAvailableInventory();
    const draftResponse = await request(app.getHttpServer()).post('/api/v1/sales').send({
      motorcycleId: inventory.motorcycleId, customerId: inventory.customerId, type: 'CASH',
    }).expect(201);
    const saleId = draftResponse.body.id as string;
    expect(draftResponse.body.status).toBe('DRAFT');
    await request(app.getHttpServer()).post(`/api/v1/sales/${saleId}/confirm`).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/sales/${saleId}/cancel`).send({ reason: '   ' }).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/sales/${saleId}/cancel`).send({ reason: 'Venta cancelada en E2E' }).expect(201);
    const afterCancel = await request(app.getHttpServer()).get(`/api/v1/motorcycles/${inventory.motorcycleId}`).expect(200);
    expect(afterCancel.body.status).toBe('SOLD');
    await request(app.getHttpServer()).post(`/api/v1/motorcycles/${inventory.motorcycleId}/return-available`).send({ reason: ' ' }).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/motorcycles/${inventory.motorcycleId}/return-available`).send({ reason: 'Revisión E2E' }).expect(201);

    const nextSale = await request(app.getHttpServer()).post('/api/v1/sales').send({
      motorcycleId: inventory.motorcycleId, customerId: inventory.customerId, type: 'CREDIT',
    }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/sales/${nextSale.body.id}/confirm`).expect(201);

    const type = await request(app.getHttpServer()).post('/api/v1/procedure-types').send({ name: `E2E trámite ${token()}` }).expect(201);
    const procedure = await request(app.getHttpServer()).post(`/api/v1/sales/${nextSale.body.id}/procedures`).send({
      procedureTypeId: type.body.id,
      customerAmountCop: '100.25',
      businessCostCop: '25.00',
      procedureDate: date(),
      description: 'Trámite confirmado por HTTP',
    }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/procedures/${procedure.body.id}/confirm`).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/procedures/${procedure.body.id}/void`).send({ reason: '   ' }).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/procedures/${procedure.body.id}/void`).send({ reason: 'Corrección E2E' }).expect(201);
    const replacement = await request(app.getHttpServer()).post(`/api/v1/sales/${nextSale.body.id}/procedures`).send({
      procedureTypeId: type.body.id,
      customerAmountCop: '100.25',
      businessCostCop: '25.00',
      procedureDate: date(),
      replacesId: procedure.body.id,
    }).expect(201);
    expect(replacement.body.replacesId).toBe(procedure.body.id);

    const motorcycleCategory = await request(app.getHttpServer()).post('/api/v1/expense-categories').send({ name: `E2E moto ${token()}`, scope: 'MOTORCYCLE' }).expect(201);
    const generalCategory = await request(app.getHttpServer()).post('/api/v1/expense-categories').send({ name: `E2E general ${token()}`, scope: 'GENERAL' }).expect(201);
    const motoExpense = await request(app.getHttpServer()).post(`/api/v1/motorcycles/${inventory.motorcycleId}/expenses`).send({
      categoryId: motorcycleCategory.body.id, expenseDate: date(), description: 'Gasto moto E2E', amountCop: '250.00',
    }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/expenses/motorcycle/${motoExpense.body.id}/confirm`).expect(201);
    const generalExpense = await request(app.getHttpServer()).post('/api/v1/general-expenses').send({
      categoryId: generalCategory.body.id, expenseDate: date(), description: 'Gasto general E2E', amountCop: '1234.56',
    }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/expenses/general/${generalExpense.body.id}/confirm`).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/expenses/motorcycle/${motoExpense.body.id}/void`).send({ reason: ' ' }).expect(400);
    await request(app.getHttpServer()).post(`/api/v1/expenses/motorcycle/${motoExpense.body.id}/void`).send({ reason: 'Anulación E2E' }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/expenses/general/${generalExpense.body.id}/void`).send({ reason: 'Anulación E2E' }).expect(201);

    const motoAudit = await prisma.auditEvent.findMany({ where: { entityId: motoExpense.body.id }, orderBy: { occurredAt: 'asc' } });
    expect(motoAudit.map((event) => event.operation)).toEqual(['CONFIRM', 'VOID']);
    const generalAudit = await prisma.auditEvent.findMany({ where: { entityId: generalExpense.body.id }, orderBy: { occurredAt: 'asc' } });
    expect(generalAudit.map((event) => event.operation)).toEqual(['CONFIRM', 'VOID']);
    expect(await prisma.saleProcedure.findUniqueOrThrow({ where: { id: replacement.body.id } })).toMatchObject({ status: RecordStatus.DRAFT });
  });

  it('applies commercial percentages, exposes adjusted amounts, serves reports and returns safe CSV over HTTP', async () => {
    const inventory = await createAvailableInventory();
    const sale = await request(app.getHttpServer()).post('/api/v1/sales').send({
      motorcycleId: inventory.motorcycleId, customerId: inventory.customerId, type: 'CASH',
    }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/sales/${sale.body.id}/confirm`).expect(201);
    const type = await request(app.getHttpServer()).post('/api/v1/procedure-types').send({ name: `CSV ${token()}` }).expect(201);
    const procedure = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.body.id}/procedures`).send({
      procedureTypeId: type.body.id,
      customerAmountCop: '100.25',
      businessCostCop: '25.00',
      procedureDate: date(),
      description: '=HYPERLINK("https://example.invalid","CSV, prueba")',
    }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/procedures/${procedure.body.id}/confirm`).expect(201);

    const rule = await request(app.getHttpServer()).post('/api/v1/percentage-rules').send({
      brandId: inventory.brandId, ratePercent: '4.0000', effectiveFrom: date(), approvedBusinessRule: true,
    }).expect(201);
    const suggestions = await request(app.getHttpServer()).get(`/api/v1/sales/${sale.body.id}/percentage-rules`).expect(200);
    expect(suggestions.body.rules.some((row: { id: string }) => row.id === rule.body.id)).toBe(true);
    const application = await request(app.getHttpServer()).post(`/api/v1/sales/${sale.body.id}/percentage-applications`).send({
      ruleId: rule.body.id, confirmed: true, reason: 'Regla revisada en E2E',
    }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/percentage-applications/${application.body.id}/adjustments`).send({
      amountDeltaCop: '5.25', reason: 'Ajuste positivo E2E',
    }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/percentage-applications/${application.body.id}/adjustments`).send({
      amountDeltaCop: '-1.25', reason: 'Ajuste negativo E2E',
    }).expect(201);
    const applications = await request(app.getHttpServer()).get(`/api/v1/sales/${sale.body.id}/percentage-applications`).expect(200);
    expect(applications.body[0].amountCop).toBe('3');
    expect(applications.body[0].currentAmountCop).toBe('7.00');
    expect(applications.body[0].adjustments).toHaveLength(2);

    const expenseCategory = await request(app.getHttpServer()).post('/api/v1/expense-categories').send({ name: `CSV ${token()}`, scope: 'GENERAL' }).expect(201);
    const expense = await request(app.getHttpServer()).post('/api/v1/general-expenses').send({
      categoryId: expenseCategory.body.id, expenseDate: date(), description: 'CSV expense', amountCop: '1234.56',
    }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/expenses/general/${expense.body.id}/confirm`).expect(201);

    const reports = await request(app.getHttpServer()).get('/api/v1/reports/summary').query({ from: date(), to: date() }).expect(200);
    expect(reports.body.current.percentages.current.find((row: { id: string }) => row.id === application.body.id).currentAmountCop).toBe('7.00');

    const csvCases = [
      { type: 'sales', id: sale.body.id },
      { type: 'procedures', id: procedure.body.id },
      { type: 'expenses', id: expense.body.id },
      { type: 'percentages', id: application.body.id },
    ];
    for (const { type: csvType, id } of csvCases) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/reports/export.csv')
        .query({ type: csvType, from: date(), to: date() })
        .expect(200);
      expect(response.headers['content-type']).toContain('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toContain(`${csvType}-report.csv`);
      expect(response.text?.charCodeAt(0)).toBe(0xfeff);
      expect(response.text).toContain(id);
    }
    const proceduresCsv = await request(app.getHttpServer())
      .get('/api/v1/reports/export.csv').query({ type: 'procedures', from: date(), to: date() }).expect(200);
    expect(proceduresCsv.text).toContain("'=HYPERLINK(");
    expect(proceduresCsv.text).toContain('""https://example.invalid""');
    const percentagesCsv = await request(app.getHttpServer())
      .get('/api/v1/reports/export.csv').query({ type: 'percentages', from: date(), to: date() }).expect(200);
    expect(percentagesCsv.text).toContain('currentAmountCop');
    expect(percentagesCsv.text).toContain('"7.00"');
  });
});
