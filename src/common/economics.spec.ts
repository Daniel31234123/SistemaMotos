import { Prisma } from '@prisma/client';
import { calculatePercentage, currentPercentageAmount, procedureMargin } from './economics';

describe('cálculos comerciales de trámites', () => {
  it('resta costos al importe registrado y redondea al peso más cercano', () => {
    const margin = procedureMargin(new Prisma.Decimal('900000'), new Prisma.Decimal('400000'));
    expect(margin.toFixed(2)).toBe('500000.00');
    expect(calculatePercentage(margin, new Prisma.Decimal('4'))?.toFixed(0)).toBe('20000');
    expect(calculatePercentage(margin, new Prisma.Decimal('11'))?.toFixed(0)).toBe('55000');
  });
  it('no calcula para una base nula o negativa', () => {
    expect(calculatePercentage(new Prisma.Decimal(0), new Prisma.Decimal(4))).toBeNull();
    expect(calculatePercentage(new Prisma.Decimal(-1), new Prisma.Decimal(11))).toBeNull();
  });

  it.each([
    { original: '125.50', deltas: [], expected: '125.50' },
    { original: '125.50', deltas: ['10.25'], expected: '135.75' },
    { original: '125.50', deltas: ['-10.25'], expected: '115.25' },
    { original: '0.10', deltas: ['0.20', '-0.05', '0.01'], expected: '0.26' },
  ])('calcula el importe vigente sumando el original y los ajustes firmados', ({ original, deltas, expected }) => {
    const current = currentPercentageAmount(
      new Prisma.Decimal(original),
      deltas.map((amountDeltaCop) => ({ amountDeltaCop: new Prisma.Decimal(amountDeltaCop) })),
    );
    expect(current.toFixed(2)).toBe(expected);
  });
});
