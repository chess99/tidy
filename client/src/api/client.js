import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

function joinUrl(base, p) {
  const b = String(base || '').replace(/\/+$/, '');
  const path = String(p || '');
  if (!path) return b || '';
  if (/^https?:\/\//i.test(path)) return path;
  if (!b) return path.startsWith('/') ? path : `/${path}`;
  if (path.startsWith('/')) return `${b}${path}`;
  return `${b}/${path}`;
}

export function apiUrl(p) {
  return joinUrl(API_BASE_URL, p);
}

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Scan: optionally pass a root (absolute path) to scan.
export const scanPath = ({ root } = {}) => api.post('/scan', root ? { root } : {});
export const getScanStatus = () => api.get('/scan/status').then(res => res.data);
export const getAssets = (page = 1, limit = 50) => api.get('/assets', { params: { page, limit } }).then(res => res.data);
export const getAsset = (hash) => api.get(`/assets/${hash}`).then(res => res.data);
export const getAssetsBatch = (hashes = []) =>
  api.get('/assets/batch', { params: { hashes: hashes.join(',') } }).then(res => res.data);

export const getFiles = (page = 1, limit = 50, opts = {}) => {
  const { filter = 'all', organized, from, to, hasDup, pathContains, hash, exts } = opts || {};
  const params = { page, limit, filter };
  if (organized != null) params.organized = organized;
  if (hasDup) params.hasDup = hasDup;
  if (from != null) params.from = from;
  if (to != null) params.to = to;
  if (pathContains) params.pathContains = pathContains;
  if (hash) params.hash = hash;
  if (Array.isArray(exts) && exts.length) params.exts = exts.join(',');
  return api.get('/files', { params }).then(res => res.data);
};
export const getFilesDateIndex = (filter = 'all', granularity = 'month', opts = {}) => {
  const { organized, from, to, hasDup, pathContains, hash, exts } = opts || {};
  const params = { filter, granularity };
  if (organized != null) params.organized = organized;
  if (hasDup) params.hasDup = hasDup;
  if (from != null) params.from = from;
  if (to != null) params.to = to;
  if (pathContains) params.pathContains = pathContains;
  if (hash) params.hash = hash;
  if (Array.isArray(exts) && exts.length) params.exts = exts.join(',');
  return api.get('/files/date-index', { params }).then(res => res.data);
};
export const getFilesBatch = (ids = []) =>
  api.get('/files/batch', { params: { ids: ids.join(',') } }).then(res => res.data);

export const updateAssetStatus = (hash, status) => api.patch(`/assets/${hash}`, { status }).then(res => res.data);
export const updateAssetsStatusBatch = (hashes = [], status) =>
  api.post('/assets/batch-status', { hashes, status }).then(res => res.data);
export const syncChanges = () => api.post('/sync').then(res => res.data);

// Config / library maintenance
export const getConfig = () => api.get('/config').then((res) => res.data);
export const addScanRoot = ({ root }) => api.post('/config/scan-root', { root }).then((res) => res.data);
export const setScanRootEnabled = ({ root, enabled }) => api.patch('/config/scan-root', { root, enabled: !!enabled }).then((res) => res.data);
export const removeScanRoot = ({ root, clearDb = false }) =>
  api.delete('/config/scan-root', { data: { root, clearDb: !!clearDb } }).then((res) => res.data);
export const setScanType = ({ exts = [], includeNoExt = false }) =>
  api.put('/config/scan-type', { exts, includeNoExt: !!includeNoExt }).then((res) => res.data);

export const clearLibraryByRoot = ({ root, dryRun = false }) => api.post('/library/clear', { root, dryRun }).then((res) => res.data);

// Albums (folders)
export const getAlbums = () => api.get('/albums').then(res => res.data);
export const createAlbum = (name) => api.post('/albums', { name }).then(res => res.data);
export const getAlbumAssets = (albumId, page = 1, limit = 50) =>
  api.get(`/albums/${albumId}/assets`, { params: { page, limit } }).then(res => res.data);

// Organize (move + dedupe)
export const organizeAssets = ({ hashes = [], albumId, albumName }) =>
  api.post('/organize', { hashes, albumId, albumName }).then(res => res.data);

// Tags (skeleton)
export const getTags = (type) => api.get('/tags', { params: type ? { type } : {} }).then(res => res.data);
export const createTag = ({ name, type }) => api.post('/tags', { name, type }).then(res => res.data);
export const getAssetTags = (hash) => api.get(`/tags/asset/${hash}`).then(res => res.data);
export const addAssetTag = (hash, tagId) => api.post(`/tags/asset/${hash}`, { tagId }).then(res => res.data);
export const removeAssetTag = (hash, tagId) => api.delete(`/tags/asset/${hash}/${tagId}`).then(res => res.data);

