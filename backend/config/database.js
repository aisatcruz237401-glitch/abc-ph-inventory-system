const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const useSupabase = process.env.USE_SUPABASE === 'true' || process.env.USE_SUPABASE === '1';

const pool = useSupabase
  ? null
  : mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'inventory',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

module.exports = pool;
