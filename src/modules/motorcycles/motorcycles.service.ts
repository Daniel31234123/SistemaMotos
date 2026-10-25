import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IdentifierType, MotorcycleStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { normalizeIdentifier } from '../../common/normalize';
import { CreateMotorcycleDto } from './dto/create-motorcycle.dto';
import { UpdateMotorcycleDto } from './dto/update-motorcycle.dto';

const identifierKeys = { ENGINE: 'engineNumber', CHASSIS: 'chassisNumber', PLATE: 'plate' } as const;
type IdentifierInput = Pick<CreateMotorcycleDto, 'engineNumber' | 'chassisNumber' | 'plate'>;

@Injectable()
export class MotorcyclesService {
  constructor(private readonly prisma: PrismaService) {}
  async create(dto: CreateMotorcycleDto) {
    const brand = await this.prisma.brand.findUnique({ where: { id: dto.brandId } });
    if (!brand || !brand.active) throw new BadRequestException('La marca no existe o está inactiva.');
    this.validateNonNegative(dto.salePriceCop, dto.acquisitionCostCop);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const moto = await tx.motorcycle.create({ data: { brandId: dto.brandId, line: dto.line.trim(), modelYear: dto.modelYear, color: dto.color.trim(), displacementCc: dto.displacementCc, salePriceCop: dto.salePriceCop, acquisitionCostCop: dto.acquisitionCostCop } });
        for (const row of this.identifierRows(dto)) await tx.motorcycleIdentifier.create({ data: { ...row, motorcycleId: moto.id } });
        await tx.auditEvent.create({ data: { entityType: 'Motorcycle', entityId: moto.id, operation: 'CREATE', changes: { status: 'REGISTERED', brandId: dto.brandId } } });
        return tx.motorcycle.findUniqueOrThrow({ where: { id: moto.id }, include: { brand: true, identifiers: { where: { status: 'ACTIVE' } } } });
      });
    } catch (error) { this.mapUniqueConflict(error); }
  }
  list(brandId?: string, status?: string) {
    const validStatus = status && Object.values(MotorcycleStatus).includes(status as MotorcycleStatus) ? status as MotorcycleStatus : undefined;
    return this.prisma.motorcycle.findMany({ where: { ...(brandId ? { brandId } : {}), ...(validStatus ? { status: validStatus } : {}) }, include: { brand: true, identifiers: { where: { status: 'ACTIVE' } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  async get(id: string) { const row = await this.prisma.motorcycle.findUnique({ where: { id }, include: { brand: true, identifiers: { orderBy: { assignedAt: 'desc' } } } }); if (!row) throw new NotFoundException('Motocicleta no encontrada.'); return row; }
  async update(id: string, dto: UpdateMotorcycleDto) {
    await this.get(id);
    if (dto.brandId) { const brand = await this.prisma.brand.findUnique({ where: { id: dto.brandId } }); if (!brand?.active) throw new BadRequestException('La marca no existe o está inactiva.'); }
    if (dto.salePriceCop !== undefined) this.validateNonNegative(dto.salePriceCop);
    if (dto.acquisitionCostCop !== undefined) this.validateNonNegative(dto.acquisitionCostCop);
    const { engineNumber, chassisNumber, plate, identifierChangeReason, ...data } = dto;
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length) await tx.motorcycle.update({ where: { id }, data });
        for (const [type, key] of Object.entries(identifierKeys) as [IdentifierType, keyof IdentifierInput][]) {
          const value = { engineNumber, chassisNumber, plate }[key];
          if (value === undefined) continue;
          const current = await tx.motorcycleIdentifier.findFirst({ where: { motorcycleId: id, type, status: 'ACTIVE' } });
          const normalized = normalizeIdentifier(value);
          if (current?.normalized === normalized) continue;
          if (current) {
            const reason = identifierChangeReason?.trim();
            if (!reason) throw new BadRequestException('Indica un motivo válido para sustituir o corregir el identificador.');
            await tx.motorcycleIdentifier.update({ where: { id: current.id }, data: { status: 'REPLACED', replacedAt: new Date(), reason } });
          }
          if (value.trim()) await tx.motorcycleIdentifier.create({ data: { motorcycleId: id, type, value: value.trim(), normalized } });
        }
        await tx.auditEvent.create({ data: { entityType: 'Motorcycle', entityId: id, operation: 'UPDATE', changes: { fields: Object.keys(dto) } } });
        return tx.motorcycle.findUniqueOrThrow({ where: { id }, include: { brand: true, identifiers: { orderBy: { assignedAt: 'desc' } } } });
      });
    } catch (error) { this.mapUniqueConflict(error); }
  }
  async markAvailable(id: string, readyToOffer: boolean) {
    if (!readyToOffer) throw new BadRequestException('El operador debe confirmar que la moto está lista para ofrecerse.');
    const moto = await this.get(id);
    if (moto.status !== MotorcycleStatus.REGISTERED) throw new ConflictException('Solo una moto registrada puede pasar a disponible.');
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.motorcycle.updateMany({ where: { id, status: MotorcycleStatus.REGISTERED }, data: { status: MotorcycleStatus.AVAILABLE } });
      if (result.count !== 1) throw new ConflictException('El estado de la moto cambió; vuelve a consultar.');
      await tx.auditEvent.create({ data: { entityType: 'Motorcycle', entityId: id, operation: 'MARK_AVAILABLE', changes: { from: 'REGISTERED', to: 'AVAILABLE' } } });
      return tx.motorcycle.findUniqueOrThrow({ where: { id }, include: { brand: true } });
    });
  }
  async history(id: string) { await this.get(id); return { sales: await this.prisma.sale.findMany({ where: { motorcycleId: id }, include: { procedures: true, applications: { include: { adjustments: true } }, customer: true }, orderBy: { createdAt: 'desc' } }), expenses: await this.prisma.motorcycleExpense.findMany({ where: { motorcycleId: id }, orderBy: { expenseDate: 'desc' } }), identifiers: (await this.get(id)).identifiers }; }
  private validateNonNegative(...values: string[]) { if (values.some((value) => Number(value) < 0)) throw new BadRequestException('Los importes no pueden ser negativos.'); }
  private identifierRows(dto: IdentifierInput) {
    return (Object.entries(identifierKeys) as [IdentifierType, keyof IdentifierInput][]).flatMap(([type, key]) => { const value = dto[key]; return value?.trim() ? [{ type, value: value.trim(), normalized: normalizeIdentifier(value) }] : []; });
  }
  private mapUniqueConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('El identificador ya está asociado a otra motocicleta.');
    throw error;
  }
}
