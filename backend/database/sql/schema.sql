-- ============================================================
-- Authentication schema for ABC Inventory Management System
-- Run this against your EXISTING database (the one your
-- inventory tables already live in). It only ADDS a users
-- table; it does not touch or drop anything else.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  full_name         VARCHAR(150)  NOT NULL,
  email             VARCHAR(150)  NOT NULL UNIQUE,
  username          VARCHAR(100)  NOT NULL UNIQUE,
  password_hash     VARCHAR(255)  NOT NULL,
  role              ENUM('admin', 'staff', 'branch_user') NOT NULL DEFAULT 'branch_user',

  -- Only relevant when role = 'branch_user'. Free-text so it lines up
  -- with whatever branch naming you already use in your inventory
  -- tables (e.g. "General Trias", "Fatima", "San Pedro"). If you have
  -- a dedicated `branches` table with an id, swap this for a
  -- branch_id INT + FOREIGN KEY instead.
  assigned_branch   VARCHAR(150)  DEFAULT NULL,

  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,

  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at     TIMESTAMP     NULL DEFAULT NULL,

  INDEX idx_users_role (role),
  INDEX idx_users_branch (assigned_branch)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Session store table (used by express-mysql-session so sessions
-- survive server restarts and work across multiple app instances).
-- The session middleware creates/manages this table automatically,
-- but it's included here for visibility / manual setup if needed.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  session_id  VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires     INT(11) UNSIGNED NOT NULL,
  data        MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Do NOT insert a seed admin user with a hardcoded hash here —
-- a hash pasted into a text file is easy to get wrong and easy to
-- leak. Instead, after running this schema, create the first
-- Admin account with:
--
--     node scripts/seed-admin.js
--
-- which hashes a password with bcrypt at runtime and inserts it
-- for you. See the README for details.
-- ------------------------------------------------------------