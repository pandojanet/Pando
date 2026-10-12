import type { ShareKind } from "./types";

/**
 * The client's sub-categories (9 Oct, *Categories Questions*, added 10/7 JW),
 * inside the five menu buttons the chat already has.
 *
 * A sub-category is **not** a new `share_kind`: the button the parent tapped is
 * still the kind, and `shares.subcategory` (`drizzle/0056`) narrows it. Null is
 * a real value — the classifier was unsure, or switched off, and the card was
 * asked as its general category.
 *
 * Pure, and free of anything server-only, so the chat, the save route, the
 * classifier and the admin read one list.
 */

export const SUBCATEGORIES = [
  "activities",
  "classes",
  "camps",
  "places",
  "restaurants",
  "schools",
  "doctors",
  "specialists",
  "parties",
  "tips",
  "products",
] as const;

export type Subcategory = (typeof SUBCATEGORIES)[number];

/** Which button each sub-category sits under — the developer's layout, 9 Oct. */
export const SUBCATEGORY_KIND: Record<Subcategory, ShareKind> = {
  activities: "activity",
  classes: "activity",
  camps: "activity",
  places: "place",
  restaurants: "place",
  schools: "place",
  doctors: "doctor",
  specialists: "doctor",
  parties: "doctor",
  tips: "tip",
  products: "tip",
};

export type ClassifiedKind = "activity" | "place" | "doctor" | "tip";

export const SUBCATEGORIES_BY_KIND: Record<ClassifiedKind, readonly Subcategory[]> = {
  activity: ["activities", "classes", "camps"],
  place: ["places", "restaurants", "schools"],
  doctor: ["doctors", "specialists", "parties"],
  tip: ["tips", "products"],
};

/** The kinds a sub-category is ever asked for. A caregiver card never is. */
export function isClassifiedKind(kind: string): kind is ClassifiedKind {
  return kind === "activity" || kind === "place" || kind === "doctor" || kind === "tip";
}

export function isSubcategory(value: unknown): value is Subcategory {
  return typeof value === "string" && (SUBCATEGORIES as readonly string[]).includes(value);
}

/** A sub-category that belongs under this button, or null. */
export function subcategoryFor(kind: string, value: unknown): Subcategory | null {
  return isSubcategory(value) && SUBCATEGORY_KIND[value] === kind ? value : null;
}

/**
 * Where a card goes when the classifier cannot say (12 Oct, the developer:
 * "without a classification, ask the specialists' questions"). On the
 * Specialists & Doctors button that is **specialists**, the broad one — so the
 * card is asked, filed and checked as one (no provider check). Other buttons
 * keep their own general questions. Only at classification time: an admin
 * clearing the sub-category still means general.
 */
export function unsureSubcategory(kind: string): Subcategory | null {
  return kind === "doctor" ? "specialists" : null;
}

/** What the admin and the recap header call each one. */
export const SUBCATEGORY_LABEL: Record<Subcategory, string> = {
  activities: "Activity",
  classes: "Class",
  camps: "Camp or holiday program",
  places: "Place",
  restaurants: "Restaurant or café",
  schools: "School",
  doctors: "Doctor",
  specialists: "Specialist or family service",
  /* 12 Oct, the developer: "party vendors", not "parties" — the id stays (the CHECK in drizzle/0056). */
  parties: "Party vendor",
  tips: "Tip",
  products: "Product or gear",
};

/**
 * What each one covers, for the classifier — the client's own descriptions
 * where she gave one (Specialists, Products), plainly elsewhere.
 */
export const SUBCATEGORY_HINT: Record<Subcategory, string> = {
  /* 9 Oct, the developer: a one-off pottery workshop with instructors is a
     class. Anything taught is a class, however often it meets; an activity is
     what a child does without mainly being taught. */
  activities:
    "something a child takes part in that is not mainly taught: a sports team, squad or league, however often it practises (a competitive swim team, a swim or dive club, a gymnastics team — training for a team is not a class), scouts, a club, open play, a play space session, storytime, an event or outing — not a class and not a camp",
  classes:
    /* 12 Oct: "swim" alone in this list pulled "competitive swim team" here,
       four times out of four at 0.95+. Lessons are named as lessons. */
    "anything taught by an instructor or teacher, whether weekly, by term, or a one-off workshop: music lessons, swim lessons, dance, art, pottery, cooking, language, coding, martial arts, gymnastics lessons, a tutoring center. Lessons only — a team, squad or club that trains and competes (swim team, gymnastics team) is an activity, not a class",
  camps: "a camp or holiday program: summer camp, spring-break or school-holiday programs, day camps",
  places: "a place to go with children: a park, playground, library, museum, indoor play, a beach",
  restaurants: "a restaurant, café or bar the family ate or drank at with children",
  schools: "a school, preschool or daycare a child attends",
  /* 9 Oct, the classifier bench: an ENT, a dermatologist and an allergist went
     to specialists — "specialist" read as the medical word. A medical doctor of
     any specialty is a doctor; specialists are the services that are not. */
  doctors:
    "a medical doctor (a physician) or medical practice, of ANY specialty: a pediatrician, family doctor, urgent care, ER or hospital, and every pediatric specialist physician — ENT, dermatologist, allergist, cardiologist, eye doctor, gastroenterologist, orthopedist, neurologist. A physician is always doctors, never specialists",
  specialists:
    "a specialist or family service who is not a medical doctor: dentist (dental cleanings, or a practice whose name says Dental), orthodontist, speech therapist, OT, PT, lactation or sleep consultant, doula, therapist or counselor, tutor, photographer, kids' haircuts",
  parties:
    "only something for a party or event: a birthday venue, entertainer, magician, face painter, bounce house or rental, a party cake or caterer",
  /* 9 Oct, the bench: "a library card gets you free museum passes" went to
     products. A tip may mention a thing; a product card is about one item. */
  tips: "advice for other parents — how, when or where to do something — even when it mentions a thing, a card or a place; not a recommendation of one item to buy",
  products:
    "one product or piece of gear to buy (or not to buy), usually by brand: a stroller, car seat, sound machine, travel gear, bike, toy, feeding product, clothing",
};
