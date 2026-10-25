import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapping: Record<string, { status: number; message: string }> = {
      P2002: { status: HttpStatus.CONFLICT, message: 'El registro entra en conflicto con una restricción de unicidad.' },
      P2003: { status: HttpStatus.BAD_REQUEST, message: 'La relación indicada no existe o no es válida.' },
      P2025: { status: HttpStatus.NOT_FOUND, message: 'No se encontró el registro solicitado.' },
    };
    const result = mapping[error.code] ?? { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Error de persistencia.' };
    response.status(result.status).json({ statusCode: result.status, message: result.message });
  }
}
