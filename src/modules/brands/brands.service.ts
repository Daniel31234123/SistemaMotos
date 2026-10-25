import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { normalizeLabel } from '../../common/normalize';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}
  async create(name: string) {
    const normalized = normalizeLabel(name);
    try { return await this.prisma.brand.create({ data: { name: name.trim(), normalized } }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Ya existe una marca con ese nombre normalizado.'); throw error; }
  }
  list() { return this.prisma.brand.findMany({ orderBy: { name: 'asc' } }); }
  async update(id: string, name?: string) {
    if (!name) return this.get(id);
    try { return await this.prisma.brand.update({ where: { id }, data: { name: name.trim(), normalized: normalizeLabel(name) } }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Ya existe una marca con ese nombre normalizado.'); if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new NotFoundException('Marca no encontrada.'); throw error; }
  }
  async deactivate(id: string) { await this.get(id); return this.prisma.brand.update({ where: { id }, data: { active: false } }); }
  private async get(id: string) { const brand = await this.prisma.brand.findUnique({ where: { id } }); if (!brand) throw new NotFoundException('Marca no encontrada.'); return brand; }
}
