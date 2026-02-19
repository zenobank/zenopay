/**
 * Deploy script for Zeno Crypto Checkout for Easy Digital Downloads.
 * Validates the plugin and publishes to WordPress.org SVN.
 */

import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { resolve, join, extname } from "node:path";
import { Command } from "commander";
import colors from "colors";

// ── Constants ────────────────────────────────────────────────────────────────

const PLUGIN_SLUG = "zeno-crypto-checkout-for-easy-digital-downloads";
const PLUGIN_FILE = `${PLUGIN_SLUG}.php`;
const DEFAULT_ENDPOINT = "https://api.zenobank.io";
const TEXT_EXTENSIONS = new Set([
  ".php",
  ".js",
  ".txt",
  ".css",
  ".json",
  ".html",
]);
const JUNK_PATTERNS = [".DS_Store", "Thumbs.db"];

type DeployMode = "release" | "trunk" | "assets";

// Paths
const ROOT_DIR = resolve(__dirname, "..");
const SVN_DIR = resolve(ROOT_DIR, "plugin");
const SVN_ASSETS = resolve(SVN_DIR, "assets");
const PLUGIN_DIR = resolve(SVN_DIR, "trunk");
const MAIN_PHP = resolve(PLUGIN_DIR, PLUGIN_FILE);
const README = resolve(PLUGIN_DIR, "readme.txt");

// ── Helpers ──────────────────────────────────────────────────────────────────

function info(msg: string) {
  console.log(colors.cyan(`  ℹ  ${msg}`));
}
function success(msg: string) {
  console.log(colors.green(`  ✔  ${msg}`));
}
function warn(msg: string) {
  console.log(colors.yellow(`  ⚠  ${msg}`));
}
function fatal(msg: string): never {
  console.error(colors.red(`  ✖  ${msg}`));
  process.exit(1);
}

function run(cmd: string, cwd?: string) {
  execSync(cmd, { stdio: "inherit", cwd: cwd ?? ROOT_DIR });
}

let rl: ReturnType<typeof createInterface> | null = null;

function getRL() {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
  }
  return rl;
}

function closeRL() {
  rl?.close();
  rl = null;
}

async function prompt(question: string): Promise<string> {
  return new Promise((res) => {
    getRL().question(`${colors.yellow("?")} ${question} `, (answer) => {
      res(answer.trim());
    });
  });
}

async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(`${question} [y/N]`);
  return answer.toLowerCase() === "y";
}

async function confirmOrExit(question: string): Promise<void> {
  if (!(await confirm(question))) {
    fatal("Aborted by user.");
  }
}

async function chooseMode(): Promise<DeployMode> {
  console.log(colors.bold("\n  What do you want to deploy?\n"));
  console.log("    1) " + colors.green("release") + "  — trunk + assets + version tag (full release)");
  console.log("    2) " + colors.cyan("trunk") + "    — trunk + assets only (no tag)");
  console.log("    3) " + colors.yellow("assets") + "   — assets only (banners, icons, screenshots)\n");

  const answer = await prompt("Choose [1/2/3]:");

  switch (answer) {
    case "1":
      return "release";
    case "2":
      return "trunk";
    case "3":
      return "assets";
    default:
      fatal(`Invalid choice: ${answer}`);
  }
}

/** Recursively walk a directory, skipping hidden directories. */
function walk(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".")) results.push(...walk(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

// ── Parse CLI Args (commander) ───────────────────────────────────────────────

interface Options {
  force: boolean;
  noClean: boolean;
  endpoint: string;
  mode: DeployMode | "";
}

function parseArgs(): Options {
  const program = new Command();

  program
    .name("deploy")
    .description("Validate and deploy the Zeno Crypto Checkout for EDD plugin")
    .option("-y, --force", "Skip interactive confirmations", false)
    .option("--no-clean", "Skip cleaning .DS_Store / Thumbs.db files")
    .option("--endpoint <url>", "Expected API endpoint", DEFAULT_ENDPOINT)
    .option(
      "--mode <mode>",
      "Deploy mode: release (trunk+assets+tag), trunk (trunk+assets), assets (assets only)",
      ""
    )
    .parse();

  const opts = program.opts<{
    force: boolean;
    clean: boolean;
    endpoint: string;
    mode: string;
  }>();

  const mode = opts.mode as DeployMode | "";
  if (mode && !["release", "trunk", "assets"].includes(mode)) {
    fatal(`Invalid --mode: ${mode}. Use: release, trunk, or assets`);
  }

  return {
    force: opts.force,
    noClean: !opts.clean,
    endpoint: opts.endpoint,
    mode,
  };
}

// ── Deploy Steps ─────────────────────────────────────────────────────────────

/** Verify plugin directory, main PHP file, and readme.txt exist. */
function verifyFiles() {
  info("Verifying plugin structure...");

  if (!existsSync(PLUGIN_DIR) || !statSync(PLUGIN_DIR).isDirectory()) {
    fatal(`Plugin directory not found: ${PLUGIN_DIR}`);
  }
  if (!existsSync(MAIN_PHP)) {
    fatal(`Main plugin file not found: ${MAIN_PHP}`);
  }
  if (!existsSync(README)) {
    fatal(`readme.txt not found: ${README}`);
  }

  success("Plugin directory, main PHP file, and readme.txt all present.");
}

/** Clean .DS_Store, ._*, and Thumbs.db from svn-plugin dir. */
function cleanJunk() {
  info("Cleaning junk files from svn-plugin directory...");
  let removed = 0;

  for (const file of walk(SVN_DIR)) {
    const name = file.split("/").pop()!;
    if (JUNK_PATTERNS.includes(name) || name.startsWith("._")) {
      unlinkSync(file);
      warn(`Removed: ${file}`);
      removed++;
    }
  }

  success(
    removed > 0 ? `Removed ${removed} junk file(s).` : "No junk files found."
  );
}

/** Scan plugin text files for localhost references. */
function localhostCheck() {
  info("Scanning for localhost references...");
  const hits: string[] = [];

  for (const file of walk(PLUGIN_DIR)) {
    const ext = extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;

    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/localhost/i.test(lines[i])) {
        hits.push(`  ${file}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }

  if (hits.length > 0) {
    console.log(colors.red("\nLocalhost references found:"));
    hits.forEach((h) => console.log(colors.red(h)));
    fatal("Remove all localhost references before deploying.");
  }

  success("No localhost references found.");
}

/** Extract ZNCCEDD_API_ENDPOINT from PHP and verify it matches expected. */
function verifyEndpoint(expectedEndpoint: string) {
  info("Verifying API endpoint...");

  const content = readFileSync(MAIN_PHP, "utf-8");
  const match = content.match(
    /define\(\s*'ZNCCEDD_API_ENDPOINT'\s*,\s*'([^']+)'/
  );

  if (!match) {
    fatal(`Could not extract ZNCCEDD_API_ENDPOINT from ${PLUGIN_FILE}`);
  }

  const actual = match[1];
  if (actual !== expectedEndpoint) {
    fatal(
      `API endpoint mismatch!\n` +
        `  Expected: ${expectedEndpoint}\n` +
        `  Found:    ${actual}`
    );
  }

  success(`API endpoint verified: ${actual}`);
}

/** Interactive confirmations (skipped with --force). */
async function interactiveChecks() {
  info("Interactive checks...");
  await confirmOrExit(
    "Have you run the WordPress Plugin Checker and resolved all issues?"
  );
  await confirmOrExit(
    "Have you updated the readme.txt description and changelog?"
  );
  success("Interactive checks passed.");
}

/** Verify version consistency across readme.txt and main PHP file. Returns the version. */
function versionConsistency(): string {
  info("Checking version consistency...");

  const readmeContent = readFileSync(README, "utf-8");
  const phpContent = readFileSync(MAIN_PHP, "utf-8");

  // Stable tag from readme.txt
  const stableMatch = readmeContent.match(/Stable tag:\s*(.+)/);
  if (!stableMatch) fatal("Could not extract Stable tag from readme.txt");
  const stableTag = stableMatch[1].trim();

  // Version from PHP header
  const versionMatch = phpContent.match(/\*\s*Version:\s*(.+)/);
  if (!versionMatch) fatal(`Could not extract Version from ${PLUGIN_FILE}`);
  const headerVersion = versionMatch[1].trim();

  // ZNCCEDD_VERSION from PHP
  const zcpgMatch = phpContent.match(
    /define\(\s*'ZNCCEDD_VERSION'\s*,\s*'([^']+)'/
  );
  if (!zcpgMatch)
    fatal(`Could not extract ZNCCEDD_VERSION from ${PLUGIN_FILE}`);
  const zncceddVersion = zcpgMatch[1];

  console.log(`  Stable tag (readme.txt):   ${stableTag}`);
  console.log(`  Header Version (php):      ${headerVersion}`);
  console.log(`  ZNCCEDD_VERSION (php):     ${zncceddVersion}`);

  if (stableTag !== headerVersion || headerVersion !== zncceddVersion) {
    fatal(
      `Version mismatch detected!\n` +
        `  Stable tag:        ${stableTag}\n` +
        `  Header Version:    ${headerVersion}\n` +
        `  ZNCCEDD_VERSION:   ${zncceddVersion}\n` +
        `All three must match.`
    );
  }

  success(`Version ${stableTag} is consistent across all files.`);
  return stableTag;
}

// ── SVN Operations ───────────────────────────────────────────────────────────

/** Stage additions and removals for given SVN paths. */
function svnStage(targets: string) {
  info(`Staging SVN changes (${targets})...`);
  run(`svn add --force ${targets}`, SVN_DIR);

  try {
    const status = execSync("svn status", {
      cwd: SVN_DIR,
      encoding: "utf-8",
    });
    const missing = status
      .split("\n")
      .filter((line) => line.startsWith("!"))
      .map((line) => line.replace(/^!\s+/, "").trim())
      .filter(Boolean);

    for (const file of missing) {
      run(`svn rm "${file}"`, SVN_DIR);
    }
  } catch {
    // No missing files
  }

  // Show pending changes
  run("svn status", SVN_DIR);
}

/** Commit assets only. */
async function svnCommitAssets(force: boolean) {
  if (!existsSync(SVN_ASSETS)) {
    fatal(`SVN assets directory not found: ${SVN_ASSETS}`);
  }

  svnStage("assets");

  if (!force) {
    await confirmOrExit("Commit assets to WordPress.org SVN?");
  }

  info("Committing assets...");
  run('svn commit assets -m "Update assets"', SVN_DIR);

  success("Assets published to WordPress.org SVN.");
}

/** Commit trunk + assets without creating a tag. */
async function svnCommitTrunk(force: boolean) {
  if (!existsSync(PLUGIN_DIR)) {
    fatal(`SVN trunk not found: ${PLUGIN_DIR}`);
  }

  svnStage("trunk assets");

  if (!force) {
    await confirmOrExit("Commit trunk + assets to WordPress.org SVN?");
  }

  info("Committing trunk and assets...");
  run('svn commit trunk assets -m "Update trunk and assets"', SVN_DIR);

  success("Trunk and assets published to WordPress.org SVN.");
}

/** Full release: commit trunk + assets, then create and commit a version tag. */
async function svnRelease(version: string, force: boolean) {
  if (!existsSync(PLUGIN_DIR)) {
    fatal(`SVN trunk not found: ${PLUGIN_DIR}`);
  }

  svnStage("trunk assets");

  if (!force) {
    await confirmOrExit(
      `Publish version ${version} to WordPress.org SVN?`
    );
  }

  info("Committing trunk and assets...");
  run(
    `svn commit trunk assets -m "Deploy version ${version}"`,
    SVN_DIR
  );

  info(`Creating tag ${version}...`);
  run(`svn cp trunk "tags/${version}"`, SVN_DIR);

  info(`Committing tag ${version}...`);
  run(`svn commit "tags/${version}" -m "Tag version ${version}"`, SVN_DIR);

  success(`Version ${version} published to WordPress.org SVN.`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log(colors.bold("\n--- Zeno Crypto Checkout for EDD — Deploy ---\n"));

  // Pick deploy mode
  const mode: DeployMode = opts.mode
    ? (opts.mode as DeployMode)
    : await chooseMode();

  info(`Deploy mode: ${colors.bold(mode)}`);

  // Clean junk files
  if (!opts.noClean) {
    cleanJunk();
  } else {
    info("Skipping junk file cleanup (--no-clean).");
  }

  // Assets-only: skip all plugin validation
  if (mode === "assets") {
    await svnCommitAssets(opts.force);
    closeRL();
    console.log(colors.bold(colors.green("\nDeploy complete.\n")));
    return;
  }

  // Trunk & release: full validation
  verifyFiles();
  localhostCheck();
  verifyEndpoint(opts.endpoint);

  if (!opts.force) {
    await interactiveChecks();
  } else {
    info("Skipping interactive checks (--force).");
  }

  const version = versionConsistency();

  if (mode === "trunk") {
    await svnCommitTrunk(opts.force);
  } else {
    await svnRelease(version, opts.force);
  }

  closeRL();
  console.log(colors.bold(colors.green("\nDeploy complete.\n")));
}

// Graceful Ctrl+C handling
process.on("SIGINT", () => {
  closeRL();
  console.log(colors.yellow("\n\nAborted."));
  process.exit(130);
});

main().catch((err) => {
  closeRL();
  fatal(err instanceof Error ? err.message : String(err));
});
