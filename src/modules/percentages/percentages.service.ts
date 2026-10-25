import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus, Prisma, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { currentPercentageAmount } from '../../common/economics';
import { ApplyPercentageDto, CreateRuleDto } from './dto/percentage.dto';
@Injectable()
export class PercentagesService {
  constructor(private readonly prisma: PrismaService) {}
  async createRule(dto: CreateRuleDto) {
    if (!dto.approvedBusinessRule) throw new BadRequestException('Confirma que esta regla comercial fue aprobada internamente.');
    const brand = await this.prisma.brand.findUnique({ where: { id: dto.brandId } });
    if (!brand?.active) throw new BadRequestException('Marca inexistente o inactiva.');
    const previous = await this.prisma.percentageRule.findFirst({ where: { brandId: dto.brandId }, orderBy: { version: 'desc' } });
    try {
      return await this.prisma.percentageRule.create({ data: { brandId: dto.brandId, ratePercent: dto.ratePercent, effectiveFrom: new Date(dto.effectiveFrom), version: (previous?.version ?? 0) + 1 } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('La versión de la regla ya existe; consulta las reglas de la marca e inténtalo de nuevo.');
      }
      throw error;
    }
  }
  listRules() { return this.prisma.percentageRule.findMany({ include: { brand: true }, orderBy: [{ brandId: 'asc' }, { effectiveFrom: 'desc' }] }); }
  async closeRule(id: string, effectiveTo: string) { const rule = await this.prisma.percentageRule.findUnique({ where: { id } }); if (!rule) throw new NotFoundException('Regla no encontrada.'); const end = new Date(effectiveTo); if (Number.isNaN(end.getTime()) || end < rule.effectiveFrom) throw new BadRequestException('La vigencia final debe ser igual o posterior a la vigencia inicial.'); return this.prisma.percentageRule.update({ where: { id }, data: { effectiveTo: end } }); }
  async candidates(saleId: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId }, include: { motorcycle: { include: { brand: true } }, procedures: { where: { status: 'CONFIRMED' } }, applications: true } });
    if (!sale) throw new NotFoundException('Venta no encontrada.');
    const base = sale.procedures.reduce((total, procedure) => total.plus(procedure.customerAmountCop).minus(procedure.businessCostCop), new Prisma.Decimal(0));
    const applicationDate = new Date();
    const rules = await this.prisma.percentageRule.findMany({ where: { brandId: sale.motorcycle.brandId, active: true }, orderBy: { effectiveFrom: 'desc' } });
    const effectiveRules = rules.filter((rule) => this.isEffective(rule, applicationDate));
    return { saleId, brand: sale.motorcycle.brand.name, baseCop: base.toFixed(2), applicationExists: sale.applications.length > 0, requiresManualReview: base.lessThanOrEqualTo(0), rules: effectiveRules.map((rule) => ({ id: rule.id, ratePercent: rule.ratePercent.toFixed(4), effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo, version: rule.version })) };
  }
  async apply(saleId: string, dto: ApplyPercentageDto) {
    if (!dto.confirmed) throw new BadRequestException('Debes confirmar explícitamente la regla seleccionada.');
    const appliedAt = new Date();
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId }, include: { motorcycle: { include: { brand: true } }, procedures: { where: { status: 'CONFIRMED' } } } });
    if (!sale) throw new NotFoundException('Venta no encontrada.');
    if (sale.status !== SaleStatus.CONFIRMED) throw new ConflictException('La venta debe estar confirmada.');
    const rule = await this.prisma.percentageRule.findUnique({ where: { id: dto.ruleId } });
    if (!rule || rule.brandId !== sale.motorcycle.brandId) throw new BadRequestException('La regla elegida no corresponde a la marca de esta operación.');
    if (!this.isEffective(rule, appliedAt)) throw new BadRequestException('La regla no está activa o fuera de su periodo de vigencia.');
    if (sale.procedures.length === 0) throw new BadRequestException('No hay trámites confirmados para revisar.');
    const base = sale.procedures.reduce((total, procedure) => total.plus(procedure.customerAmountCop).minus(procedure.businessCostCop), new Prisma.Decimal(0));
    const manualRate = new Prisma.Decimal(rule.ratePercent);
    const amount = base.greaterThan(0) ? base.mul(manualRate).div(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP) : new Prisma.Decimal(0);
    const status = base.greaterThan(0) ? ApplicationStatus.APPLIED : ApplicationStatus.REVIEW_REQUIRED;
    if (await this.prisma.percentageApplication.findUnique({ where: { saleId } })) throw new ConflictException('La venta ya tiene una aplicación registrada; utiliza un ajuste documentado.');
    return this.prisma.$transaction(async (tx) => {
      const app = await tx.percentageApplication.create({ data: { saleId, ruleId: rule.id, brandNameSnapshot: sale.motorcycle.brand.name, ratePercentSnapshot: rule.ratePercent, baseCop: base, amountCop: amount, appliedAt, manualReason: dto.reason.trim(), status } });
      await tx.auditEvent.create({ data: { entityType: 'PercentageApplication', entityId: app.id, saleId, operation: status === ApplicationStatus.APPLIED ? 'MANUAL_APPLY' : 'PENDING_REVIEW', reason: dto.reason.trim(), changes: { baseCop: base.toFixed(2), status, ruleId: rule.id } } });
      return app;
    });
  }
  async listApplications(saleId: string) {
    const applications = await this.prisma.percentageApplication.findMany({ where: { saleId }, include: { rule: { include: { brand: true } }, adjustments: true }, orderBy: { appliedAt: 'desc' } });
    return applications.map((application) => ({
      ...application,
      currentAmountCop: currentPercentageAmount(application.amountCop, application.adjustments).toFixed(2),
    }));
  }
  private isEffective(rule: { active: boolean; effectiveFrom: Date; effectiveTo: Date | null }, at: Date): boolean {
    const day = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const applicationDay = day(at);
    return rule.active && day(rule.effectiveFrom) <= applicationDay && (rule.effectiveTo === null || applicationDay <= day(rule.effectiveTo));
  }
  async adjust(id: string, dto: { amountDeltaCop: string; reason: string }) {
    const app = await this.prisma.percentageApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('Aplicación no encontrada.');
    return this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.percentageAdjustment.create({ data: { applicationId: id, amountDeltaCop: dto.amountDeltaCop, reason: dto.reason.trim() } });
      await tx.auditEvent.create({ data: { entityType: 'PercentageApplication', entityId: id, saleId: app.saleId, operation: 'MANUAL_ADJUSTMENT', reason: dto.reason.trim(), changes: { adjustmentId: adjustment.id, amountDeltaCop: dto.amountDeltaCop } } });
      return adjustment;
    });
  }
}
