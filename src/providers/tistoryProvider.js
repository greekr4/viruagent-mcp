const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const readline = require('readline');
const { saveProviderMeta, clearProviderMeta, getProviderMeta } = require('../storage/sessionStore');

const tistoryPath = path.join(__dirname, '../../../viruagent/src/lib/tistory.js');
const tistory = require(tistoryPath);

const LOGIN_SELECTORS = {
  username: [
    'input[name="id"]',
    'input[name="userId"]',
    'input[type="text"][placeholder*="아이디"]',
    'input[type="text"][autocomplete="username"]',
    '#id',
    '#loginId',
  ],
  password: [
    'input[type="password"]',
    'input[name="password"]',
    'input[name="userPw"]',
    'input[autocomplete="current-password"]',
    '#password',
    '#loginPw',
  ],
  submit: [
    'button[type="submit"]',
    'button:has-text("로그인")',
    'input[type="submit"]',
    '#account-login-btn',
    'button#loginBtn',
  ],
  otp: [
    'input[name*="otp"]',
    'input[placeholder*="인증"]',
    'input[autocomplete="one-time-code"]',
    'input[name*="code"]',
  ],
};

const KAKAO_TRIGGER_SELECTORS = [
  'a.link_kakao_id',
  'a:has-text("카카오계정으로 로그인")',
];

const KAKAO_LOGIN_SELECTORS = {
  username: ['input[name="loginId"]', '#loginId--1', 'input[placeholder*="카카오메일"]'],
  password: ['input[name="password"]', '#password--2', 'input[type="password"]'],
  submit: ['button[type="submit"]', 'button:has-text("로그인")', '.btn_g.highlight.submit'],
  rememberLogin: ['#saveSignedIn--4', 'input[name="saveSignedIn"]'],
};

const KAKAO_2FA_SELECTORS = {
  start: ['#tmsTwoStepVerification', '#emailTwoStepVerification'],
  emailModeButton: ['button:has-text("이메일로 인증하기")', '.link_certify'],
  codeInput: ['input[name="email_passcode"]', '#passcode--6', 'input[placeholder*="인증번호"]'],
  confirm: ['button:has-text("확인")', 'button.btn_g.submit', 'button[type="submit"]'],
  rememberDevice: ['#isRememberBrowser--5', 'input[name="isRememberBrowser"]'],
};

const KAKAO_ACCOUNT_CONFIRM_SELECTORS = {
  textMarker: [
    'text=해당 카카오 계정으로',
    'text=티스토리\n해당 카카오 계정으로',
    'text=해당 카카오계정으로 로그인',
  ],
  continue: [
    'button:has-text("계속하기")',
    'a:has-text("계속하기")',
    'button:has-text("다음")',
  ],
  otherAccount: [
    'button:has-text("다른 카카오계정으로 로그인")',
    'a:has-text("다른 카카오계정으로 로그인")',
  ],
};

const readCredentialsFromEnv = () => {
  const username = process.env.TISTORY_USERNAME || process.env.TISTORY_USER || process.env.TISTORY_ID;
  const password = process.env.TISTORY_PASSWORD || process.env.TISTORY_PW;
  return {
    username: typeof username === 'string' && username.trim() ? username.trim() : null,
    password: typeof password === 'string' && password.trim() ? password.trim() : null,
  };
};

const mapVisibility = (visibility) => {
  const normalized = String(visibility || 'public').toLowerCase();
  if (Number.isFinite(Number(visibility)) && [0, 15, 20].includes(Number(visibility))) {
    return Number(visibility);
  }
  if (normalized === 'private') return 0;
  if (normalized === 'protected') return 15;
  return 20;
};

const isPublishLimitError = (error) => {
  const message = String(error?.message || '');
  return /발행 실패:\s*403/.test(message) || /\b403\b/.test(message);
};

const isProvidedCategory = (value) => {
  return value !== undefined && value !== null && String(value).trim() !== '';
};

const buildCategoryList = (rawCategories) => {
  const entries = Object.entries(rawCategories || {});
  const categories = entries.map(([name, id]) => ({
    name,
    id: Number(id),
  }));
  return categories.sort((a, b) => a.id - b.id);
};

const waitForUser = async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question('', resolve));
  rl.close();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pickValue = async (page, selectors) => {
  for (const selector of selectors) {
    const element = await page.$(selector);
    if (element) {
      return selector;
    }
  }
  return null;
};

const fillBySelector = async (page, selectors, value) => {
  const selector = await pickValue(page, selectors);
  if (!selector) {
    return false;
  }
  await page.locator(selector).fill(value);
  return true;
};

const clickSubmit = async (page, selectors) => {
  const selector = await pickValue(page, selectors);
  if (!selector) {
    return false;
  }
  await page.locator(selector).click({ timeout: 5000 });
  return true;
};

const checkBySelector = async (page, selectors) => {
  const selector = await pickValue(page, selectors);
  if (!selector) {
    return false;
  }
  const locator = page.locator(selector);
  const isChecked = await locator.isChecked().catch(() => false);
  if (!isChecked) {
    await locator.check({ force: true }).catch(() => {});
  }
  return true;
};

const hasElement = async (page, selectors) => {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count > 0) {
      return true;
    }
  }
  return false;
};

const hasKakaoAccountConfirmScreen = async (page) => {
  const url = page.url();
  const isKakaoDomain = url.includes('accounts.kakao.com') || url.includes('kauth.kakao.com');
  if (!isKakaoDomain) {
    return false;
  }

  return await hasElement(page, KAKAO_ACCOUNT_CONFIRM_SELECTORS.textMarker);
};

const clickKakaoAccountContinue = async (page) => {
  if (!(await hasKakaoAccountConfirmScreen(page))) {
    return false;
  }

  const continueSelector = await pickValue(page, KAKAO_ACCOUNT_CONFIRM_SELECTORS.continue);
  if (!continueSelector) {
    return false;
  }

  await page.locator(continueSelector).click({ timeout: 5000 });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(800);
  return true;
};

const IMAGE_PLACEHOLDER_REGEX = /<!--\s*IMAGE:\s*([^>]*?)\s*-->/g;

const escapeRegExp = (value = '') => {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const sanitizeKeywordForFilename = (value = '') => {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 50) || 'image';
};

const normalizeTempDir = () => {
  const tmpDir = path.join(os.tmpdir(), 'viruagent-mcp-images');
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
};

const buildImageFileName = (keyword, ext = 'jpg') => {
  const base = sanitizeKeywordForFilename(keyword || 'image');
  const random = crypto.randomBytes(4).toString('hex');
  return `${base}-${random}.${ext}`;
};

const buildTistoryImageTag = (uploadedImage, keyword) => {
  const alt = String(keyword || '').replace(/"/g, '&quot;');
  if (uploadedImage?.uploadedUrl) {
    return `<p data-ke-size="size16"><img src="${uploadedImage.uploadedUrl}" alt="${alt}" /></p>`;
  }

  if (uploadedImage?.uploadedKage) {
    return `<p data-ke-size="size16">[##_Image|${uploadedImage.uploadedKage}|CDM|1.3|{"originWidth":0,"originHeight":0,"style":"alignCenter"}_##]</p>`;
  }

  return `<p data-ke-size="size16"><img src="${uploadedImage.uploadedUrl}" alt="${alt}" /></p>`;
};

const normalizeThumbnailForPublish = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('kage@')) return trimmed;

  const dnaMatch = trimmed.match(/\/dna\/(.+?)(?:[/?#]|$)/);
  if (dnaMatch?.[1]) {
    return `kage@${dnaMatch[1]}`;
  }

  if (!trimmed.includes('://') && trimmed.includes('/')) {
    return `kage@${trimmed}`;
  }

  return null;
};

const guessExtensionFromContentType = (contentType = '') => {
  const normalized = contentType.toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('bmp')) return 'bmp';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  return 'jpg';
};

const isImageContentType = (contentType = '') => {
  const normalized = contentType.toLowerCase();
  return normalized.startsWith('image/') || normalized.includes('application/octet-stream') || normalized.includes('binary/octet-stream');
};

const guessExtensionFromUrl = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    const match = parsed.pathname.match(/\.([a-zA-Z0-9]+)(?:$|\?)/);
    if (!match) return null;
    const ext = match[1].toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif', 'ico'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
    return null;
  } catch {
    return null;
  }
};

const getImageSignatureExtension = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const magic4 = buffer.slice(0, 4).toString('hex');
  const magic2 = buffer.slice(0, 2).toString('hex');
  const magic8 = buffer.slice(8, 12).toString('hex');
  if (magic2 === 'ffd8') return 'jpg';
  if (magic4 === '89504e47') return 'png';
  if (magic4 === '47494638') return 'gif';
  if (magic4 === '52494646' && magic8 === '57454250') return 'webp';
  if (magic2 === '424d') return 'bmp';
  return null;
};

const resolveLocalImagePath = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('file://')) {
    try {
      const filePath = decodeURIComponent(new URL(trimmed).pathname);
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) return filePath;
      }
    } catch {}
    return null;
  }

  const expanded = trimmed.startsWith('~')
    ? path.join(os.homedir(), trimmed.slice(1))
    : trimmed;
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
  if (!fs.existsSync(candidate)) return null;

  try {
    const stat = fs.statSync(candidate);
    return stat.isFile() ? candidate : null;
  } catch {
    return null;
  }
};

const normalizeImageInput = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }
  const localPath = resolveLocalImagePath(text);
  if (localPath) {
    return localPath;
  }

  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch (error) {
    return null;
  }
};

const normalizeImageInputs = (inputs) => {
  if (typeof inputs === 'string') {
    return inputs.split(',').map((item) => normalizeImageInput(item)).filter(Boolean);
  }

  if (!Array.isArray(inputs)) {
    return [];
  }

  return inputs.map(normalizeImageInput).filter(Boolean);
};

const extractImagePlaceholders = (content = '') => {
  const matches = Array.from(String(content).matchAll(IMAGE_PLACEHOLDER_REGEX));
  return matches.map((match) => ({
    raw: match[0],
    keyword: String(match[1] || '').trim(),
  }));
};

const fetchImageBuffer = async (url, retryCount = 0) => {
  if (!url) {
    throw new Error('이미지 URL이 없습니다.');
  }

  const localPath = resolveLocalImagePath(url);
  if (localPath && !/https?:/.test(url)) {
    const buffer = await fs.promises.readFile(localPath);
    if (!buffer || buffer.length === 0) {
      throw new Error(`이미지 파일이 비어 있습니다: ${localPath}`);
    }

    const extensionFromSignature = getImageSignatureExtension(buffer);
    const extensionFromUrl = guessExtensionFromUrl(localPath);
    return {
      buffer,
      ext: extensionFromSignature || extensionFromUrl || 'jpg',
      finalUrl: localPath,
      isLocal: true,
    };
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Cache-Control': 'no-cache',
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      throw new Error(`이미지 다운로드 실패: ${response.status} ${response.statusText} (${url})`);
    }

    const contentType = response.headers.get('content-type') || '';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const finalUrl = response.url || url;
    const extensionFromUrl = guessExtensionFromUrl(finalUrl);
    const extensionFromSignature = getImageSignatureExtension(buffer);
    const isImage = isImageContentType(contentType)
      || extensionFromUrl
      || extensionFromSignature;

    if (!isImage) {
      throw new Error(`이미지 콘텐츠가 아닙니다: ${contentType || '(미확인)'}, url=${finalUrl}`);
    }

    return {
      buffer,
      ext: extensionFromSignature || guessExtensionFromContentType(contentType) || extensionFromUrl || 'jpg',
      finalUrl,
    };
  } catch (error) {
    if (retryCount < 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return fetchImageBuffer(url, retryCount + 1);
    }
    throw new Error(`이미지 다운로드 실패: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
};

const uploadImageFromRemote = async (remoteUrl, fallbackName = 'image') => {
  const downloaded = await fetchImageBuffer(remoteUrl);
  const tmpDir = normalizeTempDir();
  const filename = buildImageFileName(fallbackName, downloaded.ext);
  const filePath = path.join(tmpDir, filename);

  await fs.promises.writeFile(filePath, downloaded.buffer);
  let uploaded;
  try {
    uploaded = await tistory.uploadImage(downloaded.buffer, filename);
  } finally {
    await fs.promises.unlink(filePath).catch(() => {});
  }
  const uploadedKage = uploaded?.key ? `kage@${uploaded.key}` : null;

  if (!uploaded || !(uploaded.url || uploaded.key)) {
    throw new Error('이미지 업로드 응답이 비정상적입니다.');
  }

  return {
    sourceUrl: downloaded.finalUrl,
    uploadedUrl: uploaded.url,
    uploadedKey: uploaded.key || uploaded.url,
    uploadedKage,
    raw: uploaded,
  };
};

const replaceImagePlaceholdersWithUploaded = async (
  content,
  autoUploadImages,
  relatedImageKeywords = [],
  imageUrls = [],
  imageCountLimit = 3
) => {
  const originalContent = content || '';
  if (!autoUploadImages) {
    return {
      content: originalContent,
      uploaded: [],
      uploadedCount: 0,
      status: 'skipped',
    };
  }

  let updatedContent = originalContent;
  const uploadedImages = [];
  const uploadErrors = [];
  const matches = extractImagePlaceholders(updatedContent);
  const collectedImageUrls = normalizeImageInputs(imageUrls);
  const hasPlaceholders = matches.length > 0;

  const normalizedKeywords = Array.isArray(relatedImageKeywords)
    ? relatedImageKeywords.map((item) => String(item || '').trim()).filter(Boolean)
    : typeof relatedImageKeywords === 'string'
      ? relatedImageKeywords.split(',').map((item) => item.trim()).filter(Boolean)
      : [];

  if (hasPlaceholders && collectedImageUrls.length < matches.length) {
    return {
      content: originalContent,
      uploaded: [],
      uploadedCount: 0,
      status: 'need_image_urls',
      message: 'IMAGE 플레이스홀더 수와 imageUrls 수가 다릅니다. placeholder당 이미지 URL을 제공해 주세요.',
      requiredImageUrls: matches.map((match) => ({
        keyword: match.keyword || null,
      })),
      requestedKeywords: matches.map((match) => match.keyword).filter(Boolean),
      requestedCount: matches.length,
      providedImageUrls: collectedImageUrls.length,
    };
  }

  if (!hasPlaceholders && collectedImageUrls.length === 0 && normalizedKeywords.length > 0) {
    return {
      content: originalContent,
      uploaded: [],
      uploadedCount: 0,
      status: 'need_image_urls',
      message: '이미지 키워드가 있어도 imageUrls가 없습니다. 외부에서 키워드 수집 후 imageUrls를 전달해 주세요.',
      requestedKeywords: normalizedKeywords,
      requestedCount: normalizedKeywords.length,
      providedImageUrls: 0,
    };
  }

  const uploadTargets = hasPlaceholders
    ? matches.map((match, index) => ({
      placeholder: match,
      url: collectedImageUrls[index] || null,
      keyword: match.keyword || `image-${index + 1}`,
    }))
    : collectedImageUrls.slice(0, imageCountLimit).map((imageUrl, index) => ({
      placeholder: null,
      url: imageUrl,
      keyword: normalizedKeywords[index] || `image-${index + 1}`,
    }));

  for (let i = 0; i < uploadTargets.length; i += 1) {
    const target = uploadTargets[i];
    const sourceUrl = target.url;
    if (!sourceUrl) {
      continue;
    }

    try {
      const uploadedImage = await uploadImageFromRemote(sourceUrl, target.keyword);
      const tag = buildTistoryImageTag(uploadedImage, target.keyword);
      if (target.placeholder && target.placeholder.raw) {
        const replaced = new RegExp(escapeRegExp(target.placeholder.raw), 'g');
        updatedContent = updatedContent.replace(replaced, tag);
      } else {
        updatedContent = `${tag}\n${updatedContent}`;
      }
      uploadedImages.push(uploadedImage);
    } catch (error) {
      console.log('이미지 처리 실패:', sourceUrl, error.message);
      uploadErrors.push({
        index: i,
        sourceUrl,
        keyword: target.keyword,
        message: error.message,
      });
    }
  }

  if (hasPlaceholders && collectedImageUrls.length > 0 && uploadedImages.length === 0) {
    return {
      content: originalContent,
      uploaded: [],
      uploadedCount: 0,
      status: 'image_upload_failed',
      message: '이미지 업로드에 실패했습니다. 수집한 이미지 URL을 확인해 다시 호출해 주세요.',
      errors: uploadErrors,
      requestedKeywords: matches.map((match) => match.keyword).filter(Boolean),
      requestedCount: matches.length,
      providedImageUrls: collectedImageUrls.length,
    };
  }

  if (uploadErrors.length > 0) {
    return {
      content: updatedContent,
      uploaded: uploadedImages,
      uploadedCount: uploadedImages.length,
      status: 'image_upload_partial',
      message: '일부 이미지 업로드가 실패했습니다.',
      errors: uploadErrors,
      requestedCount: matches.length,
      uploadedPlaceholders: uploadedImages.length,
      providedImageUrls: collectedImageUrls.length,
    };
  }

  return {
    content: updatedContent,
    uploaded: uploadedImages,
    uploadedCount: uploadedImages.length,
    status: 'ok',
  };
};

const enrichContentWithUploadedImages = async ({
  rawContent,
  autoUploadImages,
  relatedImageKeywords = [],
  imageUrls = [],
  imageUploadLimit = 3,
}) => {
  const safeImageUploadLimit = Number.isFinite(Number(imageUploadLimit)) && Number(imageUploadLimit) > 0
    ? Number(imageUploadLimit)
    : 3;

  const shouldAutoUpload = autoUploadImages !== false;
  const enrichedImages = await replaceImagePlaceholdersWithUploaded(
    rawContent,
    shouldAutoUpload,
    relatedImageKeywords,
    imageUrls,
    safeImageUploadLimit
  );

  if (enrichedImages.status === 'need_image_urls') {
    return {
      status: 'need_image_urls',
      message: enrichedImages.message,
      requestedKeywords: enrichedImages.requestedKeywords,
      requestedCount: enrichedImages.requestedCount,
      providedImageUrls: enrichedImages.providedImageUrls,
      content: enrichedImages.content,
      images: enrichedImages.uploaded || [],
      imageCount: enrichedImages.uploadedCount,
      uploadedCount: enrichedImages.uploadedCount,
      uploadErrors: enrichedImages.errors || [],
    };
  }

  if (enrichedImages.status === 'image_upload_failed' || enrichedImages.status === 'image_upload_partial') {
    return {
      status: enrichedImages.status,
      message: enrichedImages.message,
      imageCount: enrichedImages.uploadedCount,
      requestedCount: enrichedImages.requestedCount,
      uploadedCount: enrichedImages.uploadedCount,
      images: enrichedImages.uploaded || [],
      content: enrichedImages.content,
      uploadErrors: enrichedImages.errors || [],
      providedImageUrls: enrichedImages.providedImageUrls,
    };
  }

  return {
    status: 'ok',
    content: enrichedImages.content,
    images: enrichedImages.uploaded || [],
    imageCount: enrichedImages.uploadedCount,
    uploadedCount: enrichedImages.uploadedCount,
  };
};

const isLoggedInByCookies = async (context) => {
  const cookies = await context.cookies('https://www.tistory.com');
  return cookies.some((cookie) => {
    const name = cookie.name.toLowerCase();
    return name.includes('tistory') || name.includes('access') || name.includes('login');
  });
};

const waitForLoginFinish = async (page, context, timeoutMs = 45000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoggedInByCookies(context)) {
      return true;
    }

    if (await clickKakaoAccountContinue(page)) {
      continue;
    }

    const url = page.url();
    if (!url.includes('/auth/login') && !url.includes('accounts.kakao.com/login') && !url.includes('kauth.kakao.com')) {
      return true;
    }

    await sleep(1000);
  }
  return false;
};

const withProviderSession = async (sessionPath, fn) => {
  const prev = process.env.VIRUAGENT_SESSION_PATH;
  process.env.VIRUAGENT_SESSION_PATH = path.resolve(sessionPath);
  tistory.resetState();
  try {
    return await fn();
  } finally {
    tistory.resetState();
    if (prev) {
      process.env.VIRUAGENT_SESSION_PATH = prev;
    } else {
      delete process.env.VIRUAGENT_SESSION_PATH;
    }
  }
};

const createTistoryProvider = ({ sessionPath }) => {
  const askForAuthentication = async ({ headless = false, username, password, twoFactorCode } = {}) => {
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });

    const browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto('https://www.tistory.com/auth/login', {
        waitUntil: 'domcontentloaded',
      });

      const envCreds = readCredentialsFromEnv();
      const loginId = username || envCreds.username;
      const loginPw = password || envCreds.password;

      if (loginId && loginPw) {
        let usernameFilled = await fillBySelector(page, LOGIN_SELECTORS.username, loginId);
        let passwordFilled = await fillBySelector(page, LOGIN_SELECTORS.password, loginPw);

        if (!usernameFilled || !passwordFilled) {
          const kakaoClicked = await clickSubmit(page, KAKAO_TRIGGER_SELECTORS);
          if (!kakaoClicked) {
            const kakaoLink = await pickValue(page, KAKAO_TRIGGER_SELECTORS);
            if (!kakaoLink) {
              throw new Error('로그인 폼 입력 필드를 찾지 못했습니다. 수동 로그인 모드로 시도해 주세요.');
            }
          }

          await page.locator('a.link_kakao_id, a:has-text("카카오계정으로 로그인")').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
          await page.click('a.link_kakao_id, a:has-text("카카오계정으로 로그인")', { timeout: 5000 }).catch(async () => {
            const kakaoAlternative = await pickValue(page, KAKAO_TRIGGER_SELECTORS);
            if (kakaoAlternative) {
              await page.locator(kakaoAlternative).click({ timeout: 5000 });
            }
          });
          await page.waitForLoadState('domcontentloaded');
          await page.waitForTimeout(800);

          usernameFilled = await fillBySelector(page, KAKAO_LOGIN_SELECTORS.username, loginId);
          passwordFilled = await fillBySelector(page, KAKAO_LOGIN_SELECTORS.password, loginPw);
          if (!usernameFilled || !passwordFilled) {
            throw new Error('카카오 로그인 폼 입력 필드를 찾지 못했습니다. 수동 로그인 모드로 시도해 주세요.');
          }

          await checkBySelector(page, KAKAO_LOGIN_SELECTORS.rememberLogin);
          const kakaoSubmitted = await clickSubmit(page, KAKAO_LOGIN_SELECTORS.submit);
          if (!kakaoSubmitted) {
            await page.keyboard.press('Enter');
          }
        } else {
          const legacySubmitted = await clickSubmit(page, LOGIN_SELECTORS.submit);
          if (!legacySubmitted) {
            await page.keyboard.press('Enter');
          }
        }

        const loggedIn = await waitForLoginFinish(page, context);
        let finalLoginStatus = loggedIn;
        let pendingTwoFactorAction = false;
        if (!loggedIn && await hasElement(page, LOGIN_SELECTORS.otp)) {
          if (!twoFactorCode) {
            throw new Error('2차 인증이 감지되었습니다. OTP 코드를 twoFactorCode로 전달해 주세요.');
          }
          const otpFilled = await fillBySelector(page, LOGIN_SELECTORS.otp, twoFactorCode);
          if (!otpFilled) {
            throw new Error('2차 인증 입력 필드를 찾지 못했습니다. 수동으로 진행해 주세요.');
          }
          await page.keyboard.press('Enter');
          finalLoginStatus = await waitForLoginFinish(page, context, 45000);
          if (!finalLoginStatus) {
            throw new Error('2차 인증 입력 후 로그인 완료되지 않았습니다.');
          }
        } else if (!loggedIn && (await hasElement(page, KAKAO_2FA_SELECTORS.start) || page.url().includes('tmsTwoStepVerification') || page.url().includes('emailTwoStepVerification'))) {
          const isEmailModeAvailable = await hasElement(page, KAKAO_2FA_SELECTORS.emailModeButton);
          await checkBySelector(page, KAKAO_2FA_SELECTORS.rememberDevice);
          if (await hasElement(page, KAKAO_2FA_SELECTORS.codeInput)) {
            if (!twoFactorCode) {
              throw new Error('2차 인증이 감지되었습니다. 이메일 인증 코드를 twoFactorCode로 전달해 주세요.');
            }

            const codeFilled = await fillBySelector(page, KAKAO_2FA_SELECTORS.codeInput, twoFactorCode);
            if (!codeFilled) {
              throw new Error('2차 인증 입력 필드를 찾지 못했습니다. 수동으로 진행해 주세요.');
            }

            const confirmed = await clickSubmit(page, KAKAO_2FA_SELECTORS.confirm);
            if (!confirmed) {
              await page.keyboard.press('Enter');
            }
            finalLoginStatus = await waitForLoginFinish(page, context, 45000);
            if (!finalLoginStatus) {
              throw new Error('2차 인증 입력 후 로그인 완료되지 않았습니다.');
            }
          } else if (!twoFactorCode && isEmailModeAvailable && process.stdin.isTTY) {
            console.log('');
            console.log('==============================');
            console.log('카카오 2차 인증이 감지되었습니다.');
            console.log('카카오톡 앱에서 알림을 눌러 로그인을 승인해 주세요.');
            console.log('승인 완료 후 Enter를 눌러주세요.');
            console.log('==============================');
            await waitForUser();
            finalLoginStatus = await waitForLoginFinish(page, context, 45000);
            if (!finalLoginStatus) {
              pendingTwoFactorAction = true;
            }
          } else if (!twoFactorCode) {
            console.log('');
            console.log('==============================');
            console.log('카카오 2차 인증이 감지되었습니다.');
            console.log('카카오톡 앱에서 푸시 승인 후 로그인 완료 대기 중입니다.');
            console.log('최대 120초 동안 상태를 확인합니다.');
            console.log('==============================');
            finalLoginStatus = await waitForLoginFinish(page, context, 120000);
            if (!finalLoginStatus) {
              pendingTwoFactorAction = true;
            }
          } else if (isEmailModeAvailable) {
            await clickSubmit(page, KAKAO_2FA_SELECTORS.emailModeButton);
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(800);

            const codeFilled = await fillBySelector(page, KAKAO_2FA_SELECTORS.codeInput, twoFactorCode);
            if (!codeFilled) {
              throw new Error('2차 인증 입력 필드를 찾지 못했습니다. 수동으로 진행해 주세요.');
            }

            const confirmed = await clickSubmit(page, KAKAO_2FA_SELECTORS.confirm);
            if (!confirmed) {
              await page.keyboard.press('Enter');
            }
            finalLoginStatus = await waitForLoginFinish(page, context, 45000);
            if (!finalLoginStatus) {
              throw new Error('2차 인증 입력 후 로그인 완료되지 않았습니다.');
            }
          }
        }

        if (!finalLoginStatus) {
          if (pendingTwoFactorAction) {
            return {
              provider: 'tistory',
              status: 'pending_2fa',
              loggedIn: false,
              message: '카카오 2차 인증이 필요합니다. 앱에서 인증 후 다시 실행하면 됩니다.',
            };
          }
          throw new Error('자동 로그인에 실패했습니다. 아이디/비밀번호가 정확한지 확인하거나 manual=true로 수동 로그인하세요.');
        }
      } else if (!headless && process.stdin.isTTY) {
        console.log('');
        console.log('==============================');
        console.log('티스토리 브라우저 로그인 페이지가 열립니다.');
        console.log('로그인 + 2차인증까지 마친 뒤 Enter를 눌러주세요.');
        console.log('==============================');
        await waitForUser();
      } else {
        // 최소 로그인 완료 신호 대기
        const ok = await waitForLoginFinish(page, context, 120000);
        if (!ok) {
          throw new Error('로그인 감지를 실패했습니다. headless 모드에서는 수동 입력을 지원하지 않습니다.');
        }
      }

      await context.storageState({ path: sessionPath });

      return withProviderSession(sessionPath, async () => {
        const blogName = await tistory.initBlog();
        return {
          provider: 'tistory',
          loggedIn: true,
          blogName,
          blogUrl: `https://${blogName}.tistory.com`,
          sessionPath,
        };
      });
    } finally {
      await browser.close().catch(() => {});
    }
  };

  return {
    id: 'tistory',
    name: 'Tistory',

    async authStatus() {
      return withProviderSession(sessionPath, async () => {
        try {
          const blogName = await tistory.initBlog();
          return {
            provider: 'tistory',
            loggedIn: true,
            blogName,
            blogUrl: `https://${blogName}.tistory.com`,
            sessionPath,
            metadata: getProviderMeta('tistory') || {},
          };
        } catch (error) {
          return {
            provider: 'tistory',
            loggedIn: false,
            sessionPath,
            error: error.message,
            metadata: getProviderMeta('tistory') || {},
          };
        }
      });
    },

    async login({
      headless = false,
      username,
      password,
      twoFactorCode,
      manual = false,
    } = {}) {
      const shouldUseManual = Boolean(manual);
      const creds = readCredentialsFromEnv();
      const resolved = {
        headless,
        username: username || creds.username,
        password: password || creds.password,
        twoFactorCode,
      };

      if (shouldUseManual) {
        resolved.username = null;
        resolved.password = null;
      }

      const result = await askForAuthentication(resolved);
      saveProviderMeta('tistory', {
        loggedIn: result.loggedIn,
        blogName: result.blogName,
        blogUrl: result.blogUrl,
        sessionPath: result.sessionPath,
      });
      return result;
    },

    async publish(payload) {
      return withProviderSession(sessionPath, async () => {
        const title = payload.title || '제목 없음';
        const rawContent = payload.content || '';
        const visibility = mapVisibility(payload.visibility);
        const tag = payload.tags || '';
        const rawThumbnail = payload.thumbnail || null;
        const relatedImageKeywords = payload.relatedImageKeywords || [];
        const imageUrls = payload.imageUrls || [];
        const autoUploadImages = payload.autoUploadImages !== false;
        const imageUploadLimit = Number(payload.imageUploadLimit);
        const safeImageUploadLimit = Number.isFinite(imageUploadLimit) && imageUploadLimit > 0 ? imageUploadLimit : 3;

        const enrichedImages = await enrichContentWithUploadedImages({
          rawContent,
          autoUploadImages,
          relatedImageKeywords,
          imageUrls,
          imageUploadLimit: safeImageUploadLimit,
        });
        if (enrichedImages.status === 'need_image_urls') {
          return {
            mode: 'publish',
            status: 'need_image_urls',
            loggedIn: true,
            provider: 'tistory',
            title,
            visibility,
            tags: tag,
            message: enrichedImages.message,
            requestedKeywords: enrichedImages.requestedKeywords,
            requestedCount: enrichedImages.requestedCount,
            providedImageUrls: enrichedImages.providedImageUrls,
          };
        }

        if (enrichedImages.status === 'image_upload_failed' || enrichedImages.status === 'image_upload_partial') {
          return {
            mode: 'publish',
            status: enrichedImages.status,
            loggedIn: true,
            provider: 'tistory',
            title,
            visibility,
            tags: tag,
            message: enrichedImages.message,
            imageCount: enrichedImages.uploadedCount,
            requestedCount: enrichedImages.requestedCount,
            uploadedCount: enrichedImages.uploadedCount,
            uploadErrors: enrichedImages.uploadErrors || [],
            providedImageUrls: enrichedImages.providedImageUrls,
          };
        }
        const content = enrichedImages.content;
        const resolvedThumbnail = normalizeThumbnailForPublish(rawThumbnail);
        const fallbackThumbnail = enrichedImages?.uploaded?.[0]?.uploadedKage || null;

        await tistory.initBlog();
        const rawCategories = await tistory.getCategories();
        const categories = buildCategoryList(rawCategories);

        if (!isProvidedCategory(payload.category)) {
          if (categories.length === 0) {
            return {
              provider: 'tistory',
              mode: 'publish',
              status: 'need_category',
              loggedIn: true,
              title,
              visibility,
              tags: tag,
              message: '발행을 위해 카테고리가 필요합니다. categories를 확인하고 category를 지정해 주세요.',
              categories,
            };
          }

          if (categories.length === 1) {
            payload = { ...payload, category: categories[0].id };
          } else {
            return {
              provider: 'tistory',
              mode: 'publish',
              status: 'need_category',
              loggedIn: true,
              title,
              visibility,
              tags: tag,
              message: 'category가 없어서 중단했습니다. 카테고리 ID를 지정해 publish를 재요청해 주세요.',
              categories,
            };
          }
        }

        const category = Number(payload.category);
        if (!Number.isInteger(category) || Number.isNaN(category)) {
          return {
            provider: 'tistory',
            mode: 'publish',
            status: 'invalid_category',
            loggedIn: true,
            title,
            visibility,
            tags: tag,
            message: '유효한 category를 숫자로 지정해 주세요.',
            categories,
          };
        }

        const validCategoryIds = categories.map((item) => item.id);
        if (!validCategoryIds.includes(category) && categories.length > 0) {
          return {
            provider: 'tistory',
            mode: 'publish',
            status: 'invalid_category',
            loggedIn: true,
            title,
            visibility,
            tags: tag,
            message: '존재하지 않는 category입니다. categories를 확인해 주세요.',
            categories,
          };
        }

        try {
          const result = await tistory.publishPost({
            title,
            content,
            visibility,
            category,
            tag,
            thumbnail: resolvedThumbnail || fallbackThumbnail || null,
          });

          return {
            provider: 'tistory',
            mode: 'publish',
            title,
            category,
            visibility,
            tags: tag,
            images: enrichedImages.images,
            imageCount: enrichedImages.uploadedCount,
            url: result.entryUrl || null,
            raw: result,
          };
        } catch (error) {
          if (!isPublishLimitError(error)) {
            throw error;
          }

          const draftResult = await tistory.saveDraft({ title, content });
          return {
            provider: 'tistory',
            mode: 'draft',
            status: 'publish_fallback_to_draft',
            title,
            category,
            visibility,
            tags: tag,
            images: enrichedImages.images,
            imageCount: enrichedImages.uploadedCount,
            draftContent: content,
            draftSequence: draftResult.draft?.sequence || null,
            message: '발행 제한(403)으로 인해 임시저장으로 전환했습니다.',
            fallbackThumbnail: resolvedThumbnail || (enrichedImages.images?.[0]?.uploadedKage) || null,
            raw: draftResult,
          };
        }
      });
    },

    async saveDraft(payload) {
      return withProviderSession(sessionPath, async () => {
        const title = payload.title || '임시저장';
        const rawContent = payload.content || '';
        const rawThumbnail = payload.thumbnail || null;
        const relatedImageKeywords = payload.relatedImageKeywords || [];
        const imageUrls = payload.imageUrls || [];
        const autoUploadImages = payload.autoUploadImages !== false;
        const imageUploadLimit = Number(payload.imageUploadLimit);
        const enrichedImages = await enrichContentWithUploadedImages({
          rawContent,
          autoUploadImages,
          relatedImageKeywords,
          imageUrls,
          imageUploadLimit,
        });

        if (enrichedImages.status === 'need_image_urls') {
          return {
            mode: 'draft',
            status: 'need_image_urls',
            loggedIn: true,
            provider: 'tistory',
            title,
            message: enrichedImages.message,
            requestedKeywords: enrichedImages.requestedKeywords,
            requestedCount: enrichedImages.requestedCount,
            providedImageUrls: enrichedImages.providedImageUrls,
            imageCount: enrichedImages.imageCount,
            images: enrichedImages.images,
            uploadedCount: enrichedImages.uploadedCount,
          };
        }

        if (enrichedImages.status === 'image_upload_failed' || enrichedImages.status === 'image_upload_partial') {
          return {
            mode: 'draft',
            status: enrichedImages.status,
            loggedIn: true,
            provider: 'tistory',
            title,
            message: enrichedImages.message,
            imageCount: enrichedImages.imageCount,
            requestedCount: enrichedImages.requestedCount,
            uploadedCount: enrichedImages.uploadedCount,
            uploadErrors: enrichedImages.uploadErrors,
            providedImageUrls: enrichedImages.providedImageUrls,
            images: enrichedImages.images,
          };
        }

        const content = enrichedImages.content;
        const fallbackThumbnail = enrichedImages?.images?.[0]?.uploadedKage || null;
        const thumbnail = normalizeThumbnailForPublish(rawThumbnail) || fallbackThumbnail || null;

        await tistory.initBlog();
        const result = await tistory.saveDraft({ title, content });
        return {
          provider: 'tistory',
          mode: 'draft',
          title,
          status: 'ok',
          category: Number(payload.category) || 0,
          tags: payload.tags || '',
          sequence: result.draft?.sequence || null,
          thumbnail,
          imageCount: enrichedImages.imageCount,
          images: enrichedImages.images,
          uploadErrors: enrichedImages.uploadErrors || null,
          draftContent: content,
          raw: result,
        };
      });
    },

    async listCategories() {
      return withProviderSession(sessionPath, async () => {
        await tistory.initBlog();
        const categories = await tistory.getCategories();
        return {
          provider: 'tistory',
          categories: Object.entries(categories).map(([name, id]) => ({
            name,
            id: Number(id),
          })),
        };
      });
    },

    async listPosts({ limit = 20 } = {}) {
      return withProviderSession(sessionPath, async () => {
        const result = await tistory.getPosts();
        const items = Array.isArray(result?.items) ? result.items : [];
        return {
          provider: 'tistory',
          totalCount: result.totalCount || items.length,
          posts: items.slice(0, Math.max(1, Number(limit) || 20)),
        };
      });
    },

    async logout() {
      clearProviderMeta('tistory');
      return {
        provider: 'tistory',
        loggedOut: true,
        sessionPath,
      };
    },
  };
};

module.exports = createTistoryProvider;
