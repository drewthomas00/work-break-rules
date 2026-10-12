'use strict';

/**
 * Meal and rest break rules for adult employees of private, non-agricultural
 * employers, per US jurisdiction (federal 'US', 50 states, DC). Not legal
 * advice. A `meals` list or `rest: null` with a `basis` means the jurisdiction
 * was checked and sets no such rule. Where a rule is conditional or vague, the
 * stricter reading is encoded and the `note` says so.
 *
 * The shapes are described in index.d.ts and checked at load by validate.js.
 * Hours are hours worked; `op` is the comparison that must hold (a trigger's
 * minWorked { hours: 5, op: '>' } is "more than 5 hours"; a maxStretch
 * { hours: 5, op: '<=' } is "no more than 5 hours without one").
 */

const AS_OF = '2026-10-11';

const FLSA_NOTE = 'Federal law (FLSA) requires no meal or rest break. A break the employer gives of about 20 minutes or less is paid time (29 CFR 785.18); a meal is unpaid only if the employee is completely relieved of duty, ordinarily for 30 minutes or more (29 CFR 785.19).';

const CA_WO2 = 'https://www.dir.ca.gov/iwc/IWCArticle2.pdf';
const CO_COMPS = 'https://www.sos.state.co.us/CCR/GenerateRulePdf.do?ruleVersionId=12406&fileName=7+CCR+1103-1';
const OR_RULE = 'https://secure.sos.state.or.us/oard/view.action?ruleNumber=839-020-0050';
const WA_RULE = 'https://app.leg.wa.gov/wac/default.aspx?cite=296-126-092';
const WA_POLICY = 'https://www.lni.wa.gov/workers-rights/_docs/esc6.1.pdf';
const NV_NRS = 'https://www.leg.state.nv.us/NRS/NRS-608.html#NRS608Sec019';
const NV_NAC = 'https://www.leg.state.nv.us/NAC/NAC-608.html#NAC608Sec145';
const MD_ARTICLE = 'https://mgaleg.maryland.gov/2026RS/Statute_Web/gle/gle.pdf';

/** A jurisdiction with no meal or rest break rule for adults. */
const none = (basis) => ({ effectiveFrom: null, meals: [], rest: null, penalty: null, unchecked: [], basis });

const JURISDICTIONS = {
  US: none({
    citations: [
      { citation: '29 CFR § 785.18', sourceUrl: 'https://www.ecfr.gov/current/title-29/section-785.18' },
      { citation: '29 CFR § 785.19', sourceUrl: 'https://www.ecfr.gov/current/title-29/section-785.19' },
    ],
    confidence: 'high',
    note: FLSA_NOTE,
  }),

  'US-CA': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 5, op: '>' } },
        minutes: 30,
        window: { startByWorkedHours: 5 },
        waiver: { maxWorkedHours: 6 },
        onDutyAllowed: true,
        appliesWhen: null,
        citations: [
          { citation: 'IWC Wage Order 2-2001, § 11(A)–(C) (Cal. Code Regs., tit. 8, § 11020)', sourceUrl: CA_WO2 },
          { citation: 'Cal. Lab. Code § 512(a)', sourceUrl: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=512.' },
          { citation: 'Brinker Restaurant Corp. v. Superior Court (2012) 53 Cal.4th 1004 (as described by the Labor Commissioner)', sourceUrl: 'https://www.dir.ca.gov/dlse/faq_mealperiods.htm' },
        ],
        confidence: 'high',
        note: 'A work period of more than 5 hours needs a 30-minute meal starting no later than the end of the 5th hour (Brinker). It may be waived by mutual consent when no more than 6 hours complete the day. An on-duty meal needs a written agreement the employee can revoke, and only where the work prevents relief from all duty; it is paid. Wage Order 2 names beauty salons and barber shops; Orders 5 (restaurants) and 7 (retail) say the same. Exempt: executive, administrative and professional employees, outside salespersons, and the employer\'s parent, spouse or child (§ 1).',
      },
      {
        id: 'second_meal',
        trigger: { minWorked: { hours: 10, op: '>' } },
        minutes: 30,
        window: { startByWorkedHours: 10 },
        waiver: { maxWorkedHours: 12, requiresNotWaived: 'meal' },
        onDutyAllowed: true,
        appliesWhen: null,
        citations: [
          { citation: 'IWC Wage Order 2-2001, § 11(B)', sourceUrl: CA_WO2 },
          { citation: 'Cal. Lab. Code § 512(a)', sourceUrl: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=512.' },
        ],
        confidence: 'high',
        note: 'A work period of more than 10 hours needs a second 30-minute meal, starting no later than the end of the 10th hour. It may be waived by mutual consent only if the day is no more than 12 hours and the first meal was not waived.',
      },
    ],
    rest: {
      minutes: 10, perHours: 4, majorFraction: true, minimumShiftHours: 3.5, table: null, maxStretch: null, paid: true, waiver: null, appliesWhen: null,
      citations: [
        { citation: 'IWC Wage Order 2-2001, § 12(A)', sourceUrl: CA_WO2 },
        { citation: 'Augustus v. ABM Security Services (2016) 2 Cal.5th 257 (as described by the Labor Commissioner)', sourceUrl: 'https://www.dir.ca.gov/dlse/faq_restperiods.htm' },
      ],
      confidence: 'high',
      note: '10 minutes of net rest per 4 hours or major fraction (more than 2 hours), none for a day under 3.5 hours: one for 3.5 to 6 hours, two for more than 6 up to 10, three for more than 10 up to 14. Insofar as practicable in the middle of each work period (not checked). The employee must be relieved of all duty; on-call rest does not count (Augustus).',
    },
    penalty: {
      premiumHours: { meal: 1, rest: 1 },
      missedRestPaid: false,
      description: 'One additional hour of pay at the regular rate of compensation for each workday a compliant meal period is not provided, and one for each workday a compliant rest period is not provided: at most one of each per day.',
      citations: [
        { citation: 'IWC Wage Order 2-2001, §§ 11(D), 12(B)', sourceUrl: CA_WO2 },
        { citation: 'Cal. Lab. Code § 226.7(c)', sourceUrl: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=226.7.' },
      ],
    },
    unchecked: [],
    basis: null,
  },

  'US-CO': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 5, op: '>' } },
        minutes: 30,
        window: { notBeforeWorkedHours: 1, notInLastWorkedHours: 1 },
        waiver: null,
        onDutyAllowed: true,
        appliesWhen: null,
        citations: [{ citation: 'COMPS Order #40, 7 CCR 1103-1, Rule 5.1', sourceUrl: CO_COMPS }],
        confidence: 'high',
        note: 'A shift of more than 5 consecutive hours needs an uninterrupted, duty-free 30-minute meal, to the extent practical at least an hour after the start and an hour before the end (encoded as required: stricter). Where an uninterrupted meal is impractical, an on-duty meal is allowed and is paid. Rule 2.2 exempts administrative, executive, professional and other listed employees. COMPS Order #40 took effect 2026-02-01; Rule 5 is unchanged from #39.',
      },
    ],
    rest: {
      minutes: 10, perHours: 4, majorFraction: true, minimumShiftHours: null, table: null, maxStretch: null, paid: true, waiver: null, appliesWhen: null,
      citations: [{ citation: 'COMPS Order #40, 7 CCR 1103-1, Rule 5.2', sourceUrl: CO_COMPS }],
      confidence: 'high',
      note: 'A paid 10-minute rest for each 4 hours or major fraction: none for 2 hours or fewer, one for more than 2 up to 6, two for more than 6 up to 10, and so on. To the extent practical in the middle of each 4-hour period (not checked). Two 5-minute rests may replace one 10-minute rest by voluntary agreement (Rule 5.2.1(A)); pass them as one 10-minute rest only where that agreement exists.',
    },
    penalty: {
      premiumHours: null,
      missedRestPaid: true,
      description: 'A missed rest period extends the shift by 10 minutes, owed as wages. A missed or interrupted meal is time worked, and paid; there is no premium.',
      citations: [{ citation: 'COMPS Order #40, Rules 5.1, 5.2.4', sourceUrl: CO_COMPS }],
    },
    unchecked: [],
    basis: null,
  },

  'US-IL': {
    effectiveFrom: '2023-01-01',
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 7.5, op: '>=' } },
        minutes: 20,
        window: { startByWorkedHours: 5 },
        waiver: null,
        onDutyAllowed: false,
        appliesWhen: null,
        citations: [{ citation: '820 ILCS 140/3', sourceUrl: 'https://ftp.ilga.gov/ilcs/Ch%200820/Act%200140/082001400K3.html' }],
        confidence: 'high',
        note: 'A shift of 7½ continuous hours needs a meal of at least 20 minutes beginning no later than 5 hours after the start, and another 20 minutes for every further 4½ continuous hours. Reasonable restroom time does not count toward it. Silent on pay: a 20-minute meal is unpaid under federal law only if it meets 29 CFR 785.19. The ILGA site\'s file mirror is linked because ilga.gov blocks automated reading. Effective date is that of P.A. 102-828, which added the further meals.',
      },
      { id: 'second_meal', trigger: { minWorked: { hours: 12, op: '>=' } }, minutes: 20, window: null, waiver: null, onDutyAllowed: false, appliesWhen: null,
        citations: [{ citation: '820 ILCS 140/3', sourceUrl: 'https://ftp.ilga.gov/ilcs/Ch%200820/Act%200140/082001400K3.html' }], confidence: 'high', note: 'The additional 20 minutes after a further 4½ continuous hours (12 in all).' },
      { id: 'third_meal', trigger: { minWorked: { hours: 16.5, op: '>=' } }, minutes: 20, window: null, waiver: null, onDutyAllowed: false, appliesWhen: null,
        citations: [{ citation: '820 ILCS 140/3', sourceUrl: 'https://ftp.ilga.gov/ilcs/Ch%200820/Act%200140/082001400K3.html' }], confidence: 'high', note: 'The additional 20 minutes after another 4½ continuous hours (16½ in all).' },
    ],
    rest: null,
    penalty: {
      premiumHours: null, missedRestPaid: false,
      description: 'A civil penalty of up to $250 plus up to $250 in damages to the employee per offense (fewer than 25 employees), or $500 plus $500 (25 or more); each day without a required meal is a separate offense.',
      citations: [{ citation: '820 ILCS 140/7', sourceUrl: 'https://ftp.ilga.gov/ilcs/Ch%200820/Act%200140/082001400K7.html' }],
    },
    unchecked: [],
    basis: null,
  },

  'US-KY': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 3, op: '>' } },
        minutes: 30,
        window: { notBeforeWorkedHours: 3, startByWorkedHours: 5 },
        waiver: {},
        onDutyAllowed: false,
        appliesWhen: null,
        citations: [
          { citation: 'KRS 337.355', sourceUrl: 'https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=32077' },
          { citation: '29 CFR § 785.19 (length of a bona fide meal)', sourceUrl: 'https://www.ecfr.gov/current/title-29/section-785.19' },
        ],
        confidence: 'high',
        note: 'Every shift gets "a reasonable period for lunch", as near the middle as possible, starting no sooner than 3 hours and no later than 5 hours after the shift begins. The statute sets no minimum shift and no length: a shift of more than 3 hours (the earliest a lunch may start) and 30 minutes (what federal law ordinarily treats as a bona fide meal) are encoded, both stricter readings. A collective bargaining agreement or a mutual agreement between employer and employee may provide otherwise; record that as a waiver of "meal".',
      },
    ],
    rest: {
      minutes: 10, perHours: 4, majorFraction: false, minimumShiftHours: null, table: null, maxStretch: null, paid: true, waiver: null, appliesWhen: null,
      citations: [{ citation: 'KRS 337.365', sourceUrl: 'https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=49845' }],
      confidence: 'high',
      note: 'A paid 10-minute rest during each 4 hours worked, in addition to lunch. No major-fraction rule. A collective bargaining agreement giving at least as much rest time may replace it (since 2020-03-27).',
    },
    penalty: {
      premiumHours: null, missedRestPaid: false,
      description: 'A civil penalty of $100 to $1,000 per violation of the rest-period statute, payable to the state. None is set for the lunch statute.',
      citations: [{ citation: 'KRS 337.990(10)', sourceUrl: 'https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=52428' }],
    },
    unchecked: [],
    basis: null,
  },

  'US-MD': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 6, op: '>' } },
        minutes: 30,
        window: null,
        waiver: null,
        onDutyAllowed: true,
        appliesWhen: { industries: ['retail'], minRetailEmployees: 50, minLocationEmployees: 6 },
        citations: [{ citation: 'Md. Code, Lab. & Empl. § 3-710(c)(1)(ii)', sourceUrl: MD_ARTICLE }],
        confidence: 'high',
        note: 'Healthy Retail Employee Act: retail establishments only (selling goods to a consumer present at the sale; not restaurants or wholesalers), for an employer with 50 or more retail employees in Maryland (fact retailEmployees). More than 6 consecutive hours needs a 30-minute nonworking break. A working break is allowed only by written agreement where the work prevents relief or the employee may eat while working, and is then time worked. Exempt: FLSA-exempt employees, office locations, and a single location with 5 or fewer employees (fact locationEmployees). A salon is retail only if retail goods are most of its sales (Department FAQ).',
      },
    ],
    rest: {
      minutes: 15, perHours: null, majorFraction: false, minimumShiftHours: null,
      table: [[4, '>=', 1], [6, '>', 0], [8, '>=', 1], [12, '>=', 2], [16, '>=', 3], [20, '>=', 4]],
      maxStretch: null, paid: true, waiver: { maxWorkedHours: 6 },
      appliesWhen: { industries: ['retail'], minRetailEmployees: 50, minLocationEmployees: 6 },
      citations: [{ citation: 'Md. Code, Lab. & Empl. § 3-710(c)', sourceUrl: MD_ARTICLE }],
      confidence: 'high',
      note: '4 to 6 consecutive hours: one 15-minute break, which may be waived in writing. More than 6: the 30-minute break instead. From 8 consecutive hours, an additional 15 minutes for every additional 4 consecutive hours (one from 8, encoded as stricter; the Department counts from the previous break). The statute is silent on pay; a break of 15 minutes is paid under 29 CFR 785.18.',
    },
    penalty: {
      premiumHours: null, missedRestPaid: false,
      description: 'Up to $300 per employee not in compliance ($600 within 3 years of a prior violation); after an order is ignored, the employee may recover 3 times the hourly wage for each later violation.',
      citations: [{ citation: 'Md. Code, Lab. & Empl. § 3-710(d)', sourceUrl: MD_ARTICLE }],
    },
    unchecked: [],
    basis: null,
  },

  'US-MN': {
    effectiveFrom: '2026-01-01',
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 6, op: '>=' } },
        minutes: 30,
        window: null,
        waiver: null,
        onDutyAllowed: false,
        appliesWhen: null,
        citations: [{ citation: 'Minn. Stat. § 177.254, subd. 1', sourceUrl: 'https://www.revisor.mn.gov/statutes/cite/177.254' }],
        confidence: 'high',
        note: 'Since 2026-01-01 (Laws 2025, 1st Sp. Sess. ch. 6, art. 5): 6 or more consecutive hours needs a meal break of at least 30 minutes; unpaid only if the employee is completely relieved (Minn. R. 5200.0120, subp. 4). One meal however long the shift. Before 2026 the rule was "sufficient time to eat" at 8 hours, which these tables do not hold: a shift before 2026-01-01 answers unknown. A collective bargaining agreement may differ.',
      },
    ],
    rest: {
      minutes: 15, perHours: 4, majorFraction: false, minimumShiftHours: 4, table: null, maxStretch: { hours: 4, op: '<' }, paid: true, waiver: null, appliesWhen: null,
      citations: [
        { citation: 'Minn. Stat. § 177.253, subd. 1', sourceUrl: 'https://www.revisor.mn.gov/statutes/cite/177.253' },
        { citation: 'Minn. R. 5200.0120, subp. 1', sourceUrl: 'https://www.revisor.mn.gov/rules/5200.0120/' },
      ],
      confidence: 'high',
      note: 'At least 15 minutes, or enough time to reach the nearest convenient restroom if longer, within each 4 consecutive hours of work: no 4-hour stretch may pass without one (the Department: a break offered only after 4 hours does not meet it). Paid: a rest under 20 minutes may not be deducted. A meal does not reset the 4 hours here (stricter).',
    },
    penalty: {
      premiumHours: null, missedRestPaid: true,
      description: 'Since 2026-01-01, the break time that should have been allowed, at the regular rate, plus an equal amount as liquidated damages (for a missed meal or rest).',
      citations: [
        { citation: 'Minn. Stat. § 177.253, subd. 3', sourceUrl: 'https://www.revisor.mn.gov/statutes/cite/177.253' },
        { citation: 'Minn. Stat. § 177.254, subd. 4', sourceUrl: 'https://www.revisor.mn.gov/statutes/cite/177.254' },
      ],
    },
    unchecked: [],
    basis: null,
  },

  'US-NV': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 8, op: '>=' } },
        minutes: 30,
        window: { maxStretch: { hours: 8, op: '<' } },
        waiver: {},
        onDutyAllowed: false,
        appliesWhen: { minLocationEmployees: 2 },
        citations: [
          { citation: 'NRS 608.019(1), (3)–(5)', sourceUrl: NV_NRS },
          { citation: 'NAC 608.145(3)', sourceUrl: NV_NAC },
        ],
        confidence: 'high',
        note: 'No continuous 8 hours of work without a 30-minute meal; a shorter break does not interrupt the 8 hours. Not where only one person is employed at the place of employment (fact locationEmployees), under a collective bargaining agreement, or under a Labor Commissioner exemption. The employee may voluntarily forgo a meal; the employer must prove that agreement.',
      },
    ],
    rest: {
      minutes: 10, perHours: 4, majorFraction: true, minimumShiftHours: 3.5, table: null, maxStretch: null, paid: true, waiver: {},
      appliesWhen: { minLocationEmployees: 2 },
      citations: [
        { citation: 'NRS 608.019(2)', sourceUrl: NV_NRS },
        { citation: 'NAC 608.145(1)–(2)', sourceUrl: NV_NAC },
      ],
      confidence: 'high',
      note: 'A paid 10-minute rest per 4 hours or major fraction, none under 3½ hours. The regulation\'s schedule gives one for 3½ to under 7 hours, two for 7 to under 11, three for 11 to under 15; the statute\'s "major fraction" gives two from just over 6 hours, and is encoded (stricter). The employee may voluntarily forgo a rest.',
    },
    penalty: {
      premiumHours: null, missedRestPaid: false,
      description: 'A misdemeanor, and an administrative penalty of up to $5,000 per violation.',
      citations: [{ citation: 'NRS 608.195', sourceUrl: 'https://www.leg.state.nv.us/NRS/NRS-608.html#NRS608Sec195' }],
    },
    unchecked: [],
    basis: null,
  },

  'US-OR': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 6, op: '>=' }, maxWorked: { hours: 7, op: '<=' } },
        minutes: 30,
        window: { notBeforeWorkedHours: 2, endByWorkedHours: 4 },
        waiver: null,
        onDutyAllowed: false,
        appliesWhen: null,
        citations: [{ citation: 'OAR 839-020-0050(2)', sourceUrl: OR_RULE }],
        confidence: 'high',
        note: 'A work period of 6 to 7 hours needs a 30-minute meal taken after the end of the 2nd hour worked and completed before the 5th hour begins. No meal is required under 6 hours. An unrelieved meal is paid in full and allowed only for undue hardship, an industry practice of paid 20-to-30-minute meals, or rare unforeseeable circumstances (not encoded). Only tipped food and beverage servers may waive a meal, in writing on the BOLI form.',
      },
      {
        id: 'meal',
        trigger: { minWorked: { hours: 7, op: '>' } },
        minutes: 30,
        window: { notBeforeWorkedHours: 3, endByWorkedHours: 5 },
        waiver: null,
        onDutyAllowed: false,
        appliesWhen: null,
        citations: [{ citation: 'OAR 839-020-0050(2)(d)', sourceUrl: OR_RULE }],
        confidence: 'high',
        note: 'A work period of more than 7 hours: after the end of the 3rd hour worked, completed before the 6th hour begins.',
      },
      { id: 'second_meal', trigger: { minWorked: { hours: 14, op: '>=' } }, minutes: 30, window: null, waiver: null, onDutyAllowed: false, appliesWhen: null,
        citations: [{ citation: 'OAR 839-020-0050, Appendix A', sourceUrl: OR_RULE }], confidence: 'high', note: 'Appendix A: two meals from 14 hours, three from 22.' },
    ],
    rest: {
      minutes: 10, perHours: 4, majorFraction: true, minimumShiftHours: null, table: null, maxStretch: null, paid: true, waiver: null, appliesWhen: null,
      citations: [{ citation: 'OAR 839-020-0050(6)', sourceUrl: OR_RULE }],
      confidence: 'high',
      note: 'A paid, relieved 10-minute rest for each 4-hour segment or major part (more than 2 hours), approximately mid-segment, separate from the meal and not at the start or end of the shift (not checked). It cannot be waived. Not required only for an adult working alone, under 5 hours in any 16, in a retail or service establishment, free to leave to use the restroom (not encoded).',
    },
    penalty: {
      premiumHours: null, missedRestPaid: false,
      description: 'No premium. Unprovided rest time and unrelieved meals are owed as wages; BOLI may assess a civil penalty of up to $1,000 for a willful violation, and up to $2,000 for coercing a server into waiving a meal.',
      citations: [
        { citation: 'ORS 653.256(1)', sourceUrl: 'https://www.oregonlegislature.gov/bills_laws/ors/ors653.html' },
        { citation: 'ORS 653.261(4)(c)', sourceUrl: 'https://www.oregonlegislature.gov/bills_laws/ors/ors653.html' },
      ],
    },
    unchecked: [],
    basis: null,
  },

  'US-VT': {
    effectiveFrom: null,
    meals: [],
    rest: null,
    penalty: null,
    unchecked: ['Vermont requires "reasonable opportunities during work periods to eat and to use toilet facilities" (21 V.S.A. § 304), with no length or timing a schedule can be checked against.'],
    basis: {
      citations: [{ citation: '21 V.S.A. § 304', sourceUrl: 'https://legislature.vermont.gov/statutes/section/21/005/00304' }],
      confidence: 'high',
      note: 'No fixed meal or rest break: only reasonable opportunities to eat and to use toilet facilities, in force since 1999.',
    },
  },

  'US-WA': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 5, op: '>' } },
        minutes: 30,
        window: { notBeforeWorkedHours: 2, startByWorkedHours: 5 },
        waiver: {},
        onDutyAllowed: true,
        appliesWhen: null,
        citations: [
          { citation: 'WAC 296-126-092(1)–(2)', sourceUrl: WA_RULE },
          { citation: 'L&I Administrative Policy ES.C.6.1', sourceUrl: WA_POLICY },
        ],
        confidence: 'high',
        note: 'A shift of more than 5 hours needs a 30-minute meal commencing no less than 2 and no more than 5 hours from the start. Paid when the employee must stay on duty on the premises. The employee may waive it (the employer need not agree); L&I advises a written request, and the employer must prove a waiver (Brady v. AutoZone, 2017). Covers employees 18 and over; minors are under WAC 296-125. Not newspaper vendors, domestic or agricultural labor (WAC 296-126-001).',
      },
      {
        id: 'meal_every_5h',
        trigger: { minWorked: { hours: 5, op: '>' } },
        minutes: 30,
        window: { maxStretch: { hours: 5, op: '<=' } },
        waiver: {},
        onDutyAllowed: true,
        appliesWhen: null,
        citations: [
          { citation: 'WAC 296-126-092(2)–(3)', sourceUrl: WA_RULE },
          { citation: 'L&I Administrative Policy ES.C.6.1', sourceUrl: WA_POLICY },
        ],
        confidence: 'high',
        note: 'No more than 5 consecutive hours without a meal. L&I: on a long shift a further meal is due within 5 hours of the end of the last one, and for each 5 hours worked thereafter.',
      },
    ],
    rest: {
      minutes: 10, perHours: 4, majorFraction: false, minimumShiftHours: null, table: null, maxStretch: { hours: 3, op: '<=' }, paid: true, waiver: null, appliesWhen: null,
      citations: [
        { citation: 'WAC 296-126-092(4)–(5)', sourceUrl: WA_RULE },
        { citation: 'L&I Administrative Policy ES.C.6.1', sourceUrl: WA_POLICY },
      ],
      confidence: 'high',
      note: 'A paid 10-minute rest for each 4 hours of working time, as near the midpoint as possible, and no more than 3 hours without one (so a shift of more than 3 hours needs one, a reading from the 3-hour rule). It cannot be waived. Intermittent rest counts only where the work allows it, not for work requiring constant exertion (Pellino v. Brink\'s); brief restroom or food stops do not.',
    },
    penalty: {
      premiumHours: null, missedRestPaid: true,
      description: 'No statutory premium. Washington courts treat a missed rest break as 10 more minutes worked, owed as wages; a missed meal is recoverable as wages; willfully withheld wages can be doubled (RCW 49.52.070).',
      citations: [
        { citation: 'Wash. State Nurses Ass\'n v. Sacred Heart Med. Ctr., 175 Wn.2d 822 (2012)', sourceUrl: 'https://law.justia.com/cases/washington/supreme-court/2012/85524-9.html' },
        { citation: 'RCW 49.52.070', sourceUrl: 'https://app.leg.wa.gov/rcw/default.aspx?cite=49.52.070' },
      ],
    },
    unchecked: [],
    basis: null,
  },

  'US-WV': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 6, op: '>=' } },
        minutes: 20,
        window: null,
        waiver: null,
        onDutyAllowed: true,
        appliesWhen: null,
        citations: [{ citation: 'W. Va. Code § 21-3-10a', sourceUrl: 'https://code.wvlegislature.gov/21-3-10A/' }],
        confidence: 'high',
        note: 'A workday of 6 or more hours needs at least 20 minutes for a meal, at times the employer reasonably designates. The duty applies "where employees are not afforded necessary breaks and/or permitted to eat lunch while working"; an employer that lets employees eat while working may be outside it (pass an on-duty meal). Pay is not addressed.',
      },
    ],
    rest: null,
    penalty: null,
    unchecked: [],
    basis: null,
  },
  'US-CT': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 7.5, op: '>=' } },
        minutes: 30,
        window: { notBeforeWorkedHours: 2, notInLastWorkedHours: 2 },
        waiver: {},
        onDutyAllowed: false,
        appliesWhen: null,
        citations: [{ citation: 'Conn. Gen. Stat. § 31-51ii', sourceUrl: 'https://www.cga.ct.gov/current/pub/chap_557.htm#sec_31-51ii' }],
        confidence: 'high',
        note: '7½ or more consecutive hours needs at least 30 consecutive minutes for a meal, after the first 2 hours and before the last 2. A written agreement may set a different schedule (record it as a waiver of "meal"). Does not apply to an employer that gives 30 or more minutes of paid rest or meal time in each 7½-hour period, or under a Labor Commissioner exemption.',
      },
    ],
    rest: null,
    penalty: { premiumHours: null, missedRestPaid: false, description: 'A civil penalty of $300 per violation.', citations: [{ citation: 'Conn. Gen. Stat. §§ 31-51ii(g), 31-69a(a)', sourceUrl: 'https://www.cga.ct.gov/current/pub/chap_558.htm#sec_31-69a' }] },
    unchecked: [],
    basis: null,
  },

  'US-DE': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 7.5, op: '>=' } },
        minutes: 30,
        window: { notBeforeWorkedHours: 2, notInLastWorkedHours: 2 },
        waiver: {},
        onDutyAllowed: false,
        appliesWhen: null,
        citations: [{ citation: '19 Del. C. § 707(a)', sourceUrl: 'https://delcode.delaware.gov/title19/c007/sc01/index.html' }],
        confidence: 'high',
        note: '7½ or more consecutive hours needs an unpaid meal break of at least 30 consecutive minutes, after the first 2 hours and before the last 2. A collective bargaining agreement or other written agreement may provide otherwise (record it as a waiver of "meal"). The Secretary of Labor may grant exemptions by rule (not encoded).',
      },
    ],
    rest: null,
    penalty: { premiumHours: null, missedRestPaid: false, description: 'A civil penalty of $1,000 to $5,000 per violation.', citations: [{ citation: '19 Del. C. § 707(c)', sourceUrl: 'https://delcode.delaware.gov/title19/c007/sc01/index.html' }] },
    unchecked: [],
    basis: null,
  },

  'US-MA': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 6, op: '>' } },
        minutes: 30,
        window: null,
        waiver: null,
        onDutyAllowed: false,
        appliesWhen: null,
        citations: [
          { citation: 'Mass. Gen. Laws c. 149, § 100', sourceUrl: 'https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXXI/Chapter149/Section100' },
          { citation: 'Mass. Gen. Laws c. 149, § 101', sourceUrl: 'https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXXI/Chapter149/Section101' },
        ],
        confidence: 'high',
        note: 'No one may be required to work more than 6 hours in a calendar day without an interval of at least 30 minutes for a meal. § 101 exempts listed continuous-process industries. The Attorney General\'s guidance on voluntary waiver could not be read and is not encoded.',
      },
    ],
    rest: null,
    penalty: { premiumHours: null, missedRestPaid: false, description: 'A fine of $300 to $600.', citations: [{ citation: 'Mass. Gen. Laws c. 149, § 100', sourceUrl: 'https://malegislature.gov/Laws/GeneralLaws/PartI/TitleXXI/Chapter149/Section100' }] },
    unchecked: [],
    basis: null,
  },

  'US-ME': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 6, op: '>' } },
        minutes: 30,
        window: { maxStretch: { hours: 6, op: '<=' } },
        waiver: {},
        onDutyAllowed: false,
        appliesWhen: null,
        citations: [{ citation: '26 M.R.S. § 601', sourceUrl: 'https://legislature.maine.gov/statutes/26/title26sec601.html' }],
        confidence: 'high',
        note: 'No more than 6 consecutive hours at one time without the opportunity for at least 30 consecutive minutes of rest, unpaid only if completely relieved; held to every 6-hour stretch (a reading of "at one time"). A collective bargaining agreement or other written agreement may provide otherwise (record it as a waiver of "meal"). Not where fewer than 3 employees are on duty AND the work allows frequent short paid breaks: both must hold, so it is not encoded.',
      },
    ],
    rest: null,
    penalty: { premiumHours: null, missedRestPaid: false, description: 'A forfeiture of $100 to $500 per violation.', citations: [{ citation: '26 M.R.S. § 602', sourceUrl: 'https://legislature.maine.gov/statutes/26/title26sec602.html' }] },
    unchecked: [],
    basis: null,
  },

  'US-ND': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 5, op: '>' } },
        minutes: 30,
        window: null,
        waiver: {},
        onDutyAllowed: false,
        appliesWhen: { minEmployeesOnDuty: 2 },
        citations: [{ citation: 'N.D. Admin. Code § 46-02-07-02(5)', sourceUrl: 'https://www.ndlegis.gov/information/acdata/pdf/46-02-07.pdf' }],
        confidence: 'high',
        note: 'A shift of more than 5 hours needs a 30-minute meal when two or more employees are on duty. The employee may waive it by agreement with the employer; a collective bargaining agreement prevails.',
      },
    ],
    rest: null,
    penalty: null,
    unchecked: [],
    basis: null,
  },

  'US-NE': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 8, op: '>=' } },
        minutes: 30,
        window: null,
        waiver: {},
        onDutyAllowed: false,
        appliesWhen: { industries: ['manufacturing'] },
        citations: [
          { citation: 'Neb. Rev. Stat. § 48-212', sourceUrl: 'https://nebraskalegislature.gov/laws/statutes.php?statute=48-212' },
          { citation: 'Nebraska Department of Labor, wage and hour fact sheet', sourceUrl: 'https://dol.nebraska.gov/webdocs/getfile/806786ee-024a-47c3-aa2d-356d9a1c0338' },
        ],
        confidence: 'high',
        note: 'Only assembling plants, workshops and mechanical establishments: 30 consecutive minutes in each 8-hour shift, off the premises if the employee wishes. Neither the statute nor the Department defines "workshop" or "mechanical establishment"; both read as manufacturing (encoded as industry "manufacturing"), and a salon, shop or restaurant is probably not covered. A collective bargaining agreement or other written agreement exempts.',
      },
    ],
    rest: null,
    penalty: { premiumHours: null, missedRestPaid: false, description: 'A Class III misdemeanor.', citations: [{ citation: 'Neb. Rev. Stat. § 48-213', sourceUrl: 'https://nebraskalegislature.gov/laws/statutes.php?statute=48-213' }] },
    unchecked: [],
    basis: null,
  },

  'US-NH': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 5, op: '>' } },
        minutes: 30,
        window: { maxStretch: { hours: 5, op: '<=' } },
        waiver: null,
        onDutyAllowed: true,
        appliesWhen: null,
        citations: [{ citation: 'RSA 275:30-a', sourceUrl: 'https://gc.nh.gov/rsa/html/XXIII/275/275-30-a.htm' }],
        confidence: 'high',
        note: 'No more than 5 consecutive hours without a half-hour lunch or eating period, unless it is feasible to eat while working and the employer permits it (pass an on-duty meal); held to every 5-hour stretch.',
      },
    ],
    rest: null,
    penalty: { premiumHours: null, missedRestPaid: false, description: 'A civil penalty of up to $2,500 per violation after a hearing; a first violation gets a written warning and 30 days to cure.', citations: [{ citation: 'RSA 273:11-a', sourceUrl: 'https://gc.nh.gov/rsa/html/XXIII/273/273-11-a.htm' }] },
    unchecked: [],
    basis: null,
  },

  'US-NY': {
    effectiveFrom: null,
    meals: [
      {
        id: 'noonday_meal',
        trigger: { minSpan: { hours: 6, op: '>' }, overlapsClock: ['11:00', '14:00'], startsBefore: '13:00' },
        minutes: 30,
        window: { clock: ['11:00', '14:00'] },
        waiver: null,
        onDutyAllowed: true,
        appliesWhen: null,
        citations: [
          { citation: 'N.Y. Lab. Law § 162(2)', sourceUrl: 'https://www.nysenate.gov/legislation/laws/LAB/162' },
          { citation: 'NYSDOL, Meal and Rest Periods FAQ', sourceUrl: 'https://dol.ny.gov/meal-and-rest-periods-faq' },
        ],
        confidence: 'high',
        note: 'A shift of more than 6 hours extending over 11 a.m.–2 p.m. gets at least 30 minutes within that period (factories: 60, reducible to 30 by NYSDOL policy). Unpaid if completely relieved. Where only one person is on duty, NYSDOL accepts a paid meal eaten on the job with the employee\'s informed, voluntary consent (pass an on-duty meal). A shorter period needs a Commissioner\'s permit (§ 162(5)).',
      },
      {
        id: 'night_meal',
        trigger: { minSpan: { hours: 6, op: '>' }, startsBetweenClock: ['13:00', '06:00'] },
        minutes: 45,
        window: null,
        waiver: null,
        onDutyAllowed: true,
        appliesWhen: null,
        citations: [
          { citation: 'N.Y. Lab. Law § 162(4)', sourceUrl: 'https://www.nysenate.gov/legislation/laws/LAB/162' },
          { citation: 'NYSDOL, Meal and Rest Periods FAQ', sourceUrl: 'https://dol.ny.gov/meal-and-rest-periods-faq' },
        ],
        confidence: 'high',
        note: 'A shift of more than 6 hours starting between 1 p.m. and 6 a.m. gets 45 minutes (factories: 60) midway between its beginning and end. NYSDOL allows 30 minutes "as a matter of course" where there is no hardship to employees; the statute\'s 45 is encoded (stricter). The midway timing is not checked.',
      },
      {
        id: 'evening_meal',
        trigger: { startsBefore: '11:00', endsAfter: '19:00' },
        minutes: 20,
        window: { clock: ['17:00', '19:00'] },
        waiver: null,
        onDutyAllowed: true,
        appliesWhen: null,
        citations: [{ citation: 'N.Y. Lab. Law § 162(3)', sourceUrl: 'https://www.nysenate.gov/legislation/laws/LAB/162' }],
        confidence: 'high',
        note: 'Someone whose workday starts before 11 a.m. and continues later than 7 p.m. gets an additional meal of at least 20 minutes between 5 and 7 p.m.',
      },
    ],
    rest: null,
    penalty: { premiumHours: null, missedRestPaid: false, description: 'Civil penalties of up to $1,000 for a first violation, $2,000 for a second and $3,000 for a third or later.', citations: [{ citation: 'N.Y. Lab. Law § 218(1)', sourceUrl: 'https://www.nysenate.gov/legislation/laws/LAB/218' }] },
    unchecked: ['New York\'s 45-minute meal for a shift starting between 1 p.m. and 6 a.m. must fall midway through the shift; that timing is not checked.'],
    basis: null,
  },

  'US-RI': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 6, op: '>=' }, maxWorked: { hours: 8, op: '<' } },
        minutes: 20,
        window: null,
        waiver: null,
        onDutyAllowed: false,
        appliesWhen: { minEmployeesOnDuty: 3, exceptIndustries: ['healthcare'] },
        citations: [{ citation: 'R.I. Gen. Laws § 28-3-14', sourceUrl: 'https://webserver.rilegislature.gov/Statutes/TITLE28/28-3/28-3-14.htm' }],
        confidence: 'high',
        note: 'A 20-minute mealtime within a 6-hour shift; the employer need not pay for it. Not for licensed healthcare facilities, or an employer with fewer than 3 people on the shift at the worksite.',
      },
      {
        id: 'meal',
        trigger: { minWorked: { hours: 8, op: '>=' } },
        minutes: 30,
        window: null,
        waiver: null,
        onDutyAllowed: false,
        appliesWhen: { minEmployeesOnDuty: 3, exceptIndustries: ['healthcare'] },
        citations: [{ citation: 'R.I. Gen. Laws § 28-3-14', sourceUrl: 'https://webserver.rilegislature.gov/Statutes/TITLE28/28-3/28-3-14.htm' }],
        confidence: 'high',
        note: 'A 30-minute mealtime within an 8-hour shift (in place of the 20 minutes, not in addition).',
      },
    ],
    rest: null,
    penalty: { premiumHours: null, missedRestPaid: false, description: 'A fine of $500 per offense.', citations: [{ citation: 'R.I. Gen. Laws § 28-3-20', sourceUrl: 'https://webserver.rilegislature.gov/Statutes/TITLE28/28-3/28-3-20.htm' }] },
    unchecked: [],
    basis: null,
  },

  'US-TN': {
    effectiveFrom: null,
    meals: [
      {
        id: 'meal',
        trigger: { minWorked: { hours: 6, op: '>=' } },
        minutes: 30,
        window: { notBeforeWorkedHours: 1 },
        waiver: null,
        onDutyAllowed: false,
        appliesWhen: null,
        citations: [
          { citation: 'Tenn. Code Ann. § 50-2-103(h), as reprinted on the Department\'s wage poster', sourceUrl: 'https://www.tn.gov/content/dam/tn/workforce/documents/majorpublications/requiredposters/Wage_Poster.pdf' },
          { citation: 'Tenn. Att\'y Gen. Op. No. 08-187 (2008)', sourceUrl: 'https://www.tn.gov/content/dam/tn/attorneygeneral/documents/ops/2008/op08-187.pdf' },
        ],
        confidence: 'medium',
        note: 'Scheduled for 6 consecutive hours: a 30-minute unpaid rest break or meal, not during or before the first hour of work. Not where the nature of the business gives ample opportunity to rest or take a break (decided case by case; not encoded). A tipped food or beverage server may waive it in writing (not encoded). The code itself is hosted by a commercial publisher; the text is read as the Department and the Attorney General quote it.',
      },
    ],
    rest: null,
    penalty: { premiumHours: null, missedRestPaid: false, description: 'A Class B misdemeanor, and a civil penalty for a willful violation.', citations: [{ citation: 'Tenn. Att\'y Gen. Op. No. 08-187 (2008)', sourceUrl: 'https://www.tn.gov/content/dam/tn/attorneygeneral/documents/ops/2008/op08-187.pdf' }] },
    unchecked: [],
    basis: null,
  },

  // ── No meal or rest break rule for adults ────────────────────────
  'US-AK': none({ citations: [{ citation: 'Alaska DOLWD, Wage and Hour FAQ', sourceUrl: 'https://labor.alaska.gov/lss/whfaq.htm' }], confidence: 'high', note: '"Employers are not required to give breaks for employees 18 and over." Minors: AS 23.10.350.' }),
  'US-AL': none({ citations: [{ citation: 'Alabama Department of Workforce, youth employment guidance', sourceUrl: 'https://workforce.alabama.gov/job-seekers/youth-employment/' }], confidence: 'medium', note: '"No breaks are required for employees 16 and older." Read through a search summary. Minors 14–15: Ala. Code § 25-8-38.' }),
  'US-AR': none({ citations: [{ citation: 'Arkansas Department of Labor and Licensing, FAQ', sourceUrl: 'https://labor.arkansas.gov/resources/faqs/' }], confidence: 'high', note: '"Neither state nor federal wage and hour laws require an employer to provide a break or a meal period."' }),
  'US-AZ': none({ citations: [{ citation: 'Ariz. Rev. Stat. Title 23 (no break provision for adults)', sourceUrl: 'https://www.azleg.gov/ars/23/00233.htm' }], confidence: 'medium', note: 'No statute or Industrial Commission rule requiring adult breaks was found; no agency statement could be reached.' }),
  'US-DC': none({ citations: [{ citation: 'DC DOES Office of Wage-Hour, FAQ', sourceUrl: 'https://does.dc.gov/sites/default/files/dc/sites/does/page_content/attachments/FAQs%20for%20OWH-Final.pdf' }], confidence: 'medium', note: '"Are breaks and lunches required by law? No." The answer cites the FLSA; no District provision was found.' }),
  'US-FL': none({ citations: [{ citation: 'Fla. Stat. § 450.081 (minors only)', sourceUrl: 'http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0400-0499/0450/Sections/0450.081.html' }], confidence: 'medium', note: 'Florida\'s only break rule is in its child labor law. No agency statement on adults could be reached.' }),
  'US-GA': none({ citations: [{ citation: 'Georgia Department of Labor, Breaks and Meals', sourceUrl: 'https://dol.georgia.gov/breaks-and-meals' }], confidence: 'high', note: '"Neither the Fair Labor Standards Act (FLSA) nor Georgia law require breaks or meal periods be given to workers."' }),
  'US-HI': none({ citations: [{ citation: 'Hawaii DLIR, child labor (minors only)', sourceUrl: 'https://labor.hawaii.gov/wsd/child-labor/' }], confidence: 'medium', note: 'Hawaii\'s only break rule is for minors 14–15 (HRS ch. 390). No agency statement on adults could be reached.' }),
  'US-IA': none({ citations: [{ citation: 'Iowa Division of Labor, wage claims FAQ', sourceUrl: 'https://dial.iowa.gov/claims/how-do-i-wage-claim/wage-claims-faq' }], confidence: 'high', note: '"Iowa has no laws mandating meal breaks for adults." Minors under 16: 30 minutes for 5 hours or more.' }),
  'US-ID': none({ citations: [{ citation: 'Idaho Department of Labor, Guide to Idaho labor laws (2026)', sourceUrl: 'https://www.labor.idaho.gov/wp-content/uploads/2026/08/Guide_Idaho-labor-laws.pdf' }], confidence: 'high', note: 'Idaho law does not require lunch or rest breaks.' }),
  'US-IN': none({ citations: [{ citation: 'State of Indiana, FAQ on lunch and break laws', sourceUrl: 'https://faqs.in.gov/hc/en-us/articles/115005044387-Is-there-any-information-regarding-Indiana-lunch-or-breaks-laws' }], confidence: 'high', note: '"In general, Indiana law does not require employers to provide adult employees lunch breaks or other breaks."' }),
  'US-KS': none({ citations: [{ citation: 'Kansas Department of Labor, Working Conditions', sourceUrl: 'https://www.dol.ks.gov/-/working-conditions' }], confidence: 'medium', note: '"Breaks are not required under state or federal law." Read through a search summary; the page blocks automated reading.' }),
  'US-LA': none({ citations: [{ citation: 'La. R.S. 23:213 (minors under 16 only)', sourceUrl: 'https://www.legis.la.gov/Legis/Law.aspx?d=83835' }], confidence: 'medium', note: 'Louisiana\'s only break statute covers minors under 16. No agency statement on adults was found.' }),
  'US-MI': none({ citations: [{ citation: 'Michigan LEO, Wage and Hour FAQ: breaks', sourceUrl: 'https://www.michigan.gov/leo/bureaus-agencies/ber/wage-and-hour/frequently-asked-questions/wage-and-hour/breaks-meal-and-rest-periods' }], confidence: 'high', note: '"There are no requirements for breaks, meal or rest periods for employees 18 years of age or older."' }),
  'US-MO': none({ citations: [{ citation: 'Missouri DOLIR, Breaks, lunches and personal time off', sourceUrl: 'https://labor.mo.gov/dls/general/breaks-lunches-personal-time-off' }], confidence: 'high', note: 'No break requirement outside entertainment work by minors.' }),
  'US-MS': none({ citations: [{ citation: 'US DOL, state meal period requirements (Mississippi not listed)', sourceUrl: 'https://www.dol.gov/agencies/whd/state/meal-breaks' }], confidence: 'medium', note: 'Mississippi has no wage-and-hour statute setting breaks; no state source could be found to cite.' }),
  'US-MT': none({ citations: [{ citation: 'Montana DLI, hours worked', sourceUrl: 'https://erd.dli.mt.gov/labor-standards/wage-and-hour-payment-act/hours-worked' }], confidence: 'high', note: 'No mandate. If breaks are given, rest breaks are work time and an unpaid meal needs complete relief and at least 30 minutes (ARM 24.16.1006).' }),
  'US-NC': none({ citations: [{ citation: 'NCDOL, What to know about breaks', sourceUrl: 'https://www.labor.nc.gov/workplace-rights/employee-rights-regarding-time-worked-and-wages-earned/what-know-about-breaks' }], confidence: 'high', note: 'No break requirement for employees 16 or older.' }),
  'US-NJ': none({ citations: [{ citation: 'US DOL, state meal period requirements (no adult rule listed for New Jersey)', sourceUrl: 'https://www.dol.gov/agencies/whd/state/meal-breaks' }], confidence: 'medium', note: 'No adult rule; minors under 18 get a 30-minute meal (child labor law). No New Jersey agency page could be reached. Bills to add adult breaks have not passed.' }),
  'US-NM': none({ citations: [{ citation: 'New Mexico DWS, Labor Relations FAQ', sourceUrl: 'https://www.dws.nm.gov/en-us/Businesses/Rules-and-Regulations/Labor-Relations-FAQs/category/wages-and-work-hours/pager/31343/page/2' }], confidence: 'high', note: 'No statute requires meal or rest breaks; a break of less than 30 minutes may not be deducted from pay.' }),
  'US-OH': none({ citations: [{ citation: 'Ohio Rev. Code § 4109.07(C) (minors only)', sourceUrl: 'https://codes.ohio.gov/ohio-revised-code/section-4109.07' }], confidence: 'medium', note: 'Ohio\'s only break rule is for minors. No agency statement on adults could be reached.' }),
  'US-OK': none({ citations: [{ citation: 'Oklahoma Department of Labor, Wage and Hour FAQ', sourceUrl: 'https://oklahoma.gov/labor/workplace-rights/wage-hour/faqs---wage-and-hour.html' }], confidence: 'high', note: 'No break requirement for employees 16 or older.' }),
  'US-PA': none({ citations: [{ citation: 'Pennsylvania L&I, Wage FAQs', sourceUrl: 'https://www.pa.gov/agencies/dli/resources/compliance-laws-and-regulations/labor-management-relations/pennsylvania-s-minimum-wage-act/wage-faqs' }], confidence: 'high', note: '"Employers are not required to give breaks for employees 18 and over." (Seasonal farm workers have their own rule.)' }),
  'US-SC': none({ citations: [{ citation: 'SC LLR, Wages FAQ', sourceUrl: 'https://llr.sc.gov/wage/faq.aspx' }], confidence: 'high', note: '"There is no requirement under South Carolina law for an employer to provide employees with breaks or a lunch period."' }),
  'US-SD': none({ citations: [{ citation: 'SD Department of Labor and Regulation, Work Breaks', sourceUrl: 'https://dlr.sd.gov/employment_laws/work_breaks.aspx' }], confidence: 'high', note: '"South Dakota does not have a law requiring an employer to provide rest breaks and meal periods."' }),
  'US-TX': none({ citations: [{ citation: 'Texas Workforce Commission, Texas Guidebook for Employers: Breaks', sourceUrl: 'https://efte.twc.texas.gov/d_breaks.html' }], confidence: 'high', note: '"Neither the FLSA nor Texas law requires employers to give breaks during the workday."' }),
  'US-UT': none({ citations: [{ citation: 'Utah Labor Commission, Wage Claim FAQ', sourceUrl: 'https://laborcommission.utah.gov/divisions/utah-antidiscrimination-and-labor-uald/wage-claim/' }], confidence: 'high', note: '"There are no state or federal laws that require an employer to provide lunch breaks or rest periods for adult workers."' }),
  'US-VA': none({ citations: [{ citation: 'Virginia DOLI, Virginia Labor Laws FAQ', sourceUrl: 'https://doli.virginia.gov/programs/labor-law/virginia-labor-laws/' }], confidence: 'high', note: 'Breaks or a meal period are not required "unless the employee is under the age of 16".' }),
  'US-WI': none({ citations: [{ citation: 'Wis. Admin. Code DWD § 274.02', sourceUrl: 'https://docs.legis.wisconsin.gov/code/admin_code/dwd/270_279/274/02' }], confidence: 'high', note: 'For adults a 30-minute meal is only recommended (it is mandatory for minors). A meal of under 30 minutes, or one the employee may not leave the premises for, must be paid.' }),
  'US-WY': none({ citations: [{ citation: 'Wyoming DWS, Labor Standards employer FAQ', sourceUrl: 'https://dws.wyo.gov/dws-division/labor-standards/employers/faq/' }], confidence: 'high', note: '"No, Wyoming law does not require breaks."' }),
};

module.exports = { AS_OF, JURISDICTIONS };
