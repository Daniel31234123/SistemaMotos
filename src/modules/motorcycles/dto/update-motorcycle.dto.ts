import { CreateMotorcycleDto } from './create-motorcycle.dto';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
export class UpdateMotorcycleDto extends PartialType(CreateMotorcycleDto) {
  @ApiPropertyOptional({ description: 'Obligatorio al sustituir un identificador ya asignado.' })
  @IsOptional() @IsString() @Length(3, 500) identifierChangeReason?: string;
}
