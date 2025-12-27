import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3001/api',
});

export const scanPath = () => api.post('/scan', {});
export const getScanStatus = () => api.get('/scan/status').then(res => res.data);
export const getAssets = (page = 1, limit = 50) => api.get('/assets', { params: { page, limit } }).then(res => res.data);
export const getAsset = (hash) => api.get(`/assets/${hash}`).then(res => res.data);
export const getAssetsBatch = (hashes = []) =>
  api.get('/assets/batch', { params: { hashes: hashes.join(',') } }).then(res => res.data);

export const getFiles = (page = 1, limit = 50, opts = {}) => {
  const { filter = 'all', organized, from, to, hasDup, pathContains, hash, exts } = opts || {};
  const params = { page, limit, filter };
  if (organized != null) params.organized = organized;
  if (hasDup != null) params.hasDup = hasDup;
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
  if (hasDup != null) params.hasDup = hasDup;
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

