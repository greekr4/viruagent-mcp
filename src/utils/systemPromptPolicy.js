const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'config', 'system-prompt.md');

const readPrompt = () => {
  try {
    return fs.readFileSync(PROMPT_PATH, 'utf-8');
  } catch {
    return '';
  }
};

const countMatches = (content, regex) => {
  const matches = String(content || '').match(regex);
  return matches ? matches.length : 0;
};

const toArray = (tags = '') =>
  String(tags || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const isMarkdownLike = (content = '') => /(^|\n)\s*#{1,4}\s+|^\s{0,3}[-*+]\s+|\*\*|`{1,3}/m.test(content);
const sanitizeTitleDecorations = (title = '') => {
  const rawTitle = String(title || '');
  let sanitized = rawTitle;

  const patterns = [
    /\b미국\s*it\s*핵심\s*뉴스\s*:\s*/gi,
    /\b미국\s*IT\s*핵심\s*뉴스\s*:\s*/g,
    /\(대체이미지[^\)]*\)\s*/giu,
    /\(대체\s*이미지[^\)]*\)\s*/giu,
    /[“"']대체이미지[“"']/giu,
  ];

  patterns.forEach((pattern) => {
    sanitized = sanitized.replace(pattern, '');
  });

  return sanitized
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const hasInvalidTitleDecoration = (title = '') => {
  const normalized = String(title || '').toLowerCase();
  if (!normalized.trim()) return false;
  const blockedPatterns = [
    /\b미국\s*it\s*핵심\s*뉴스\s*:/i,
    /\(대체이미지/i,
    /\(대체/i,
    /대체이미지/i,
    /\b미국\s*it\s*핵심\s*뉴스\b/i,
  ];
  return blockedPatterns.some((block) => block.test(normalized));
};

const validateMcpSystemPrompt = ({ title = '', content = '', tags = '' } = {}) => {
  const sanitizedTitle = sanitizeTitleDecorations(title);
  const textContent = String(content || '');
  const prompt = readPrompt();
  const violations = [];
  const warnings = [];

  if (!String(sanitizedTitle || '').trim()) {
    violations.push('title이 비어 있습니다.');
  }
  if (String(sanitizedTitle || '').trim().length < 12) {
    violations.push('title은 12자 이상 작성하는 것을 권장합니다.');
  }
  if (hasInvalidTitleDecoration(sanitizedTitle)) {
    violations.push('제목에 임시 접두사/접미사(예: `미국 IT 핵심 뉴스:`, `(대체이미지시도)`)를 넣지 마세요.');
  }

  const h2Count = countMatches(textContent, /<h2\b/gi);
  const imagePlaceholderCount = countMatches(textContent, /<!--\s*IMAGE:\s*[^>]+-->/gi);
  const listExists = /<ul\b/i.test(textContent) || /<ol\b/i.test(textContent);
  const tableExists = /<table\b/i.test(textContent);
  const quoteExists = /<blockquote\s+data-ke-style="style1"[\s>]/i.test(textContent);
  const hrExists = /<hr\b[^>]*data-ke-style="style6"/i.test(textContent);
  const listParagraphExists = /<p\b[^>]*data-ke-size="size16"/i.test(textContent);
  const htmlLike = /<[a-zA-Z][^>]*>/g.test(textContent);

  if (h2Count < 6) {
    violations.push('섹션 수가 부족합니다. `h2`를 최소 6개 이상 사용하세요.');
  }

  if (imagePlaceholderCount < 1) {
    violations.push('상단 고정 규격에 필요한 `<!-- IMAGE: ... -->` 플레이스홀더가 없습니다.');
  }

  if (!quoteExists) {
    violations.push('상단 인용문 블록(`blockquote data-ke-style="style1"`)이 없습니다.');
  }

  if (!hrExists) {
    violations.push('구분선(`data-ke-style="style6"`)이 없습니다.');
  }

  if (!listExists) {
    violations.push('목록(`ul` 또는 `ol`)을 1개 이상 넣어 주세요.');
  }

  if (!tableExists) {
    violations.push('표(`table`)를 1개 이상 넣어 주세요.');
  }

  if (!listParagraphExists) {
    warnings.push('`<p data-ke-size="size16">` 스타일 단락이 없어 티스토리 편집기 정합성이 떨어질 수 있습니다.');
  }

  if (!htmlLike) {
    violations.push('본문이 HTML 형태가 아니거나 태그가 거의 없습니다.');
  }

  if (!htmlLike && !prompt.includes('형식: 티스토리 HTML 중심')) {
    warnings.push('system-prompt.md의 HTML 규격과 일치하지 않을 수 있습니다.');
  }

  if (isMarkdownLike(textContent)) {
    warnings.push('마크다운 문법이 감지되었습니다. `system-prompt` 기준으로 HTML 태그를 사용해 주세요.');
  }

  const tagCount = toArray(tags).length;
  if (tagCount > 0 && tagCount < 10) {
    warnings.push('태그가 10개 미만입니다. 검색 유입용으로 10개를 권장합니다.');
  }
  if (tagCount > 10) {
    warnings.push('태그가 10개를 초과했습니다. 너무 많은 태그는 노이즈가 됩니다.');
  }

  return {
    valid: violations.length === 0,
    violations,
    warnings,
    rules: {
      minH2: 6,
      requireImagePlaceholder: 1,
      requireQuote: true,
      requireHr: true,
      requireList: true,
      requireTable: true,
      requiredTagCount: 10,
      titleMinLength: 12,
    },
    policyFile: PROMPT_PATH,
    policyLoadedLength: prompt.length,
    title: {
      original: String(title || ''),
      sanitized: sanitizedTitle,
    },
  };
};

module.exports = {
  sanitizeTitleDecorations,
  validateMcpSystemPrompt,
};
