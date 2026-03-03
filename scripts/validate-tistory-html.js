#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { validateMcpSystemPrompt } = require('../src/utils/systemPromptPolicy');

const usage = () => {
  const script = path.basename(process.argv[1]);
  const lines = [
    '',
    `사용법: node ${script} <html-file-path> [--title "<title>"] [--tags "<tag1,tag2>"]`,
    '',
    '옵션:',
    '  --title   게시글 제목 (미입력 시 파일명 기반)',
    '  --tags    쉼표 구분 태그',
    '예시:',
    `  node ${script} samples/tistory-html-dryrun.html --title "2026년 3월 뉴스"` ,
    '',
  ];
  console.log(lines.join('\n'));
};

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(1);
}

const [inputPath, ...rest] = args;
const normalizedPath = path.resolve(process.cwd(), inputPath);

let title = '';
let tags = '';

for (let i = 0; i < rest.length; i += 1) {
  const key = rest[i];
  if (key === '--title') {
    title = rest[i + 1] || '';
    i += 1;
  } else if (key === '--tags') {
    tags = rest[i + 1] || '';
    i += 1;
  }
}

if (!fs.existsSync(normalizedPath)) {
  console.error(`ERROR: 파일을 찾을 수 없습니다. ${normalizedPath}`);
  process.exit(1);
}

const content = fs.readFileSync(normalizedPath, 'utf8');
const resolvedTitle = title || path.basename(normalizedPath).replace(/\.html$/i, '').replace(/[-_]+/g, ' ');
const resolvedTags = tags || '';

const placeholderMatches = content.match(/<!--\s*IMAGE:\s*([^>]*?)\s*-->/g) || [];
const placeholderCount = placeholderMatches.length;
const expectedPlaceholderCount = 1;
const placeholderOk = placeholderCount === expectedPlaceholderCount;

const policy = validateMcpSystemPrompt({
  title: resolvedTitle,
  content,
  tags: resolvedTags,
});

const result = {
  file: normalizedPath,
  title: resolvedTitle,
  tags: resolvedTags,
  systemPrompt: {
    valid: policy.valid,
    violations: policy.violations,
    warnings: policy.warnings,
    policyFile: policy.policyFile,
  },
  imagePlaceholder: {
    expected: expectedPlaceholderCount,
    actual: placeholderCount,
    ok: placeholderOk,
    samples: placeholderMatches.map((m) => m.replace(/<\s*!--\s*IMAGE:\s*|\s*-->/g, '').trim()),
  },
};

console.log(JSON.stringify(result, null, 2));

const failed = !placeholderOk || !policy.valid;
if (failed) {
  if (!placeholderOk) {
    console.error(`[FAIL] 이미지 플레이스홀더 개수가 맞지 않습니다. expected=${expectedPlaceholderCount}, actual=${placeholderCount}`);
  }
  if (!policy.valid) {
    console.error(`[FAIL] system-prompt 검증을 통과하지 못했습니다. violations=${policy.violations.length}건`);
  }
  process.exit(1);
}

console.log('[OK] HTML 형식/플레이스홀더 검증 통과');
process.exit(0);
