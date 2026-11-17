// Token Radar — the entrypoint.
//
// Reads the sealed snapshot, scores every pre-token protocol with the model
// in lib/model.ts, and writes the ranked board, the dashboard's data, the
// dashboard itself, the screenshots and the dossier the judge reads.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
//
// In the grader's container the snapshot sits at /input/snapshot.json and
// the output goes to /output. The program is deterministic: two runs on the
// same snapshot write the same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const TEXT_CAP = 65_536;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--flag value` or `--flag=value` from the arguments, else the fallback. */
function flag(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

const inputPath = flag('input', '/input');
const snapshotPath = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath} — pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files, skipping dotfiles, into `dest`. Returns the names copied. */
function copyDir(from: string, dest: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(dest, name));
    names.push(name);
  }
  return names;
}

const dashboardFiles = copyDir(join(root, 'dashboard'), join(outDir, 'dashboard'));
const shotNames = copyDir(join(root, 'screenshots'), join(outDir, 'screenshots'));
if (shotNames.length < 3) {
  fail(`screenshots/ holds ${shotNames.length} image${shotNames.length === 1 ? '' : 's'} — hand in 3: the board, a detail view and a filtered view`);
}
for (const name of shotNames) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_CAP,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const top = board[0]!;
const dossierBytes = statSync(join(outDir, 'dossier.json')).size;
process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${radar.early_size} early finds below the floor, ${radar.live_size} live tokens set aside)\n` +
    `token-radar: rank 1 is ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')} implied value\n` +
    `token-radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), screenshots/ (${shotNames.length} images) and dossier.json (${dossierBytes.toLocaleString('en-US')} bytes) into ${outDir}\n`,
);
