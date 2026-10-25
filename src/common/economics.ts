import { Prisma } from '@prisma/client';

export function procedureMargin(income: Prisma.Decimal, costs: Prisma.Decimal): Prisma.Decimal {
  return income.minus(costs);
}

export function calculatePercentage(base: Prisma.Decimal, ratePercent: Prisma.Decimal): Prisma.Decimal | null {
  if (base.lessThanOrEqualTo(0)) return null;
  return base.mul(ratePercent).div(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
}

export function currentPercentageAmount(
  originalAmount: Prisma.Decimal,
  adjustments: readonly { amountDeltaCop: Prisma.Decimal }[],
): Prisma.Decimal {
  return adjustments.reduce(
    (current, adjustment) => current.plus(adjustment.amountDeltaCop),
    originalAmount,
  );
}
