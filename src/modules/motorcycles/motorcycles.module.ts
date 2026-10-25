import { Module } from '@nestjs/common';
import { MotorcyclesController } from './motorcycles.controller';
import { MotorcyclesService } from './motorcycles.service';
@Module({ controllers: [MotorcyclesController], providers: [MotorcyclesService], exports: [MotorcyclesService] })
export class MotorcyclesModule {}
