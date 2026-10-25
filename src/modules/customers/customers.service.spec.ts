import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomersService } from './customers.service';

describe('CustomersService document integrity', () => {
  const makeService = () => {
    const prisma = {
      customer: {
        create: jest.fn().mockResolvedValue({ id: 'customer-1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'customer-1' }),
        update: jest.fn().mockResolvedValue({ id: 'customer-1' }),
      },
    };
    return { service: new CustomersService(prisma as unknown as PrismaService), prisma };
  };

  const duplicateDocumentError = () => new Prisma.PrismaClientKnownRequestError('unique constraint', {
    code: 'P2002', clientVersion: '6.19.3',
  });

  it('creates a customer with trimmed display documents and normalized unique-key values', async () => {
    const { service, prisma } = makeService();
    const dto: CreateCustomerDto = {
      fullName: 'Ana Pérez', documentType: ' CC ', documentNumber: ' 1.234-567 ', phone: '3001234567',
    };

    await service.create(dto);

    expect(prisma.customer.create).toHaveBeenCalledWith({ data: {
      ...dto, documentType: 'CC', documentNumber: '1.234-567',
      normalizedDocType: 'CC', normalizedDocNumber: '1234567',
    } });
  });

  it('maps a duplicate normalized document on create to a conflict', async () => {
    const { service, prisma } = makeService();
    prisma.customer.create.mockRejectedValue(duplicateDocumentError());

    await expect(service.create({
      fullName: 'Ana Pérez', documentType: 'CC', documentNumber: '1.234-567',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates the normalized key when the document changes', async () => {
    const { service, prisma } = makeService();

    await service.update('customer-1', { documentType: 'CE', documentNumber: ' 98.765-432 ' });

    expect(prisma.customer.findUnique).toHaveBeenCalledWith({ where: { id: 'customer-1' } });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { documentType: 'CE', documentNumber: ' 98.765-432 ', normalizedDocType: 'CE', normalizedDocNumber: '98765432' },
    });
  });

  it('maps a duplicate normalized document on update to a conflict', async () => {
    const { service, prisma } = makeService();
    prisma.customer.update.mockRejectedValue(duplicateDocumentError());

    await expect(service.update('customer-1', { documentNumber: '1234567' }))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
