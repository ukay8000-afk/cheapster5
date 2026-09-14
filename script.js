// ============================================================================
// Cheapster.in — Frontend logic
// Talks to the FastAPI backend (main.py). Update API_BASE for your deployment.
// ============================================================================

const API_BASE = window.CHEAPSTER_API_BASE || "http://localhost:8000";

// In-memory app state (no browser storage — session lives for the tab only,
// mirroring how a real app would rely on an httpOnly cookie / short-lived token).
const state = {
  sessionToken: null,
  userId: null,
  identifier: null,
  pendingClaim: null,      // { orderId, platform } queued while login completes
  claimFlowActive: false,  // true once "Order at Store" has been clicked
};

// ---------------------------------------------------------------------------
// DOM shortcuts
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const els = {
  headerSearch: $("header-search"),
  headerSearchInput: $("header-search-input"),
  headerSearchBtn: $("header-search-btn"),
  heroSection: $("hero-section"),
  heroSearchInput: $("hero-search-input"),
  heroSearchBtn: $("hero-search-btn"),
  resultsWrap: $("results-wrap"),
  resultsQueryLabel: $("results-query-label"),
  resultsCacheBadge: $("results-cache-badge"),
  productGrid: $("product-grid"),
  loadingSpinner: $("loading-spinner"),

  loginTriggerBtn: $("login-trigger-btn"),
  profileDropdown: $("profile-dropdown"),
  profileBtn: $("profile-btn"),
  profileInitial: $("profile-initial"),
  dropdownMenu: $("dropdown-menu"),
  dropdownIdentifier: $("dropdown-identifier"),
  logoutBtn: $("logout-btn"),
  deleteAccountBtn: $("delete-account-btn"),

  loginModalOverlay: $("login-modal-overlay"),
  googleLoginBtn: $("google-login-btn"),
  phoneStep1: $("phone-login-step-1"),
  phoneStep2: $("phone-login-step-2"),
  phoneInput: $("phone-input"),
  otpInput: $("otp-input"),
  sendOtpBtn: $("send-otp-btn"),
  verifyOtpBtn: $("verify-otp-btn"),
  loginError: $("login-error"),

  claimModalOverlay: $("claim-modal-overlay"),
  claimFormView: $("claim-form-view"),
  claimSuccessView: $("claim-success-view"),
  claimPhoneInput: $("claim-phone-input"),
  claimOrderIdInput: $("claim-order-id-input"),
  claimPlatformInput: $("claim-platform-input"),
  submitClaimBtn: $("submit-claim-btn"),
  claimError: $("claim-error"),

  legalModalOverlay: $("legal-modal-overlay"),
  termsContent: $("terms-content"),
  privacyContent: $("privacy-content"),
  openTerms: $("open-terms"),
  openPrivacy: $("open-privacy"),
};

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------
function showModal(overlayEl) { overlayEl.hidden = false; }
function hideModal(overlayEl) { overlayEl.hidden = true; }

async function api(path, { method = "GET", body = null, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && state.sessionToken) headers["Authorization"] = `Bearer ${state.sessionToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || "Request failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Auth UI state
// ---------------------------------------------------------------------------
function setAuthedUI() {
  els.loginTriggerBtn.hidden = true;
  els.profileDropdown.hidden = false;
  els.profileInitial.textContent = (state.identifier || "U").charAt(0).toUpperCase();
  els.dropdownIdentifier.textContent = state.identifier || "";
}

function setGuestUI() {
  els.loginTriggerBtn.hidden = false;
  els.profileDropdown.hidden = true;
  els.dropdownMenu.hidden = true;
}

function isLoggedIn() { return Boolean(state.sessionToken); }

// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------
els.loginTriggerBtn.addEventListener("click", () => {
  els.loginError.textContent = "";
  showModal(els.loginModalOverlay);
});

els.profileBtn.addEventListener("click", () => {
  els.dropdownMenu.hidden = !els.dropdownMenu.hidden;
});

document.addEventListener("click", (e) => {
  if (!els.profileDropdown.contains(e.target)) els.dropdownMenu.hidden = true;
});

// Mock Google OAuth — in production, replace with real Google Identity Services flow
els.googleLoginBtn.addEventListener("click", async () => {
  const mockEmail = `user${Math.floor(Math.random() * 9999)}@gmail.com`;
  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: { provider: "google", identifier: mockEmail },
    });
    onLoginSuccess(data);
  } catch (err) {
    els.loginError.textContent = err.message;
  }
});

els.sendOtpBtn.addEventListener("click", () => {
  const phone = els.phoneInput.value.trim();
  els.loginError.textContent = "";
  if (!/^\d{10}$/.test(phone)) {
    els.loginError.textContent = "Enter a valid 10-digit phone number.";
    return;
  }
  // MOCK: pretend an OTP was sent via SMS provider
  els.phoneStep1.hidden = true;
  els.phoneStep2.hidden = false;
});

els.verifyOtpBtn.addEventListener("click", async () => {
  const phone = els.phoneInput.value.trim();
  const otp = els.otpInput.value.trim();
  els.loginError.textContent = "";
  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: { provider: "phone", identifier: phone, otp },
    });
    onLoginSuccess(data);
  } catch (err) {
    els.loginError.textContent = err.message;
  }
});

function onLoginSuccess(data) {
  state.sessionToken = data.session_token;
  state.userId = data.user_id;
  state.identifier = data.identifier;
  setAuthedUI();
  hideModal(els.loginModalOverlay);
  resetLoginModalSteps();

  // If the user was mid-way through a cashback claim, resume it seamlessly.
  if (state.claimFlowActive) {
    els.claimPhoneInput.value = /^\d{10}$/.test(state.identifier) ? state.identifier : "";
    showModal(els.claimModalOverlay);
  }
}

function resetLoginModalSteps() {
  els.phoneStep1.hidden = false;
  els.phoneStep2.hidden = true;
  els.phoneInput.value = "";
  els.otpInput.value = "";
}

els.logoutBtn.addEventListener("click", async () => {
  try {
    await api("/auth/logout", { method: "POST", auth: true });
  } finally {
    state.sessionToken = null;
    state.userId = null;
    state.identifier = null;
    setGuestUI();
  }
});

els.deleteAccountBtn.addEventListener("click", async () => {
  if (!confirm("This permanently deletes your account and all claims. Continue?")) return;
  try {
    await api("/auth/delete-account", { method: "DELETE", auth: true });
  } finally {
    state.sessionToken = null;
    state.userId = null;
    state.identifier = null;
    setGuestUI();
  }
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
async function runSearch(query) {
  if (!query.trim()) return;

  els.heroSection.style.display = "none";
  els.headerSearch.hidden = false;
  els.headerSearchInput.value = query;
  els.resultsWrap.hidden = true;
  els.loadingSpinner.hidden = false;

  try {
    const data = await api("/api/search", { method: "POST", body: { query } });
    renderResults(data);
  } catch (err) {
    els.productGrid.innerHTML = `<p style="color:var(--text-muted)">Something went wrong: ${escapeHtml(err.message)}</p>`;
    els.resultsWrap.hidden = false;
  } finally {
    els.loadingSpinner.hidden = true;
  }
}

function renderResults(data) {
  els.resultsQueryLabel.textContent = `Results for "${data.query}"`;
  els.resultsCacheBadge.hidden = !data.cached;
  els.productGrid.innerHTML = "";

  data.results.forEach((product) => {
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <img src="${product.image_url}" alt="${escapeHtml(product.store)}" />
      <div class="product-title">${escapeHtml(product.title)}</div>
      <div class="price-row">
        <span class="price-now">₹${product.price.toLocaleString("en-IN")}</span>
        <span class="price-mrp">₹${product.mrp.toLocaleString("en-IN")}</span>
      </div>
      <div class="discount-tag">${product.discount_pct}% off</div>
      <div class="rating">⭐ ${product.rating} / 5</div>
      <button class="order-btn" data-store="${escapeHtml(product.store)}" data-url="${escapeHtml(product.store_url)}">
        Order at ${escapeHtml(product.store)}
      </button>
    `;
    els.productGrid.appendChild(card);
  });

  els.resultsWrap.hidden = false;

  // Wire up "Order at Store" buttons
  els.productGrid.querySelectorAll(".order-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleOrderClick(btn.dataset.url, btn.dataset.store));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

els.headerSearchBtn.addEventListener("click", () => runSearch(els.headerSearchInput.value));
els.heroSearchBtn.addEventListener("click", () => runSearch(els.heroSearchInput.value));
[els.headerSearchInput, els.heroSearchInput].forEach((input) => {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch(input.value);
  });
});

// ---------------------------------------------------------------------------
// Order click -> Cuelinks deep link + Diwali Dhamaka claim modal
// ---------------------------------------------------------------------------
async function handleOrderClick(rawUrl, store) {
  try {
    const { monetized_url } = await api("/generate-cuelink", {
      method: "POST",
      body: { url: rawUrl },
    });
    window.open(monetized_url, "_blank", "noopener");
  } catch (err) {
    console.error("Cuelinks generation failed, opening raw URL as fallback:", err);
    window.open(rawUrl, "_blank", "noopener");
  }

  // Simultaneously surface the cashback claim modal
  state.claimFlowActive = true;
  els.claimPlatformInput.value = store;
  els.claimFormView.hidden = false;
  els.claimSuccessView.hidden = true;
  els.claimError.textContent = "";
  els.claimOrderIdInput.value = "";

  if (isLoggedIn()) {
    els.claimPhoneInput.value = /^\d{10}$/.test(state.identifier) ? state.identifier : "";
    showModal(els.claimModalOverlay);
  } else {
    showModal(els.claimModalOverlay);
  }
}

// Intercept claim-form interaction for guests: trigger login the moment
// they actually try to use the form (no upfront warning).
[els.claimPhoneInput, els.claimOrderIdInput].forEach((field) => {
  field.addEventListener("focus", () => {
    if (!isLoggedIn()) {
      hideModal(els.claimModalOverlay);
      els.loginError.textContent = "";
      showModal(els.loginModalOverlay);
    }
  });
});

els.submitClaimBtn.addEventListener("click", async () => {
  els.claimError.textContent = "";

  if (!isLoggedIn()) {
    hideModal(els.claimModalOverlay);
    showModal(els.loginModalOverlay);
    return;
  }

  const phone = els.claimPhoneInput.value.trim();
  const orderId = els.claimOrderIdInput.value.trim();
  const platform = els.claimPlatformInput.value;

  if (!/^\d{10}$/.test(phone)) {
    els.claimError.textContent = "Enter a valid 10-digit WhatsApp number.";
    return;
  }
  if (!orderId) {
    els.claimError.textContent = "Store Order ID is required.";
    return;
  }

  try {
    await api("/submit-claim", {
      method: "POST",
      auth: true,
      body: { order_id: orderId, phone_number: phone, platform },
    });
    els.claimFormView.hidden = true;
    els.claimSuccessView.hidden = false;
    state.claimFlowActive = false;
  } catch (err) {
    els.claimError.textContent = err.message;
  }
});

// ---------------------------------------------------------------------------
// Legal modals
// ---------------------------------------------------------------------------
els.openTerms.addEventListener("click", () => {
  els.termsContent.hidden = false;
  els.privacyContent.hidden = true;
  showModal(els.legalModalOverlay);
});

els.openPrivacy.addEventListener("click", () => {
  els.privacyContent.hidden = false;
  els.termsContent.hidden = true;
  showModal(els.legalModalOverlay);
});

// ---------------------------------------------------------------------------
// Generic modal close handling
// ---------------------------------------------------------------------------
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => hideModal($(btn.dataset.close)));
});

document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) hideModal(overlay);
  });
});

// Initial UI state
setGuestUI();
