-- ═══════════════════════════════════════════════════════════════════════════
-- Pando — reference data
--
-- ⚠️ The taxonomy below is a PLACEHOLDER, generated from web/lib/market-options.ts,
-- which is itself a stand-in until Janet's CSV of Pasadena preschools, daycares
-- and neighborhoods arrives (spec §23.2, open question 10). Replacing it is a
-- `market_options` import, not a code change.
--
-- The weights and freshness thresholds are NOT placeholders: they come from the
-- spec (§7.1, §18.1) and are meant to be edited here rather than in code, because
-- both are resolved at query time.
-- ═══════════════════════════════════════════════════════════════════════════

-- Spec §7.1 — affinity signal weights. Resolved from this table at query time, so
-- a change needs no backfill (the §8.1 vs §18.1 conflict, settled in CLAUDE.md).
insert into affinity_weights (affinity_type, weight) values
  ('school', 5),
  ('activity', 4),
  ('neighborhood', 3),
  ('social_group', 3),
  ('faith_community', 3),
  ('age_range', 2),
  ('adjacent_neighborhood', 1)
on conflict (affinity_type) do update set weight = excluded.weight;

-- Freshness per category: camps are seasonal, playgrounds are not. Janet changes
-- these without a deploy (v3.2 freshness pings).
insert into freshness_policy (kind, ageing_days, stale_days) values
  ('activity',  90, 120),
  ('caregiver', 120, 180),
  ('place',     180, 365),
  ('tip',       180, 365)
on conflict (kind) do update set
  ageing_days = excluded.ageing_days, stale_days = excluded.stale_days;

-- ── market_options — Pasadena (placeholder) ───────────────────────────────
insert into market_options (market_id, category, option_value, label, bands) values
  ('pasadena', 'neighborhoods', 'bungalow-heaven', 'Bungalow Heaven', null),
  ('pasadena', 'neighborhoods', 'madison-heights', 'Madison Heights', null),
  ('pasadena', 'neighborhoods', 'san-rafael', 'San Rafael', null),
  ('pasadena', 'neighborhoods', 'linda-vista', 'Linda Vista', null),
  ('pasadena', 'neighborhoods', 'hastings-ranch', 'Hastings Ranch', null),
  ('pasadena', 'neighborhoods', 'playhouse-district', 'Playhouse District', null),
  ('pasadena', 'neighborhoods', 'old-pasadena', 'Old Pasadena', null),
  ('pasadena', 'neighborhoods', 'east-pasadena', 'East Pasadena', null),
  ('pasadena', 'neighborhoods', 'northwest-pasadena', 'Northwest Pasadena', null),
  ('pasadena', 'neighborhoods', 'altadena', 'Altadena', null),
  ('pasadena', 'neighborhoods', 'south-pasadena', 'South Pasadena', null),
  ('pasadena', 'neighborhoods', 'san-marino', 'San Marino', null),
  ('pasadena', 'neighborhoods', 'sierra-madre', 'Sierra Madre', null),
  ('pasadena', 'neighborhoods', 'la-canada', 'La Cañada Flintridge', null),
  ('pasadena', 'neighborhoods', 'eagle-rock', 'Eagle Rock', null),
  ('pasadena', 'neighborhoods', 'arcadia', 'Arcadia', null),
  ('pasadena', 'neighborhoods', 'monrovia', 'Monrovia', null),
  ('pasadena', 'neighborhoods', 'temple-city', 'Temple City', null),
  ('pasadena', 'neighborhoods', 'alhambra', 'Alhambra', null),
  ('pasadena', 'neighborhoods', 'glendale', 'Glendale', null),
  ('pasadena', 'schools', 'neighborhood-church-preschool', 'Neighborhood Church Preschool', array['toddler', 'preschool']::text[]),
  ('pasadena', 'schools', 'the-growing-place', 'The Growing Place', array['toddler', 'preschool']::text[]),
  ('pasadena', 'schools', 'pasadena-waldorf', 'Pasadena Waldorf School', array['preschool', 'grade', 'tween']::text[]),
  ('pasadena', 'schools', 'little-flower-montessori', 'Little Flower Montessori', array['toddler', 'preschool']::text[]),
  ('pasadena', 'schools', 'walden-school', 'Walden School', array['preschool', 'grade']::text[]),
  ('pasadena', 'schools', 'don-benito', 'Don Benito Fundamental', array['grade']::text[]),
  ('pasadena', 'schools', 'field-elementary', 'Field Elementary', array['grade']::text[]),
  ('pasadena', 'schools', 'willard-elementary', 'Willard Elementary', array['grade']::text[]),
  ('pasadena', 'schools', 'sierra-madre-elementary', 'Sierra Madre Elementary', array['grade']::text[]),
  ('pasadena', 'schools', 'san-rafael-elementary', 'San Rafael Elementary', array['grade']::text[]),
  ('pasadena', 'schools', 'arroyo-seco-magnet', 'Arroyo Seco Museum Science Magnet', array['grade']::text[]),
  ('pasadena', 'schools', 'polytechnic', 'Polytechnic School', array['preschool', 'grade', 'tween', 'teen']::text[]),
  ('pasadena', 'schools', 'westridge', 'Westridge School', array['grade', 'tween', 'teen']::text[]),
  ('pasadena', 'schools', 'mayfield-junior', 'Mayfield Junior School', array['grade', 'tween']::text[]),
  ('pasadena', 'schools', 'chandler-school', 'Chandler School', array['grade', 'tween']::text[]),
  ('pasadena', 'schools', 'sequoyah-school', 'Sequoyah School', array['grade', 'tween', 'teen']::text[]),
  ('pasadena', 'schools', 'sierra-madre-middle', 'Sierra Madre Middle School', array['tween']::text[]),
  ('pasadena', 'schools', 'mccarthy-blair', 'Blair Middle & High', array['tween', 'teen']::text[]),
  ('pasadena', 'schools', 'pasadena-high', 'Pasadena High School', array['teen']::text[]),
  ('pasadena', 'schools', 'marshall-fundamental', 'Marshall Fundamental', array['tween', 'teen']::text[]),
  ('pasadena', 'worship', 'all-saints', 'All Saints Church', null),
  ('pasadena', 'worship', 'lake-avenue', 'Lake Avenue Church', null),
  ('pasadena', 'worship', 'pasadena-presbyterian', 'Pasadena Presbyterian', null),
  ('pasadena', 'worship', 'neighborhood-uu', 'Neighborhood Unitarian Universalist', null),
  ('pasadena', 'worship', 'st-andrew', 'St. Andrew Catholic Church', null),
  ('pasadena', 'worship', 'throop-church', 'Throop Church', null),
  ('pasadena', 'worship', 'temple-beth-israel', 'Temple Beth Israel', null),
  ('pasadena', 'worship', 'islamic-center-sgv', 'Islamic Center of the SGV', null),
  ('pasadena', 'worship', 'first-ame', 'First AME Pasadena', null),
  ('pasadena', 'clubs', 'altadena-town-country', 'Altadena Town & Country Club', null),
  ('pasadena', 'clubs', 'annandale', 'Annandale Golf Club', null),
  ('pasadena', 'clubs', 'oakmont', 'Oakmont Country Club', null),
  ('pasadena', 'clubs', 'pasadena-ymca', 'Pasadena YMCA', null),
  ('pasadena', 'clubs', 'rose-bowl-aquatics', 'Rose Bowl Aquatics Center', null),
  ('pasadena', 'clubs', 'caltech-y', 'Caltech Y family programs', null),
  ('pasadena', 'clubs', 'la-canada-country-club', 'La Cañada Country Club', null),
  ('pasadena', 'clubs', 'pasadena-tennis-club', 'Pasadena Tennis Club', null),
  ('pasadena', 'parent_groups', 'school-pta', 'Our school PTA / parent association', null),
  ('pasadena', 'parent_groups', 'pasadena-moms-fb', 'Pasadena Moms (Facebook)', null),
  ('pasadena', 'parent_groups', 'sgv-parents-whatsapp', 'SGV Parents (WhatsApp)', null),
  ('pasadena', 'parent_groups', 'neighborhood-parents-chat', 'Neighborhood parents group chat', null),
  ('pasadena', 'parent_groups', 'mops', 'MOPS group', null),
  ('pasadena', 'parent_groups', 'coop-preschool-parents', 'Co-op preschool parents', null),
  ('pasadena', 'parent_groups', 'nextdoor-parents', 'Nextdoor parents thread', null),
  ('pasadena', 'parent_groups', 'twin-multiples-group', 'Twins & multiples group', null),
  ('pasadena', 'baby_activities', 'little-maestros', 'Little Maestros', array['baby', 'toddler', 'preschool']::text[]),
  ('pasadena', 'baby_activities', 'music-together', 'Music Together', array['baby', 'toddler', 'preschool']::text[]),
  ('pasadena', 'baby_activities', 'gymboree', 'Gymboree Play & Music', array['baby', 'toddler']::text[]),
  ('pasadena', 'baby_activities', 'the-little-gym', 'The Little Gym', array['toddler', 'preschool', 'grade']::text[]),
  ('pasadena', 'baby_activities', 'library-storytime', 'Library storytime', array['baby', 'toddler', 'preschool']::text[]),
  ('pasadena', 'baby_activities', 'kidspace-classes', 'Kidspace Museum classes', array['toddler', 'preschool', 'grade']::text[]),
  ('pasadena', 'baby_activities', 'rba-parent-and-me', 'Rose Bowl Aquatics parent & me', array['baby', 'toddler']::text[]),
  ('pasadena', 'baby_activities', 'swim-lessons', 'Swim lessons', array['toddler', 'preschool', 'grade']::text[]),
  ('pasadena', 'baby_activities', 'pasadena-dance-theatre', 'Pasadena Dance Theatre', array['preschool', 'grade', 'tween']::text[]),
  ('pasadena', 'baby_activities', 'ayso-soccer', 'AYSO soccer', array['preschool', 'grade', 'tween']::text[]),
  ('pasadena', 'baby_activities', 'sgv-little-league', 'Little League', array['grade', 'tween']::text[]),
  ('pasadena', 'baby_activities', 'martial-arts', 'Martial arts / taekwondo', array['preschool', 'grade', 'tween']::text[]),
  ('pasadena', 'baby_activities', 'pasadena-conservatory', 'Pasadena Conservatory of Music', array['preschool', 'grade', 'tween', 'teen']::text[]),
  ('pasadena', 'baby_activities', 'youth-symphony', 'Pasadena Youth Symphony', array['tween', 'teen']::text[]),
  ('pasadena', 'baby_activities', 'ice-skating-center', 'Pasadena Ice Skating Center', array['grade', 'tween', 'teen']::text[]),
  ('pasadena', 'baby_activities', 'robotics-club', 'Robotics / STEM club', array['grade', 'tween', 'teen']::text[]),
  ('pasadena', 'baby_activities', 'tutoring-center', 'Tutoring center', array['grade', 'tween', 'teen']::text[]),
  ('pasadena', 'baby_activities', 'kids-yoga', 'Kids yoga', array['toddler', 'preschool', 'grade']::text[]),
  -- `camps` — its own category since spec v3.2 (§8.4, §15.3), not a flavour of
  -- baby_activities. Camp season is decided months before it starts, so the list
  -- has to exist well before the questions it answers arrive.
  ('pasadena', 'camps', 'tom-sawyer-camps', 'Tom Sawyer Camps', array['preschool', 'grade', 'tween']::text[]),
  ('pasadena', 'camps', 'kidspace-summer-camp', 'Kidspace summer camp', array['preschool', 'grade']::text[]),
  ('pasadena', 'camps', 'rba-summer-camp', 'Rose Bowl Aquatics summer camp', array['grade', 'tween']::text[]),
  ('pasadena', 'camps', 'ymca-day-camp', 'Pasadena YMCA day camp', array['preschool', 'grade', 'tween']::text[]),
  ('pasadena', 'camps', 'armory-art-camp', 'Armory Center art camp', array['preschool', 'grade', 'tween']::text[]),
  ('pasadena', 'camps', 'descanso-nature-camp', 'Descanso Gardens nature camp', array['preschool', 'grade']::text[]),
  ('pasadena', 'camps', 'conservatory-summer', 'Pasadena Conservatory summer program', array['grade', 'tween', 'teen']::text[]),
  ('pasadena', 'camps', 'school-break-camp', 'Our school''s break camp', array['preschool', 'grade', 'tween']::text[]),
  ('pasadena', 'camps', 'sports-skills-camp', 'Sports skills camp', array['grade', 'tween']::text[]),
  ('pasadena', 'camps', 'stem-coding-camp', 'STEM / coding camp', array['grade', 'tween', 'teen']::text[]),
  ('pasadena', 'camps', 'theatre-camp', 'Theatre camp', array['grade', 'tween', 'teen']::text[]),
  ('pasadena', 'camps', 'sleepaway-camp', 'Sleepaway camp', array['tween', 'teen']::text[]),
  -- `focus` — the seventh category in QC Answers Q10 and spec §15.3, and the one
  -- that was missing here. It is not a place: it is what a parent is willing to be
  -- asked about, which is what routes a question to them rather than to whoever
  -- happens to live nearby.
  --
  -- The ids are the same strings as TOPICS_LOCAL / TOPICS_LIVED in
  -- web/lib/questions.ts, and they have to stay that way: `people.topic_preferences`
  -- stores exactly these, so a mismatch means a parent who volunteered for camps
  -- never receives a camps question. The questionnaire still reads from code; this
  -- table is what an admin promotes an "other" answer *into*, and what the next
  -- market gets seeded from instead of a code change.
  ('pasadena', 'focus', 'activities', 'Activities', null),
  ('pasadena', 'focus', 'preschools_schools', 'Preschools & schools', null),
  ('pasadena', 'focus', 'camps', 'Camps', null),
  ('pasadena', 'focus', 'babysitters', 'Babysitters', null),
  ('pasadena', 'focus', 'nannies', 'Nannies', null),
  ('pasadena', 'focus', 'newborn_care', 'Newborn care', null),
  ('pasadena', 'focus', 'special_needs_resources', 'Special-needs resources', null),
  ('pasadena', 'focus', 'working_parent_logistics', 'Working-parent logistics', null),
  ('pasadena', 'focus', 'outings', 'Outings', null),
  ('pasadena', 'focus', 'sports', 'Sports', null),
  ('pasadena', 'focus', 'arts_music', 'Arts & music', null),
  ('pasadena', 'focus', 'pediatric_health', 'Pediatric / health recommendations', null),
  ('pasadena', 'focus', 'new_to_area_help', 'New-to-area help', null)
on conflict (market_id, category, option_value) do update set
  label = excluded.label, bands = excluded.bands, active = true;
