import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
export class CreateSaleDto {
  @ApiProperty() @IsUUID() motorcycleId!: string;
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiProperty({ enum: ['CASH', 'CREDIT'] }) @IsIn(['CASH', 'CREDIT']) type!: 'CASH' | 'CREDIT';
}
