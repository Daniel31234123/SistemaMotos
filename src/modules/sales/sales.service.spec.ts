import { BadRequestException, ConflictException } from '@nestjs/common';
import { MotorcycleStatus, Prisma, SaleStatus } from '@prisma/client';
import { validate } from 'class-validator';
import { PrismaService } from '../../database/prisma.service';
import { CancelSaleDto } from './dto/cancel-sale.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { SalesService } from './sales.service';

describe('SalesService critical transitions', () => {
  const makeService = () => {
    const tx = {
      sale: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'sale-1', status: SaleStatus.CONFIRMED }),
      },
      motorcycle: {
        update: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'moto-1', status: MotorcycleStatus.AVAILABLE }),
      },
      auditEvent: { create: jest.fn() },
    };
    const prisma = {
      sale: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'sale-1' }) },
      motorcycle: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      customer: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { service: new SalesService(prisma as unknown as PrismaService), prisma, tx };
  };

  it('creates a draft using the current motorcycle price and selected customer/type', async () => {
    const { service, prisma } = makeService();
    prisma.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1', status: MotorcycleStatus.AVAILABLE, salePriceCop: new Prisma.Decimal('9200000.00') });
    prisma.customer.findUnique.mockResolvedValue({ id: 'customer-1' });
    const dto: CreateSaleDto = { motorcycleId: 'moto-1', customerId: 'customer-1', type: 'CREDIT' };

    await service.createDraft(dto);

    expect(prisma.sale.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { motorcycleId: 'moto-1', customerId: 'customer-1', type: 'CREDIT', motorcyclePriceCop: new Prisma.Decimal('9200000.00') },
      include: expect.any(Object),
    }));
  });

  it('rejects creating a draft for a motorcycle that already has a confirmed sale', async () => {
    const { service, prisma } = makeService();
    prisma.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1', status: MotorcycleStatus.SOLD });
    prisma.customer.findUnique.mockResolvedValue({ id: 'customer-1' });

    await expect(service.createDraft({ motorcycleId: 'moto-1', customerId: 'customer-1', type: 'CASH' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it('confirms a draft sale only when its motorcycle is available, in one transaction', async () => {
    const { service, tx, prisma } = makeService();
    tx.sale.findUnique.mockResolvedValue({
      id: 'sale-1', status: SaleStatus.DRAFT, motorcycleId: 'moto-1',
      motorcycle: { id: 'moto-1', status: MotorcycleStatus.AVAILABLE },
    });

    await service.confirm('sale-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.motorcycle.update).toHaveBeenCalledWith({ where: { id: 'moto-1' }, data: { status: MotorcycleStatus.SOLD } });
    expect(tx.sale.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sale-1' },
      data: { status: SaleStatus.CONFIRMED, saleDate: expect.any(Date) },
    }));
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'Sale', entityId: 'sale-1', saleId: 'sale-1', operation: 'CONFIRM',
      changes: { status: { from: 'DRAFT', to: 'CONFIRMED' }, motorcycleStatus: 'SOLD' },
    } });
  });

  it('rejects confirmation when the motorcycle is not available and writes nothing', async () => {
    const { service, tx } = makeService();
    tx.sale.findUnique.mockResolvedValue({
      id: 'sale-1', status: SaleStatus.DRAFT, motorcycleId: 'moto-1',
      motorcycle: { id: 'moto-1', status: MotorcycleStatus.REGISTERED },
    });

    await expect(service.confirm('sale-1')).rejects.toBeInstanceOf(ConflictException);

    expect(tx.motorcycle.update).not.toHaveBeenCalled();
    expect(tx.sale.update).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['P2002', 'P2034'])('maps database uniqueness/concurrency errors (%s) to a sale conflict', async (code) => {
    const { service, tx } = makeService();
    tx.sale.findUnique.mockResolvedValue({
      id: 'sale-1', status: SaleStatus.DRAFT, motorcycleId: 'moto-1',
      motorcycle: { id: 'moto-1', status: MotorcycleStatus.AVAILABLE },
    });
    tx.motorcycle.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('concurrent sale', {
      code, clientVersion: '6.19.3',
    }));

    await expect(service.confirm('sale-1')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.sale.update).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('cancels a confirmed sale with its reason and does not return the motorcycle automatically', async () => {
    const { service, tx } = makeService();
    tx.sale.findUnique.mockResolvedValue({ id: 'sale-1', status: SaleStatus.CONFIRMED });

    await service.cancel('sale-1', '  Venta corregida  ');

    expect(tx.sale.update).toHaveBeenCalledWith({
      where: { id: 'sale-1' },
      data: { status: SaleStatus.CANCELLED, cancellationReason: 'Venta corregida', cancelledAt: expect.any(Date) },
    });
    expect(tx.motorcycle.update).not.toHaveBeenCalled();
    expect(tx.motorcycle.updateMany).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).toHaveBeenCalledWith({ data: {
      entityType: 'Sale', entityId: 'sale-1', saleId: 'sale-1', operation: 'CANCEL',
      reason: 'Venta corregida', changes: { status: { from: 'CONFIRMED', to: 'CANCELLED' } },
    } });
  });

  it.each(['', '   '])('rejects cancelling a sale with a blank reason (%p)', async (reason) => {
    const { service, tx } = makeService();
    tx.sale.findUnique.mockResolvedValue({ id: 'sale-1', status: SaleStatus.CONFIRMED });

    await expect(service.cancel('sale-1', reason)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.sale.findUnique).not.toHaveBeenCalled();
    expect(tx.sale.update).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('rejects a blank cancellation reason in the request DTO (%p)', async (reason) => {
    const errors = await validate(Object.assign(new CancelSaleDto(), { reason }));
    expect(errors.some(({ property }) => property === 'reason')).toBe(true);
  });

  it('requires a cancelled sale and an explicit reason before returning a sold motorcycle to available', async () => {
    const { service, prisma, tx } = makeService();
    prisma.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1', status: MotorcycleStatus.SOLD });
    prisma.sale.findFirst.mockResolvedValue({ id: 'sale-cancelled', status: SaleStatus.CANCELLED });
    tx.motorcycle.updateMany.mockResolvedValue({ count: 1 });

    await service.returnAvailable('moto-1', '  Confirmado sin entrega  ');

    expect(tx.motorcycle.updateMany).toHaveBeenCalledWith({
      where: { id: 'moto-1', status: MotorcycleStatus.SOLD },
      data: { status: MotorcycleStatus.AVAILABLE },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reason: 'Confirmado sin entrega' }),
    }));
  });

  it('rejects returning a motorcycle when there is no cancelled sale or the review reason is blank', async () => {
    const missingSale = makeService();
    missingSale.prisma.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1', status: MotorcycleStatus.SOLD });
    missingSale.prisma.sale.findFirst.mockResolvedValue(null);
    await expect(missingSale.service.returnAvailable('moto-1', 'Revisión válida'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(missingSale.prisma.$transaction).not.toHaveBeenCalled();

    const blankReason = makeService();
    blankReason.prisma.motorcycle.findUnique.mockResolvedValue({ id: 'moto-1', status: MotorcycleStatus.SOLD });
    blankReason.prisma.sale.findFirst.mockResolvedValue({ id: 'sale-cancelled', status: SaleStatus.CANCELLED });
    await expect(blankReason.service.returnAvailable('moto-1', '   ')).rejects.toThrow('El motivo de revisión es obligatorio.');
    expect(blankReason.prisma.$transaction).not.toHaveBeenCalled();
  });
});
