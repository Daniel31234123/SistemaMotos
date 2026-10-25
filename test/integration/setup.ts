import { afterAll, beforeAll } from '@jest/globals';
import {
  connectIntegrationDatabase,
  disconnectIntegrationDatabase,
} from './database';

beforeAll(async () => {
  await connectIntegrationDatabase();
  // AppModule also validates DATABASE_URL; bind it to the already-verified test URL.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

afterAll(async () => {
  await disconnectIntegrationDatabase();
});
