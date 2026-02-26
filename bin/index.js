#!/usr/bin/env node

const { runMcpServer } = require('../src/server');

runMcpServer().catch((error) => {
  process.stderr.write(`viruagent-mcp 서버 실행 실패: ${error.message}\n`);
  process.exit(1);
});
