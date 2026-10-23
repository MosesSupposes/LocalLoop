-- Table privileges for the API role. Row visibility is decided by RLS policies in the migration.
grant usage on schema public to :"app_user";
grant select, insert, update, delete on all tables in schema public to :"app_user";
grant usage, select on all sequences in schema public to :"app_user";
grant execute on all functions in schema public to :"app_user";

alter default privileges in schema public
  grant select, insert, update, delete on tables to :"app_user";
alter default privileges in schema public
  grant execute on functions to :"app_user";
