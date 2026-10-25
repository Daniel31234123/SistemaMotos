import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
export class CreateExpenseDto {
  @ApiProperty() @IsUUID() categoryId!: string;
  @ApiProperty() @IsDateString() expenseDate!: string;
  @ApiProperty() @IsString() @Length(1, 500) description!: string;
  @ApiProperty({ example: '250000.00' }) @Matches(/^\d{1,12}(\.\d{1,2})?$/) amountCop!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() replacesId?: string;
}
export class VoidExpenseDto { @ApiProperty() @IsString() @Length(3, 500) @Matches(/\S/, { message: 'El motivo de anulación del gasto no puede estar vacío.' }) reason!: string; }
export class CreateCategoryDto { @ApiProperty() @IsString() @Length(1, 100) name!: string; @ApiProperty({ enum: ['MOTORCYCLE', 'GENERAL', 'BOTH'] }) @IsIn(['MOTORCYCLE', 'GENERAL', 'BOTH']) scope!: 'MOTORCYCLE'|'GENERAL'|'BOTH'; }
export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
