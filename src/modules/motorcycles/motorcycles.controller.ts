import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AvailableDto } from './dto/available.dto';
import { CreateMotorcycleDto } from './dto/create-motorcycle.dto';
import { UpdateMotorcycleDto } from './dto/update-motorcycle.dto';
import { MotorcyclesService } from './motorcycles.service';
@ApiTags('motorcycles') @Controller('motorcycles')
export class MotorcyclesController {
  constructor(private readonly motorcycles: MotorcyclesService) {}
  @Post() create(@Body() dto: CreateMotorcycleDto) { return this.motorcycles.create(dto); }
  @Get() list(@Query('brandId') brandId?: string, @Query('status') status?: string) { return this.motorcycles.list(brandId, status); }
  @Get(':id') get(@Param('id') id: string) { return this.motorcycles.get(id); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateMotorcycleDto) { return this.motorcycles.update(id, dto); }
  @Post(':id/availability') availability(@Param('id') id: string, @Body() dto: AvailableDto) { return this.motorcycles.markAvailable(id, dto.readyToOffer); }
  @Get(':id/history') history(@Param('id') id: string) { return this.motorcycles.history(id); }
}
