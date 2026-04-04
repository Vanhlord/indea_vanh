import { migrateData } from './database.js';

console.log('Starting data migration from JSON to SQLite...');
migrateData();
console.log('Migration completed.');
