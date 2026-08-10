-- Hand-added: drizzle-kit cannot express CREATE EXTENSION, and the two
-- gin_trgm_ops indexes below fail without it. If this baseline is ever
-- regenerated from scratch, this line has to come back.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."allowance_mode" AS ENUM('fixed', 'as_relevant');--> statement-breakpoint
CREATE TYPE "public"."attribution_mode" AS ENUM('anonymous_verified', 'first_name_safe');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('mentioned', 'invited', 'consented', 'declined', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."founding_status" AS ENUM('none', 'pending_founding', 'founding', 'request_invite');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('parent_submitted', 'admin_entered', 'migrated');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending_review', 'needs_detail', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."share_kind" AS ENUM('activity', 'caregiver', 'place', 'tip');--> statement-breakpoint
CREATE TABLE "affinity_weights" (
	"affinity_type" text PRIMARY KEY NOT NULL,
	"weight" integer NOT NULL,
	CONSTRAINT "affinity_weights_weight_check" CHECK ("affinity_weights"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "caregiver_nominations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caregiver_id" uuid NOT NULL,
	"person_id" uuid,
	"submission_id" uuid,
	"worked_for_family" boolean NOT NULL,
	"care_type" text,
	"how_known" text,
	"how_long" text,
	"last_worked" text,
	"cared_for_ages" text[],
	"strengths" text[],
	"in_their_words" text,
	"good_fit_for" text[],
	"caveat" text,
	"hire_again" text,
	"needs_horizon" text,
	"needs_change_type" text,
	"recontact_ok" boolean DEFAULT false NOT NULL,
	"pay_band" text,
	"pay_benchmark_consent" boolean DEFAULT false NOT NULL,
	"reference_willing" text,
	"invite_sent_by_parent" boolean DEFAULT false NOT NULL,
	"review_hold" boolean DEFAULT false NOT NULL,
	"hold_reasons" text[] DEFAULT '{}' NOT NULL,
	"status" "review_status" DEFAULT 'pending_review' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caregiver_nominations_caregiver_id_submission_id_key" UNIQUE("caregiver_id","submission_id"),
	CONSTRAINT "caregiver_nominations_hire_again_check" CHECK ("caregiver_nominations"."hire_again" in ('yes','hesitant','no')),
	CONSTRAINT "firsthand_only" CHECK ("caregiver_nominations"."worked_for_family"),
	CONSTRAINT "hold_when_hesitant" CHECK ("caregiver_nominations"."hire_again" is null or "caregiver_nominations"."hire_again" = 'yes' or "caregiver_nominations"."review_hold")
);
--> statement-breakpoint
CREATE TABLE "caregiver_profiles" (
	"caregiver_id" uuid PRIMARY KEY NOT NULL,
	"roles_wanted" text[],
	"age_experience" text[],
	"areas_served" text[],
	"drives" boolean,
	"days_available" text[],
	"hours_note" text,
	"rate_band" text,
	"open_to_reference_intros" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caregivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_initial" char(1),
	"is_adult" boolean NOT NULL,
	"consent_status" "consent_status" DEFAULT 'mentioned' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"discoverable" boolean DEFAULT false NOT NULL,
	"introducible" boolean DEFAULT false NOT NULL,
	"profile_person_id" uuid,
	"consent_evidence" jsonb,
	"provenance" "provenance" DEFAULT 'parent_submitted' NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adults_only" CHECK ("caregivers"."is_adult"),
	CONSTRAINT "visibility_requires_consent" CHECK ((not "caregivers"."active" and not "caregivers"."discoverable" and not "caregivers"."introducible") or "caregivers"."consent_status" = 'consented'),
	CONSTRAINT "ladder_order" CHECK (not "caregivers"."introducible" or "caregivers"."discoverable"),
	CONSTRAINT "consent_needs_evidence" CHECK ("caregivers"."consent_status" <> 'consented' or "caregivers"."consent_evidence" is not null)
);
--> statement-breakpoint
CREATE TABLE "children" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"birth_year" integer,
	"expecting" boolean DEFAULT false NOT NULL,
	"due_year" integer,
	"due_year_precision" text,
	CONSTRAINT "children_due_year_precision_check" CHECK ("children"."due_year_precision" in ('assumed_capture_year','stated')),
	CONSTRAINT "year_shape" CHECK (("children"."expecting" and "children"."birth_year" is null and "children"."due_year" is not null) or (not "children"."expecting" and "children"."birth_year" is not null))
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"text_version" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_scope_check" CHECK ("consents"."scope" in ('sms','follow_up','blast','reference','caregiver_profile')),
	CONSTRAINT "consents_status_check" CHECK ("consents"."status" in ('opted_in','declined','revoked'))
);
--> statement-breakpoint
CREATE TABLE "credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"spent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credits_kind_check" CHECK ("credits"."kind" in ('network_ask','targeted_network_ask'))
);
--> statement-breakpoint
CREATE TABLE "demand_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"question_text" text NOT NULL,
	"category" text,
	"sensitivity" text NOT NULL,
	"requires_human_review" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demand_signals_sensitivity_check" CHECK ("demand_signals"."sensitivity" in ('ordinary','peer_support','high_stakes')),
	CONSTRAINT "demand_signals_status_check" CHECK ("demand_signals"."status" in ('open','matched','answered','closed'))
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"severity" text NOT NULL,
	"reason" text NOT NULL,
	"subject_kind" text,
	"subject_id" uuid,
	"person_id" uuid,
	"field" text,
	"excerpt" text,
	"confidence" numeric(3, 2),
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text,
	CONSTRAINT "flags_severity_check" CHECK ("flags"."severity" in ('escalation','review','note')),
	CONSTRAINT "flags_status_check" CHECK ("flags"."status" in ('open','resolved','escalated'))
);
--> statement-breakpoint
CREATE TABLE "freshness_policy" (
	"kind" "share_kind" PRIMARY KEY NOT NULL,
	"stale_days" integer NOT NULL,
	"ageing_days" integer NOT NULL,
	CONSTRAINT "freshness_policy_stale_days_check" CHECK ("freshness_policy"."stale_days" > 0),
	CONSTRAINT "freshness_policy_ageing_days_check" CHECK ("freshness_policy"."ageing_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "life_relevance" (
	"person_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "life_relevance_person_id_dimension_value_pk" PRIMARY KEY("person_id","dimension","value"),
	CONSTRAINT "life_relevance_dimension_check" CHECK ("life_relevance"."dimension" in ('budget','logistics','family_setup','childcare','tenure','trust_circle'))
);
--> statement-breakpoint
CREATE TABLE "market_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" text NOT NULL,
	"category" text NOT NULL,
	"option_value" text NOT NULL,
	"label" text NOT NULL,
	"bands" text[],
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_options_market_id_category_option_value_key" UNIQUE("market_id","category","option_value")
);
--> statement-breakpoint
CREATE TABLE "message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"direction" text NOT NULL,
	"category" text NOT NULL,
	"template" text,
	"template_version" text,
	"provider_message_id" text,
	"responded_to" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_log_direction_check" CHECK ("message_log"."direction" in ('out','in')),
	CONSTRAINT "message_log_category_check" CHECK ("message_log"."category" in ('transactional','outreach'))
);
--> statement-breakpoint
CREATE TABLE "pending_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" text NOT NULL,
	"category" text NOT NULL,
	"submitted_value" text NOT NULL,
	"submitted_by" uuid,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_options_market_id_category_submitted_value_key" UNIQUE("market_id","category","submitted_value"),
	CONSTRAINT "pending_options_status_check" CHECK ("pending_options"."status" in ('pending','approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text,
	"first_name" text,
	"last_name" text,
	"market_id" text DEFAULT 'pasadena' NOT NULL,
	"neighborhood" text,
	"invite_code" text,
	"invited_via_group" text,
	"source" text,
	"time_in_area" text,
	"moved_from" text,
	"attribution" "attribution_mode",
	"aggregate_display" boolean DEFAULT true NOT NULL,
	"monthly_contact_allowance" integer,
	"allowance_mode" "allowance_mode" DEFAULT 'fixed' NOT NULL,
	"topic_preferences" text[] DEFAULT '{}' NOT NULL,
	"topics_lived_experience" text[] DEFAULT '{}' NOT NULL,
	"wants_founding" boolean DEFAULT true NOT NULL,
	"raw_answers" jsonb,
	"child_ages_at_capture" integer[],
	"phone_verified_at" timestamp with time zone,
	"founding" "founding_status" DEFAULT 'none' NOT NULL,
	"profile_completeness" integer DEFAULT 0 NOT NULL,
	"profile_captured_at" timestamp with time zone,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_phone_unique" UNIQUE("phone"),
	CONSTRAINT "allowance_shape" CHECK (("people"."allowance_mode" = 'as_relevant' and "people"."monthly_contact_allowance" is null) or ("people"."allowance_mode" = 'fixed' and "people"."monthly_contact_allowance" in (1,3,5))),
	CONSTRAINT "verified_if_named" CHECK ("people"."phone" is null or "people"."phone_verified_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "person_schools" (
	"person_id" uuid NOT NULL,
	"option_value" text NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "person_schools_person_id_option_value_pk" PRIMARY KEY("person_id","option_value"),
	CONSTRAINT "person_schools_status_check" CHECK ("person_schools"."status" in ('current','former','not_yet','homeschool'))
);
--> statement-breakpoint
CREATE TABLE "place_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" uuid NOT NULL,
	"person_id" uuid,
	"submission_id" uuid,
	"firsthand" boolean NOT NULL,
	"child_age_at_time" integer[],
	"last_there" text,
	"how_much" text,
	"recommendation" text,
	"what_makes_it_great" text,
	"caveat" text,
	"caveat_answered" boolean DEFAULT false NOT NULL,
	"who_for" text,
	"who_not_for" text,
	"price_band" text,
	"price_unit" text,
	"worth_it" text,
	"follow_up_ok" boolean DEFAULT false NOT NULL,
	"tip_text" text,
	"status" "review_status" DEFAULT 'pending_review' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_contributions_place_id_submission_id_key" UNIQUE("place_id","submission_id"),
	CONSTRAINT "price_shape" CHECK ("place_contributions"."price_band" is null or "place_contributions"."price_band" in ('free','prefer_not_to_say') or "place_contributions"."price_unit" is not null)
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" text NOT NULL,
	"kind" "share_kind" NOT NULL,
	"name" text NOT NULL,
	"venue" text,
	"neighborhoods" text[],
	"age_bands" text[],
	"place_type" text,
	"topic" text,
	"status" "review_status" DEFAULT 'pending_review' NOT NULL,
	"provenance" "provenance" DEFAULT 'parent_submitted' NOT NULL,
	"confidence" numeric(3, 2),
	"last_confirmed_at" timestamp with time zone,
	"last_pinged_at" timestamp with time zone,
	"freshness_state" text DEFAULT 'fresh' NOT NULL,
	"validated_count" integer DEFAULT 0 NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "places_kind_check" CHECK ("places"."kind" <> 'caregiver'),
	CONSTRAINT "places_confidence_check" CHECK ("places"."confidence" is null or ("places"."confidence" >= 0 and "places"."confidence" <= 1)),
	CONSTRAINT "places_freshness_state_check" CHECK ("places"."freshness_state" in ('fresh','ageing','stale'))
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid,
	"referred_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"credited_at" timestamp with time zone,
	CONSTRAINT "referrals_referrer_id_referred_id_key" UNIQUE("referrer_id","referred_id"),
	CONSTRAINT "referrals_status_check" CHECK ("referrals"."status" in ('pending','profile_complete','credited','void'))
);
--> statement-breakpoint
CREATE TABLE "restricted_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nomination_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restricted_notes_kind_check" CHECK ("restricted_notes"."kind" in ('private_note','hesitation_reason'))
);
--> statement-breakpoint
CREATE TABLE "seed_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"messages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_opt_outs" (
	"phone" text PRIMARY KEY NOT NULL,
	"keyword" text NOT NULL,
	"opted_out_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_affinities" (
	"person_id" uuid NOT NULL,
	"affinity_type" text NOT NULL,
	"affinity_value" text NOT NULL,
	"weight_at_capture" integer,
	CONSTRAINT "social_affinities_person_id_affinity_type_affinity_value_pk" PRIMARY KEY("person_id","affinity_type","affinity_value")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"person_id" uuid,
	"kind" "share_kind" NOT NULL,
	"fields" jsonb NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "caregiver_nominations" ADD CONSTRAINT "caregiver_nominations_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_nominations" ADD CONSTRAINT "caregiver_nominations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_nominations" ADD CONSTRAINT "caregiver_nominations_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD CONSTRAINT "caregiver_profiles_caregiver_id_caregivers_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregivers" ADD CONSTRAINT "caregivers_profile_person_id_people_id_fk" FOREIGN KEY ("profile_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "children" ADD CONSTRAINT "children_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_signals" ADD CONSTRAINT "demand_signals_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_relevance" ADD CONSTRAINT "life_relevance_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_options" ADD CONSTRAINT "pending_options_submitted_by_people_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_schools" ADD CONSTRAINT "person_schools_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_contributions" ADD CONSTRAINT "place_contributions_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_contributions" ADD CONSTRAINT "place_contributions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_contributions" ADD CONSTRAINT "place_contributions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_people_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_id_people_id_fk" FOREIGN KEY ("referred_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted_notes" ADD CONSTRAINT "restricted_notes_nomination_id_caregiver_nominations_id_fk" FOREIGN KEY ("nomination_id") REFERENCES "public"."caregiver_nominations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_conversations" ADD CONSTRAINT "seed_conversations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_affinities" ADD CONSTRAINT "social_affinities_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at" desc);--> statement-breakpoint
CREATE INDEX "caregiver_nominations_cg_idx" ON "caregiver_nominations" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "caregiver_nominations_review_idx" ON "caregiver_nominations" USING btree ("status","review_hold","created_at") WHERE not is_test;--> statement-breakpoint
CREATE INDEX "caregivers_market_idx" ON "caregivers" USING btree ("market_id","consent_status") WHERE not is_test;--> statement-breakpoint
CREATE INDEX "caregivers_name_trgm_idx" ON "caregivers" USING gin (lower("first_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "children_person_idx" ON "children" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "consents_person_idx" ON "consents" USING btree ("person_id","scope","captured_at" desc);--> statement-breakpoint
CREATE INDEX "credits_person_idx" ON "credits" USING btree ("person_id") WHERE spent_at is null;--> statement-breakpoint
CREATE INDEX "demand_signals_queue_idx" ON "demand_signals" USING btree ("status","sensitivity","created_at" desc) WHERE not is_test;--> statement-breakpoint
CREATE INDEX "flags_open_idx" ON "flags" USING btree ("status","severity","created_at" desc);--> statement-breakpoint
CREATE INDEX "market_options_lookup_idx" ON "market_options" USING btree ("market_id","category") WHERE active;--> statement-breakpoint
CREATE INDEX "message_log_person_idx" ON "message_log" USING btree ("person_id","sent_at" desc);--> statement-breakpoint
CREATE INDEX "people_market_idx" ON "people" USING btree ("market_id") WHERE not is_test;--> statement-breakpoint
CREATE INDEX "people_founding_idx" ON "people" USING btree ("founding") WHERE not is_test;--> statement-breakpoint
CREATE INDEX "people_created_idx" ON "people" USING btree ("created_at" desc);--> statement-breakpoint
CREATE INDEX "place_contributions_place_idx" ON "place_contributions" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "place_contributions_person_idx" ON "place_contributions" USING btree ("person_id","status");--> statement-breakpoint
CREATE INDEX "place_contributions_review_idx" ON "place_contributions" USING btree ("status","created_at") WHERE not is_test;--> statement-breakpoint
CREATE INDEX "places_market_idx" ON "places" USING btree ("market_id","kind","status") WHERE not is_test;--> statement-breakpoint
CREATE INDEX "places_name_trgm_idx" ON "places" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "restricted_notes_nom_idx" ON "restricted_notes" USING btree ("nomination_id");--> statement-breakpoint
CREATE INDEX "social_affinities_lookup_idx" ON "social_affinities" USING btree ("affinity_type","affinity_value");--> statement-breakpoint
CREATE INDEX "submissions_person_idx" ON "submissions" USING btree ("person_id","received_at" desc);