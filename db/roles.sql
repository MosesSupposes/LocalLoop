-- The API talks to Postgres as a non-owner role so Row-Level Security is always enforced.
-- Run with: psql -v app_user=... -v app_password=...
select format('create role %I login password %L', :'app_user', :'app_password')
where not exists (select 1 from pg_roles where rolname = :'app_user')
\gexec

select format('alter role %I with login password %L nosuperuser nocreatedb nocreaterole', :'app_user', :'app_password')
\gexec

grant usage on schema public to :"app_user";
