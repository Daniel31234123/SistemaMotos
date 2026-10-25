import { BadRequestException, ConflictException } from '@nestjs/common';
import { ApplicationStatus, Prisma, SaleStatus } from '@prisma/client';
import { validate } from 'class-validator';
import { PrismaService } from '../../database/prisma.service';
import { AdjustPercentageDto, ApplyPercentageDto, CloseRuleDto, CreateRuleDto } from './dto/percentage.dto';
import { PercentagesService } from './percentages.service';

describe('PercentagesService commercial rules', () => {
  const makeService = () => {
    const tx = {
      percentageApplication: { create: jest.fn().mockResolvedValue({ id: 'application-1' }) },
      percentageAdjustment: { create: jest.fn().mockResolvedValue({ id: 'adjustment-1' }) },
      auditEvent: { create: jest.fn() },
    };
    const prisma = {
      brand: { findUnique: jest.fn() },
      percentageRule: {
        findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
        create: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'rule-1' }),
      },
      sale: { findUnique: jest.fn() },
      percentageApplication: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
      percentageAdjustment: { create: jest.fn().mockResolvedValue({ id: 'adjustment-1' }) },
      auditEvent: { create: jest.fn() },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { service: new PercentagesService(prisma as unknown as PrismaService), prisma, tx };
  };

  const makeApplyScenario = (income: string, costs: string, rate: string, brandName = 'Bajaj') => {
    const context = makeService();
    context.prisma.sale.findUnique.mockResolvedValue({
      id: 'sale-1', status: SaleStatus.CONFIRMED,
      motorcycle: { brandId: 'brand-1', brand: { name: brandName } },
      procedures: [{ customerAmountCop: new Prisma.Decimal(income), businessCostCop: new Prisma.Decimal(costs) }],
    });
    context.prisma.percentageRule.findUnique.mockResolvedValue({
      id: 'rule-1', brandId: 'brand-1', ratePercent: new Prisma.Decimal(rate), active: true,
      effectiveFrom: new Date('2000-01-01T00:00:00.000Z'), effectiveTo: null,
    });
    context.prisma.percentageApplication.findUnique.mockResolvedValue(null);
    return context;
  };

  const applyDto: ApplyPercentageDto = { ruleId: 'rule-1', confirmed: true, reason: 'Regla revisada' };

  it('creates an approved rule for an active brand with the next version and effective date', async () => {
    const { service, prisma } = makeService();
    prisma.brand.findUnique.mockResolvedValue({ id: 'brand-1', active: true });
    prisma.percentageRule.findFirst.mockResolvedValue({ version: 2 });
    const dto: CreateRuleDto = {
      brandId: 'brand-1', ratePercent: '4.0000', effectiveFrom: '2026-01-01', approvedBusinessRule: true,
    };

    await service.createRule(dto);

    expect(prisma.percentageRule.create).toHaveBeenCalledWith({ data: {
      brandId: 'brand-1', ratePercent: '4.0000', effectiveFrom: new Date('2026-01-01'), version: 3,
    } });
  });

  it('maps a concurrent duplicate brand/version constraint to a domain conflict', async () => {
    const { service, prisma } = makeService();
    prisma.brand.findUnique.mockResolvedValue({ id: 'brand-1', active: true });
    prisma.percentageRule.findFirst.mockResolvedValue({ version: 4 });
    prisma.percentageRule.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002', clientVersion: '6.19.3',
    }));

    await expect(service.createRule({
      brandId: 'brand-1', ratePercent: '4', effectiveFrom: '2026-01-01', approvedBusinessRule: true,
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('starts rule versioning at one when a brand has no previous rules', async () => {
    const { service, prisma } = makeService();
    prisma.brand.findUnique.mockResolvedValue({ id: 'brand-1', active: true });
    prisma.percentageRule.findFirst.mockResolvedValue(null);

    await service.createRule({
      brandId: 'brand-1', ratePercent: '11.0000', effectiveFrom: '2026-01-01', approvedBusinessRule: true,
    });

    expect(prisma.percentageRule.create).toHaveBeenCalledWith({ data: {
      brandId: 'brand-1', ratePercent: '11.0000', effectiveFrom: new Date('2026-01-01'), version: 1,
    } });
  });

  it.each(['0', '4.0000', '100'])('accepts a rate within the DTO range (%s%%)', async (ratePercent) => {
    const dto = Object.assign(new CreateRuleDto(), {
      brandId: 'c2c64b90-70c8-4d00-8d95-96d21f2d1f00', ratePercent,
      effectiveFrom: '2026-01-01', approvedBusinessRule: true,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['-1', '100.0001', '1.12345', '101'])('rejects a rate outside the DTO format/range (%s)', async (ratePercent) => {
    const dto = Object.assign(new CreateRuleDto(), {
      brandId: 'c2c64b90-70c8-4d00-8d95-96d21f2d1f00', ratePercent,
      effectiveFrom: '2026-01-01', approvedBusinessRule: true,
    });
    const errors = await validate(dto);
    expect(errors.some(({ property }) => property === 'ratePercent')).toBe(true);
  });

  it('validates rule dates and signed adjustment amounts at the DTO boundary', async () => {
    const invalidRuleDate = Object.assign(new CreateRuleDto(), {
      brandId: 'c2c64b90-70c8-4d00-8d95-96d21f2d1f00', ratePercent: '4',
      effectiveFrom: 'not-a-date', approvedBusinessRule: true,
    });
    expect((await validate(invalidRuleDate)).some(({ property }) => property === 'effectiveFrom')).toBe(true);

    const invalidCloseDate = Object.assign(new CloseRuleDto(), { effectiveTo: 'not-a-date' });
    expect((await validate(invalidCloseDate)).some(({ property }) => property === 'effectiveTo')).toBe(true);

    const validAdjustment = Object.assign(new AdjustPercentageDto(), { reason: 'Corrección', amountDeltaCop: '-5000.00' });
    expect(await validate(validAdjustment)).toHaveLength(0);
    const invalidAdjustment = Object.assign(new AdjustPercentageDto(), { reason: 'Corrección', amountDeltaCop: '5.001' });
    expect((await validate(invalidAdjustment)).some(({ property }) => property === 'amountDeltaCop')).toBe(true);
  });

  it('requires explicit approval and an active brand before creating a rule', async () => {
    const unapproved = makeService();
    await expect(unapproved.service.createRule({
      brandId: 'brand-1', ratePercent: '4', effectiveFrom: '2026-01-01', approvedBusinessRule: false,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(unapproved.prisma.brand.findUnique).not.toHaveBeenCalled();

    const inactive = makeService();
    inactive.prisma.brand.findUnique.mockResolvedValue({ id: 'brand-1', active: false });
    await expect(inactive.service.createRule({
      brandId: 'brand-1', ratePercent: '4', effectiveFrom: '2026-01-01', approvedBusinessRule: true,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(inactive.prisma.percentageRule.create).not.toHaveBeenCalled();
  });

  it('rejects closing a rule before its start and accepts an end on or after it', async () => {
    const { service, prisma } = makeService();
    prisma.percentageRule.findUnique.mockResolvedValue({ id: 'rule-1', effectiveFrom: new Date('2026-01-01T00:00:00.000Z') });

    await expect(service.closeRule('rule-1', '2025-12-31')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.percentageRule.update).not.toHaveBeenCalled();

    await service.closeRule('rule-1', '2026-01-01');
    expect(prisma.percentageRule.update).toHaveBeenCalledWith({
      where: { id: 'rule-1' }, data: { effectiveTo: new Date('2026-01-01') },
    });
  });

  it('offers rules for the sale brand with their validity and calculates the confirmed-procedure base', async () => {
    const { service, prisma } = makeService();
    const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');
    const effectiveTo = new Date('2026-12-31T00:00:00.000Z');
    prisma.sale.findUnique.mockResolvedValue({
      id: 'sale-1', motorcycle: { brandId: 'brand-1', brand: { name: 'Bajaj' } },
      procedures: [{ customerAmountCop: new Prisma.Decimal('900000'), businessCostCop: new Prisma.Decimal('400000') }],
      applications: [],
    });
    prisma.percentageRule.findMany.mockResolvedValue([{
      id: 'rule-1', ratePercent: new Prisma.Decimal('4'), effectiveFrom, effectiveTo, active: true, version: 2,
    }]);

    const result = await service.candidates('sale-1');

    expect(prisma.percentageRule.findMany).toHaveBeenCalledWith({
      where: { brandId: 'brand-1', active: true }, orderBy: { effectiveFrom: 'desc' },
    });
    expect(result).toEqual({
      saleId: 'sale-1', brand: 'Bajaj', baseCop: '500000.00', applicationExists: false,
      requiresManualReview: false,
      rules: [{ id: 'rule-1', ratePercent: '4.0000', effectiveFrom, effectiveTo, version: 2 }],
    });
  });

  it('returns only active rules effective on the application date, with inclusive date bounds', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    try {
      const { service, prisma } = makeService();
      prisma.sale.findUnique.mockResolvedValue({
        id: 'sale-1', motorcycle: { brandId: 'brand-1', brand: { name: 'Bajaj' } },
        procedures: [], applications: [],
      });
      const rule = (id: string, from: string, to: string | null, active = true) => ({
        id, ratePercent: new Prisma.Decimal('4'), effectiveFrom: new Date(`${from}T00:00:00.000Z`),
        effectiveTo: to ? new Date(`${to}T00:00:00.000Z`) : null, active, version: 1,
      });
      prisma.percentageRule.findMany.mockResolvedValue([
        rule('valid-span', '2026-06-01', '2026-06-30'),
        rule('starts-today', '2026-06-15', '2026-06-15'),
        rule('ends-today', '2026-06-01', '2026-06-15'),
        rule('future', '2026-06-16', null),
        rule('expired', '2026-06-01', '2026-06-14'),
        rule('inactive', '2026-06-01', '2026-06-30', false),
      ]);

      const result = await service.candidates('sale-1');

      expect(prisma.percentageRule.findMany).toHaveBeenCalledWith({
        where: { brandId: 'brand-1', active: true }, orderBy: { effectiveFrom: 'desc' },
      });
      expect(result.rules.map(({ id }) => id)).toEqual(['valid-span', 'starts-today', 'ends-today']);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    { income: '400000', costs: '400000', baseCop: '0.00' },
    { income: '400000', costs: '500000', baseCop: '-100000.00' },
  ])('marks a candidate base of $baseCop for manual review', async ({ income, costs, baseCop }) => {
    const { service, prisma } = makeService();
    prisma.sale.findUnique.mockResolvedValue({
      id: 'sale-1', motorcycle: { brandId: 'brand-1', brand: { name: 'Bajaj' } },
      procedures: [{ customerAmountCop: new Prisma.Decimal(income), businessCostCop: new Prisma.Decimal(costs) }],
      applications: [],
    });
    prisma.percentageRule.findMany.mockResolvedValue([]);

    const result = await service.candidates('sale-1');

    expect(result.baseCop).toBe(baseCop);
    expect(result.requiresManualReview).toBe(true);
  });

  it.each([
    { label: 'future', active: true, from: '2026-06-16', to: null },
    { label: 'expired', active: true, from: '2026-06-01', to: '2026-06-14' },
    { label: 'inactive', active: false, from: '2026-06-01', to: '2026-06-30' },
  ])('rejects applying a $label rule on the application date', async ({ active, from, to }) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    try {
      const { service, prisma, tx } = makeApplyScenario('900000', '400000', '4');
      prisma.percentageRule.findUnique.mockResolvedValue({
        id: 'rule-1', brandId: 'brand-1', ratePercent: new Prisma.Decimal('4'), active,
        effectiveFrom: new Date(`${from}T00:00:00.000Z`),
        effectiveTo: to ? new Date(`${to}T00:00:00.000Z`) : null,
      });

      await expect(service.apply('sale-1', applyDto)).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.percentageApplication.create).not.toHaveBeenCalled();
      expect(tx.auditEvent.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('applies a rule on both inclusive validity boundaries and snapshots the application date', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    try {
      const { service, prisma, tx } = makeApplyScenario('900000', '400000', '4');
      prisma.percentageRule.findUnique.mockResolvedValue({
        id: 'rule-1', brandId: 'brand-1', ratePercent: new Prisma.Decimal('4'), active: true,
        effectiveFrom: new Date('2026-06-15T00:00:00.000Z'), effectiveTo: new Date('2026-06-15T00:00:00.000Z'),
      });

      await service.apply('sale-1', applyDto);

      expect(tx.percentageApplication.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        appliedAt: new Date('2026-06-15T12:00:00.000Z'),
      }) });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    { rate: '4', expected: '20000', brandName: 'Bajaj' },
    { rate: '11', expected: '55000', brandName: 'Auteco' },
  ])('applies the selected rate $rate% to the positive margin and audits the operation', async ({ rate, expected, brandName }) => {
    const { service, prisma, tx } = makeApplyScenario('900000', '400000', rate, brandName);

    await service.apply('sale-1', applyDto);

    const call = tx.percentageApplication.create.mock.calls[0]?.[0] as unknown as {
      data: {
        saleId: string; ruleId: string; brandNameSnapshot: string; ratePercentSnapshot: Prisma.Decimal;
        baseCop: Prisma.Decimal; amountCop: Prisma.Decimal; manualReason: string; status: ApplicationStatus;
      };
    };
    expect(call.data.saleId).toBe('sale-1');
    expect(call.data.ruleId).toBe('rule-1');
    expect(call.data.brandNameSnapshot).toBe(brandName);
    expect(call.data.ratePercentSnapshot.toFixed(4)).toBe(new Prisma.Decimal(rate).toFixed(4));
    expect(call.data.baseCop.toFixed(2)).toBe('500000.00');
    expect(call.data.amountCop.toFixed(0)).toBe(expected);
    expect(call.data.manualReason).toBe('Regla revisada');
    expect(call.data.status).toBe(ApplicationStatus.APPLIED);
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'PercentageApplication', entityId: 'application-1', saleId: 'sale-1',
      operation: 'MANUAL_APPLY', reason: 'Regla revisada',
      changes: { baseCop: '500000.00', status: ApplicationStatus.APPLIED, ruleId: 'rule-1' },
    } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    { income: '400000', costs: '400000', base: '0.00' },
    { income: '400000', costs: '500000', base: '-100000.00' },
  ])('marks a non-positive base ($base) for review instead of calculating a percentage', async ({ income, costs, base }) => {
    const { service, tx } = makeApplyScenario(income, costs, '4');

    await service.apply('sale-1', applyDto);

    const call = tx.percentageApplication.create.mock.calls[0]?.[0] as unknown as {
      data: { baseCop: Prisma.Decimal; amountCop: Prisma.Decimal; status: ApplicationStatus };
    };
    expect(call.data.baseCop.toFixed(2)).toBe(base);
    expect(call.data.amountCop.toFixed(2)).toBe('0.00');
    expect(call.data.status).toBe(ApplicationStatus.REVIEW_REQUIRED);
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      entityType: 'PercentageApplication', entityId: 'application-1', operation: 'PENDING_REVIEW',
    }) });
  });

  it('rejects a rule from another brand, an unconfirmed sale or an unconfirmed rule choice', async () => {
    const wrongBrand = makeApplyScenario('900000', '400000', '4');
    wrongBrand.prisma.percentageRule.findUnique.mockResolvedValue({
      id: 'rule-1', brandId: 'brand-other', ratePercent: new Prisma.Decimal('4'), active: true,
      effectiveFrom: new Date('2000-01-01T00:00:00.000Z'), effectiveTo: null,
    });
    await expect(wrongBrand.service.apply('sale-1', applyDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(wrongBrand.prisma.$transaction).not.toHaveBeenCalled();

    const unconfirmedSale = makeApplyScenario('900000', '400000', '4');
    unconfirmedSale.prisma.sale.findUnique.mockResolvedValue({
      id: 'sale-1', status: SaleStatus.DRAFT,
      motorcycle: { brandId: 'brand-1', brand: { name: 'Bajaj' } }, procedures: [],
    });
    await expect(unconfirmedSale.service.apply('sale-1', applyDto)).rejects.toBeInstanceOf(ConflictException);

    const notSelected = makeApplyScenario('900000', '400000', '4');
    await expect(notSelected.service.apply('sale-1', { ...applyDto, confirmed: false }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(notSelected.prisma.sale.findUnique).not.toHaveBeenCalled();
  });

  it('rejects applying when there are no confirmed procedures or an application already exists', async () => {
    const noProcedures = makeService();
    noProcedures.prisma.sale.findUnique.mockResolvedValue({
      id: 'sale-1', status: SaleStatus.CONFIRMED,
      motorcycle: { brandId: 'brand-1', brand: { name: 'Bajaj' } }, procedures: [],
    });
    noProcedures.prisma.percentageRule.findUnique.mockResolvedValue({
      id: 'rule-1', brandId: 'brand-1', active: true, effectiveFrom: new Date('2000-01-01T00:00:00.000Z'), effectiveTo: null,
    });
    await expect(noProcedures.service.apply('sale-1', applyDto)).rejects.toBeInstanceOf(BadRequestException);

    const duplicate = makeApplyScenario('900000', '400000', '4');
    duplicate.prisma.percentageApplication.findUnique.mockResolvedValue({ id: 'application-existing' });
    await expect(duplicate.service.apply('sale-1', applyDto)).rejects.toBeInstanceOf(ConflictException);
    expect(duplicate.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records a signed adjustment and its audit in one transaction without calculating a new total', async () => {
    const { service, prisma, tx } = makeService();
    prisma.percentageApplication.findUnique.mockResolvedValue({ id: 'application-1', saleId: 'sale-1', amountCop: new Prisma.Decimal('20000') });
    tx.percentageAdjustment.create.mockResolvedValue({ id: 'adjustment-1', amountDeltaCop: new Prisma.Decimal('-5000') });

    const result = await service.adjust('application-1', { amountDeltaCop: '-5000.00', reason: 'Corrección documentada' });

    expect(tx.percentageAdjustment.create).toHaveBeenCalledWith({ data: {
      applicationId: 'application-1', amountDeltaCop: '-5000.00', reason: 'Corrección documentada',
    } });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'PercentageApplication', entityId: 'application-1', saleId: 'sale-1',
      operation: 'MANUAL_ADJUSTMENT', reason: 'Corrección documentada',
      changes: { adjustmentId: 'adjustment-1', amountDeltaCop: '-5000.00' },
    } });
    expect(result).toEqual({ id: 'adjustment-1', amountDeltaCop: new Prisma.Decimal('-5000') });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.percentageAdjustment.create).not.toHaveBeenCalled();
  });

  it('propagates an audit failure inside the adjustment transaction', async () => {
    const { service, prisma, tx } = makeService();
    prisma.percentageApplication.findUnique.mockResolvedValue({ id: 'application-1', saleId: 'sale-1' });
    const auditFailure = new Error('audit unavailable');
    tx.auditEvent.create.mockRejectedValue(auditFailure);

    await expect(service.adjust('application-1', {
      amountDeltaCop: '5000.00', reason: 'Corrección documentada',
    })).rejects.toBe(auditFailure);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.percentageAdjustment.create).toHaveBeenCalledTimes(1);
    expect(prisma.percentageAdjustment.create).not.toHaveBeenCalled();
  });

  it('returns the original amount plus every signed adjustment as a two-decimal current amount', async () => {
    const { service, prisma } = makeService();
    prisma.percentageApplication.findMany.mockResolvedValue([{
      id: 'application-1',
      amountCop: new Prisma.Decimal('125.50'),
      adjustments: [
        { amountDeltaCop: new Prisma.Decimal('10.25') },
        { amountDeltaCop: new Prisma.Decimal('-5.75') },
      ],
    }]);

    const result = await service.listApplications('sale-1');

    expect(result[0]?.amountCop.toFixed(2)).toBe('125.50');
    expect(result[0]?.currentAmountCop).toBe('130.00');
    expect(prisma.percentageApplication.findMany).toHaveBeenCalledWith({
      where: { saleId: 'sale-1' },
      include: { rule: { include: { brand: true } }, adjustments: true },
      orderBy: { appliedAt: 'desc' },
    });
  });
});
