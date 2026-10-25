import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';
export class CreateCustomerDto {
  @ApiProperty() @IsString() @Length(1, 160) fullName!: string;
  @ApiProperty() @IsString() @Length(1, 40) documentType!: string;
  @ApiProperty() @IsString() @Length(1, 80) documentNumber!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @Length(1, 254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 250) address?: string;
}
