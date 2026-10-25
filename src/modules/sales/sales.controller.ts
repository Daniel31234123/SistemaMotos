import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CancelSaleDto } from './dto/cancel-sale.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ReturnMotorcycleDto } from './dto/return-motorcycle.dto';
import { SalesService } from './sales.service';
@ApiTags('sales') @Controller()
export class SalesController {
  constructor(private readonly sales: SalesService) {}
  @Post('sales') create(@Body() dto: CreateSaleDto) { return this.sales.createDraft(dto); }
  @Get('sales') list(@Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.sales.list(status, from, to); }
  @Get('sales/:id') get(@Param('id') id: string) { return this.sales.get(id); }
  @Post('sales/:id/confirm') confirm(@Param('id') id: string) { return this.sales.confirm(id); }
  @Post('sales/:id/cancel') cancel(@Param('id') id: string, @Body() dto: CancelSaleDto) { return this.sales.cancel(id, dto.reason); }
  @Post('motorcycles/:id/return-available') returnAvailable(@Param('id') id: string, @Body() dto: ReturnMotorcycleDto) { return this.sales.returnAvailable(id, dto.reason); }
}
