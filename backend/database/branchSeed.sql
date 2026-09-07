USE inventory;

CREATE TABLE IF NOT EXISTS branches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO branches (branch_code, name, status)
VALUES
  ('SAN-AG2', 'San Agustin 2', 'active'),
  ('GEN-TRI', 'General Trias', 'active'),
  ('FATIMA', 'Fatima', 'active'),
  ('SALAWAG', 'Salawag', 'active'),
  ('MALIGAYA', 'Maligaya', 'active'),
  ('SAN-PED', 'San Pedro', 'active'),
  ('BAC-MOL', 'Bacoor Molino', 'active'),
  ('PARA', 'Paranaque', 'active'),
  ('SUSANO', 'Susano', 'active'),
  ('BAGUMB', 'Bagumbong', 'active'),
  ('PAS-BUA', 'Pasong Buaya', 'active'),
  ('LAS-PIN', 'Las Pinas', 'active'),
  ('MAG-BAC', 'Magdiwang Bacoor', 'active'),
  ('CEN-SAN', 'Centro San Pedro', 'active'),
  ('BUH-TUB', 'Buhay Na Tubig', 'active'),
  ('TANZA', 'Tanza', 'active'),
  ('PRI-GEN', 'Prinza Gentri', 'active'),
  ('SABANG', 'Sabang', 'active'),
  ('PLAT-BAC', 'Platinumville Bacoor', 'active'),
  ('TAGUIG', 'Taguig', 'active'),
  ('CAA-LAS', 'CAA- Las Pinas', 'active'),
  ('ANN-LAS', 'Annex- Las Pinas', 'active'),
  ('ANG-RIZ', 'Angono Rizal', 'active'),
  ('ROD-RIZ', 'Rodriguez Rizal', 'active'),
  ('SJD-MUL', 'SJDM Bulacan', 'active'),
  ('NORZAG', 'Norzagaray', 'active'),
  ('BAT-CIT', 'Batangas City', 'active'),
  ('CAM-CAL', 'Camarin Almar Caloocan', 'active'),
  ('PIT-CEB', 'Pitogo Cebu', 'active'),
  ('LAP-CEB', 'Lapu-Lapu Cebu', 'active'),
  ('PUR-PAL', 'Puerto Princesa Palawan', 'active'),
  ('MAL-PAN', 'Malasiqui Pangasinan', 'active'),
  ('SAN-MIG', 'San Miguel 2', 'active'),
  ('PALMERA', 'Palmera', 'active'),
  ('STA-CRU', 'Sta. Cruz', 'active'),
  ('PALIP', 'Paliparan', 'active'),
  ('STA-ROS', 'Sta. Rosa Laguna', 'active'),
  ('CALOOC', 'Caloocan', 'active')
ON DUPLICATE KEY UPDATE 
  branch_code = VALUES(branch_code),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP;
