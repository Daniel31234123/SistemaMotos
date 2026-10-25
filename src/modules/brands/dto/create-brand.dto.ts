import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
export class CreateBrandDto {
  @ApiProperty({ example: 'Bajaj' }) @IsString() @Length(1, 80) name!: string;
}
