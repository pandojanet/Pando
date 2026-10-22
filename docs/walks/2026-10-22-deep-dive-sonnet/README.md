# Deep Dive on Sonnet 5.5 — text simulation, 22 Oct

Real: the deep web search (Sonnet 5.5, `web_search_20260209`), the draft (Sonnet 5.5) with `proseVerdict` and its one retry, the merge, the ranking and the render — the production modules, called directly. Not real: the parents' records (synthetic, below each case), drive distances (a fixed table instead of the geocoder), and nothing was stored or sent. Run at 12:39 from `scratchpad/sim/run.mts` of session 10168cc2; the web search changed after it — see the last section.

## preschool

**Question:** what are the best preschools near Pasadena for a shy 4 year old?  
**Family:** {"children":"a 4 year old","home":"Altadena","travel_time":"under_20_min","budget":"prioritize_value","logistics":["working_parent_hours"]}

| web found / kept | merged with a parent record | shown | reasons kept | refusals left | search | draft | cost | chars | segments |
|---|---|---|---|---|---|---|---|---|---|
| 8 / 8 | Pasadena Waldorf School | 5 | 8 | 0 | 36.5 s | 7.2 s | $0.21 | 4054 | 9+9+10 (gsm7) |

Calls: claude-sonnet-5-5 end_turn 36.5s 6 searches · claude-sonnet-5-5 end_turn 7.2s 0 searches

What the parent would receive:

```text
(1/3) Here's your deep dive: what are the best preschools near Pasadena for a shy 4 year old?
I weighed it for your 4 year old near Altadena: within 20 min, good value for the money, early drop-off or late pickup.
I looked for places close to Altadena with early drop-off or late pickup, and I checked each one's ages and cost. Value mattered too.
I looked at 8 options: 2 that parents near you have used and 6 with Public/general information.
At a glance:
1. Walden School - 1 parent near you, about 15 min
2. Pasadena Waldorf School - 2 parents near you, your area
3. Firehouse School - Public/general information, your area
4. Hart Preschool - Public/general information, about 15 min
5. Discovery Days Preschool - Public/general information, about 15 min

1) Walden School, Pasadena (about 15 min)
One parent near you has used it, last confirmed Aug 2026.
A parent said: "The teachers noticed my son was shy and paired him with a buddy."
Tip: Ask about the extended day program.
Value for money: good value.
Why it could work for you: It is a 15 minute drive, inside your 20 minute limit, and Pando lists it as good value, which matches your budget goal.
Worth checking: the hours and whether early drop-off or late pickup is offered.

(2/3) 2) Pasadena Waldorf School, Altadena (your area)
2 parents near you have used it, last confirmed Sep 2026.
A parent said: "Lots of outdoor time and a slow, gentle start to each morning."
Good for: Quieter kids who need time to warm up.
Heads up: Tuition is on the high side for preschool.
Parents paid: about $1,500-2,000 a month.
Public/general information: Waldorf preschool and kindergarten. 3-day half day, 5-day half day, or 5-day full day. Play-based preschool curriculum; parent-child classes available; admission includes a faculty interview.
Why it could work for you: It is in Altadena and Pando notes it suits quieter kids who need time to warm up. The cost of about $1,500-2,000 a month is on the high side for value.
Worth checking: whether the 3-day or 5-day half day fits your drop-off needs.

3) Firehouse School, Altadena (your area)
Public/general information: Small-class private preschool. Ages 2 to 4. Mon-Fri 7:00am-6:00pm. Small class sizes; play-based learning with structure; on-site parking.
Why it could work for you: It is in Altadena and its pages list ages 2 to 4, so your 4 year old fits. The day runs 7:00am to 6:00pm, which covers early drop-off or late pickup. Small classes may suit a shy child.
Worth checking: whether a 4 year old can stay on past the oldest age listed.

(3/3) 4) Hart Preschool, Pasadena (about 15 min)
Public/general information: Play-based center preschool. Ages 18 months to 5 years. Mon-Fri 8am-6pm. Pre-K classroom for ages 3.5 to 5; monthly themes; three age-specific classrooms.
Why it could work for you: It is a 15 minute drive and open 8am to 6pm, so late pickup is covered. Its pages list ages 18 months to 5 years, and a classroom for ages 3.5 to 5 fits your 4 year old.
Worth checking: how the older classroom handles a gentle start for a shy child.

5) Discovery Days Preschool, Pasadena (about 15 min)
Public/general information: Reggio-Montessori play-based preschool. Ages 0 to 6. Mon-Fri 7:30am-5:30pm. Spanish immersion program; garden and mud kitchen outdoors; indexed tuition adjustments case-by-case.
Why it could work for you: It is a 15 minute drive and opens at 7:30am, which helps with early drop-off. Its pages mention tuition adjustments case-by-case, which could help with value.
Worth checking: what tuition would be for your schedule and whether an adjustment applies.

Also worth a look (Public/general information): Stratford School (Altadena Allen) (Altadena), Brella Pasadena (Pasadena), Village Playgarden (Arcadia).
My take: I'd start with the Altadena option that runs the longest hours, tour it, and then compare it with the good-value Pasadena school.
Want to hear from a parent who's been? Reply INTRO and the name, like INTRO Walden School.
Drive times are rough estimates. Deep dives are free during the pilot.
```

## camps

**Question:** summer day camps for my 7 year old in Altadena or Pasadena in July  
**Family:** {"children":"a 7 year old","home":"Altadena","travel_time":"under_20_min","budget":"across_price_points","logistics":["working_parent_hours"]}

| web found / kept | merged with a parent record | shown | reasons kept | refusals left | search | draft | cost | chars | segments |
|---|---|---|---|---|---|---|---|---|---|
| 7 / 7 | Kidspace Children's Museum, Pasadena Humane | 5 | 7 | 0 | 80.7 s | 12.8 s | $0.483 | 3925 | 10+8+9 (gsm7) |

Calls: claude-sonnet-5-5 end_turn 35.6s 8 searches · claude-sonnet-5-5 end_turn 45.1s 8 searches · claude-sonnet-5-5 end_turn 6.9s 0 searches · claude-sonnet-5-5 end_turn 5.8s 0 searches

Sentences the checker refused:

- attempt 1, w1.why, **name**: Care before and after the camp day covers early drop-off and late pickup, and it takes grades K-8, so your 7 year old fits. The schedule runs through July.

What the parent would receive:

```text
(1/3) Here's your deep dive: summer day camps for my 7 year old in Altadena or Pasadena in July
I weighed it for your 7 year old near Altadena: within 20 min, a range of prices, early drop-off or late pickup.
I focused on early drop-off or late pickup and a short drive, then checked how well each place's listed ages fit your 7 year old.
I looked at 7 options: 2 that parents near you have used and 5 with Public/general information.
At a glance:
1. Pasadena Humane - 1 parent near you, about 15 min
2. Kidspace Children's Museum - 2 parents near you, about 15 min
3. Camp Galileo at New Horizon School - Public/general information, about 15 min
4. Steve & Kate's Camp Pasadena - Public/general information, about 15 min
5. City of Pasadena Indoor Summer Camps - Public/general information, about 15 min

1) Pasadena Humane, Pasadena (about 15 min)
One parent near you has used it, last confirmed Aug 2026.
A parent said: "Animal-loving kids get real time with the animals."
Good for: Kids 7 and up who love animals.
Public/general information: Animal shelter veterinary camp. Ages 7 to 10. 9am-2pm single-day sessions. Lessons on animal health and vaccines; Case studies and basic treatment plans.
Why it could work for you: The ages start right at 7, so your child is in range. The day runs from 9 to 2, so you would need to cover the edges of the day yourself.
Worth checking: which July dates are offered and whether any care is available outside the session.

(2/3) 2) Kidspace Children's Museum, Pasadena (about 15 min)
2 parents near you have used it, last confirmed Jul 2026.
A parent said: "Hands-on science every day, my daughter came home buzzing."
Heads up: Weeks sell out by April.
Public/general information: Museum nature day camp. Ages 5 to 8. Weekly, June 8 to Aug 7, except week of June 29. Weekly National Park theme; Live animal encounters and water play days; Page says summer camp is sold out.
Why it could work for you: The ages fit your 7 year old, but the camp's own page says summer camp is sold out. It is a short drive away, so it is only worth it if a spot opens.
Worth checking: whether there is a waitlist.

3) Camp Galileo at New Horizon School, Pasadena (about 15 min)
Public/general information: STEAM and outdoor day camp. Grades K-8. Jun 22 to Jul 31, 9am-3pm; care 8-9am and 3-6pm. Different projects each week; Extended care available.
Why it could work for you: The listed care before and after the camp day covers early drop-off and late pickup, and the grades fit a 7 year old. It is a short drive from Altadena.
Worth checking: whether extended care is included or costs extra.

(3/3) 4) Steve & Kate's Camp Pasadena, Pasadena (about 15 min)
Public/general information: Self-directed summer day camp. Ages 4 to 12. Jun 22 to Aug 14, 8am-6pm. Held at Walden School.
Why it could work for you: The long daily hours cover early drop-off and late pickup, and the ages fit your 7 year old well. It runs through July and is a short drive away.
Worth checking: the price and whether you can book single weeks in July.

5) City of Pasadena Indoor Summer Camps, Pasadena (about 15 min)
Public/general information: City recreation indoor camps. Ages 5 to 12. Mon-Fri, July 6 to July 31 session. From $75 a day.
Why it could work for you: This one has a listed price, which helps with your range of prices. The ages fit your 7 year old and a July session is listed.
Worth checking: the daily hours and whether early drop-off or late pickup is offered.

Also worth a look (Public/general information): Anderson Adventure Camp H2O (Pasadena), Camp Adventurewood (Pasadena).
My take: I'd start with the first camp on this list, since its care hours match your drop-off and pickup needs, then compare it with the city camps on price.
Want to hear from a parent who's been? Reply INTRO and the name, like INTRO Pasadena Humane.
Drive times are rough estimates. Deep dives are free during the pilot.
```

## dentist

**Question:** which pediatric dentist near South Pasadena is good with a nervous 3 year old?  
**Family:** {"children":"a 3 year old","home":"South Pasadena","travel_time":"under_20_min","budget":null,"logistics":[]}

| web found / kept | merged with a parent record | shown | reasons kept | refusals left | search | draft | cost | chars | segments |
|---|---|---|---|---|---|---|---|---|---|
| 4 / 4 | — | 4 | 4 | 1 | 38.5 s | 10.6 s | $0.213 | 2417 | 10+6 (gsm7) |

Calls: claude-sonnet-5-5 end_turn 38.5s 8 searches · claude-sonnet-5-5 end_turn 5.6s 0 searches · claude-sonnet-5-5 end_turn 5.0s 0 searches

Sentences the checker refused:

- attempt 1, opening.opening, **name**: Since your 3 year old is nervous, I looked at what each practice says about how it handles little ones. Drive times weren't listed, so I couldn't sort by the 20 minute limit.
- attempt 2, w3.why, **name**: This is a pediatric practice, so a 3 year old fits the basic idea. Nothing listed about its approach or location, so it ranks last for now.

What the parent would receive:

```text
(1/2) Here's your deep dive: which pediatric dentist near South Pasadena is good with a nervous 3 year old?
I weighed it for your 3 year old near South Pasadena: within 20 min.
With a nervous 3 year old, I looked at what each practice says about how it handles little ones, since drive times and ages weren't listed.
I looked at 4 options: 4 with Public/general information.
At a glance:
1. Palm & Poppy Pediatric Dentistry - Public/general information
2. Children's Dental FunZone - Alhambra - Public/general information
3. La Petite Kids Dentist - Public/general information
4. Little Crown Pediatric Dentistry - Public/general information

1) Palm & Poppy Pediatric Dentistry
Public/general information: Pediatric dental practice. Beach-themed open bay; treatment under nitrous oxide offered; explains findings to parents.
Why it could work for you: Its own page mentions an open bay with a beach theme and nitrous oxide if needed, which may help a nervous 3 year old. It also says findings get explained to you.
Worth checking: whether the open bay feels calm for your child and how the nitrous option is used at this age.

2) Children's Dental FunZone - Alhambra, Alhambra
Public/general information: Children's dental practice.
Why it could work for you: This one is in Alhambra, so it is likely a reasonable drive from South Pasadena. Its pages don't say much about nervous little ones, so it is a second look.
Worth checking: the drive time against your 20 minute limit and whether they see a 3 year old.

(2/2) 3) La Petite Kids Dentist
Public/general information: Children's dental practice.
Why it could work for you: It is a children's practice, which suits a 3 year old in general. Its pages list no details about nervous kids or location, so I can't say more yet.
Worth checking: the drive from South Pasadena and how they ease in a nervous first visit.

4) Little Crown Pediatric Dentistry
Public/general information: Pediatric dental practice.
Why it could work for you: This is a pediatric practice, which suits your 3 year old's age group. There are no extra details given on its approach or location.
Worth checking: the drive time and whether a short first visit to just meet the dentist is possible.

My take: I'd start with Palm & Poppy Pediatric Dentistry since it spells out how it eases nerves, then call it to confirm the drive and a gentle first visit.
Deep dives are free during the pilot.
```

## swim

**Question:** weekend swim lessons for a 2 year old in Pasadena  
**Family:** {"children":"a 2 year old","home":"Pasadena","travel_time":"under_10_min","budget":"prioritize_value","logistics":["weekend_friendly"]}

| web found / kept | merged with a parent record | shown | reasons kept | refusals left | search | draft | cost | chars | segments |
|---|---|---|---|---|---|---|---|---|---|
| 6 / 6 | Rose Bowl Aquatics Center | 5 | 2 | 4 | 31.7 s | 11.5 s | $0.246 | 3281 | 10+10+3 (gsm7) |

Calls: claude-sonnet-5-5 end_turn 31.7s 4 searches · claude-sonnet-5-5 end_turn 5.8s 0 searches · claude-sonnet-5-5 end_turn 5.8s 0 searches

Sentences the checker refused:

- attempt 1, p1.why, **claim**: This one lists a Saturday session with a stated price and a parent-and-infant class, so it fits a 2 year old, a weekend slot and your value goal. It is also in Pasadena.
- attempt 1, w2.why, **claim**: It is in Pasadena and lists Saturday hours, with parent viewing areas. Babies from 4 months are welcome, so a 2 year old sits well inside the range.
- attempt 1, w1.why, **claim**: Its Parent & Me class covers 3 to 36 months, which fits your 2 year old now but may run out as your child grows. It is in Pasadena, so the drive should be short.
- attempt 1, w4.why, **number_word**: Lessons happen in your own home pool, so there is no drive at all. This only works if you have a pool, and private lessons may cost more than a group class.
- attempt 1, w5.why, **claim**: It offers private lessons for infants and toddlers, plus a Mom and baby option, and it is based in Pasadena. Private lessons may stretch a value-minded budget.
- attempt 1, opening.opening, **number_word**: I focused on weekend options close to home and on what each place says about toddler ages and its schedule. Value is still hard to judge for most of them, so I flagged what to ask.
- attempt 2, p1.why, **claim**: This is in Pasadena and has a Saturday session with a listed price, so it is easy to judge value. Parent/Infant lessons suit a first class for a 2 year old.
- attempt 2, w2.why, **claim**: Aqua-Tots Swim School Pasadena lists Saturday hours and takes babies from 4 months, so a 2 year old fits. Parent viewing areas could help with a first lesson.
- attempt 2, w1.why, **claim**: Waterworks Aquatics Pasadena lists Parent & Me for 3 to 36 months, which covers your 2 year old. The 6:1 ratio is also listed, and it is in your area.
- attempt 2, w5.why, **claim**: AquaMobile Swim School Pasadena offers private lessons for toddlers, with a parent-and-baby option. That could keep weekend logistics simple, though pricing is not listed.

What the parent would receive:

```text
(1/3) Here's your deep dive: weekend swim lessons for a 2 year old in Pasadena
I weighed it for your 2 year old near Pasadena: within 10 min, good value for the money, weekends.
I looked at which places say they take a 2 year old, then at weekend lessons and how simple each one looks to get to.
I looked at 6 options: 1 that a parent near you has used and 5 with Public/general information.
At a glance:
1. Rose Bowl Aquatics Center - 3 parents near you, your area
2. Aqua-Tots Swim School Pasadena - Public/general information, your area
3. Waterworks Aquatics Pasadena - Public/general information, your area
4. British Swim School at LA Fitness Hastings Ranch - Public/general information
5. AquaMobile Swim School Pasadena - Public/general information, your area

1) Rose Bowl Aquatics Center, Pasadena (your area)
3 parents near you have used it, last confirmed Sep 2026.
A parent said: "The water is genuinely warm, which matters with a toddler."
Good for: Toddlers doing their first parent-and-me class.
Heads up: Parking on a Rose Bowl game day is a nightmare.
Parents paid: about $100-200 a term.
Public/general information: Nonprofit aquatics center lessons. $125 for the Jul 11-Aug 8, 2026 Saturday session. Parent/Infant lessons offered; Two Olympic-size pools and a warm therapy pool.
Why it could work for you: It's in your area.
Worth checking: whether the Saturday session still has room and where to park on a game day.

(2/3) 2) Aqua-Tots Swim School Pasadena, Pasadena (your area)
Public/general information: Indoor swim school. Babies from 4 months. Sat 9am-2:15pm; Sunday closed; Wed 2-8pm, Thu-Fri 10am-8pm. Parent viewing areas; Saturday class levels listed online.
Why it could work for you: It's in your area.
Worth checking: which Saturday class levels suit a 2 year old and what they cost.

3) Waterworks Aquatics Pasadena, Pasadena (your area)
Public/general information: Indoor swim school. Parent & Me 3 to 36 months. Parent & Me student-teacher ratio 6:1; Two heated indoor pools.
Why it could work for you: It's in your area.
Worth checking: whether weekend classes are offered and the price.

4) British Swim School at LA Fitness Hastings Ranch
Public/general information: Indoor swim lessons. Ages 3 months to adult. Year-round lessons. Indoor heated pool; Infant classes from 3 months.
Why it could work for you: British Swim School starts infant classes at 3 months and runs year-round, so your 2 year old fits. It is at a gym in Hastings Ranch.
Worth checking: the drive time from your home and the weekend schedule.

5) AquaMobile Swim School Pasadena, Pasadena (your area)
Public/general information: Mobile private swim lessons. Infants and toddlers. Private lessons; Mom and baby lesson option.
Why it could work for you: It's in your area.
Worth checking: the price per lesson and whether weekends are open.

(3/3) Also worth a look (Public/general information): Sunsational Swim School Pasadena (Pasadena).
My take: I'd start with Rose Bowl Aquatics Center since its Saturday session and price are listed, then ask Aqua-Tots about weekend openings for comparison.
Want to hear from a parent who's been? Reply INTRO and the name, like INTRO Rose Bowl Aquatics Center.
Drive times are rough estimates. Deep dives are free during the pilot.
```


---

# After the rework: the writer's own answer (third live run, final code)

Same four questions, same synthetic parents' records, Sonnet 5.5 for the search and the writer, the real modules called directly (no relay, no database, nothing sent). Lines from Pando's records are the ones in the client's wording under a place ("2 parents near you have used it", "A parent said", "Good for", "Heads up", "Parents paid").

## preschool

search 49.5 s · writer 9.8 s · $0.268 · 3495 chars · segments 7+8+9 · sentences removed 0

```text
(1/3) Here's your deep dive: what are the best preschools near Pasadena for a shy 4 year old?
I weighed it for your 4 year old near Altadena: within 20 min, good value for the money, early drop-off or late pickup.
For a shy 4 year old with a 20 minute limit, I weighed hours first since you want early drop-off or late pickup, then age fit and how gentle the setting looks. No page lists prices, so value is hard to judge yet.
I compared 8 places. What each one offers is Public/general information from its own pages; lines about parents near you are from Pando's local parents.

1) Pasadena Montessori School Daycare, Pasadena (about 15 min)
Pasadena Montessori School Daycare is the only place here whose pages show real extended hours: 7am-6pm, or 9am-3pm for the school day, in 3 or 5 day packages. It is about 15 minutes away and takes ages 2 to 9, so a 4 year old fits. Tuition is monthly but no amount is listed, so value is unconfirmed.
Worth checking: what the monthly tuition is for the 7am-6pm option.

(2/3) 2) Pasadena Waldorf School, Altadena (your area)
Pasadena Waldorf School is in your area and offers 3-day half day, 5-day half day, or 5-day full day preschool. Admission includes an application and a faculty interview with two faculty members, which may feel formal for a shy child. A Parent-Child Program is offered. Price, ages and any before or after care are not listed.
Worth checking: whether there is early drop-off or late pickup and what tuition is.
2 parents near you have used it, last confirmed Sep 2026.
A parent said: "Lots of outdoor time and a slow, gentle start to each morning."
Good for: Quieter kids who need time to warm up.
Heads up: Tuition is on the high side for preschool.
Parents paid: about $1,500-2,000 a month.

3) Stratford School Altadena, Altadena (your area)
Stratford School Altadena is a private preschool and Pre-K in your area with full-day and half-day programs. At 4, your child could fit Preschool (2.5 to 4) or Pre-K (4 to 5), so the placement needs a conversation. Extended hours and price are not listed, so I can't speak to value.
Worth checking: which class a 4 year old would join and whether care runs past the program hours.

(3/3) 4) Bridge Montessori - Pasadena, Pasadena (about 15 min)
Bridge Montessori - Pasadena is about 15 minutes away with a preschool class for potty-trained children ages 3 to 5, so your child is in range if that applies. Its pages do not list hours or price, so I can't tell if it meets your drop-off and pickup needs.
Worth checking: the daily hours and tuition.

5) Altadena Nursery School
Altadena Nursery School is a parent cooperative for ages 2 to 5, with a mixed-age setting plus age-based group time. Parents work alongside staff, which can ease a shy child in. Hours are Mon-Fri 9am-12pm, so it does not offer early drop-off or late pickup, and price and drive time are not listed.
Worth checking: the cost and how much parent time is required.

Also used by parents near you: Walden School (Pasadena).
Also worth a look (Public/general information): Princeton Montessori Academy (Altadena), Firehouse Preschool Altadena (Altadena).
My take: I'd start with Pasadena Montessori School Daycare, since it clearly covers the 7am-6pm hours at about 15 minutes away. Then ask Pasadena Waldorf School about hours and cost.
Want to hear from a parent who's been? Reply INTRO and the name, like INTRO Pasadena Waldorf School.
Drive times are rough estimates. Deep dives are free during the pilot.
```

## camps

search 70.3 s · writer 22.5 s · $0.505 · 3332 chars · segments 10+9+4 · sentences removed 1

```text
(1/3) Here's your deep dive: summer day camps for my 7 year old in Altadena or Pasadena in July
I weighed it for your 7 year old near Altadena: within 20 min, a range of prices, early drop-off or late pickup.
For a 7 year old in July, with a 20 minute limit and a need for early drop-off or late pickup, the hours and the July dates carried the most weight. I put places with long days and a clear July run first, and places that say little or end before July lower.
I compared 9 places. What each one offers is Public/general information from its own pages.

1) Pasadena-Sierra Madre YMCA Summer Day Camp, Pasadena (about 15 min)
This YMCA day camp runs Mon-Fri 7:00am-6:00pm from June 8 to August 14, and is closed July 3. It takes ages 4 to 11, so 7 fits, and it's about 15 minutes away. It's the only option with both a stated price ($219 a week for members, $259 for community) and the longest hours, so it's the easiest to plan around.
Worth checking: how the July 3 closure affects your week and what a typical day looks like.

2) Camp Galileo at New Horizon School, Pasadena (about 15 min)
Camp Galileo mixes STEAM projects with outdoor play and changes theme weekly, running June 22 to July 31. The camp day is 9am-3pm, with before care 8-9am and after care 3-6pm, so it covers your logistics, though not as early as the YMCA. Your child would fit in the 2nd-3rd group. About 15 minutes away; price is not listed.
Worth checking: the weekly price and whether the July weeks you want have room.

(2/3) 3) Camp Adventurewood, Pasadena (about 15 min)
Camp Adventurewood is an outdoor Pasadena camp with archery, canoeing, treasure hunts and horseback riding, and a 6:1 camper-to-counselor ratio. That is a good fit for an active kid, and about 15 minutes away. Its pages don't list ages, dates, hours or price, so I can't confirm it fits a 7 year old in July or covers early or late care.
Worth checking: ages, July dates, hours and price.

4) Summerkids Camp, Altadena (your area)
Summerkids is a traditional day camp in Altadena for campers entering grades K-9, so it is right in your area and likely the shortest drive. The page offers tours and calls with the director. It lists no schedule, hours or price, so it ranks below camps with clear July dates and care hours.
Worth checking: July dates, drop-off and pickup times, and price.

5) Steve & Kate's Camp Pasadena, Pasadena (about 15 min)
Steve & Kate's is a self-directed camp where kids choose activities minute to minute, with sports and water games. It takes ages 4 to 12 and runs June 22 to August 14, so July is covered, about 15 minutes away. Hours and price aren't listed, so I can't say whether it meets your drop-off or pickup need.
Worth checking: daily hours, any extended care and the weekly price.

(3/3) Also used by parents near you: Kidspace Children's Museum (Pasadena), Pasadena Humane (Pasadena).
Also worth a look (Public/general information): Descanso Discoveries (Child Educational Center) (La Cañada Flintridge), Armory Center for the Arts Summer Studio (Pasadena).
My take: I'd start with the Pasadena-Sierra Madre YMCA Summer Day Camp: 7:00am-6:00pm hours, a July run, listed weekly prices and about 15 minutes away. Camp Galileo at New Horizon School is my second look.
Drive times are rough estimates. Deep dives are free during the pilot.
```

## dentist

search 47.7 s · writer 9.1 s · $0.267 · 3237 chars · segments 10+9+3 · sentences removed 0

```text
(1/3) Here's your deep dive: which pediatric dentist near South Pasadena is good with a nervous 3 year old?
I weighed it for your 3 year old near South Pasadena: within 20 min.
For a nervous 3 year old, what matters most is how a practice handles worry, and whether it sits inside your 20 minute limit. I leaned toward places that say something concrete about anxious kids and have a known drive, then ranked pages that say little lower.
I compared 7 places. What each one offers is Public/general information from its own pages.

1) Overjoyed Pediatric Dentistry
Overjoyed describes a gentle, child-focused approach for infants, toddlers and children at a first visit. It also publishes a first-visit preparation guide with a book list, which suits a nervous 3 year old since you can practice at home beforehand. Its drive time and hours are not listed, so confirm it fits your 20 minute limit.
Worth checking: whether it is within your 20 minute drive and what its hours are.

2) La Petite Kids Dentist, Pasadena (about 15 min)
La Petite Kids Dentist is in Pasadena, about a 15 minute drive. Its site says treatment varies with the child's age and behavior, and the dentist talks through behavior management methods with parents. That is useful for a nervous 3 year old, and it has a sedation page. Hours and prices are not listed.
Worth checking: which behavior management methods they would use with a 3 year old.

(2/3) 3) Rooted Pediatric Dentistry, Pasadena (about 15 min)
Rooted Pediatric Dentistry is in Pasadena, about 15 minutes away, with board-certified pediatric dentists. It lists sedation from laughing gas to deep sedation and takes first visits through older childhood. That range is reassuring if a first visit goes badly, though its page says less about gentle, non-sedated approaches than La Petite or Overjoyed.
Worth checking: whether they start with a calm, no-sedation visit for a 3 year old.

4) Pasadena Children's Dentistry & Orthodontics, Pasadena (about 15 min)
Pasadena Children's Dentistry & Orthodontics is about 15 minutes away, with board-certified pediatric dentists and sedation dentistry. It is open Mon-Fri 9am-6pm, which helps with later pickups, and it accepts PPO, HMO and Medi-Cal/Denti-Cal. Its page says nothing specific about handling anxious toddlers.
Worth checking: how they approach a nervous young child before sedation.

5) Little Crown Pediatric Dentistry (Fair Oaks Ave)
Little Crown Pediatric Dentistry offers nitrous oxide and sedation for children who are anxious about treatment. It is open Mon 8am-4:30pm, Tue-Thu 8am-5pm and Fri 8am-4:30pm. Its drive time is not listed, so I can't say it fits your 20 minute limit. It also does orthodontics, which matters little at age 3.
Worth checking: the drive time from South Pasadena.

(3/3) Also worth a look (Public/general information): South Pasadena Dental Practice - Children's Dentistry, Children's Dental FunZone - Eagle Rock.
My take: I'd start with Overjoyed Pediatric Dentistry for its gentle approach and first-visit guide, after confirming the drive. If it's too far, La Petite Kids Dentist is a 15 minute drive and discusses behavior methods with you.
Drive times are rough estimates. Deep dives are free during the pilot.
```

## swim

search 53 s · writer 17.8 s · $0.373 · 3518 chars · segments 9+8+7 · sentences removed 2

```text
(1/3) Here's your deep dive: weekend swim lessons for a 2 year old in Pasadena
I weighed it for your 2 year old near Pasadena: within 10 min, good value for the money, weekends.
For a 2 year old, the main questions are whether a weekend slot is confirmed, whether it's close, and what you get for the money. I put places with a stated Saturday time and clear price first, then those missing key details.
I compared 7 places. What each one offers is Public/general information from its own pages; lines about parents near you are from Pando's local parents.

1) Rose Bowl Aquatics Center, Pasadena (your area)
Rose Bowl Aquatics Center is in Pasadena and lists a Saturday 10:05-10:35am class in a July 11 to August 8, 2026 session, at $125 a session. It has Parent/Infant and Parent/Preschool levels, which suit a 2 year old. It's the only option with both a weekend time and a price in your area, though the page doesn't say the age ranges or how many weeks the session runs.
Worth checking: which level fits a 2 year old and how many classes the $125 covers.
3 parents near you have used it, last confirmed Sep 2026.
A parent said: "The water is genuinely warm, which matters with a toddler."
Good for: Toddlers doing their first parent-and-me class.
Heads up: Parking on a Rose Bowl game day is a nightmare.
Parents paid: about $100-200 a term.

(2/3) 2) Pasadena-Sierra Madre YMCA
The Pasadena-Sierra Madre YMCA offers Parent & Child lessons for ages 6 to 36 months, Saturdays 1:05-1:35pm in 4-week sessions. A parent is in the pool, and the focus is water safety. The weekend time fits well, but no price or drive estimate is given, so value and your 10 minute limit are unclear.
Worth checking: the session price and the drive from your home.

3) Waterworks Aquatics Pasadena, Pasadena (your area)
Waterworks Aquatics Pasadena is in your area and takes ages 3 months to 36 months in 20-minute Parent & Me classes at a 6:1 ratio. It starts from $116.64 a month for one lesson weekly, and you can start or stop any time, which is flexible. Weekend times aren't listed, so that is the gap against Rose Bowl.
Worth checking: whether it offers weekend class times.

4) Crowell Family YMCA (formerly South Pasadena San Marino
Crowell Family YMCA offers Parent & Child classes for ages 6 months to 3 years, with two levels and 30-minute sessions. A parent is in the pool. Weekend times, price and location relative to you aren't listed, so it's harder to compare than the Pasadena-Sierra Madre YMCA.
Worth checking: weekend class times, price and drive time.

(3/3) 5) British Swim School at LA Fitness Hastings Ranch, Pasadena (east)
British Swim School at LA Fitness Hastings Ranch has an indoor heated pool, year-round lessons and a 4:1 toddler ratio, which is a small group. The price is listed as $189-$499 without saying the unit, and weekend times aren't stated. That makes value hard to judge, and the drive isn't given.
Worth checking: what the $189-$499 covers and whether weekend times exist.

Also worth a look (Public/general information): AquaMobile Swim School Pasadena (Pasadena), Sunsational Swim School Pasadena (Pasadena).
My take: I'd start with Rose Bowl Aquatics Center, since it has a Saturday morning class and a stated price in Pasadena. Keep the Pasadena-Sierra Madre YMCA as a backup once you check its price and drive.
Want to hear from a parent who's been? Reply INTRO and the name, like INTRO Rose Bowl Aquatics Center.
Drive times are rough estimates. Deep dives are free during the pilot.
```


---

# The shape is the question's: top 10, X or Y, is X good for us

## top10: give me the top 10 summer day camps for my 7 year old near Pasadena

9 places detailed · $0.341 · 5202 chars · segments 7+8+9+9+3

```text
(1/5) Here's your deep dive: give me the top 10 summer day camps for my 7 year old near Pasadena
I weighed it for your 7 year old near Altadena: within 20 min, a range of prices, early drop-off or late pickup.
Nine places fit your area, not ten, and I won't pad it. I ranked by age fit for a 7 year old, the 20 minute limit, and how much each page says about full days, since you want early drop-off or late pickup. No page lists prices or extended care.
I compared 9 places. What each one offers is Public/general information from its own pages; lines about parents near you are from Pando's local parents.

1) Summerkids Camp, Altadena (your area)
Summerkids Camp is a traditional outdoor day camp in Altadena, so it should be the shortest trip for you. It takes grades K-9, which covers a 7 year old, and lists swimming, softball, street hockey, volleyball, orienteering and woodworking. It has run more than 45 years. Its pages give no schedule or price, so early drop-off or late pickup is unconfirmed.
Worth checking: hours, session dates, and price.

(2/5) 2) Kidspace Children's Museum, Pasadena (about 15 min)
Kidspace Children's Museum runs weekly camps on its 3.5-acre Pasadena campus, about 15 minutes away. Each camp is five full days, Monday through Friday, with indoor and outdoor activities. It takes ages 5 to 8, so your 7 year old fits, though only for another year or so. Project supplies and a camper t-shirt are included. No price or extended-care hours are listed.
Worth checking: the weekly price and whether early drop-off or late pickup is offered.
2 parents near you have used it, last confirmed Jul 2026.
A parent said: "Hands-on science every day, my daughter came home buzzing."
Heads up: Weeks sell out by April.

3) Steve & Kate's Camp Pasadena, Pasadena (about 15 min)
Steve & Kate's Camp Pasadena is held at Walden School, about 15 minutes away. Kids choose their activities minute to minute, which suits a child who likes freedom more than a set schedule. It takes ages 4 to 12 and offers day passes, which helps with flexibility and with trying a range of budgets. Hours and prices are not listed.
Worth checking: hours, extended care, and day pass price.

(3/5) 4) Camp Galileo at New Horizon School, Pasadena (about 15 min)
Camp Galileo at New Horizon School in Pasadena runs June 22 to July 31, with the day starting at 9am after an all-camp opening ceremony. It splits into three parts, including STEAM projects and outdoor activities, for grades K-8. About 15 minutes away. A 9am start suggests early drop-off may be limited, and pickup time and price are not listed.
Worth checking: pickup time, any extended care, and price.

5) Pasadena Humane, Pasadena (about 15 min)
Pasadena Humane offers single-day sessions on Mondays in summer, with a hands-on veterinary medicine experience, about 15 minutes away. It takes ages 7 to 11, so your child is right at the youngest edge. It works as a one-off add-on rather than full summer coverage. Hours and price are not listed.
Worth checking: session hours and price.
One parent near you has used it, last confirmed Aug 2026.
A parent said: "Animal-loving kids get real time with the animals."
Good for: Kids 7 and up who love animals.

6) Descanso Discoveries (Child Educational Center), La Cañada Flintridge (about 20 min)
It is about 20 minutes away, right at your limit. Your child is at the top of the grade range. Hours and price are not listed.
Worth checking: whether the drive stays within 20 minutes at drop-off time.

(4/5) 7) Eaton Canyon Summer Nature Camp, Pasadena / Altadena
Eaton Canyon Summer Nature Camp is a county park nature camp that explores plants and history, with a camper-to-counselor ratio under 5:1. That is a strong ratio. Its pages give no ages, schedule, price or drive estimate, though the area is Pasadena/Altadena. I can't judge fit until those are confirmed.
Worth checking: ages, dates, hours, and price.

8) Pasadena Playhouse Little Players Summer Camp, Pasadena (about 15 min)
Pasadena Playhouse Little Players is a musical theater camp with animated-classic music and movement and daily games and creative play. It takes ages 5 to 7, so your child is at the top of the range. About 15 minutes away. Schedule and price are not listed. It is the narrowest fit here.
Worth checking: whether a 7 year old is still eligible and the daily hours.

9) South Pasadena San Marino YMCA Day Camp
The South Pasadena San Marino YMCA Day Camp is a summer day camp built around nature exploration, trying new activities and making friends, listed as an ACA camp profile. Its pages give no ages, schedule, price, location or drive estimate, so I can't confirm it is within 20 minutes. YMCAs often offer extended care, but that is not stated here.
Worth checking: drive time, ages, and whether before or after care exists.

(5/5) My take: I'd start with Summerkids Camp since it's in Altadena, then Kidspace Children's Museum for full weekly days. Steve & Kate's Camp Pasadena is a good flexible backup with day passes.
Want to hear from a parent who's been? Reply INTRO and the name, like INTRO Kidspace Children's Museum.
Drive times are rough estimates. Deep dives are free during the pilot.
```

## versus: Kidspace camp or Camp Galileo for my 7 year old this July - which is better for us?

2 places detailed · $0.294 · 2915 chars · segments 9+5+6

```text
(1/3) Here's your deep dive: Kidspace camp or Camp Galileo for my 7 year old this July - which is better for...
I weighed it for your 7 year old near Altadena: within 20 min, a range of prices, early drop-off or late pickup.
Both camps are 15 minutes from Altadena, so the decision comes down to hours and July dates. Neither page lists a price, so I weighed schedule and fit for a 7 year old, and your wish for early drop-off or late pickup carries the most weight.
I compared 5 places. What each one offers is Public/general information from its own pages; lines about parents near you are from Pando's local parents.

1) Camp Galileo Pasadena (New Horizon School), Pasadena (about 15 min)
Camp Galileo mixes STEAM projects, outdoor time and classic camp activities, with a different project each week, at New Horizon School in Pasadena, about 15 minutes away. It takes grades K-8, so a 7 year old fits. The day is 9am to 3pm, with morning care 8-9am and extended care available, which is the closest match to your early drop-off or late pickup need. It runs June 22 to July 31, so July is covered. The price is not listed, and I can't tell you the extended care end time, so confirm both.
Worth checking: the extended care hours and the weekly price, including the care add-on.

(2/3) 2) Kidspace Children's Museum, Pasadena (about 15 min)
Kidspace runs weekly day camps for ages 5-8, so your 7 year old is well inside the range. Each camp is five full days on the museum campus in Pasadena, about 15 minutes away, Mon-Fri 8:45am to 3:00pm. Weeks run June 8 to Aug 7 except the week of June 29, so July has plenty of options. The pages mention no early drop-off or late pickup, which is where it falls behind Galileo for you. Space is limited and the price is not listed.
Worth checking: whether any before or after care exists, and how full your July weeks are.
2 parents near you have used it, last confirmed Jul 2026.
A parent said: "Hands-on science every day, my daughter came home buzzing."
Heads up: Weeks sell out by April.

(3/3) Also worth a look (Public/general information): Steve & Kate's Camp Pasadena (Pasadena), Armory Center for the Arts Summer Studio (Pasadena).
Side by side: Galileo has morning care from 8 to 9am and extended care, which matches your drop-off and pickup wish. Kidspace runs 8:45am to 3:00pm with no extended care listed. Kidspace is five full days at one museum campus, and Galileo changes its project each week. Neither lists a price, and Galileo's pages end July 31 while Kidspace runs to Aug 7.
My take: I'd start with Camp Galileo Pasadena because its morning and extended care fit your hours. If care doesn't matter and you want a museum setting, Kidspace is a fine choice, so check space soon.
Want to hear from a parent who's been? Reply INTRO and the name, like INTRO Kidspace Children's Museum.
Drive times are rough estimates. Deep dives are free during the pilot.
```

## single: is Rose Bowl Aquatics a good place for my 2 year old to learn to swim?

2 places detailed · $0.221 · 2731 chars · segments 10+9

```text
(1/2) Here's your deep dive: is Rose Bowl Aquatics a good place for my 2 year old to learn to swim?
I weighed it for your 2 year old near Pasadena: within 10 min, good value for the money, weekends.
Rose Bowl Aquatics is in your area, which fits your 10 minute limit, but its pages say almost nothing about ages, schedule or price. I looked at it first, then at one option that spells out more for a 2 year old.
I compared 2 places. What each one offers is Public/general information from its own pages; lines about parents near you are from Pando's local parents.

1) Rose Bowl Aquatics Center, Pasadena (your area)
Rose Bowl Aquatics Center is listed as a class in Pasadena, so the drive should fit your 10 minute limit. Beyond that, the information I have is thin: no ages, no schedule, no price and no description of how the class runs. That means I can't confirm it takes a 2 year old, that it runs on weekends, or that it is good value. It could be a fine fit, but right now it is unproven for your needs, so I wouldn't commit before getting those answers.
Worth checking: whether it takes 2 year olds, offers weekend classes and what each session costs.
3 parents near you have used it, last confirmed Sep 2026.
A parent said: "The water is genuinely warm, which matters with a toddler."
Good for: Toddlers doing their first parent-and-me class.
Heads up: Parking on a Rose Bowl game day is a nightmare.
Parents paid: about $100-200 a term.

(2/2) 2) Waterworks Swim School Pasadena Parent & Me, Pasadena (your area)
Waterworks Swim School Pasadena Parent & Me runs baby and toddler classes at the Pasadena aquatics center, and it takes ages 3 to 36 months, so your 2 year old is inside the range. Lessons are 20 minutes, a sensible length for a toddler. Beginner and intermediate classes have a 6:1 parent-child to instructor ratio, and you are in the water with your child. Beginner covers submersions and back floating. Price and weekend times are not listed, so I can't speak to value or your weekend preference yet.
Worth checking: whether weekend classes exist and what the price is per session.

Side by side: Rose Bowl Aquatics fits on location, but the details that decide value, ages, weekend times and price, are not listed. Waterworks lists ages 3 to 36 months, 20 minute lessons and small ratios, yet gives no price or weekend schedule either.
My take: I'd start with Waterworks Parent & Me, since it clearly takes a 2 year old and explains what the lessons cover. Ask Rose Bowl Aquatics about ages, weekends and price too, then compare.
Want to hear from a parent who's been? Reply INTRO and the name, like INTRO Rose Bowl Aquatics Center.
Drive times are rough estimates. Deep dives are free during the pilot.
```

# After the thin-search retry (22 Oct, later)

The first runs above came before `lib/server/web-search.ts` changed: the deep prompt now asks for at least five places beyond our own records, and a deep search under four places runs once more (see Decisions, 22 Oct). Same four questions, same synthetic records, rerun afterwards. The retry did not fire — each search made one call with ten web searches.

| Question | Places found | Shown | Reasons kept | Refusals | Search | Draft | Cost | Segments |
|---|---|---|---|---|---|---|---|---|
| preschool | 9 | 9 | 9/9 | 0 | 53.4 s | 11.9 s | $0.284 | 8+9+9+9+3 (gsm7) |
| camps | 8 | 8 | 8/8 | 0 | 62.1 s | 10.6 s | $0.241 | 8+10+9+5 (gsm7) |
| dentist | 6 | 6 | 6/6 | 0 | 40.5 s | 8.6 s | $0.215 | 8+8+7 (gsm7) |
| swim | 6 | 6 | 6/6 | 0 | 58 s | 9.2 s | $0.266 | 8+9+9+3 (gsm7) |

## dentist, as sent

```
(1/3) Here's your deep dive: which pediatric dentist near South Pasadena is good with a nervous 3 year old?
I weighed it for your 3 year old near South Pasadena: within 20 min.
Your 3 year old is nervous and you want to stay within 20 minutes. Only one practice has a confirmed drive time and a feature that speaks to anxiety, so I weighted that first. The rest have very little detail on their pages.
I compared 6 places. What each one offers is Public/general information from its own pages.

1) Pasadena Children's Dentistry and Orthodontics, Pasadena (about 15 min)
Pasadena Children's Dentistry and Orthodontics is the only place with a known drive, about 15 minutes, which fits your 20 minute limit. Its pages say it takes children of all ages, so a 3 year old is covered, and it offers sedation dentistry. That can matter for a very anxious child, though sedation is usually a later step and not a first-visit plan. Its pages say nothing about how staff handle nervous kids, hours or prices, so ask about all three.
Worth checking: how they handle a first visit for an anxious 3 year old, and when sedation would even be considered.

(2/3) 2) Children's Dental FunZone (Eagle Rock)
Children's Dental FunZone in Eagle Rock is a pediatric dentistry and orthodontics practice. The name suggests a kid-friendly setting, but its pages give no drive estimate, ages, hours, prices or details on anxious children. It could be worth a call, but I can't say it fits your 20 minute limit or your child's age.
Worth checking: the drive from South Pasadena and whether they see 3 year olds.

3) San Marino Pediatric Dentistry
San Marino Pediatric Dentistry is described only as a pediatric dental practice. I have no drive estimate, ages, hours or approach to nervous children. San Marino is a neighboring area, but I can't confirm the drive. It's a reasonable second call if the first choice doesn't work out.
Worth checking: the drive time, minimum age and how they approach nervous children.

4) Palm & Poppy Pediatric Dentistry
Palm & Poppy Pediatric Dentistry is listed among pediatric dentists in the Alhambra area. Beyond that, its pages give no ages, hours, prices or drive estimate, so I can't judge how it handles a nervous 3 year old or whether it fits your 20 minute limit.
Worth checking: the drive time and whether they see 3 year olds.

(3/3) 5) Village Pediatric Dentistry
Village Pediatric Dentistry is also listed among pediatric dentists in the Alhambra area, with nothing else on its pages: no ages, hours, prices, drive time or notes on anxious children. It stays on the list only as a backup to phone.
Worth checking: the drive time and their approach to nervous toddlers.

6) Little Crown Pediatric Dentistry & Orthodontics
Little Crown Pediatric Dentistry & Orthodontics is listed as pediatric dentistry and orthodontics, with no location, drive time, ages or anything on nervous children. I can't tell whether it is within 20 minutes, so I'd rank it last until you confirm the basics.
Worth checking: where it is, the drive and whether they see 3 year olds.

My take: I'd start with Pasadena Children's Dentistry and Orthodontics: it's about 15 minutes away, takes all ages and offers sedation if it's ever needed. Call it first and ask how they ease a nervous 3 year old into a first visit.
Drive times are rough estimates. Deep dives are free during the pilot.
```

# Question-led research (22 Oct, later still)

After the deep search was changed to work out what the question turns on (`focus`), read the places' own pages (`web_fetch`) and return what they say on it (`answers`); the writer compares on those first. Same four questions, same synthetic records. Run before the `keepSentences` abbreviation fix, so the camps report below still shows *"Vets at Pasadena Humane"* where the page said *"Jr. Vets"*.

| Question | What it turns on (the model's `focus`) | Places answering it | Shown | Refusals | Search | Draft | Cost | Segments |
|---|---|---|---|---|---|---|---|---|
| preschool | class size and teacher ratios; how new children are settled in; daily hours and schedule | 4/9 | 9 | 0 | 69 s | 10.1 s | $0.371 | 8+9+9+9 |
| camps | July dates and weekly sessions; daily hours and extended care; ages accepted and price | 3/8 | 6 | 2 | 82.4 s | 18.2 s | $0.45 | 8+6+8+10 |
| dentist | how nervous young children are handled; what the first visit involves; comfort or sedation options | 7/9 | 7 | 0 | 82.3 s | 9.3 s | $0.268 | 8+9+10 |
| swim | weekend class availability; parent-and-child classes for under 3s; class length, ratio and price | 6/6 | 6 | 1 | 49 s | 18.1 s | $0.296 | 9+9+9+3 |

## dentist, as sent

```
(1/3) Here's your deep dive: which pediatric dentist near South Pasadena is good with a nervous 3 year old?
I weighed it for your 3 year old near South Pasadena: within 20 min.
For a nervous 3 year old, what matters most is how a practice handles fear, what the first visit looks like, and what comfort or sedation options exist. I weighed places that describe those things plainly above ones whose pages say little, and drive time within your 20 minutes.
I compared 9 places. What each one offers is Public/general information from its own pages.

1) La Petite Kids Dentist, Pasadena (about 15 min)
La Petite Kids Dentist is about 15 minutes away in Pasadena. Its pages are the most concrete on easing a nervous child: they advise bringing your child in before the appointment to see the space and meet staff, which suits a 3 year old. Most children finish with nitrous oxide and local anesthetic, and some need IV sedation from an anesthesiologist, with a consultation first and a chance to speak with the anesthesiologist. I'd start here.
Worth checking: whether they will set up a pre-visit tour before the first appointment.

(2/3) 2) Pasadena Children's Dentistry & Orthodontics, Pasadena (about 15 min)
Pasadena Children's Dentistry & Orthodontics is about 15 minutes away and board-certified. If your child can't tolerate treatment under local anesthesia, a pediatric dental anesthesiologist provides sedation so the work is done in one visit. Its pages say toddlers can be sedated and that nitrous oxide is most often used. Strong on options, though its pages say less about the gentle first visit.
Worth checking: what the first visit looks like for an anxious 3 year old.

3) Overjoyed Pediatric Dentistry
Overjoyed Pediatric Dentistry says it works with nervous or hesitant children and takes time to connect with scared ones and answer their questions. It treats toddlers and lists same-week appointments. Its pages don't mention sedation, and I don't have a drive estimate.
Worth checking: the drive from South Pasadena and whether sedation is offered.

4) Little Crown Pediatric Dentistry & Orthodontics (Mission St)
Little Crown Pediatric Dentistry & Orthodontics has board-certified pediatric dentists and offers nitrous oxide and sedation options tailored to each child, with a parent consultation before any sedation. Its pages say little about the first visit, and I don't have a drive estimate.
Worth checking: the drive time and how the first visit is run.

(3/3) 5) Silverlake Smiles
Silverlake Smiles is a general and children's practice that says it tries to make visits comfortable for anxious children. The first appointment is a brief check-up to get young patients used to the office. It isn't a pediatric-only practice, and its pages mention no sedation.
Worth checking: the drive and whether they have experience with 3 year olds.

6) South Pasadena Dental
South Pasadena Dental is a general dentist seeing children from about age 1 and says early visits help children get comfortable. Its pages say nothing on handling nervous kids or sedation, so it fits less well for a nervous 3 year old.
Worth checking: how they handle anxious children and whether sedation is offered.

7) San Marino Pediatric Dentistry
San Marino Pediatric Dentistry lists a $185 first exam without insurance and a free first visit under age 2, which doesn't apply to your 3 year old. Its pages say nothing on nervous children or comfort options.
Worth checking: how they approach anxious children.

Also worth a look (Public/general information): Rooted Pediatric Dentistry (Pasadena), Newport Dental & Orthodontics (Pasadena).
My take: I'd start with La Petite Kids Dentist: about 15 minutes away, a pre-visit to get familiar, and clear sedation steps if needed. Pasadena Children's Dentistry is my second call.
Drive times are rough estimates. Deep dives are free during the pilot.
```

## camps, as sent

```
(1/4) Here's your deep dive: summer day camps for my 7 year old in Altadena or Pasadena in July
I weighed it for your 7 year old near Altadena: within 20 min, a range of prices, early drop-off or late pickup.
For July, the dates, daily hours and before or after care matter most, so I weighed places by what their pages actually confirm. Camp Galileo covers July with extended care on both ends; Kidspace has clear hours and prices but its July weeks were wait-list only.
I compared 8 places. What each one offers is Public/general information from its own pages; lines about parents near you are from Pando's local parents.

1) Camp Galileo at New Horizon School, Pasadena (about 15 min)
This STEAM and outdoor day camp runs at New Horizon School in Pasadena, about 15 minutes from you, in weekly sessions from June 22 to July 31 for grades K to 8, so July is covered. The day is 9am to 3pm, with extended care 8-9am before and 3-6pm after, which fits your wish for early drop-off or late pickup better than any other place here. Its page gives no price, so I can't say where it falls in your range. I'd treat it as the first one to call.
Worth checking: the weekly price and which July weeks still have room.

(2/4) 2) Kidspace Children's Museum, Pasadena (about 15 min)
Kidspace runs weekly themed camps on its 3.5 acre Pasadena campus, about 15 minutes away, for ages 5 to 8, so your 7 year old is in range with room to spare. Days run Monday to Friday, 8:45 am to 3:00 pm, with extended care from 3:00 to 5:00 pm for $150 a week. Camp is $595 a week for members and $620 for non-members, and project supplies and a t-shirt are included. The catch is that the July weeks listed were wait-list only, and there is no morning care. Worth joining the wait list as a backup.
Worth checking: whether any July week has opened up or you can get on the wait-list.
2 parents near you have used it, last confirmed Jul 2026.
A parent said: "Hands-on science every day, my daughter came home buzzing."
Heads up: Weeks sell out by April.

(3/4) 3) Pasadena Humane, Pasadena (about 15 min)
Vets at Pasadena Humane is a hands-on introduction to veterinary medicine for ages 7 to 10, about 15 minutes away, covering animal health, vaccines, common procedures and veterinary careers. Your child is at the youngest end of the range. The session listed ran June 11, 9:00 am to 2:00 pm, so I can't confirm a July date, and no price or extended care is given. It could suit an animal-loving child as a one-off week, but it is not a full-summer solution.
Worth checking: whether there is a July session, plus the price and any extended care.
One parent near you has used it, last confirmed Aug 2026.
A parent said: "Animal-loving kids get real time with the animals."
Good for: Kids 7 and up who love animals.

4) Pasadena Parks Department Summer Day Camps, Pasadena (about 15 min)
Pasadena Parks Department Summer Day Camps are city camps about 15 minutes away, with arts and crafts, sports, dance, drama and recreation. The page I have doesn't give July dates, hours, ages or prices, so I can't say how it fits your budget or extended care needs. City programs can suit a range of prices, but confirm the details.
Worth checking: July dates, ages, hours and fees.

(4/4) 5) Steve & Kate's Camp Pasadena, Pasadena (about 15 min)
Steve & Kate's Camp Pasadena lets kids choose their own activities through the day, such as a media lab, sewing, bakery, sports and water games. It's about 15 minutes away. Its page says nothing about July weeks, hours, ages or price, so I can't confirm it fits.
Worth checking: July weeks, daily hours, extended care and price.

6) Rolling Robots, Pasadena (about 15 min)
Rolling Robots is a robotics and coding camp in Pasadena, about 15 minutes away. Its page gives no dates, hours, ages or price, so it's a fit only if your child wants a tech focus and the details check out.
Worth checking: July dates, ages, hours and price.

Also worth a look (Public/general information): Beyond the Classroom Summer Camp, San Pascual Summer Day Camp.
Side by side: Camp Galileo is the one with July dates and both early drop-off (8-9am) and late pickup (to 6pm) confirmed, though price is not listed. Kidspace has the clearest price, $595 to $620 a week, and care to 5:00 pm, but July weeks were wait-list only. Pasadena Humane suits a 7 year old by age, but its page shows only a June session.
My take: I'd start with Camp Galileo at New Horizon School, since it clearly covers July and has extended care 8-9am and 3-6pm. Ask about price, and keep Kidspace as a wait-list option.
Want to hear from a parent who's been? Reply INTRO and the name, like INTRO Kidspace Children's Museum.
Drive times are rough estimates. Deep dives are free during the pilot.
```
