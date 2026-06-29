import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const app = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
const status = readFileSync(resolve(root, 'src/components/MinimalScanStatus.jsx'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const headerStart = app.indexOf('<header');
const headerEnd = app.indexOf('</header>', headerStart);
assert(headerStart >= 0 && headerEnd > headerStart, 'App header markup was not found.');

const headerMarkup = app.slice(headerStart, headerEnd);
assert(
  headerMarkup.includes('<MinimalScanStatus'),
  'MinimalScanStatus must render inside the global header.'
);

const statusIndex = headerMarkup.indexOf('<MinimalScanStatus');
const toolsIndex = headerMarkup.indexOf('<Popover>');
assert(
  toolsIndex < 0 || statusIndex < toolsIndex,
  'Task status chip must appear before the tools popover in the header right tool group.'
);

const contentAreaMarker = "{/* Floating Minimal Status for non-task pages */}";
const contentAreaIndex = app.indexOf(contentAreaMarker);
assert(
  contentAreaIndex < 0 || app.indexOf('<MinimalScanStatus', contentAreaIndex) < 0,
  'MinimalScanStatus must not render from the content area floating overlay slot.'
);

assert(
  !status.includes('absolute top-4 right-4'),
  'MinimalScanStatus must not use the old top-right absolute floating overlay.'
);

assert(
  status.includes('Popover') && status.includes('PopoverContent') && status.includes('PopoverTrigger'),
  'MinimalScanStatus must expose task details through a popover.'
);

console.log('Task status header chip checks passed.');
