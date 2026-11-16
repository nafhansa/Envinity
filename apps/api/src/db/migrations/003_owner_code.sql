-- The share code is otherwise unrecoverable (the server keeps only an HMAC of its hash).
-- Owners get a copy wrapped with their vault key, so they can show it again later.
-- Still zero-knowledge: the vault key never leaves the owner's browser.
ALTER TABLE tickets
    ADD COLUMN owner_code_enc TEXT,
    ADD COLUMN owner_code_iv  TEXT;
