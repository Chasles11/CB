// migrate.js - Run this once to add the name column
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('Adding name column to users table...');
    
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255);
    `);
    
    console.log('✅ Migration successful! Name column added.');
    
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
