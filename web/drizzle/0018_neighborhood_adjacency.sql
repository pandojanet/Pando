-- 6.3 — the adjacent-neighborhood credit.
--
-- `affinity_weights` has carried `adjacent_neighborhood: 1` since the baseline and
-- `social_affinities` holds zero rows of that type, because there was nowhere to
-- read adjacency from. This is that place.
--
-- ## Why a table and not a derived distance
--
-- Pando holds no coordinates. A neighborhood is an option id the parent tapped,
-- and "next door" in the San Gabriel Valley is a local fact — Altadena and
-- Pasadena touch, Altadena and Alhambra do not, and no string comparison knows
-- that. The client's own area list is the vocabulary, so adjacency is data an
-- admin can correct, exactly like `affinity_weights`.
--
-- ## The two rules the shape enforces
--
-- **Symmetric, stored once.** Adjacency has no direction: if Altadena is next to
-- Pasadena then Pasadena is next to Altadena. Storing both rows invites the pair
-- to disagree, so the CHECK forces `a < b` and every read has to look both ways.
-- The `pair` name is deliberate — nothing here is "from" or "to".
--
-- **Never adjacent to itself.** The same-neighborhood credit is weight 3 and the
-- adjacent credit is 1; a self-row would hand the same parent both, which is the
-- double-count 6.3's own description warns about ("without double-counting the
-- same-neighborhood credit").
CREATE TABLE IF NOT EXISTS neighborhood_adjacency (
  market_id text NOT NULL DEFAULT 'pasadena',
  area_a    text NOT NULL,
  area_b    text NOT NULL,
  PRIMARY KEY (market_id, area_a, area_b),
  CONSTRAINT neighborhood_adjacency_ordered_check CHECK (area_a < area_b)
);--> statement-breakpoint

COMMENT ON TABLE neighborhood_adjacency IS
  'Which areas touch, as option ids from market_options.neighborhoods. Symmetric and stored once (area_a < area_b), so a read must check both columns. Never a self-pair: the same-neighborhood credit is separate and larger.';--> statement-breakpoint

-- Pasadena market. Pairs are the ones that actually share a border on the ground;
-- the ids are `market_options` neighborhood values, so a typo here is a pair that
-- silently never matches — which is the `area_slug` lesson from 0017.
INSERT INTO neighborhood_adjacency (market_id, area_a, area_b) VALUES
  ('pasadena', 'altadena',              'pasadena'),
  ('pasadena', 'altadena',              'la-canada-flintridge'),
  ('pasadena', 'altadena',              'sierra-madre'),
  ('pasadena', 'pasadena',              'south-pasadena'),
  ('pasadena', 'pasadena',              'san-marino'),
  ('pasadena', 'pasadena',              'sierra-madre'),
  ('pasadena', 'eagle-rock',            'pasadena'),
  ('pasadena', 'la-canada-flintridge',  'pasadena'),
  ('pasadena', 'glendale',              'la-canada-flintridge'),
  ('pasadena', 'eagle-rock',            'glendale'),
  ('pasadena', 'glendale',              'highland-park'),
  ('pasadena', 'eagle-rock',            'highland-park'),
  ('pasadena', 'highland-park',         'south-pasadena'),
  ('pasadena', 'san-marino',            'south-pasadena'),
  ('pasadena', 'alhambra',              'south-pasadena'),
  ('pasadena', 'alhambra',              'san-marino'),
  ('pasadena', 'alhambra',              'san-gabriel'),
  ('pasadena', 'alhambra',              'monterey-park'),
  ('pasadena', 'monterey-park',         'san-gabriel'),
  ('pasadena', 'san-gabriel',           'san-marino'),
  ('pasadena', 'san-gabriel',           'temple-city'),
  ('pasadena', 'rosemead',              'san-gabriel'),
  ('pasadena', 'monterey-park',         'rosemead'),
  ('pasadena', 'rosemead',              'temple-city'),
  ('pasadena', 'arcadia',               'temple-city'),
  ('pasadena', 'arcadia',               'sierra-madre'),
  ('pasadena', 'arcadia',               'monrovia'),
  ('pasadena', 'monrovia',              'sierra-madre'),
  ('pasadena', 'duarte',                'monrovia')
ON CONFLICT DO NOTHING;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS neighborhood_adjacency_b_idx
  ON neighborhood_adjacency (market_id, area_b);
