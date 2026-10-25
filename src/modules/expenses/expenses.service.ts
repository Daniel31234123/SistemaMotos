import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ExpenseScope, Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { normalizeLabel } from '../../common/normalize';
import { CreateCategoryDto, CreateExpenseDto } from './dto/expense.dto';
@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}
  async createCategory(dto: CreateCategoryDto) { try { return await this.prisma.expenseCategory.create({ data: { name: dto.name.trim(), normalized: normalizeLabel(dto.name), scope: dto.scope as ExpenseScope } }); } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('La categoría ya existe.'); throw e; } }
  categories() { return this.prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } }); }
  async updateCategory(id: string, dto: CreateCategoryDto) { try { return await this.prisma.expenseCategory.update({ where: { id }, data: { name: dto.name.trim(), normalized: normalizeLabel(dto.name), scope: dto.scope as ExpenseScope } }); } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('La categoría ya existe.'); if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Categoría no encontrada.'); throw e; } }
  async deactivateCategory(id: string) { try { return await this.prisma.expenseCategory.update({ where: { id }, data: { active: false } }); } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Categoría no encontrada.'); throw e; } }
  async createMotorcycle(motorcycleId: string, dto: CreateExpenseDto) { await this.ensureCategory(dto.categoryId, 'MOTORCYCLE'); if (!await this.prisma.motorcycle.findUnique({ where: { id: motorcycleId } })) throw new NotFoundException('Motocicleta no encontrada.'); this.checkAmount(dto.amountCop); await this.validateReplacement(dto.replacesId, 'MOTORCYCLE', motorcycleId); return this.prisma.motorcycleExpense.create({ data: { motorcycleId, categoryId: dto.categoryId, expenseDate: this.date(dto.expenseDate), description: dto.description.trim(), amountCop: dto.amountCop, replacesId: dto.replacesId } }); }
  async createGeneral(dto: CreateExpenseDto) { await this.ensureCategory(dto.categoryId, 'GENERAL'); this.checkAmount(dto.amountCop); await this.validateReplacement(dto.replacesId, 'GENERAL'); return this.prisma.generalExpense.create({ data: { categoryId: dto.categoryId, expenseDate: this.date(dto.expenseDate), description: dto.description.trim(), amountCop: dto.amountCop, replacesId: dto.replacesId } }); }
  listMotorcycle(motorcycleId: string) { return this.prisma.motorcycleExpense.findMany({ where: { motorcycleId }, include: { category: true }, orderBy: { expenseDate: 'desc' }, take: 200 }); }
  listGeneral() { return this.prisma.generalExpense.findMany({ include: { category: true }, orderBy: { expenseDate: 'desc' }, take: 200 }); }
  async updateMotorcycle(id: string, dto: Partial<CreateExpenseDto>) { const row = await this.motorcycleExpense(id); if (row.status !== RecordStatus.DRAFT) throw new ConflictException('Solo se editan gastos en borrador.'); if (dto.categoryId) await this.ensureCategory(dto.categoryId, 'MOTORCYCLE'); if (dto.amountCop) this.checkAmount(dto.amountCop); return this.prisma.motorcycleExpense.update({ where: { id }, data: { ...dto, expenseDate: dto.expenseDate ? this.date(dto.expenseDate) : undefined } }); }
  async updateGeneral(id: string, dto: Partial<CreateExpenseDto>) { const row = await this.generalExpense(id); if (row.status !== RecordStatus.DRAFT) throw new ConflictException('Solo se editan gastos en borrador.'); if (dto.categoryId) await this.ensureCategory(dto.categoryId, 'GENERAL'); if (dto.amountCop) this.checkAmount(dto.amountCop); return this.prisma.generalExpense.update({ where: { id }, data: { ...dto, expenseDate: dto.expenseDate ? this.date(dto.expenseDate) : undefined } }); }
  async confirmMotorcycle(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.motorcycleExpense.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Gasto de motocicleta no encontrado.');
      if (row.status !== RecordStatus.DRAFT) throw new ConflictException('Solo se confirman gastos en borrador.');
      const changed = await tx.motorcycleExpense.updateMany({ where: { id, status: RecordStatus.DRAFT }, data: { status: RecordStatus.CONFIRMED } });
      if (changed.count !== 1) throw new ConflictException('El estado del gasto cambió; vuelve a consultar.');
      const updated = await tx.motorcycleExpense.findUniqueOrThrow({ where: { id } });
      await tx.auditEvent.create({ data: { entityType: 'MotorcycleExpense', entityId: id, operation: 'CONFIRM', changes: { status: 'CONFIRMED' } } });
      return updated;
    });
  }
  async confirmGeneral(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.generalExpense.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Gasto general no encontrado.');
      if (row.status !== RecordStatus.DRAFT) throw new ConflictException('Solo se confirman gastos en borrador.');
      const changed = await tx.generalExpense.updateMany({ where: { id, status: RecordStatus.DRAFT }, data: { status: RecordStatus.CONFIRMED } });
      if (changed.count !== 1) throw new ConflictException('El estado del gasto cambió; vuelve a consultar.');
      const updated = await tx.generalExpense.findUniqueOrThrow({ where: { id } });
      await tx.auditEvent.create({ data: { entityType: 'GeneralExpense', entityId: id, operation: 'CONFIRM', changes: { status: 'CONFIRMED' } } });
      return updated;
    });
  }
  async voidMotorcycle(id: string, reason: string) {
    const voidReason = reason.trim();
    if (!voidReason) throw new BadRequestException('El motivo de anulación del gasto es obligatorio.');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.motorcycleExpense.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Gasto de motocicleta no encontrado.');
      if (row.status !== RecordStatus.CONFIRMED) throw new ConflictException('Solo se anulan gastos confirmados.');
      const changed = await tx.motorcycleExpense.updateMany({ where: { id, status: RecordStatus.CONFIRMED }, data: { status: RecordStatus.VOIDED, voidReason } });
      if (changed.count !== 1) throw new ConflictException('El estado del gasto cambió; vuelve a consultar.');
      const updated = await tx.motorcycleExpense.findUniqueOrThrow({ where: { id } });
      await tx.auditEvent.create({ data: { entityType: 'MotorcycleExpense', entityId: id, operation: 'VOID', reason, changes: { status: 'VOIDED' } } });
      return updated;
    });
  }
  async voidGeneral(id: string, reason: string) {
    const voidReason = reason.trim();
    if (!voidReason) throw new BadRequestException('El motivo de anulación del gasto es obligatorio.');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.generalExpense.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Gasto general no encontrado.');
      if (row.status !== RecordStatus.CONFIRMED) throw new ConflictException('Solo se anulan gastos confirmados.');
      const changed = await tx.generalExpense.updateMany({ where: { id, status: RecordStatus.CONFIRMED }, data: { status: RecordStatus.VOIDED, voidReason } });
      if (changed.count !== 1) throw new ConflictException('El estado del gasto cambió; vuelve a consultar.');
      const updated = await tx.generalExpense.findUniqueOrThrow({ where: { id } });
      await tx.auditEvent.create({ data: { entityType: 'GeneralExpense', entityId: id, operation: 'VOID', reason, changes: { status: 'VOIDED' } } });
      return updated;
    });
  }
  private async ensureCategory(id: string, type: 'MOTORCYCLE'|'GENERAL') { const category = await this.prisma.expenseCategory.findUnique({ where: { id } }); if (!category?.active) throw new BadRequestException('Categoría inexistente o inactiva.'); if (category.scope !== 'BOTH' && category.scope !== type) throw new BadRequestException('El alcance de la categoría no corresponde a este gasto.'); }
  private async validateReplacement(id: string | undefined, type: 'MOTORCYCLE'|'GENERAL', motorcycleId?: string) { if (!id) return; const row = type === 'MOTORCYCLE' ? await this.prisma.motorcycleExpense.findUnique({ where: { id } }) : await this.prisma.generalExpense.findUnique({ where: { id } }); if (!row || row.status !== RecordStatus.VOIDED || (type === 'MOTORCYCLE' && 'motorcycleId' in row && row.motorcycleId !== motorcycleId)) throw new BadRequestException('El registro reemplazado debe estar anulado y corresponder al mismo ámbito.'); }
  private checkAmount(value: string) { if (Number(value) < 0) throw new BadRequestException('El importe no puede ser negativo.'); }
  private date(value: string) { const result = new Date(value); if (Number.isNaN(result.getTime())) throw new BadRequestException('Fecha inválida.'); return result; }
  private async motorcycleExpense(id: string) { const row = await this.prisma.motorcycleExpense.findUnique({ where: { id } }); if (!row) throw new NotFoundException('Gasto de motocicleta no encontrado.'); return row; }
  private async generalExpense(id: string) { const row = await this.prisma.generalExpense.findUnique({ where: { id } }); if (!row) throw new NotFoundException('Gasto general no encontrado.'); return row; }
}
