(() => {
  "use strict";

  const SUPABASE_SDK_MODULE = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
  const MAX_VERIFICATION_ATTEMPTS = 3;
  const AUTH_REQUEST_TIMEOUT_MS = 12000;
  const SESSION_DISPOSAL_TIMEOUT_MS = 3000;

  // Capture once, then remove every query and fragment value before loading any
  // dependency. Invitation credentials remain only in this page's memory.
  let capturedUrl = window.location.href;
  const credentialFreePath = window.location.pathname || "/auth/";

  try {
    window.history.replaceState(null, document.title, credentialFreePath);
  } catch {
    window.location.replace(credentialFreePath);
    return;
  }

  function initialize() {
  const statusPanel = document.getElementById("invitation-status");
  const statusTitle = document.getElementById("status-title");
  const statusMessage = document.getElementById("status-message");
  const retryVerificationButton = document.getElementById("retry-verification-button");
  const passwordForm = document.getElementById("password-form");
  const accountSummary = document.getElementById("account-summary");
  const passwordInput = document.getElementById("new-password");
  const confirmInput = document.getElementById("confirm-password");
  const formError = document.getElementById("form-error");
  const submitButton = document.getElementById("set-password-button");
  const successPanel = document.getElementById("success-panel");
  const loginLink = document.getElementById("login-link");

  let core;
  let authClient;
  let boundedAuthFetch;
  let memoryStorage;
  let establishedIdentity;
  let verifiedIdentity;
  let verificationAttempts = 0;
  let verifyingInvitation = false;
  let submitting = false;
  let lifecycleVersion = 0;

  function setStatus(state, title, message, focus = false) {
    statusPanel.dataset.state = state;
    statusTitle.textContent = title;
    statusMessage.textContent = message;
    statusPanel.hidden = false;
    if (focus) statusPanel.focus();
  }

  function hideForm() {
    passwordForm.hidden = true;
    passwordInput.disabled = true;
    confirmInput.disabled = true;
    submitButton.disabled = true;
  }

  function clearPasswordFields() {
    passwordInput.value = "";
    confirmInput.value = "";
  }

  function hideVerificationRetry() {
    retryVerificationButton.hidden = true;
    retryVerificationButton.disabled = false;
    retryVerificationButton.textContent = "Retry verification";
  }

  function showInvitationFailure(reason) {
    clearPasswordFields();
    hideForm();
    hideVerificationRetry();
    successPanel.hidden = true;

    const copy = {
      missing: [
        "Invitation link required",
        "Open the complete invitation link from your most recent DoorFlow email."
      ],
      malformed: [
        "Invitation link is incomplete",
        "This link is malformed or uses an unsupported format. Ask a DoorFlow Admin to send a new invitation."
      ],
      expired_or_used: [
        "Invitation is no longer active",
        "This invitation has expired or has already been used. Ask a DoorFlow Admin to send a new invitation."
      ],
      missing_session: [
        "Invitation could not be verified",
        "The sign-in service did not create an invitation session. Ask a DoorFlow Admin to send a new invitation."
      ],
      identity_mismatch: [
        "Invitation identity could not be verified",
        "DoorFlow stopped setup because the invitation session did not match the verified account. Ask an Admin for a new invitation."
      ],
      not_invited: [
        "Invitation account could not be verified",
        "The verified account was not created through a DoorFlow invitation. No password was changed."
      ],
      unavailable: [
        "Sign-in service unavailable",
        "DoorFlow could not verify this invitation. Check your connection, then reopen the original invitation link."
      ],
      invalid: [
        "Invitation is invalid",
        "The sign-in service rejected this invitation. It may be expired, already used, or replaced by a newer invitation."
      ]
    };

    const [title, message] = copy[reason] || copy.invalid;
    setStatus("error", title, message, true);
  }

  function showPasswordForm(identity) {
    hideVerificationRetry();
    statusPanel.dataset.state = "ready";
    setStatus(
      "ready",
      "Invitation verified",
      "Choose a password to finish setting up your DoorFlow account."
    );

    accountSummary.textContent = identity.email
      ? `Setting a password for ${identity.email}.`
      : "Setting a password for your verified account.";
    passwordForm.hidden = false;
    passwordInput.disabled = false;
    confirmInput.disabled = false;
    submitButton.disabled = false;
    passwordInput.focus();
  }

  function showVerificationRetry() {
    hideForm();
    successPanel.hidden = true;

    const attemptsRemain = verificationAttempts < MAX_VERIFICATION_ATTEMPTS;
    setStatus(
      "error",
      attemptsRemain ? "Invitation verification interrupted" : "Invitation verification paused",
      attemptsRemain
        ? "DoorFlow retained this isolated invitation session. Check your connection, then retry verification without reopening the link."
        : "DoorFlow could not verify this retained invitation session after several attempts. No password was changed; ask a DoorFlow Admin for a new invitation.",
      true
    );
    retryVerificationButton.hidden = !attemptsRemain;
  }

  function clearFormError() {
    formError.hidden = true;
    formError.textContent = "";
    passwordInput.removeAttribute("aria-invalid");
    confirmInput.removeAttribute("aria-invalid");
  }

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = false;
    passwordInput.setAttribute("aria-invalid", "true");
    confirmInput.setAttribute("aria-invalid", "true");
    formError.focus();
  }

  async function disposeInvitationSession() {
    const client = authClient;
    const requestFetch = boundedAuthFetch;
    const storage = memoryStorage;

    lifecycleVersion += 1;
    clearPasswordFields();
    authClient = null;
    boundedAuthFetch = null;
    memoryStorage = null;
    establishedIdentity = null;
    verifiedIdentity = null;
    verifyingInvitation = false;
    requestFetch?.abortAll();
    storage?.clear();

    try {
      client?.auth?.stopAutoRefresh?.();
    } catch {
      // Releasing the isolated client below is still required.
    }

    let timer;

    if (client) {
      try {
        const signOut = client.auth.signOut({ scope: "local" });
        const dispose = typeof client.auth.dispose === "function"
          ? client.auth.dispose()
          : Promise.resolve();
        await Promise.race([
          Promise.allSettled([signOut, dispose]),
          new Promise(resolve => {
            timer = setTimeout(resolve, SESSION_DISPOSAL_TIMEOUT_MS);
          })
        ]);
      } catch {
        // The isolated client and its in-memory storage are still discarded.
      } finally {
        clearTimeout(timer);
      }
    }

    requestFetch?.dispose();
    storage?.clear();
  }

  async function verifyRetainedInvitationSession() {
    if (
      verifyingInvitation
      || !authClient
      || !establishedIdentity
      || verificationAttempts >= MAX_VERIFICATION_ATTEMPTS
    ) {
      return;
    }

    verifyingInvitation = true;
    const client = authClient;
    const version = lifecycleVersion;
    verificationAttempts += 1;
    hideForm();
    retryVerificationButton.hidden = true;
    retryVerificationButton.disabled = true;
    retryVerificationButton.textContent = "Verifying…";
    setStatus(
      "loading",
      verificationAttempts === 1 ? "Verifying invitation" : "Retrying invitation verification",
      "DoorFlow is securely checking the retained invitation session."
    );

    try {
      const identity = await core.verifyInvitationSession(
        client.auth,
        establishedIdentity
      );
      if (authClient !== client || lifecycleVersion !== version) return;
      verifiedIdentity = identity;
      showPasswordForm(verifiedIdentity);
    } catch (error) {
      if (authClient !== client || lifecycleVersion !== version) return;
      verifiedIdentity = null;
      if (core.isTransientInvitationVerificationError(error)) {
        showVerificationRetry();
        if (verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
          await disposeInvitationSession();
        }
      } else {
        showInvitationFailure(core.classifyInvitationError(error));
        await disposeInvitationSession();
      }
    } finally {
      verifyingInvitation = false;
      if (!retryVerificationButton.hidden) {
        retryVerificationButton.disabled = false;
        retryVerificationButton.textContent = "Retry verification";
      }
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting || !authClient || !verifiedIdentity) return;

    clearFormError();
    const password = passwordInput.value;
    const confirmation = confirmInput.value;
    const client = authClient;
    const expectedIdentity = { ...verifiedIdentity };
    const version = lifecycleVersion;
    const validationMessage = core.validatePasswordFields(password, confirmation);

    if (validationMessage) {
      showFormError(validationMessage);
      return;
    }

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = "Setting password…";

    try {
      const updated = await core.updateInvitationPassword(
        client.auth,
        expectedIdentity,
        password,
        confirmation
      );

      if (authClient !== client || lifecycleVersion !== version) return;

      if (updated.id !== expectedIdentity.id) {
        throw new core.InvitationFlowError("identity_mismatch");
      }

      passwordInput.value = "";
      confirmInput.value = "";
      hideForm();
      hideVerificationRetry();
      statusPanel.hidden = true;
      successPanel.hidden = false;
      loginLink.textContent = "Sign in to DoorFlow";
      successPanel.focus();
      void disposeInvitationSession();
    } catch (error) {
      if (authClient !== client || lifecycleVersion !== version) return;
      const reason = core.classifyInvitationError(error);

      if (["expired_or_used", "missing_session", "identity_mismatch", "not_invited"].includes(reason)) {
        showInvitationFailure(reason);
        await disposeInvitationSession();
      } else {
        showFormError(core.safeProviderPasswordMessage(error));
      }
    } finally {
      submitting = false;
      if (!passwordForm.hidden) {
        submitButton.disabled = false;
        submitButton.textContent = "Set password";
      }
    }
  }

  async function start() {
    let parsed;
    const startVersion = lifecycleVersion;

    try {
      core = await import("./invite-acceptance-core.mjs");
      if (lifecycleVersion !== startVersion) return;
      parsed = core.parseInvitationUrl(capturedUrl);
    } catch {
      capturedUrl = "";
      showInvitationFailure("unavailable");
      return;
    } finally {
      capturedUrl = "";
    }

    if (!["implicit", "token_hash"].includes(parsed.kind)) {
      showInvitationFailure(parsed.reason || parsed.kind);
      return;
    }

    if (navigator.onLine === false) {
      if ("accessToken" in parsed) parsed.accessToken = "";
      if ("refreshToken" in parsed) parsed.refreshToken = "";
      if ("tokenHash" in parsed) parsed.tokenHash = "";
      showInvitationFailure("unavailable");
      return;
    }

    let config;
    try {
      config = await window.DoorFlowConfig.load();
      if (lifecycleVersion !== startVersion) return;
    } catch {
      if ("accessToken" in parsed) parsed.accessToken = "";
      if ("refreshToken" in parsed) parsed.refreshToken = "";
      if ("tokenHash" in parsed) parsed.tokenHash = "";
      if (lifecycleVersion !== startVersion) return;
      showInvitationFailure("unavailable");
      statusMessage.textContent = "DoorFlow configuration is unavailable. Contact your administrator.";
      return;
    }
    try {
      const { createClient } = await import(SUPABASE_SDK_MODULE);
      if (lifecycleVersion !== startVersion) return;
      memoryStorage = core.createMemoryStorage();
      boundedAuthFetch = core.createBoundedAuthFetch(
        window.fetch.bind(window),
        AUTH_REQUEST_TIMEOUT_MS
      );
      authClient = createClient(config.supabaseUrl, config.publishableKey, {
        auth: core.isolatedAuthOptions(memoryStorage),
        global: { fetch: boundedAuthFetch }
      });

      const client = authClient;
      const identity = await core.establishInvitationSession(client.auth, parsed);
      if (authClient !== client || lifecycleVersion !== startVersion) return;
      establishedIdentity = identity;
      await verifyRetainedInvitationSession();
    } catch (error) {
      if (lifecycleVersion !== startVersion) return;
      showInvitationFailure(core.classifyInvitationError(error));
      await disposeInvitationSession();
    }
  }

  passwordForm.addEventListener("submit", onSubmit);
  retryVerificationButton.addEventListener("click", verifyRetainedInvitationSession);

  window.addEventListener("pagehide", () => {
    passwordInput.value = "";
    confirmInput.value = "";
    void disposeInvitationSession();
  });

  window.addEventListener("pageshow", event => {
    if (event.persisted) window.location.reload();
  });

  start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
