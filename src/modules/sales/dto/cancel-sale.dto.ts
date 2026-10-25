import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
export class CancelSaleDto { @ApiProperty() @IsString() @Length(3, 500) @Matches(/\S/, { message: 'El motivo de cancelación no puede estar vacío.' }) reason!: string; }
