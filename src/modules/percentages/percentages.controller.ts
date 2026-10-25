import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdjustPercentageDto, ApplyPercentageDto, CloseRuleDto, CreateRuleDto } from './dto/percentage.dto';
import { PercentagesService } from './percentages.service';
@ApiTags('percentage-rules') @Controller()
export class PercentagesController {
  constructor(private readonly service: PercentagesService) {}
  @Post('percentage-rules') createRule(@Body() dto: CreateRuleDto) { return this.service.createRule(dto); }
  @Get('percentage-rules') rules() { return this.service.listRules(); }
  @Post('percentage-rules/:id/close') closeRule(@Param('id') id: string, @Body() dto: CloseRuleDto) { return this.service.closeRule(id, dto.effectiveTo); }
  @Get('sales/:saleId/percentage-rules') suggestions(@Param('saleId') saleId: string) { return this.service.candidates(saleId); }
  @Post('sales/:saleId/percentage-applications') apply(@Param('saleId') saleId: string, @Body() dto: ApplyPercentageDto) { return this.service.apply(saleId, dto); }
  @Get('sales/:saleId/percentage-applications') applications(@Param('saleId') saleId: string) { return this.service.listApplications(saleId); }
  @Post('percentage-applications/:id/adjustments') adjust(@Param('id') id: string, @Body() dto: AdjustPercentageDto) { return this.service.adjust(id, dto); }
}
