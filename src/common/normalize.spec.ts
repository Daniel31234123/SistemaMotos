import { normalizeDocument, normalizeIdentifier, normalizeLabel } from './normalize';

describe('normalización', () => {
  it('iguala marcas por mayúsculas y espacios', () => {
    expect(normalizeLabel('  BAJAJ  ')).toBe(normalizeLabel('Bajaj'));
  });
  it('mantiene valores visibles fuera de la normalización del documento', () => {
    expect(normalizeDocument('CC 1.234-567')).toBe('CC1234567');
  });
  it('normaliza identificadores sin alterar el valor original almacenado', () => {
    expect(normalizeIdentifier(' ab- 123 ')).toBe('AB123');
  });
});
