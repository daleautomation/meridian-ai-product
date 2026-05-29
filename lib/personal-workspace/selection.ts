// Personal workspace — contact list selection helpers (testable).

import type { PersonalContactCard } from "@/lib/personal-workspace/workspace";

/** Resolve selected card; returns null when list is empty. */
export function resolveSelectedContact(
  visibleContacts: PersonalContactCard[],
  selectedId: string,
): PersonalContactCard | null {
  if (visibleContacts.length === 0) return null;
  return visibleContacts.find((c) => c.id === selectedId) ?? null;
}

/** When selection is missing from the visible list, pick the first visible contact. */
export function syncSelectedId(
  visibleContacts: PersonalContactCard[],
  selectedId: string,
): string {
  if (visibleContacts.length === 0) return "";
  if (visibleContacts.some((c) => c.id === selectedId)) return selectedId;
  return visibleContacts[0].id;
}

/** Only the actively selected card should receive prominent styling. */
export function isContactCardProminent(
  index: number,
  activeNav: string,
  cardId: string,
  selectedId: string,
): boolean {
  return index === 0 && activeNav === "priority" && cardId === selectedId;
}

/** Whether a card should show selected/active styling. */
export function isContactCardSelected(cardId: string, selectedId: string): boolean {
  return Boolean(selectedId) && cardId === selectedId;
}
