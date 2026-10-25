import { BadRequestException, ConflictException } from '@nestjs/common';
import { RecordStatus } from '@prisma/client';
import { validate } from 'class-validator';
import { PrismaService } from '../../database/prisma.service';
import { CreateExpenseDto, VoidExpenseDto } from './dto/expense.dto';
import { ExpensesService } from './expenses.service';

describe('ExpensesService void and replacement', () => {
  const makeService = () => {
    const motorcycleExpense = {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'motorcycle-expense-new' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const generalExpense = {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'general-expense-new' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const auditEvent = { create: jest.fn() };
    const tx = { motorcycleExpense, generalExpense, auditEvent };
    const prisma = {
      expenseCategory: { findUnique: jest.fn() },
      motorcycle: { findUnique: jest.fn() },
      motorcycleExpense,
      generalExpense,
      auditEvent,
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { service: new ExpensesService(prisma as unknown as PrismaService), prisma };
  };

  const expenseDto = (replacesId?: string): CreateExpenseDto => ({
    categoryId: 'category-1', expenseDate: '2026-10-24', description: 'Gasto corregido',
    amountCop: '250000.00', ...(replacesId ? { replacesId } : {}),
  });

  it('voids a confirmed motorcycle expense and preserves the reason', async () => {
    const { service, prisma } = makeService();
    prisma.motorcycleExpense.findUnique.mockResolvedValue({ id: 'expense-1', status: RecordStatus.CONFIRMED });

    await service.voidMotorcycle('expense-1', '  Corrección documentada  ');

    expect(prisma.motorcycleExpense.updateMany).toHaveBeenCalledWith({
      where: { id: 'expense-1', status: RecordStatus.CONFIRMED },
      data: { status: RecordStatus.VOIDED, voidReason: 'Corrección documentada' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'MotorcycleExpense', entityId: 'expense-1', operation: 'VOID',
      reason: '  Corrección documentada  ', changes: { status: 'VOIDED' },
    } });
  });

  it('confirms a motorcycle expense draft', async () => {
    const { service, prisma } = makeService();
    prisma.motorcycleExpense.findUnique.mockResolvedValue({ id: 'expense-1', status: RecordStatus.DRAFT });

    await service.confirmMotorcycle('expense-1');

    expect(prisma.motorcycleExpense.updateMany).toHaveBeenCalledWith({
      where: { id: 'expense-1', status: RecordStatus.DRAFT }, data: { status: RecordStatus.CONFIRMED },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'MotorcycleExpense', entityId: 'expense-1', operation: 'CONFIRM', changes: { status: 'CONFIRMED' },
    } });
  });

  it('confirms a general expense draft', async () => {
    const { service, prisma } = makeService();
    prisma.generalExpense.findUnique.mockResolvedValue({ id: 'general-1', status: RecordStatus.DRAFT });

    await service.confirmGeneral('general-1');

    expect(prisma.generalExpense.updateMany).toHaveBeenCalledWith({
      where: { id: 'general-1', status: RecordStatus.DRAFT }, data: { status: RecordStatus.CONFIRMED },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'GeneralExpense', entityId: 'general-1', operation: 'CONFIRM', changes: { status: 'CONFIRMED' },
    } });
  });

  it.each(['', '    '])('rejects voiding a motorcycle expense with a blank reason (%p)', async (reason) => {
    const { service, prisma } = makeService();
    prisma.motorcycleExpense.findUnique.mockResolvedValue({ id: 'expense-1', status: RecordStatus.CONFIRMED });

    await expect(service.voidMotorcycle('expense-1', reason)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.motorcycleExpense.findUnique).not.toHaveBeenCalled();
    expect(prisma.motorcycleExpense.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['', '    '])('rejects voiding a general expense with a blank reason (%p)', async (reason) => {
    const { service, prisma } = makeService();
    prisma.generalExpense.findUnique.mockResolvedValue({ id: 'general-1', status: RecordStatus.CONFIRMED });

    await expect(service.voidGeneral('general-1', reason)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.generalExpense.findUnique).not.toHaveBeenCalled();
    expect(prisma.generalExpense.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['', '    '])('rejects a blank void reason in the request DTO (%p)', async (reason) => {
    const errors = await validate(Object.assign(new VoidExpenseDto(), { reason }));
    expect(errors.some(({ property }) => property === 'reason')).toBe(true);
  });

  it('voids a confirmed general expense and rejects voiding a draft', async () => {
    const confirmed = makeService();
    confirmed.prisma.generalExpense.findUnique.mockResolvedValue({ id: 'general-1', status: RecordStatus.CONFIRMED });
    await confirmed.service.voidGeneral('general-1', 'Motivo documentado');
    expect(confirmed.prisma.generalExpense.updateMany).toHaveBeenCalledWith({
      where: { id: 'general-1', status: RecordStatus.CONFIRMED },
      data: { status: RecordStatus.VOIDED, voidReason: 'Motivo documentado' },
    });
    expect(confirmed.prisma.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'GeneralExpense', entityId: 'general-1', operation: 'VOID',
      reason: 'Motivo documentado', changes: { status: 'VOIDED' },
    } });

    const draft = makeService();
    draft.prisma.generalExpense.findUnique.mockResolvedValue({ id: 'general-1', status: RecordStatus.DRAFT });
    await expect(draft.service.voidGeneral('general-1', 'Motivo documentado')).rejects.toBeInstanceOf(ConflictException);
    expect(draft.prisma.generalExpense.updateMany).not.toHaveBeenCalled();
  });

  it('creates a motorcycle expense replacement for a voided expense on the same motorcycle', async () => {
    const { service, prisma } = makeService();
    prisma.expenseCategory.findUnique.mockResolvedValue({ id: 'category-1', active: true, scope: 'MOTORCYCLE' });
    prisma.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1' });
    prisma.motorcycleExpense.findUnique.mockResolvedValue({
      id: 'expense-old', motorcycleId: 'moto-1', status: RecordStatus.VOIDED,
    });

    await service.createMotorcycle('moto-1', expenseDto('expense-old'));

    expect(prisma.motorcycleExpense.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ motorcycleId: 'moto-1', replacesId: 'expense-old' }),
    }));
  });

  it('rejects a motorcycle expense replacement from another motorcycle', async () => {
    const { service, prisma } = makeService();
    prisma.expenseCategory.findUnique.mockResolvedValue({ id: 'category-1', active: true, scope: 'MOTORCYCLE' });
    prisma.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1' });
    prisma.motorcycleExpense.findUnique.mockResolvedValue({
      id: 'expense-old', motorcycleId: 'moto-other', status: RecordStatus.VOIDED,
    });

    await expect(service.createMotorcycle('moto-1', expenseDto('expense-old')))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.motorcycleExpense.create).not.toHaveBeenCalled();
  });

  it('creates a general expense replacement only for a voided general expense', async () => {
    const valid = makeService();
    valid.prisma.expenseCategory.findUnique.mockResolvedValue({ id: 'category-1', active: true, scope: 'GENERAL' });
    valid.prisma.generalExpense.findUnique.mockResolvedValue({ id: 'general-old', status: RecordStatus.VOIDED });
    await valid.service.createGeneral(expenseDto('general-old'));
    expect(valid.prisma.generalExpense.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ replacesId: 'general-old' }),
    }));

    const notVoided = makeService();
    notVoided.prisma.expenseCategory.findUnique.mockResolvedValue({ id: 'category-1', active: true, scope: 'GENERAL' });
    notVoided.prisma.generalExpense.findUnique.mockResolvedValue({ id: 'general-old', status: RecordStatus.CONFIRMED });
    await expect(notVoided.service.createGeneral(expenseDto('general-old'))).rejects.toBeInstanceOf(BadRequestException);
    expect(notVoided.prisma.generalExpense.create).not.toHaveBeenCalled();
  });
});
