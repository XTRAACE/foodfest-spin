import { closeDb, getDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';

const db = await getDb();
const ran = await runMigrations(db);
console.log(ran.length > 0 ? `[db] applied ${ran.length} migration(s)` : '[db] already up to date');
await closeDb();
