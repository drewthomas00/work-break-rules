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

/** A comparison that must hold: '>' more than, '>=' at least, '<' less than, '<=' at most. */
export interface AtLeast { readonly hours: number; readonly op: '>' | '>=' }
export interface AtMost { readonly hours: number; readonly op: '<' | '<=' }

/** When a rule reaches the employer; a fact not given is assumed to bring it in. */
export interface AppliesWhen {
  readonly industries?: readonly Industry[];
  readonly exceptIndustries?: readonly Industry[];
  readonly minEmployeesOnDuty?: number;
  readonly minRetailEmployees?: number;
  readonly minLocationEmployees?: number;
}

export interface MealRule {
  readonly id: string;
  /** every condition must hold. minWorked/maxWorked are hours worked; minSpan is first start to last end. */
  readonly trigger: {
    readonly minWorked?: AtLeast;
    readonly maxWorked?: AtMost;
    readonly minSpan?: AtLeast;
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
    /** every stretch of work between meals must satisfy this */
    readonly maxStretch?: AtMost;
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
  /** [hours, op, count]: the last row whose hours worked match gives the count */
  readonly table: ReadonlyArray<readonly [number, '>' | '>=', number]> | null;
  /** every stretch of work between rest breaks must satisfy this */
  readonly maxStretch: AtMost | null;
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
  /** 'HH:MM' on the clock, inside a work segment (after midnight if the segment runs past it) */
  start: string;
  minutes: number;
  kind: 'meal' | 'rest';
  /** a meal eaten while working: time worked, and paid */
  onDuty?: boolean;
}

export interface Facts {
  industry?: Industry;
  /** people on duty at the worksite during the shift */
  employeesOnDuty?: number;
  /** the employer's retail employees in the jurisdiction */
  retailEmployees?: number;
  /** employees at this location */
  locationEmployees?: number;
}

interface WorkdayBase {
  /** where the work is done */
  jurisdiction: JurisdictionInput;
  /** 'YYYY-MM-DD', the day the workday starts */
  date: string;
  /** breaks inside the work segments; a gap between segments is already off duty */
  breaks?: readonly Break[];
  /** ids of rules the employee validly waived for this day: a meal rule's id, or 'rest'. An id the jurisdiction does not have throws. */
  waived?: readonly string[];
  /** a fact not given is assumed to bring a rule in, and is listed in `assumptions` */
  facts?: Facts;
  /** IANA zone of the workplace: spans are then real time across a daylight-saving change. Default: wall-clock time. */
  timeZone?: string;
}

/** One stretch of work, start to end ('HH:MM'; an end at or before the start runs past midnight), or every stretch in the workday. */
export type CheckWorkdayInput =
  | (WorkdayBase & { start: string; end: string; segments?: never })
  | (WorkdayBase & { segments: ReadonlyArray<{ start: string; end: string }>; start?: never; end?: never });

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
  /** the index in `breaks` of the meal judged, or null for a gap between segments */
  readonly break?: number | null;
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
  /** first start to last end */
  readonly spanMinutes: number;
  readonly violations: readonly Violation[];
  /** pay the law sets for the breaches, assuming the breaks were not provided */
  readonly owed: readonly Owed[];
  readonly waivers: ReadonlyArray<{ ruleId: string; allowed: boolean }>;
  readonly notes: ReadonlyArray<{ jurisdiction: string; note: string }>;
  /** facts not given, assumed to bring a rule in; 'wall_clock' when no timeZone was given */
  readonly assumptions: ReadonlyArray<keyof Facts | 'wall_clock'>;
}

/** Check one workday's breaks against the rules where the work is done. */
export function checkWorkday(input: CheckWorkdayInput): CheckResult;

/** The jurisdictions the tables cover, and the date they were checked. */
export function coverage(): { asOf: string; jurisdictions: string[] };

/** 'US-CA' from any accepted spelling; throws TypeError on anything unreadable. */
export function normalizeJurisdiction(input: JurisdictionInput): string;

export const AS_OF: string;
export const INDUSTRIES: readonly Industry[];
