import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
@ApiTags('customers') @Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}
  @Post() create(@Body() dto: CreateCustomerDto) { return this.customers.create(dto); }
  @Get() list() { return this.customers.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.customers.get(id); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) { return this.customers.update(id, dto); }
  @Get(':id/sales') sales(@Param('id') id: string) { return this.customers.sales(id); }
}
