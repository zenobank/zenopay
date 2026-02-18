import { createInterface, Interface } from "node:readline";

type Check = {
  question: string;
};

const CHECKS: Check[] = [
  {
    question: "Have you run the plugin through Plugin Check (PCP)?",
  },
];

async function ask(rl: Interface, check: Check): Promise<boolean> {
  return new Promise((res) => {
    rl.question(`${check.question}\n  (y/n): `, (answer: string) => {
      res(answer.trim().toLowerCase() === "y");
    });
  });
}

async function run(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n========================================");
  console.log("  Pre-release checklist");
  console.log("========================================\n");

  const results: { question: string; passed: boolean }[] = [];

  for (const check of CHECKS) {
    const passed = await ask(rl, check);
    results.push({ question: check.question, passed });
    console.log(passed ? "  -> OK\n" : "  -> PENDING\n");
  }

  rl.close();

  console.log("\n========================================");
  console.log("  Results");
  console.log("========================================\n");

  const failed = results.filter((r) => !r.passed);
  const passed = results.filter((r) => r.passed);

  for (const r of passed) {
    console.log(`  [PASS] ${r.question}`);
  }
  for (const r of failed) {
    console.log(`  [PENDING] ${r.question}`);
  }

  console.log(`\n  ${passed.length}/${results.length} checks passed.\n`);

  if (failed.length > 0) {
    console.log("  Some checks are pending. Resolve them before releasing.\n");
    process.exit(1);
  }

  console.log("  All checks passed. Ready to build!\n");
}

run();
