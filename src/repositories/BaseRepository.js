/**
 * Base Repository Pattern
 * Provides common database operations for all entities
 */

import { DatabaseError, NotFoundError } from '../utils/errors.js';

export class BaseRepository {
    constructor(db, tableName) {
        this.db = db;
        this.tableName = tableName;
    }

    /**
     * Find all records with optional filtering
     */
    async findAll(options = {}) {
        try {
            const { where = {}, orderBy = 'id', limit = null, offset = null } = options;
            
            let query = `SELECT * FROM ${this.tableName}`;
            const params = [];
            
            // Build WHERE clause
            const whereKeys = Object.keys(where);
            if (whereKeys.length > 0) {
                const conditions = whereKeys.map((key, _index) => {
                    params.push(where[key]);
                    return `${key} = ?`;
                });
                query += ` WHERE ${conditions.join(' AND ')}`;
            }
            
            // Add ORDER BY
            query += ` ORDER BY ${orderBy}`;
            
            // Add LIMIT and OFFSET
            if (limit) {
                query += ' LIMIT ?';
                params.push(limit);
            }
            if (offset) {
                query += ' OFFSET ?';
                params.push(offset);
            }
            
            return this.db.prepare(query).all(...params);
        } catch (error) {
            throw new DatabaseError(`Failed to fetch from ${this.tableName}: ${error.message}`);
        }
    }

    /**
     * Find single record by ID
     */
    async findById(id) {
        try {
            const result = this.db.prepare(
                `SELECT * FROM ${this.tableName} WHERE id = ?`
            ).get(id);
            
            if (!result) {
                throw new NotFoundError(this.tableName);
            }
            
            return result;
        } catch (error) {
            if (error instanceof NotFoundError) throw error;
            throw new DatabaseError(`Failed to find ${this.tableName} by id: ${error.message}`);
        }
    }

    /**
     * Find single record by field
     */
    async findOne(field, value) {
        try {
            return this.db.prepare(
                `SELECT * FROM ${this.tableName} WHERE ${field} = ?`
            ).get(value);
        } catch (error) {
            throw new DatabaseError(`Failed to find ${this.tableName}: ${error.message}`);
        }
    }

    /**
     * Create new record
     */
    async create(data) {
        try {
            const keys = Object.keys(data);
            const values = Object.values(data);
            const placeholders = keys.map(() => '?').join(', ');
            
            const result = this.db.prepare(
                `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders})`
            ).run(...values);
            
            return {
                id: result.lastInsertRowid,
                ...data
            };
        } catch (error) {
            throw new DatabaseError(`Failed to create ${this.tableName}: ${error.message}`);
        }
    }

    /**
     * Update record by ID
     */
    async update(id, data) {
        try {
            const keys = Object.keys(data);
            const values = Object.values(data);
            
            if (keys.length === 0) {
                throw new DatabaseError('No data provided for update');
            }
            
            const setClause = keys.map(key => `${key} = ?`).join(', ');
            
            const result = this.db.prepare(
                `UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`
            ).run(...values, id);
            
            if (result.changes === 0) {
                throw new NotFoundError(this.tableName);
            }
            
            return { id, ...data };
        } catch (error) {
            if (error instanceof NotFoundError) throw error;
            throw new DatabaseError(`Failed to update ${this.tableName}: ${error.message}`);
        }
    }

    /**
     * Delete record by ID
     */
    async delete(id) {
        try {
            const result = this.db.prepare(
                `DELETE FROM ${this.tableName} WHERE id = ?`
            ).run(id);
            
            if (result.changes === 0) {
                throw new NotFoundError(this.tableName);
            }
            
            return { deleted: true, id };
        } catch (error) {
            if (error instanceof NotFoundError) throw error;
            throw new DatabaseError(`Failed to delete ${this.tableName}: ${error.message}`);
        }
    }

    /**
     * Count records with optional filtering
     */
    async count(where = {}) {
        try {
            let query = `SELECT COUNT(*) as count FROM ${this.tableName}`;
            const params = [];
            
            const whereKeys = Object.keys(where);
            if (whereKeys.length > 0) {
                const conditions = whereKeys.map((key, _index) => {
                    params.push(where[key]);
                    return `${key} = ?`;
                });
                query += ` WHERE ${conditions.join(' AND ')}`;
            }
            
            const result = this.db.prepare(query).get(...params);
            return result.count;
        } catch (error) {
            throw new DatabaseError(`Failed to count ${this.tableName}: ${error.message}`);
        }
    }

    /**
     * Check if record exists
     */
    async exists(id) {
        try {
            const result = this.db.prepare(
                `SELECT 1 as exists FROM ${this.tableName} WHERE id = ?`
            ).get(id);
            
            return !!result;
        } catch (error) {
            throw new DatabaseError(`Failed to check existence: ${error.message}`);
        }
    }
}
