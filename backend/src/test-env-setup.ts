import { readFileSync } from 'fs';
import { resolve } from 'path';

/** Load backend/.env.example into process.env for unit tests (no hardcoded knobs in code). */
function applyEnvFile(filePath: string): void {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // Strip inline comments: VALUE # comment
    const hash = val.indexOf(' #');
    if (hash >= 0) val = val.slice(0, hash).trim();
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = val;
    }
  }
}

applyEnvFile(resolve(__dirname, '../.env.example'));
