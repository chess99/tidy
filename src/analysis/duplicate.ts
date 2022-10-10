import { db } from "../storage/jsonStorage";

export function checkDuplicate() {
  const fileObjs = db.getFileObjs()
  const dupList = {}

  for (let i = 0; i < fileObjs.length - 1; i++) {
    const objI = fileObjs[i]
    if (dupList[objI.md5]) {
      continue;
    }

    for (let j = i + 1; j < fileObjs.length; j++) {
      const objJ = fileObjs[j]
      if (objJ.md5 === objI.md5) {
        if (dupList[objJ.md5]) {
          dupList[objJ.md5].push(objJ.fullPath)
        } else {
          dupList[objJ.md5] = [objJ.fullPath]
        }
      }
    }

    if (dupList[objI.md5]) {
      dupList[objI.md5].push(objI.fullPath)
    }
  }

  db.saveDuplicateList(dupList)
}

