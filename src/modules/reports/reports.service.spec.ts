import { BadRequestException } from '@nestjs/common';
import { ApplicationStatus, Prisma, RecordStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const makeService = () => {
    const prisma = {
      sale: { findMany: jest.fn().mockResolvedValue([]) },
      saleProcedure: { findMany: jest.fn().mockResolvedValue([]) },
      motorcycleExpense: { findMany: jest.fn().mockResolvedValue([]) },
      generalExpense: { findMany: jest.fn().mockResolvedValue([]) },
      percentageApplication: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { service: new ReportsService(prisma as unknown as PrismaService), prisma };
  };

  const start = new Date('2026-05-01T00:00:00.000Z');
  const end = new Date('2026-05-31T23:59:59.999Z');

  it('filters sales by saleDate using inclusive UTC start and end boundaries', async () => {
    const { service, prisma } = makeService();
    const cancelled = { id: 'sale-cancelled', status: SaleStatus.CANCELLED, saleDate: new Date('2026-05-31T23:59:59.999Z') };
    prisma.sale.findMany.mockResolvedValue([cancelled]);

    const result = await service.sales('2026-05-01', '2026-05-31');

    expect(prisma.sale.findMany).toHaveBeenCalledWith({
      where: { saleDate: { gte: start, lte: end } },
      include: { motorcycle: { include: { brand: true } }, customer: true },
      orderBy: { saleDate: 'asc' },
    });
    // Sales are returned by saleDate regardless of status; cancellation is separated in summary.
    expect(result).toEqual([cancelled]);
  });

  it.each([
    ['', '2026-05-31'],
    ['2026-05-01', ''],
    ['not-a-date', '2026-05-31'],
    ['2026-06-01', '2026-05-31'],
  ])('rejects an invalid report range from=%p to=%p', async (from, to) => {
    const { service, prisma } = makeService();
    await expect(service.sales(from, to)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.sale.findMany).not.toHaveBeenCalled();
  });

  it('sums confirmed procedures with Decimal precision and keeps cancelled or voided rows historical', async () => {
    const { service, prisma } = makeService();
    const procedure = (id: string, status: RecordStatus, saleStatus: SaleStatus, income: string, cost: string) => ({
      id, status, sale: { status: saleStatus }, customerAmountCop: new Prisma.Decimal(income),
      businessCostCop: new Prisma.Decimal(cost), procedureDate: new Date('2026-05-10T00:00:00.000Z'),
    });
    prisma.saleProcedure.findMany.mockResolvedValue([
      procedure('current', RecordStatus.CONFIRMED, SaleStatus.CONFIRMED, '0.10', '0.03'),
      procedure('voided', RecordStatus.VOIDED, SaleStatus.CONFIRMED, '0.20', '0.04'),
      procedure('sale-cancelled', RecordStatus.CONFIRMED, SaleStatus.CANCELLED, '0.30', '0.05'),
    ]);

    const result = await service.procedures('2026-05-01', '2026-05-31');

    expect(prisma.saleProcedure.findMany).toHaveBeenCalledWith({
      where: { procedureDate: { gte: start, lte: end }, status: { not: RecordStatus.DRAFT } },
      include: { sale: { include: { motorcycle: { include: { brand: true } }, customer: true } }, procedureType: true },
      orderBy: { procedureDate: 'asc' },
    });
    expect(result.current.records.map(({ id }) => id)).toEqual(['current']);
    expect(result.current.registeredIncomeCop).toBe('0.10');
    expect(result.current.costsCop).toBe('0.03');
    expect(result.current.marginCop).toBe('0.07');
    expect(result.historicalExcluded.records.map(({ id }) => id)).toEqual(['voided', 'sale-cancelled']);
    expect(result.historicalExcluded.registeredIncomeCop).toBe('0.50');
    expect(result.historicalExcluded.costsCop).toBe('0.09');
    expect(result.historicalExcluded.marginCop).toBe('0.41');
  });

  it('separates confirmed and voided expenses and sums their Decimal amounts per scope', async () => {
    const { service, prisma } = makeService();
    const expense = (id: string, status: RecordStatus, amount: string) => ({ id, status, amountCop: new Prisma.Decimal(amount) });
    prisma.motorcycleExpense.findMany.mockResolvedValue([
      expense('moto-1', RecordStatus.CONFIRMED, '0.10'),
      expense('moto-2', RecordStatus.CONFIRMED, '0.20'),
      expense('moto-void', RecordStatus.VOIDED, '0.05'),
      expense('moto-draft', RecordStatus.DRAFT, '90.00'),
    ]);
    prisma.generalExpense.findMany.mockResolvedValue([
      expense('general-1', RecordStatus.CONFIRMED, '1.10'),
      expense('general-void', RecordStatus.VOIDED, '0.10'),
    ]);

    const result = await service.expenses('2026-05-01', '2026-05-31');

    const where = { expenseDate: { gte: start, lte: end }, status: { not: RecordStatus.DRAFT } };
    expect(prisma.motorcycleExpense.findMany).toHaveBeenCalledWith({
      where, include: { category: true, motorcycle: { include: { brand: true } } }, orderBy: { expenseDate: 'asc' },
    });
    expect(prisma.generalExpense.findMany).toHaveBeenCalledWith({
      where, include: { category: true }, orderBy: { expenseDate: 'asc' },
    });
    expect(result.motorcycle.current.records.map(({ id }) => id)).toEqual(['moto-1', 'moto-2']);
    expect(result.motorcycle.current.totalCop).toBe('0.30');
    expect(result.motorcycle.historicalExcluded.records.map(({ id }) => id)).toEqual(['moto-void']);
    expect(result.motorcycle.historicalExcluded.totalCop).toBe('0.05');
    expect(result.general.current.totalCop).toBe('1.10');
    expect(result.general.historicalExcluded.totalCop).toBe('0.10');
  });

  it('includes confirmed applied percentages and separates cancelled and review-required applications', async () => {
    const { service, prisma } = makeService();
    const application = (
      id: string,
      saleStatus: SaleStatus,
      status: ApplicationStatus,
      adjustments: { amountDeltaCop: Prisma.Decimal }[] = [],
    ) => ({
      id, sale: { status: saleStatus }, status, appliedAt: new Date('2026-05-10T12:00:00.000Z'),
      amountCop: new Prisma.Decimal('0.10'), adjustments,
    });
    prisma.percentageApplication.findMany.mockResolvedValue([
      application('current', SaleStatus.CONFIRMED, ApplicationStatus.APPLIED, [
        { amountDeltaCop: new Prisma.Decimal('0.05') },
        { amountDeltaCop: new Prisma.Decimal('-0.02') },
      ]),
      application('sale-cancelled', SaleStatus.CANCELLED, ApplicationStatus.APPLIED),
      application('review', SaleStatus.CONFIRMED, ApplicationStatus.REVIEW_REQUIRED),
    ]);

    const result = await service.percentages('2026-05-01', '2026-05-31');

    expect(prisma.percentageApplication.findMany).toHaveBeenCalledWith({
      where: { appliedAt: { gte: start, lte: end } },
      include: { sale: { include: { motorcycle: true } }, rule: true, adjustments: true },
      orderBy: { appliedAt: 'asc' },
    });
    expect(result.current.map(({ id }) => id)).toEqual(['current']);
    expect(result.current[0]?.currentAmountCop).toBe('0.13');
    expect(result.historicalExcluded.map(({ id }) => id)).toEqual(['sale-cancelled', 'review']);
    expect(result.historicalExcluded.every(({ currentAmountCop }) => currentAmountCop === '0.10')).toBe(true);
  });

  it('summarizes confirmed sales only, excluding cancelled sales and drafts from the current contract total', async () => {
    const { service, prisma } = makeService();
    prisma.sale.findMany.mockResolvedValue([
      { id: 'confirmed-1', status: SaleStatus.CONFIRMED, motorcyclePriceCop: new Prisma.Decimal('0.10') },
      { id: 'confirmed-2', status: SaleStatus.CONFIRMED, motorcyclePriceCop: new Prisma.Decimal('0.20') },
      { id: 'cancelled', status: SaleStatus.CANCELLED, motorcyclePriceCop: new Prisma.Decimal('1000.00') },
      { id: 'draft', status: SaleStatus.DRAFT, motorcyclePriceCop: new Prisma.Decimal('500.00') },
    ]);

    const result = await service.summary('2026-05-01', '2026-05-31');

    expect(result.current.salesCount).toBe(2);
    expect(result.current.cancelledSalesExcludedCount).toBe(1);
    expect(result.current.motorcycleContractValueCop).toBe('0.30');
    expect(result.historicalCancelledSales.map(({ id }) => id)).toEqual(['cancelled']);
  });

  it('returns zero totals and empty historical/current collections for an empty period', async () => {
    const { service } = makeService();

    const result = await service.summary('2026-05-01', '2026-05-31');

    expect(result.current.salesCount).toBe(0);
    expect(result.current.cancelledSalesExcludedCount).toBe(0);
    expect(result.current.motorcycleContractValueCop).toBe('0.00');
    expect(result.current.procedures.current).toEqual({
      records: [], registeredIncomeCop: '0.00', costsCop: '0.00', marginCop: '0.00',
    });
    expect(result.current.expenses.motorcycle.current).toEqual({ records: [], totalCop: '0.00' });
    expect(result.current.expenses.general.current).toEqual({ records: [], totalCop: '0.00' });
    expect(result.current.percentages).toEqual({ current: [], historicalExcluded: [] });
    expect(result.historicalCancelledSales).toEqual([]);
  });

  it('exports sales with CSV headers, escaped fields, empty cells, Unicode and formula protection', async () => {
    const { service, prisma } = makeService();
    prisma.sale.findMany.mockResolvedValue([{
      id: 'sale-1', status: SaleStatus.CANCELLED, amountCop: new Prisma.Decimal('12500.75'),
      customerName: 'Ángela, "La Moto"\nLínea 2', empty: null,
      formula: '=1+1', negativeText: '-50.00', negativeFormula: '-1+SUM(A1:A2)',
      saleDate: new Date('2026-05-10T12:30:00.000Z'),
    }]);

    const csv = await service.export('sales', '2026-05-01', '2026-05-31');

    expect(csv).toBe([
      'id,status,amountCop,customerName,empty,formula,negativeText,negativeFormula,saleDate',
      '"sale-1","CANCELLED","12500.75","Ángela, ""La Moto""\nLínea 2","","\'=1+1","-50.00","\'-1+SUM(A1:A2)","2026-05-10T12:30:00.000Z"',
    ].join('\r\n'));
    expect(prisma.sale.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { saleDate: { gte: start, lte: end } },
    }));
  });

  it.each(['=1+1', '+1+1', '@SUM(A1:A2)', '-1+1', '  =1+1'])(
    'prefixes a CSV string that could be interpreted as a spreadsheet formula (%p)', async (formula) => {
      const { service, prisma } = makeService();
      prisma.sale.findMany.mockResolvedValue([{ formula }]);

      const csv = await service.export('sales', '2026-05-01', '2026-05-31');

      expect(csv).toBe(`formula\r\n"'${formula}"`);
    },
  );

  it('exports procedures including current and historical records with their source fields', async () => {
    const { service, prisma } = makeService();
    const procedure = (id: string, status: RecordStatus, saleStatus: SaleStatus) => ({
      id, status, sale: { status: saleStatus }, customerAmountCop: new Prisma.Decimal('100.25'),
      businessCostCop: new Prisma.Decimal('25.75'), procedureDate: new Date('2026-05-02T00:00:00.000Z'),
    });
    prisma.saleProcedure.findMany.mockResolvedValue([
      procedure('procedure-current', RecordStatus.CONFIRMED, SaleStatus.CONFIRMED),
      procedure('procedure-voided', RecordStatus.VOIDED, SaleStatus.CONFIRMED),
      procedure('procedure-cancelled-sale', RecordStatus.CONFIRMED, SaleStatus.CANCELLED),
    ]);

    const csv = await service.export('procedures', '2026-05-01', '2026-05-31');

    expect(csv.split('\r\n')[0]).toBe('id,status,sale,customerAmountCop,businessCostCop,procedureDate');
    expect(csv).toContain('"procedure-current"');
    expect(csv).toContain('"procedure-voided"');
    expect(csv).toContain('"procedure-cancelled-sale"');
    expect(csv).toContain(',"100.25","25.75",');
    expect(prisma.saleProcedure.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { procedureDate: { gte: start, lte: end }, status: { not: RecordStatus.DRAFT } },
    }));
  });

  it('exports motorcycle and general expenses, retaining both confirmed and voided history', async () => {
    const { service, prisma } = makeService();
    const expense = (id: string, status: RecordStatus, amount: string) => ({
      id, status, amountCop: new Prisma.Decimal(amount), expenseDate: new Date('2026-05-02T00:00:00.000Z'),
    });
    prisma.motorcycleExpense.findMany.mockResolvedValue([
      expense('motorcycle-current', RecordStatus.CONFIRMED, '10.25'),
      expense('motorcycle-voided', RecordStatus.VOIDED, '5.75'),
    ]);
    prisma.generalExpense.findMany.mockResolvedValue([
      expense('general-current', RecordStatus.CONFIRMED, '20.25'),
      expense('general-voided', RecordStatus.VOIDED, '3.75'),
    ]);

    const csv = await service.export('expenses', '2026-05-01', '2026-05-31');

    expect(csv.split('\r\n')[0]).toBe('id,status,amountCop,expenseDate');
    for (const id of ['motorcycle-current', 'motorcycle-voided', 'general-current', 'general-voided']) {
      expect(csv).toContain(`"${id}"`);
    }
    expect(csv).toContain(',"10.25",');
    expect(csv).toContain(',"3.75",');
  });

  it('exports percentage current and excluded rows and documents negative Decimal CSV serialization', async () => {
    const { service, prisma } = makeService();
    const row = (id: string, saleStatus: SaleStatus, status: ApplicationStatus, base: string) => ({
      id, status, sale: { status: saleStatus }, baseCop: new Prisma.Decimal(base),
      amountCop: new Prisma.Decimal('0.25'), adjustments: [],
    });
    prisma.percentageApplication.findMany.mockResolvedValue([
      row('percentage-current', SaleStatus.CONFIRMED, ApplicationStatus.APPLIED, '100.25'),
      row('percentage-review', SaleStatus.CONFIRMED, ApplicationStatus.REVIEW_REQUIRED, '-50.25'),
      row('percentage-cancelled-sale', SaleStatus.CANCELLED, ApplicationStatus.APPLIED, '25.25'),
    ]);

    const csv = await service.export('percentages', '2026-05-01', '2026-05-31');

    expect(csv.split('\r\n')[0]).toBe('id,status,sale,baseCop,amountCop,adjustments,currentAmountCop');
    expect(csv).toContain('"percentage-current"');
    expect(csv).toContain('"percentage-review"');
    expect(csv).toContain('"percentage-cancelled-sale"');
    expect(csv).toContain(',"100.25","0.25","[]","0.25"');
    expect(csv).toContain(',"-50.25","0.25","[]","0.25"');
    expect(csv).not.toContain('"""-50.25"""');
  });

  it('returns the current empty-export marker and rejects an unsupported CSV type', async () => {
    const { service } = makeService();
    await expect(service.export('sales', '2026-05-01', '2026-05-31')).resolves.toBe('status\n');
    await expect(service.export('unknown', '2026-05-01', '2026-05-31')).rejects.toBeInstanceOf(BadRequestException);
  });
});
