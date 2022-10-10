import path from 'path'
import fse from 'fs-extra'
import { FileObj } from '../typings'

const tempDir = path.resolve(__dirname, '../../.temp')
const outputFiles = path.join(tempDir, 'files.json')
const outputDuplicateList = path.join(tempDir, 'dup.json')

class JsonDb {
  _fileObjs: FileObj[] = []

  getFileObjs() {
    if (this._fileObjs.length) {
      return this._fileObjs
    }
    const files = JSON.parse(fse.readFileSync(outputFiles, 'utf8') || '[]')
    this._fileObjs = files
    return files
  }

  commit() {
    fse.mkdirp(tempDir)
    fse.writeFileSync(outputFiles, JSON.stringify(this._fileObjs, null, 2))
  }

  updateOne(fileObj) {
    const oldObj = this._fileObjs.find(obj => obj.fullPath === fileObj.fullPath)
    if (oldObj) {
      Object.assign(oldObj, fileObj)
    } else {
      this._fileObjs.push(fileObj)
    }
  }

  saveDuplicateList(dupList) {
    fse.mkdirp(tempDir)
    fse.writeFileSync(outputDuplicateList, JSON.stringify(dupList, null, 2))
  }
}

export const db = new JsonDb()