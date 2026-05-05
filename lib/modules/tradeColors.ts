// Meridian — trade color catalog.
//
// One palette per trade module, used by the "All Trades" calendar view
// to color-code cards by which trade the lead belongs to. Single-trade
// views continue to use the LaborTech service color palette (set in
// lib/services/serviceCatalog.ts).

export type TradeColorEntry = {
  id: string;
  label: string;
  shortLabel: string;
  border: string;     // strong accent — left card border
  background: string; // soft fill — pill background
  pill: string;       // pill border (border + alpha hex)
  text: string;       // pill text + accent color
};

export const TRADE_COLORS: Record<string, TradeColorEntry> = {
  roofing: {
    id: "roofing",
    label: "Roofing",
    shortLabel: "Roofing",
    border: "#B91C1C",
    background: "#FEF2F2",
    pill: "#FECACA",
    text: "#B91C1C",
  },
  hvac: {
    id: "hvac",
    label: "HVAC",
    shortLabel: "HVAC",
    border: "#0D9488",
    background: "#CCFBF1",
    pill: "#5EEAD4",
    text: "#0F766E",
  },
  carpentry: {
    id: "carpentry",
    label: "Carpentry",
    shortLabel: "Carpentry",
    border: "#92400E",
    background: "#FEF3C7",
    pill: "#FCD34D",
    text: "#92400E",
  },
  painting: {
    id: "painting",
    label: "Painting",
    shortLabel: "Painting",
    border: "#7C3AED",
    background: "#EDE9FE",
    pill: "#C4B5FD",
    text: "#6D28D9",
  },
  plumbing: {
    id: "plumbing",
    label: "Plumbing",
    shortLabel: "Plumbing",
    border: "#2563EB",
    background: "#DBEAFE",
    pill: "#93C5FD",
    text: "#1D4ED8",
  },
  electrical: {
    id: "electrical",
    label: "Electrical",
    shortLabel: "Electrical",
    border: "#CA8A04",
    background: "#FEF9C3",
    pill: "#FDE68A",
    text: "#A16207",
  },
};

export const TRADE_COLOR_ORDER: string[] = [
  "roofing",
  "hvac",
  "carpentry",
  "painting",
  "plumbing",
  "electrical",
];

export function getTradeColor(trade: string | null | undefined): TradeColorEntry | null {
  if (!trade) return null;
  return TRADE_COLORS[trade.toLowerCase()] ?? null;
}
