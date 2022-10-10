import Walker from 'walker'
import path from 'path'


export function scanFolder(folder: string, excludeList?: string[]): Promise<string[]> {
  const files: string[] = []

  return new Promise((resolve, reject) => {
    Walker(path.resolve(folder))
      .filterDir(function (dir, stat) {
        if (excludeList?.includes(dir)) {
          console.warn(`Skipping ${dir}`)
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
      .on('file', function (file: string, stat) {
        console.log('Got file: ' + file)
        files.push(file)
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
        resolve(files)
      })
  })

}
