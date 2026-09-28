# Прогін M7 + M8 через Slack-реле — протокол

Почато: 2026-09-25T11:00:38.756Z

**Середовище.** Локальна збірка (`.next/standalone`) на порту 4197 з `MESSAGING_RELAY=slack`, `SLACK_API_BASE` → локальний стаб Slack на порту 4198, `JOBS_SECRET` задано, Twilio порожній — жодна справжня SMS не йде. База — dev-база з демо-когортою. Повідомлення «від батька» — підписана Slack-подія від цього сценарію; кожен текст «← Pando» — дослівно те, що застосунок відправив у Slack API (`posts.jsonl` поруч). Перший рядок поста — службовий заголовок реле (кому, масковано, категорія · шаблон), після `>` — сам текст. Адмін-дії виконує тимчасовий адмін `lab-walk-m7`, створений цим сценарієм і видалений після нього.

## Що знайшов розвідувальний прогін і що виправлено перед цим

Цей протокол — другий прогін. Перший (той самий сценарій) знайшов сім речей; усі виправлено в коді, і нижче видно, що вони поводяться правильно:

1. **Last-Minute Care не можна було надіслати взагалі**, а «release» короткого пулу нічого не давав: розсилка знову ставила позначку «потрібна людина». Тепер `blast.release` записує `released_at` (міграція 0051), і розсилка його поважає — розділи 3 і 7.
2. **Прострочена чернетка не закривалась**, і кредит, яким її оплатили, пропадав. Тепер `expire_blasts` закриває й чернетки та повертає кредит — розділ 9.
3. **Відповідь на Ask зустрічала тишу**, а друге повідомлення через хвилину йшло в пайплайн як нова пропозиція й отримувало посилання на /share. Тепер — одне підтвердження, а друге повідомлення в межах 30 хвилин дописується до відповіді — розділ 4. ⚠ Новий текст підтвердження — для клієнтки.
4. **Меню SETTINGS не закривалось** після вибору: «5» через хвилину знову змінювало ліміт. Тепер підтвердження закриває меню — розділ 13.
5. **Людину без номера рахувало до «≥3 батьків поруч»** і садило в пул — пропозицію Ask робили там, де досяжних лише двоє. Тепер рахуються лише люди з номером — розділи 1–2.
6. **Запит казав «your experience looked relevant»** людям, яких обрали лише тому, що вони живуть поруч. Тепер — «you live nearby» — розділ 3. ⚠ Нове слово в зареєстрованому шаблоні — для клієнтки.
7. **Дрібниці:** у «відкладених» у перегляді пулу не було номера; рядок публічної інформації закінчувався «..».

⚠ Стан на початку: у Dana, Rachel, Sarah, Priya і Valentyna є запити з прогону M9+M10 кілька годин тому, тож для них уже діє 48-годинна пауза — це видно в пулах нижче без жодного [SETUP].

## 1. M7 — автоматичний вхід: тонка відповідь пропонує Ask, «yes» його створює (Maya)

**→ Maya (+16265550001)** о 2026-09-25T11:00:38.532Z:
```
any robotics or coding classes for a 9 year old in Arcadia?
```
**← Pando** (2026-09-25T11:00:52.792Z, у треді):
```
*→ Maya · (626) •••‑0001*  _transactional · answer_sent_
> 3 parents near you have used AYSO soccer, a class in Sierra Madre, last confirmed Sep 2026.
> Best for: a child who is not sporty yet.
> One said: "Every child plays every game regardless of ability - that is written into how the league works, not just something the coach says."
> Heads up: Volunteering is not really optional.
> About great value.
> 
> Public/general information:
> Code Ninjas - Coding and robotics classes in Arcadia. Ages 5-14, after-school sessions and seasonal camps.
> Snapology of Arcadia - Robotics and coding classes using LEGO. After-school programs, camps, and workshops for ages 5-12.
> Want me to ask a few nearby parents for more?
```

**Перевірка в базі — відповідь і чи запропоновано Ask:**
```sql
select id, status, hold_reason, next_step, public_only from answers where phone = '+16265550001' and created_at > '2026-09-25T11:00:38.756Z' order by created_at desc limit 1
```
| id | status | hold_reason | next_step | public_only |
| --- | --- | --- | --- | --- |
| 6603e470-2f6f-428b-8293-c8ca9810ac89 | sent | not_held | offer_blast | false |

**→ Maya (+16265550001)** о 2026-09-25T11:00:56.058Z:
```
yes
```
**← Pando** (2026-09-25T11:01:03.630Z, у треді):
```
*→ Maya · (626) •••‑0001*  _transactional · ask_started_
> Pando: on it. I'll ask a few nearby parents who'd know, and text you what they say. Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — створений Ask:**
```sql
select id, tier, status, human_review, neighborhood, pool_target, payment_status, credit_id, expires_at, question_text from blasts where asker_id = (select id from people where phone = '+16265550001') and created_at > '2026-09-25T11:00:38.756Z' order by created_at desc limit 1
```
| id | tier | status | human_review | neighborhood | pool_target | payment_status | credit_id | expires_at | question_text |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d9fbc4ed-5a6a-46cf-80f3-91e57634c0a4 | targeted | draft | false | arcadia | 5 | pending | null | 2026-09-26T11:01:01.685Z | any robotics or coding classes for a 9 year old in Arcadia? |

**Перевірка в базі — пропозицію витрачено (повторне «yes» нічого не створить):**
```sql
select next_step from answers where id = '6603e470-2f6f-428b-8293-c8ca9810ac89'
```
| next_step |
| --- |
| none |


## 2. M7.3 — кого питати: пул до розсилки

**Адмін: попередній перегляд пулу — Ask Maya** (той самий `selectPool`, що й розсилка):
- потрібно: 5 · замало (cold): true · потрібен перегляд людиною: {"required":true,"reason":"short_pool"}
- **обрані:**
| name | phone | score | reasons |
| --- | --- | --- | --- |
| Grace Kim | +16265550010 | 6.5 | school, age_range_near, relevance:budget |
| Nadia Farouk | +16265550015 | 0 |  |
- **відкладені:**
| name | phone | score | reason |
| --- | --- | --- | --- |
| Rachel Alvarez | +16265550002 | 3.5 | too_soon |
| Helen Osei | +16265550013 | 0 | opted_out_or_test |


## 3. M7.8 — розсилка

**Адмін: надіслати (blast.send)** о 2026-09-25T11:01:10.795Z → HTTP 409
```json
{"action":"blast.send","id":"d9fbc4ed-5a6a-46cf-80f3-91e57634c0a4"}
```
Відповідь:
```json
{"error":"This Ask is waiting for a person. Preview the pool: a short one means the network could not fill the tier. Releasing it is a decision, and it asks for a reason.","reason":"blast_needs_review"}
```
**← Pando:** _(нічого не надіслано)_

> _Пул коротший за 5 — Ask позначено для перегляду людиною. Адмін випускає його з приміткою і пробує знову._

**Адмін: випустити з перегляду (blast.release)** о 2026-09-25T11:01:18.126Z → HTTP 200
```json
{"action":"blast.release","id":"d9fbc4ed-5a6a-46cf-80f3-91e57634c0a4","note":"Lab walk: short pool accepted"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: надіслати ще раз (blast.send)** о 2026-09-25T11:01:31.535Z → HTTP 200
```json
{"action":"blast.send","id":"d9fbc4ed-5a6a-46cf-80f3-91e57634c0a4"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando** (2026-09-25T11:01:27.844Z, у треді):
```
*→ Grace · (626) •••‑0010*  _outreach · blast_request_
> Pando: a parent nearby asked — "any robotics or coding classes for a 9 year old in Arcadia?" We thought of you (you're at the same school). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T11:01:29.959Z):
```
*→ Nadia · (626) •••‑0015*  _outreach · blast_request_
> Pando: a parent nearby asked — "any robotics or coding classes for a 9 year old in Arcadia?" We thought of you (you live nearby). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — кому пішло:**
```sql
select p.first_name, p.phone, r.match_score, r.sent_at from blast_recipients r join people p on p.id = r.person_id where r.blast_id = 'd9fbc4ed-5a6a-46cf-80f3-91e57634c0a4' order by r.match_score desc nulls last
```
| first_name | phone | match_score | sent_at |
| --- | --- | --- | --- |
| Grace | +16265550010 | 6.50 | 2026-09-25T11:01:29.124Z |
| Nadia | +16265550015 | 0.00 | 2026-09-25T11:01:31.237Z |

**Перевірка в базі — стан Ask:**
```sql
select status, human_review, payment_status from blasts where id = 'd9fbc4ed-5a6a-46cf-80f3-91e57634c0a4'
```
| status | human_review | payment_status |
| --- | --- | --- |
| active | false | pending |


## 4. M7.5 — відповіді: текст, PASS, друге повідомлення, мовчання

**→ Grace (+16265550010)** о 2026-09-25T11:01:34.077Z:
```
My daughter does the robotics club at the Arcadia library, free on Saturday mornings
```
**← Pando** (2026-09-25T11:01:37.966Z, у треді):
```
*→ Grace · (626) •••‑0010*  _transactional · blast_reply_saved_
> Pando: thank you! A person at Pando reads each reply before it's passed on. Reply STOP to opt out, HELP for help.
```

> _Очікування: одне підтвердження, що відповідь прочитає людина._

**→ Grace (+16265550010)** о 2026-09-25T11:01:40.959Z:
```
also bring a laptop if you have one
```
**← Pando:** _(нічого не надіслано)_

> _Очікування: друге повідомлення дописується до тієї самої відповіді й нічого не надсилає._

**→ Nadia (+16265550015)** о 2026-09-25T11:02:01.250Z:
```
PASS
```
**← Pando:** _(нічого не надіслано)_

**Перевірка в базі — що записалось у пул:**
```sql
select p.first_name, r.responded_at is not null as replied, r.passed_at is not null as passed, r.response_text, r.review_status from blast_recipients r join people p on p.id = r.person_id where r.blast_id = 'd9fbc4ed-5a6a-46cf-80f3-91e57634c0a4' order by p.first_name
```
| first_name | replied | passed | response_text | review_status |
| --- | --- | --- | --- | --- |
| Grace | true | false | My daughter does the robotics club at the Arcadia library, free on Saturday mornings also bring a laptop if you have one | pending_review |
| Nadia | false | true | null | pending_review |

**Перевірка в базі — відповіді прив'язані до запиту (для governor-а):**
```sql
select p.first_name, m.template, m.responded_to is not null as linked from message_log m join people p on p.id = m.person_id where m.direction = 'in' and m.sent_at > '2026-09-25T11:00:38.756Z' and p.phone in ('+16265550010','+16265550015') order by m.sent_at
```
| first_name | template | linked |
| --- | --- | --- |
| Grace | null | true |
| Grace | null | true |
| Nadia | pass | true |


## 5. M7.6 / M7.9 — адмін читає, оцінює, схвалює → запис у граф

**Адмін: оцінити відповідь (blast_response.rate, 4)** о 2026-09-25T11:02:18.957Z → HTTP 200
```json
{"action":"blast_response.rate","blast_id":"d9fbc4ed-5a6a-46cf-80f3-91e57634c0a4","person_id":"305ac71d-4abc-488c-af7c-18f9a9913115","quality":4}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: схвалити як новий запис (blast_response.approve)** о 2026-09-25T11:02:27.948Z → HTTP 200
```json
{"action":"blast_response.approve","blast_id":"d9fbc4ed-5a6a-46cf-80f3-91e57634c0a4","person_id":"305ac71d-4abc-488c-af7c-18f9a9913115","share_name":"Arcadia Library robotics club","share_kind":"activity"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: схвалити ще раз — має відмовити** о 2026-09-25T11:02:34.868Z → HTTP 409
```json
{"action":"blast_response.approve","blast_id":"d9fbc4ed-5a6a-46cf-80f3-91e57634c0a4","person_id":"305ac71d-4abc-488c-af7c-18f9a9913115","share_name":"Arcadia Library robotics club","share_kind":"activity"}
```
Відповідь:
```json
{"error":"This reply has already been read — the decision stands. Reload to see it under \"Already read\".","reason":"blast_reply_decided"}
```
**← Pando:** _(нічого не надіслано)_

**Перевірка в базі — запис у графі: чекає перевірки, secondhand, з посиланням на Ask:**
```sql
select s.name, s.status as share_status, sc.status as contribution_status, sc.firsthand, sc.source_blast_id = 'd9fbc4ed-5a6a-46cf-80f3-91e57634c0a4' as from_this_ask from share_contributions sc join shares s on s.id = sc.share_id where sc.source_blast_id = 'd9fbc4ed-5a6a-46cf-80f3-91e57634c0a4'
```
| name | share_status | contribution_status | firsthand | from_this_ask |
| --- | --- | --- | --- | --- |
| Arcadia Library robotics club | pending_review | pending_review | false | true |

**Перевірка в базі — подія в журналі внесків:**
```sql
select kind, quality, is_test from impact_events where blast_id = 'd9fbc4ed-5a6a-46cf-80f3-91e57634c0a4'
```
| kind | quality | is_test |
| --- | --- | --- |
| blast_answered | 4 | false |


## 6. M7 — вихід: відповіді повертаються до Maya

**Адмін: надіслати відповіді (blast.deliver)** о 2026-09-25T11:02:44.258Z → HTTP 200
```json
{"action":"blast.deliver","id":"d9fbc4ed-5a6a-46cf-80f3-91e57634c0a4"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando** (2026-09-25T11:02:43.013Z, у треді):
```
*→ Maya · (626) •••‑0001*  _transactional · blast_answers_
> One parent answered your question:
> 
> "My daughter does the robotics club at the Arcadia library, free on Saturday mornings also bring a laptop if you have one"
> 
> These are local parents Pando matched to your question.
```

**Адмін: надіслати ще раз — має відмовити** о 2026-09-25T11:02:47.511Z → HTTP 409
```json
{"action":"blast.deliver","id":"d9fbc4ed-5a6a-46cf-80f3-91e57634c0a4"}
```
Відповідь:
```json
{"error":"The answers have already gone to this parent. Sending again would text them the same message twice.","reason":"blast_answers_already_sent"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: позначити виконаним (blast.fulfil)** о 2026-09-25T11:02:54.862Z → HTTP 200
```json
{"action":"blast.fulfil","id":"d9fbc4ed-5a6a-46cf-80f3-91e57634c0a4","note":"Lab walk: answer delivered"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando:** _(нічого не надіслано)_

**Перевірка в базі — стан Ask:**
```sql
select status, answers_sent_at is not null as delivered, fulfilled_at is not null as fulfilled from blasts where id = 'd9fbc4ed-5a6a-46cf-80f3-91e57634c0a4'
```
| status | delivered | fulfilled |
| --- | --- | --- |
| fulfilled | true | true |


## 7. M7.2 — Last-Minute Care: завжди через людину

**Адмін: створити Last-Minute Ask** о 2026-09-25T11:03:03.136Z → HTTP 200
```json
{"action":"blast.create","asker_id":"5adafdcd-ffb7-4aed-88c9-d76772bdc168","question_text":"Need a sitter tonight 6-9pm, anyone free?","tier":"last_minute"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando:** _(нічого не надіслано)_

**Перевірка в базі — створено з позначкою перегляду:**
```sql
select tier, status, human_review, pool_target from blasts where id = '58bea069-e1de-4a91-a85f-a41e3125c3fd'
```
| tier | status | human_review | pool_target |
| --- | --- | --- | --- |
| last_minute | pending_review | true | 5 |

**Адмін: надіслати без перегляду — має відмовити** о 2026-09-25T11:03:10.610Z → HTTP 409
```json
{"action":"blast.send","id":"58bea069-e1de-4a91-a85f-a41e3125c3fd"}
```
Відповідь:
```json
{"error":"This Ask is waiting for a person. Preview the pool: a short one means the network could not fill the tier. Releasing it is a decision, and it asks for a reason.","reason":"blast_needs_review"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: випустити (blast.release)** о 2026-09-25T11:03:17.880Z → HTTP 200
```json
{"action":"blast.release","id":"58bea069-e1de-4a91-a85f-a41e3125c3fd","note":"Lab walk: reviewed the match"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: надіслати після випуску** о 2026-09-25T11:03:38.242Z → HTTP 200
```json
{"action":"blast.send","id":"58bea069-e1de-4a91-a85f-a41e3125c3fd"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando** (2026-09-25T11:03:28.157Z, у треді):
```
*→ Corinne · (626) •••‑0016*  _outreach · blast_request_
> Pando: a parent nearby asked — "Need a sitter tonight 6-9pm, anyone free?" We thought of you (you're at the same school). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T11:03:30.275Z, у треді):
```
*→ Maya · (626) •••‑0001*  _outreach · blast_request_
> Pando: a parent nearby asked — "Need a sitter tonight 6-9pm, anyone free?" We thought of you (you're at the same school). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T11:03:32.396Z, у треді):
```
*→ Carmen · (626) •••‑0008*  _outreach · blast_request_
> Pando: a parent nearby asked — "Need a sitter tonight 6-9pm, anyone free?" We thought of you (you're just nearby). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T11:03:34.533Z):
```
*→ Jessica · (626) •••‑0004*  _outreach · blast_request_
> Pando: a parent nearby asked — "Need a sitter tonight 6-9pm, anyone free?" We thought of you (you're just nearby). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T11:03:36.648Z, у треді):
```
*→ Noor · (626) •••‑0007*  _outreach · blast_request_
> Pando: a parent nearby asked — "Need a sitter tonight 6-9pm, anyone free?" We thought of you (you're just nearby). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```

> _Очікування: після випуску Ask іде тим, кого обрав пул. До виправлення 25 вересня перевірка ставила позначку знову, і Last-Minute Ask не можна було надіслати взагалі._

**Перевірка в базі — стан після спроби:**
```sql
select status, human_review, (select count(*) from blast_recipients r where r.blast_id = b.id)::int as recipients from blasts b where id = '58bea069-e1de-4a91-a85f-a41e3125c3fd'
```
| status | human_review | recipients |
| --- | --- | --- |
| active | false | 5 |


## 8. M7.11 — пасивний запис нікого не питає

**Адмін: створити пасивний запис** о 2026-09-25T11:03:42.017Z → HTTP 200
```json
{"action":"blast.create","asker_id":"5adafdcd-ffb7-4aed-88c9-d76772bdc168","question_text":"Is there a good toddler gym in Old Pasadena?","tier":"passive"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: надіслати — має відмовити** о 2026-09-25T11:03:49.351Z → HTTP 409
```json
{"action":"blast.send","id":"5e0e1473-3956-49e5-8c60-78a678d9e337"}
```
Відповідь:
```json
{"error":"A passive entry is a question on the demand map — it contacts nobody by design.","reason":"blast_contacts_nobody"}
```
**← Pando:** _(нічого не надіслано)_

**Перевірка в базі — стан:**
```sql
select tier, status, pool_target, expires_at from blasts where id = '5e0e1473-3956-49e5-8c60-78a678d9e337'
```
| tier | status | pool_target | expires_at |
| --- | --- | --- | --- |
| passive | draft | 0 | null |


## 9. M7.1 + M7.7 — кредит, термін і автоматичний кредит

**[SETUP] у Leah є невитрачений кредит на Targeted Ask** — ручна зміна, щоб не чекати днями:
```sql
insert into credits (person_id, kind, reason) values ('5adafdcd-ffb7-4aed-88c9-d76772bdc168', 'targeted_network_ask', 'lab_walk_seed')
```
_змінено рядків: 1_

**Адмін: створити Targeted Ask (має витратити кредит)** о 2026-09-25T11:03:58.179Z → HTTP 200
```json
{"action":"blast.create","asker_id":"5adafdcd-ffb7-4aed-88c9-d76772bdc168","question_text":"Best swim lessons for a nervous 5 year old?","tier":"targeted"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando:** _(нічого не надіслано)_

**Перевірка в базі — кредит витрачено в тій самій транзакції:**
```sql
select b.payment_status, b.credit_id is not null as has_credit, c.spent_at is not null as credit_spent from blasts b left join credits c on c.id = b.credit_id where b.id = '6ade988c-f295-4778-84ba-573994f2185b'
```
| payment_status | has_credit | credit_spent |
| --- | --- | --- |
| not_required | true | true |

**Адмін: створити Board Ask без кредиту (платний)** о 2026-09-25T11:04:06.648Z → HTTP 200
```json
{"action":"blast.create","asker_id":"5adafdcd-ffb7-4aed-88c9-d76772bdc168","question_text":"Anyone used a good birthday party venue?","tier":"board"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando:** _(нічого не надіслано)_

**Перевірка в базі — платіж очікується (оплату зараз не вимагаємо — PAYMENTS_ENFORCED = false):**
```sql
select tier, payment_status, credit_id from blasts where id = 'cc95be58-8bc1-4986-a6be-1146441cbca6'
```
| tier | payment_status | credit_id |
| --- | --- | --- |
| board | pending | null |

**[SETUP] вікно обох Ask закрилось годину тому** — ручна зміна, щоб не чекати днями:
```sql
update blasts set expires_at = now() - interval '1 hour' where id in ('6ade988c-f295-4778-84ba-573994f2185b', 'cc95be58-8bc1-4986-a6be-1146441cbca6')
```
_змінено рядків: 2_

**Адмін: надіслати прострочений — має відмовити** о 2026-09-25T11:04:14.274Z → HTTP 409
```json
{"action":"blast.send","id":"6ade988c-f295-4778-84ba-573994f2185b"}
```
Відповідь:
```json
{"error":"The window on this Ask has already closed, so nobody could answer inside the guarantee. Create a new one rather than sending this.","reason":"blast_expired"}
```
**← Pando:** _(нічого не надіслано)_

**Job `expire_blasts`** о 2026-09-25T11:04:24.647Z → HTTP 200
```json
{"job":"expire_blasts","sends":false,"ran":true,"outcome":"ok","processed":5,"skipped":0,"failed":0,"note":"1 credited"}
```
**← Pando:** _(нічого не надіслано)_

> _Очікування: обидві чернетки закриті; кредит повернуто лише за той Ask, що був оплачений кредитом. Board Ask ніхто не оплачував — нічого не взято, нічого не винні._

**Перевірка в базі — після expire_blasts:**
```sql
select tier, status, payment_status, credit_granted_at is not null as credit_granted from blasts where id in ('6ade988c-f295-4778-84ba-573994f2185b', 'cc95be58-8bc1-4986-a6be-1146441cbca6') order by tier
```
| tier | status | payment_status | credit_granted |
| --- | --- | --- | --- |
| board | expired | pending | false |
| targeted | expired | not_required | true |

**Перевірка в базі — кредити Leah:**
```sql
select kind, reason, spent_at is not null as spent from credits where person_id = '5adafdcd-ffb7-4aed-88c9-d76772bdc168' and created_at > '2026-09-25T11:00:38.756Z' order by created_at
```
| kind | reason | spent |
| --- | --- | --- |
| targeted_network_ask | lab_walk_seed | true |
| targeted_network_ask | blast_expired_unanswered | false |


## 10. M8.1 — 48 годин: тих, кого щойно питали, не питають знову

**Адмін: другий Ask від Maya** о 2026-09-25T11:04:32.782Z → HTTP 200
```json
{"action":"blast.create","asker_id":"1c0120d5-9e3b-4f0b-8c4f-c96cb60c4e9d","question_text":"Any good soccer clinics for 7 year olds?","tier":"targeted"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando:** _(нічого не надіслано)_

**Адмін: попередній перегляд пулу — другий Ask Maya** (той самий `selectPool`, що й розсилка):
- потрібно: 5 · замало (cold): false · потрібен перегляд людиною: {"required":false,"reason":null}
- **обрані:**
| name | phone | score | reasons |
| --- | --- | --- | --- |
| Leah Fischer | +16265550006 | 7.5 | school, adjacent_neighborhood, age_range_near, relevance:tenure |
| Tessa Nakamura | +16265550011 | 4 | adjacent_neighborhood, age_range, relevance:logistics, relevance:budget |
| Andrii Test | +13333333333 | 3 | adjacent_neighborhood, age_range |
| Janet Wolpert | +14157705998 | 0 |  |
| Referral Probe | +16265550781 | 0 |  |
- **відкладені:**
| name | phone | score | reason |
| --- | --- | --- | --- |
| Corinne Baptiste | +16265550016 | 7.5 | too_soon |
| Noor Haddad | +16265550007 | 4 | too_soon |
| Dana Whitfield | +16265550005 | 4 | too_soon |
| Rachel Alvarez | +16265550002 | 3.5 | too_soon |
| Carmen Delgado | +16265550008 | 3.5 | too_soon |
| Jessica Moreau | +16265550004 | 3.5 | too_soon |

> _Очікування: усі, кого питали в розділі 7 (Last-Minute Ask) або кілька годин тому в прогоні M9+M10, стоять у «відкладених» з причиною too_soon — без жодного [SETUP]._


## 11. M8.2 — місячний ліміт

**[SETUP] Leah (+16265550006): 5 на місяць, уже 5 запитів за 30 днів** — `stage:outreach cap`, ручна зміна:
```
Leah is on **5 a month** and has been asked **5 times** in 30 days — the
  most recent five days ago, so the 48-hour gap is clear and the only thing
  left to refuse them is the ceiling.

  Expect:
    · the pool preview holds them, reason "monthly_cap";
    · /admin/conversations shows 5 asked against the allowance they chose.

  Then: node scripts/stage-outreach.mjs clear
```

**Адмін: попередній перегляд пулу — після ліміту** (той самий `selectPool`, що й розсилка):
- потрібно: 5 · замало (cold): false · потрібен перегляд людиною: {"required":false,"reason":null}
- **обрані:**
| name | phone | score | reasons |
| --- | --- | --- | --- |
| Tessa Nakamura | +16265550011 | 4 | adjacent_neighborhood, age_range, relevance:logistics, relevance:budget |
| Andrii Test | +13333333333 | 3 | adjacent_neighborhood, age_range |
| Janet Wolpert | +14157705998 | 0 |  |
| Referral Probe | +16265550781 | 0 |  |
| Test Valia | +16528586575 | 0 |  |
- **відкладені:**
| name | phone | score | reason |
| --- | --- | --- | --- |
| Leah Fischer | +16265550006 | 7.5 | monthly_cap |
| Corinne Baptiste | +16265550016 | 7.5 | too_soon |
| Noor Haddad | +16265550007 | 4 | too_soon |
| Dana Whitfield | +16265550005 | 4 | too_soon |
| Rachel Alvarez | +16265550002 | 3.5 | too_soon |
| Carmen Delgado | +16265550008 | 3.5 | too_soon |
| Jessica Moreau | +16265550004 | 3.5 | too_soon |

> _Очікування: Leah відкладено з причиною monthly_cap._


## 12. M8.4 — governor: мовчазний контриб'ютор отримує менше запитів

**[SETUP] Tessa (+16265550011): обрано 10 на місяць, 5 запитів, 0 відповідей** — `stage:outreach governed`:
```
Tessa is on **10 a month**, has been asked **5 times** and answered
  **none**. The gap is clear.

  This is the one observation that can only be the governor: five is well
  inside a stated ten, so a refusal here is the 0% response rate lowering the
  ceiling by one tier — 10 → 5 — and the cap then being measured against 5.

  Expect:
    · /admin/contributors → "How they're doing": response rate 0%, row marked
      as governed;
    · the pool preview holds them, reason "monthly_cap", **while the standing
      view still says 10** — that distance between stated and effective is the
      rule doing its job.

  What will NOT happen is the "friendly note" the estimate names. Only the
  number moves; nothing texts them about it.

  Then: node scripts/stage-outreach.mjs clear
```

**Адмін: попередній перегляд пулу — governor знизив ліміт до 5** (той самий `selectPool`, що й розсилка):
- потрібно: 5 · замало (cold): false · потрібен перегляд людиною: {"required":false,"reason":null}
- **обрані:**
| name | phone | score | reasons |
| --- | --- | --- | --- |
| Andrii Test | +13333333333 | 3 | adjacent_neighborhood, age_range |
| Janet Wolpert | +14157705998 | 0 |  |
| Referral Probe | +16265550781 | 0 |  |
| Test Valia | +16528586575 | 0 |  |
| Andrii Test | +15555555555 | 0 |  |
- **відкладені:**
| name | phone | score | reason |
| --- | --- | --- | --- |
| Leah Fischer | +16265550006 | 7.5 | monthly_cap |
| Corinne Baptiste | +16265550016 | 7.5 | too_soon |
| Noor Haddad | +16265550007 | 4 | too_soon |
| Dana Whitfield | +16265550005 | 4 | too_soon |
| Tessa Nakamura | +16265550011 | 4 | monthly_cap |
| Rachel Alvarez | +16265550002 | 3.5 | too_soon |
| Carmen Delgado | +16265550008 | 3.5 | too_soon |
| Jessica Moreau | +16265550004 | 3.5 | too_soon |

> _Очікування: Tessa відкладено з причиною monthly_cap (10 → 5, бо відповідає на <25%)._

**[SETUP] той самий обсяг, але відповів на 4 з 5** — `stage:outreach responsive`:
```
cleared 5 staged row(s)

  Tessa is on **10 a month**, asked **5 times**, answered **4**.

  The control for the case above: same volume, same allowance, 80% response
  rate. Expect them **not** governed and still contactable — which is what
  proves the governor reads the rate rather than the volume.

  Then: node scripts/stage-outreach.mjs clear
```

**Адмін: попередній перегляд пулу — відповідає — ліміт 10 діє** (той самий `selectPool`, що й розсилка):
- потрібно: 5 · замало (cold): false · потрібен перегляд людиною: {"required":false,"reason":null}
- **обрані:**
| name | phone | score | reasons |
| --- | --- | --- | --- |
| Tessa Nakamura | +16265550011 | 4 | adjacent_neighborhood, age_range, relevance:logistics, relevance:budget |
| Andrii Test | +13333333333 | 3 | adjacent_neighborhood, age_range |
| Janet Wolpert | +14157705998 | 0 |  |
| Referral Probe | +16265550781 | 0 |  |
| Test Valia | +16528586575 | 0 |  |
- **відкладені:**
| name | phone | score | reason |
| --- | --- | --- | --- |
| Leah Fischer | +16265550006 | 7.5 | monthly_cap |
| Corinne Baptiste | +16265550016 | 7.5 | too_soon |
| Noor Haddad | +16265550007 | 4 | too_soon |
| Dana Whitfield | +16265550005 | 4 | too_soon |
| Rachel Alvarez | +16265550002 | 3.5 | too_soon |
| Carmen Delgado | +16265550008 | 3.5 | too_soon |
| Jessica Moreau | +16265550004 | 3.5 | too_soon |

> _Очікування: Tessa знову серед обраних. ⚠ Контриб'ютор не отримує повідомлення про зниження — ця частина 8.4 не побудована._

**Перевірка в базі — стан у адмінці (What they have earned):**
```sql
select first_name, monthly_contact_allowance, allowance_mode from people where phone = '+16265550011'
```
| first_name | monthly_contact_allowance | allowance_mode |
| --- | --- | --- |
| Tessa | 10 | fixed |


## 13. M8.3 — SETTINGS

**Перевірка в базі — ліміт до:**
```sql
select first_name, monthly_contact_allowance, allowance_mode from people where phone = '+14157705998'
```
| first_name | monthly_contact_allowance | allowance_mode |
| --- | --- | --- |
| Janet | 10 | fixed |

**→ Janet (+14157705998)** о 2026-09-25T11:05:01.125Z:
```
SETTINGS
```
**← Pando** (2026-09-25T11:05:03.942Z):
```
*→ Janet · (415) •••‑5998*  _transactional · settings_menu_
> Right now Pando may ask you up to 10 a month. Reply 1 for up to 5 a month, 2 for up to 10, or 3 for anytime it's genuinely relevant. However you set it, you'll never get two requests within 48 hours.
```

**→ Janet (+14157705998)** о 2026-09-25T11:05:07.048Z:
```
2
```
**← Pando** (2026-09-25T11:05:10.195Z, у треді):
```
*→ Janet · (415) •••‑5998*  _transactional · settings_confirmed_
> Done — up to 10 a month, and never twice within 48 hours.
```

**Перевірка в базі — ліміт після «2»:**
```sql
select first_name, monthly_contact_allowance, allowance_mode from people where phone = '+14157705998'
```
| first_name | monthly_contact_allowance | allowance_mode |
| --- | --- | --- |
| Janet | 10 | fixed |

**→ Janet (+14157705998)** о 2026-09-25T11:05:13.430Z:
```
BLAST SETTINGS
```
**← Pando** (2026-09-25T11:05:16.270Z, у треді):
```
*→ Janet · (415) •••‑5998*  _transactional · settings_menu_
> Right now Pando may ask you up to 10 a month. Reply 1 for up to 5 a month, 2 for up to 10, or 3 for anytime it's genuinely relevant. However you set it, you'll never get two requests within 48 hours.
```

**→ Janet (+14157705998)** о 2026-09-25T11:05:19.049Z:
```
3
```
**← Pando** (2026-09-25T11:05:22.227Z, у треді):
```
*→ Janet · (415) •••‑5998*  _transactional · settings_confirmed_
> Done — Pando will ask anytime a question is genuinely relevant, and never twice within 48 hours.
```

**Перевірка в базі — ліміт після «3»:**
```sql
select first_name, monthly_contact_allowance, allowance_mode from people where phone = '+14157705998'
```
| first_name | monthly_contact_allowance | allowance_mode |
| --- | --- | --- |
| Janet | null | as_relevant |

**→ Janet (+14157705998)** о 2026-09-25T11:05:25.428Z:
```
5
```
**← Pando** (2026-09-25T11:05:31.626Z, у треді):
```
*→ Janet · (415) •••‑5998*  _transactional · small_talk_
> Pando: ask me about local classes, camps, activities or childcare and I'll tell you what nearby parents recommend. Reply STOP to opt out, HELP for help.
```

> _«5» без щойно показаного меню — не зміна налаштувань; має піти звичайною обробкою._

**Перевірка в базі — ліміт не змінився:**
```sql
select first_name, monthly_contact_allowance, allowance_mode from people where phone = '+14157705998'
```
| first_name | monthly_contact_allowance | allowance_mode |
| --- | --- | --- |
| Janet | null | as_relevant |


## 14. Відписка: STOP прибирає з пулу, START повертає

**→ Andrii (+13333333333)** о 2026-09-25T11:05:34.900Z:
```
STOP
```
**← Pando:** _(нічого не надіслано)_

**Адмін: попередній перегляд пулу — після STOP** (той самий `selectPool`, що й розсилка):
- потрібно: 5 · замало (cold): false · потрібен перегляд людиною: {"required":false,"reason":null}
- **обрані:**
| name | phone | score | reasons |
| --- | --- | --- | --- |
| Tessa Nakamura | +16265550011 | 4 | adjacent_neighborhood, age_range, relevance:logistics, relevance:budget |
| Janet Wolpert | +14157705998 | 0 |  |
| Referral Probe | +16265550781 | 0 |  |
| Test Valia | +16528586575 | 0 |  |
| Andrii Test | +15555555555 | 0 |  |
- **відкладені:**
| name | phone | score | reason |
| --- | --- | --- | --- |
| Leah Fischer | +16265550006 | 7.5 | monthly_cap |
| Corinne Baptiste | +16265550016 | 7.5 | too_soon |
| Noor Haddad | +16265550007 | 4 | too_soon |
| Dana Whitfield | +16265550005 | 4 | too_soon |
| Rachel Alvarez | +16265550002 | 3.5 | too_soon |
| Carmen Delgado | +16265550008 | 3.5 | too_soon |
| Jessica Moreau | +16265550004 | 3.5 | too_soon |
| Andrii Test | +13333333333 | 3 | opted_out_or_test |

> _Очікування: Andrii відкладено (opted_out_or_test). На STOP Pando нічого не відповідає — це робить Twilio._

**→ Andrii (+13333333333)** о 2026-09-25T11:05:46.352Z:
```
START
```
**← Pando** (2026-09-25T11:05:47.851Z):
```
*→ Andrii · (333) •••‑3333*  _transactional_
> Pando: you're back on the list. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```

**Адмін: попередній перегляд пулу — після START** (той самий `selectPool`, що й розсилка):
- потрібно: 5 · замало (cold): false · потрібен перегляд людиною: {"required":false,"reason":null}
- **обрані:**
| name | phone | score | reasons |
| --- | --- | --- | --- |
| Tessa Nakamura | +16265550011 | 4 | adjacent_neighborhood, age_range, relevance:logistics, relevance:budget |
| Andrii Test | +13333333333 | 3 | adjacent_neighborhood, age_range |
| Janet Wolpert | +14157705998 | 0 |  |
| Referral Probe | +16265550781 | 0 |  |
| Test Valia | +16528586575 | 0 |  |
- **відкладені:**
| name | phone | score | reason |
| --- | --- | --- | --- |
| Leah Fischer | +16265550006 | 7.5 | monthly_cap |
| Corinne Baptiste | +16265550016 | 7.5 | too_soon |
| Noor Haddad | +16265550007 | 4 | too_soon |
| Dana Whitfield | +16265550005 | 4 | too_soon |
| Rachel Alvarez | +16265550002 | 3.5 | too_soon |
| Carmen Delgado | +16265550008 | 3.5 | too_soon |
| Jessica Moreau | +16265550004 | 3.5 | too_soon |


## 15. Розсилка другого Ask — правила перевіряються вдруге на відправці

**Адмін: надіслати другий Ask** о 2026-09-25T11:06:05.231Z → HTTP 200
```json
{"action":"blast.send","id":"466763e1-e4b9-46ef-8e6a-8a87958e4107"}
```
Відповідь:
```json
{"ok":true,"persisted":true,"actor":"lab-walk-m7"}
```
**← Pando** (2026-09-25T11:05:55.274Z):
```
*→ Tessa · (626) •••‑0011*  _outreach · blast_request_
> Pando: a parent nearby asked — "Any good soccer clinics for 7 year olds?" We thought of you (you're just nearby). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T11:05:57.361Z, у треді):
```
*→ Andrii · (333) •••‑3333*  _outreach · blast_request_
> Pando: a parent nearby asked — "Any good soccer clinics for 7 year olds?" We thought of you (you're just nearby). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T11:05:59.452Z, у треді):
```
*→ Janet · (415) •••‑5998*  _outreach · blast_request_
> Pando: a parent nearby asked — "Any good soccer clinics for 7 year olds?" We thought of you (you live nearby). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T11:06:01.559Z):
```
*→ Referral · (626) •••‑0781*  _outreach · blast_request_
> Pando: a parent nearby asked — "Any good soccer clinics for 7 year olds?" We thought of you (you live nearby). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T11:06:03.645Z):
```
*→ Test · (652) •••‑6575*  _outreach · blast_request_
> Pando: a parent nearby asked — "Any good soccer clinics for 7 year olds?" We thought of you (you live nearby). Reply with anything useful, or PASS to skip. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — кому пішло:**
```sql
select p.first_name, r.sent_at from blast_recipients r join people p on p.id = r.person_id where r.blast_id = '466763e1-e4b9-46ef-8e6a-8a87958e4107' order by p.first_name
```
| first_name | sent_at |
| --- | --- |
| Andrii | 2026-09-25T11:05:58.644Z |
| Janet | 2026-09-25T11:06:00.746Z |
| Referral | 2026-09-25T11:06:02.838Z |
| Tessa | 2026-09-25T11:05:56.554Z |
| Test | 2026-09-25T11:06:04.927Z |


## 16. Тихі години

**Перевірка в базі — чи зараз тихі години в Pasadena (8:00–21:00 PT):**
```sql
select to_char(now() at time zone 'America/Los_Angeles', 'HH24:MI') as pacific_time
```
| pacific_time |
| --- |
| 04:06 |

> _На реле тихі години не діють навмисно (тест-канал нікого не будить) — у app.log видно рядок «quiet hours ignored — relay», якщо зараз ніч у Pasadena. На справжньому Twilio такий запит було б відкладено._


Завершено: 2026-09-25T11:06:07.815Z
