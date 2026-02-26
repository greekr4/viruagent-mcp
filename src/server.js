const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const { buildError, buildOk } = require('./utils/response');
const { createProviderManager } = require('./services/providerManager');

const createServer = () => {
  const providerManager = createProviderManager();

  const server = new Server(
    {
      name: 'viruagent-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'viruagent_auth_status',
        description: 'Provider 로그인 상태를 확인합니다.',
        inputSchema: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['tistory', 'naver'],
              description: '목표 게시 플랫폼 (기본값: tistory)',
            },
          },
        },
      },
      {
        name: 'viruagent_login',
        description: 'Playwright로 로그인창을 띄워 세션을 저장합니다.',
        inputSchema: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['tistory', 'naver'],
              description: '목표 게시 플랫폼 (기본값: tistory)',
            },
            headless: {
              type: 'boolean',
              default: false,
              description: '브라우저를 숨김 모드로 실행할지 여부',
            },
            manual: {
              type: 'boolean',
              default: false,
              description: '자동 로그인 건너뛰고 수동 로그인 모드 사용',
            },
            username: {
              type: 'string',
              description: '자동 로그인용 아이디(또는 이메일). 미입력 시 환경변수 사용',
            },
            password: {
              type: 'string',
              description: '자동 로그인용 비밀번호. 미입력 시 환경변수 사용',
            },
            twoFactorCode: {
              type: 'string',
              description: '2차 인증 코드(있다면)',
            },
          },
          required: [],
        },
      },
      {
        name: 'viruagent_publish',
        description: '제목/본문으로 발행을 시도하고, 403(일일 발행 제한) 발생 시 임시저장으로 폴백합니다.',
        inputSchema: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['tistory', 'naver'],
              default: 'tistory',
            },
            title: { type: 'string', description: '발행할 글 제목' },
            content: { type: 'string', description: 'HTML 포맷 본문' },
            visibility: {
              type: 'string',
              enum: ['public', 'private', 'protected'],
              default: 'public',
            },
            category: { type: 'number', description: '카테고리 ID(숫자)' },
            tags: { type: 'string', description: '쉼표 구분 태그 문자열' },
            thumbnail: { type: 'string', description: '썸네일 업로드 키 문자열(선택)' },
            relatedImageKeywords: {
              type: 'array',
              description: '본문에 삽입할 관련 이미지 키워드(예: [\"갤럭시\", \"AI\"])',
              items: { type: 'string' },
            },
            imageUrls: {
              type: 'array',
              description: '클라이언트(Claude/Codex)가 수집한 이미지 경로 목록. URL(http/https) 또는 로컬 파일 경로를 허용합니다. URL은 로컬 임시 파일로 저장 후 업로드됩니다.',
              items: {
                type: 'string',
              },
            },
            imageUploadLimit: {
              type: 'number',
              default: 3,
              description: '자동 업로드할 이미지 최대 개수',
            },
            autoUploadImages: {
              type: 'boolean',
              default: true,
              description: '웹 이미지 자동 다운로드/업로드 사용 여부',
            },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'viruagent_save_draft',
        description: '제목/본문으로 임시저장합니다. 이미지 플레이스홀더 치환은 publish와 동일하게 수행합니다.',
        inputSchema: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['tistory', 'naver'],
              default: 'tistory',
            },
            title: { type: 'string', description: '임시저장 제목' },
            content: { type: 'string', description: '임시저장 본문' },
            relatedImageKeywords: {
              type: 'array',
              description: '본문 이미지 플레이스홀더 키워드(예: [\"갤럭시\", \"AI\"])',
              items: { type: 'string' },
            },
            imageUrls: {
              type: 'array',
              description: '임시저장 시 삽입할 이미지 URL 목록. URL(http/https) 또는 로컬 파일 경로',
              items: {
                type: 'string',
              },
            },
            imageUploadLimit: {
              type: 'number',
              default: 3,
              description: '자동 업로드할 이미지 최대 개수',
            },
            autoUploadImages: {
              type: 'boolean',
              default: true,
              description: '자동 이미지 업로드 사용 여부',
            },
            tags: { type: 'string', description: '태그 문자열' },
            category: {
              type: 'number',
              description: '카테고리 ID(미지정 시 0)',
            },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'viruagent_list_categories',
        description: 'Provider 카테고리 목록 조회',
        inputSchema: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['tistory', 'naver'],
              default: 'tistory',
            },
          },
        },
      },
      {
        name: 'viruagent_list_posts',
        description: '최근 글 목록 조회',
        inputSchema: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['tistory', 'naver'],
              default: 'tistory',
            },
            limit: {
              type: 'number',
              default: 20,
            },
          },
        },
      },
      {
        name: 'viruagent_logout',
        description: 'provider 메타데이터를 초기화합니다(브라우저 세션 파일은 유지).',
        inputSchema: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['tistory', 'naver'],
              default: 'tistory',
            },
          },
        },
      },
      {
        name: 'viruagent_list_providers',
        description: '등록된 provider 목록을 조회합니다.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const { name, arguments: args = {} } = params;
    const providerName = args.provider || 'tistory';

    try {
      const provider = providerManager.getProvider(providerName);

      const handle = {
        viruagent_auth_status: () => provider.authStatus(),
        viruagent_login: () => provider.login({
          headless: Boolean(args.headless),
          manual: Boolean(args.manual),
          username: args.username,
          password: args.password,
          twoFactorCode: args.twoFactorCode,
        }),
        viruagent_publish: () => provider.publish({
          title: args.title,
          content: args.content,
          visibility: args.visibility || 'public',
          category: Number(args.category) || 0,
          tags: args.tags || '',
          thumbnail: args.thumbnail || null,
          relatedImageKeywords: args.relatedImageKeywords || [],
          imageUrls: args.imageUrls || [],
          imageUploadLimit: Number(args.imageUploadLimit),
          autoUploadImages: args.autoUploadImages,
        }),
        viruagent_save_draft: () => provider.saveDraft({
          title: args.title,
          content: args.content,
          tags: args.tags || '',
          category: Number(args.category) || 0,
          relatedImageKeywords: args.relatedImageKeywords || [],
          imageUrls: args.imageUrls || [],
          imageUploadLimit: Number(args.imageUploadLimit),
          autoUploadImages: args.autoUploadImages,
        }),
        viruagent_list_categories: () => provider.listCategories(),
        viruagent_list_posts: () => provider.listPosts({ limit: Number(args.limit) || 20 }),
        viruagent_logout: () => provider.logout(),
        viruagent_list_providers: () => ({
          providers: providerManager.getAvailableProviders(),
          selected: providerName,
        }),
      };

      const fn = handle[name];
      if (!fn) {
        return buildError(new Error(`알 수 없는 tool: ${name}`));
      }

      const result = await fn();
      return buildOk({
        success: true,
        provider: providerName,
        ...result,
      });
    } catch (error) {
      return buildError(error, {
        provider: providerName,
      });
    }
  });

  return server;
};

const runMcpServer = async () => {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stdin.resume();

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
};

module.exports = { runMcpServer };
