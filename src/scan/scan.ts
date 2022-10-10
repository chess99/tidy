import { plugins } from "../plugins";
import { db } from "../storage/jsonStorage";
import { folderScanList } from "./folderScanList";
import { scanFolder } from "./scanFolder";

export async function scan() {
  for (const folder of folderScanList.include) {
    const files = await scanFolder(folder, folderScanList.exclude)

    for (const fullPath of files) {
      // if (db.find(fileObj => fileObj.fullPath === file)) {
      //   return
      // }
      const fileObj = { fullPath }
      await plugins.invoke(fileObj)
      db.updateOne(fileObj)
    }


    db.commit()
  }
}