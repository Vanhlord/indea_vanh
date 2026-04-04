import path from 'path';
import Database from 'better-sqlite3';

const dbPath = path.join(process.cwd(), 'data.db');
console.log('CWD:', process.cwd());
console.log('dbPath:', dbPath);

try {
    const db = new Database(dbPath);
    const tableInfo = db.prepare('PRAGMA table_info(forum_comments)').all();
    console.log('Columns:', tableInfo.map(c => c.name).join(', '));
} catch (e) {
    console.error(e);
} finally {
    process.exit(0);
}
