export type AIServiceErrorCode =
  | "timeout"
  | "http_error"
  | "invalid_response"
  | "network_error";

export class AIServiceError extends Error {
  constructor(
    message: string,
    public readonly code: AIServiceErrorCode,
    public readonly service: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "AIServiceError";
  }
}

type RequestOptions<T> = {
  service: string;
  url: string;
  init?: RequestInit;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  validate?: (payload: unknown) => payload is T;
};

function logServiceRequest(event: {
  service: string;
  durationMs: number;
  success: boolean;
  status: number | null;
  errorType: AIServiceErrorCode | null;
}) {
  console.info("[ai-service]", JSON.stringify(event));
}

export async function requestAIServiceJSON<T>({
  service,
  url,
  init,
  timeoutMs,
  fetchImplementation = fetch,
  validate,
}: RequestOptions<T>): Promise<T> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let status: number | null = null;
  let errorType: AIServiceErrorCode | null = null;

  try {
    const response = await fetchImplementation(url, {
      ...init,
      signal: controller.signal,
    });
    status = response.status;
    if (!response.ok) {
      throw new AIServiceError(
        `${service} returned HTTP ${response.status}`,
        "http_error",
        service,
        response.status,
      );
    }

    const payload = (await response.json().catch(() => {
      throw new AIServiceError(
        `${service} returned invalid JSON`,
        "invalid_response",
        service,
        response.status,
      );
    })) as unknown;
    if (validate && !validate(payload)) {
      throw new AIServiceError(
        `${service} returned an invalid response`,
        "invalid_response",
        service,
        response.status,
      );
    }

    logServiceRequest({
      service,
      durationMs: Date.now() - startedAt,
      success: true,
      status,
      errorType: null,
    });
    return payload as T;
  } catch (error) {
    let failure: AIServiceError;
    if (error instanceof AIServiceError) {
      failure = error;
    } else if (controller.signal.aborted) {
      failure = new AIServiceError(
        `${service} request timed out`,
        "timeout",
        service,
      );
    } else {
      failure = new AIServiceError(
        `${service} is unavailable`,
        "network_error",
        service,
      );
    }
    errorType = failure.code;
    logServiceRequest({
      service,
      durationMs: Date.now() - startedAt,
      success: false,
      status: failure.status ?? status,
      errorType,
    });
    throw failure;
  } finally {
    clearTimeout(timeout);
  }
}

