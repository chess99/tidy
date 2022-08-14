export interface FileObj {
  fullPath: string;
  exif?: {
    status?: number,
    data?: Object,
  }
}