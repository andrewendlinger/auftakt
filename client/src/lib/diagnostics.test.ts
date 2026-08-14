import { describe, expect, it } from 'vitest';
// Reaches up into electron/, like bootLog.test.ts: `check:unit` is the only automated run
// that touches main-process code at all, and this module is written to be reachable from it.
import {
  buildDiagnosticsBundle,
  diagnosticsFileName,
  formatSystemInfo,
  isBundleRef,
  osLabel,
  redactHome,
  systemLine,
  uniqueBundleName,
  type SystemFacts,
} from '../../../electron/diagnostics';
import { diagnosticsFileName as predictedFileName } from './feedbackMail';

/**
 * The bundle is what a `mailto:` cannot carry: the whole boot log and the machine's details,
 * in a file the customer drags into their own mail. Nothing about it is observable from a
 * browser — dev writes no boot log, the desktop is not somewhere a driving script should
 * write, and the person who finds the mistake is a customer who has already sent the mail.
 * So the text is pinned here.
 */

const FACTS: SystemFacts = {
  app: '0.9.0',
  packaged: true,
  electron: '38.2.1',
  chrome: '140.0.7339.207',
  node: '22.20.0',
  platform: 'win32',
  arch: 'x64',
  osVersion: '10.0.26100',
  osName: 'Windows 11 Pro',
  osRelease: '10.0.26100',
  cpu: 'AMD Ryzen 7 5800X 8-Core Processor',
  cores: 16,
  memTotal: 34359738368,
  memFree: 13314398208,
  displays: [
    { width: 2560, height: 1440, scale: 1.5, rotation: 0, colorDepth: 32, internal: false },
    { width: 1920, height: 1080, scale: 1, rotation: 90, colorDepth: 24, internal: true },
  ],
  locale: 'de',
  systemLocale: 'de-DE',
  timeZone: 'Europe/Berlin',
  gpu: { gpu_compositing: 'enabled', video_decode: 'disabled_software' },
  gpuDevice: 'ANGLE (AMD Radeon RX 6700 XT) · 0x1002 / 0x73df',
  userData: 'C:\\Users\\Marianne Fürst\\AppData\\Roaming\\Auftakt',
  dataDir: 'C:\\Users\\Marianne Fürst\\AppData\\Roaming\\Auftakt',
  home: 'C:\\Users\\Marianne Fürst',
};

const MAC: SystemFacts = {
  ...FACTS,
  platform: 'darwin',
  osVersion: '15.6',
  osName: 'Darwin Kernel Version 24.6.0: Mon Jul 14 11:11:11 PDT 2026; root:xnu-11417.140.69~1',
  osRelease: '24.6.0',
  displays: [{ width: 1728, height: 1117, scale: 2, rotation: 0, colorDepth: 30, internal: true }],
  userData: '/Users/marianne/Library/Application Support/Auftakt',
  dataDir: '/Users/marianne/Library/Application Support/Auftakt',
  home: '/Users/marianne',
};

describe('isBundleRef', () => {
  it('accepts what the dialog produces', () => {
    expect(isBundleRef('AF-2608141542')).toBe(true);
  });

  it('refuses anything that could name a place instead of a file', () => {
    // This is the whole reason the channel may take an argument at all: `ref` is the one
    // renderer value that reaches a path, so the alphabet has to be one that cannot spell one.
    for (const bad of [
      '../../../../etc/passwd',
      'AF-2608141542/../..',
      'AF-2608141542\\..\\..',
      'C:\\Windows\\System32',
      'AF-26081415420',
      'AF-260814154',
      'AF-26081415ab',
      'af-2608141542',
      'AF-2608141542 ',
      '',
      null,
      undefined,
      42,
      { toString: () => 'AF-2608141542' },
    ]) {
      expect(isBundleRef(bad)).toBe(false);
    }
  });
});

describe('diagnosticsFileName', () => {
  it('is a .txt, because .jsonl does not open on double-click on Windows', () => {
    expect(diagnosticsFileName('AF-2608141542')).toBe('Auftakt-Diagnose-AF-2608141542.txt');
  });

  it('agrees with the name the dialog predicts before the file exists', () => {
    // Two definitions, because the client cannot import this module (it reaches node:fs) and
    // „Was wird mitgeschickt?" has to name the file one step before main writes it. This is
    // the assertion that keeps them from drifting into naming two different files.
    for (const ref of ['AF-2608141542', 'AF-0101010000']) {
      expect(predictedFileName(ref)).toBe(diagnosticsFileName(ref));
    }
  });
});

describe('uniqueBundleName', () => {
  const desktop = (...taken: string[]) => (name: string) => taken.includes(name);

  it('uses the reference itself when nothing is in the way', () => {
    expect(uniqueBundleName('AF-2608141542', desktop())).toBe('Auftakt-Diagnose-AF-2608141542.txt');
  });

  it('does not overwrite the report sent a moment earlier', () => {
    // The reference is minute resolution by decision, so somebody who sends a report, spots a
    // typo and sends another gets two files of the same name — and the first mail is still
    // asking them to attach the one that was overwritten.
    const first = 'Auftakt-Diagnose-AF-2608141542.txt';
    expect(uniqueBundleName('AF-2608141542', desktop(first))).toBe(
      'Auftakt-Diagnose-AF-2608141542-2.txt',
    );
    expect(uniqueBundleName('AF-2608141542', desktop(first, 'Auftakt-Diagnose-AF-2608141542-2.txt'))).toBe(
      'Auftakt-Diagnose-AF-2608141542-3.txt',
    );
  });

  it('still returns a name when the desktop is full of them', () => {
    // A hundred reports inside one minute is not a case to design for, but a `save-diagnostics`
    // that returns nothing costs the mail its attachment line, which is the line that matters.
    expect(uniqueBundleName('AF-2608141542', () => true)).toBe(
      'Auftakt-Diagnose-AF-2608141542-99.txt',
    );
  });
});

describe('redactHome', () => {
  it('strips the account name out of every path in the text', () => {
    const text = `Log: ${FACTS.userData}\nDB: C:\\Users\\Marianne Fürst\\Desktop\\saison.db`;
    const out = redactHome(text, FACTS.home);
    expect(out).not.toContain('Marianne Fürst');
    expect(out).toContain('~\\AppData\\Roaming\\Auftakt');
    // The shape of the path is what explains a fault; the person's name never has.
    expect(out).toContain('~\\Desktop\\saison.db');
  });

  it('leaves the text alone when there is no home to strip', () => {
    expect(redactHome('unverändert', '')).toBe('unverändert');
  });
});

describe('osLabel', () => {
  it('prefers the readable field per platform', () => {
    // os.version() is a product name on Windows and the kernel banner on macOS, so neither
    // one is usable on both — printing the banner would be four lines of noise per report.
    expect(osLabel(FACTS)).toBe('Windows 11 Pro (10.0.26100)');
    expect(osLabel(MAC)).toBe('macOS 15.6');
    expect(osLabel({ ...MAC, platform: 'linux' })).toBe('Linux 24.6.0');
  });

  it('falls back rather than printing a blank', () => {
    expect(osLabel({ ...FACTS, osName: '', osVersion: '' })).toBe('Windows');
    expect(osLabel({ ...MAC, osVersion: '' })).toBe('macOS');
  });
});

describe('systemLine', () => {
  it('is the two facts a rendering fault is guessed from, and no more', () => {
    // It rides in the mail body, where the budget is 1900 encoded characters.
    expect(systemLine(FACTS)).toBe('Windows 11 Pro (10.0.26100) · 2560×1440 @1,5×');
    expect(systemLine(MAC)).toBe('macOS 15.6 · 1728×1117 @2×');
    expect(systemLine(FACTS).length).toBeLessThan(60);
  });

  it('drops the display clause rather than inventing one', () => {
    expect(systemLine({ ...FACTS, displays: [] })).toBe('Windows 11 Pro (10.0.26100)');
  });
});

describe('formatSystemInfo', () => {
  it('reads as a table, one machine fact per row', () => {
    expect(formatSystemInfo(FACTS).split('\n')).toEqual([
      'Auftakt     0.9.0',
      'Laufzeit    Electron 38.2.1 · Chrome 140.0.7339.207 · Node 22.20.0',
      'System      Windows 11 Pro (10.0.26100) · win32 x64',
      'Prozessor   AMD Ryzen 7 5800X 8-Core Processor · 16 Kerne',
      'Speicher    32,0 GB gesamt · 12,4 GB frei',
      'Bildschirme 2560×1440 @1,5× · 32 Bit · extern',
      '            1920×1080 @1× · 24 Bit · intern · 90° gedreht',
      'Sprache     de · System de-DE · Zeitzone Europe/Berlin',
      'Grafik      ANGLE (AMD Radeon RX 6700 XT) · 0x1002 / 0x73df',
      '            gpu_compositing: enabled',
      '            video_decode: disabled_software',
      'Ordner      C:\\Users\\Marianne Fürst\\AppData\\Roaming\\Auftakt',
    ]);
  });

  it('says so when the build is not a packaged one', () => {
    // Otherwise a dev-mode report reads as a customer's install with an empty log.
    expect(formatSystemInfo({ ...FACTS, packaged: false })).toContain('0.9.0 (Entwicklungsmodus)');
  });

  it('lists both folders only when they differ', () => {
    // They are the same path packaged, and the repo's .data in dev — printing it twice reads
    // as two folders somebody should go looking in.
    const dev = formatSystemInfo({ ...FACTS, dataDir: 'C:\\src\\auftakt\\.data' });
    expect(dev).toContain('C:\\src\\auftakt\\.data');
    expect(dev.split('\n').filter((l) => l.includes('Roaming'))).toHaveLength(1);
  });

  it('drops rows it has no numbers for instead of printing zeroes', () => {
    const bare = formatSystemInfo({ ...FACTS, cpu: '', memTotal: 0, displays: [], gpu: {}, gpuDevice: '' });
    expect(bare).not.toContain('Prozessor');
    expect(bare).not.toContain('Speicher');
    expect(bare).not.toContain('Bildschirme');
    expect(bare).not.toContain('Grafik');
    expect(bare).toContain('Auftakt');
  });
});

describe('buildDiagnosticsBundle', () => {
  const LOG = ['{"outcome":"play","why":"done","at":"2026-08-14T12:06:35.907Z"}', '{"outcome":"skip"}'].join(
    '\n',
  );

  const bundle = (over: Partial<Parameters<typeof buildDiagnosticsBundle>[0]> = {}) =>
    buildDiagnosticsBundle({
      ref: 'AF-2608141542',
      at: '2026-08-14 15:42:07',
      report: 'Art: Fehler · Bereich: Künstler\n\nWas passiert ist:\nDie Seite blieb leer.',
      facts: FACTS,
      log: LOG,
      entries: 2,
      ...over,
    });

  it('opens on the reference that ties it to the mail', () => {
    const out = bundle();
    expect(out).toContain('Auftakt-Diagnosebericht');
    expect(out).toContain('Kennung:  AF-2608141542');
    expect(out).toContain('Erstellt: 2026-08-14 15:42:07');
  });

  it('puts what the person wrote before the machine bulk', () => {
    // They opened it to check what they are about to send, not to read a GPU flag list.
    const out = bundle();
    expect(out.indexOf('Die Seite blieb leer.')).toBeLessThan(out.indexOf('Electron 38.2.1'));
    expect(out.indexOf('Electron 38.2.1')).toBeLessThan(out.indexOf('"outcome":"play"'));
  });

  it('carries the log in full, not a digest of it', () => {
    // The entire reason the file exists: the mail can only afford five folded lines.
    const out = bundle();
    expect(out).toContain('Startprotokoll (boot-log.jsonl, 2 Einträge)');
    for (const line of LOG.split('\n')) expect(out).toContain(line);
  });

  it('says an empty log is empty rather than showing a blank section', () => {
    const out = bundle({ log: '', entries: 0 });
    expect(out).toContain('0 Einträge');
    expect(out).toContain('noch keinen Start protokolliert');
  });

  it('counts one entry in the singular', () => {
    expect(bundle({ entries: 1 })).toContain('1 Eintrag)');
  });

  it('carries no account name anywhere in it', () => {
    // It is mail, not a local file. The redaction runs over the finished text, so a path the
    // person typed into the report themselves is covered too.
    const out = bundle({
      report: 'Ich habe die Datei aus C:\\Users\\Marianne Fürst\\Desktop geöffnet.',
    });
    expect(out).not.toContain('Marianne Fürst');
    expect(out).toContain('~\\Desktop');
  });

  it('states what is not in it, where that can still be checked', () => {
    expect(bundle()).toContain('keine Termine, Künstler');
  });
});
