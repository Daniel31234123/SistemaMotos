import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateCategoryDto, CreateExpenseDto, UpdateExpenseDto, VoidExpenseDto } from './dto/expense.dto';
import { ExpensesService } from './expenses.service';
@ApiTags('expenses') @Controller()
export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}
  @Post('expense-categories') category(@Body() dto: CreateCategoryDto) { return this.service.createCategory(dto); }
  @Get('expense-categories') categories() { return this.service.categories(); }
  @Patch('expense-categories/:id') updateCategory(@Param('id') id: string, @Body() dto: CreateCategoryDto) { return this.service.updateCategory(id, dto); }
  @Post('expense-categories/:id/deactivate') deactivateCategory(@Param('id') id: string) { return this.service.deactivateCategory(id); }
  @Post('motorcycles/:id/expenses') motorcycle(@Param('id') id: string, @Body() dto: CreateExpenseDto) { return this.service.createMotorcycle(id, dto); }
  @Get('motorcycles/:id/expenses') motorcycleList(@Param('id') id: string) { return this.service.listMotorcycle(id); }
  @Post('general-expenses') general(@Body() dto: CreateExpenseDto) { return this.service.createGeneral(dto); }
  @Get('general-expenses') generalList() { return this.service.listGeneral(); }
  @Patch('expenses/motorcycle/:id') updateMotorcycle(@Param('id') id: string, @Body() dto: UpdateExpenseDto) { return this.service.updateMotorcycle(id, dto); }
  @Patch('expenses/general/:id') updateGeneral(@Param('id') id: string, @Body() dto: UpdateExpenseDto) { return this.service.updateGeneral(id, dto); }
  @Post('expenses/motorcycle/:id/confirm') confirmMotorcycle(@Param('id') id: string) { return this.service.confirmMotorcycle(id); }
  @Post('expenses/general/:id/confirm') confirmGeneral(@Param('id') id: string) { return this.service.confirmGeneral(id); }
  @Post('expenses/motorcycle/:id/void') voidMotorcycle(@Param('id') id: string, @Body() dto: VoidExpenseDto) { return this.service.voidMotorcycle(id, dto.reason); }
  @Post('expenses/general/:id/void') voidGeneral(@Param('id') id: string, @Body() dto: VoidExpenseDto) { return this.service.voidGeneral(id, dto.reason); }
}
