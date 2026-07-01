const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DRIVE_TYPES = {
  removable: 2,
  fixed: 3,
  network: 4,
  cdrom: 5,
  ramdisk: 6,
};

function normalizeMode(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'on' || value === 'force' || value === 'watch') return 'on';
  if (value === 'off' || value === 'false' || value === '0' || value === 'disabled') return 'off';
  return 'auto';
}

function getWatcherMode(env = process.env) {
  if (env.TIDY_DISABLE_WATCHER === '1') return 'off';
  return normalizeMode(env.TIDY_WATCHER_MODE || 'auto');
}

function isUncPath(root) {
  return /^\\\\[^\\]+\\[^\\]+/.test(String(root || ''));
}

function rootExists(root) {
  try {
    if (!fs.existsSync(root)) return false;
    return fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

function driveLetter(root) {
  const parsed = path.win32.parse(String(root || ''));
  const match = parsed.root.match(/^([a-zA-Z]):\\/);
  return match ? `${match[1].toUpperCase()}:` : null;
}

function getWindowsDriveInfo(root) {
  const letter = driveLetter(root);
  if (!letter) return null;

  try {
    const script = [
      `$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${letter}'"`,
      'if ($null -eq $d) { "{}" } else { @{ driveType = [int]$d.DriveType; providerName = [string]$d.ProviderName } | ConvertTo-Json -Compress }',
    ].join('; ');
    const stdout = execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    const json = JSON.parse(String(stdout || '{}').trim() || '{}');
    if (!json || typeof json !== 'object') return null;
    return {
      driveType: Number.isFinite(Number(json.driveType)) ? Number(json.driveType) : null,
      providerName: json.providerName || null,
    };
  } catch {
    return null;
  }
}

function messageFor(reason, extra = {}) {
  if (reason === 'forced_off') return 'File watcher disabled by configuration';
  if (reason === 'forced_on') return 'File watcher forced on for this root';
  if (reason === 'root_inaccessible') return 'Scan root is not accessible';
  if (reason === 'unc_path') return 'UNC/network roots use fallback scanning in auto mode';
  if (reason === 'network_drive') {
    return `Network drive${extra.providerName ? ` (${extra.providerName})` : ''} uses fallback scanning in auto mode`;
  }
  if (reason === 'removable_drive') return 'Removable drives use fallback scanning in auto mode';
  if (reason === 'local_fixed_drive') return 'Local fixed drive is watched in auto mode';
  if (reason === 'local_path') return 'Local path is watched in auto mode';
  return reason;
}

function decision(root, action, reason, extra = {}) {
  return {
    root,
    action,
    reason,
    message: messageFor(reason, extra),
    ...extra,
  };
}

function classifyRoot(root, { mode = getWatcherMode(), platform = process.platform } = {}) {
  const normalizedRoot = String(root || '').trim();

  if (mode === 'off') {
    return decision(normalizedRoot, 'skip', 'forced_off');
  }

  if (!normalizedRoot || !rootExists(normalizedRoot)) {
    return decision(normalizedRoot, 'skip', 'root_inaccessible');
  }

  if (mode === 'on') {
    return decision(normalizedRoot, 'watch', 'forced_on');
  }

  if (platform === 'win32') {
    if (isUncPath(normalizedRoot)) {
      return decision(normalizedRoot, 'skip', 'unc_path');
    }

    const driveInfo = getWindowsDriveInfo(normalizedRoot);
    if (driveInfo?.driveType === DRIVE_TYPES.network) {
      return decision(normalizedRoot, 'skip', 'network_drive', driveInfo);
    }
    if (driveInfo?.driveType === DRIVE_TYPES.removable) {
      return decision(normalizedRoot, 'skip', 'removable_drive', driveInfo);
    }
    if (driveInfo?.driveType === DRIVE_TYPES.fixed) {
      return decision(normalizedRoot, 'watch', 'local_fixed_drive', driveInfo);
    }
  }

  return decision(normalizedRoot, 'watch', 'local_path');
}

function decideWatcherRoots(roots, opts = {}) {
  const mode = opts.mode || getWatcherMode();
  const platform = opts.platform || process.platform;
  const decisions = (Array.isArray(roots) ? roots : []).map((root) => classifyRoot(root, { mode, platform }));
  return {
    mode,
    decisions,
    watchRoots: decisions.filter((item) => item.action === 'watch').map((item) => item.root),
    skippedRoots: decisions.filter((item) => item.action === 'skip').map((item) => item.root),
  };
}

module.exports = {
  DRIVE_TYPES,
  getWatcherMode,
  normalizeMode,
  classifyRoot,
  decideWatcherRoots,
};
