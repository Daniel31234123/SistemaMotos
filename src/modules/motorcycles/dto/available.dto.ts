import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
export class AvailableDto { @ApiProperty({ example: true }) @IsBoolean() readyToOffer!: boolean; }
