import { closeDb, getDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { bootstrap } from '../services/bootstrap.js';
import { env } from '../env.js';

const db = await getDb();
await runMigrations(db);
await bootstrap();
console.log('[seed] done');
console.log(`[seed] admin login: ${env.adminEmail}`);
console.log(`[seed] device token: ${env.deviceToken.slice(0, 4)}… (from DEVICE_TOKEN)`);
await closeDb();
