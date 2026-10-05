import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { Pool } from "pg";

// Node gives each IP only 250 ms by default. A far-away database (India -> us-east-2) needs longer.
setDefaultAutoSelectFamilyAttemptTimeout(2000);

export function createPool(): Pool {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    return new Pool({ connectionString: url });
}