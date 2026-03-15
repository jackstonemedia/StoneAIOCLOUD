import { initDb, getDb } from './server/db/index.js';
initDb();
const db = getDb();
db.exec('DROP TABLE IF EXISTS sites;');
initDb();
console.log('Done');
