import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
export class CreateProcedureDto {
  @ApiProperty() @IsUUID() procedureTypeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) description?: string;
  @ApiProperty({ example: '900000.00' }) @Matches(/^\d{1,12}(\.\d{1,2})?$/) customerAmountCop!: string;
  @ApiProperty({ example: '400000.00' }) @Matches(/^\d{1,12}(\.\d{1,2})?$/) businessCostCop!: string;
  @ApiProperty() @IsDateString() procedureDate!: string;
  @ApiPropertyOptional({ description: 'Trámite confirmado que este registro corrige.' }) @IsOptional() @IsUUID() replacesId?: string;
}
export class VoidRecordDto { @ApiProperty() @IsString() @Length(3, 500) @Matches(/\S/, { message: 'El motivo de anulación del trámite no puede estar vacío.' }) reason!: string; }
export class CreateProcedureTypeDto { @ApiProperty() @IsString() @Length(1, 100) name!: string; }
export class UpdateProcedureDto extends PartialType(CreateProcedureDto) {}
