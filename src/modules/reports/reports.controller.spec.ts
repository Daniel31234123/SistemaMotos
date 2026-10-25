import { Test } from '@nestjs/testing';
import request = require('supertest');
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

describe('ReportsController CSV response', () => {
  it('returns the exported CSV with a UTF-8 BOM and download headers over HTTP', async () => {
    const reports = { export: jest.fn().mockResolvedValue('id,value\r\n"1","á"') };
    const moduleRef = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: reports }],
    }).compile();
    const app = moduleRef.createNestApplication();

    try {
      await app.init();
      const response = await request(app.getHttpServer())
        .get('/reports/export.csv')
        .query({ type: 'sales', from: '2026-05-01', to: '2026-05-31' })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toBe('attachment; filename="sales-report.csv"');
      expect(response.text?.charCodeAt(0)).toBe(0xfeff);
      expect(response.text).toBe('\ufeffid,value\r\n"1","á"');
      expect(reports.export).toHaveBeenCalledWith('sales', '2026-05-01', '2026-05-31');
    } finally {
      await app.close();
    }
  });
});
