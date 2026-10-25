import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecordStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateProcedureDto } from './dto/procedure.dto';
import { normalizeLabel } from '../../common/normalize';
@Injectable()
export class ProceduresService {
  constructor(private readonly prisma: PrismaService) {}
  async createType(name: string) { const normalized = normalizeLabel(name); try { return await this.prisma.procedureType.create({ data: { name: name.trim(), normalized } }); } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`El tipo ${normalized} ya existe.`); throw e; } }
  listTypes() { return this.prisma.procedureType.findMany({ orderBy: { name: 'asc' } }); }
  async updateType(id: string, name: string) { try { return await this.prisma.procedureType.update({ where: { id }, data: { name: name.trim(), normalized: normalizeLabel(name) } }); } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Ya existe ese tipo de trámite.'); if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Tipo de trámite no encontrado.'); throw e; } }
  async deactivateType(id: string) { try { return await this.prisma.procedureType.update({ where: { id }, data: { active: false } }); } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Tipo de trámite no encontrado.'); throw e; } }
  async create(saleId: string, dto: CreateProcedureDto) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId }, include: { procedures: true } });
    if (!sale) throw new NotFoundException('Venta no encontrada.');
    if (sale.status !== SaleStatus.CONFIRMED) throw new ConflictException('Solo se registran trámites en ventas confirmadas.');
    const type = await this.prisma.procedureType.findUnique({ where: { id: dto.procedureTypeId } });
    if (!type?.active) throw new BadRequestException('Tipo de trámite inexistente o inactivo.');
    if (Number(dto.customerAmountCop) < 0 || Number(dto.businessCostCop) < 0) throw new BadRequestException('Los importes no pueden ser negativos.');
    if (dto.replacesId) { const original = await this.prisma.saleProcedure.findUnique({ where: { id: dto.replacesId } }); if (!original || original.status !== RecordStatus.VOIDED || original.saleId !== saleId) throw new BadRequestException('El registro reemplazado debe ser un trámite anulado de la misma venta.'); }
    return this.prisma.saleProcedure.create({ data: { saleId, procedureTypeId: type.id, nameSnapshot: type.name, description: dto.description, customerAmountCop: dto.customerAmountCop, businessCostCop: dto.businessCostCop, procedureDate: new Date(dto.procedureDate), replacesId: dto.replacesId } });
  }
  async list(saleId: string) { if (!await this.prisma.sale.findUnique({ where: { id: saleId } })) throw new NotFoundException('Venta no encontrada.'); return this.prisma.saleProcedure.findMany({ where: { saleId }, orderBy: { procedureDate: 'asc' } }); }
  async updateDraft(id: string, dto: Partial<CreateProcedureDto>) { const row = await this.get(id); if (row.status !== RecordStatus.DRAFT) throw new ConflictException('Solo se editan trámites en borrador.'); const data: Prisma.SaleProcedureUpdateInput = { ...dto }; if (dto.procedureDate) data.procedureDate = new Date(dto.procedureDate); if (dto.customerAmountCop !== undefined) data.customerAmountCop = dto.customerAmountCop; if (dto.businessCostCop !== undefined) data.businessCostCop = dto.businessCostCop; return this.prisma.saleProcedure.update({ where: { id }, data }); }
  async confirm(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.saleProcedure.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Trámite no encontrado.');
      if (row.status !== RecordStatus.DRAFT) throw new ConflictException('El trámite no está en borrador.');
      const changed = await tx.saleProcedure.updateMany({ where: { id, status: RecordStatus.DRAFT }, data: { status: RecordStatus.CONFIRMED } });
      if (changed.count !== 1) throw new ConflictException('El estado del trámite cambió; vuelve a consultar.');
      const updated = await tx.saleProcedure.findUniqueOrThrow({ where: { id } });
      await tx.auditEvent.create({ data: { entityType: 'SaleProcedure', entityId: id, saleId: row.saleId, operation: 'CONFIRM', changes: { status: 'CONFIRMED' } } });
      return updated;
    });
  }
  async void(id: string, reason: string) {
    const voidReason = reason.trim();
    if (!voidReason) throw new BadRequestException('El motivo de anulación del trámite es obligatorio.');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.saleProcedure.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Trámite no encontrado.');
      if (row.status !== RecordStatus.CONFIRMED) throw new ConflictException('Solo se anulan trámites confirmados.');
      const changed = await tx.saleProcedure.updateMany({ where: { id, status: RecordStatus.CONFIRMED }, data: { status: RecordStatus.VOIDED, voidReason } });
      if (changed.count !== 1) throw new ConflictException('El estado del trámite cambió; vuelve a consultar.');
      const updated = await tx.saleProcedure.findUniqueOrThrow({ where: { id } });
      await tx.auditEvent.create({ data: { entityType: 'SaleProcedure', entityId: id, saleId: row.saleId, operation: 'VOID', reason, changes: { status: 'VOIDED' } } });
      return updated;
    });
  }
  private async get(id: string) { const row = await this.prisma.saleProcedure.findUnique({ where: { id } }); if (!row) throw new NotFoundException('Trámite no encontrado.'); return row; }
}
