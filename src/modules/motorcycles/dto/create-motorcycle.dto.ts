import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
export class CreateMotorcycleDto {
  @ApiProperty() @IsUUID() brandId!: string;
  @ApiProperty() @IsString() @Length(1, 100) line!: string;
  @ApiProperty({ minimum: 1950, maximum: 2100 }) @IsInt() @Min(1950) @Max(2100) modelYear!: number;
  @ApiProperty() @IsString() @Length(1, 60) color!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(10000) displacementCc!: number;
  @ApiProperty({ example: '9000000.00' }) @Matches(/^\d{1,12}(\.\d{1,2})?$/) salePriceCop!: string;
  @ApiProperty({ example: '7000000.00' }) @Matches(/^\d{1,12}(\.\d{1,2})?$/) acquisitionCostCop!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) engineNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) chassisNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 20) plate?: string;
}
