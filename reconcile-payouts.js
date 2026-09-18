import path from "node:path";
import { loadEnvFile, parseArgs, runReconciliation } from "./src/reconcile-payouts.js";

async function main() {
  await loadEnvFile(path.resolve(".env"));
  const args = parseArgs();

  const result = await runReconciliation({
    dryRun: args["dry-run"],
    source: args.source,
    startDate: args["start-date"],
    endDate: args["end-date"],
    matchWindowDays: args["match-window-days"],
  });

  console.log(JSON.stringify(result.summary, null, 2));
}

main().catch((error) => {
  if (error.summary) {
    console.error(JSON.stringify(error.summary, null, 2));
  }
  console.error(error.message);
  process.exit(1);
});
