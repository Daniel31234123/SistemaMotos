import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { PrismaModule } from './database/prisma.module';
import { HealthController } from './health.controller';
import { BrandsModule } from './modules/brands/brands.module';
import { CustomersModule } from './modules/customers/customers.module';
import { MotorcyclesModule } from './modules/motorcycles/motorcycles.module';
import { SalesModule } from './modules/sales/sales.module';
import { ProceduresModule } from './modules/procedures/procedures.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { PercentagesModule } from './modules/percentages/percentages.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: Joi.object({ NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'), PORT: Joi.number().port().default(3000), HOST: Joi.string().default('127.0.0.1'), DATABASE_URL: Joi.string().uri({ scheme: ['postgresql'] }).required(), CORS_ORIGINS: Joi.string().allow('').default(''), LOG_LEVEL: Joi.string().default('info') }) }),
    PrismaModule, BrandsModule, MotorcyclesModule, CustomersModule, SalesModule, ProceduresModule, ExpensesModule, PercentagesModule, ReportsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
