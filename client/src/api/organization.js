import axios from "axios";
import { apiUrl } from "./client";

const api = axios.create({ baseURL: apiUrl("/organization") });
export const loadOrganization = (root) =>
  api.get("/", { params: { root } }).then((r) => r.data);
export const getOrganizationMoves = (root, id, offset) =>
  api
    .get(`/runs/${id}/moves`, { params: { root, offset } })
    .then((r) => r.data);
export const generateOrganization = (data) =>
  api.post("/generate", data).then((r) => r.data);
export const acceptOrganization = (data) =>
  api.post("/accept", data).then((r) => r.data);
export const getDirectorySnapshot = (root, id) =>
  api.get(`/snapshots/${id}`, { params: { root } }).then((r) => r.data);
export const editOrganization = (data) =>
  api.patch("/draft", data).then((r) => r.data);
export const previewOrganization = (data) =>
  api.post("/preview", data).then((r) => r.data);
export const getOrganizationRun = (root, id) =>
  api.get(`/runs/${id}`, { params: { root } }).then((r) => r.data);
export const applyOrganization = (root, id) =>
  api.post(`/runs/${id}/apply`, { root }).then((r) => r.data);
export const cancelOrganization = (root, id) =>
  api.post(`/runs/${id}/cancel`, { root }).then((r) => r.data);
