/** BC tenant notice dates. Logic matches the working reference calculator. */

export const TENANT_CALCULATOR_PATH = "/tenant-calculator";

export const TENANT_CALCULATOR_PUBLIC_URL =
  "https://command-center-three-plum.vercel.app/tenant-calculator";

export const DELIVERY_METHODS = [
  { id: "mail", days: 5, label: "Ordinary or registered mail (5 days)" },
  { id: "in-person", days: 0, label: "Handed to tenant in person (same day)" },
  { id: "mailbox", days: 3, label: "Left in mailbox or mail slot (3 days)" },
  { id: "door", days: 3, label: "Attached to the door (3 days)" },
] as const;

export type DeliveryMethodId = (typeof DELIVERY_METHODS)[number]["id"];

export const DEFAULT_DELIVERY_METHOD: DeliveryMethodId = "mail";

const ROW_LABELS = [
  "Subjects removed, notice served",
  "Notice deemed received",
  "3 months' notice ends",
  "Tenancy ends (effective date)",
  "Buyer can move in",
] as const;

export type NoticeRow = { label: (typeof ROW_LABELS)[number]; value: string };

export function isTenantCalculatorPath(pathname: string): boolean {
  return (
    pathname === TENANT_CALCULATOR_PATH ||
    pathname.startsWith(`${TENANT_CALCULATOR_PATH}/`)
  );
}

function parseUtcDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 864e5);
}

function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), last)));
}

function formatNoticeDate(date: Date): string {
  return date.toLocaleDateString("en-CA", {
    weekday: "short",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function deliveryDays(id: string): number {
  const method = DELIVERY_METHODS.find((item) => item.id === id);
  return method ? method.days : 5;
}

export function calculateTenantNotice(input: {
  served: string;
  deliveryId: string;
  rentDueDay: string;
  fixedTerm: boolean;
  termEnd: string;
}): NoticeRow[] {
  const served = parseUtcDate(input.served);
  if (!served) return [];

  const received = addDays(served, deliveryDays(input.deliveryId));
  const minimum = addMonths(received, 3);
  const rentDue = Math.min(Math.max(+input.rentDueDay || 1, 1), 28);
  let ends = minimum;
  for (let i = 0; i < 40 && addDays(ends, 1).getUTCDate() !== rentDue; i++) {
    ends = addDays(ends, 1);
  }

  let note = "";
  if (input.fixedTerm) {
    const termEnd = parseUtcDate(input.termEnd);
    if (termEnd && termEnd > ends) {
      ends = termEnd;
      note = " (end of fixed term)";
    }
  }

  const values = [
    formatNoticeDate(served),
    formatNoticeDate(received),
    formatNoticeDate(minimum),
    formatNoticeDate(ends) + note,
    formatNoticeDate(addDays(ends, 1)),
  ];

  return ROW_LABELS.map((label, index) => ({
    label,
    value: values[index] ?? "",
  }));
}
