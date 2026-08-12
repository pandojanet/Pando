/**
 * Generates an `ADMIN_CREDENTIALS` record for one admin — the **bootstrap** path.
 *
 * Prefer `npm run admin:user -- add <name>`, which writes the same scrypt record
 * into `admin_users` and needs no redeploy to add, rotate or revoke. This one is
 * for the case that table cannot answer yet: no database configured, or the
 * deployment that is about to create it.
 *
 *   npm run admin:credential -- janet              # invents a strong passphrase
 *   npm run admin:credential -- janet --stdin      # reads the password from stdin
 *
 * Prints the record to paste into the env, and — only when it generated one — the
 * password to hand over. The password is never written to a file: if it scrolls
 * away, generate another record.
 *
 * The scrypt cost is embedded in each record, so this script and
 * `lib/admin/auth.ts` cannot drift apart: whatever cost is written here is the
 * cost the verifier uses for that record.
 */

import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const COST = { N: 65536, r: 8, p: 1, keylen: 32 };
const MAXMEM = 256 * 1024 * 1024;

const args = process.argv.slice(2);
const fromStdin = args.includes("--stdin");
const name = args.find((a) => !a.startsWith("--"));

if (!name) {
  console.error(
    "Usage: npm run admin:credential -- <name> [--stdin]\n\n" +
      "  <name>    how this person is named in the audit log, e.g. janet\n" +
      "  --stdin   read the password from stdin instead of generating one",
  );
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
  console.error(
    `"${name}" won't do as a name. Use letters, digits, dot, underscore or hyphen —\n` +
      "no commas or colons, because those separate the records.",
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

const generated = !fromStdin;
const password = fromStdin ? await readStdin() : generatePassphrase();

if (password === "") {
  console.error("No password on stdin — nothing to hash.");
  process.exit(1);
}
if (password.length < 12) {
  console.error(
    `That password is ${password.length} characters. The admin holds every parent's\n` +
      "profile and every restricted note; use at least 12.",
  );
  process.exit(1);
}

const salt = randomBytes(16);
const hash = await scrypt(password, salt, COST.keylen, { ...COST, maxmem: MAXMEM });
const record = [
  name,
  "scrypt",
  COST.N,
  COST.r,
  COST.p,
  salt.toString("base64url"),
  hash.toString("base64url"),
].join(":");

console.log("");
if (generated) {
  console.log(`  Password for ${name}   ${password}`);
  console.log("  ^ hand this over now; it is not stored anywhere.\n");
}
console.log("  Add to ADMIN_CREDENTIALS (comma-separated, one record per person):\n");
console.log(`${record}\n`);
console.log(
  "  Then remove ADMIN_PASSWORD and ADMIN_USERS — while they are set the old\n" +
    "  shared-password mode stays available as a fallback.\n",
);
console.log(
  "  With a database configured, `npm run admin:user -- add " +
    name +
    "` is the better\n" +
    "  move: same hash, in `admin_users`, where revoking it later is one command\n" +
    "  rather than a redeploy. A populated table ignores this variable entirely.\n",
);
