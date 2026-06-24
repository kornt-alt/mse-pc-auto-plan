-- ==============================================
-- Users & Logs table initialization (MariaDB)
-- ==============================================

CREATE TABLE IF NOT EXISTS Users (
    userid      VARCHAR(50)  NOT NULL PRIMARY KEY,
    username    VARCHAR(100) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    name        VARCHAR(255) NOT NULL,
    role        VARCHAR(50)  NOT NULL DEFAULT 'Common',
    division    VARCHAR(100) DEFAULT NULL,
    email       VARCHAR(255) DEFAULT NULL,
    org         VARCHAR(100) DEFAULT NULL,
    created_at  DATETIME     NOT NULL DEFAULT NOW(),
    updated_at  DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS logs (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    action      VARCHAR(100) NOT NULL,
    target_id   VARCHAR(255) DEFAULT NULL,
    target_type VARCHAR(100) NOT NULL,
    comment     TEXT         DEFAULT NULL,
    created_at  DATETIME     NOT NULL DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
