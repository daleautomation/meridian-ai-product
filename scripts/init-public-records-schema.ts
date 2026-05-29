import { ensurePublicRecordsSchema } from "../lib/enrichment/public-records/canonicalStorage/initSchema";
import { getCrmDatabaseUrl } from "../lib/crm-import/storageConfig";

async function main() {
  if (!getCrmDatabaseUrl()) {
    console.error(
      "Set DATABASE_URL or POSTGRES_URL before running init-public-records-schema",
    );
    process.exit(1);
  }
  await ensurePublicRecordsSchema();
  console.log("public-records schema ready", {
    tables: [
      "public_parcels",
      "public_ownership_snapshots",
      "workspace_contact_parcel_links",
    ],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
