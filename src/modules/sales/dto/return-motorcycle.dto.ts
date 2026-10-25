import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
export class ReturnMotorcycleDto { @ApiProperty({ description: 'Motivo de la revisión explícita para devolver la moto a disponibilidad.' }) @IsString() @Length(3, 500) reason!: string; }
