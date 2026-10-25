import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { normalizeDocument } from '../../common/normalize';
import { CreateCustomerDto } from './dto/create-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}
  async create(dto: CreateCustomerDto) {
    try { return await this.prisma.customer.create({ data: { ...dto, documentType: dto.documentType.trim(), documentNumber: dto.documentNumber.trim(), normalizedDocType: normalizeDocument(dto.documentType), normalizedDocNumber: normalizeDocument(dto.documentNumber) } }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Ya existe un cliente con ese tipo y número de documento normalizados.'); throw error; }
  }
  list() { return this.prisma.customer.findMany({ orderBy: { fullName: 'asc' }, take: 100 }); }
  async get(id: string) { const row = await this.prisma.customer.findUnique({ where: { id } }); if (!row) throw new NotFoundException('Cliente no encontrado.'); return row; }
  async update(id: string, dto: Partial<CreateCustomerDto>) {
    const data: Prisma.CustomerUpdateInput = { ...dto };
    if (dto.documentType) data.normalizedDocType = normalizeDocument(dto.documentType);
    if (dto.documentNumber) data.normalizedDocNumber = normalizeDocument(dto.documentNumber);
    try { await this.get(id); return await this.prisma.customer.update({ where: { id }, data }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Ya existe un cliente con ese tipo y número de documento normalizados.'); throw error; }
  }
  async sales(id: string) { await this.get(id); return this.prisma.sale.findMany({ where: { customerId: id }, include: { motorcycle: { include: { brand: true } }, procedures: true }, orderBy: { createdAt: 'desc' } }); }
}
