import { BadRequestException, ConflictException } from '@nestjs/common';
import { RecordStatus, SaleStatus } from '@prisma/client';
import { validate } from 'class-validator';
import { PrismaService } from '../../database/prisma.service';
import { CreateProcedureDto, VoidRecordDto } from './dto/procedure.dto';
import { ProceduresService } from './procedures.service';

describe('ProceduresService void and replacement', () => {
  const makeService = () => {
    const saleProcedure = {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'procedure-new' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const auditEvent = { create: jest.fn() };
    const tx = { saleProcedure, auditEvent };
    const prisma = {
      sale: { findUnique: jest.fn() },
      procedureType: { findUnique: jest.fn() },
      saleProcedure,
      auditEvent,
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { service: new ProceduresService(prisma as unknown as PrismaService), prisma };
  };

  it('voids only a confirmed procedure and keeps a trimmed reason', async () => {
    const { service, prisma } = makeService();
    prisma.saleProcedure.findUnique.mockResolvedValue({ id: 'procedure-1', saleId: 'sale-1', status: RecordStatus.CONFIRMED });

    await service.void('procedure-1', '  Valor corregido  ');

    expect(prisma.saleProcedure.updateMany).toHaveBeenCalledWith({
      where: { id: 'procedure-1', status: RecordStatus.CONFIRMED },
      data: { status: RecordStatus.VOIDED, voidReason: 'Valor corregido' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'SaleProcedure', entityId: 'procedure-1', saleId: 'sale-1', operation: 'VOID',
      reason: '  Valor corregido  ', changes: { status: 'VOIDED' },
    } });
  });

  it('confirms a draft procedure and records the confirmation audit event', async () => {
    const { service, prisma } = makeService();
    prisma.saleProcedure.findUnique.mockResolvedValue({ id: 'procedure-1', saleId: 'sale-1', status: RecordStatus.DRAFT });

    await service.confirm('procedure-1');

    expect(prisma.saleProcedure.updateMany).toHaveBeenCalledWith({
      where: { id: 'procedure-1', status: RecordStatus.DRAFT }, data: { status: RecordStatus.CONFIRMED },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'SaleProcedure', entityId: 'procedure-1', saleId: 'sale-1', operation: 'CONFIRM',
      changes: { status: 'CONFIRMED' },
    } });
  });

  it.each(['', '    '])('rejects voiding a procedure with a blank reason (%p)', async (reason) => {
    const { service, prisma } = makeService();
    prisma.saleProcedure.findUnique.mockResolvedValue({ id: 'procedure-1', saleId: 'sale-1', status: RecordStatus.CONFIRMED });

    await expect(service.void('procedure-1', reason)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.saleProcedure.findUnique).not.toHaveBeenCalled();
    expect(prisma.saleProcedure.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['', '    '])('rejects a blank void reason in the request DTO (%p)', async (reason) => {
    const errors = await validate(Object.assign(new VoidRecordDto(), { reason }));
    expect(errors.some(({ property }) => property === 'reason')).toBe(true);
  });

  it('rejects voiding a procedure that is not confirmed', async () => {
    const { service, prisma } = makeService();
    prisma.saleProcedure.findUnique.mockResolvedValue({ id: 'procedure-1', saleId: 'sale-1', status: RecordStatus.DRAFT });

    await expect(service.void('procedure-1', 'Motivo válido')).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.saleProcedure.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('creates a replacement linked to a voided procedure from the same sale', async () => {
    const { service, prisma } = makeService();
    prisma.sale.findUnique.mockResolvedValue({ id: 'sale-1', status: SaleStatus.CONFIRMED });
    prisma.procedureType.findUnique.mockResolvedValue({ id: 'type-1', name: 'Trámite', active: true });
    prisma.saleProcedure.findUnique.mockResolvedValue({ id: 'procedure-old', saleId: 'sale-1', status: RecordStatus.VOIDED });
    const dto: CreateProcedureDto = {
      procedureTypeId: 'type-1', customerAmountCop: '900000.00', businessCostCop: '400000.00',
      procedureDate: '2026-10-24T00:00:00.000Z', replacesId: 'procedure-old',
    };

    await service.create('sale-1', dto);

    expect(prisma.saleProcedure.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ saleId: 'sale-1', replacesId: 'procedure-old', nameSnapshot: 'Trámite' }),
    }));
  });

  it('creates a draft procedure from an active type on a confirmed sale', async () => {
    const { service, prisma } = makeService();
    prisma.sale.findUnique.mockResolvedValue({ id: 'sale-1', status: SaleStatus.CONFIRMED });
    prisma.procedureType.findUnique.mockResolvedValue({ id: 'type-1', name: 'Trámite', active: true });
    const dto: CreateProcedureDto = {
      procedureTypeId: 'type-1', customerAmountCop: '900000.00', businessCostCop: '400000.00',
      procedureDate: '2026-10-24T00:00:00.000Z', description: 'Gestión inicial',
    };

    await service.create('sale-1', dto);

    expect(prisma.saleProcedure.create).toHaveBeenCalledWith({ data: {
      saleId: 'sale-1', procedureTypeId: 'type-1', nameSnapshot: 'Trámite', description: 'Gestión inicial',
      customerAmountCop: '900000.00', businessCostCop: '400000.00',
      procedureDate: new Date('2026-10-24T00:00:00.000Z'), replacesId: undefined,
    } });
  });

  it('rejects replacing a procedure from another sale or one that is not voided', async () => {
    const wrongSale = makeService();
    wrongSale.prisma.sale.findUnique.mockResolvedValue({ id: 'sale-1', status: SaleStatus.CONFIRMED });
    wrongSale.prisma.procedureType.findUnique.mockResolvedValue({ id: 'type-1', name: 'Trámite', active: true });
    wrongSale.prisma.saleProcedure.findUnique.mockResolvedValue({ id: 'procedure-old', saleId: 'sale-other', status: RecordStatus.VOIDED });
    const dto: CreateProcedureDto = {
      procedureTypeId: 'type-1', customerAmountCop: '900000.00', businessCostCop: '400000.00',
      procedureDate: '2026-10-24T00:00:00.000Z', replacesId: 'procedure-old',
    };
    await expect(wrongSale.service.create('sale-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(wrongSale.prisma.saleProcedure.create).not.toHaveBeenCalled();

    const activeOriginal = makeService();
    activeOriginal.prisma.sale.findUnique.mockResolvedValue({ id: 'sale-1', status: SaleStatus.CONFIRMED });
    activeOriginal.prisma.procedureType.findUnique.mockResolvedValue({ id: 'type-1', name: 'Trámite', active: true });
    activeOriginal.prisma.saleProcedure.findUnique.mockResolvedValue({ id: 'procedure-old', saleId: 'sale-1', status: RecordStatus.CONFIRMED });
    await expect(activeOriginal.service.create('sale-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(activeOriginal.prisma.saleProcedure.create).not.toHaveBeenCalled();
  });
});
