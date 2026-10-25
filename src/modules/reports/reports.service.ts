import { BadRequestException, Injectable } from '@nestjs/common';
import { ApplicationStatus, Prisma, RecordStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { currentPercentageAmount } from '../../common/economics';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}
  private range(from: string, to: string) { const start = new Date(`${from}T00:00:00.000Z`); const end = new Date(`${to}T23:59:59.999Z`); if (!from || !to || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new BadRequestException('Indica un periodo válido con from y to.'); return { start, end }; }
  async sales(from: string, to: string) { const { start, end } = this.range(from, to); return this.prisma.sale.findMany({ where: { saleDate: { gte: start, lte: end } }, include: { motorcycle: { include: { brand: true } }, customer: true }, orderBy: { saleDate: 'asc' } }); }
  async procedures(from: string, to: string) {
    const { start, end } = this.range(from, to);
    const rows = await this.prisma.saleProcedure.findMany({ where: { procedureDate: { gte: start, lte: end }, status: { not: RecordStatus.DRAFT } }, include: { sale: { include: { motorcycle: { include: { brand: true } }, customer: true } }, procedureType: true }, orderBy: { procedureDate: 'asc' } });
    const current = rows.filter((r) => r.sale.status === SaleStatus.CONFIRMED && r.status === RecordStatus.CONFIRMED);
    const cancelled = rows.filter((r) => r.sale.status === SaleStatus.CANCELLED || r.status === RecordStatus.VOIDED);
    const sum = (items: typeof rows) => items.reduce((acc, row) => ({ income: acc.income.plus(row.customerAmountCop), cost: acc.cost.plus(row.businessCostCop) }), { income: new Prisma.Decimal(0), cost: new Prisma.Decimal(0) });
    const currentSum = sum(current); const historicalSum = sum(cancelled);
    return { current: { records: current, registeredIncomeCop: currentSum.income.toFixed(2), costsCop: currentSum.cost.toFixed(2), marginCop: currentSum.income.minus(currentSum.cost).toFixed(2) }, historicalExcluded: { records: cancelled, registeredIncomeCop: historicalSum.income.toFixed(2), costsCop: historicalSum.cost.toFixed(2), marginCop: historicalSum.income.minus(historicalSum.cost).toFixed(2) } };
  }
  async expenses(from: string, to: string) { const { start, end } = this.range(from, to); const where = { expenseDate: { gte: start, lte: end }, status: { not: RecordStatus.DRAFT } }; const [motorcycle, general] = await Promise.all([this.prisma.motorcycleExpense.findMany({ where, include: { category: true, motorcycle: { include: { brand: true } } }, orderBy: { expenseDate: 'asc' } }), this.prisma.generalExpense.findMany({ where, include: { category: true }, orderBy: { expenseDate: 'asc' } })]); return { motorcycle: this.expenseTotals(motorcycle), general: this.expenseTotals(general) }; }
  private expenseTotals<T extends { amountCop: Prisma.Decimal; status: RecordStatus }>(rows: T[]) { const current = rows.filter((r) => r.status === RecordStatus.CONFIRMED); const historical = rows.filter((r) => r.status === RecordStatus.VOIDED); const total = (items: T[]) => items.reduce((sum, row) => sum.plus(row.amountCop), new Prisma.Decimal(0)).toFixed(2); return { current: { records: current, totalCop: total(current) }, historicalExcluded: { records: historical, totalCop: total(historical) } }; }
  async percentages(from: string, to: string) {
    const { start, end } = this.range(from, to);
    const rows = await this.prisma.percentageApplication.findMany({ where: { appliedAt: { gte: start, lte: end } }, include: { sale: { include: { motorcycle: true } }, rule: true, adjustments: true }, orderBy: { appliedAt: 'asc' } });
    const withCurrentAmount = (row: (typeof rows)[number]) => ({
      ...row,
      currentAmountCop: currentPercentageAmount(row.amountCop, row.adjustments).toFixed(2),
    });
    const current = rows.filter((r) => r.sale.status === SaleStatus.CONFIRMED && r.status === ApplicationStatus.APPLIED).map(withCurrentAmount);
    const historical = rows.filter((r) => r.sale.status === SaleStatus.CANCELLED || r.status === ApplicationStatus.REVIEW_REQUIRED).map(withCurrentAmount);
    return { current, historicalExcluded: historical };
  }
  async summary(from: string, to: string) { const [sales, procedures, expenses, percentages] = await Promise.all([this.sales(from, to), this.procedures(from, to), this.expenses(from, to), this.percentages(from, to)]); const activeSales = sales.filter((sale) => sale.status === SaleStatus.CONFIRMED); const cancelledSales = sales.filter((sale) => sale.status === SaleStatus.CANCELLED); const saleValueCop = activeSales.reduce((sum, sale) => sum.plus(sale.motorcyclePriceCop), new Prisma.Decimal(0)); return { period: { from, to }, current: { salesCount: activeSales.length, cancelledSalesExcludedCount: cancelledSales.length, motorcycleContractValueCop: saleValueCop.toFixed(2), procedures, expenses, percentages }, historicalCancelledSales: cancelledSales }; }
  async export(type: string, from: string, to: string): Promise<string> { let rows: Record<string, unknown>[]; if (type === 'sales') rows = await this.sales(from, to) as unknown as Record<string, unknown>[]; else if (type === 'procedures') { const report = await this.procedures(from, to); rows = [...report.current.records, ...report.historicalExcluded.records] as unknown as Record<string, unknown>[]; } else if (type === 'expenses') { const report = await this.expenses(from, to); rows = [...report.motorcycle.current.records, ...report.motorcycle.historicalExcluded.records, ...report.general.current.records, ...report.general.historicalExcluded.records] as unknown as Record<string, unknown>[]; } else if (type === 'percentages') { const report = await this.percentages(from, to); rows = [...report.current, ...report.historicalExcluded] as unknown as Record<string, unknown>[]; } else throw new BadRequestException('Tipo CSV inválido. Usa sales, procedures, expenses o percentages.'); if (!rows.length) return 'status\n'; const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]; return [columns.join(','), ...rows.map((row) => columns.map((key) => this.csvCell(row[key])).join(','))].join('\r\n'); }
  private csvCell(value: unknown): string {
    const isDecimal = value instanceof Prisma.Decimal;
    const isNumeric = isDecimal || typeof value === 'number' || typeof value === 'bigint';
    let text: string;
    if (value instanceof Date) text = value.toISOString();
    else if (value === null || value === undefined) text = '';
    else if (value instanceof Prisma.Decimal) text = value.toFixed();
    else if (typeof value === 'object') text = JSON.stringify(value) ?? '';
    else text = String(value);

    const isNumericText = typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value);
    if (!isNumeric && !isNumericText && /^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
}
