const fs = require('fs-extra');
const path = require('path');
const { getDB } = require('../db');

const TRASH_DIR = path.join(process.cwd(), 'data', 'trash');
fs.ensureDirSync(TRASH_DIR);

async function syncChanges() {
  const db = getDB();
  const report = { moved: 0, deleted: 0, errors: 0, messages: [] };

  // 1. Handle Trash
  const trashAssets = db.prepare("SELECT hash FROM assets WHERE status = 'trash'").all();
  
  for (const { hash } of trashAssets) {
    const files = db.prepare("SELECT path FROM files WHERE hash = ?").all(hash);
    
    for (const file of files) {
      if (!fs.existsSync(file.path)) {
        report.messages.push(`File missing: ${file.path}`);
        continue;
      }

      try {
        const fileName = path.basename(file.path);
        const trashPath = path.join(TRASH_DIR, `${hash}_${fileName}`); // avoid collisions
        
        await fs.move(file.path, trashPath, { overwrite: true });
        
        // Mark as missing/deleted in files table
        // Or actually delete the row? 
        // Better to delete row or have a status in files? Schema has 'missing'.
        // Let's delete the row for now as it's no longer in the source tree.
        db.prepare("DELETE FROM files WHERE path = ?").run(file.path);
        
        report.deleted++;
      } catch (err) {
        report.errors++;
        report.messages.push(`Failed to delete ${file.path}: ${err.message}`);
      }
    }
  }

  // 2. Handle Sorted (Target Path) - Not fully implemented yet as UI doesn't allow setting target path easily.
  // But logic would be: if asset.status == 'sorted' and asset.target_path is set:
  // Move ONE of the files to target_path, delete others (if duplicates).
  
  return report;
}

module.exports = { syncChanges };

