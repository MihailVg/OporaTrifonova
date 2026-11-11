import { closeDb, initDb } from './db.js';
import { seedDemoPatient } from './repo.js';

await initDb();
const result = await seedDemoPatient();
console.log('');
console.log('  Демо-данные готовы.');
console.log(`  Код пациентки: ${result.code}`);
console.log(`  Записей дневника: ${result.surveys}`);
console.log('  Войдите с этим кодом на /login или откройте /doctor.');
console.log('');
await closeDb();
