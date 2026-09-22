import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  InvitationFlowError,
  classifyInvitationError,
  createBoundedAuthFetch,
  createMemoryStorage,
  establishInvitationSession,
  isTransientInvitationVerificationError,
  isolatedAuthOptions,
  parseInvitationUrl,
  safeProviderPasswordMessage,
  updateInvitationPassword,
  validatePasswordFields,
  verifyInvitationSession
} from "./invite-acceptance-core.mjs";

test("parses a complete implicit invite fragment", () => {
  assert.deepEqual(
    parseInvitationUrl("https://doorflow.example/auth/#access_token=access&refresh_token=refresh&type=invite"),
    {
      kind: "implicit",
      accessToken: "access",
      refreshToken: "refresh"
    }
  );
});

test("parses the supported invite token-hash flow", () => {
  assert.deepEqual(
    parseInvitationUrl("https://doorflow.example/auth/?token_hash=hash-value&type=invite"),
    { kind: "token_hash", tokenHash: "hash-value" }
  );
});

test("never treats the invite type marker alone as authentication", () => {
  assert.deepEqual(
    parseInvitationUrl("https://doorflow.example/auth/?type=invite"),
    { kind: "malformed" }
  );
});

test("rejects partial, mixed, duplicate, and non-invite credentials", () => {
  const badUrls = [
    "https://doorflow.example/auth/#access_token=a&type=invite",
    "https://doorflow.example/auth/?token_hash=h&type=invite#access_token=a&refresh_token=r",
    "https://doorflow.example/auth/?token_hash=h&token_hash=h2&type=invite",
    "https://doorflow.example/auth/#access_token=a&refresh_token=r&type=recovery",
    "https://doorflow.example/auth/?token_hash=h&type=invite&type=invite"
  ];

  for (const url of badUrls) {
    assert.deepEqual(parseInvitationUrl(url), { kind: "malformed" });
  }
});

test("classifies provider redirect errors without retaining descriptions", () => {
  assert.deepEqual(
    parseInvitationUrl("https://doorflow.example/auth/#error=access_denied&error_code=otp_expired&error_description=secret"),
    { kind: "provider_error", reason: "expired_or_used" }
  );
});

test("isolated auth configuration is nonpersistent and URL detection is disabled", () => {
  const first = createMemoryStorage();
  const second = createMemoryStorage();
  const options = isolatedAuthOptions(first);

  first.setItem("session", "invite-only");
  assert.equal(first.getItem("session"), "invite-only");
  assert.equal(second.getItem("session"), null);
  assert.equal(options.storage, first);
  assert.equal(options.persistSession, false);
  assert.equal(options.autoRefreshToken, false);
  assert.equal(options.detectSessionInUrl, false);
  assert.equal(options.flowType, "implicit");
  assert.equal(globalThis.localStorage, undefined);
});

test("bounded Auth fetch aborts the underlying request at a deterministic deadline", async () => {
  let timeoutCallback;
  let observedSignal;
  let resolveLateFetch;
  const timerApi = {
    setTimeout(callback) {
      timeoutCallback = callback;
      return 17;
    },
    clearTimeout() {}
  };
  const boundedFetch = createBoundedAuthFetch(
    async (_input, init) => {
      observedSignal = init.signal;
      return await new Promise(resolve => {
        resolveLateFetch = resolve;
      });
    },
    5000,
    timerApi
  );

  const pending = boundedFetch("https://auth.invalid/token", { method: "POST" });
  await Promise.resolve();
  assert.equal(observedSignal.aborted, false);

  timeoutCallback();
  await assert.rejects(
    pending,
    error => error instanceof InvitationFlowError && error.code === "verification_timeout"
  );
  assert.equal(observedSignal.aborted, true);

  resolveLateFetch({ ok: true });
  await Promise.resolve();
});

test("a timed-out invitation exchange erases link material and cannot become a late success", async () => {
  let timeoutCallback;
  let observedSignal;
  let resolveLateFetch;
  const timerApi = {
    setTimeout(callback) {
      timeoutCallback = callback;
      return 23;
    },
    clearTimeout() {}
  };
  const boundedFetch = createBoundedAuthFetch(
    async (_input, init) => {
      observedSignal = init.signal;
      return await new Promise(resolve => {
        resolveLateFetch = resolve;
      });
    },
    5000,
    timerApi
  );
  const material = { kind: "token_hash", tokenHash: "fictional-one-time-material" };
  const exchange = establishInvitationSession({
    async verifyOtp() {
      return await boundedFetch("https://auth.invalid/verify");
    }
  }, material);

  await Promise.resolve();
  await Promise.resolve();
  timeoutCallback();
  await assert.rejects(
    exchange,
    error => error instanceof InvitationFlowError && error.code === "verification_timeout"
  );
  assert.equal(observedSignal.aborted, true);
  assert.equal(material.tokenHash, "");

  resolveLateFetch({
    data: {
      session: {
        access_token: "late-access",
        user: { id: "late-user" }
      }
    },
    error: null
  });
  await Promise.resolve();
  assert.equal(material.tokenHash, "");
});

test("disposing bounded Auth fetch aborts in-flight work and prevents new requests", async () => {
  let observedSignal;
  let fetchCalls = 0;
  const timerApi = {
    setTimeout() {
      return 19;
    },
    clearTimeout() {}
  };
  const boundedFetch = createBoundedAuthFetch(
    async (_input, init) => {
      fetchCalls += 1;
      observedSignal = init.signal;
      return await new Promise(() => {});
    },
    5000,
    timerApi
  );

  const pending = boundedFetch("https://auth.invalid/user");
  await Promise.resolve();
  boundedFetch.dispose();

  await assert.rejects(
    pending,
    error => error instanceof InvitationFlowError && error.code === "operation_aborted"
  );
  assert.equal(observedSignal.aborted, true);
  await assert.rejects(
    boundedFetch("https://auth.invalid/user"),
    error => error instanceof InvitationFlowError && error.code === "operation_aborted"
  );
  assert.equal(fetchCalls, 1);
});

test("token-hash establishment hard-codes invite and verifies the retained session", async () => {
  const calls = [];
  const material = { kind: "token_hash", tokenHash: "one-time-hash" };
  const auth = {
    async verifyOtp(input) {
      calls.push(["verifyOtp", input]);
      return {
        data: {
          session: {
            access_token: "verified-access",
            user: { id: "user-1", email: "STAFF@example.com" }
          }
        },
        error: null
      };
    },
    async getUser(...args) {
      calls.push(["getUser", args]);
      return {
        data: {
          user: {
            id: "user-1",
            email: "staff@example.com",
            invited_at: "2026-09-17T12:00:00Z"
          }
        },
        error: null
      };
    }
  };

  const established = await establishInvitationSession(auth, material);
  assert.deepEqual(established, { id: "user-1", email: "STAFF@example.com" });
  assert.deepEqual(await verifyInvitationSession(auth, established), {
    id: "user-1",
    email: "staff@example.com"
  });
  assert.deepEqual(calls, [
    ["verifyOtp", { token_hash: "one-time-hash", type: "invite" }],
    ["getUser", []]
  ]);
  assert.equal(material.tokenHash, "");
});

test("implicit establishment uses only link credentials and verifies from retained memory", async () => {
  let getSessionCalled = false;
  const material = {
    kind: "implicit",
    accessToken: "invite-access",
    refreshToken: "invite-refresh"
  };
  const auth = {
    async setSession(input) {
      assert.deepEqual(input, {
        access_token: "invite-access",
        refresh_token: "invite-refresh"
      });
      return {
        data: {
          session: {
            access_token: "provider-access",
            user: { id: "invited-user", email: "invitee@example.com" }
          }
        },
        error: null
      };
    },
    async getSession() {
      getSessionCalled = true;
    },
    async getUser(...args) {
      assert.deepEqual(args, []);
      return {
        data: {
          user: {
            id: "invited-user",
            email: "invitee@example.com",
            invited_at: "2026-09-17T12:00:00Z"
          }
        },
        error: null
      };
    }
  };

  const established = await establishInvitationSession(auth, material);
  assert.deepEqual(established, { id: "invited-user", email: "invitee@example.com" });
  assert.deepEqual(await verifyInvitationSession(auth, established), {
    id: "invited-user",
    email: "invitee@example.com"
  });
  assert.equal(getSessionCalled, false);
  assert.equal(material.accessToken, "");
  assert.equal(material.refreshToken, "");
});

test("transient retained-session verification can succeed on explicit retry", async () => {
  let verificationCalls = 0;
  const material = {
    kind: "implicit",
    accessToken: "link-access",
    refreshToken: "link-refresh"
  };
  const auth = {
    async setSession() {
      return {
        data: {
          session: {
            access_token: "retained-access",
            user: { id: "invited-user", email: "invitee@example.com" }
          }
        },
        error: null
      };
    },
    async getUser(...args) {
      assert.deepEqual(args, []);
      verificationCalls += 1;
      if (verificationCalls === 1) throw new TypeError("Failed to fetch");
      return {
        data: {
          user: {
            id: "invited-user",
            email: "invitee@example.com",
            invited_at: "2026-09-17T12:00:00Z"
          }
        },
        error: null
      };
    }
  };

  const established = await establishInvitationSession(auth, material);
  assert.equal(material.accessToken, "");
  assert.equal(material.refreshToken, "");

  await assert.rejects(
    verifyInvitationSession(auth, established),
    error => isTransientInvitationVerificationError(error)
  );
  assert.deepEqual(await verifyInvitationSession(auth, established), {
    id: "invited-user",
    email: "invitee@example.com"
  });
  assert.equal(verificationCalls, 2);
});

test("rejects a real session that lacks provider invitation provenance", async () => {
  const auth = {
    async setSession() {
      return {
        data: { session: { access_token: "access", user: { id: "admin" } } },
        error: null
      };
    },
    async getUser() {
      return { data: { user: { id: "admin", email: "admin@example.com" } }, error: null };
    }
  };

  const established = await establishInvitationSession(auth, {
      kind: "implicit",
      accessToken: "regular-session",
      refreshToken: "regular-refresh"
    });

  await assert.rejects(
    verifyInvitationSession(auth, established),
    error => error instanceof InvitationFlowError && error.code === "not_invited"
  );
});

test("rejects session and verified-user identity mismatches", async () => {
  const auth = {
    async setSession() {
      return {
        data: { session: { access_token: "access", user: { id: "user-a" } } },
        error: null
      };
    },
    async getUser() {
      return {
        data: { user: { id: "user-b", invited_at: "2026-09-17T12:00:00Z" } },
        error: null
      };
    }
  };

  const established = await establishInvitationSession(auth, {
      kind: "implicit",
      accessToken: "access",
      refreshToken: "refresh"
    });

  await assert.rejects(
    verifyInvitationSession(auth, established),
    error => error instanceof InvitationFlowError && error.code === "identity_mismatch"
  );
});

test("local password checks enforce only nonempty and exact match", () => {
  assert.equal(validatePasswordFields("", ""), "Enter a new password.");
  assert.equal(validatePasswordFields("short", ""), "Confirm your new password.");
  assert.equal(validatePasswordFields("one", "two"), "The passwords do not match.");
  assert.equal(validatePasswordFields("x", "x"), "");
  assert.equal(validatePasswordFields(" ", " "), "");
});

test("password update re-verifies invitation identity immediately before provider mutation", async () => {
  const calls = [];
  const auth = {
    async getUser() {
      calls.push("getUser");
      return {
        data: {
          user: {
            id: "user-1",
            email: "staff@example.com",
            invited_at: "2026-09-17T12:00:00Z"
          }
        },
        error: null
      };
    },
    async updateUser(input) {
      calls.push("updateUser");
      assert.deepEqual(input, { password: "x" });
      return {
        data: { user: { id: "user-1", email: "staff@example.com" } },
        error: null
      };
    }
  };

  assert.deepEqual(
    await updateInvitationPassword(
      auth,
      { id: "user-1", email: "staff@example.com" },
      "x",
      "x"
    ),
    { id: "user-1", email: "staff@example.com" }
  );
  assert.deepEqual(calls, ["getUser", "updateUser"]);

  const providerError = Object.assign(new Error("Password must contain a number"), {
    code: "weak_password",
    status: 422
  });
  await assert.rejects(
    updateInvitationPassword({
      getUser: auth.getUser,
      updateUser: async () => ({ error: providerError })
    }, { id: "user-1", email: "staff@example.com" }, "abc", "abc"),
    providerError
  );
});

test("identity drift or missing invite provenance blocks password mutation", async () => {
  for (const user of [
    {
      id: "other-user",
      email: "staff@example.com",
      invited_at: "2026-09-17T12:00:00Z"
    },
    {
      id: "user-1",
      email: "staff@example.com"
    },
    {
      id: "user-1",
      email: "different@example.com",
      invited_at: "2026-09-17T12:00:00Z"
    }
  ]) {
    let updateCalls = 0;
    const auth = {
      async getUser() {
        return { data: { user }, error: null };
      },
      async updateUser() {
        updateCalls += 1;
        return { data: { user: { id: user.id } }, error: null };
      }
    };

    await assert.rejects(
      updateInvitationPassword(
        auth,
        { id: "user-1", email: "staff@example.com" },
        "new-password",
        "new-password"
      ),
      error => error instanceof InvitationFlowError
        && ["identity_mismatch", "not_invited"].includes(error.code)
    );
    assert.equal(updateCalls, 0);
  }
});

test("maps expired, already-used, and unavailable provider failures", () => {
  assert.equal(classifyInvitationError({ code: "otp_expired" }), "expired_or_used");
  assert.equal(classifyInvitationError({ message: "Token already used" }), "expired_or_used");
  assert.equal(classifyInvitationError({ message: "Failed to fetch" }), "unavailable");
  assert.equal(classifyInvitationError({ message: "Request timeout", status: 408 }), "unavailable");
  assert.equal(classifyInvitationError({ message: "Bad JWT", status: 400 }), "invalid");
});

test("provider password messages use a fixed allowlist and never echo provider prose", () => {
  assert.equal(
    safeProviderPasswordMessage({
      code: "weak_password",
      message: "password token=secret https://example.test/invite",
      status: 422,
      details: { access_token: "nested-secret" }
    }),
    "That password does not meet the sign-in service's security requirements. Choose a stronger password and try again."
  );
  assert.equal(
    safeProviderPasswordMessage({
      code: "unknown_error",
      message: "bearer raw-secret provider detail",
      status: 400
    }),
    "The sign-in service did not accept that password. Try a different password or ask a DoorFlow Admin for a new invitation."
  );
  assert.equal(
    safeProviderPasswordMessage({ code: "over_request_rate_limit", message: "secret", status: 429 }),
    "The sign-in service is receiving too many requests. Wait a moment and try again while this page remains open."
  );
  assert.equal(
    safeProviderPasswordMessage({ message: "Failed to fetch bearer-secret" }),
    "DoorFlow could not reach the sign-in service. Check your connection and try again while this page remains open."
  );

  const combined = [
    safeProviderPasswordMessage({ code: "weak_password", message: "token=secret", status: 422 }),
    safeProviderPasswordMessage({ code: "unknown", message: "bearer raw-secret", status: 400 })
  ].join(" ");
  assert.doesNotMatch(combined, /secret|bearer|token=/i);
});

test("standalone page keeps credentials out of persistence, referrers, and caches", async () => {
  const [html, browserSource, coreSource] = await Promise.all([
    readFile(new URL("./index.html", import.meta.url), "utf8"),
    readFile(new URL("./accept-invite.js", import.meta.url), "utf8"),
    readFile(new URL("./invite-acceptance-core.mjs", import.meta.url), "utf8")
  ]);

  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /http-equiv="Cache-Control" content="no-store, max-age=0"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive">/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /id="login-link"[^>]+href="\.\.\/"/);
  assert.ok(
    html.indexOf("./accept-invite.js") < html.indexOf("./accept-invite.css"),
    "credential cleanup script must execute before subresource loading"
  );
  assert.ok(
    browserSource.indexOf("history.replaceState") < browserSource.indexOf("import(SUPABASE_SDK_MODULE)"),
    "credential URL material must be removed before loading the SDK"
  );
  assert.match(browserSource, /@supabase\/supabase-js@\d+\.\d+\.\d+\/\+esm/);
  assert.match(html, /id="retry-verification-button"/);
  assert.match(html, /id="success-panel"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(browserSource, /verifyRetainedInvitationSession/);
  assert.match(browserSource, /void disposeInvitationSession\(\)/);
  assert.match(browserSource, /global:\s*\{\s*fetch:\s*boundedAuthFetch\s*\}/);
  assert.match(browserSource, /requestFetch\?\.abortAll\(\)/);
  assert.match(browserSource, /requestFetch\?\.dispose\(\)/);
  assert.match(browserSource, /window\.addEventListener\("pagehide",[\s\S]+void disposeInvitationSession\(\)/);
  assert.match(browserSource, /updateInvitationPassword\([\s\S]+expectedIdentity/);
  assert.match(coreSource, /auth\.getUser\(\)/);
  assert.doesNotMatch(coreSource, /auth\.getUser\(accessToken\)/);
  assert.doesNotMatch(`${browserSource}\n${coreSource}`, /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/);
  assert.doesNotMatch(`${browserSource}\n${coreSource}`, /\bconsole\s*\./);
  assert.doesNotMatch(html, /analytics|telemetry|pixel/i);
});
