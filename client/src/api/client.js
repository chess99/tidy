/**
 * input: 后端 HTTP API（baseURL/网络）
 * output: API 请求函数（统一参数/错误语义）
 * pos: 客户端-服务端边界：API 调用封装（变更需同步更新本头注释与所属目录 README）
 */

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

function buildFilesParams(opts = {}) {
  const {
    filter = 'all',
    organized,
    from,
    to,
    hasDup,
    pathContains,
    hash,
    exts,
    people,
    hasPeople,
    personCountMin,
    personCountMax,
    similarKind,
    similarToFileId,
    similarThreshold,
    similarTopK,
    similarMinScore,
    smartQuery,
    smartTopK,
    smartMinScore,
  } = opts || {};
  const params = { filter };
  if (organized != null) params.organized = organized;
  if (hasDup) params.hasDup = hasDup;
  if (hasPeople) params.hasPeople = 1;
  if (Number.isFinite(personCountMin)) params.personCountMin = personCountMin;
  if (Number.isFinite(personCountMax)) params.personCountMax = personCountMax;
  if (from != null) params.from = from;
  if (to != null) params.to = to;
  if (pathContains) params.pathContains = pathContains;
  if (hash) params.hash = hash;
  if (Array.isArray(exts) && exts.length) params.exts = exts.join(',');
  if (Array.isArray(people) && people.length) params.people = people.join(',');
  if (similarKind === 'phash') {
    const fid = Number(similarToFileId);
    if (Number.isFinite(fid)) {
      params.similarKind = 'phash';
      params.similarToFileId = Math.trunc(fid);
      const th = Number(similarThreshold);
      if (Number.isFinite(th)) params.similarThreshold = Math.max(0, Math.min(32, Math.trunc(th)));
    }
  }
  if (similarKind === 'clip') {
    const fid = Number(similarToFileId);
    if (Number.isFinite(fid)) {
      params.similarKind = 'clip';
      params.similarToFileId = Math.trunc(fid);
      const k = Number(similarTopK);
      if (Number.isFinite(k)) params.similarTopK = Math.max(1, Math.min(5000, Math.trunc(k)));
      const ms = Number(similarMinScore);
      if (Number.isFinite(ms)) params.similarMinScore = ms;
    }
  }
  if (smartQuery != null) {
    const q = String(smartQuery || '').trim();
    if (q) params.smartQuery = q;
  }
  if (smartTopK != null && Number.isFinite(Number(smartTopK))) {
    params.smartTopK = Math.max(1, Math.min(5000, Math.trunc(Number(smartTopK))));
  }
  if (smartMinScore != null && Number.isFinite(Number(smartMinScore))) params.smartMinScore = Number(smartMinScore);
  return params;
}

// Jobs (task queue)
export const listJobs = ({ limit = 50, offset = 0, status, type } = {}) =>
  api.get('/jobs', { params: { limit, offset, status, type } }).then((res) => res.data);
export const getJob = (id) => api.get(`/jobs/${id}`).then((res) => res.data);
export const createJob = ({ type, mode = 'missing', params = {} } = {}) =>
  api.post('/jobs', { type, mode, params }).then((res) => res.data);
export const cancelJob = (id) => api.post(`/jobs/${id}/cancel`).then((res) => res.data);
export const retryJob = (id) => api.post(`/jobs/${id}/retry`).then((res) => res.data);
export const getAssets = (page = 1, limit = 50, opts = {}) => {
  const status = opts?.status != null ? String(opts.status) : null;
  const params = { page, limit };
  if (status) params.status = status;
  return api.get('/assets', { params }).then((res) => res.data);
};
export const getAsset = (hash) => api.get(`/assets/${hash}`).then(res => res.data);
export const getAssetsBatch = (hashes = []) =>
  api.get('/assets/batch', { params: { hashes: hashes.join(',') } }).then(res => res.data);

export const getFiles = (page = 1, limit = 50, opts = {}, { signal } = {}) => {
  const params = { page, limit, ...buildFilesParams(opts) };
  return api.get('/files', { params, signal }).then(res => res.data);
};

// Unified files fetcher:
// - normal browse/filters: GET /files
// - smart search: POST /files (ranked)
export const getFilesUnified = (page = 1, limit = 50, opts = {}, { signal } = {}) => {
  const q = String(opts?.smartQuery || '').trim();
  if (q) {
    const body = { page, limit, ...buildFilesParams(opts) };
    return api.post('/files', body, { signal }).then((res) => res.data);
  }
  return getFiles(page, limit, opts, { signal });
};
export const getFilesDateIndex = (filter = 'all', granularity = 'month', opts = {}) => {
  const {
    organized,
    from,
    to,
    hasDup,
    pathContains,
    hash,
    exts,
    people,
    hasPeople,
    personCountMin,
    personCountMax,
    similarKind,
    similarToFileId,
    similarThreshold,
  } = opts || {};
  const params = { filter, granularity };
  if (organized != null) params.organized = organized;
  if (hasDup) params.hasDup = hasDup;
  if (hasPeople) params.hasPeople = 1;
  if (Number.isFinite(personCountMin)) params.personCountMin = personCountMin;
  if (Number.isFinite(personCountMax)) params.personCountMax = personCountMax;
  if (from != null) params.from = from;
  if (to != null) params.to = to;
  if (pathContains) params.pathContains = pathContains;
  if (hash) params.hash = hash;
  if (Array.isArray(exts) && exts.length) params.exts = exts.join(',');
  if (Array.isArray(people) && people.length) params.people = people.join(',');
  if (similarKind === 'phash') {
    const fid = Number(similarToFileId);
    if (Number.isFinite(fid)) {
      params.similarKind = 'phash';
      params.similarToFileId = Math.trunc(fid);
      const th = Number(similarThreshold);
      if (Number.isFinite(th)) params.similarThreshold = Math.max(0, Math.min(32, Math.trunc(th)));
    }
  }
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
export const setScanOptions = ({ excludeGlobs = [], minFileSizeBytes = 0 } = {}) =>
  api.put('/config/scan-options', { excludeGlobs, minFileSizeBytes }).then((res) => res.data);
export const setTaskSettings = ({ concurrency = {}, autoTrigger = {} } = {}) =>
  api.put('/config/tasks', { concurrency, autoTrigger }).then((res) => res.data);
export const setWorkspacePaths = ({ managedRoot, trashDir } = {}) =>
  api.put('/config/workspace', { managedRoot, trashDir }).then((res) => res.data);
export const getSystemStatus = () => api.get('/system/status').then((res) => res.data);

export const clearLibraryByRoot = ({ root, dryRun = false }) => api.post('/library/clear', { root, dryRun }).then((res) => res.data);

// Albums (folders)
export const getAlbums = () => api.get('/albums').then(res => res.data);
export const createAlbum = (name) => api.post('/albums', { name }).then(res => res.data);
export const getAlbumAssets = (albumId, page = 1, limit = 50) =>
  api.get(`/albums/${albumId}/assets`, { params: { page, limit } }).then(res => res.data);

// Organize (move + dedupe)
export const organizeAssets = ({ hashes = [], albumId, albumName, duplicatePolicy = 'keep-all' }) =>
  api.post('/organize', { hashes, albumId, albumName, duplicatePolicy }).then(res => res.data);

// Tags (skeleton)
export const getTags = (type) => api.get('/tags', { params: type ? { type } : {} }).then(res => res.data);
export const createTag = ({ name, type }) => api.post('/tags', { name, type }).then(res => res.data);
export const getAssetTags = (hash) => api.get(`/tags/asset/${hash}`).then(res => res.data);
export const addAssetTag = (hash, tagId) => api.post(`/tags/asset/${hash}`, { tagId }).then(res => res.data);
export const removeAssetTag = (hash, tagId) => api.delete(`/tags/asset/${hash}/${tagId}`).then(res => res.data);

// Faces (data management; scanning/recluster/reset are jobs)
export const getFaces = (hash) => api.get(`/faces/asset/${hash}`).then(res => res.data);
export const getPeople = () => api.get(`/faces/people`).then(res => res.data);
export const createPerson = (name) => api.post(`/faces/people`, { name }).then(res => res.data);
export const renamePerson = (personId, name) => api.patch(`/faces/people/${personId}`, { name }).then((res) => res.data);
export const updateFace = (id, { person_id }) => api.put(`/faces/${id}`, { person_id }).then(res => res.data);
export const createPersonFromFace = (faceId, name) => api.post(`/faces/create-from-face`, { face_id: faceId, name }).then(res => res.data);
export const mergePerson = (fromPersonId, intoPersonId) =>
  api.post(`/faces/people/${fromPersonId}/merge`, { intoPersonId }).then((res) => res.data);
export const splitPerson = (fromPersonId, faceIds = []) =>
  api.post(`/faces/people/${fromPersonId}/split`, { faceIds }).then((res) => res.data);

// Duplicates tool
export const getDuplicateGroups = ({ kind = 'phash', threshold = 10, limit = 20, cursor } = {}) => {
  const params = { kind, threshold, limit };
  if (cursor != null) params.cursor = cursor;
  return api.get('/duplicates/groups', { params }).then((res) => res.data);
};

export const applyDuplicateActions = ({ keepFileIds = [], deleteFileIds = [] } = {}) =>
  api.post('/duplicates/apply', { keepFileIds, deleteFileIds }).then((res) => res.data);

// Open file location in system file manager
export const openFileLocation = (hash) => api.post(`/assets/${hash}/open-location`).then((res) => res.data);
