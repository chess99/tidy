#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PID_FILE = path.join(__dirname, '.dev-pids.json');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(color, label, message) {
  console.log(`${color}[${label}]${colors.reset} ${message}`);
}

function savePids(pids) {
  fs.writeFileSync(PID_FILE, JSON.stringify(pids, null, 2));
}

function loadPids() {
  if (fs.existsSync(PID_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

function killProcess(pid) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/PID', pid.toString()], { 
        stdio: 'ignore',
        shell: true 
      });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch (e) {
    // Process might already be dead
  }
}

function startServer(name, cwd) {
  log(colors.blue, name, 'Starting...');
  
  const isWindows = process.platform === 'win32';
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: path.join(__dirname, cwd),
    shell: true,
    stdio: 'inherit',
    detached: false,
  });

  proc.on('error', (err) => {
    log(colors.red, name, `Error: ${err.message}`);
  });

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(colors.red, name, `Exited with code ${code}`);
    }
  });

  return proc.pid;
}

function main() {
  const command = process.argv[2];

  if (command === 'stop') {
    log(colors.yellow, 'STOP', 'Stopping all development servers...');
    const pids = loadPids();
    if (pids) {
      if (pids.backend) killProcess(pids.backend);
      if (pids.frontend) killProcess(pids.frontend);
      fs.unlinkSync(PID_FILE);
      log(colors.green, 'STOP', 'All servers stopped.');
    } else {
      log(colors.yellow, 'STOP', 'No running servers found.');
    }
    return;
  }

  // Check if already running
  const existingPids = loadPids();
  if (existingPids) {
    log(colors.yellow, 'WARN', 'Servers might already be running. Use "node dev-start.js stop" to stop them first.');
  }

  log(colors.green, 'START', 'Starting development servers...');
  console.log('');

  // Start backend
  const backendPid = startServer('BACKEND', 'server');

  // Wait a bit before starting frontend
  setTimeout(() => {
    const frontendPid = startServer('FRONTEND', 'client');
    savePids({ backend: backendPid, frontend: frontendPid });
  }, 1000);

  // Handle cleanup on exit
  process.on('SIGINT', () => {
    log(colors.yellow, 'STOP', 'Stopping servers...');
    const pids = loadPids();
    if (pids) {
      if (pids.backend) killProcess(pids.backend);
      if (pids.frontend) killProcess(pids.frontend);
      fs.unlinkSync(PID_FILE);
    }
    process.exit(0);
  });

  log(colors.green, 'INFO', 'Servers are running. Press Ctrl+C to stop.');
}

main();

