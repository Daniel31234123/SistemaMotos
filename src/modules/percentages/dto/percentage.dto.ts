import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
export class CreateRuleDto { @ApiProperty() @IsUUID() brandId!: string; @ApiProperty({ example: '4.0000', maximum: 100 }) @Matches(/^(100(?:\.0{1,4})?|[1-9]?\d(?:\.\d{1,4})?)$/) ratePercent!: string; @ApiProperty() @IsDateString() effectiveFrom!: string; @ApiProperty({ description: 'Confirma que la regla comercial fue aprobada antes de configurarla.' }) @IsBoolean() approvedBusinessRule!: boolean; }
export class CloseRuleDto { @ApiProperty() @IsDateString() effectiveTo!: string; }
export class ApplyPercentageDto { @ApiProperty() @IsUUID() ruleId!: string; @ApiProperty({ description: 'Confirmación explícita después de revisar la regla y su vigencia.' }) @IsBoolean() confirmed!: boolean; @ApiProperty() @IsString() @Length(3, 500) reason!: string; }
export class AdjustPercentageDto { @ApiProperty() @IsString() @Length(3, 500) reason!: string; @ApiProperty({ example: '1000.00', description: 'Ajuste manual firmado: positivo o negativo.' }) @Matches(/^-?\d{1,12}(\.\d{1,2})?$/) amountDeltaCop!: string; }
