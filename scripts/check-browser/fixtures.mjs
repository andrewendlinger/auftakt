/**
 * What crosses a scenario file's boundary — the type, so a mistyped key is a red rather than an
 * `undefined` twenty assertions later, and the one guard that goes with it (`handedOver`, below).
 *
 * There are two kinds of entry and the split makes the difference visible for the first time.
 * Most are **fixtures the prologue built**: the season copies each area works in, taken before
 * anything has written so that no area starts from another's leftovers, and the two browser
 * handles. A handful are **helpers one area built and a later one reuses** — those are handed
 * over explicitly, with an `Object.assign` at the foot of the file that owns them, and they are
 * the only backwards-facing coupling left between the fifteen files.
 *
 * Values are mostly `any` on purpose: they are API response bodies, and narrowing them would mean
 * restating the server's response shape inside the gate whose job is to catch the server
 * disagreeing with it. The key names are the part worth checking, and they are checked.
 *
 * @typedef {object} Fixtures
 *
 * @property {any} registry the `/seasons` document this run started from
 * @property {import('playwright-core').Browser} browser
 * @property {import('playwright-core').Browser} chrome the same browser, under the prologue's own name
 * @property {import('playwright-core').BrowserContext} context the one context every case but L opens windows in
 * @property {number} HOME the demo's own default season; every case returns to it
 * @property {Array<{ release: (v?: unknown) => void }>} heldRoutes every request a case has parked
 * @property {(what: string, copy?: boolean) => Promise<any>} makeSeason
 * @property {number} PAGE_BREAK_FIRST
 * @property {number[]} PAGE_BREAK_TRIES
 *
 * @property {any} data B–E · the copy the broadcast and season-switch cases work in
 * @property {any} trash I · the copy the delete path may empty
 * @property {any} sorted J–K, AT–AW · the copy the reorder cases shuffle
 * @property {any} sheets N · the copy whose project 1 loses its status pill
 * @property {any} printed N2 · the one season that is not a copy — a task list of a tuned length
 * @property {any} config O–R2 · the copy the settings cases rewrite
 * @property {any} subtree X–Z · the copy the subtask tree is cut about in
 * @property {any} toolbox AA–AC · the copy the two short notes are marked up in
 * @property {any} pictures AD–AG · a different copy, because a picture would move AA–AC's offsets
 * @property {any} agedSeason AJ–AK · not a copy: the archive boundary is only legible on three rows
 * @property {any} columnsSeason AL–AO · the copy the four typed columns are built in
 * @property {any} landingSeason AP, AS · not a copy: an empty season is the fallback card's state
 * @property {{ seasonId: number, project: any, resize: (n: number) => Promise<number> }} pageBreak
 *
 * Handed over rather than built here, so they are optional on the object the prologue makes:
 * each is present from the moment its own file has run, which is always before its first reader.
 *
 * @property {(path: string) => string} [S] `records` → `reorder` · the sorted season's query scope
 * @property {(locator: any) => Promise<string>} [textOf] `subtasks` → `toolbox`, `images`
 * @property {(locator: any) => Promise<any>} [boxOf] `toolbox` → `images`, `archive`
 * @property {(page: any) => Promise<any>} [caretIn] `toolbox` → `images`
 * @property {(page: any) => Promise<any>} [openNote] `toolbox` → `images`
 * @property {(page: any, reader: any) => Promise<any>} [saveNote] `toolbox` → `images`
 * @property {(page: any, title: string) => any} [toolbarBtn] `toolbox` → `images`
 * @property {(n: number) => string} [pad2] `archive` → `columns`
 * @property {(page: any) => Promise<any>} [rowIds] `archive` → `columns`
 */

/**
 * The handed-over helpers, taken together with the run order that guarantees them.
 *
 * They are optional on `Fixtures` because the prologue cannot build them — each exists only from
 * the moment the file that owns it has run — so every call to one is „possibly undefined" to a
 * typechecker, and the reader has no way to say „but my writer ran first" except by asserting it.
 * This is that assertion, once, for all five readers.
 *
 * A miss is never a defect in the app and never something to carry on past: it is the ordered
 * list in `check-browser.mjs` having moved so that a reader now runs before its writer, and the
 * next twenty assertions would fail against a gate that is holding the wrong end of itself. Names
 * the key and stops, rather than leaving `undefined is not a function` to be traced back by hand.
 *
 * @template {keyof Fixtures} K
 * @param {Fixtures} fixtures
 * @param {K[]} keys
 * @returns {{ [P in K]-?: NonNullable<Fixtures[P]> }}
 */
export function handedOver(fixtures, keys) {
  const missing = keys.filter((key) => fixtures[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Weitergereichte Helfer fehlen: ${missing.join(', ')} — die Reihenfolge der Fälle in` +
        ` check-browser.mjs stimmt nicht mehr, ein Leser läuft vor seinem Schreiber`,
    );
  }
  // The keys are checked one by one above; the cast is only how that reaches the type.
  return /** @type {any} */ (fixtures);
}
