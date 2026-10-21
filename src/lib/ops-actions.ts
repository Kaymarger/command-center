import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  CheckCircle2,
  FilePenLine,
  FileText,
  Handshake,
  Home,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  MailPlus,
  MessagesSquare,
  RefreshCw,
  Scale,
  Send,
  Share2,
  ShieldCheck,
} from "lucide-react";

export type BotTarget =
  | "transaction"
  | "listings"
  | "manager"
  | "work-routine"
  | "none";

export type NestedOption = {
  id: string;
  label: string;
  children?: NestedOption[];
  needsOtherText?: boolean;
  /** Show info only — do not open a submit form */
  viewOnly?: boolean;
  /** Override the parent action bot for this leaf */
  botOverride?: BotTarget;
};

export type OpsAction = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  external?: boolean;
  bot: BotTarget;
  primaryField?: {
    name: string;
    label: string;
    placeholder: string;
    multiline?: boolean;
    required?: boolean;
  };
  /** Extra identifier field (e.g. owner/client name) */
  allowOwnerOrClient?: boolean;
  /** Free-text details / notes below primary */
  detailsField?: {
    label: string;
    placeholder: string;
    required?: boolean;
  };
  /** Choose Save draft vs Send before submitting */
  deliveryChoice?: boolean;
  /** Multi-property + copies fields (feature sheet printing) */
  multiPropertyPrint?: boolean;
  /** Action is placeholder — show TBD, do not submit */
  comingSoon?: boolean;
  attachments?: boolean;
  nestedOptions?: NestedOption[];
  successHint: string;
};

export const MAILCHIMP_URL =
  process.env.NEXT_PUBLIC_MAILCHIMP_URL ?? "https://login.mailchimp.com/";

export const documentOptions: NestedOption[] = [
  { id: "cps", label: "Contract of Purchase & Sale" },
  { id: "disclosure-representation", label: "Disclosure of Representation" },
  { id: "privacy-notice", label: "Privacy Notice" },
  { id: "team-disclosure", label: "Team Disclosure" },
  { id: "direction-of-offers", label: "Direction of Offers" },
  { id: "property-disclosure", label: "Property Disclosure Statement" },
  {
    id: "material-latent-defects",
    label: "Disclosure of Material Latent Defects",
  },
  {
    id: "fintrac",
    label: "Fintrac",
    children: [
      { id: "fintrac-individual", label: "Individual" },
      { id: "fintrac-pep", label: "Politically Exposed Person" },
      { id: "fintrac-corporation", label: "Corporation" },
      { id: "fintrac-beneficial", label: "Beneficial Ownership Record" },
    ],
  },
  {
    id: "addendum",
    label: "Addendum",
    children: [
      { id: "addendum-date", label: "Date Change Addendum" },
      { id: "addendum-price", label: "Price Change Addendum" },
      { id: "addendum-repair", label: "Repair Addendum" },
      { id: "addendum-other", label: "Other", needsOtherText: true },
    ],
  },
  { id: "referral-invoice", label: "Referral Exchange Invoice" },
  { id: "other-doc", label: "Other", needsOtherText: true },
];

export const opsActions: OpsAction[] = [
  {
    id: "view-dashboard",
    label: "View Dashboard",
    description: "Open the operations dashboard.",
    icon: LayoutDashboard,
    href: "/dashboard",
    bot: "none",
    successHint: "",
  },
  {
    id: "update-conveyancing",
    label: "Update Conveyancing",
    description:
      "Choose Reply or New Email, write the update, then save a Gmail draft or send.",
    icon: Scale,
    bot: "transaction",
    nestedOptions: [
      { id: "conveyancing-reply", label: "Reply" },
      { id: "conveyancing-new-email", label: "New Email" },
    ],
    primaryField: {
      name: "update",
      label: "Message",
      placeholder: "What should conveyancing know?",
      multiline: true,
    },
    deliveryChoice: true,
    attachments: true,
    successHint: "Conveyancing email handled.",
  },
  {
    id: "areg-chat",
    label: "Message AREG Chat",
    description: "Message AREG Chat via the Work Routine bot. Attachments optional.",
    icon: MessagesSquare,
    bot: "work-routine",
    primaryField: {
      name: "message",
      label: "Message",
      placeholder: "What should the team see?",
      multiline: true,
    },
    attachments: true,
    successHint: "Sent to Work Routine bot for AREG Chat.",
  },
  {
    id: "generate-email",
    label: "Generate Email",
    description: "Write the email brief, then save a draft or send.",
    icon: MailPlus,
    bot: "manager",
    primaryField: {
      name: "brief",
      label: "What should the email say?",
      placeholder: "Purpose, recipient, key points…",
      multiline: true,
    },
    deliveryChoice: true,
    attachments: true,
    successHint: "Email handled by manager bot.",
  },
  {
    id: "generate-document",
    label: "Generate Document",
    description: "Pick a document type, then add property and details.",
    icon: FileText,
    bot: "transaction",
    nestedOptions: documentOptions,
    primaryField: {
      name: "property",
      label: "Property / file reference",
      placeholder: "Address or MLS #",
    },
    detailsField: {
      label: "Details",
      placeholder: "Parties, dates, special instructions, anything the bot needs…",
      required: true,
    },
    successHint: "Document request sent to transaction bot.",
  },
  {
    id: "docusign",
    label: "Send via DocuSign",
    description: "Describe the packet, then save a draft or send for signature.",
    icon: Send,
    bot: "transaction",
    primaryField: {
      name: "update",
      label: "DocuSign update",
      placeholder: "What needs to go out for signature?",
      multiline: true,
    },
    deliveryChoice: true,
    successHint: "DocuSign request sent to transaction bot.",
  },
  {
    id: "open-houses",
    label: "Open Houses",
    description: "Add opens, delete opens in Paragon, or view available agents.",
    icon: CalendarDays,
    bot: "listings",
    nestedOptions: [
      { id: "add-opens", label: "Add Opens" },
      {
        id: "delete-opens",
        label: "Delete Opens",
        botOverride: "transaction",
      },
      {
        id: "view-available-agents",
        label: "View Available Agents",
        viewOnly: true,
      },
    ],
    primaryField: {
      name: "property",
      label: "Property",
      placeholder: "Address or MLS #",
    },
    successHint: "Open house change sent.",
  },
  {
    id: "feature-sheet",
    label: "Feature Sheet",
    description: "Update feature sheets or send them for printing.",
    icon: LayoutTemplate,
    bot: "listings",
    nestedOptions: [
      { id: "update-feature-sheets", label: "Update Feature Sheets" },
      { id: "send-for-printing", label: "Send for Printing" },
    ],
    primaryField: {
      name: "property",
      label: "Property",
      placeholder: "Address or MLS #",
    },
    successHint: "Feature sheet request queued.",
  },
  {
    id: "new-listing",
    label: "New Listing",
    description: "Enter the property address. Sends to Listings bot.",
    icon: Home,
    bot: "listings",
    primaryField: {
      name: "address",
      label: "Property address",
      placeholder: "123 Main St, Vancouver",
    },
    successHint: "Sent to Listings bot.",
  },
  {
    id: "relist-property",
    label: "Relist Property",
    description: "Enter property address or owner name, plus optional details.",
    icon: RefreshCw,
    bot: "transaction",
    primaryField: {
      name: "reference",
      label: "Property address or owner name",
      placeholder: "Address or owner name",
    },
    detailsField: {
      label: "Details (optional)",
      placeholder: "Why relisting, price change, board notes…",
    },
    successHint: "Relist request sent to transaction bot.",
  },
  {
    id: "prepare-offer",
    label: "Prepare an Offer",
    description: "TBD — structure coming next.",
    icon: FilePenLine,
    bot: "transaction",
    comingSoon: true,
    successHint: "",
  },
  {
    id: "accepted-offer",
    label: "Accepted Offer",
    description: "Enter property address or client name. Sends to transaction bot.",
    icon: Handshake,
    bot: "transaction",
    primaryField: {
      name: "reference",
      label: "Property address or client name",
      placeholder: "Address or client name",
    },
    successHint: "Accepted offer sent to transaction bot.",
  },
  {
    id: "prepare-subject-removal",
    label: "Prepare Subject Removal",
    description: "Enter property address or client name.",
    icon: CheckCircle2,
    bot: "transaction",
    primaryField: {
      name: "reference",
      label: "Property address or client name",
      placeholder: "Address or client name",
    },
    successHint: "Subject removal prep queued for transaction bot.",
  },
  {
    id: "firm-offer",
    label: "Firm Offer",
    description: "Enter property address or client name.",
    icon: ShieldCheck,
    bot: "transaction",
    primaryField: {
      name: "reference",
      label: "Property address or client name",
      placeholder: "Address or client name",
    },
    successHint: "Firm offer noted for transaction bot.",
  },
  {
    id: "social-media",
    label: "Social Media",
    description: "Choose a channel and prep content.",
    icon: Share2,
    bot: "listings",
    nestedOptions: [
      { id: "instagram", label: "Instagram" },
      { id: "rental-blog", label: "Rental Blog" },
      { id: "real-estate-blog", label: "Real Estate Blog" },
      { id: "google-business", label: "Google Business" },
    ],
    primaryField: {
      name: "notes",
      label: "Topic / notes",
      placeholder: "What should this post cover?",
      multiline: true,
    },
    successHint: "Social media request queued.",
  },
  {
    id: "newsletter",
    label: "Newsletter",
    description: "Open Mailchimp to update the newsletter.",
    icon: Mail,
    href: MAILCHIMP_URL,
    external: true,
    bot: "none",
    successHint: "",
  },
];

export function botLabel(bot: BotTarget): string {
  if (bot === "transaction") return "Transaction bot";
  if (bot === "listings") return "Listings bot";
  if (bot === "manager") return "Manager bot";
  if (bot === "work-routine") return "Work Routine bot";
  return "Ops";
}
