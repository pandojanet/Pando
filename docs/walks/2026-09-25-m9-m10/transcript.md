# Прогін M9 + M10 через Slack-реле — протокол

Почато: 2026-09-25T08:58:11.408Z

**Середовище.** Локальна збірка (`.next/standalone`) на порту 4197 з `MESSAGING_RELAY=slack`, `SLACK_API_BASE` → локальний стаб Slack на порту 4198, `JOBS_SECRET` задано, Twilio порожній. База — локальна демо-база (не прод). Кожне повідомлення «від батька» — підписана Slack-подія, яку надсилає цей сценарій. Кожен текст «← Pando» нижче — дослівно те, що застосунок відправив у Slack API (з файлу стабу `posts.jsonl`, який додано поруч). Перший рядок кожного поста — службовий заголовок реле (кому, масковано, і яка категорія/шаблон), далі після `>` — текст повідомлення.

**Про час.** «Почато» — час бази (`now()` у Postgres); час біля «→» і біля job-а — годинник цієї машини в момент виклику (для job-а — коли повернулась HTTP-відповідь, тому його пости мають раніший час); час біля «← Pando» — коли стаб отримав запит від застосунку. Годинники бази й машини розходяться приблизно на секунду.

**Сирі дані поруч:** `posts.jsonl` — усе, що застосунок відправив у Slack API, по рядку на пост; `app.log` — лог сервера за цей прогін.

Демо-учасники: Dana, Noor, Carmen (контриб'ютори, M10.1) · Priya — питає (M9) · Sarah, Rachel, Dana — контриб'ютори Little Maestros · Maya — питає після відкликання.

## 1. M10.1 — додати рекомендацію текстом (Dana)

**→ Dana (+16265550005)** о 2026-09-25T08:58:10.671Z:
```
ADD
```
**← Pando** (2026-09-25T08:58:15.286Z):
```
*→ Dana · (626) •••‑0005*  _transactional · capture_kind_
> Pando: happy to add it. Is it a class, a camp, a place, or a tip? Reply with one word.
```

**→ Dana (+16265550005)** о 2026-09-25T08:58:17.895Z:
```
class
```
**← Pando** (2026-09-25T08:58:21.702Z, у треді):
```
*→ Dana · (626) •••‑0005*  _transactional · capture_name_
> Pando: what is it called? Just the name is fine.
```

**→ Dana (+16265550005)** о 2026-09-25T08:58:24.499Z:
```
Lab Pottery Studio
```
**← Pando** (2026-09-25T08:58:28.479Z, у треді):
```
*→ Dana · (626) •••‑0005*  _transactional · capture_firsthand_
> Pando: did you use it yourself, or did you hear about it from someone? Reply USED or HEARD.
```

**→ Dana (+16265550005)** о 2026-09-25T08:58:31.303Z:
```
USED
```
**← Pando** (2026-09-25T08:58:35.241Z, у треді):
```
*→ Dana · (626) •••‑0005*  _transactional · capture_recommend_
> Pando: would you recommend it to another parent? Reply YES, YES BUT (if there's a catch), or NO.
```

**→ Dana (+16265550005)** о 2026-09-25T08:58:38.130Z:
```
YES BUT
```
**← Pando** (2026-09-25T08:58:41.992Z, у треді):
```
*→ Dana · (626) •••‑0005*  _transactional · capture_detail_
> Pando: last one, anything another parent should know? Reply with a sentence, or SKIP.
```

**→ Dana (+16265550005)** о 2026-09-25T08:58:45.010Z:
```
SKIP
```
**← Pando** (2026-09-25T08:58:51.164Z, у треді):
```
*→ Dana · (626) •••‑0005*  _transactional · capture_saved_
> Pando: got it, Lab Pottery Studio is saved. A person reads every new recommendation before it reaches anyone, so it won't show up straight away. Thank you. Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — запис створено і чекає перевірки:**
```sql
select s.name, s.kind, s.status as share_status, s.neighborhoods, s.provenance, sc.status as contribution_status, sc.firsthand, sc.recommendation
     from shares s join share_contributions sc on sc.share_id = s.id where s.name = 'Lab Pottery Studio'
```
| name | kind | share_status | neighborhoods | provenance | contribution_status | firsthand | recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lab Pottery Studio | activity | pending_review | ["madison-heights"] | parent_submitted | pending_review | true | yes_with_caveats |


## 2. M10.1 — няня текстом має бути відхилена (Noor)

**→ Noor (+16265550007)** о 2026-09-25T08:58:54.237Z:
```
I want to add our nanny Marisol, she is wonderful
```
**← Pando** (2026-09-25T08:58:57.811Z):
```
*→ Noor · (626) •••‑0007*  _transactional · capture_caregiver_redirect_
> Pando: for a nanny or sitter we ask a few careful questions first, including whether you employed them yourself. Takes two minutes: pando.is/share Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — жодного запису няні не створено після початку прогону:**
```sql
select count(*) as caregivers_created, (select count(*) from caregiver_nominations where created_at > '2026-09-25T08:58:11.408Z') as nominations_created
     from caregivers where created_at > '2026-09-25T08:58:11.408Z'
```
| caregivers_created | nominations_created |
| --- | --- |
| 0 | 0 |


## 3. M11.4 — назва-людина відхиляється окремим текстом (Noor)

**→ Noor (+16265550007)** о 2026-09-25T08:59:00.963Z:
```
ADD
```
**← Pando** (2026-09-25T08:59:05.521Z, у треді):
```
*→ Noor · (626) •••‑0007*  _transactional · capture_kind_
> Pando: happy to add it. Is it a class, a camp, a place, or a tip? Reply with one word.
```

**→ Noor (+16265550007)** о 2026-09-25T08:59:08.471Z:
```
class
```
**← Pando** (2026-09-25T08:59:12.400Z, у треді):
```
*→ Noor · (626) •••‑0007*  _transactional · capture_name_
> Pando: what is it called? Just the name is fine.
```

**→ Noor (+16265550007)** о 2026-09-25T08:59:15.350Z:
```
Ms. Diane
```
**← Pando** (2026-09-25T08:59:19.232Z, у треді):
```
*→ Noor · (626) •••‑0007*  _transactional · capture_named_person_redirect_
> Pando: that sounds like a person rather than a place. For a person we ask a few careful questions first. Takes two minutes: pando.is/share Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — запису «Ms. Diane» немає:**
```sql
select count(*) as rows from shares where name ilike '%diane%' and created_at > '2026-09-25T08:58:11.408Z'
```
| rows |
| --- |
| 0 |


## 4. M10.1 — NEVER MIND зупиняє без відписки (Carmen)

**→ Carmen (+16265550008)** о 2026-09-25T08:59:22.393Z:
```
ADD
```
**← Pando** (2026-09-25T08:59:26.973Z):
```
*→ Carmen · (626) •••‑0008*  _transactional · capture_kind_
> Pando: happy to add it. Is it a class, a camp, a place, or a tip? Reply with one word.
```

**→ Carmen (+16265550008)** о 2026-09-25T08:59:29.830Z:
```
NEVER MIND
```
**← Pando** (2026-09-25T08:59:33.674Z, у треді):
```
*→ Carmen · (626) •••‑0008*  _transactional · capture_cancelled_
> Pando: no problem, nothing was saved. Text ADD whenever you want to start again. Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — додавання покинуто, відписки немає:**
```sql
select p.first_name, c.status, (select count(*) from sms_opt_outs o where o.phone = p.phone) as opt_out_rows
     from sms_captures c join people p on p.id = c.person_id
    where c.created_at > '2026-09-25T08:58:11.408Z' order by c.created_at
```
| first_name | status | opt_out_rows |
| --- | --- | --- |
| Dana | saved | 0 |
| Noor | abandoned | 0 |
| Carmen | abandoned | 0 |


## 5. M9 — Priya питає, відповідь надсилається

**→ Priya (+16265550003)** о 2026-09-25T08:59:36.856Z:
```
any good toddler classes in South Pasadena?
```
**← Pando** (2026-09-25T08:59:55.247Z):
```
*→ Priya · (626) •••‑0003*  _transactional · answer_sent_
> 3 parents near you have used Little Maestros, a class in South Pasadena, last confirmed Sep 2026.
> Best for: a cautious toddler who warms up slowly.
> One said: "Small groups and the teacher is unbelievably patient with the ones who won't join in for the first month."
> Heads up: Saturdays are packed - take the 9am.
> About $50-100 a month.
> Also nearby: Rose Bowl Aquatics parent & me, a class in Old Pasadena, 2 parents, $100-200 a term; La Pintoresca Branch Library, a place in Northwest Pasadena, 2 parents, Free.
> 
> Public/general information:
> Encore Music Pasadena - early childhood music classes in South Pasadena. ages 7 months to 2 years.
> Persistence Gymnastics - toddler gymnastics classes in South Pasadena. ages 1.5-3.5 years.
```

**Перевірка в базі — відповідь у черзі й надіслана, з якими записами:**
```sql
select a.id, a.status, a.hold_reason, a.next_step, a.sent_at, (select array_agg(name order by name) from shares where id = any(a.share_ids)) as used_records
     from answers a where a.phone = '+16265550003' and a.created_at > '2026-09-25T08:58:11.408Z' order by a.created_at desc limit 1
```
| id | status | hold_reason | next_step | sent_at | used_records |
| --- | --- | --- | --- | --- | --- |
| 2c03c036-17e1-430a-b37d-2e77662dbaeb | sent | not_held | none | 2026-09-25T08:59:56.516Z | ["La Pintoresca Branch Library","Little Maestros","Rose Bowl Aquatics parent & me"] |


## 6. M9.1 — «did it help?» через 3–5 днів

**[SETUP] відповідь надіслано 4 дні тому (вікно для заняття — 3–5 днів)** — ручна зміна, щоб не чекати днями:
```sql
update answers set sent_at = now() - interval '4 days' where id = '2c03c036-17e1-430a-b37d-2e77662dbaeb'
```
_змінено рядків: 1_

**Перевірка в базі — які відповіді зараз у вікні промпту (до запуску job-а):**
```sql
select a.phone, a.sent_at, a.helped_asked_at, a.helped from answers a
    where a.status = 'sent' and a.helped_asked_at is null and a.sent_at between now() - interval '14 days' and now() - interval '3 days'
```
| phone | sent_at | helped_asked_at | helped |
| --- | --- | --- | --- |
| +380986258951 | 2026-09-21T07:38:42.976Z | null | null |
| +380986258951 | 2026-09-21T07:00:09.698Z | null | null |
| +16265550003 | 2026-09-21T08:59:59.423Z | null | null |
| +16265550199 | 2026-09-14T13:20:31.318Z | null | null |

**Job `thanks_prompt`** о 2026-09-25T09:00:04.732Z → HTTP 200
```json
{"job":"thanks_prompt","sends":true,"ran":true,"outcome":"ok","processed":2,"skipped":2,"failed":0}
```
**← Pando** (2026-09-25T09:00:01.268Z):
```
*→ Valentyna · 098 •••‑8951*  _outreach · thanks_prompt_
> Pando: a few days ago we sent you a recommendation from a local parent. Did it help? Reply YES or NO — a yes lets us thank whoever shared it. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T09:00:03.680Z, у треді):
```
*→ Priya · (626) •••‑0003*  _outreach · thanks_prompt_
> Pando: a few days ago we sent you a recommendation from a local parent. Did it help? Reply YES or NO — a yes lets us thank whoever shared it. Reply STOP to opt out, HELP for help.
```

**→ Priya (+16265550003)** о 2026-09-25T09:00:06.309Z:
```
YES
```
**← Pando** (2026-09-25T09:00:12.440Z, у треді):
```
*→ Priya · (626) •••‑0003*  _transactional · helped_reply_saved_
> Pando: glad it helped - thanks for letting us know. Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — відповідь позначена як «допомогло»:**
```sql
select helped, helped_asked_at from answers where id = '2c03c036-17e1-430a-b37d-2e77662dbaeb'
```
| helped | helped_asked_at |
| --- | --- |
| true | 2026-09-25T09:00:04.957Z |

**Перевірка в базі — події impact для контриб'юторів:**
```sql
select e.kind, p.first_name, s.name from impact_events e join people p on p.id = e.person_id left join shares s on s.id = e.share_id
    where e.created_at > '2026-09-25T08:58:11.408Z' order by p.first_name
```
| kind | first_name | name |
| --- | --- | --- |
| answer_used | Corinne | La Pintoresca Branch Library |
| answer_used | Dana | Little Maestros |
| answer_used | Grace | Rose Bowl Aquatics parent & me |
| answer_used | Leah | La Pintoresca Branch Library |
| answer_used | Leah | Rose Bowl Aquatics parent & me |
| answer_used | Rachel | Little Maestros |
| answer_used | Sarah | Little Maestros |


## 7. M9.2 — подяки контриб'юторам

**Job `thanks_delivery`** о 2026-09-25T09:00:25.313Z → HTTP 200
```json
{"job":"thanks_delivery","sends":true,"ran":true,"outcome":"ok","processed":6,"skipped":0,"failed":0}
```
**← Pando** (2026-09-25T09:00:17.679Z):
```
*→ Rachel · (626) •••‑0002*  _outreach · thanks_
> Pando: a parent nearby used your recommendation — Little Maestros. Thank you. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T09:00:19.069Z):
```
*→ Grace · (626) •••‑0010*  _outreach · thanks_
> Pando: a parent nearby used your recommendation — Rose Bowl Aquatics parent & me. Thank you. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T09:00:20.456Z):
```
*→ Leah · (626) •••‑0006*  _outreach · thanks_
> Pando: a parent nearby used your recommendation — La Pintoresca Branch Library and Rose Bowl Aquatics parent & me. Thank you. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T09:00:21.840Z):
```
*→ Corinne · (626) •••‑0016*  _outreach · thanks_
> Pando: a parent nearby used your recommendation — La Pintoresca Branch Library. Thank you. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T09:00:23.229Z):
```
*→ Sarah · (626) •••‑0000*  _outreach · thanks_
> Pando: a parent nearby used your recommendation — Little Maestros. Thank you. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```
**← Pando** (2026-09-25T09:00:24.616Z, у треді):
```
*→ Dana · (626) •••‑0005*  _outreach · thanks_
> Pando: a parent nearby used your recommendation — Little Maestros. Thank you. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
```


### 7a. M9.5 — повторний запуск того ж дня відмовляє

**Job `thanks_delivery`** о 2026-09-25T09:00:27.222Z → HTTP 200
```json
{"job":"thanks_delivery","sends":true,"ran":false,"reason":"too_soon","outcome":"skipped","processed":0,"skipped":0,"failed":0}
```
**← Pando:** _(нічого не надіслано)_


### 7b. Одна подяка на тиждень

**[SETUP] прибрати замок 20 годин, щоб запустити job ще раз** — ручна зміна, щоб не чекати днями:
```sql
delete from job_runs where job = 'thanks_delivery' and started_at > '2026-09-25T08:58:11.408Z'
```
_змінено рядків: 1_

**Job `thanks_delivery`** о 2026-09-25T09:00:34.043Z → HTTP 200
```json
{"job":"thanks_delivery","sends":true,"ran":true,"outcome":"ok","processed":0,"skipped":0,"failed":0}
```
**← Pando:** _(нічого не надіслано)_

**Перевірка в базі — подяка не запускає паузу 48 годин і не рахується як запит:**
```sql
select p.first_name,
          (select count(*) from message_log m where m.person_id = p.id and m.template = 'thanks' and m.sent_at > '2026-09-25T08:58:11.408Z') as thanks_sent,
          (select max(sent_at) from message_log m where m.person_id = p.id and m.direction = 'out' and m.category = 'outreach' and m.template is distinct from 'thanks') as last_request
     from people p where p.phone in ('+16265550000','+16265550002','+16265550005','+16265550006','+16265550010') order by p.first_name
```
| first_name | thanks_sent | last_request |
| --- | --- | --- |
| Dana | 1 | null |
| Grace | 1 | null |
| Leah | 1 | null |
| Rachel | 1 | null |
| Sarah | 1 | null |


## 8. M10.3 — пінг про свіжість

**[SETUP] Little Maestros підтверджено 100 днів тому (поріг — 90)** — ручна зміна, щоб не чекати днями:
```sql
update shares set last_confirmed_at = now() - interval '100 days' where name = 'Little Maestros'
```
_змінено рядків: 1_

**[SETUP] промпт Priya — 3 дні тому, щоб пауза 48 годин не заблокувала пінг** — ручна зміна, щоб не чекати днями:
```sql
update message_log set sent_at = sent_at - interval '3 days' where template = 'thanks_prompt' and person_id = (select id from people where phone = '+16265550003') and sent_at > '2026-09-25T08:58:11.408Z'
```
_змінено рядків: 1_

**Job `freshness_ping`** о 2026-09-25T09:00:48.161Z → HTTP 200
```json
{"job":"freshness_ping","sends":true,"ran":true,"outcome":"ok","processed":4,"skipped":0,"failed":0}
```
**← Pando** (2026-09-25T09:00:41.901Z, у треді):
```
*→ Rachel · (626) •••‑0002*  _outreach · freshness_ping_
> Quick one: is Little Maestros still worth recommending? Reply yes, no, or PASS to skip.
```
**← Pando** (2026-09-25T09:00:43.641Z, у треді):
```
*→ Priya · (626) •••‑0003*  _outreach · freshness_ping_
> Quick one: is Little Maestros still worth recommending? Reply yes, no, or PASS to skip.
```
**← Pando** (2026-09-25T09:00:45.376Z, у треді):
```
*→ Sarah · (626) •••‑0000*  _outreach · freshness_ping_
> Quick one: is Little Maestros still worth recommending? Reply yes, no, or PASS to skip.
```
**← Pando** (2026-09-25T09:00:47.112Z, у треді):
```
*→ Dana · (626) •••‑0005*  _outreach · freshness_ping_
> Quick one: is Little Maestros still worth recommending? Reply yes, no, or PASS to skip.
```

**Перевірка в базі — кого спитали:**
```sql
select p.first_name, s.name from freshness_pings f join people p on p.id = f.person_id join shares s on s.id = f.share_id where f.asked_at > '2026-09-25T08:58:11.408Z' order by p.first_name
```
| first_name | name |
| --- | --- |
| Dana | Little Maestros |
| Priya | Little Maestros |
| Rachel | Little Maestros |
| Sarah | Little Maestros |


## 9. M10.2 — refresh, відкликання, vouch, мовчання

**→ Dana (+16265550005)** о 2026-09-25T09:00:49.898Z:
```
yes
```
**← Pando** (2026-09-25T09:00:55.457Z, у треді):
```
*→ Dana · (626) •••‑0005*  _transactional · freshness_reply_saved_
> Pando: thanks - noted that it's still worth recommending. Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — Dana (контриб'ютор) — refresh: дата оновилась:**
```sql
select last_confirmed_at, freshness_state from shares where name = 'Little Maestros'
```
| last_confirmed_at | freshness_state |
| --- | --- |
| 2026-09-25T09:00:54.304Z | fresh |

**→ Rachel (+16265550002)** о 2026-09-25T09:00:58.151Z:
```
no
```
**← Pando** (2026-09-25T09:01:04.362Z, у треді):
```
*→ Rachel · (626) •••‑0002*  _transactional · freshness_reply_saved_
> Pando: thanks for telling us - a person will take another look at it. Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — Rachel — відкликання: запис застарілий, але не відхилений:**
```sql
select status, last_confirmed_at, freshness_state from shares where name = 'Little Maestros'
```
| status | last_confirmed_at | freshness_state |
| --- | --- | --- |
| approved | 2026-09-25T09:00:54.304Z | stale |

**Перевірка в базі — флаг для людини:**
```sql
select reason, severity, status, subject_kind from flags where created_at > '2026-09-25T08:58:11.408Z'
```
| reason | severity | status | subject_kind |
| --- | --- | --- | --- |
| recommendation_withdrawn | review | open | share |

**→ Priya (+16265550003)** о 2026-09-25T09:01:07.799Z:
```
yes
```
**← Pando** (2026-09-25T09:01:13.342Z, у треді):
```
*→ Priya · (626) •••‑0003*  _transactional · freshness_reply_saved_
> Pando: thanks - noted that it's still worth recommending. Reply STOP to opt out, HELP for help.
```

**Перевірка в базі — Priya (не контриб'ютор, сказала «допомогло») — vouch: другий firsthand, чекає перевірки:**
```sql
select p.first_name, sc.status, sc.firsthand from share_contributions sc join people p on p.id = sc.person_id
    where sc.share_id = (select id from shares where name = 'Little Maestros') order by sc.created_at
```
| first_name | status | firsthand |
| --- | --- | --- |
| Sarah | approved | true |
| Rachel | approved | true |
| Dana | approved | true |
| Andrii | pending_review | true |
| Priya | pending_review | true |

**Перевірка в базі — позначка «застарілий» після vouch не знялася:**
```sql
select last_confirmed_at, freshness_state from shares where name = 'Little Maestros'
```
| last_confirmed_at | freshness_state |
| --- | --- |
| 2026-09-25T09:00:54.304Z | stale |

**Перевірка в базі — стан пінгів (Sarah мовчить):**
```sql
select p.first_name, f.answered_at is not null as answered, f.still_good from freshness_pings f join people p on p.id = f.person_id where f.asked_at > '2026-09-25T08:58:11.408Z' order by p.first_name
```
| first_name | answered | still_good |
| --- | --- | --- |
| Dana | true | true |
| Priya | true | true |
| Rachel | true | false |
| Sarah | false | null |


## 10. Відповідь після відкликання (виправлення 25 вересня)

**→ Maya (+16265550001)** о 2026-09-25T09:01:16.462Z:
```
any toddler music classes in South Pasadena?
```
**← Pando** (2026-09-25T09:01:32.494Z):
```
*→ Maya · (626) •••‑0001*  _transactional · answer_sent_
> 3 parents near you have used Little Maestros, a class in South Pasadena, last confirmed Sep 2026.
> Best for: a cautious toddler who warms up slowly.
> One said: "Small groups and the teacher is unbelievably patient with the ones who won't join in for the first month."
> Heads up: Saturdays are packed - take the 9am.
> About $50-100 a month.
> One parent recently said it may no longer be worth it, so check before you book.
> 
> Public/general information:
> Encore Music School - Parent and toddler music classes in South Pasadena. Classes for ages 0-3: Single Notes (1-year-olds), Rhythm & Twos (2-year-olds).
> LoveBug & Me Music - Parent and child music classes in South Pasadena. Ages 0-5, 45-minute weekly classes.
> Want me to ask a few nearby parents for more?
```


## 11. M9.3 — impact_sync

**Job `impact_sync`** о 2026-09-25T09:01:36.710Z → HTTP 200
```json
{"job":"impact_sync","sends":false,"ran":true,"outcome":"ok","processed":0,"skipped":0,"failed":0}
```
**← Pando:** _(нічого не надіслано)_

**Перевірка в базі — підсумок impact-подій прогону:**
```sql
select kind, count(*) from impact_events where created_at > '2026-09-25T08:58:11.408Z' group by kind order by kind
```
| kind | count |
| --- | --- |
| answer_used | 7 |
| freshness_confirmed | 3 |


Завершено: 2026-09-25T09:01:41.905Z
