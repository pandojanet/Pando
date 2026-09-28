# Прогін M5 + M6 через Slack-реле — протокол

Почато: 2026-09-25T12:56:12.847Z

**Середовище.** Локальна збірка (`.next/standalone`) на порту 4197 з `MESSAGING_RELAY=slack`, `SLACK_API_BASE` → локальний стаб Slack на порту 4198, Twilio порожній — жодна справжня SMS не йде. База — dev-база з демо-когортою. «Батько» — підписана Slack-подія від сценарію; кожен текст «← Pando» — дослівно те, що застосунок відправив у Slack API (`posts.jsonl` поруч). Перший рядок поста — службовий заголовок реле (кому, масковано, категорія · шаблон), після `>` — сам текст. Адмін-дії — тимчасовий адмін `lab-walk-m5`, створений і видалений сценарієм. Веб-пошук (публічна інформація) — справжній, тож ці рядки від запуску до запуску можуть відрізнятися.

## Що знайшов розвідувальний прогін (і що виправлено до цього запису)

Перед цим записом той самий сценарій пройдено один раз «на розвідку». Знахідки:

- **A. Веб-пошук шукав «Pasadena, TX».** Бриф для пошуку давав назву району без штату. Тепер до голої назви додається регіон ринку (`web-search.ts`, `brief`).
- **B. Питання про район не ставилось ніколи.** Після відповіді про вік `pendingClarification` і далі повертав питання про вік (воно висить сім днів), тож питання про район «вже було відкрите». Тепер питаємо наступне, чого профіль ще не знає, якщо воно не те саме, що вже чекає (`inbound.ts`). Розділ 2.
- **C. Чутливе питання отримувало «збираємо відповідь від місцевих батьків».** Питання про температуру 104°F дістало обіцянку досвіду батьків замість фахівців, і прапорця для людини не було. Тепер воно отримує ті самі чотири ресурси, що й веб-форма D1 (911 · 211 · 988 · юридична допомога), а твердження про конкретну людину — тиху відповідь. Обидва піднімають escalation-прапорець на відповідь (`answer-routing.ts`, `inbound.ts`). Розділ 6. ⚠ Новий текст — у список для клієнтки.
- **D. «About fair.» / «About great value.»** «About» ставилось перед оцінкою, коли ціни не було. Тепер «About» — лише перед ціною, а сама оцінка звучить як «Value for money: fair.» (`answer.ts`).
- **E. Запис, названий у питанні, був не першим, а старий запис в «Also nearby» виглядав свіжим.** На «is Tom Sawyer Camps any good?» першим ішов Kidspace. Тепер названий запис іде першим, а короткий рядок отримує «may be out of date» або «recently questioned». Розділ 4.
- **F. Вага для неіснуючого типу відповідала «сторінка змінилась, перезавантажте».** Тепер — окрема відмова `unknown_weight`. Розділ 11.
- **G. Повторне «Надіслати» на вже надіслану відповідь давало ту саму неправду.** Тепер — `answer_already_sent`, а відмова шару відправки — `answer_not_sent`. Розділ 5.
- **H. «in Whittier» тут відповідається за профілем.** Whittier у ринку неактивний, а в лабораторії немає ключа Google, тож фраза не розпізнається. На продакшені Google знайшов би місто, і відповідь була б «нікого поруч». Не баг коду. Розділ 9 тепер бере Glendora — активне місто без сусідів.
- **I. «hmm» / «stuff» / «idk really» модель читає як small talk, а не як незрозуміле питання**, і відповідає підказкою, що вміє Pando. Це прийнятна поведінка, тож входи розділу 7 змінено на двозначні. Але й вони не дають `unclear`: перший фрагмент модель читає як запит рекомендації, а наступні — як small talk. Тож шлях «питає двічі, потім кличе людину» на живій моделі практично не досягається і перевіряється лише в `test:intent`. Продуктове спостереження, не виправлено: на «the other one» після відповіді Pando не пам'ятає, що сам щойно відповів.
- **J. Перша спроба цього запису спіймала регресію в моєму ж виправленні D.** Через екранування в скрипті в регулярному виразі замість `\b` опинився байт backspace, і пішло «About Over $200 a camp week». Виправлено, додано тест (`test:answer`), запис переписано. Такий самий байт давно сидів у `test:routing` (перевірка «не обіцяє часу» через нього завжди проходила порожньо) — теж виправлено.
- **K. Друга спроба запису: твердження про няню прочитано як пропозицію поділитися.** На «our old sitter Rosa yelled at my son and lied to me about it» модель цього разу дала `contribute`, і Pando відповів «thanks! A few taps captures it properly - ages, cost, whether you'd recommend it» без жодного прапорця (першого разу та сама фраза пройшла як питання). Тепер для всього, що не є питанням, спершу працюють детерміновані фільтри тверджень і здоров'я, а вже потім small talk / share invite (`inbound.ts`). Розділ 6.
- **Помічено в M6:** у рейтингу стоїть «Andrii Test» — справжній рядок без `is_test`, мабуть, чийсь давній ручний прохід. Його варто або позначити тестовим, або видалити.
- **Помічено, не виправлено: 22 активні місця ринку не мають жодного сусіда** в `neighborhood_adjacency` (Azusa, Covina, Glendora, West Covina, Pomona, El Monte…), а CLAUDE.md говорить про чотири. Батьки звідти отримують відповіді й пул лише зі свого міста. Це дані для клієнтки, а не код.


## 1. M5.9 — незнайомий номер: відповідь одразу, і одне питання

**Перевірка в базі — номера немає в базі до прогону:**
```sql
select count(*)::int as people from people where phone = '+16265559871'
```
| people |
| --- |
| 0 |

**→ Незнайомка (новий номер) (+16265559871)** о 2026-09-25T12:56:12.813Z:
```
any swim lessons for toddlers in Pasadena?
```
**← Pando** (2026-09-25T12:56:31.116Z):
```
*→ (626) •••‑9871*  _transactional · clarify_child_age_
> 2 parents near you have used Rose Bowl Aquatics parent & me, a class in Old Pasadena, last confirmed Sep 2026.
> Best for: a baby who hates being cold.
> One said: "The water is genuinely warm, which is the whole thing at this age - we tried two others where he screamed the entire time."
> Heads up: Parking on a Rose Bowl event day is impossible. Check the calendar.
> About $100-200 a term.
> Also nearby: La Pintoresca Branch Library, a place in Northwest Pasadena, 2 parents, Free.
> 
> Public/general information:
> Sunsational Swim School - At-home group baby and toddler swim in Pasadena. Ages 6 months to 2.5 years.
> Waterworks Swim School - Parent and Me swim classes in Pasadena. Ages 3 months to 3 years.
> 
> One thing that'll make my answers much better, how old is your child? (Just the age is fine.)
```

**Перевірка в базі — людину створено без імені, номер підтверджено самим повідомленням:**
```sql
select first_name, neighborhood, phone_verified_at is not null as verified, source from people where phone = '+16265559871'
```
| first_name | neighborhood | verified | source |
| --- | --- | --- | --- |
| null | null | true | sms_inbound |

**Перевірка в базі — згода записана як «вхідне повідомлення», а не як текст, якого вона не бачила:**
```sql
select scope, text_version from consents where person_id = (select id from people where phone = '+16265559871') order by captured_at
```
| scope | text_version |
| --- | --- |
| sms | inbound-text-2026-08 |

**Перевірка в базі — відповідь і що Pando спитав:**
```sql
select a.status, a.hold_reason, a.next_step, a.public_only, (select array_agg(name) from shares where id = any(a.share_ids)) as used,
          (select string_agg(m.template, ', ' order by m.sent_at) from message_log m where m.person_id = a.person_id and m.direction='out' and m.sent_at > '2026-09-25T12:56:12.847Z') as templates_out
     from answers a where a.phone = '+16265559871' order by a.created_at desc limit 1
```
| status | hold_reason | next_step | public_only | used | templates_out |
| --- | --- | --- | --- | --- | --- |
| sent | not_held | none | false | ["Rose Bowl Aquatics parent & me","La Pintoresca Branch Library"] | clarify_child_age |


## 2. M5.4 — відповідь на уточнення, по одному питанню

**→ Незнайомка (новий номер) (+16265559871)** о 2026-09-25T12:56:34.696Z:
```
she's 3
```
**← Pando** (2026-09-25T12:56:39.537Z, у треді):
```
*→ (626) •••‑9871*  _transactional · clarification_saved_
> Got it, thanks. I'll use that to find parents closer to you next time you ask.
```

**Перевірка в базі — вік записано як рік народження:**
```sql
select birth_year, birth_month from children where person_id = (select id from people where phone = '+16265559871')
```
| birth_year | birth_month |
| --- | --- |
| 2023 | null |

**→ Незнайомка (новий номер) (+16265559871)** о 2026-09-25T12:56:42.636Z:
```
any toddler music classes?
```
**← Pando** (2026-09-25T12:56:56.175Z, у треді):
```
*→ (626) •••‑9871*  _transactional · clarify_neighborhood_
> 3 parents near you have used Little Maestros, a class in South Pasadena, last confirmed Sep 2026.
> Best for: a cautious toddler who warms up slowly.
> One said: "Small groups and the teacher is unbelievably patient with the ones who won't join in for the first month."
> Heads up: Saturdays are packed - take the 9am.
> About $50-100 a month.
> One parent recently said it may no longer be worth it, so check before you book.
> 
> Public/general information:
> Encore Music - Pasadena - Toddler music and movement classes in South Pasadena. Single Notes for 1-year-olds; Rhythm & Twos for 2-year-olds.
> Pasadena Conservatory of Music - Young Musicians - Parent-child music classes. Ages 4 months to 2.5 years, includes movement, singing, instruments.
> Want me to ask a few nearby parents for more?
> 
> And roughly where are you? I'll look for parents nearby rather than across town.
```

> _Очікування: наступне уточнення — вже про район (вік відомий), і лише одне._

**→ Незнайомка (новий номер) (+16265559871)** о 2026-09-25T12:56:59.139Z:
```
Pasadena
```
**← Pando** (2026-09-25T12:57:04.983Z, у треді):
```
*→ (626) •••‑9871*  _transactional · clarification_saved_
> Got it, thanks. I'll use that to find parents closer to you next time you ask.
```

**Перевірка в базі — район записано:**
```sql
select neighborhood from people where phone = '+16265559871'
```
| neighborhood |
| --- |
| pasadena |

**→ Незнайомка (новий номер) (+16265559871)** о 2026-09-25T12:57:07.980Z:
```
what about dance for a 3 year old?
```
**← Pando** (2026-09-25T12:57:22.648Z, у треді):
```
*→ (626) •••‑9871*  _transactional · answer_sent_
> 3 parents near you have used AYSO soccer, a class in Sierra Madre, last confirmed Sep 2026.
> Best for: a child who is not sporty yet.
> One said: "Every child plays every game regardless of ability - that is written into how the league works, not just something the coach says."
> Heads up: Volunteering is not really optional.
> Value for money: great value.
> Also nearby: Kidspace summer camp, a class in Playhouse District, 2 parents, fair; La Pintoresca Branch Library, a place in Northwest Pasadena, 2 parents, Free.
> 
> Public/general information:
> Petite Feet Dance - ballet and creative movement classes in Pasadena. ages 3-5 years, Fridays and Saturdays.
> Tutu School Pasadena - ballet and creative movement classes. ages 18 months to 3 years.
```

> _Очікування: питання зі знаком питання — не відповідь на уточнення, а нове питання. І більше нічого не питає: вік і район відомі._


## 3. M5.3 / M5.7 — звичайне питання від батька з профілем (Priya)

**→ Priya (+16265550003)** о 2026-09-25T12:57:25.730Z:
```
any good music classes for toddlers in South Pasadena?
```
**← Pando** (2026-09-25T12:57:40.563Z, у треді):
```
*→ Priya · (626) •••‑0003*  _transactional · answer_sent_
> 3 parents near you have used Little Maestros, a class in South Pasadena, last confirmed Sep 2026.
> Best for: a cautious toddler who warms up slowly.
> One said: "Small groups and the teacher is unbelievably patient with the ones who won't join in for the first month."
> Heads up: Saturdays are packed - take the 9am.
> About $50-100 a month.
> One parent recently said it may no longer be worth it, so check before you book.
> 
> Public/general information:
> Encore Music - music & dance classes for babies in South Pasadena. Single Notes for 1-year-olds; Rhythm & Twos for 2-year-olds.
> LoveBug & Me Music - parent & child music classes in South Pasadena. Ages 0-5; 45 minutes weekly.
> Want me to ask a few nearby parents for more?
```

**Перевірка в базі — відповідь: не затримана, з якими записами, мітки:**
```sql
select status, hold_reason, next_step, public_only, labels, (select array_agg(name) from shares where id = any(a.share_ids)) as used from answers a where phone = '+16265550003' and created_at > '2026-09-25T12:56:12.847Z' order by created_at desc limit 1
```
| status | hold_reason | next_step | public_only | labels | used |
| --- | --- | --- | --- | --- | --- |
| sent | not_held | offer_blast | false | ["Validated by multiple parents","Human-reviewed","Last confirmed Sep 2026","Public/general information"] | ["Little Maestros"] |


## 4. M5.6 — старий запис чесно названо старим

**[SETUP] Tom Sawyer Camps востаннє підтверджено 2 роки тому** — ручна зміна:
```sql
update shares set last_confirmed_at = now() - interval '2 years', freshness_state = 'stale' where name = 'Tom Sawyer Camps'
```
_змінено рядків: 1_

**→ Noor (+16265550007)** о 2026-09-25T12:57:43.947Z:
```
is Tom Sawyer Camps any good for a 6 year old?
```
**← Pando** (2026-09-25T12:57:57.600Z, у треді):
```
*→ Noor · (626) •••‑0007*  _transactional · answer_sent_
> 2 parents near you have used Tom Sawyer Camps, a class in Altadena, last confirmed Sep 2024.
> Best for: a kid who would rather be outside.
> One said: "Both of mine went for three summers. It is outdoors, low-tech, and the counsellors are the same faces year after year - which matters more than the programme."
> Heads up: Sign up the week registration opens or you are on a waitlist.
> Over $200 a camp week.
> This one is old, so treat it as a starting point.
> Also nearby: Kidspace summer camp, a class in Playhouse District, 2 parents, fair; AYSO soccer, a class in Sierra Madre, 3 parents, great value.
```

> _Очікування: Tom Sawyer Camps іде першим, бо його названо в питанні, і з позначкою, що він старий. Якщо старий запис потрапляє в «Also nearby», позначка є і там._


## 5. M5.5 — питання про няню: лише ті, хто дав згоду і видимий, і завжди через людину

**Перевірка в базі — хто з нянь узагалі може з'явитися (правило 1):**
```sql
select first_name, last_initial, consent_status, active, discoverable, is_adult from caregivers where not is_test order by (consent_status='consented' and active and discoverable and is_adult) desc, first_name
```
| first_name | last_initial | consent_status | active | discoverable | is_adult |
| --- | --- | --- | --- | --- | --- |
| Elena | V | consented | true | true | true |
| Maria | G | consented | true | true | true |
| Aisha | M | invited | false | false | true |
| Beatriz | S | declined | false | false | true |
| Colette | B | mentioned | false | false | true |
| Grace | T | mentioned | false | false | true |
| Joy | A | consented | true | false | true |
| Mariah | G | invited | false | false | true |
| Marisol | R | mentioned | false | false | true |
| Priscilla | N | revoked | false | false | true |
| Tanya | R | mentioned | false | false | true |
| Valia | A | consented | false | false | true |

**→ Carmen (+16265550008)** о 2026-09-25T12:58:00.611Z:
```
any good nanny in Pasadena for a toddler, 3 days a week?
```
**← Pando** (2026-09-25T12:58:08.492Z, у треді):
```
*→ Carmen · (626) •••‑0008*  _transactional · answer_queued_
> Got it. Someone at Pando is putting an answer together from local parents, and will text it to you.
```

**Перевірка в базі — відповідь затримано для людини, назавжди:**
```sql
select id, status, hold_reason, answer_text from answers where phone = '+16265550008' and created_at > '2026-09-25T12:56:12.847Z' order by created_at desc limit 1
```
| id | status | hold_reason | answer_text |
| --- | --- | --- | --- |
| a063e7e0-e532-421f-a022-03756daba03b | pending_review | caregiver | One parent near you has used Elena V., full-time care in San Marino. Reference available. Want me to ask a few nearby parents for more? |

> _Очікування: у тексті можуть бути лише Elena V. і Maria G.; Joy A. (згода є, але прихована) і всі інші — ніколи._

**Адмін: відредагувати текст (answer.edit)** о 2026-09-25T12:58:13.001Z → HTTP 200
```json
{"action":"answer.edit","id":"a063e7e0-e532-421f-a022-03756daba03b","text":"One parent near you has used Elena V., full-time care in San Marino.\nReference available.\nWant me to ask a few nearby parents for more? A person at Pando checked this list."}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m5"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: схвалити (answer.approve)** о 2026-09-25T12:58:20.210Z → HTTP 200
```json
{"action":"answer.approve","id":"a063e7e0-e532-421f-a022-03756daba03b"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m5"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: надіслати (answer.send)** о 2026-09-25T12:58:29.734Z → HTTP 200
```json
{"action":"answer.send","id":"a063e7e0-e532-421f-a022-03756daba03b"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m5"}
```
**← Pando** (2026-09-25T12:58:28.523Z, у треді):
```
*→ Carmen · (626) •••‑0008*  _transactional · answer_
> One parent near you has used Elena V., full-time care in San Marino.
> Reference available.
> Want me to ask a few nearby parents for more? A person at Pando checked this list.
```

**Адмін: надіслати ще раз — має відмовити** о 2026-09-25T12:58:32.622Z → HTTP 409
```json
{"action":"answer.send","id":"a063e7e0-e532-421f-a022-03756daba03b"}
```
Відповідь:
```json
{"error":"This answer has already been sent. Sending again would text the parent the same message twice.","reason":"answer_already_sent"}
```
**← Pando:** _(нічого не надіслано)_

**Перевірка в базі — стан відповіді:**
```sql
select status, reviewed_by, sent_at is not null as sent from answers where id = 'a063e7e0-e532-421f-a022-03756daba03b'
```
| status | reviewed_by | sent |
| --- | --- | --- |
| sent | lab-walk-m5 | true |


## 6. M5.8 — чутливе питання

**→ Maya (+16265550001)** о 2026-09-25T12:58:38.987Z:
```
my 3 year old has a fever of 104 and a rash, what should I do?
```
**← Pando** (2026-09-25T12:58:50.155Z, у треді):
```
*→ Maya · (626) •••‑0001*  _transactional · answer_high_stakes_
> Pando is a parent network, not a professional service, so for this please reach someone qualified today. Emergency: 911. Medical advice any hour: your pediatrician's after-hours line, or 211. Someone to talk to now: call or text 988. Legal help: 1-800-433-6251. A person at Pando will also read your message.
```

**Перевірка в базі — як його класифіковано і що з відповіддю:**
```sql
select status, hold_reason, next_step, left(answer_text, 120) as text from answers where phone = '+16265550001' and created_at > '2026-09-25T12:56:12.847Z' order by created_at desc limit 1
```
| status | hold_reason | next_step | text |
| --- | --- | --- | --- |
| pending_review | sensitive | none | 3 parents near you have used Hahamongna Watershed Park, a place in Altadena, last confirmed Aug 2026. Best for: a family |

**Перевірка в базі — флаги для людини:**
```sql
select reason, severity, subject_kind, status, left(excerpt, 60) as excerpt from flags where created_at > '2026-09-25T12:56:12.847Z' order by created_at
```
| reason | severity | subject_kind | status | excerpt |
| --- | --- | --- | --- | --- |
| high_stakes_demand | escalation | answer | open | my 3 year old has a fever of 104 and a rash, what should I d |

> _Очікування: у відповідь — професійні ресурси одразу, без «збираємо відповідь від батьків» і без уточнювального питання; escalation-прапорець high_stakes_demand на цю відповідь._

**→ Noor (+16265550007)** о 2026-09-25T12:58:53.609Z:
```
our old sitter Rosa yelled at my son and lied to me about it
```
**← Pando** (2026-09-25T12:59:02.129Z, у треді):
```
*→ Noor · (626) •••‑0007*  _transactional · answer_allegation_
> Thank you for telling us. A person at Pando will read this, and it won't be shared or turned into an answer for anyone. If a child has been harmed or is at risk, please call 911 or LA County child protection at 1-800-540-4000.
```

**Перевірка в базі — як його класифіковано:**
```sql
select status, hold_reason from answers where phone = '+16265550007' and created_at > '2026-09-25T12:56:12.847Z' order by created_at desc limit 1
```
| status | hold_reason |
| --- | --- |
| pending_review | sensitive |

**Перевірка в базі — флаги для людини:**
```sql
select reason, severity, subject_kind, status from flags where created_at > '2026-09-25T12:56:12.847Z' order by created_at
```
| reason | severity | subject_kind | status |
| --- | --- | --- | --- |
| high_stakes_demand | escalation | answer | open |
| named_allegation | escalation | answer | open |

> _Очікування: твердження про конкретну людину — тиха відповідь без списку ресурсів (лише 911 / захист дітей) і без повтору сказаного; прапорець named_allegation._


## 7. Pando не розуміє — питає двічі, потім кличе людину

**→ Carmen (+16265550008)** о 2026-09-25T12:59:05.426Z:
```
is the one on lake still open on the weekend or
```
**← Pando** (2026-09-25T12:59:21.706Z, у треді):
```
*→ Carmen · (626) •••‑0008*  _transactional · answer_sent_
> 3 parents near you have used AYSO soccer, a class in Sierra Madre, last confirmed Sep 2026.
> Best for: a child who is not sporty yet.
> One said: "Every child plays every game regardless of ability - that is written into how the league works, not just something the coach says."
> Heads up: Volunteering is not really optional.
> Value for money: great value.
> Also nearby: Kidspace summer camp, a class in Playhouse District, 2 parents, fair; Pasadena Conservatory of Music, a class in Madison Heights, 2 parents, pricey but worth it.
```

**→ Carmen (+16265550008)** о 2026-09-25T12:59:24.636Z:
```
the other one
```
**← Pando** (2026-09-25T12:59:30.582Z, у треді):
```
*→ Carmen · (626) •••‑0008*  _transactional · small_talk_
> Pando: ask me about local classes, camps, activities or childcare and I'll tell you what nearby parents recommend. Reply STOP to opt out, HELP for help.
```

**→ Carmen (+16265550008)** о 2026-09-25T12:59:33.630Z:
```
like that one
```
**← Pando** (2026-09-25T12:59:40.783Z, у треді):
```
*→ Carmen · (626) •••‑0008*  _transactional · small_talk_
> Pando: ask me about local classes, camps, activities or childcare and I'll tell you what nearby parents recommend. Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — обмін закрито, людина потрібна сьогодні:**
```sql
select status, cardinality(turns) as turns from pending_questions where person_id = (select id from people where phone = '+16265550008') and created_at > '2026-09-25T12:56:12.847Z'
```
_(0 рядків)_

**Перевірка в базі — ескалація:**
```sql
select reason, severity, status from flags where created_at > '2026-09-25T12:56:12.847Z' and reason = 'unreadable_question'
```
_(0 рядків)_


## 8. Не питання: подяка і пропозиція в розмові

**→ Noor (+16265550007)** о 2026-09-25T12:59:44.183Z:
```
thanks!
```
**← Pando** (2026-09-25T12:59:52.962Z, у треді):
```
*→ Noor · (626) •••‑0007*  _transactional · small_talk_
> Pando: ask me about local classes, camps, activities or childcare and I'll tell you what nearby parents recommend. Reply STOP to opt out, HELP for help.
```

**→ Noor (+16265550007)** о 2026-09-25T12:59:55.955Z:
```
we loved the little gym in Monrovia
```
**← Pando** (2026-09-25T13:00:01.890Z, у треді):
```
*→ Noor · (626) •••‑0007*  _transactional · share_invite_
> Pando: thanks! A few taps captures it properly - ages, cost, whether you'd recommend it: pando.is/share Reply STOP to opt out, HELP for help.
```


## 9. Далеко від мережі: немає батьків поруч

**Перевірка в базі — Glendora — активне місто без сусідів:**
```sql
select option_value, active, (select count(*) from neighborhood_adjacency a where a.area_a = 'glendora' or a.area_b = 'glendora') as neighbours, (select count(*) from people where neighborhood = 'glendora') as parents from market_options where category = 'neighborhoods' and option_value = 'glendora'
```
| option_value | active | neighbours | parents |
| --- | --- | --- | --- |
| glendora | true | 0 | 0 |

**→ Priya (+16265550003)** о 2026-09-25T13:00:04.858Z:
```
any toddler classes in Glendora?
```
**← Pando** (2026-09-25T13:00:23.087Z, у треді):
```
*→ Priya · (626) •••‑0003*  _transactional · answer_sent_
> There's nothing from parents near Glendora yet. Here's general information, not from a parent:
> Circle Time - Parent & Me toddler classes in Glendora. Parent & Me Pod for ages 1-3 years, 60 minute classes. Public/general information.
```

> _Очікування: чесно сказано, що від батьків поруч з Glendora нічого немає; публічна інформація додана; Network Ask не пропонується (поруч нікого спитати)._


## 10. M6 — кого Pando спитав би: рейтинг і з чого складається бал

**Адмін: /admin/matching — як є** (кого Pando спитав би для Maya, wanted = 8):
- знайдено: 12 · замало: false · context step: 0.5
| # | name | score | affinity | relevance | reasons |
| --- | --- | --- | --- | --- | --- |
| 1 | Leah Fischer | 7.5 | 7 | 0.5 | school:the-growing-place +5, adjacent_neighborhood:old-pasadena +1, age_range_near:preschool +1, relevance:tenure:1_3_years +0.5 |
| 2 | Corinne Baptiste | 7.5 | 7 | 0.5 | school:the-growing-place +5, adjacent_neighborhood:playhouse-district +1, age_range_near:preschool +1, relevance:budget:mid_range +0.5 |
| 3 | Grace Kim | 6.5 | 6 | 0.5 | school:the-growing-place +5, age_range_near:preschool +1, relevance:budget:mid_range +0.5 |
| 4 | Noor Haddad | 4 | 3 | 1 | adjacent_neighborhood:east-pasadena +1, age_range:grade +2, relevance:logistics:close_to_home +0.5, relevance:budget:mid_range +0.5 |
| 5 | Dana Whitfield | 4 | 3 | 1 | adjacent_neighborhood:madison-heights +1, age_range:tween+grade +2, relevance:logistics:close_to_home +0.5, relevance:budget:mid_range +0.5 |
| 6 | Tessa Nakamura | 4 | 3 | 1 | adjacent_neighborhood:linda-vista +1, age_range:grade +2, relevance:logistics:close_to_home +0.5, relevance:budget:mid_range +0.5 |
| 7 | Rachel Alvarez | 3.5 | 3 | 0.5 | adjacent_neighborhood:sierra-madre +1, age_range:grade +2, relevance:budget:mid_range +0.5 |
| 8 | Carmen Delgado | 3.5 | 3 | 0.5 | adjacent_neighborhood:northwest-pasadena +1, age_range:tween+grade +2, relevance:budget:mid_range +0.5 |
| 9 | Jessica Moreau | 3.5 | 3 | 0.5 | adjacent_neighborhood:bungalow-heaven +1, age_range:grade +2, relevance:budget:mid_range +0.5 |
| 10 | Andrii Test | 3 | 3 | 0 | adjacent_neighborhood:bungalow-heaven +1, age_range:grade +2 |
| 11 | Priya Raman | 2.5 | 2 | 0.5 | age_range:grade+preschool +2, relevance:logistics:close_to_home +0.5 |
| 12 | Sarah Chen | 2 | 2 | 0 | age_range:grade+preschool +2 |

Ваги, з якими рахувалось:
| affinity_type | weight |
| --- | --- |
| activity | 4 |
| adjacent_neighborhood | 1 |
| age_range | 2 |
| faith_community | 3 |
| neighborhood | 3 |
| school | 5 |
| social_group | 3 |

> _Кожен бал — сума причин праворуч: спільна школа, сусідній район, вік дітей, і +context step за кожен збіг життєвого контексту._


## 11. M6 — вага змінює рейтинг одразу, без деплою

**Адмін: вага «школа» 5 → 1** о 2026-09-25T13:00:29.115Z → HTTP 200
```json
{"action":"matching.weight","affinity_type":"school","weight":1}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m5"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: /admin/matching — школа = 1** (кого Pando спитав би для Maya, wanted = 8):
- знайдено: 12 · замало: false · context step: 0.5
| # | name | score | affinity | relevance | reasons |
| --- | --- | --- | --- | --- | --- |
| 1 | Noor Haddad | 4 | 3 | 1 | adjacent_neighborhood:east-pasadena +1, age_range:grade +2, relevance:logistics:close_to_home +0.5, relevance:budget:mid_range +0.5 |
| 2 | Dana Whitfield | 4 | 3 | 1 | adjacent_neighborhood:madison-heights +1, age_range:tween+grade +2, relevance:logistics:close_to_home +0.5, relevance:budget:mid_range +0.5 |
| 3 | Tessa Nakamura | 4 | 3 | 1 | adjacent_neighborhood:linda-vista +1, age_range:grade +2, relevance:logistics:close_to_home +0.5, relevance:budget:mid_range +0.5 |
| 4 | Rachel Alvarez | 3.5 | 3 | 0.5 | adjacent_neighborhood:sierra-madre +1, age_range:grade +2, relevance:budget:mid_range +0.5 |
| 5 | Leah Fischer | 3.5 | 3 | 0.5 | school:the-growing-place +1, adjacent_neighborhood:old-pasadena +1, age_range_near:preschool +1, relevance:tenure:1_3_years +0.5 |
| 6 | Carmen Delgado | 3.5 | 3 | 0.5 | adjacent_neighborhood:northwest-pasadena +1, age_range:tween+grade +2, relevance:budget:mid_range +0.5 |
| 7 | Corinne Baptiste | 3.5 | 3 | 0.5 | school:the-growing-place +1, adjacent_neighborhood:playhouse-district +1, age_range_near:preschool +1, relevance:budget:mid_range +0.5 |
| 8 | Jessica Moreau | 3.5 | 3 | 0.5 | adjacent_neighborhood:bungalow-heaven +1, age_range:grade +2, relevance:budget:mid_range +0.5 |
| 9 | Andrii Test | 3 | 3 | 0 | adjacent_neighborhood:bungalow-heaven +1, age_range:grade +2 |
| 10 | Grace Kim | 2.5 | 2 | 0.5 | school:the-growing-place +1, age_range_near:preschool +1, relevance:budget:mid_range +0.5 |
| 11 | Priya Raman | 2.5 | 2 | 0.5 | age_range:grade+preschool +2, relevance:logistics:close_to_home +0.5 |
| 12 | Sarah Chen | 2 | 2 | 0 | age_range:grade+preschool +2 |

Ваги, з якими рахувалось:
| affinity_type | weight |
| --- | --- |
| activity | 4 |
| adjacent_neighborhood | 1 |
| age_range | 2 |
| faith_community | 3 |
| neighborhood | 3 |
| school | 1 |
| social_group | 3 |

**Адмін: вага 25 — має відмовити** о 2026-09-25T13:00:37.058Z → HTTP 422
```json
{"action":"matching.weight","affinity_type":"school","weight":25}
```
Відповідь:
```json
{"error":"A weight is a whole number between 1 and 20"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: вага 2.5 — має відмовити** о 2026-09-25T13:00:43.279Z → HTTP 422
```json
{"action":"matching.weight","affinity_type":"school","weight":2.5}
```
Відповідь:
```json
{"error":"A weight is a whole number between 1 and 20"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: вага невідомого типу — має відмовити** о 2026-09-25T13:00:50.150Z → HTTP 409
```json
{"action":"matching.weight","affinity_type":"shoe_size","weight":3}
```
Відповідь:
```json
{"error":"Pando has no weight for that kind of connection, so nothing was saved.","reason":"unknown_weight"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: повернути вагу «школа» → 5** о 2026-09-25T13:00:57.398Z → HTTP 200
```json
{"action":"matching.weight","affinity_type":"school","weight":5}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m5"}
```
**← Pando:** _(нічого не надіслано)_


## 12. M6 — context step

**Адмін: context step 0.5 → 2** о 2026-09-25T13:01:04.607Z → HTTP 200
```json
{"action":"matching.relevance_step","value":2}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m5"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: /admin/matching — context step = 2** (кого Pando спитав би для Maya, wanted = 8):
- знайдено: 12 · замало: false · context step: 2
| # | name | score | affinity | relevance | reasons |
| --- | --- | --- | --- | --- | --- |
| 1 | Leah Fischer | 9 | 7 | 2 | school:the-growing-place +5, adjacent_neighborhood:old-pasadena +1, age_range_near:preschool +1, relevance:tenure:1_3_years +2 |
| 2 | Corinne Baptiste | 9 | 7 | 2 | school:the-growing-place +5, adjacent_neighborhood:playhouse-district +1, age_range_near:preschool +1, relevance:budget:mid_range +2 |
| 3 | Grace Kim | 8 | 6 | 2 | school:the-growing-place +5, age_range_near:preschool +1, relevance:budget:mid_range +2 |
| 4 | Noor Haddad | 7 | 3 | 4 | adjacent_neighborhood:east-pasadena +1, age_range:grade +2, relevance:logistics:close_to_home +2, relevance:budget:mid_range +2 |
| 5 | Dana Whitfield | 7 | 3 | 4 | adjacent_neighborhood:madison-heights +1, age_range:tween+grade +2, relevance:logistics:close_to_home +2, relevance:budget:mid_range +2 |
| 6 | Tessa Nakamura | 7 | 3 | 4 | adjacent_neighborhood:linda-vista +1, age_range:grade +2, relevance:logistics:close_to_home +2, relevance:budget:mid_range +2 |
| 7 | Rachel Alvarez | 5 | 3 | 2 | adjacent_neighborhood:sierra-madre +1, age_range:grade +2, relevance:budget:mid_range +2 |
| 8 | Carmen Delgado | 5 | 3 | 2 | adjacent_neighborhood:northwest-pasadena +1, age_range:tween+grade +2, relevance:budget:mid_range +2 |
| 9 | Jessica Moreau | 5 | 3 | 2 | adjacent_neighborhood:bungalow-heaven +1, age_range:grade +2, relevance:budget:mid_range +2 |
| 10 | Priya Raman | 4 | 2 | 2 | age_range:grade+preschool +2, relevance:logistics:close_to_home +2 |
| 11 | Andrii Test | 3 | 3 | 0 | adjacent_neighborhood:bungalow-heaven +1, age_range:grade +2 |
| 12 | Sarah Chen | 2 | 2 | 0 | age_range:grade+preschool +2 |

Ваги, з якими рахувалось:
| affinity_type | weight |
| --- | --- |
| activity | 4 |
| adjacent_neighborhood | 1 |
| age_range | 2 |
| faith_community | 3 |
| neighborhood | 3 |
| school | 5 |
| social_group | 3 |

**Адмін: context step 0.07 — має відмовити** о 2026-09-25T13:01:12.503Z → HTTP 422
```json
{"action":"matching.relevance_step","value":0.07}
```
Відповідь:
```json
{"error":"The context step is between 0 and 5, in steps of 0.05"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: context step 9 — має відмовити** о 2026-09-25T13:01:18.824Z → HTTP 422
```json
{"action":"matching.relevance_step","value":9}
```
Відповідь:
```json
{"error":"The context step is between 0 and 5, in steps of 0.05"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: повернути context step → 0.5** о 2026-09-25T13:01:26.141Z → HTTP 200
```json
{"action":"matching.relevance_step","value":0.5}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m5"}
```
**← Pando:** _(нічого не надіслано)_


## 13. M6 — батько без зв'язків

**Адмін: /admin/matching — незнайомка з розділу 1 (лише район і вік)** (кого Pando спитав би для Незнайомка (новий номер), wanted = 8):
- знайдено: 14 · замало: false · context step: 0.5
| # | name | score | affinity | relevance | reasons |
| --- | --- | --- | --- | --- | --- |
| 1 | Leah Fischer | 3 | 3 | 0 | adjacent_neighborhood:old-pasadena +1, age_range:preschool +2 |
| 2 | Corinne Baptiste | 3 | 3 | 0 | adjacent_neighborhood:playhouse-district +1, age_range:preschool +2 |
| 3 | Priya Raman | 3 | 3 | 0 | adjacent_neighborhood:san-marino +1, age_range:grade+preschool +2 |
| 4 | Sarah Chen | 3 | 3 | 0 | adjacent_neighborhood:south-pasadena +1, age_range:grade+preschool +2 |
| 5 | Noor Haddad | 2 | 2 | 0 | adjacent_neighborhood:east-pasadena +1, age_range_near:grade +1 |
| 6 | Rachel Alvarez | 2 | 2 | 0 | adjacent_neighborhood:sierra-madre +1, age_range_near:grade +1 |
| 7 | Maya Okonkwo | 2 | 2 | 0 | adjacent_neighborhood:altadena +1, age_range_near:grade +1 |
| 8 | Grace Kim | 2 | 2 | 0 | age_range:preschool +2 |
| 9 | Carmen Delgado | 2 | 2 | 0 | adjacent_neighborhood:northwest-pasadena +1, age_range_near:tween+grade +1 |
| 10 | Andrii Test | 2 | 2 | 0 | adjacent_neighborhood:bungalow-heaven +1, age_range_near:grade +1 |
| 11 | Jessica Moreau | 2 | 2 | 0 | adjacent_neighborhood:bungalow-heaven +1, age_range_near:grade +1 |
| 12 | Dana Whitfield | 2 | 2 | 0 | adjacent_neighborhood:madison-heights +1, age_range_near:tween+grade +1 |
| 13 | Tessa Nakamura | 2 | 2 | 0 | adjacent_neighborhood:linda-vista +1, age_range_near:grade +1 |
| 14 | null | 1 | 1 | 0 | adjacent_neighborhood:altadena +1 |

Ваги, з якими рахувалось:
| affinity_type | weight |
| --- | --- |
| activity | 4 |
| adjacent_neighborhood | 1 |
| age_range | 2 |
| faith_community | 3 |
| neighborhood | 3 |
| school | 5 |
| social_group | 3 |

> _Очікування: у неї немає школи, гуртків, контексту — рейтинг тримається лише на районі та віці дітей, і це видно в причинах._


Завершено: 2026-09-25T13:01:34.425Z
