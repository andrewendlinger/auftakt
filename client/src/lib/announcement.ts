import type { Announcement, AnnouncementFeed } from '../api/types';
import { changelogAnnouncement } from './changelog';

/**
 * The announcement overlay's pure half (WP-63): what to show, and how the body is set out.
 *
 * Kept out of the component so `check:unit` reaches it without React — the same reason
 * `lib/sectionSpecs.ts` and `lib/taskColumns.ts` are where they are. The overlay itself then
 * holds only the canvas, the focus handling and the markup.
 */

/**
 * Everything to show right now, most urgent first.
 *
 * **Dated before „Was ist neu".** A dated announcement is tied to a day and stops being right
 * the moment that day is over; release notes are just as true tomorrow. They are queued rather
 * than merged because they are two different cards — one is a greeting, the other a list — and
 * one card that tried to be both would be neither.
 *
 * `dismissed` is this window's own session state, not the stored marker: the marker is written
 * when the card is confirmed, but the *feed* is only read once per start, so without a local set
 * a second render would put the same card straight back up.
 */
export function announcementQueue(
  feed: AnnouncementFeed | undefined,
  appVersion: string,
  dismissed: ReadonlySet<string>,
  md?: string,
): Announcement[] {
  if (!feed) return [];
  const queue = [...feed.dated];
  const whatsNew = changelogAnnouncement(appVersion, feed.version, md);
  if (whatsNew) queue.push(whatsNew);
  return queue.filter((a) => !dismissed.has(a.id));
}

/**
 * The body split into its main text and an optional sign-off — the last paragraph, set apart
 * (smaller, warm gold) instead of running on as another line of the message.
 *
 * **Dated announcements only, and that is the point of the `version` test.** A hand-written
 * greeting ends in a name; a changelog entry ends in „_Außerdem:_ …" or in the last bullet of a
 * list, and giving *that* the sign-off treatment would put a stray gold line under every set of
 * release notes. The rule is the one the agreed preview draws: two or more paragraphs, the last
 * one is the sign-off.
 *
 * Paragraphs are blank-line separated. Single newlines are left in the string — `Markdown`
 * renders them as `<br>` through remark-breaks, so the split here is only about which block gets
 * the treatment, never about how a block is rendered.
 */
export function splitSignoff(a: Announcement): { lead: string; signoff: string | null } {
  const body = a.body.trim();
  if (a.version !== undefined) return { lead: body, signoff: null };
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== '');
  if (paragraphs.length < 2) return { lead: body, signoff: null };
  return { lead: paragraphs.slice(0, -1).join('\n\n'), signoff: paragraphs[paragraphs.length - 1]! };
}

/**
 * How the card presents itself. Derived from the trigger, never from `celebrate` — the fireworks
 * are an independent flag and a release announcement may set them just as well (design note, and
 * the preview shows both).
 */
export function announcementTone(a: Announcement): {
  /** Small caps line above the title; absent on a dated card, which is a message and not a list. */
  eyebrow: string | null;
  centered: boolean;
  confirm: string;
} {
  return a.version !== undefined
    ? { eyebrow: 'Was ist neu', centered: false, confirm: 'Alles klar' }
    : { eyebrow: null, centered: true, confirm: 'Danke!' };
}
