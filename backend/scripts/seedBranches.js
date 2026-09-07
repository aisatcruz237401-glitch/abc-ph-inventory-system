const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'inventory',
    multipleStatements: true,
  });

  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'branchSeed.sql'), 'utf8');
    await connection.query(sql);

    const [branches] = await connection.query('SELECT COUNT(*) AS total FROM branches');
    console.log(`Branches seeded. Total branches: ${branches[0].total}`);
    const [rows] = await connection.query('SELECT name FROM branches ORDER BY id');
    rows.forEach((row) => console.log(`- ${row.name}`));
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('Branch seed failed:', err.message);
  process.exit(1);
});
