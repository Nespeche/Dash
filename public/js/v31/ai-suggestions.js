/* =============================================================================
   ai-suggestions.js — v31
   -----------------------------------------------------------------------------
   Reemplaza los quick-prompts estáticos del asistente IA por sugerencias
   contextuales basadas en los filtros activos del tablero.
   Funciona puramente en frontend: no requiere cambios en el backend.
   ============================================================================= */
(function () {
  "use strict";
  if (window.__v31AiSuggestions) return;
  window.__v31AiSuggestions = true;

  const MAX_DYNAMIC = 4;

  function getLabel(id) {
    const el = document.getElementById(id);
    if (!el) return "";
    if (el.tagName === "SELECT") {
      const opt = el.options[el.selectedIndex];
      return (opt?.text || "").trim();
    }
    return (el.value || el.textContent || "").trim();
  }

  function getValue(id) {
    return (document.getElementById(id)?.value || "").trim();
  }

  function buildDynamicPrompts() {
    const prompts = [];
    const coordLabel = getLabel("sCoord");
    const coordVal   = getValue("sCoord");
    const agenteLabel = getLabel("sAgte");
    const grupoLabel  = getLabel("sGrp");
    const marcaLabel  = getLabel("sMrc");
    const activeTab = document.querySelector(".tab.on")?.dataset?.tab || "detalle";
    const periodActive = getValue("fDesde") && getValue("fHasta");

    // Prompts según coordinador
    if (coordVal) {
      prompts.push(`¿Cómo va ${coordLabel || coordVal} vs 2025?`);
      prompts.push(`Top 5 clientes de ${coordLabel || coordVal}`);
      prompts.push(`¿Qué grupo de familia pesa más para ${coordLabel || coordVal}?`);
    }

    // Prompts según agente
    if (!coordVal && agenteLabel && agenteLabel !== "Todos") {
      prompts.push(`¿Cuántos kilos vendió ${agenteLabel} este mes?`);
      prompts.push(`¿Qué productos mueve más ${agenteLabel}?`);
    }

    // Prompts según grupo
    if (grupoLabel && grupoLabel !== "Todos") {
      prompts.push(`¿Cuál es el top de clientes en el grupo ${grupoLabel}?`);
      prompts.push(`¿Cómo viene el grupo ${grupoLabel} vs año anterior?`);
    }

    // Prompts según marca
    if (marcaLabel && marcaLabel !== "Todas") {
      prompts.push(`Top agentes de la marca ${marcaLabel}`);
    }

    // Prompts según pestaña activa
    if (activeTab === "proyeccion") {
      prompts.push(`Explicame la proyección actual en contexto de 2025`);
    } else if (activeTab === "resumen-acum" || activeTab === "acumulados") {
      prompts.push(`¿Qué clientes se perdieron respecto al año pasado?`);
    } else if (activeTab === "graficos") {
      prompts.push(`¿Cuál fue el mes con más ventas en 2026?`);
    }

    // Si no hay nada específico, usamos defaults útiles
    if (prompts.length === 0) {
      if (periodActive) {
        prompts.push(`Dame un resumen del período seleccionado`);
        prompts.push(`Top 5 clientes del período`);
      } else {
        prompts.push(`Comparame este mes con el mismo mes del año pasado`);
        prompts.push(`¿Cómo va el acumulado del año vs 2025?`);
      }
    }

    return [...new Set(prompts)].slice(0, MAX_DYNAMIC);
  }

  function bindPromptClick(btn, input) {
    btn.addEventListener("click", () => {
      input.value = btn.dataset.q || btn.textContent;
      input.focus();
    });
  }

  function renderDynamicBlock() {
    const quickHost = document.getElementById("aiQuick");
    if (!quickHost) return;
    const input = document.getElementById("aiInput");
    if (!input) return;

    // Eliminar bloque dinámico anterior
    quickHost.querySelectorAll(".ai-qbtn--dynamic").forEach(n => n.remove());

    const prompts = buildDynamicPrompts();
    if (!prompts.length) return;

    // Marcar el wrapper como que tiene dinámicos para el CSS
    quickHost.classList.toggle("ai-quick--has-dynamic", true);

    prompts.forEach(text => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-qbtn ai-qbtn--dynamic";
      btn.dataset.q = text;
      btn.textContent = text;
      bindPromptClick(btn, input);
      quickHost.appendChild(btn);
    });
  }

  // Re-renderizar cada vez que se abre el panel IA o cambian los filtros
  function boot() {
    const fab = document.getElementById("aiFab");
    const panel = document.getElementById("aiPanel");
    if (!fab || !panel) {
      // Reintentar cuando el asistente haya inyectado su markup
      window.setTimeout(boot, 600);
      return;
    }
    fab.addEventListener("click", () => {
      window.setTimeout(renderDynamicBlock, 80);
    });

    // Re-render al cambiar filtros relevantes (si el panel está abierto)
    ["sCoord", "sAgte", "sClie", "sGrp", "sMrc"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", () => {
        if (panel.classList.contains("open")) {
          window.setTimeout(renderDynamicBlock, 60);
        }
      });
    });

    // Re-render al cambiar tab
    document.querySelectorAll(".tab[data-tab]").forEach(tab => {
      tab.addEventListener("click", () => {
        if (panel.classList.contains("open")) {
          window.setTimeout(renderDynamicBlock, 60);
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
