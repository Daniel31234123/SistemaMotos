export const normalizeLabel = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-CO');
export const normalizeDocument = (value: string): string => value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normalizeIdentifier = (value: string): string => value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
