import md5File = require('md5-file');
import { FileObj } from "../typings";

export const pluginMd5 = {
  async invoke(fileObj: FileObj) {
    if (fileObj.md5) {
      return
    }
    fileObj.md5 = await md5File(fileObj.fullPath)
  },
}
