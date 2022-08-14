import { plugins } from "./plugins";
import { FileObj } from "./typings";

import path from 'path'
import fse from 'fs-extra'

import Walker from 'walker'


const outputDir = path.resolve(__dirname, '../.temp')
const outputFile = path.join(outputDir, 'out.json')

const files2 = JSON.parse(fse.readFileSync(outputFile, 'utf8') || '[]')
const files = []

// 去重
files2.forEach(f1 => {
  if (files.find(f2 => f2.fullPath === f1.fullPath)) {
    return
  }
  files.push(f1)
})

Walker(path.resolve('Z:\\_backup\\DCIM'))
  .filterDir(function (dir, stat) {
    if (dir === '/etc/pam.d') {
      console.warn('Skipping /etc/pam.d and children')
      return false
    }
    return true
  })
  .on('entry', function (entry, stat) {
    console.log('Got entry: ' + entry)
  })
  .on('dir', function (dir, stat) {
    console.log('Got directory: ' + dir)
  })
  .on('file', function (file, stat) {
    console.log('Got file: ' + file)
    const fileObj: FileObj = {
      fullPath: file,
    }
    if (files.find(fileObj => fileObj.fullPath === file)) {
      return
    }
    plugins.invoke(fileObj)
    files.push(fileObj)
  })
  .on('symlink', function (symlink, stat) {
    console.log('Got symlink: ' + symlink)
  })
  .on('blockDevice', function (blockDevice, stat) {
    console.log('Got blockDevice: ' + blockDevice)
  })
  .on('fifo', function (fifo, stat) {
    console.log('Got fifo: ' + fifo)
  })
  .on('socket', function (socket, stat) {
    console.log('Got socket: ' + socket)
  })
  .on('characterDevice', function (characterDevice, stat) {
    console.log('Got characterDevice: ' + characterDevice)
  })
  .on('error', function (er, entry, stat) {
    console.log('Got error ' + er + ' on entry ' + entry)
  })
  .on('end', function () {
    console.log('All files traversed.')

    fse.mkdirp(outputDir)
    setTimeout(() => {
      fse.writeFileSync(outputFile, JSON.stringify(files, null, 2))
    }, 30 * 1000);
  })


