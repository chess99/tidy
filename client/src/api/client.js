import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3001/api',
});

export const scanPath = (path) => api.post('/scan', { path });
export const getScanStatus = () => api.get('/scan/status').then(res => res.data);
export const getAssets = (page = 1, limit = 50) => api.get('/assets', { params: { page, limit } }).then(res => res.data);
export const updateAssetStatus = (hash, status) => api.patch(`/assets/${hash}`, { status }).then(res => res.data);
export const syncChanges = () => api.post('/sync').then(res => res.data);

