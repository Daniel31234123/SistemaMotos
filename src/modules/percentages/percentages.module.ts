import { Module } from '@nestjs/common';
import { PercentagesController } from './percentages.controller';
import { PercentagesService } from './percentages.service';
@Module({ controllers: [PercentagesController], providers: [PercentagesService] }) export class PercentagesModule {}
