import { describe, expect, it } from 'vitest';
import { backupDirProblem } from '../../../electron/backup';

/**
 * The module under test lives in `electron/`, not here. Vitest is installed in `client/` only,
 * so this is where a test of it can run — and it is worth the odd import: `backupDirProblem`
 * is the entire UNC defence (LEG-01), it is pure string logic, and until now nothing checked
 * it at all. The four `check:*` scripts drive the server; this function runs in the Electron
 * main process, which no automated run reaches. `docs/BACKUP-TESTING.md` case 2b covers the
 * other half — that the dialog actually refuses a path typed into the Windows folder picker.
 *
 * Why it exists: `backup_dir` reaches the privileged main process, and a startup backup writing
 * to `\\host\share` is an outbound SMB write that leaks the user's NTLMv2 hash.
 */

describe('backupDirProblem', () => {
  it('refuses a Windows UNC path', () => {
    expect(backupDirProblem('\\\\server\\freigabe')).toMatch(/Netzwerkordner/);
    expect(backupDirProblem('\\\\192.168.1.10\\backups\\auftakt')).toMatch(/Netzwerkordner/);
  });

  it('refuses the forward-slash UNC form too', () => {
    // isAbsolute() treats both forms as absolute, so the relative-path check below never sees
    // them — the `//` prefix has to be rejected explicitly or a NAS share walks straight in.
    expect(backupDirProblem('//server/freigabe')).toMatch(/Netzwerkordner/);
  });

  it('names a local or cloud folder as the alternative', () => {
    // The message is the only thing the user gets; a bare refusal leaves them stuck, so it has
    // to say what *does* work. Cloud folders are ordinary local paths and are the intended answer.
    const msg = backupDirProblem('\\\\server\\freigabe');
    expect(msg).toMatch(/Google Drive|Dropbox|OneDrive/);
  });

  it('refuses a relative path', () => {
    expect(backupDirProblem('backups')).toMatch(/relative Pfade/);
    expect(backupDirProblem('./backups')).toMatch(/relative Pfade/);
    expect(backupDirProblem('')).toMatch(/relative Pfade/);
  });

  it('accepts an ordinary absolute folder', () => {
    // Cloud-synced folders surface as plain local paths — those are the recommended target.
    expect(backupDirProblem('/Users/someone/Google Drive/Auftakt')).toBeNull();
    expect(backupDirProblem('/var/backups')).toBeNull();
    // Deliberately no `C:\…` case: isAbsolute() is the *host's* implementation, so a Windows
    // drive path reads as relative when this suite runs on macOS/Linux (and `/var/backups`
    // would read as absolute on Windows either way). Asserting the real customer path here
    // would fail in CI on everything but the Windows runner. That half stays manual —
    // docs/BACKUP-TESTING.md case 2b.
  });
});
