/**
 * Item 5's autopopulate (client, 24 Aug): *"we need a field for other, where they
 * can type and it should autopopulate with other towns/neighborhoods. Can we do
 * the autopopulate?"*
 *
 *   npm run seed:neighborhoods
 *
 * Yes — and the mechanism already existed. Her seventeen cities stay the tap
 * list (`starter = true`); everything else a Pasadena-area family might name
 * becomes searchable behind "Other nearby area", through the same endpoint the
 * schools and clubs use.
 *
 * **The nine intra-Pasadena neighbourhoods retired on 24 Aug come back here**, as
 * non-starters. That is better than retiring them outright: her list is cities, so
 * a Bungalow Heaven parent should pick Pasadena — but they should also be able to
 * *find* Bungalow Heaven if that is how they think of where they live, which is
 * exactly what "autopopulate with other towns/neighborhoods" describes. Their
 * stored answers keep resolving either way.
 *
 * Re-runnable: every row is an upsert, and `starter` is set explicitly both ways
 * so re-running cannot promote a searchable town into the suggestion list.
 */
import { existsSync } from "node:fs";
import postgres from "postgres";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const STARTERS = [
  "Pasadena","Alhambra","Altadena","Arcadia","Duarte","Eagle Rock","Glendale",
  "Highland Park","La Cañada Flintridge","Monrovia","Monterey Park","Rosemead",
  "San Gabriel","San Marino","Sierra Madre","South Pasadena","Temple City",
];

/* Searchable but not suggested: Pasadena's own neighbourhoods, plus the towns
   families actually cross into. */
const MORE = [
  ["Bungalow Heaven","Pasadena"],["Madison Heights","Pasadena"],["San Rafael","Pasadena"],
  ["Linda Vista","Pasadena"],["Hastings Ranch","Pasadena"],["Playhouse District","Pasadena"],
  ["Old Pasadena","Pasadena"],["East Pasadena","Pasadena"],["Northwest Pasadena","Pasadena"],
  ["Garfield Heights","Pasadena"],["Orange Heights","Pasadena"],["Daisy-Villa","Pasadena"],
  ["Chapman Woods","Pasadena"],["Caltech area","Pasadena"],
  ["La Crescenta",null],["Montrose",null],["Tujunga",null],["Sunland",null],
  ["Burbank",null],["Silver Lake",null],["Los Feliz",null],["Atwater Village",null],
  ["Mount Washington",null],["Glassell Park",null],["Echo Park",null],
  ["Downtown Los Angeles",null],["Boyle Heights",null],["El Sereno",null],
  ["Alhambra Hills",null],["San Marino Heights",null],["Bradbury",null],
  ["Azusa",null],["Baldwin Park",null],["Covina",null],["Glendora",null],
  ["West Covina",null],["Claremont",null],["La Verne",null],["Whittier",null],
  ["Pico Rivera",null],["Montebello",null],["Commerce",null],["Downey",null],
  ["Irwindale",null],["Industry",null],["Walnut",null],["Diamond Bar",null],
  ["Hacienda Heights",null],["Rowland Heights",null],["La Puente",null],
  ["El Monte",null],["South El Monte",null],["Rosemead Heights",null],
  ["San Dimas",null],["Pomona",null],["Altadena Foothills","Altadena"],
  ["Lincoln Heights",null],["Cypress Park",null],["Highland Park Hills",null],
  ["La Cañada",null],["Flintridge",null],["Verdugo Woodlands",null],
];

const slug = (v) => v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
  .replace(/[’']/g,"").replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    for (const label of STARTERS) {
      await tx`insert into market_options
        (market_id, category, option_value, label, area, entity_type, starter, status, active)
        values ('pasadena','neighborhoods',${slug(label)},${label},${label},'City',true,'active',true)
        on conflict (market_id, category, option_value) do update set
          label = excluded.label, area = excluded.area, entity_type = excluded.entity_type,
          starter = true, status = 'active', active = true`;
    }
    for (const [label, within] of MORE) {
      await tx`insert into market_options
        (market_id, category, option_value, label, area, entity_type, starter, status, active)
        values ('pasadena','neighborhoods',${slug(label)},${label},${within ?? label},
                ${within ? "Neighborhood" : "City"}, false,'active',true)
        on conflict (market_id, category, option_value) do update set
          label = excluded.label, area = excluded.area, entity_type = excluded.entity_type,
          starter = false, status = 'active', active = true`;
    }
  });
  const [{ s, n }] = await sql`
    select count(*) filter (where starter)::int as s, count(*)::int as n
      from market_options where market_id='pasadena' and category='neighborhoods' and active`;
  console.log(`✓ ${s} suggested, ${n} searchable in total`);
} finally { await sql.end(); }
