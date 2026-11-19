-- Additive migration. Never drops users or changes their passwords.
CREATE TABLE IF NOT EXISTS google_identities (
    google_sub VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    CONSTRAINT fk_google_identity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
