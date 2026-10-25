import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { PrismaService } from '../../database/prisma.service';
import { CreateMotorcycleDto } from './dto/create-motorcycle.dto';
import { MotorcyclesService } from './motorcycles.service';

describe('MotorcyclesService identifier history', () => {
  const makeService = () => {
    const tx = {
      motorcycle: {
        create: jest.fn().mockResolvedValue({ id: 'moto-1' }),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'moto-1' }),
      },
      motorcycleIdentifier: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'identifier-old' }),
        create: jest.fn().mockResolvedValue({ id: 'identifier-new' }),
      },
      auditEvent: { create: jest.fn() },
    };
    const prisma = {
      brand: { findUnique: jest.fn().mockResolvedValue({ id: 'brand-1', active: true }) },
      motorcycle: { findUnique: jest.fn().mockResolvedValue({ id: 'moto-1' }) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { service: new MotorcyclesService(prisma as unknown as PrismaService), prisma, tx };
  };

  it('requires the motorcycle fields defined by the create DTO', async () => {
    const errors = await validate(new CreateMotorcycleDto());
    expect(errors.map(({ property }) => property).sort()).toEqual([
      'acquisitionCostCop', 'brandId', 'color', 'displacementCc', 'line', 'modelYear', 'salePriceCop',
    ]);
  });

  it('registers a motorcycle, its supplied identifiers and a creation audit event', async () => {
    const { service, prisma, tx } = makeService();
    const dto: CreateMotorcycleDto = {
      brandId: 'brand-1', line: '  Boxer  ', modelYear: 2025, color: '  Negro  ', displacementCc: 125,
      salePriceCop: '9000000.00', acquisitionCostCop: '7000000.00', engineNumber: ' eng-123 ', chassisNumber: ' ch-456 ',
    };

    await service.create(dto);

    expect(prisma.brand.findUnique).toHaveBeenCalledWith({ where: { id: 'brand-1' } });
    expect(tx.motorcycle.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      brandId: 'brand-1', line: 'Boxer', modelYear: 2025, color: 'Negro', displacementCc: 125,
      salePriceCop: '9000000.00', acquisitionCostCop: '7000000.00',
    }) });
    expect(tx.motorcycleIdentifier.create).toHaveBeenNthCalledWith(1, { data: {
      type: 'ENGINE', value: 'eng-123', normalized: 'ENG123', motorcycleId: 'moto-1',
    } });
    expect(tx.motorcycleIdentifier.create).toHaveBeenNthCalledWith(2, { data: {
      type: 'CHASSIS', value: 'ch-456', normalized: 'CH456', motorcycleId: 'moto-1',
    } });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'Motorcycle', entityId: 'moto-1', operation: 'CREATE',
      changes: { status: 'REGISTERED', brandId: 'brand-1' },
    } });
  });

  it('rejects registering a motorcycle with a negative amount before opening a transaction', async () => {
    const { service, prisma } = makeService();
    await expect(service.create({
      brandId: 'brand-1', line: 'Boxer', modelYear: 2025, color: 'Negro', displacementCc: 125,
      salePriceCop: '-1', acquisitionCostCop: '7000000.00',
    })).rejects.toThrow('Los importes no pueden ser negativos.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('moves a registered motorcycle to available only after explicit readiness confirmation', async () => {
    const { service, prisma, tx } = makeService();
    prisma.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1', status: 'REGISTERED' });
    tx.motorcycle.updateMany.mockResolvedValue({ count: 1 });

    await service.markAvailable('moto-1', true);

    expect(tx.motorcycle.updateMany).toHaveBeenCalledWith({
      where: { id: 'moto-1', status: 'REGISTERED' }, data: { status: 'AVAILABLE' },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'Motorcycle', entityId: 'moto-1', operation: 'MARK_AVAILABLE',
      changes: { from: 'REGISTERED', to: 'AVAILABLE' },
    } });
  });

  it('rejects availability without readiness confirmation or from a non-registered state', async () => {
    const notReady = makeService();
    await expect(notReady.service.markAvailable('moto-1', false)).rejects.toThrow();
    expect(notReady.prisma.$transaction).not.toHaveBeenCalled();

    const alreadySold = makeService();
    alreadySold.prisma.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1', status: 'SOLD' });
    await expect(alreadySold.service.markAvailable('moto-1', true)).rejects.toThrow();
    expect(alreadySold.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('maps an active identifier uniqueness conflict to a domain conflict', async () => {
    const { service, tx } = makeService();
    const uniqueConflict = new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002', clientVersion: '6.19.3',
    });
    tx.motorcycleIdentifier.create.mockRejectedValue(uniqueConflict);

    await expect(service.create({
      brandId: 'brand-1', line: 'Boxer', modelYear: 2025, color: 'Negro', displacementCc: 125,
      salePriceCop: '9000000.00', acquisitionCostCop: '7000000.00', engineNumber: 'ENG-123',
    })).rejects.toThrow('El identificador ya está asociado a otra motocicleta.');
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each([undefined, '   '])('requires a non-empty reason when replacing an active identifier (%p)', async (reason) => {
    const { service, tx } = makeService();
    tx.motorcycleIdentifier.findFirst.mockResolvedValue({ id: 'identifier-old', normalized: 'OLD123' });

    await expect(service.update('moto-1', { engineNumber: 'NEW-456', identifierChangeReason: reason }))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(tx.motorcycleIdentifier.update).not.toHaveBeenCalled();
    expect(tx.motorcycleIdentifier.create).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('keeps the old identifier in history and records a trimmed reason and replacement date', async () => {
    const { service, tx, prisma } = makeService();
    tx.motorcycleIdentifier.findFirst.mockResolvedValue({ id: 'identifier-old', normalized: 'OLD123' });

    await service.update('moto-1', {
      engineNumber: ' new-456 ',
      identifierChangeReason: '  Corrección del número de motor  ',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.motorcycleIdentifier.update).toHaveBeenCalledWith({
      where: { id: 'identifier-old' },
      data: {
        status: 'REPLACED',
        replacedAt: expect.any(Date),
        reason: 'Corrección del número de motor',
      },
    });
    expect(tx.motorcycleIdentifier.create).toHaveBeenCalledWith({
      data: { motorcycleId: 'moto-1', type: 'ENGINE', value: 'new-456', normalized: 'NEW456' },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'Motorcycle', entityId: 'moto-1', operation: 'UPDATE',
      changes: { fields: ['engineNumber', 'identifierChangeReason'] },
    } });
  });

  it('does not create a replacement when the normalized identifier is unchanged', async () => {
    const { service, tx } = makeService();
    tx.motorcycleIdentifier.findFirst.mockResolvedValue({ id: 'identifier-old', normalized: 'ABC123' });

    await service.update('moto-1', { engineNumber: 'ab-c 123' });

    expect(tx.motorcycleIdentifier.update).not.toHaveBeenCalled();
    expect(tx.motorcycleIdentifier.create).not.toHaveBeenCalled();
  });
});
