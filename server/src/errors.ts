export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export class PairNotFoundError extends HttpError {
  constructor(code: string) {
    super(404, `Pair session "${code}" not found`, 'PAIR_NOT_FOUND');
  }
}

export class PairExpiredError extends HttpError {
  constructor(code: string) {
    super(410, `Pair session "${code}" expired`, 'PAIR_EXPIRED');
  }
}

export class SourceNotFoundError extends HttpError {
  constructor(key: string) {
    super(404, `Source "${key}" not found`, 'SOURCE_NOT_FOUND');
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message, 'BAD_REQUEST');
  }
}

export class UpstreamError extends HttpError {
  constructor(
    public readonly upstreamStatus: number,
    public readonly upstreamUrl: string,
    message: string,
  ) {
    super(502, message, 'UPSTREAM_ERROR');
  }
}

export class PlexHttpError extends UpstreamError {
  constructor(status: number, path: string, body: string) {
    super(status, path, `Plex ${status} ${path}: ${body.slice(0, 200)}`);
    this.name = 'PlexHttpError';
  }
}

export class YtDlpError extends UpstreamError {
  constructor(message: string, public readonly stderr = '') {
    super(502, 'yt-dlp', `yt-dlp: ${message}`);
    this.name = 'YtDlpError';
  }
}
