export interface FileObj {
  fullPath: string;
  exif?: {
    status?: number,
    data?: Object,
  }
  md5?: string;
}