-- Non-destructive setup only. Existing users are preserved.
CREATE DATABASE IF NOT EXISTS weather_hereglegch;
USE weather_hereglegch;
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL
);

USE weather_hereglegch;

CREATE TABLE IF NOT EXISTS google_identities (
    google_sub VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

-- Create users through POST /api/register so passwords are bcrypt hashes.
