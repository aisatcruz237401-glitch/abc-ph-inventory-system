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
    multipleStatements: true,
  });

  console.log('Running database setup...');
  await connection.query(fs.readFileSync(path.join(__dirname, 'database', 'inventory.sql'), 'utf8'));
  console.log('Schema created.');
  await connection.query(fs.readFileSync(path.join(__dirname, 'database', 'seed.sql'), 'utf8'));
  console.log('Seed data inserted.');
  await connection.query(fs.readFileSync(path.join(__dirname, 'database', 'branchSeed.sql'), 'utf8'));
  console.log('Branch data seeded.');

  await connection.end();
  console.log('Setup complete.');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
