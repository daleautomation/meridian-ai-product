import { ensureCrmContactsSchema } from "../lib/crm-import/initCrmContactsSchema";
import { getCrmDatabaseUrl } from "../lib/crm-import/storageConfig";

async function main() {
  if (!getCrmDatabaseUrl()) {
    console.error("Set DATABASE_URL or POSTGRES_URL before running crm:schema:init");
    process.exit(1);
  }
  await ensureCrmContactsSchema();
  console.log("crm_contacts schema ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
