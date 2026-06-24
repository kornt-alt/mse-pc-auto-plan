-- ==============================
-- Chemicals table (MariaDB)
-- ==============================

CREATE TABLE IF NOT EXISTS chemicals (
    chem_id     INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
    chem_code   VARCHAR(50)   NOT NULL UNIQUE COMMENT 'รหัสสารเคมี เช่น CHEM-001',
    chem_name   VARCHAR(255)  NOT NULL COMMENT 'ชื่อสารเคมี',
    unit        VARCHAR(20)   NOT NULL COMMENT 'หน่วย เช่น L, kg, mL',
    stock_qty   DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT 'จำนวนคงคลัง',
    min_qty     DECIMAL(12,3) DEFAULT NULL COMMENT 'จำนวนขั้นต่ำ (แจ้งเตือนเมื่อต่ำกว่านี้)',
    location    VARCHAR(100)  DEFAULT NULL COMMENT 'ที่เก็บ เช่น ชั้น A-1',
    supplier    VARCHAR(255)  DEFAULT NULL COMMENT 'ผู้จำหน่าย',
    created_at  DATETIME      NOT NULL DEFAULT NOW(),
    updated_at  DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
