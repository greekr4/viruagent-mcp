const buildTextResponse = (payload) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(payload),
    },
  ],
});

const buildOk = (payload) => ({
  ...buildTextResponse(payload),
  isError: false,
});

const buildError = (error, payload = {}) => ({
  ...buildTextResponse({
    success: false,
    error: typeof error === 'string' ? error : error?.message || 'unknown error',
    ...payload,
  }),
  isError: true,
});

module.exports = {
  buildOk,
  buildError,
};
