// Read-only psql access to the local docker Postgres, so a test can assert on
// what actually landed in the database and can fetch the email-verification
// token (standing in for the user clicking the link in their inbox).
//
// Override the command with PSQL_CMD if your database lives elsewhere, e.g.
//   PSQL_CMD="psql -U animationstation -d animationstation_db"
import { execFileSync } from 'node:child_process';

const DEFAULT_CMD =
  'docker compose exec -T postgres psql -U animationstation -d animationstation_db';

const SEP = '\x1f'; // ASCII unit separator — cannot occur in a uuid, email, or boolean

// Returns the first row as an object keyed by `columns`, or null when empty.
// Values come back as raw psql text ('t' / 'f' for booleans).
export function queryOne(sql, columns) {
  const parts = (process.env.PSQL_CMD ?? DEFAULT_CMD).split(' ');
  const out = execFileSync(parts[0], [...parts.slice(1), '-t', '-A', '-F', SEP, '-c', sql], {
    encoding: 'utf8',
    // psql would otherwise inherit stdin and swallow the rest of a piped script.
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

  if (!out) return null;
  const values = out.split('\n')[0].split(SEP);
  return Object.fromEntries(columns.map((c, i) => [c, values[i]]));
}
