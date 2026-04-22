export function createAuthStore(storageKey) {
  let authToken = "";

  return {
    get() {
      if (authToken) return authToken;
      try {
        authToken = String(sessionStorage.getItem(storageKey) || "");
      } catch (e) {
        console.warn("[auth-store] get falló:", e);
        authToken = "";
      }
      return authToken;
    },
    set(token) {
      authToken = String(token || "").trim();
      try {
        if (authToken) sessionStorage.setItem(storageKey, authToken);
        else sessionStorage.removeItem(storageKey);
      } catch (e) {
        console.warn("[auth-store] set falló:", e);
      }
      return authToken;
    },
    clear() {
      authToken = "";
      try {
        sessionStorage.removeItem(storageKey);
      } catch (e) {
        console.warn("[auth-store] clear falló:", e);
      }
      return authToken;
    }
  };
}

export function ensureAuthShell({ documentRef = document, el, styleId, onSubmit, onLogout }) {
  if (!documentRef || el("authOverlay")) return;


  documentRef.body.insertAdjacentHTML("beforeend", `
    <div class="auth-overlay" id="authOverlay" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="authOverlayTitle">
      <div class="auth-card">
        <div class="auth-title" id="authOverlayTitle">Ingresar a Ventas Dash</div>
        <div class="auth-sub">Accedé con el usuario y contraseña configurados en el Worker.</div>
        <form class="auth-form" id="authForm">
          <div class="auth-field">
            <label for="authMail">Usuario</label>
            <input id="authMail" type="email" autocomplete="username" placeholder="usuario@empresa.com" required />
          </div>
          <div class="auth-field">
            <label for="authPass">Contraseña</label>
            <input id="authPass" type="password" autocomplete="current-password" placeholder="••••••••" required />
          </div>
          <div class="auth-actions">
            <button class="auth-btn" id="authSubmit" type="submit">Ingresar</button>
            <div class="auth-msg" id="authMsg"></div>
          </div>
        </form>
      </div>
    </div>
  `);

  documentRef.getElementById("authForm")?.addEventListener("submit", onSubmit);

  const statusHost = documentRef.querySelector(".pill-status");
  if (statusHost && !documentRef.getElementById("authUserPill")) {
    const wrap = documentRef.createElement("div");
    wrap.id = "authUserPill";
    wrap.className = "auth-user-pill";
    wrap.hidden = true;
    wrap.innerHTML = `<strong id="authUserLabel"></strong><button type="button" class="auth-logout" id="authLogoutBtn">Salir</button>`;
    statusHost.insertAdjacentElement("afterend", wrap);
    wrap.querySelector("#authLogoutBtn")?.addEventListener("click", onLogout);
  }
}

export function setAuthMessage({ el, message = "", kind = "" }) {
  const node = el("authMsg");
  if (!node) return;
  node.textContent = message;
  node.className = `auth-msg${kind ? ` ${kind}` : ""}`;
}

function buildFocusTrap(overlay) {
  const focusable = () => Array.from(
    overlay.querySelectorAll("input, button, select, textarea, [tabindex]:not([tabindex='-1'])")
  ).filter(el => !el.disabled && !el.hidden);

  function handleKeydown(event) {
    if (event.key !== "Tab") return;
    const els = focusable();
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first) { event.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  return {
    activate() { overlay.addEventListener("keydown", handleKeydown); },
    deactivate() { overlay.removeEventListener("keydown", handleKeydown); }
  };
}

const _focusTrap = { instance: null, previousFocus: null };

export function showAuthOverlay({ el, ensureShell, message = "" }) {
  ensureShell();
  const overlay = el("authOverlay");
  if (overlay) {
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    _focusTrap.previousFocus = document.activeElement;
    _focusTrap.instance = buildFocusTrap(overlay);
    _focusTrap.instance.activate();
  }
  const input = el("authMail");
  if (input && !input.value) input.focus();
  setAuthMessage({ el, message: message || "Ingresá tus credenciales para continuar." });
}

export function hideAuthOverlay({ el }) {
  const overlay = el("authOverlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  setAuthMessage({ el, message: "" });
  if (_focusTrap.instance) {
    _focusTrap.instance.deactivate();
    _focusTrap.instance = null;
  }
  if (_focusTrap.previousFocus && typeof _focusTrap.previousFocus.focus === "function") {
    _focusTrap.previousFocus.focus();
    _focusTrap.previousFocus = null;
  }
}

export function updateAuthUserBadge({ el, user = "" }) {
  const pill = el("authUserPill");
  const label = el("authUserLabel");
  if (!pill || !label) return;
  const clean = String(user || "").trim();
  pill.hidden = !clean;
  label.textContent = clean ? `Usuario: ${clean}` : "";
}
