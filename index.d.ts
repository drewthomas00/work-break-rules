/**
 * work-break-rules — does this shift give the meal and rest breaks the law
 * requires here?
 *
 * NOT LEGAL ADVICE. US federal law and the 50 states and DC, for adult
 * employees of private, non-agricultural employers. A place the tables do not
 * cover answers unknown, never "no rule".
 */

/** 'high': read in the primary text. 'medium': an official summary or a reputable copy. */
export type Confidence = 'high' | 'medium';

/** 'US-CA', 'us-ca', or { country: 'US', subdivision: 'CA' }. */
export type JurisdictionInput = string | { country: string; subdivision?: string | null };

export type Industry = 'retail' | 'restaurant' | 'personal_service' | 'manufacturing' | 'office' | 'healthcare' | 'other';

export interface Citation {
  readonly citation: string;
  readonly sourceUrl: string;
}

/** The law behind a rule or a breach. */
export interface Source {
  readonly jurisdiction: string;
  readonly citations: readonly Citation[];
  readonly confidence: Confidence;
  readonly note: string | null;
}

/** '>' more than, '>=' at least. */
export type Op = '>' | '>=';

/** When a rule reaches the employer; a fact not given is assumed to bring it in. */
export interface AppliesWhen {
  readonly industries?: readonly Industry[];
  readonly exceptIndustries?: readonly Industry[];
  readonly minEmployeesOnDuty?: number;
  readonly minEmployerEmployees?: number;
}

export interface MealRule {
  readonly id: string;
  /** every condition must hold. Hours are hours worked unless spanHours. */
  readonly trigger: {
    readonly workedHours?: number;
    readonly spanHours?: number;
    readonly op?: Op;
    readonly belowWorkedHours?: number;
    readonly atMostWorkedHours?: number;
    readonly overlapsClock?: readonly [string, string];
    readonly startsBetweenClock?: readonly [string, string];
    readonly startsBefore?: string;
    readonly endsAfter?: string;
  };
  readonly minutes: number;
  /** positions are hours worked when the meal starts (endBy: start plus its length) */
  readonly window: {
    readonly notBeforeWorkedHours?: number;
    readonly startByWorkedHours?: number;
    readonly endByWorkedHours?: number;
    readonly notInLastWorkedHours?: number;
    readonly clock?: readonly [string, string];
    /** no stretch of work longer than this without a meal */
    readonly maxStretch?: { readonly hours: number; readonly op: Op };
  } | null;
  /** null: cannot be waived. {}: waivable. */
  readonly waiver: { readonly maxWorkedHours?: number; readonly requiresNotWaived?: string } | null;
  readonly onDutyAllowed: boolean;
  readonly appliesWhen: AppliesWhen | null;
  readonly citations: readonly Citation[];
  readonly confidence: Confidence;
  readonly note: string;
}

export interface RestRule {
  readonly minutes: number;
  readonly perHours: number | null;
  /** 'per 4 hours or major fraction' (more than half) */
  readonly majorFraction: boolean;
  readonly minimumShiftHours: number | null;
  /** [hours, op, count]: the last row that matches gives the count */
  readonly table: ReadonlyArray<readonly [number, Op, number]> | null;
  /** no stretch of work longer than this without a rest */
  readonly maxStretch: { readonly hours: number; readonly op: Op } | null;
  readonly paid: boolean;
  readonly waiver: { readonly maxWorkedHours?: number } | null;
  readonly appliesWhen: AppliesWhen | null;
  readonly citations: readonly Citation[];
  readonly confidence: Confidence;
  readonly note: string;
}

export interface Penalty {
  /** pay owed to the employee per workday a compliant break is not provided */
  readonly premiumHours: { readonly meal: number; readonly rest: number } | null;
  /** a missed rest break is owed as pay for its length */
  readonly missedRestPaid: boolean;
  readonly description: string;
  readonly citations: readonly Citation[];
}

/** One jurisdiction's table entry. */
export interface Rules {
  readonly effectiveFrom: string | null;
  readonly meals: readonly MealRule[];
  readonly rest: RestRule | null;
  readonly penalty: Penalty | null;
  /** rules that cannot be checked against a schedule */
  readonly unchecked: readonly string[];
  /** for a jurisdiction with no rule: where that was checked */
  readonly basis: { readonly citations: readonly Citation[]; readonly confidence: Confidence; readonly note: string } | null;
}

/** The table entry for a place, or null when the tables do not cover it. */
export function rulesFor(jurisdiction: JurisdictionInput): Rules | null;

export interface Break {
  /** 'HH:MM' on the clock; earlier than the shift's start means after midnight */
  start: string;
  minutes: number;
  kind: 'meal' | 'rest';
  /** a meal eaten while working: time worked, and paid */
  onDuty?: boolean;
}

export interface CheckShiftInput {
  /** where the work is done */
  jurisdiction: JurisdictionInput;
  /** 'YYYY-MM-DD', the day the shift starts */
  date: string;
  /** 'HH:MM' */
  start: string;
  /** 'HH:MM'; at or before the start runs past midnight */
  end: string;
  breaks?: readonly Break[];
  /** ids of meal rules (or 'rest') the employee validly waived for this shift */
  waived?: readonly string[];
  facts?: { industry?: Industry; employeesOnDuty?: number; employerEmployees?: number };
}

export type RuleName =
  | 'meal_missing'
  | 'meal_too_short'
  | 'meal_too_early'
  | 'meal_too_late'
  | 'meal_outside_hours'
  | 'rest_missing'
  | 'rest_late';

export interface Violation extends Source {
  readonly rule: RuleName;
  /** the meal rule's id, or 'rest' */
  readonly ruleId: string;
  readonly limit: number | string;
  readonly actual: number | string;
  /** the index in `breaks` of the meal judged */
  readonly break?: number;
  /** where a too-long stretch began */
  readonly from?: string;
  readonly message: string;
}

export interface Owed {
  readonly kind: 'premium_pay' | 'rest_time_pay';
  readonly for: 'meal' | 'rest';
  readonly hours?: number;
  readonly minutes?: number;
  readonly jurisdiction: string;
  readonly citations: readonly Citation[];
}

export interface CheckResult {
  readonly jurisdiction: string;
  /** false when the tables cannot answer; then `violations` is empty and means nothing */
  readonly known: boolean;
  readonly reason?: 'unknown_jurisdiction' | 'no_rule_in_force';
  readonly workedMinutes: number;
  readonly violations: readonly Violation[];
  /** pay the law sets for the breaches, assuming the breaks were not provided */
  readonly owed: readonly Owed[];
  readonly waivers: ReadonlyArray<{ ruleId: string; allowed: boolean }>;
  readonly notes: ReadonlyArray<{ jurisdiction: string; note: string }>;
  /** facts not given, assumed to bring a rule in */
  readonly assumptions: ReadonlyArray<'industry' | 'employeesOnDuty' | 'employerEmployees'>;
}

/** Check one shift's breaks against the rules where the work is done. */
export function checkShift(input: CheckShiftInput): CheckResult;

/** A shift from clock punches: gaps between work segments are off-duty meals. */
export function shiftFromPunches(input: {
  date: string;
  segments: ReadonlyArray<{ start: string; end: string }>;
  restBreaks?: ReadonlyArray<{ start: string; minutes: number }>;
}): { date: string; start: string; end: string; breaks: Break[] };

/** The jurisdictions the tables cover, and the date they were checked. */
export function coverage(): { asOf: string; jurisdictions: string[] };

/** 'US-CA' from any accepted spelling; throws TypeError on anything unreadable. */
export function normalizeJurisdiction(input: JurisdictionInput): string;

export const AS_OF: string;
export const INDUSTRIES: readonly Industry[];
