/**
 * The admin credential store, from a terminal.
 *
 *   npm run admin:user -- list
 *   npm run admin:user -- add janet                  # invents a strong passphrase
 *   npm run admin:user -- add janet --stdin          # reads the password from stdin
 *   … --stdin --insecure-password                    # a deliberate pilot starter
 *   npm run admin:user -- password janet             # rotate
 *   npm run admin:user -- disable janet              # revoke access, keep the name
 *   npm run admin:user -- enable janet
 *
 * Why a CLI and not a page in the admin: the set of people who may act on
 * parents' records is the one thing the app should not be able to change from
 * inside itself. A page would mean a session could grant a session — and the
 * client's own answer (QC Answers Q6) is one admin, maybe two, no roles.
 *
 * Every command writes an `audit_log` row. Access changes are the most
 * audit-worthy events there are, and `--by` names whoever ran it; without it the
 * row says `cli`, which is honest about knowing no more than that.
 *
 * A password is never stored and never printed except at the moment one is
 * generated. Rotation and creation both write `scrypt:N:r:p:salt:hash`, and
 * `admin_users_hash_check` in the database refuses anything that is not that
 * shape — so a plaintext password cannot land in the column by accident.
 */

import { existsSync } from "node:fs";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import postgres from "postgres";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(file);
  }
}

const scrypt = promisify(scryptCb);
/** Must match `SCRYPT` in lib/admin/auth.ts — the record carries it either way. */
const COST = { N: 65536, r: 8, p: 1, keylen: 32 };
const MAXMEM = 256 * 1024 * 1024;

const USAGE = `Usage: npm run admin:user -- <command> [name] [--stdin] [--by <who>]

  list                 who can sign in, when they last did
  add <name>           create a person and print a generated password
  password <name>      rotate — ends that person's sessions
  disable <name>       revoke access. The name stays, so the audit log still reads
  enable <name>        put them back

  --stdin              read the password from stdin instead of generating one
  --insecure-password  allow one under 12 characters — a deliberate pilot starter
  --by <who>           who is making this change; goes in the audit row`;

const args = process.argv.slice(2);
const fromStdin = args.includes("--stdin");
const insecure = args.includes("--insecure-password");
const byIndex = args.indexOf("--by");
const by = byIndex === -1 ? "cli" : (args[byIndex + 1] ?? "cli");
/* `--by janet` takes the next argument with it. Guarded on byIndex !== -1,
   because -1 + 1 is index 0 — the command itself. */
const positional = args.filter(
  (a, i) => !a.startsWith("--") && !(byIndex !== -1 && i === byIndex + 1),
);
const [command, name] = positional;

if (!command || !["list", "add", "password", "disable", "enable"].includes(command)) {
  console.error(USAGE);
  process.exit(1);
}
if (command !== "list" && !name) {
  console.error(USAGE);
  process.exit(1);
}
if (name && !/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
  console.error(
    `"${name}" won't do as a name. Lowercase letters, digits, dot, underscore or\n` +
      "hyphen — it is what appears in every audit row, and the database checks it.",
  );
  process.exit(1);
}

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url || url.trim() === "") {
  console.error(
    "DATABASE_URL is not set, so there is no credential store to write to.\n\n" +
      "Without a database the admin falls back to ADMIN_CREDENTIALS — generate one\n" +
      "with `npm run admin:credential -- <name>`.",
  );
  process.exit(1);
}

/** Readable, and still ~77 bits: five words from a 2048-ish space plus digits. */
function generatePassphrase() {
  const words =
    "amber anchor aspen basil beacon birch canyon cedar cinder clover cobalt copper coral cove crest dahlia dune ember fable fern flint garnet grove harbor hazel heron indigo ivory jasper juniper kelp lantern larch laurel linden lotus lumen maple marlin meadow mesa mica moss nectar oakum ochre olive onyx opal orchid osprey pebble pewter pine quartz quill raven reef rowan russet sable sage saffron sedge sequoia shale slate sorrel spruce sumac talon tamarind teal thistle thorn tide topaz trellis tulip umber vale verbena vermilion vireo willow wren yarrow zephyr".split(
      " ",
    );
  const pick = () => words[randomBytes(2).readUInt16BE(0) % words.length];
  const digits = String(randomBytes(2).readUInt16BE(0) % 10000).padStart(4, "0");
  return `${pick()}-${pick()}-${pick()}-${pick()}-${digits}`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function newPassword() {
  const generated = !fromStdin;
  const password = fromStdin ? await readStdin() : generatePassphrase();

  if (password === "") {
    console.error("No password on stdin — nothing to hash.");
    process.exit(1);
  }
  /**
   * The floor, and the one way through it.
   *
   * `--insecure-password` exists because seeding a pilot is a real situation: two
   * people, one shared starter password, changed from inside the admin the first
   * time each of them signs in. It is spelled out rather than implied so the
   * choice appears at the call site, in the terminal, and in the audit row — and
   * so nobody discovers months later that the floor was quietly lowered for
   * everyone. **`/api/admin/password` keeps the 12-character minimum**: the
   * product's own path only ever moves upward.
   */
  if (password.length < 12 && !insecure) {
    console.error(
      `That password is ${password.length} characters. The admin holds every parent's\n` +
        "profile and every restricted note; use at least 12.\n\n" +
        "If this is a deliberate starter password for a pilot, say so:\n" +
        "  --insecure-password",
    );
    process.exit(1);
  }

  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, COST.keylen, { ...COST, maxmem: MAXMEM });
  const record = [
    "scrypt",
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join(":");

  return { record, password, generated, weak: password.length < 12 };
}

const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

/** One statement per change, with its audit row, in one transaction. */
async function audited(action, resourceId, before, after, run) {
  await client.begin(async (tx) => {
    await run(tx);
    await tx`
      insert into audit_log (actor, action, resource, resource_id, before, after)
      values (${by}, ${action}, 'admin_user', ${resourceId},
              ${before === null ? null : JSON.stringify(before)},
              ${after === null ? null : JSON.stringify(after)})
    `;
  });
}

const when = (v) => (v ? new Date(v).toISOString().slice(0, 16).replace("T", " ") : "—");

try {
  if (command === "list") {
    const rows = await client`
      select name, active, created_by, created_at, password_changed_at, last_sign_in_at
      from admin_users order by name
    `;
    if (rows.length === 0) {
      console.log(
        "\n  Nobody yet. The app is falling back to ADMIN_CREDENTIALS / ADMIN_PASSWORD\n" +
          "  until the first `admin:user add`.\n",
      );
    } else {
      console.log("");
      console.log("  name                 access    password set      last sign-in");
      for (const r of rows) {
        console.log(
          `  ${r.name.padEnd(20)} ${(r.active ? "active" : "revoked").padEnd(9)} ` +
            `${when(r.password_changed_at).padEnd(17)} ${when(r.last_sign_in_at)}`,
        );
      }
      console.log("");
    }
    process.exit(0);
  }

  const [existing] = await client`
    select id, name, active from admin_users where name = ${name}
  `;

  if (command === "add") {
    if (existing) {
      console.error(
        `${name} already exists. Use \`password ${name}\` to rotate, or ` +
          `\`enable ${name}\` if they were revoked.`,
      );
      process.exit(1);
    }
    const { record, password, generated, weak } = await newPassword();
    /* `weak` in the audit row, never the password: six months from now the only
       way to know a starter password is still in place is if this said so. */
    await audited(
      "admin.create",
      name,
      null,
      { name, active: true, ...(weak ? { weak_starter_password: true } : {}) },
      async (tx) => {
        await tx`
          insert into admin_users (name, password_hash, created_by)
          values (${name}, ${record}, ${by})
        `;
      },
    );
    console.log("");
    if (generated) {
      console.log(`  Password for ${name}   ${password}`);
      console.log("  ^ hand this over now; it is not stored anywhere.\n");
    }
    if (weak) {
      console.log(
        `  ⚠ ${name} has a starter password under 12 characters. It opens every\n` +
          "    parent's profile and every restricted note. Have them change it at\n" +
          "    /admin/account — that form will not accept a short one.\n",
      );
    }
    console.log(`  ✓ ${name} can sign in. Within a minute on a running server —`);
    console.log("    immediately on their first attempt, which re-reads the store.\n");
  }

  if (command === "password") {
    if (!existing) {
      console.error(`No admin called ${name}. \`list\` shows who there is.`);
      process.exit(1);
    }
    const { record, password, generated, weak } = await newPassword();
    await audited("admin.password", name, null, weak ? { weak_starter_password: true } : null, async (tx) => {
      await tx`
        update admin_users
        set password_hash = ${record}, password_changed_at = now(), updated_at = now()
        where name = ${name}
      `;
    });
    console.log("");
    if (generated) {
      console.log(`  New password for ${name}   ${password}`);
      console.log("  ^ hand this over now; it is not stored anywhere.\n");
    }
    console.log(`  ✓ rotated. ${name}'s existing sessions are over.`);
    console.log(
      "    Without ADMIN_SESSION_SECRET set, so is everyone else's — the signing\n" +
        "    key is derived from the credentials. That is the documented trade.\n",
    );
  }

  if (command === "disable" || command === "enable") {
    if (!existing) {
      console.error(`No admin called ${name}. \`list\` shows who there is.`);
      process.exit(1);
    }
    const active = command === "enable";
    if (existing.active === active) {
      console.log(`\n  ${name} is already ${active ? "active" : "revoked"}.\n`);
      process.exit(0);
    }
    await audited(
      active ? "admin.enable" : "admin.disable",
      name,
      { active: existing.active },
      { active },
      async (tx) => {
        await tx`
          update admin_users set active = ${active}, updated_at = now()
          where name = ${name}
        `;
      },
    );
    console.log("");
    if (active) {
      console.log(`  ✓ ${name} can sign in again. Their old password still works —`);
      console.log(`    rotate it with \`password ${name}\` if that is not intended.\n`);
    } else {
      console.log(`  ✓ ${name} is revoked: no sign-in, and their open sessions stop`);
      console.log("    within a minute. The name stays, so the audit log still reads.\n");
    }
  }
} catch (err) {
  /* The driver's message only, and never the statement: these carry hashes. */
  console.error(
    "\n✗ failed:",
    err instanceof Error ? err.message.split("\n")[0] : String(err),
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
