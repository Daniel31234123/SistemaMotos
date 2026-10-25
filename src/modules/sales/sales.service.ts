import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MotorcycleStatus, Prisma, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}
  async createDraft(dto: CreateSaleDto) {
    const [motorcycle, customer] = await Promise.all([this.prisma.motorcycle.findUnique({ where: { id: dto.motorcycleId } }), this.prisma.customer.findUnique({ where: { id: dto.customerId } })]);
    if (!motorcycle) throw new NotFoundException('Motocicleta no encontrada.');
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    if (motorcycle.status === MotorcycleStatus.SOLD) throw new ConflictException('La motocicleta ya tiene una venta confirmada.');
    return this.prisma.sale.create({ data: { motorcycleId: motorcycle.id, customerId: customer.id, type: dto.type, motorcyclePriceCop: motorcycle.salePriceCop }, include: { motorcycle: { include: { brand: true } }, customer: true } });
  }
  list(status?: string, from?: string, to?: string) {
    const where: Prisma.SaleWhereInput = {};
    if (status && Object.values(SaleStatus).includes(status as SaleStatus)) where.status = status as SaleStatus;
    if (from || to) where.saleDate = { ...(from ? { gte: this.parseDate(from) } : {}), ...(to ? { lte: this.parseDate(to) } : {}) };
    return this.prisma.sale.findMany({ where, include: { motorcycle: { include: { brand: true } }, customer: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  async get(id: string) { const sale = await this.prisma.sale.findUnique({ where: { id }, include: { motorcycle: { include: { brand: true } }, customer: true, procedures: true, applications: { include: { rule: true, adjustments: true } } } }); if (!sale) throw new NotFoundException('Venta no encontrada.'); return sale; }
  async confirm(id: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const sale = await tx.sale.findUnique({ where: { id }, include: { motorcycle: true } });
        if (!sale) throw new NotFoundException('Venta no encontrada.');
        if (sale.status !== SaleStatus.DRAFT) throw new ConflictException('Solo se puede confirmar una venta en borrador.');
        if (sale.motorcycle.status !== MotorcycleStatus.AVAILABLE) throw new ConflictException('La motocicleta debe estar disponible para confirmar la venta.');
        await tx.motorcycle.update({ where: { id: sale.motorcycleId }, data: { status: MotorcycleStatus.SOLD } });
        const confirmed = await tx.sale.update({ where: { id }, data: { status: SaleStatus.CONFIRMED, saleDate: new Date() }, include: { motorcycle: true, customer: true } });
        await tx.auditEvent.create({ data: { entityType: 'Sale', entityId: id, saleId: id, operation: 'CONFIRM', changes: { status: { from: 'DRAFT', to: 'CONFIRMED' }, motorcycleStatus: 'SOLD' } } });
        return confirmed;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) throw new ConflictException('La motocicleta ya tiene una venta activa o hubo una concurrencia; consulta el estado e inténtalo de nuevo.');
      throw error;
    }
  }
  async cancel(id: string, reason: string) {
    const cancellationReason = reason.trim();
    if (!cancellationReason) throw new BadRequestException('El motivo de cancelación es obligatorio.');
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id } });
      if (!sale) throw new NotFoundException('Venta no encontrada.');
      if (sale.status !== SaleStatus.CONFIRMED) throw new ConflictException('Solo se puede cancelar una venta confirmada.');
      const cancelled = await tx.sale.update({ where: { id }, data: { status: SaleStatus.CANCELLED, cancellationReason, cancelledAt: new Date() } });
      await tx.auditEvent.create({ data: { entityType: 'Sale', entityId: id, saleId: id, operation: 'CANCEL', reason: cancellationReason, changes: { status: { from: 'CONFIRMED', to: 'CANCELLED' } } } });
      return cancelled;
    });
  }
  async returnAvailable(motorcycleId: string, reason: string) {
    const moto = await this.prisma.motorcycle.findUnique({ where: { id: motorcycleId } });
    if (!moto) throw new NotFoundException('Motocicleta no encontrada.');
    if (moto.status !== MotorcycleStatus.SOLD) throw new ConflictException('Solo una motocicleta vendida puede someterse a revisión de disponibilidad.');
    const cancelledSale = await this.prisma.sale.findFirst({ where: { motorcycleId, status: SaleStatus.CANCELLED }, orderBy: { cancelledAt: 'desc' } });
    if (!cancelledSale) throw new ConflictException('No hay una venta cancelada que justifique la revisión.');
    if (!reason.trim()) throw new BadRequestException('El motivo de revisión es obligatorio.');
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.motorcycle.updateMany({ where: { id: motorcycleId, status: MotorcycleStatus.SOLD }, data: { status: MotorcycleStatus.AVAILABLE } });
      if (result.count !== 1) throw new ConflictException('El estado cambió; vuelve a consultar.');
      await tx.auditEvent.create({ data: { entityType: 'Motorcycle', entityId: motorcycleId, operation: 'RETURN_TO_AVAILABLE', reason: reason.trim(), changes: { from: 'SOLD', to: 'AVAILABLE', cancelledSaleId: cancelledSale.id } } });
      return tx.motorcycle.findUniqueOrThrow({ where: { id: motorcycleId }, include: { brand: true } });
    });
  }
  private parseDate(value: string): Date { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new BadRequestException('Fecha inválida.'); return date; }
}
