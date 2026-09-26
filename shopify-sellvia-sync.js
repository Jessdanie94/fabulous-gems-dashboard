import path from "node:path";
import { loadEnvFile, parseArgs, runSync } from "./src/shopify-sellvia-sync.js";

async function main() {
  await loadEnvFile(path.resolve(".env"));
  const args = parseArgs();
  const result = await runSync({
    dryRun: args["dry-run"],
    scope: args.scope,
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
