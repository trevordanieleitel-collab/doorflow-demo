const CREDENTIAL_KEYS = new Set([
  "access_token",
  "refresh_token",
  "token_hash"
]);

const INVITE_MARKER = "invite";
const DEFAULT_VERIFICATION_TIMEOUT_MS = 12000;
const DEFAULT_AUTH_REQUEST_TIMEOUT_MS = 12000;

export class InvitationFlowError extends Error {
  constructor(code) {
    super(code);
    this.name = "InvitationFlowError";
    this.code = code;
  }
}

function collectParams(url) {
  const query = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const values = new Map();

  for (const source of [query, fragment]) {
    for (const [key, value] of source.entries()) {
      if (!values.has(key)) values.set(key, []);
      values.get(key).push(value);
    }
  }

  return values;
}

function oneValue(values, key) {
  const matches = values.get(key) || [];
  if (matches.length > 1) return { duplicate: true, value: "" };
  return { duplicate: false, value: matches[0] || "" };
}

function hasCredentialParameter(values) {
  return [...CREDENTIAL_KEYS].some(key => values.has(key));
}

export function parseInvitationUrl(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl, "https://doorflow.invalid");
  } catch {
    return { kind: "malformed" };
  }

  const values = collectParams(url);
  const errorCode = oneValue(values, "error_code");
  const errorName = oneValue(values, "error");

  if (errorCode.duplicate || errorName.duplicate) return { kind: "malformed" };
  if (errorCode.value || errorName.value) {
    const providerCode = (errorCode.value || errorName.value).toLowerCase();
    return {
      kind: "provider_error",
      reason: /expired|already[_ -]?used|otp_expired/.test(providerCode)
        ? "expired_or_used"
        : "invalid"
    };
  }

  const type = oneValue(values, "type");
  const tokenHash = oneValue(values, "token_hash");
  const accessToken = oneValue(values, "access_token");
  const refreshToken = oneValue(values, "refresh_token");
  const hasDuplicate = [type, tokenHash, accessToken, refreshToken].some(item => item.duplicate);

  if (hasDuplicate) return { kind: "malformed" };

  const hasTokenHash = Boolean(tokenHash.value);
  const hasImplicitPair = Boolean(accessToken.value && refreshToken.value);
  const hasPartialImplicitPair = Boolean(accessToken.value) !== Boolean(refreshToken.value);

  if (type.value !== INVITE_MARKER) {
    return hasCredentialParameter(values) || type.value
      ? { kind: "malformed" }
      : { kind: "missing" };
  }

  if (hasPartialImplicitPair || (hasTokenHash && hasImplicitPair)) return { kind: "malformed" };

  if (hasTokenHash) {
    return {
      kind: "token_hash",
      tokenHash: tokenHash.value
    };
  }

  if (hasImplicitPair) {
    return {
      kind: "implicit",
      accessToken: accessToken.value,
      refreshToken: refreshToken.value
    };
  }

  return { kind: "malformed" };
}

export function createMemoryStorage() {
  const entries = new Map();

  return {
    getItem(key) {
      return entries.has(String(key)) ? entries.get(String(key)) : null;
    },
    setItem(key, value) {
      entries.set(String(key), String(value));
    },
    removeItem(key) {
      entries.delete(String(key));
    },
    clear() {
      entries.clear();
    }
  };
}

export function isolatedAuthOptions(storage) {
  return {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
    flowType: "implicit",
    storage,
    storageKey: "doorflow-invite-memory"
  };
}

function boundedDuration(value, fallback) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0
    ? Math.min(Math.floor(duration), 30000)
    : fallback;
}

function abortError(code) {
  return new InvitationFlowError(code);
}

export function createBoundedAuthFetch(
  fetchImplementation,
  timeoutMs = DEFAULT_AUTH_REQUEST_TIMEOUT_MS,
  timerApi = globalThis
) {
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }

  const duration = boundedDuration(timeoutMs, DEFAULT_AUTH_REQUEST_TIMEOUT_MS);
  const activeControllers = new Set();
  let disposed = false;

  const boundedFetch = async (input, init = {}) => {
    if (disposed) throw abortError("operation_aborted");

    const controller = new AbortController();
    const callerSignal = init?.signal;
    let timedOut = false;
    let timer;

    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) {
      abortFromCaller();
    } else {
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    activeControllers.add(controller);

    const abortPromise = new Promise((_, reject) => {
      const rejectForAbort = () => {
        reject(abortError(timedOut ? "verification_timeout" : "operation_aborted"));
      };

      if (controller.signal.aborted) {
        rejectForAbort();
      } else {
        controller.signal.addEventListener("abort", rejectForAbort, { once: true });
      }
    });

    timer = timerApi.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, duration);

    try {
      return await Promise.race([
        Promise.resolve().then(() => fetchImplementation(input, {
          ...init,
          signal: controller.signal
        })),
        abortPromise
      ]);
    } finally {
      timerApi.clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
      activeControllers.delete(controller);
    }
  };

  boundedFetch.abortAll = () => {
    for (const controller of activeControllers) controller.abort();
  };

  boundedFetch.dispose = () => {
    disposed = true;
    boundedFetch.abortAll();
  };

  return boundedFetch;
}

function eraseLinkMaterial(material) {
  if (!material || typeof material !== "object") return;
  if ("tokenHash" in material) material.tokenHash = "";
  if ("accessToken" in material) material.accessToken = "";
  if ("refreshToken" in material) material.refreshToken = "";
}

export async function establishInvitationSession(auth, material) {
  if (!auth || !material || !["token_hash", "implicit"].includes(material.kind)) {
    eraseLinkMaterial(material);
    throw new InvitationFlowError("malformed");
  }

  let response;

  try {
    if (material.kind === "token_hash") {
      response = await auth.verifyOtp({
        token_hash: material.tokenHash,
        type: INVITE_MARKER
      });
    } else {
      response = await auth.setSession({
        access_token: material.accessToken,
        refresh_token: material.refreshToken
      });
    }
  } finally {
    eraseLinkMaterial(material);
  }

  if (response?.error) throw response.error;

  const session = response?.data?.session;
  const sessionUser = session?.user;
  const accessToken = session?.access_token;

  if (!accessToken || !sessionUser?.id) {
    throw new InvitationFlowError("missing_session");
  }

  return {
    id: sessionUser.id,
    email: typeof sessionUser.email === "string" ? sessionUser.email : ""
  };
}

async function withVerificationTimeout(operation, timeoutMs) {
  // The Supabase client uses createBoundedAuthFetch, which aborts the actual
  // request at the configured deadline. This slightly later watchdog also
  // bounds unexpected SDK work that never reaches fetch.
  const duration = boundedDuration(timeoutMs, DEFAULT_VERIFICATION_TIMEOUT_MS) + 250;
  let timer;

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new InvitationFlowError("verification_timeout")), duration);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyInvitationSession(auth, expectedIdentity, timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS) {
  if (!auth || !expectedIdentity?.id) {
    throw new InvitationFlowError("missing_session");
  }

  // The isolated client owns the established session in memory. Verification
  // retries intentionally use that session rather than any erased URL token.
  const verified = await withVerificationTimeout(() => auth.getUser(), timeoutMs);
  if (verified?.error) throw verified.error;

  const user = verified?.data?.user;
  if (!user?.id || user.id !== expectedIdentity.id || user.is_anonymous === true) {
    throw new InvitationFlowError("identity_mismatch");
  }

  if (!user.invited_at) {
    throw new InvitationFlowError("not_invited");
  }

  if (
    user.email
    && expectedIdentity.email
    && user.email.toLowerCase() !== expectedIdentity.email.toLowerCase()
  ) {
    throw new InvitationFlowError("identity_mismatch");
  }

  return {
    id: user.id,
    email: typeof user.email === "string" ? user.email : ""
  };
}

export function validatePasswordFields(password, confirmation) {
  if (typeof password !== "string" || password.length === 0) {
    return "Enter a new password.";
  }

  if (typeof confirmation !== "string" || confirmation.length === 0) {
    return "Confirm your new password.";
  }

  if (password !== confirmation) {
    return "The passwords do not match.";
  }

  return "";
}

export async function updateInvitationPassword(
  auth,
  expectedIdentity,
  password,
  confirmation,
  timeoutMs = DEFAULT_VERIFICATION_TIMEOUT_MS
) {
  const validationMessage = validatePasswordFields(password, confirmation);
  if (validationMessage) throw new InvitationFlowError("password_validation");

  const verifiedIdentity = await verifyInvitationSession(auth, expectedIdentity, timeoutMs);
  const response = await withVerificationTimeout(
    () => auth.updateUser({ password }),
    timeoutMs
  );
  if (response?.error) throw response.error;

  const updatedUser = response?.data?.user;
  if (!updatedUser?.id) throw new InvitationFlowError("password_update_failed");
  if (updatedUser.id !== verifiedIdentity.id) {
    throw new InvitationFlowError("identity_mismatch");
  }

  if (
    updatedUser.email
    && verifiedIdentity.email
    && updatedUser.email.toLowerCase() !== verifiedIdentity.email.toLowerCase()
  ) {
    throw new InvitationFlowError("identity_mismatch");
  }

  return {
    id: updatedUser.id,
    email: typeof updatedUser.email === "string" ? updatedUser.email : verifiedIdentity.email
  };
}

function normalizedErrorText(error) {
  return `${error?.code || ""} ${error?.message || ""}`
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isTransientInvitationVerificationError(error) {
  if (error instanceof InvitationFlowError && error.code === "verification_timeout") {
    return true;
  }

  const status = Number(error?.status);
  const text = normalizedErrorText(error);
  return status === 408
    || status === 429
    || status >= 500
    || /network|failed to fetch|fetch failed|timeout|timed out|temporarily unavailable/.test(text);
}

export function classifyInvitationError(error) {
  if (error instanceof InvitationFlowError) {
    if (["missing_session", "identity_mismatch", "not_invited", "malformed"].includes(error.code)) {
      return error.code;
    }
  }

  const text = normalizedErrorText(error);
  if (/already[_ -]?used|otp_expired|expired|session_not_found|refresh_token_not_found/.test(text)) {
    return "expired_or_used";
  }

  if (isTransientInvitationVerificationError(error)) {
    return "unavailable";
  }

  return "invalid";
}

export function safeProviderPasswordMessage(error) {
  const status = Number(error?.status);
  const code = typeof error?.code === "string" ? error.code.toLowerCase() : "";

  if (status === 429 || ["over_request_rate_limit", "rate_limit_exceeded"].includes(code)) {
    return "The sign-in service is receiving too many requests. Wait a moment and try again while this page remains open.";
  }

  if (code === "same_password") {
    return "Choose a password that is different from the account's current password.";
  }

  if (isTransientInvitationVerificationError(error)) {
    return "DoorFlow could not reach the sign-in service. Check your connection and try again while this page remains open.";
  }

  if (["weak_password", "password_too_short", "validation_failed"].includes(code) || status === 422) {
    return "That password does not meet the sign-in service's security requirements. Choose a stronger password and try again.";
  }

  return "The sign-in service did not accept that password. Try a different password or ask a DoorFlow Admin for a new invitation.";
}
