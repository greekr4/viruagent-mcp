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

const toLowerCaseTrim = (value = '') => String(value || '').toLowerCase().trim();

const normalizeDataKeStyleValue = (rawValue = '') => {
  const unescaped = String(rawValue)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
  return toLowerCaseTrim(unescaped).replace(/^["']|["']$/gu, '');
};

const collectDataKeStyles = (html = '', tagName = '') => {
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\bdata-ke-style\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, 'gi');
  const matches = String(html || '').matchAll(pattern);
  const styles = [];

  for (const match of matches) {
    const styleValue = match?.[2] || match?.[3];
    if (!styleValue) continue;
    styles.push(normalizeDataKeStyleValue(styleValue));
  }

  return [...new Set(styles.filter(Boolean))];
};

const hasTagWithDataKeStyle = (html = '', tagName = '', styleName = '') => {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  const target = toLowerCaseTrim(styleName);
  const matches = String(html || '').matchAll(pattern);

  for (const match of matches) {
    const tag = match?.[0];
    if (!tag) continue;

    const styleMatch = tag.match(/data-ke-style\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i);
    if (!styleMatch) {
      continue;
    }

    const normalized = normalizeDataKeStyleValue(styleMatch[2] || styleMatch[3]);
    if (normalized === target) {
      return true;
    }
  }

  return false;
};

const stripHtmlText = (html = '') => {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const textContentLength = stripHtmlText(textContent).length;
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
  const hrWithStyleCount = countMatches(
    textContent,
    /<hr\b[^>]*\bdata-ke-style\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))[^>]*>/gi
  );
  const hrStyles = collectDataKeStyles(textContent, 'hr');
  const uniqueHrStyles = hrStyles.filter(Boolean);
  const hrStyle = uniqueHrStyles[0] || '';
  const imagePlaceholderCount = countMatches(textContent, /<!--\s*IMAGE:\s*[^>]+-->/gi);
  const quoteExists = hasTagWithDataKeStyle(textContent, 'blockquote', 'style1');
  const hrExists = uniqueHrStyles.length > 0;
  const listParagraphExists = /<p\b[^>]*data-ke-size="size16"/i.test(textContent);
  const htmlLike = /<[a-zA-Z][^>]*>/g.test(textContent);

  if (h2Count < 5) {
    violations.push('섹션 수가 부족합니다. `h2`를 최소 5개 이상 사용하세요.');
  }

  if (hrWithStyleCount < h2Count) {
    violations.push(`섹션 분리 규칙이 부족합니다. 현재 h2 ${h2Count}개 기준으로 ` +
      `style가 있는 hr가 최소 ${h2Count}개 필요합니다.`);
  }

  const firstHrPosition = textContent.search(/<hr\b[^>]*\bdata-ke-style/gi);
  const firstH2Position = textContent.search(/<h2\b/gi);
  if (firstHrPosition !== -1 && firstH2Position !== -1 && firstHrPosition > firstH2Position) {
    violations.push('첫 구분선은 첫 <h2>보다 먼저 배치해야 합니다.');
  }

  if (!hrExists) {
    violations.push('구분선(`data-ke-style`)이 없습니다.');
  } else if (uniqueHrStyles.length > 1) {
    violations.push(`구분선 style이 섞였습니다: ${uniqueHrStyles.join(', ')}`);
  } else if (!/^style[1-8]$/.test(hrStyle)) {
    violations.push(`구분선 style은 style1~style8만 허용됩니다. 현재: ${hrStyle}`);
  }

  if (imagePlaceholderCount < 1) {
    violations.push('상단 고정 규격에 필요한 `<!-- IMAGE: ... -->` 플레이스홀더가 없습니다.');
  }

  if (textContentLength < 1500 || textContentLength > 2000) {
    violations.push(`본문 길이는 1500~2000자여야 합니다. 현재 ${textContentLength}자입니다.`);
  }

  if (!quoteExists) {
    violations.push('상단 인용문 블록(`blockquote data-ke-style="style1"`)이 없습니다.');
  }

  if (!listParagraphExists) {
    warnings.push('`<p data-ke-size="size16">` 스타일 단락이 없어 티스토리 편집기 정합성이 떨어질 수 있습니다.');
  }

  if (!htmlLike) {
    violations.push('본문이 HTML 형태가 아니거나 태그가 거의 없습니다.');
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
      minH2: 5,
      requireImagePlaceholder: 1,
      requireQuote: true,
      requireHr: true,
      requireSingleHrStyle: true,
      hrStyleRange: 'style1~style8',
      requireList: false,
      requireTable: false,
      minContentLength: 1500,
      maxContentLength: 2000,
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
