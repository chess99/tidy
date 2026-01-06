/**
 * input: Express req/res
 * output: 健康检查 JSON（用于桌面壳等待后端 ready）
 * pos: 路由层：被 `server/index.js` 挂载（变更需同步更新本头注释与所属目录 README）
 */

const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ ok: true, service: 'tidy-server' });
});

module.exports = router;


