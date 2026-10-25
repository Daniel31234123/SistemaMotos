import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateProcedureDto, CreateProcedureTypeDto, UpdateProcedureDto, VoidRecordDto } from './dto/procedure.dto';
import { ProceduresService } from './procedures.service';
@ApiTags('procedures') @Controller()
export class ProceduresController {
  constructor(private readonly service: ProceduresService) {}
  @Post('procedure-types') createType(@Body() dto: CreateProcedureTypeDto) { return this.service.createType(dto.name); }
  @Get('procedure-types') types() { return this.service.listTypes(); }
  @Patch('procedure-types/:id') updateType(@Param('id') id: string, @Body() dto: CreateProcedureTypeDto) { return this.service.updateType(id, dto.name); }
  @Post('procedure-types/:id/deactivate') deactivateType(@Param('id') id: string) { return this.service.deactivateType(id); }
  @Post('sales/:saleId/procedures') create(@Param('saleId') saleId: string, @Body() dto: CreateProcedureDto) { return this.service.create(saleId, dto); }
  @Get('sales/:saleId/procedures') list(@Param('saleId') saleId: string) { return this.service.list(saleId); }
  @Patch('procedures/:id') update(@Param('id') id: string, @Body() dto: UpdateProcedureDto) { return this.service.updateDraft(id, dto); }
  @Post('procedures/:id/confirm') confirm(@Param('id') id: string) { return this.service.confirm(id); }
  @Post('procedures/:id/void') void(@Param('id') id: string, @Body() dto: VoidRecordDto) { return this.service.void(id, dto.reason); }
}
