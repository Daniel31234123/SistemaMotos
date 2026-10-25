import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { BrandsService } from './brands.service';
@ApiTags('brands')
@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}
  @Post() @ApiOperation({ summary: 'Crear marca configurable' }) create(@Body() dto: CreateBrandDto) { return this.brands.create(dto.name); }
  @Get() list() { return this.brands.list(); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateBrandDto) { return this.brands.update(id, dto.name); }
  @Post(':id/deactivate') deactivate(@Param('id') id: string) { return this.brands.deactivate(id); }
}
