-- =============================================================================
-- Envinity: initial schema
--
-- Follows Securinity's model: every workspace is a tenant, and tenant isolation
-- is enforced twice (tenant-scoped queries + FORCEd Row Level Security).
--
-- Zero-knowledge: the server never stores a .env in plaintext, never receives
-- the user's password, and never holds a ticket key it can use on its own.
--   * ciphertext            AES-256-GCM, encrypted in the browser with a random ticket key K
--   * owner_wrapped_key     K wrapped with the owner's vault key (derived from the password, browser-only)
--   * code_wrapped_key      K wrapped with a key derived from the 8-char share code (PBKDF2, browser-side)
--   * QR links carry K in the URL fragment, which browsers never send to a server.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE tenants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    plan        TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                  CITEXT NOT NULL UNIQUE CHECK (position('@' IN email) > 1 AND length(email) <= 254),
    name                   TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    -- scrypt of the browser-derived authKey (the password itself never arrives).
    auth_hash              TEXT NOT NULL,
    -- Public KDF parameters the browser needs to re-derive authKey and the vault key.
    kdf_salt               TEXT NOT NULL,
    kdf_iterations         INTEGER NOT NULL CHECK (kdf_iterations >= 100000),
    failed_logins          INTEGER NOT NULL DEFAULT 0,
    locked_until           TIMESTAMPTZ,
    last_login_at          TIMESTAMPTZ,
    -- Bumped on 2FA changes / "sign out everywhere" to invalidate every access token.
    token_version          INTEGER NOT NULL DEFAULT 1,
    -- TOTP 2FA. Secrets are AES-256-GCM sealed with TOTP_ENCRYPTION_KEY.
    totp_secret_enc        TEXT,
    totp_enabled_at        TIMESTAMPTZ,
    totp_last_step         BIGINT,
    totp_pending_enc       TEXT,
    totp_pending_expires_at TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((totp_enabled_at IS NULL) = (totp_secret_enc IS NULL))
);

CREATE TABLE memberships (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner','member')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tenant_id)
);
CREATE INDEX memberships_tenant_idx ON memberships(tenant_id);

-- Rotating refresh tokens with family-wide reuse detection (same as Securinity).
CREATE TABLE refresh_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id    UUID NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    user_agent   TEXT,
    ip           INET,
    expires_at   TIMESTAMPTZ NOT NULL,
    rotated_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens(family_id);

-- Pending second factor after a correct password. Short-lived, attempt-limited.
CREATE TABLE mfa_challenges (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    attempts     INTEGER NOT NULL DEFAULT 0,
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    ip           INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mfa_challenges_user_idx ON mfa_challenges(user_id);

CREATE TABLE mfa_recovery_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, code_hash)
);

CREATE TABLE tickets (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    environment        TEXT NOT NULL CHECK (environment IN ('production','staging','development','preview')),
    var_count          INTEGER NOT NULL CHECK (var_count BETWEEN 1 AND 500),
    -- Encrypted payload. NULLed when the ticket expires: the data is destroyed, not hidden.
    ciphertext         TEXT CHECK (ciphertext IS NULL OR length(ciphertext) <= 200000),
    iv                 TEXT,
    owner_wrapped_key  TEXT,
    owner_wrap_iv      TEXT,
    -- HMAC(LOOKUP_PEPPER, SHA-256(code)). The raw code never reaches the server.
    code_lookup        TEXT,
    code_salt          TEXT,
    code_iterations    INTEGER,
    code_wrapped_key   TEXT,
    code_wrap_iv       TEXT,
    one_time           BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at         TIMESTAMPTZ,
    revoked_at         TIMESTAMPTZ,
    consumed_at        TIMESTAMPTZ,
    destroyed_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tickets_tenant_idx ON tickets(tenant_id, created_at DESC);
CREATE UNIQUE INDEX tickets_code_lookup_uq ON tickets(code_lookup) WHERE code_lookup IS NOT NULL;
CREATE INDEX tickets_expiry_idx ON tickets(expires_at) WHERE destroyed_at IS NULL AND expires_at IS NOT NULL;

CREATE TABLE ticket_opens (
    id           BIGSERIAL PRIMARY KEY,
    -- The ticket owner's tenant, so the owner's access log is RLS-scoped.
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ticket_id    UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    opened_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    opener_label TEXT NOT NULL,
    via          TEXT NOT NULL CHECK (via IN ('code','qr')),
    ip           INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ticket_opens_ticket_idx ON ticket_opens(ticket_id, created_at DESC);
CREATE INDEX ticket_opens_user_idx ON ticket_opens(opened_by, created_at DESC);

CREATE TABLE audit_log (
    id             BIGSERIAL PRIMARY KEY,
    tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE,
    actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_label    TEXT,
    action         TEXT NOT NULL,
    target_type    TEXT,
    target_id      TEXT,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip             INET,
    user_agent     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_idx ON audit_log(tenant_id, created_at DESC);

CREATE TABLE rate_limits (
    bucket       TEXT PRIMARY KEY,
    window_start TIMESTAMPTZ NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX rate_limits_expiry_idx ON rate_limits(expires_at);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_touch BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security (same helpers as Securinity)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
    SELECT NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION rls_bypassed() RETURNS BOOLEAN AS $$
    SELECT COALESCE(current_setting('app.bypass_rls', TRUE), 'off') = 'on';
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['tickets','ticket_opens','audit_log']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY %I_tenant_isolation ON %I USING (tenant_id = current_tenant_id() OR rls_bypassed()) '
            'WITH CHECK (tenant_id = current_tenant_id() OR rls_bypassed())', t, t);
    END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON tenants
    USING (id = current_tenant_id() OR rls_bypassed())
    WITH CHECK (id = current_tenant_id() OR rls_bypassed());

-- Account tables are only ever touched through withSystem (auth flows).
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['users','memberships','refresh_tokens','mfa_challenges','mfa_recovery_codes']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY %I_system_only ON %I USING (rls_bypassed()) WITH CHECK (rls_bypassed())', t, t);
    END LOOP;
END $$;
