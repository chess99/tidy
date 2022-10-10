import { FileObj } from "../typings";

var ExifImage = require('exif').ExifImage;

enum pluginExifStauts {
  OK = 1,
  ERROR = 2,
}

export const pluginExif = {
  invoke(fileObj: FileObj) {
    if (!/\.jpg$/i.test(fileObj.fullPath)) {
      return
    }
    console.log('exifData', fileObj.exif && fileObj.exif.data)
    if (fileObj.exif && fileObj.exif.status === pluginExifStauts.OK) {
      return
    }
    getExif(fileObj.fullPath, (err, exifData) => {
      if (err) {
        fileObj.exif = {
          status: pluginExifStauts.ERROR,
        }
        return
      }
      fileObj.exif = {
        status: pluginExifStauts.OK,
        data: exifData,
      }
    })
  },
}

function getExif(filePath, callback) {
  console.log('getExif', filePath);
  new ExifImage({ image: filePath }, function (error, exifData) {
    if (error) {
      console.log('Error: ' + error.message);
      callback(error, null)
    } else {
      console.log(exifData); // Do something with your data!
      callback(null, exifData)
    }

  });
}
