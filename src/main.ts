import { scan } from "./scan/scan";
import { checkDuplicate } from "./analysis/duplicate";

async function main() {
  await scan()
  checkDuplicate()
}

main()