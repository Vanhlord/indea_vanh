import db from './src/modules/database.js';

try {
    const tableInfo = db.prepare('PRAGMA table_info(forum_comments)').all();
    const columns = tableInfo.map(c => c.name);
    console.log('Columns in forum_comments:', columns.join(', '));
    
    if (!columns.includes('parent_id')) {
        console.log('parent_id not found. Attempting ALTER TABLE...');
        db.prepare('ALTER TABLE forum_comments ADD COLUMN parent_id INTEGER DEFAULT NULL').run();
        console.log('✅ Column added successfully.');
    } else {
        console.log('Column parent_id already exists.');
    }
} catch (e) {
    console.error('❌ Error during schema fix:', e);
} finally {
    process.exit(0);
}
