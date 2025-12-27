import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3001/api',
});

export const scanPath = (path) => api.post('/scan', { path });
export const getScanStatus = () => api.get('/scan/status').then(res => res.data);
export const getAssets = (page = 1, limit = 50) => api.get('/assets', { params: { page, limit } }).then(res => res.data);
export const getAsset = (hash) => api.get(`/assets/${hash}`).then(res => res.data);
export const getAssetsBatch = (hashes = []) =>
  api.get('/assets/batch', { params: { hashes: hashes.join(',') } }).then(res => res.data);

export const getFiles = (page = 1, limit = 50, opts = {}) => {
  const { filter = 'all' } = opts || {};
  return api.get('/files', { params: { page, limit, filter } }).then(res => res.data);
};
export const getFilesBatch = (ids = []) =>
  api.get('/files/batch', { params: { ids: ids.join(',') } }).then(res => res.data);

export const updateAssetStatus = (hash, status) => api.patch(`/assets/${hash}`, { status }).then(res => res.data);
export const syncChanges = () => api.post('/sync').then(res => res.data);

