// scripts/reconcileDeaneryParish.js
// =====================================================================================
// Reconcile the `deanery` and `parish` tables to the STATIC source-of-truth list below.
// The static strings are authoritative; the DB is made to match them EXACTLY (quirks and
// all: trailing space in "Ajnala ", dotless parish "Jalandhar Cantt", spelling "Ferozpur"/
// "Puranashalla", commas/parentheses, and the intentional Muktsar near-duplicates).
//
// ------------------------------------------------------------------------------------
// HOW TO RUN
//   Local:       set local DB_* env vars (or uncomment the localhost block in .env), then:
//                  npm run reconcile-deanery-parish
//                or with explicit overrides (CLI env wins; dotenv never overrides set vars):
//                  DB_HOST=localhost DB_USER=root DB_PASSWORD=*** DB_NAME=cyd_new \
//                  DB_PORT=3306 DB_SSL=false node scripts/reconcileDeaneryParish.js
//   PRODUCTION:  set the prod DB_* env vars (DB_HOST/DB_USER/DB_PASSWORD/DB_NAME and,
//                for Aiven, DB_PORT + DB_SSL=true), then:  npm run reconcile-deanery-parish
//
// SAFETY
//   * ADDITIVE + name-normalizing only. It INSERTs missing rows and UPDATEs the two
//     discovered near-match names (preserving each row's id/FK). It DELETES nothing.
//   * Idempotent: a second run reports 0 inserted / 0 renamed.
//   * The DELETE block (rows in DB but NOT in static) is OFF by default and lives at the
//     bottom, commented, behind a risk header. Review against live `profile.parish` /
//     `profile.deanery` references before ever enabling it.
//   * >>> TAKE A DATABASE BACKUP before the first PRODUCTION run. <<<
//
// NOTE ON CONNECTION: config/database.js does not read DB_PORT / DB_SSL, which the Aiven
//   production host requires. This script therefore builds its own mysql2 pool from the
//   same DB_* env vars PLUS DB_PORT/DB_SSL, so it connects correctly on BOTH local and prod
//   without modifying the shared app config. Locally (no DB_PORT/DB_SSL) it behaves
//   identically to config/database.js.
// =====================================================================================
require('dotenv').config();
const mysql = require('mysql2/promise');

// ---- SOURCE OF TRUTH (exact strings — do NOT clean, trim, or re-spell) --------------
const DEANERIES = {
  Ajnala: ["Ajnala ", "Chamiyari", "Chogawan", "Chuchakwal", "Karyal", "Othian", "Punga", "Ramdas"],
  Amritsar: ["Amritsar Cantt.", "Bharariwal", "Gumtala", "Khasa", "Lahorigate", "Majitha Road", "Nai Abadi", "Rajasansi"],
  Dhariwal: ["Batala", "Dhariwal", "Dialgarh", "Kalanaur", "Mastkot", "Naushera Majja Singh", "Qadian"],
  "Fatehgarh Churian": ["Fatehgarh Churian", "Dera Baba Nanak", "Dharamkot Randhawa", "Ghanie Ke Banger", "Kotli", "Machi Nangal", "Majitha", "Pakharpura"],
  Ferozpur: ["Faridkot", "Badhni Mahafariste Wala", "Ferozpur Canal Colony", "Ferozpur Cantt", "Ferozpur City", "Gulami Wala", "Guru Har Sahai", "Lohgarh-Sur Singh Wala (Station)", "Mamdot", "Mudki (Station)", "Sadiq", "Talwandi Bhai", "Tehna, Faridkot"],
  Gurdaspur: ["Balun (Station)", "Dalhousie", "Dina Nagar", "Dorangala", "Gurdaspur", "Jandwal, Pathankot", "Kahnuwan", "Narot Jaimal Singh (Station)", "Pathankot City", "Puranashalla", "Sidhwan Jamita, Joura Chitra", "Sujanpur, Pathankot"],
  Hoshiarpur: ["Kakkon", "Baijnath", "Balachaur", "Bassi Bahian", "Bhunga", "Gaggal", "Garshankar", "Jindwari", "Mehtiana, Khanaura", "Nandachaur", "Nangal", "Palampur", "Una", "Yol Camp"],
  "Jalandhar Cantt.": ["Apra", "Banga (Station)", "Behram (Station)", "Dhina-Chittewani", "Jalandhar Cantt", "Jandiala Manjki", "Nawanshahar", "Phagwara", "Phulriwal", "Rawalpindi", "Sansarpur"],
  "Jalandhar City": ["Adampur", "Bootan", "Chogitty", "Gakhalan", "Jalandhar City", "Lambapind", "Maqsudan"],
  Kapurthala: ["Hussainpur- Lodhi Bhulana", "Kapurthala", "Kishangarh", "Kartarpur", "Mehatpur", "Nakodar", "Shahkot", "Sultanpur Lodhi"],
  Ludhiana: ["BRS Nagar", "Jagraon", "Jalandhar Bypass, Ludhiana", "Kidwai Nagar", "Phillaur", "Raekot", "Sarabha Nagar"],
  Moga: ["Baghapurana", "Buggipura, Moga (Station)", "Buttar, Moga (Station)", "Dharamkot, Moga", "Kot-Ise-Khan, Moga (Station)", "Makhu", "Moga", "Nihal Singh Wala, Moga (Station)", "Singhanwala, Moga", "Takhtupura", "Zira"],
  Muktsar: ["Abohar", "Bhagsar", "Danewala", "Enakhera", "Fazilka", "Gidderbaha (Station)", "Jaiton", "Jalalabad", "Kotkapura", "Malout Pind", "Malout", "Muktsar, Bir Sarkar", "Muktsar", "Panjgaraian (Station)", "Sikhwala"],
  Sahnewal: ["Bhammian Kalan (Station)", "Jamalpur", "Khanna", "Khanpur-Jassar-Sangowal-Rania", "Machhiwara", "Machian Khurd", "Sahnewal", "Samrala"],
  Tanda: ["Bhogpur", "Bholath", "Dasuya", "Mukerian", "Tanda", "Sri Hargobindpur"],
  "Tarn Taran": ["Akalgarh (Station)", "Beas", "Bhikhiwind", "Bhojian", "Chabhal (Station)", "Fatehabad (Station)", "Harike", "Jandiala Guru", "Khem Karan", "Patti", "Tarn Taran"],
};

// ---- Discovered near-match name normalizations (STATIC wins; UPDATE in place) --------
// Each entry renames an EXISTING row (matched by exact/binary current name within its
// deanery) to the static string, preserving the row id and any FK references. Found by the
// STEP 0 diff against the live DB. Idempotent: once renamed, the `from` row no longer
// exists so a re-run changes nothing. Add entries here if prod surfaces other variants.
const PARISH_RENAMES = [
  { deanery: "Ajnala",   from: "Ajnala",                            to: "Ajnala " },              // add trailing space
  { deanery: "Ferozpur", from: "Ferozepur Badhni Mahafariste Wala", to: "Badhni Mahafariste Wala" }, // drop "Ferozepur " prefix + spelling
];
const DEANERY_RENAMES = []; // none discovered — all 16 deanery names already match exactly

// ---- Connection (honors DB_PORT / DB_SSL so it works on local AND Aiven prod) --------
const buildPool = () => {
  const cfg = {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "cyd_new",
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  };
  if (String(process.env.DB_SSL).toLowerCase() === "true") {
    cfg.ssl = { rejectUnauthorized: false };
  }
  return { pool: mysql.createPool(cfg), cfg };
};

// ---- Idempotent primitives ----------------------------------------------------------

// Find a deanery by exact name (default collation); INSERT if missing. Returns {id, inserted}.
const ensureDeanery = async (pool, name) => {
  const [rows] = await pool.execute("SELECT id FROM deanery WHERE name = ? LIMIT 1", [name]);
  if (rows.length > 0) return { id: rows[0].id, inserted: false };
  const [res] = await pool.execute("INSERT INTO deanery (name) VALUES (?)", [name]);
  return { id: res.insertId, inserted: true };
};

// Rename an existing parish row in place (BINARY match on `from` so trailing-space/case
// variants are distinguished). Returns rows actually changed (0 on a settled DB).
const renameParish = async (pool, deaneryId, from, to) => {
  if (from === to) return 0;
  const [res] = await pool.execute(
    "UPDATE parish SET name = ? WHERE deanery_id = ? AND BINARY name = ?",
    [to, deaneryId, from]
  );
  return res.changedRows;
};

// Find a parish by (deanery_id, name) using default collation — which treats 'Ajnala' and
// 'Ajnala ' as equal (PADSPACE). This makes the upsert purely additive: it never creates a
// trailing-space/case duplicate of a row the rename pass already fixed. INSERT if genuinely
// absent. Returns {inserted}.
const ensureParish = async (pool, deaneryId, name) => {
  const [rows] = await pool.execute(
    "SELECT id FROM parish WHERE deanery_id = ? AND name = ? LIMIT 1",
    [deaneryId, name]
  );
  if (rows.length > 0) return { inserted: false };
  await pool.execute("INSERT INTO parish (name, deanery_id) VALUES (?, ?)", [name, deaneryId]);
  return { inserted: true };
};

// ---- Main ---------------------------------------------------------------------------
const main = async () => {
  const { pool, cfg } = buildPool();
  console.log(`🔌 Connecting to ${cfg.host}:${cfg.port} db=${cfg.database} ssl=${!!cfg.ssl}`);

  const stats = {
    deaneryInserted: 0, deaneryExisting: 0,
    parishInserted: 0, parishExisting: 0, parishRenamed: 0,
  };

  try {
    await pool.query("SELECT 1"); // fail fast on bad connection
    console.log("✅ Connected.\n");

    // 1) Deaneries: additive upsert. Build name→id map. (DEANERY_RENAMES is empty.)
    const deaneryId = {};
    for (const name of Object.keys(DEANERIES)) {
      const { id, inserted } = await ensureDeanery(pool, name);
      deaneryId[name] = id;
      inserted ? stats.deaneryInserted++ : stats.deaneryExisting++;
      if (inserted) console.log(`  ➕ inserted deanery "${name}"`);
    }

    // 2) Parish renames (in place, preserve id/FK) BEFORE the upsert pass.
    for (const r of PARISH_RENAMES) {
      const did = deaneryId[r.deanery];
      if (!did) throw new Error(`Rename references unknown deanery "${r.deanery}"`);
      const changed = await renameParish(pool, did, r.from, r.to);
      stats.parishRenamed += changed;
      if (changed) console.log(`  ✏️  renamed parish [${r.deanery}] "${r.from}" → "${r.to}"`);
    }

    // 3) Parishes: additive upsert under each deanery, with the exact static strings.
    for (const [deanery, parishes] of Object.entries(DEANERIES)) {
      const did = deaneryId[deanery];
      for (const pname of parishes) {
        const { inserted } = await ensureParish(pool, did, pname);
        if (inserted) {
          stats.parishInserted++;
          console.log(`  ➕ inserted parish [${deanery}] "${pname}"`);
        } else {
          stats.parishExisting++;
        }
      }
    }

    // 4) Final counts: DB vs static must match.
    const staticDeaneries = Object.keys(DEANERIES).length;
    const staticParishes = Object.values(DEANERIES).reduce((n, a) => n + a.length, 0);
    const [[{ dc }]] = await pool.query("SELECT COUNT(*) AS dc FROM deanery");
    const [[{ pc }]] = await pool.query("SELECT COUNT(*) AS pc FROM parish");

    console.log("\n──────── summary ────────");
    console.log(`deaneries:  inserted=${stats.deaneryInserted}  existing=${stats.deaneryExisting}`);
    console.log(`parishes:   inserted=${stats.parishInserted}  existing=${stats.parishExisting}  renamed=${stats.parishRenamed}`);
    console.log(`counts:     deanery DB=${dc} static=${staticDeaneries}   parish DB=${pc} static=${staticParishes}`);
    const ok = dc === staticDeaneries && pc === staticParishes;
    console.log(ok ? "✅ DB matches static (counts equal)." : "⚠️  Count mismatch — DB may legitimately hold extra (DB-only) rows; see DELETE block.");
  } finally {
    await pool.end();
  }
};

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Reconcile failed:", err.message);
      process.exit(1);
    });
}

module.exports = { main, DEANERIES, PARISH_RENAMES, DEANERY_RENAMES };

// =====================================================================================
// ⚠️  DANGER — DESTRUCTIVE DELETE BLOCK — OFF BY DEFAULT — DO NOT ENABLE BLINDLY  ⚠️
// -------------------------------------------------------------------------------------
// The reconcile above is additive. It NEVER removes "DB-only" rows (rows present in the
// DB but absent from the static list). Real `profile.parish` / `profile.deanery` values
// are stored as STRINGS that may reference such rows, so deleting them can orphan data.
//
// As of the STEP 0 discovery there were ZERO DB-only rows, so nothing here is needed.
// If you ever must prune extras, FIRST take a backup and audit references, e.g.:
//   SELECT DISTINCT parish  FROM profile WHERE parish  IS NOT NULL;
//   SELECT DISTINCT deanery FROM profile WHERE deanery IS NOT NULL;
// then, only after confirming a row is truly unused, delete it manually & intentionally.
// This block is intentionally left as commented guidance, not executable code.
// =====================================================================================
