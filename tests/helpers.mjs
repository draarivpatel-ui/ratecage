export function makeClock(start = 0) {
  let value = start;
  return {
    now() {
      return value;
    },
    set(next) {
      value = next;
    },
    advance(ms) {
      value += ms;
      return value;
    }
  };
}

export function createMockResponse() {
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    headers: new Map(),
    body: '',
    setHeader(name, value) {
      this.headers.set(name.toLowerCase(), String(value));
    },
    end(body = '') {
      this.body += body;
      this.writableEnded = true;
      this.headersSent = true;
    }
  };
}

export function headerValues(headers) {
  const output = Object.create(null);
  for (const [name, value] of headers.entries()) output[name] = value;
  return output;
}
