import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportsService } from './reports.service';
@ApiTags('reports') @Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}
  @Get('summary') summary(@Query('from') from: string, @Query('to') to: string) { return this.service.summary(from, to); }
  @Get('sales') sales(@Query('from') from: string, @Query('to') to: string) { return this.service.sales(from, to); }
  @Get('procedures') procedures(@Query('from') from: string, @Query('to') to: string) { return this.service.procedures(from, to); }
  @Get('expenses') expenses(@Query('from') from: string, @Query('to') to: string) { return this.service.expenses(from, to); }
  @Get('percentage-applications') percentages(@Query('from') from: string, @Query('to') to: string) { return this.service.percentages(from, to); }
  @Get('export.csv') async csv(@Query('type') type: string, @Query('from') from: string, @Query('to') to: string, @Res() res: Response) {
    const data = await this.service.export(type, from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`);
    return res.send(`\uFEFF${data}`);
  }
}
