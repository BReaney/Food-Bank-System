
import "dotenv/config";
import pg from "pg";

// Creates a pool of reusable PostgreSQL connections.
// pg reads PGHOST, PGPORT, PGDATABASE, PGUSER,
// and PGPASSWORD from the environment.
export const pool = new pg.Pool();