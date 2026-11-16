-- =============================================================================
-- Least-privilege application role (same reasoning as Securinity's 002).
-- Superusers bypass RLS even with FORCE, so the API must never connect as one.
-- Change this password outside local development (ALTER ROLE ... PASSWORD).
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'envinity_app') THEN
        CREATE ROLE envinity_app LOGIN PASSWORD 'envinity_app_dev_password'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END $$;

DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO envinity_app', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO envinity_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO envinity_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO envinity_app;
-- schema_migrations is for the migrator only.
REVOKE ALL ON schema_migrations FROM envinity_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO envinity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO envinity_app;
