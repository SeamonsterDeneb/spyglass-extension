// ============================================================
// SPYGLASS CONTRAST CHECKER — v2.3.9.9
// ============================================================
import { minSizeForLc, fontMatrixWeightKeys } from "./apca-lookup.js";
import { APCAcontrast, sRGBtoY } from "apca-w3";
(function () {
  if (document.getElementById("contrast-checker-container")) return;

  // ─── CONSTANTS & SHARED STATE ─────────────────────────────
  const version = "2.3.9.9";
  // ─── IMAGE BACKGROUND ANALYZER ───────────────────────────
  class ImageBackgroundAnalyzer {
    constructor() {
      this.canvas = null;
      this.ctx = null;
    }

    initCanvas() {
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
      document.body.appendChild(this.canvas);
      this.canvas.style.cssText =
        "position:absolute;left:-9999px;top:-9999px;pointer-events:none;";
    }

    async analyzeContrastRange(element) {
      const backgroundInfo = this.findBackgroundElement(element);
      if (!backgroundInfo.element) return null;
      return await this.analyzeCompositeContrast(element, backgroundInfo);
    }

    findBackgroundElement(element) {
      let el = element;
      let depth = 0;
      const maxDepth = 10;
      const layers = [];
      while (el && depth < maxDepth) {
        const style = window.getComputedStyle(el);
        const bgImage = style.backgroundImage;
        const bgColor = style.backgroundColor;
        const hasGradient = bgImage && bgImage !== "none" && bgImage.includes("gradient");
        const hasImage = bgImage && bgImage !== "none" && bgImage.includes("url(");
        const hasColor = bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent";
        if (hasGradient || hasImage || hasColor) {
          layers.push({ element: el, backgroundImage: bgImage || "none",
            backgroundColor: bgColor || "transparent", hasGradient, hasImage, hasColor, depth });
        }
        if (el.tagName === "BODY" || el.tagName === "HTML") break;
        el = el.parentElement;
        depth++;
      }
      if (layers.length === 0) return { element: null, layers: [] };
      const primaryLayer = layers.find(l => l.hasImage) || layers.find(l => l.hasGradient) || layers[0];
      return { element: primaryLayer.element, backgroundImage: primaryLayer.backgroundImage,
        hasGradient: layers.some(l => l.hasGradient), hasImage: layers.some(l => l.hasImage), layers };
    }

    async analyzeCompositeContrast(textElement, backgroundInfo) {
      if (!this.canvas) this.initCanvas();
      const textColor = window.getComputedStyle(textElement).color;
      const textRgb = this.parseColor(textColor);
      const imageLayer = backgroundInfo.layers.find(l => l.hasImage);
      const sizingLayer = imageLayer || backgroundInfo.layers[0];
      const bgRect = sizingLayer.element.getBoundingClientRect();
      const textRect = textElement.getBoundingClientRect();
      this.canvas.width = bgRect.width;
      this.canvas.height = bgRect.height;
      const reversedLayers = [...backgroundInfo.layers].reverse();
      let baseBgColor = "rgb(255,255,255)";
      for (const layer of reversedLayers) {
        if (layer.hasColor) { baseBgColor = layer.backgroundColor; break; }
      }
      this.ctx.fillStyle = baseBgColor;
      this.ctx.fillRect(0, 0, bgRect.width, bgRect.height);
      for (const layer of reversedLayers) {
        if (!layer.hasImage) continue;
        const imageUrl = this.extractImageUrl(layer.backgroundImage);
        if (!imageUrl) continue;
        const img = await this.loadImage(imageUrl);
        if (!img) continue;
        const layerRect = layer.element.getBoundingClientRect();
        const offsetX = layerRect.left - bgRect.left;
        const offsetY = layerRect.top - bgRect.top;
        const imgAspect = img.width / img.height;
        const layerAspect = layerRect.width / layerRect.height;
        let drawWidth, drawHeight, drawX, drawY;
        if (imgAspect > layerAspect) {
          drawHeight = layerRect.height; drawWidth = drawHeight * imgAspect;
          drawX = offsetX + (layerRect.width - drawWidth) / 2; drawY = offsetY;
        } else {
          drawWidth = layerRect.width; drawHeight = drawWidth / imgAspect;
          drawX = offsetX; drawY = offsetY + (layerRect.height - drawHeight) / 2;
        }
        this.ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      }
      for (const layer of reversedLayers) {
        if (!layer.hasGradient) continue;
        const gradientColors = this.parseGradientColors(layer.backgroundImage);
        if (gradientColors.length < 2) continue;
        const layerRect = layer.element.getBoundingClientRect();
        const offsetX = layerRect.left - bgRect.left;
        const offsetY = layerRect.top - bgRect.top;
        const w = layerRect.width; const h = layerRect.height;
        const isRadial = layer.backgroundImage.toLowerCase().includes("radial-gradient");
        this.ctx.globalAlpha = this.extractGradientOpacity(layer.backgroundImage);
        if (isRadial) {
          const grad = this.resolveRadialGradient(layer.backgroundImage, gradientColors, offsetX, offsetY, w, h);
          if (grad) { this.ctx.fillStyle = grad; this.ctx.fillRect(offsetX, offsetY, w, h); }
        } else {
          const { x0, y0, x1, y1 } = this.resolveGradientPoints(layer.backgroundImage, offsetX, offsetY, w, h);
          const grad = this.ctx.createLinearGradient(x0, y0, x1, y1);
          const stepSize = 1 / (gradientColors.length - 1);
          gradientColors.forEach((c, i) => {
            const alpha = c.a !== undefined ? c.a : 1;
            grad.addColorStop(i * stepSize, `rgba(${c.r},${c.g},${c.b},${alpha})`);
          });
          this.ctx.fillStyle = grad; this.ctx.fillRect(offsetX, offsetY, w, h);
        }
        this.ctx.globalAlpha = 1.0;
      }
      const relativeX = textRect.left - bgRect.left;
      const relativeY = textRect.top - bgRect.top;
      const sampleX = Math.max(0, relativeX);
      const sampleY = Math.max(0, relativeY);
      const sampleWidth = Math.min(textRect.width, bgRect.width - sampleX);
      const sampleHeight = Math.min(textRect.height, bgRect.height - sampleY);
      if (sampleWidth <= 0 || sampleHeight <= 0) return null;
      let imageData;
      try {
        imageData = this.ctx.getImageData(sampleX, sampleY, sampleWidth, sampleHeight);
      } catch (e) {
        console.error("getImageData failed (CORS?):", e);
        return { type: "cors-blocked" };
      }
      const pixels = imageData.data;
      const samples = [];
      const COLS = Math.max(10, Math.min(50, Math.floor(sampleWidth)));
      const ROWS = Math.max(5, Math.min(20, Math.floor(sampleHeight)));
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const px = Math.floor((col / (COLS - 1)) * (sampleWidth - 1));
          const py = Math.floor((row / (ROWS - 1)) * (sampleHeight - 1));
          const idx = (py * Math.floor(sampleWidth) + px) * 4;
          if (pixels[idx + 3] > 128) {
            samples.push({ r: pixels[idx], g: pixels[idx + 1], b: pixels[idx + 2] });
          }
        }
      }
      if (samples.length === 0) return null;
      const contrasts = samples.map(bg => this.calculateContrast(textRgb, bg));
      return { type: "image", minContrast: Math.min(...contrasts), maxContrast: Math.max(...contrasts),
        avgContrast: contrasts.reduce((a, b) => a + b, 0) / contrasts.length,
        sampledPixels: samples, textColor: textRgb };
    }

    resolveRadialGradient(gradientCss, gradientColors, offsetX, offsetY, w, h) {
      let cx = offsetX + w / 2, cy = offsetY + h / 2;
      let r1 = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2);
      const atMatch = gradientCss.match(/at\s+([\w%.\s]+?)(?:\s*,)/i);
      if (atMatch) {
        const pos = atMatch[1].trim().split(/\s+/);
        const parsePos = (token, dimension) => {
          if (!token) return 0.5;
          if (token === "left" || token === "top") return 0;
          if (token === "right" || token === "bottom") return 1;
          if (token === "center") return 0.5;
          if (token.endsWith("%")) return parseFloat(token) / 100;
          if (token.endsWith("px")) return parseFloat(token) / dimension;
          return 0.5;
        };
        cx = offsetX + parsePos(pos[0], w) * w;
        cy = offsetY + parsePos(pos[1] || pos[0], h) * h;
      }
      const sizeMatch = gradientCss.match(/radial-gradient\s*\(\s*(ellipse|circle)?\s*(closest-side|closest-corner|farthest-side|farthest-corner)?/i);
      if (sizeMatch && sizeMatch[2]) {
        const keyword = sizeMatch[2].toLowerCase();
        const dx = cx - offsetX, dy = cy - offsetY;
        const dxFar = w - (cx - offsetX), dyFar = h - (cy - offsetY);
        if (keyword === "closest-side") r1 = Math.min(dx, dy, dxFar, dyFar);
        else if (keyword === "closest-corner") r1 = Math.sqrt(Math.min(dx, dxFar) ** 2 + Math.min(dy, dyFar) ** 2);
        else if (keyword === "farthest-side") r1 = Math.max(dx, dy, dxFar, dyFar);
        else r1 = Math.sqrt(Math.max(dx, dxFar) ** 2 + Math.max(dy, dyFar) ** 2);
      }
      r1 = Math.max(1, r1 || Math.sqrt((w / 2) ** 2 + (h / 2) ** 2));
      try {
        const grad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, r1);
        const stepSize = 1 / (gradientColors.length - 1);
        gradientColors.forEach((c, i) => {
          const alpha = c.a !== undefined ? c.a : 1;
          grad.addColorStop(i * stepSize, `rgba(${c.r},${c.g},${c.b},${alpha})`);
        });
        return grad;
      } catch (e) { console.warn("Could not create radial gradient:", e); return null; }
    }

    extractGradientOpacity(gradientCss) {
      const alphas = [];
      const rgbaRegex = /rgba\s*\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/g;
      let match;
      while ((match = rgbaRegex.exec(gradientCss)) !== null) alphas.push(parseFloat(match[1]));
      if (alphas.length === 0) return 1.0;
      const allSame = alphas.every(a => Math.abs(a - alphas[0]) < 0.01);
      return allSame ? alphas[0] : 1.0;
    }

    resolveGradientPoints(gradientCss, offsetX, offsetY, w, h) {
      let x0 = offsetX, y0 = offsetY + h / 2, x1 = offsetX + w, y1 = offsetY + h / 2;
      const toMatch = gradientCss.match(/linear-gradient\s*\(\s*to\s+([\w\s]+?)\s*,/i);
      if (toMatch) {
        const dir = toMatch[1].trim().toLowerCase();
        const toTop = dir.includes("top"), toBottom = dir.includes("bottom");
        const toLeft = dir.includes("left"), toRight = dir.includes("right");
        x0 = offsetX + (toRight ? 0 : toLeft ? w : w / 2);
        y0 = offsetY + (toBottom ? 0 : toTop ? h : h / 2);
        x1 = offsetX + (toRight ? w : toLeft ? 0 : w / 2);
        y1 = offsetY + (toBottom ? h : toTop ? 0 : h / 2);
        return { x0, y0, x1, y1 };
      }
      const angleMatch = gradientCss.match(/linear-gradient\s*\(\s*([\d.]+)(deg|turn|rad)\s*,/i);
      if (angleMatch) {
        let deg = parseFloat(angleMatch[1]);
        const unit = angleMatch[2].toLowerCase();
        if (unit === "turn") deg = deg * 360;
        if (unit === "rad") deg = deg * (180 / Math.PI);
        const rad = (deg - 90) * (Math.PI / 180);
        const lineLength = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
        const cx = offsetX + w / 2, cy = offsetY + h / 2;
        x0 = cx - (Math.cos(rad) * lineLength) / 2; y0 = cy - (Math.sin(rad) * lineLength) / 2;
        x1 = cx + (Math.cos(rad) * lineLength) / 2; y1 = cy + (Math.sin(rad) * lineLength) / 2;
        return { x0, y0, x1, y1 };
      }
      return { x0, y0, x1, y1 };
    }

    parseGradientColors(gradientCss) {
      const colors = [];
      const cssNoUrls = gradientCss.replace(/url\([^)]*\)/gi, "");
      const rgbRegex = /rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/g;
      let match;
      while ((match = rgbRegex.exec(cssNoUrls)) !== null) {
        colors.push({ r: Math.round(parseFloat(match[1])), g: Math.round(parseFloat(match[2])),
          b: Math.round(parseFloat(match[3])), a: match[4] !== undefined ? parseFloat(match[4]) : 1 });
      }
      const hexRegex = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
      while ((match = hexRegex.exec(cssNoUrls)) !== null) {
        const hex = match[1];
        if (hex.length === 3) {
          colors.push({ r: parseInt(hex[0]+hex[0],16), g: parseInt(hex[1]+hex[1],16), b: parseInt(hex[2]+hex[2],16) });
        } else {
          colors.push({ r: parseInt(hex.substr(0,2),16), g: parseInt(hex.substr(2,2),16), b: parseInt(hex.substr(4,2),16) });
        }
      }
      return colors;
    }

    extractImageUrl(backgroundImageCss) {
      const urlMatch = backgroundImageCss.match(/url\(['"]?([^'"()]+)['"]?\)/);
      if (urlMatch) {
        let url = urlMatch[1];
        if (url.startsWith("/")) url = window.location.origin + url;
        else if (!url.startsWith("http")) {
          const base = window.location.href.substring(0, window.location.href.lastIndexOf("/") + 1);
          url = base + url;
        }
        return url;
      }
      return null;
    }

    loadImage(url) {
      return new Promise(resolve => {
        const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => {
          const img2 = new Image();
          img2.onload = () => resolve(img2);
          img2.onerror = () => resolve(null);
          img2.src = url;
        };
        img.src = url;
      });
    }

    parseColor(colorString) {
      if (!colorString || colorString === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
      const rgbaMatch = colorString.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
      if (rgbaMatch) return { r: parseInt(rgbaMatch[1]), g: parseInt(rgbaMatch[2]),
        b: parseInt(rgbaMatch[3]), a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1 };
      if (colorString.startsWith("#")) {
        const hex = colorString.substring(1);
        if (hex.length === 3) return { r: parseInt(hex[0]+hex[0],16), g: parseInt(hex[1]+hex[1],16), b: parseInt(hex[2]+hex[2],16), a: 1 };
        if (hex.length === 6) return { r: parseInt(hex.substr(0,2),16), g: parseInt(hex.substr(2,2),16), b: parseInt(hex.substr(4,2),16), a: 1 };
        if (hex.length === 8) return { r: parseInt(hex.substr(0,2),16), g: parseInt(hex.substr(2,2),16),
          b: parseInt(hex.substr(4,2),16), a: parseInt(hex.substr(6,2),16)/255 };
        return null;
      }
      const tempDiv = document.createElement("div");
      tempDiv.style.color = colorString;
      document.body.appendChild(tempDiv);
      const computedColor = window.getComputedStyle(tempDiv).color;
      document.body.removeChild(tempDiv);
      const m = computedColor.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
      if (m) return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a: m[4] ? parseFloat(m[4]) : 1 };
      return null;
    }

    getLuminance(r, g, b) {
      const [rs, gs, bs] = [r, g, b].map(c => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    calculateContrast(rgb1, rgb2) {
      const lum1 = this.getLuminance(rgb1.r, rgb1.g, rgb1.b);
      const lum2 = this.getLuminance(rgb2.r, rgb2.g, rgb2.b);
      return (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
    }

    cleanup() {
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
      this.canvas = null; this.ctx = null;
    }
  }

  // Shared state — both panels read/write these
  let sharedFgHex = "#000000";
  let sharedBgHex = "#FFFFFF";
  let currentElement = null;
  let pixelAnalysisResult = null;
  let pixelAnalyzer = null;
  let isPixelAnalysisEnabled = false;

  // Picker state
  let isElementPicking = false;
  let activePicker = null; // "wcag" | "apca" — which side triggered the pick
  let lastHoveredElement = null;
  let hoverOverrideStyle = null;
  let isCheckingHoverState = false;

  // Per-panel state (indexed by side: "wcag" | "apca")
  const panelState = {
    wcag: { tweakTargetContrast: 4.5, detectedTextCategory: "normal", hasSelectedElement: false },
    apca: { tweakTargetContrast: 4.5, detectedTextCategory: "normal", hasSelectedElement: false },
  };

  // ─── HTML TEMPLATE FACTORY ────────────────────────────────
  // Builds the inner markup for one panel column.
  // All IDs are namespaced with the side prefix (e.g. "wcag-fg-color", "apca-fg-color")
  // so both columns can coexist in the DOM without collision.
  function buildPanelHTML(side) {
    const S = side; // short alias for readability in the template
    const isWcag = side === "wcag";
    const headerColor = isWcag ? "#1E40AF" : "#5B21B6";
    const headerBg = isWcag ? "#EFF6FF" : "#F5F3FF";
    const headerBorder = isWcag ? "#BFDBFE" : "#DDD6FE";
    const headerLabel = isWcag ? "WCAG" : "APCA";
    const pickerBg = isWcag ? "#14873D" : "#5B21B6";
    const pickerToggleBg = isWcag ? "#166534" : "#4C1D95";

    return `
      <div class="sg-panel ${isWcag ? '' : 'sg-panel--apca'}" id="${S}-panel">

      <!-- Panel header band -->
      <div class="sg-panel-header sg-panel-header--${S}">
        <span class="sg-panel-header__label sg-panel-header__label--${S}">${headerLabel}</span>
        <span class="sg-panel-header__sublabel sg-panel-header__sublabel--${S}">analysis</span>
        ${!isWcag ? `<select id="${S}-element-type-select" class="sg-panel-header__type-select sg-panel-header__type-select--apca">
          <option value="body">Body Text</option>
          <option value="content">Content Text</option>
          <option value="large">Large / Headlines</option>
          <option value="spot">Spot / Placeholder</option>
          <option value="ui">UI Component</option>
          <option value="nontext">Non-text Element</option>
        </select>` : ""}
      </div>

      <div id="${S}-panel-body" class="sg-panel-body">

        <!-- Color inputs -->
        <div class="sg-color-inputs">
          <!-- FG -->
          <div id="${S}-fg-container" class="sg-color-field">
            <label class="sg-color-field__label">Foreground</label>
            <div class="sg-color-field__row">
              <div class="sg-color-swatch-wrap">
                <div id="${S}-fg-swatch-btn" class="sg-color-swatch-btn" style="background:#000;"></div>
                <input type="color" id="${S}-fg-swatch" value="#000000" class="sg-color-swatch-input">
              </div>
              <div class="sg-color-input-wrap">
                <div class="sg-color-input-inner">
                  <input type="text" id="${S}-fg-color" value="#000000" class="sg-color-text-input">
                  <button id="${S}-copy-fg" title="Copy" class="sg-copy-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
                <div id="${S}-fg-suggestion" class="sg-suggestion-box">
                  <div id="${S}-fg-suggestion-swatch" class="sg-suggestion-swatch"></div>
                  <span id="${S}-fg-suggestion-label" class="sg-suggestion-label">4.5:1</span>
                </div>
              </div>
            </div>
          </div>
          <!-- Swap -->
          <div class="sg-swap-btn">
            <button id="${S}-swap-btn" title="Swap colors" style="background:none;border:none;padding:0;cursor:pointer;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sg-swap-icon"><path d="M17 3v18M7 21V3M4 7l3-3 3 3M20 17l-3 3-3-3"/></svg>
            </button>
          </div>
          <!-- BG -->
          <div id="${S}-bg-container" class="sg-color-field">
            <label class="sg-color-field__label">Background</label>
            <div class="sg-color-field__row">
              <div class="sg-color-swatch-wrap">
                <div id="${S}-bg-swatch-btn" class="sg-color-swatch-btn" style="background:#fff;"></div>
                <input type="color" id="${S}-bg-swatch" value="#ffffff" class="sg-color-swatch-input">
              </div>
              <div class="sg-color-input-wrap">
                <div class="sg-color-input-inner">
                  <input type="text" id="${S}-bg-color" value="#FFFFFF" class="sg-color-text-input">
                  <button id="${S}-copy-bg" title="Copy" class="sg-copy-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
                <div id="${S}-bg-suggestion" class="sg-suggestion-box">
                  <div id="${S}-bg-suggestion-swatch" class="sg-suggestion-swatch"></div>
                  <span id="${S}-bg-suggestion-label" class="sg-suggestion-label">4.5:1</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Tweak panel -->
        <details id="${S}-tweak-details" class="sg-tweak-details">
          <summary class="sg-tweak-summary">
            <span>🎨 Tweak Panel</span>
          </summary>          <div id="${S}-tweak-panel" class="sg-tweak-panel">
            <div class="sg-tweak-panel__header">
              <button id="${S}-tweak-target-btn" class="sg-tweak-panel__target-btn">Target: 4.5:1</button>
              <button id="${S}-pixel-analysis-btn" class="sg-tweak-panel__pixel-btn">Pixel: OFF</button>
              <span class="sg-tweak-panel__title">Tweak Colors</span>
            </div>
            <div class="sg-tweak-panel__controls">
              <div class="sg-tweak-panel__row">
                <div class="sg-tweak-panel__row-label">Foreground</div>
                <div id="${S}-fg-tweak-controls"></div>
              </div>
              <div class="sg-tweak-panel__row">
                <div class="sg-tweak-panel__row-label">Background</div>
                <div id="${S}-bg-tweak-controls"></div>
              </div>
            </div>
          </div>
        </details>

        <!-- Preview + contrast details -->
        <details id="${S}-preview-details" class="sg-preview-details" open>
          <summary id="${S}-preview-summary" class="sg-preview-summary">
            <span id="${S}-mini-preview-text" class="sg-preview-summary__text">Preview</span>
            <span id="${S}-mini-ratio-pill" class="sg-preview-summary__pill">21.00:1</span>
          </summary>
          <div class="sg-preview-details__body">
            <div role="tablist" class="sg-tabs-row">
              <button id="${S}-tab-btn-preview" role="tab" aria-selected="true" class="sg-tab sg-tab-active">Preview</button>
              <button id="${S}-tab-btn-details" role="tab" aria-selected="false" class="sg-tab sg-tab-inactive">
                <span id="${S}-contrast-ratio-display" style="font-size:1.3em;font-weight:900;display:block;line-height:1.1;">21.00:1</span>
                <span style="display:block;font-size:0.7rem;line-height:1.2;">Details</span>
              </button>
            </div>
            <div id="${S}-tab-content-area" class="sg-tab-content-area">

              <!-- Preview pane -->
              <div id="${S}-tab-panel-preview" role="tabpanel" class="sg-preview-pane">
                <h4 class="sg-preview-pane__heading">Preview Text</h4>
                <p id="${S}-preview-line-normal" class="sg-preview-pane__normal">The quick brown fox jumps over the lazy dog. <span id="${S}-preview-status-normal"></span></p>
                <p id="${S}-preview-line-large" class="sg-preview-pane__large">The quick brown fox jumps over the lazy dog. <span id="${S}-preview-status-large"></span></p>
              </div>

              <!-- Details pane -->
              <div id="${S}-tab-panel-details" role="tabpanel" class="sg-details-pane">

                <!-- WCAG grid -->
                <div id="${S}-wcag-details-grid" style="display:${isWcag ? 'grid' : 'none'};" class="sg-wcag-grid">
                  <div>
                    <div class="sg-wcag-grid__heading">AA</div>
                    <div class="sg-wcag-grid__row"><span>Normal (4.5:1):</span><span id="${S}-status-aa-normal" style="font-weight:700;">Pass</span></div>
                    <div class="sg-wcag-grid__row"><span>Large (3:1):</span><span id="${S}-status-aa-large" style="font-weight:700;">Pass</span></div>
                    <div class="sg-wcag-grid__note">(24px+ or 19px+ bold)</div>
                    <div class="sg-wcag-grid__row"><span>Graphics (3:1):</span><span id="${S}-status-aa-graphics" style="font-weight:700;">Pass</span></div>
                  </div>
                  <div>
                    <div class="sg-wcag-grid__heading">AAA</div>
                    <div class="sg-wcag-grid__row"><span>Normal (7:1):</span><span id="${S}-status-aaa-normal" style="font-weight:700;">Pass</span></div>
                    <div class="sg-wcag-grid__row"><span>Large (4.5:1):</span><span id="${S}-status-aaa-large" style="font-weight:700;">Pass</span></div>
                    <div class="sg-wcag-grid__note">(24px+ or 19px+ bold)</div>
                  </div>
                </div>

                <!-- APCA panel -->
                <div id="${S}-apca-details-panel" style="display:${isWcag ? 'none' : 'block'};">
                  <div class="sg-apca-header">
                    <span class="sg-apca-title">APCA Requirements (Bronze)</span>
                    <span id="${S}-apca-status"></span>
                  </div>
                  <table id="${S}-apca-table" class="apca-table">
                    <thead>
                      <tr>
                        <th class="apca-th apca-th-left">Property</th>
                        <th class="apca-th">Detected</th>
                        <th class="apca-th">Proposed</th>
                        <th class="apca-th">Recommendation</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td class="apca-td apca-label">Size</td>
                        <td class="apca-td apca-detected" id="${S}-apca-font-size">-</td>
                        <td class="apca-td apca-needed" id="${S}-apca-needed-size">-</td>
                        <td class="apca-td apca-rec" id="${S}-apca-rec-size">—</td>
                      </tr>
                      <tr>
                        <td class="apca-td apca-label">Weight</td>
                        <td class="apca-td apca-detected" id="${S}-apca-font-weight">-</td>
                        <td class="apca-td apca-needed" id="${S}-apca-needed-weight">-</td>
                        <td class="apca-td apca-rec" id="${S}-apca-rec-weight">—</td>
                      </tr>
                      <tr>
                        <td class="apca-td apca-label">Color</td>
                        <td class="apca-td apca-detected" id="${S}-apca-color-detected">-</td>
                        <td class="apca-td" id="${S}-apca-color-needed">-</td>
                        <td class="apca-td apca-rec sg-rec-cell" id="${S}-apca-color-rec">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

              </div>
            </div>
          </div>
        </details>

        <!-- Pickers -->
        <div class="sg-pickers">
          <div class="sg-pickers__row">
            <button id="${S}-activate-element-picker-btn" class="sg-pickers__element-btn sg-pickers__element-btn--${S}">
              Element Picker
            </button>
            <button id="${S}-element-picker-mode-toggle" class="sg-pickers__mode-btn sg-pickers__mode-btn--${S}">
              Resting
            </button>
          </div>
          <button id="${S}-activate-overlay-picker-btn" class="sg-pickers__overlay-btn">
            Overlay Picker<span class="sg-pickers__overlay-sublabel">(pixel analysis)</span>
          </button>
        </div>

        <div id="${S}-picker-status" class="sg-picker-status"></div>

      </div><!-- end panel-body -->
    </div><!-- end sg-panel -->
    `;
  }

  // ─── OUTER CONTAINER HTML ─────────────────────────────────
  // The top drag handle spans full width; below it the two panel columns sit side by side.
  // In single-panel mode (WCAG or APCA only) the container is 26rem wide and only one
  // column is visible. In Unified mode it stretches to hold both columns.
  const outerHTML = `
    <!-- Full-width drag handle / title bar -->
    <div id="drag-handle" class="sg-drag-handle">
      <div class="sg-drag-handle__top">
        <h3 class="sg-drag-handle__title">
          <img src="SPYGLASS_ICON_URL_PLACEHOLDER" alt="" class="sg-drag-handle__icon">
          Spyglass Contrast Checker (v${version})
        </h3>
        <div style="display: flex; gap: 8px; align-items: center; margin-left: auto;">
                <button id="save-analysis-btn" class="sg-save-btn">💾 Save</button>
                <button id="download-csv-btn" class="sg-save-btn">📊 CSV</button>
                <button id="close-checker-btn" class="sg-drag-handle__close">✕</button>
            </div>
      </div>
      <div class="sg-drag-handle__modes">
        <span class="spyglass-algo-label">Mode:</span>
        <label class="spyglass-algo-option"><input type="radio" name="contrast-algorithm" id="algo-wcag" value="wcag" checked> WCAG</label>
        <label class="spyglass-algo-option"><input type="radio" name="contrast-algorithm" id="algo-apca" value="apca"> APCA</label>
        <label class="spyglass-algo-option"><input type="radio" name="contrast-algorithm" id="algo-unified" value="unified"> Unified</label>
      </div>
    </div>

    <!-- Two-column body -->
    <div id="panels-row" class="sg-panels-row">
      ${buildPanelHTML("wcag")}
      ${buildPanelHTML("apca")}
    </div>

    <!-- Footer -->
    <div class="sg-footer">
      Created by <a href="https://seamonsterstudios.com" target="_blank" rel="noopener" style="color:#6B7280;text-decoration:underline !important;">SeaMonster Studios</a>
    </div>
  `;

  // ─── INJECT CONTAINER ─────────────────────────────────────
  const container = document.createElement("div");
  container.id = "contrast-checker-container";
  container.style.cssText = [
    "width:27rem",                    // single-panel default; widens to ~54rem in Unified
    "background-color:white",
    "border-radius:0.5rem",
    "border:1px solid #E5E7EB",
    "box-shadow:0 10px 15px -3px rgba(0,0,0,0.1),0 4px 6px -2px rgba(0,0,0,0.05)",
    "position:fixed",
    "top:20px",
    "left:20px",
    "z-index:2147483647",
    "display:flex",
    "flex-direction:column",
    "max-height:calc(100vh - 40px)",
    "transition:width 0.25s ease",
  ].join(";");

  const finalHTML = outerHTML.replace("SPYGLASS_ICON_URL_PLACEHOLDER", chrome.runtime.getURL("icon-128.png"));
  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(finalHTML, "text/html");
  while (parsedDoc.body.firstChild) container.appendChild(parsedDoc.body.firstChild);
  document.body.appendChild(container);


  // ─── MATH & COLOR HELPERS ─────────────────────────────────

  function hexToRgba(hex) {
    if (!hex) return null;
    if (hex.length === 9) {
      const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return r ? { r: parseInt(r[1],16), g: parseInt(r[2],16), b: parseInt(r[3],16), a: parseInt(r[4],16)/255 } : null;
    }
    hex = hex.replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i, (m,r,g,b) => r+r+g+g+b+b);
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? { r: parseInt(r[1],16), g: parseInt(r[2],16), b: parseInt(r[3],16), a: 1 } : null;
  }

  function rgbaStringToHex(rgba) {
    const parts = rgba.substring(rgba.indexOf("(")+1, rgba.lastIndexOf(")")).split(/,\s*/);
    if (parts.length < 3) return "#000000";
    const r = parseInt(parts[0]), g = parseInt(parts[1]), b = parseInt(parts[2]);
    let a = parts.length === 4 ? parseFloat(parts[3]) : 1;
    const alphaHex = Math.round(a*255).toString(16).padStart(2,"0").toUpperCase();
    const base = "#" + ((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1).toUpperCase();
    return alphaHex === "FF" ? base : base + alphaHex;
  }

  function rgbToHex(r, g, b) {
    return "#" + ((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1).toUpperCase();
  }

  function blendRgb(topRgba, bottomRgba) {
    const tA = topRgba.a !== undefined ? topRgba.a : 1;
    const bA = bottomRgba.a !== undefined ? bottomRgba.a : 1;
    if (tA === 1) return { r: topRgba.r, g: topRgba.g, b: topRgba.b, a: 1 };
    if (tA === 0) return { r: bottomRgba.r, g: bottomRgba.g, b: bottomRgba.b, a: bA };
    const outA = tA + bA * (1 - tA);
    if (outA === 0) return { r:0, g:0, b:0, a:0 };
    return {
      r: Math.round((topRgba.r*tA + bottomRgba.r*bA*(1-tA)) / outA),
      g: Math.round((topRgba.g*tA + bottomRgba.g*bA*(1-tA)) / outA),
      b: Math.round((topRgba.b*tA + bottomRgba.b*bA*(1-tA)) / outA),
      a: outA,
    };
  }

  function getLuminance(r, g, b) {
    const a = [r,g,b].map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); });
    return a[0]*0.2126 + a[1]*0.7152 + a[2]*0.0722;
  }

  function getContrast(rgb1, rgb2) {
    const l1 = getLuminance(rgb1.r,rgb1.g,rgb1.b), l2 = getLuminance(rgb2.r,rgb2.g,rgb2.b);
    return (Math.max(l1,l2)+0.05) / (Math.min(l1,l2)+0.05);
  }

  function getAPCAContrast(fg, bg) {
    const fgY = sRGBtoY([fg.r, fg.g, fg.b]);
    const bgY = sRGBtoY([bg.r, bg.g, bg.b]);
    return Math.abs(APCAcontrast(fgY, bgY));
  }

  // ─── NATIVE COLOR PICKER ───────────────────────────────────
  async function pickColorNative() {
    if (!window.EyeDropper) return null;
    const eyeDropper = new EyeDropper();
    try {
      const result = await eyeDropper.open();
      return result.sRGBHex.toUpperCase();
    } catch (e) {
      return null; // User canceled (Esc)
    }
  }

  // ─── SAVE ANALYSIS DATA ───────────────────────────────────
  function saveAnalysis() {
    // Helper to grab text from the "apca" side table cells
    const getApcaText = (id) => document.getElementById(`apca-apca-${id}`)?.textContent?.trim() || "N/A";
    
    // Helper specifically for the Color Rec cell (to handle the Hex Pill text)
    const getColorRec = () => {
      const pill = document.querySelector("#apca-apca-color-rec .sg-hex-pill span:last-child");
      return pill ? pill.textContent : getApcaText("color-rec");
    };

    // Get individual recs to build the balanced string
    const sRec = getApcaText("rec-size");
    const wRec = getApcaText("rec-weight");
    const cRec = getColorRec();
    
    // Logic: If all pass, show ✓. Otherwise, combine Size / Weight / Color.
    const balancedString = (sRec === "✓" && wRec === "✓" && cRec === "✓") ? "✓" : `${sRec} / ${wRec} / ${cRec}`;

    const analysis = {
      timestamp: new Date().toLocaleString(),
      url: window.location.href,
      pageTitle: document.title,
      colors: { foreground: sharedFgHex, background: sharedBgHex },
      results: {
        wcag: getRefs("wcag").contrastRatioDisplay.textContent,
        apcaLc: getRefs("apca").contrastRatioDisplay.textContent.replace('Lc ', ''),
        detected: {
          size: getApcaText("font-size"),
          weight: getApcaText("font-weight"),
          color: sharedFgHex,
          combo: `${getApcaText("font-size")} / ${getApcaText("font-weight")} / ${sharedFgHex}`
        },
        recommendations: {
          sizeMod: sRec,
          weightMod: wRec,
          colorMod: getColorRec(),
          balanced: balancedString
        }
      }
    };

    chrome.storage.local.get({ spyglass_history: [] }, (data) => {
      const history = data.spyglass_history;
      history.push(analysis);
      chrome.storage.local.set({ spyglass_history: history }, () => {
        const btn = document.getElementById("save-analysis-btn");
        if (btn) {
          const oldText = btn.textContent;
          btn.textContent = "✅ Saved";
          btn.style.background = "#dcfce7";
          setTimeout(() => { 
            btn.textContent = oldText; 
            btn.style.background = ""; 
          }, 1500);
        }
      });
    });
  }

  function rgbaToHsl(rgba) {
    const r=rgba.r/255, g=rgba.g/255, b=rgba.b/255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h, s; const l=(max+min)/2;
    if (max===min) { h=s=0; } else {
      const d=max-min; s=l>0.5 ? d/(2-max-min) : d/(max+min);
      switch(max) {
        case r: h=((g-b)/d+(g<b?6:0))/6; break;
        case g: h=((b-r)/d+2)/6; break;
        case b: h=((r-g)/d+4)/6; break;
      }
    }
    return { h, s, l, a: rgba.a !== undefined ? rgba.a : 1 };
  }

  function hslToRgba(hsl) {
    const {h,s,l,a} = hsl; let r,g,b;
    if (s===0) { r=g=b=l; } else {
      const hue2rgb = (p,q,t) => {
        if(t<0)t+=1; if(t>1)t-=1;
        if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q;
        if(t<2/3)return p+(q-p)*(2/3-t)*6; return p;
      };
      const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
      r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3);
    }
    return { r:Math.round(r*255), g:Math.round(g*255), b:Math.round(b*255), a: a!==undefined?a:1 };
  }

  function getElementBackgroundColor(element) {
    let el = element;
    while (el) {
      const style = window.getComputedStyle(el);
      const bgColor = style.backgroundColor;
      if (bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent") return bgColor;
      const beforeBg = window.getComputedStyle(el,"::before").backgroundColor;
      if (beforeBg && beforeBg !== "rgba(0, 0, 0, 0)" && beforeBg !== "transparent") return beforeBg;
      const afterBg = window.getComputedStyle(el,"::after").backgroundColor;
      if (afterBg && afterBg !== "rgba(0, 0, 0, 0)" && afterBg !== "transparent") return afterBg;
      if (el.tagName === "BODY" || el.tagName === "HTML") return "rgba(255,255,255,1)";
      el = el.parentElement;
    }
    return "rgba(255,255,255,1)";
  }

  function getFlattenedBackgroundColor(element) {
    let el = element;
    let currentColor = { r: 255, g: 255, b: 255, a: 1 }; // Default fallback (White)
    const layers = [];

    // 1. Collect all layers that have a color
    while (el) {
      const style = window.getComputedStyle(el);
      const bg = style.backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        layers.push(bg);
      }
      if (el.tagName === "BODY" || el.tagName === "HTML") break;
      el = el.parentElement;
    }

    // 2. Blend the layers from top to bottom
    // We start with white and blend layers on top of it in reverse order
    let finalRgba = { r: 255, g: 255, b: 255, a: 1 }; 
    
    [...layers].reverse().forEach(rgbaString => {
      const parts = rgbaString.match(/[\d.]+/g);
      if (parts) {
        const layerRgba = {
          r: parseInt(parts[0]),
          g: parseInt(parts[1]),
          b: parseInt(parts[2]),
          a: parts[3] !== undefined ? parseFloat(parts[3]) : 1
        };
        finalRgba = blendRgb(layerRgba, finalRgba);
      }
    });

    return `rgba(${finalRgba.r}, ${finalRgba.g}, ${finalRgba.b}, 1)`;
  }

  function generatePreviewGradient(pixelResult) {
    let colors = [];
    if (pixelResult.type==="image" && Array.isArray(pixelResult.sampledPixels) && pixelResult.sampledPixels.length>0)
      colors = pixelResult.sampledPixels;
    else if (pixelResult.type==="gradient" && Array.isArray(pixelResult.colors) && pixelResult.colors.length>0)
      colors = pixelResult.colors;
    if (colors.length===0) return null;
    const withLum = colors.map(c => ({c, lum: getLuminance(c.r,c.g,c.b)}));
    withLum.sort((a,b) => a.lum-b.lum);
    const darkestOverall=withLum[0].c, lightestOverall=withLum[withLum.length-1].c;
    const buckets = {r:[],g:[],b:[]};
    colors.forEach(c => {
      const max=Math.max(c.r,c.g,c.b); if(max===0)return;
      if(c.r===max)buckets.r.push(c); else if(c.g===max)buckets.g.push(c); else buckets.b.push(c);
    });
    function channelExtremes(bucket) {
      if(bucket.length===0) return {light:lightestOverall,dark:darkestOverall};
      const sorted=bucket.slice().sort((a,b)=>getLuminance(a.r,a.g,a.b)-getLuminance(b.r,b.g,b.b));
      return {light:sorted[sorted.length-1],dark:sorted[0]};
    }
    const red=channelExtremes(buckets.r), green=channelExtremes(buckets.g), blue=channelExtremes(buckets.b);
    const stops=[darkestOverall,lightestOverall,red.light,red.dark,green.light,green.dark,blue.light,blue.dark,darkestOverall]
      .map(c=>rgbToHex(c.r,c.g,c.b));
    const pct=stops.map((hex,i)=>`${hex} ${Math.round(i/(stops.length-1)*100)}%`).join(", ");
    return `linear-gradient(to right, ${pct})`;
  }

  // ─── APCA LOOKUP TABLE ────────────────────────────────────
  // Shared by both panel renderers
  const apcaThresholds = {
    10:  {400:100,500:100,600:90,700:80,800:80,900:80},
    12:  {300:100,400:90,500:75,600:70,700:60,800:60,900:60},
    14:  {300:90,400:75,500:70,600:60,700:55,800:55,900:55},
    16:  {200:100,300:75,400:70,500:60,600:55,700:50,800:50,900:50},
    18:  {200:90,300:70,400:65,500:55,600:50,700:45,800:45,900:45},
    24:  {200:75,300:60,400:60,500:50,600:45,700:40,800:40,900:40},
    36:  {200:60,300:50,400:50,500:45,600:40,700:35,800:35,900:35},
    48:  {200:50,300:45,400:45,500:40,600:35,700:30,800:30,900:30},
    96:  {200:40,300:38,400:38,500:35,600:30,700:25,800:25,900:25},
  };
  const apcaWeightKeys = [200,300,400,500,600,700,800,900];

  // ─── ELEMENT TYPE ADVISORY ────────────────────────────────
  // Purely informational — does not affect pass/fail calculations.
  // These are APCA's general guidance levels for each use case.
  const elementTypeAdvisory = {
    body:    { lc: 75, label: "Body Text",        note: "Recommended Lc 75+ for fluent reading", definition: "Main text for long-form reading. High contrast is required to prevent eye strain during extended reading sessions." },
    content: { lc: 60, label: "Content Text",       note: "Recommended Lc 60+ for readable non-body text", definition: "Standard text like descriptions or short paragraphs. It needs to be clearly legible but isn't as demanding as body text." },
    large:   { lc: 45, label: "Large / Headlines",  note: "Recommended Lc 45+ for large or bold text", definition: "Text over 24px (or 18px bold). Because the letters are physically larger, they remain readable at lower contrast levels." },
    spot:    { lc: 30, label: "Spot / Placeholder", note: "Recommended Lc 30+ for spot-readable text", definition: "Non-essential text like copyright lines, search placeholders, or disabled fields. Not intended for reading more than a few words." },
    ui:      { lc: 30, label: "UI Component",       note: "Recommended Lc 30+ for icons and UI elements", definition: "Interface elements like buttons or icons. Needs enough contrast to be identifiable as an interactive object." },
    nontext: { lc: 15, label: "Non-text Element",   note: "Recommended Lc 15+ for dividers and borders", definition: "Decorative elements like thin borders or dividers that help organize the layout without being essential to read." },
  };

  function autoDetectElementType(sizePx, weightNum) {
    // Large or heavy text → headline
    if (sizePx >= 36 || (sizePx >= 24 && weightNum >= 700)) return "large";
    // Meets APCA body text minimums: 24px/300, 18px/400, 16px/500, 14px/700
    if ((sizePx >= 24 && weightNum >= 300) || (sizePx >= 18 && weightNum >= 400) ||
        (sizePx >= 16 && weightNum >= 500) || (sizePx >= 14 && weightNum >= 700)) return "body";
    // Meets content text minimums: 24px/400, 21px/500, 18px/600, 16px/700
    if ((sizePx >= 24 && weightNum >= 400) || (sizePx >= 21 && weightNum >= 500) ||
        (sizePx >= 18 && weightNum >= 600) || (sizePx >= 16 && weightNum >= 700)) return "content";
    return "spot";
  }
  // ─── DOM REFS HELPER ──────────────────────────────────────
  // Returns an object of all namespaced DOM references for a given side.
  function getRefs(side) {
    const g = id => document.getElementById(`${side}-${id}`);
    return {
      fgColorInput:        g("fg-color"),
      bgColorInput:        g("bg-color"),
      fgSwatch:            g("fg-swatch"),
      bgSwatch:            g("bg-swatch"),
      fgSwatchBtn:         g("fg-swatch-btn"),
      bgSwatchBtn:         g("bg-swatch-btn"),
      fgSuggestionBox:     g("fg-suggestion"),
      bgSuggestionBox:     g("bg-suggestion"),
      fgSuggestionSwatch:  g("fg-suggestion-swatch"),
      bgSuggestionSwatch:  g("bg-suggestion-swatch"),
      fgSuggestionLabel:   g("fg-suggestion-label"),
      bgSuggestionLabel:   g("bg-suggestion-label"),
      swapBtn:             g("swap-btn"),
      tweakTargetBtn:      g("tweak-target-btn"),
      pixelAnalysisBtn:    g("pixel-analysis-btn"),
      fgTweakControls:     g("fg-tweak-controls"),
      bgTweakControls:     g("bg-tweak-controls"),
      previewSummary:      g("preview-summary"),
      miniPreviewText:     g("mini-preview-text"),
      miniRatioPill:       g("mini-ratio-pill"),
      tabPreviewBtn:       g("tab-btn-preview"),
      tabDetailsBtn:       g("tab-btn-details"),
      panelPreview:        g("tab-panel-preview"),
      panelDetails:        g("tab-panel-details"),
      contrastRatioDisplay:g("contrast-ratio-display"),
      wcagDetailsGrid:     g("wcag-details-grid"),
      apcaDetailsPanel:    g("apca-details-panel"),
      previewLineNormal:   g("preview-line-normal"),
      previewLineLarge:    g("preview-line-large"),
      previewStatusNormal: g("preview-status-normal"),
      previewStatusLarge:  g("preview-status-large"),
      apcaStatus:          g("apca-status"),
      apcaFontSize:        g("apca-font-size"),
      apcaFontWeight:      g("apca-font-weight"),
      apcaNeededSize:      g("apca-needed-size"),
      apcaNeededWeight:    g("apca-needed-weight"),
      apcaRecSize:         g("apca-rec-size"),
      apcaRecWeight:       g("apca-rec-weight"),
      statusAaNormal:      g("status-aa-normal"),
      statusAaLarge:       g("status-aa-large"),
      statusAaGraphics:    g("status-aa-graphics"),
      statusAaaNormal:     g("status-aaa-normal"),
      statusAaaLarge:      g("status-aaa-large"),
      pickerStatus:        g("picker-status"),
      elementPickerBtn:    g("activate-element-picker-btn"),
      overlayPickerBtn:    g("activate-overlay-picker-btn"),
      modeToggleBtn:       g("element-picker-mode-toggle"),
      panelBody:           g("panel-body"),
    };
  }

  // ─── UNIFIED MODE ─────────────────────────────────────────
  function getAlgoMode() {
    if (document.getElementById("algo-unified").checked) return "unified";
    if (document.getElementById("algo-apca").checked) return "apca";
    return "wcag";
  }

  function applyAlgoMode() {
    const mode = getAlgoMode();
    const wcagPanel = document.getElementById("wcag-panel");
    const apcaPanel = document.getElementById("apca-panel");

    if (mode === "unified") {
      container.classList.add("sg-unified");
      wcagPanel.style.display = "flex";
      apcaPanel.style.display = "flex";
    } else if (mode === "apca") {
      container.classList.remove("sg-unified");
      wcagPanel.style.display = "none";
      apcaPanel.style.display = "flex";
      container.style.width = "27rem";
    } else {
      // wcag
      container.classList.remove("sg-unified");
      wcagPanel.style.display = "flex";
      apcaPanel.style.display = "none";
      container.style.width = "27rem";
    }
  }

  // ─── SUGGESTION SWATCH HELPERS ────────────────────────────
  function setSwatchXIcon(swatchEl) {
    swatchEl.textContent = "";
    const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("width","14"); svg.setAttribute("height","14");
    svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("fill","none");
    svg.setAttribute("stroke","#dc2626"); svg.setAttribute("stroke-width","3");
    svg.setAttribute("stroke-linecap","round"); svg.setAttribute("stroke-linejoin","round");
    const l1 = document.createElementNS("http://www.w3.org/2000/svg","line");
    l1.setAttribute("x1","18"); l1.setAttribute("y1","6"); l1.setAttribute("x2","6"); l1.setAttribute("y2","18");
    const l2 = document.createElementNS("http://www.w3.org/2000/svg","line");
    l2.setAttribute("x1","6"); l2.setAttribute("y1","6"); l2.setAttribute("x2","18"); l2.setAttribute("y2","18");
    svg.appendChild(l1); svg.appendChild(l2); swatchEl.appendChild(svg);
  }

  // ─── LUMINANCE ADJUSTMENT (WCAG) ─────────────────────────
  function adjustLuminance(hexWithAlpha, targetContrast, otherHexWithAlpha, isAdjustingForeground) {
    const colorRgba = hexToRgba(hexWithAlpha);
    const otherRgba = hexToRgba(otherHexWithAlpha);
    if (!colorRgba || !otherRgba) return "#FF0000";
    const baseWhite = {r:255,g:255,b:255,a:1};
    let startRgb = {...colorRgba};

    function checkContrast(mixRgb) {
      if (isAdjustingForeground) {
        const solidBg = blendRgb(otherRgba, baseWhite);
        return getContrast(blendRgb(mixRgb, solidBg), solidBg);
      } else {
        const solidBg = blendRgb(mixRgb, baseWhite);
        return getContrast(blendRgb(otherRgba, solidBg), solidBg);
      }
    }

    if (checkContrast(startRgb) >= targetContrast) return rgbToHex(startRgb.r,startRgb.g,startRgb.b);

    const lumWhite = checkContrast({r:255,g:255,b:255,a:startRgb.a});
    const lumBlack = checkContrast({r:0,g:0,b:0,a:startRgb.a});
    const firstTryMixer  = lumWhite>lumBlack ? {r:255,g:255,b:255,a:1} : {r:0,g:0,b:0,a:1};
    const secondTryMixer = lumWhite>lumBlack ? {r:0,g:0,b:0,a:1} : {r:255,g:255,b:255,a:1};

    function findMix(mixer) {
      for (let i=0; i<=100; i++) {
        const t=i/100;
        const newRgb = { r:Math.round(startRgb.r*(1-t)+mixer.r*t), g:Math.round(startRgb.g*(1-t)+mixer.g*t),
          b:Math.round(startRgb.b*(1-t)+mixer.b*t), a:startRgb.a };
        if (checkContrast(newRgb) >= targetContrast) return rgbToHex(newRgb.r,newRgb.g,newRgb.b);
      }
      return null;
    }

    return findMix(firstTryMixer) || findMix(secondTryMixer) || rgbToHex(startRgb.r,startRgb.g,startRgb.b);
  }

  // ─── LUMINANCE ADJUSTMENT (APCA) ─────────────────────────
  function adjustLuminanceAPCA(colorRgba, otherColorRgba, targetLc, isAdjustingForeground) {
    if (!colorRgba || !otherColorRgba) return "#FF0000";
    const baseWhite = {r:255,g:255,b:255,a:1};

    function checkAPCA(testRgba) {
      let solidFg, solidBg;
      if (isAdjustingForeground) {
        solidBg = blendRgb(otherColorRgba, baseWhite);
        solidFg = blendRgb(testRgba, solidBg);
      } else {
        solidBg = blendRgb(testRgba, baseWhite);
        solidFg = blendRgb(otherColorRgba, solidBg);
      }
      return getAPCAContrast(solidFg, solidBg);
    }

    let adjustedColor = {...colorRgba};
    if (colorRgba.a < 1) {
      const fullOpaque = {...colorRgba, a:1};
      if (checkAPCA(fullOpaque) >= targetLc) {
        let lo=colorRgba.a, hi=1, bestAlpha=1;
        for (let i=0;i<20;i++) {
          const mid=(lo+hi)/2;
          const testColor={...colorRgba,a:mid};
          if (checkAPCA(testColor)>=targetLc) { bestAlpha=mid; hi=mid; } else lo=mid;
        }
        const ceilAlpha=Math.min(1,Math.ceil(bestAlpha*255)/255);
        adjustedColor={...colorRgba,a:ceilAlpha};
        const hex=rgbToHex(adjustedColor.r,adjustedColor.g,adjustedColor.b);
        const alphaInt=Math.round(ceilAlpha*255);
        const alphaHex=alphaInt.toString(16).padStart(2,"0").toUpperCase();
        return alphaHex==="FF" ? hex : hex+alphaHex;
      }
      adjustedColor={...colorRgba,a:1};
    }

    if (checkAPCA(adjustedColor)>=targetLc) return rgbToHex(adjustedColor.r,adjustedColor.g,adjustedColor.b);

    const hsl=rgbaToHsl(adjustedColor);
    const contrastDark=checkAPCA(hslToRgba({...hsl,l:0}));
    const contrastLight=checkAPCA(hslToRgba({...hsl,l:1}));
    const goLighter=contrastLight>=contrastDark;

    let lo=hsl.l, hi=goLighter?1:0;
    if(lo>hi)[lo,hi]=[hi,lo];
    let bestL=goLighter?1:0, found=false;

    for(let i=0;i<30;i++) {
      const midL=(lo+hi)/2;
      const testRgba=hslToRgba({...hsl,l:midL});
      if(checkAPCA(testRgba)>=targetLc) {
        bestL=midL; found=true;
        if(goLighter)hi=midL; else lo=midL;
      } else { if(goLighter)lo=midL; else hi=midL; }
    }

    if(!found) {
      let lo2=hsl.l, hi2=goLighter?0:1;
      if(lo2>hi2)[lo2,hi2]=[hi2,lo2];
      for(let i=0;i<30;i++) {
        const midL=(lo2+hi2)/2;
        const testRgba=hslToRgba({...hsl,l:midL});
        if(checkAPCA(testRgba)>=targetLc) {
          bestL=midL; found=true;
          if(!goLighter)hi2=midL; else lo2=midL;
        } else { if(!goLighter)lo2=midL; else hi2=midL; }
      }
    }

    const resultRgba=hslToRgba({...hsl,l:bestL});
    return rgbToHex(resultRgba.r,resultRgba.g,resultRgba.b);
  }

  // ─── UPDATE MINI RATIO PILL ───────────────────────────────
  function updateMiniRatioPill(pill, minContrast, maxContrast, isRange, tweakTarget, usingAPCA) {
    const pillLabel = val => usingAPCA ? `Lc ${val.toFixed(1)}` : `${val.toFixed(2)}:1`;
    const pillColor = minContrast>=tweakTarget ? "#047e58" : "#dc2626";
    pill.style.color = pillColor;
    pill.style.borderColor = pillColor;
    pill.style.backgroundColor = "#F3F4F6";
    if (isRange) {
      pill.textContent = "";
      const spanMin = document.createElement("span");
      spanMin.style.cssText = "display:block;line-height:1.3;font-size:0.75rem;";
      spanMin.textContent = pillLabel(minContrast);
      const spanMax = document.createElement("span");
      spanMax.style.cssText = `display:block;line-height:1.3;font-size:0.75rem;border-top:1px solid ${pillColor};margin-top:1px;padding-top:1px;`;
      spanMax.textContent = pillLabel(maxContrast);
      pill.appendChild(spanMin); pill.appendChild(spanMax);
    } else {
      pill.textContent = pillLabel(minContrast);
    }
  }

  // ─── SWITCH TAB ───────────────────────────────────────────
  function switchTab(side, tab) {
    const R = getRefs(side);
    if (tab === "preview") {
      R.panelPreview.style.display = "block"; R.panelDetails.style.display = "none";
      R.tabPreviewBtn.className = "sg-tab sg-tab-active"; R.tabPreviewBtn.setAttribute("aria-selected","true");
      R.tabDetailsBtn.className = "sg-tab sg-tab-inactive"; R.tabDetailsBtn.setAttribute("aria-selected","false");
    } else {
      R.panelPreview.style.display = "none"; R.panelDetails.style.display = "block";
      R.tabDetailsBtn.className = "sg-tab sg-tab-active"; R.tabDetailsBtn.setAttribute("aria-selected","true");
      R.tabPreviewBtn.className = "sg-tab sg-tab-inactive"; R.tabPreviewBtn.setAttribute("aria-selected","false");
    }
    renderPanel(side);
  }

  // ─── RENDER PANEL ─────────────────────────────────────────
  // The core render function. Called for "wcag" or "apca" side.
  // Reads from the shared sharedFgHex / sharedBgHex and per-panel state.
  function renderPanel(side) {
    const R = getRefs(side);
    const ps = panelState[side];
    const isAPCA = side === "apca";

    const fgHex = sharedFgHex;
    const bgHex = sharedBgHex;
    const fgRgba = hexToRgba(fgHex);
    const bgRgba = hexToRgba(bgHex);
    if (!fgRgba || !bgRgba) return;

    // Sync color inputs
    R.fgColorInput.value = fgHex;
    R.bgColorInput.value = bgHex;
    R.fgSwatch.value = fgHex.length > 7 ? fgHex.substring(0,7) : fgHex;
    R.bgSwatch.value = bgHex.length > 7 ? bgHex.substring(0,7) : bgHex;
    R.fgSwatchBtn.style.backgroundColor = fgHex;
    R.bgSwatchBtn.style.backgroundColor = bgHex;

    // Tweak target button label
    R.tweakTargetBtn.textContent = `${ps.tweakTargetContrast}:1`;

    const baseWhite = {r:255,g:255,b:255,a:1};
    const effectiveBg = blendRgb(bgRgba, baseWhite);
    const effectiveFg = blendRgb(fgRgba, effectiveBg);
    const blendedFgHex = rgbToHex(effectiveFg.r,effectiveFg.g,effectiveFg.b);
    const effectiveBgHex = rgbToHex(effectiveBg.r,effectiveBg.g,effectiveBg.b);

    // Apply preview colours
    R.panelPreview.style.color = blendedFgHex;
    R.miniPreviewText.style.color = blendedFgHex;
    R.previewSummary.style.setProperty("--spyglass-summary-arrow-color", blendedFgHex);

    // Current element font info
    let currentFontSize = "16px", currentFontWeight = "400";
    if (currentElement) {
      const cs = window.getComputedStyle(currentElement);
      currentFontSize = cs.fontSize;
      currentFontWeight = cs.fontWeight;
    }

    // Contrast value(s)
    let contrast, minContrast, maxContrast, isRange, contrastDisplay;

    if (pixelAnalysisResult) {
      minContrast = pixelAnalysisResult.minContrast;
      maxContrast = pixelAnalysisResult.maxContrast;
      isRange = true;
      contrastDisplay = isAPCA
        ? `Lc ${minContrast.toFixed(1)}–${maxContrast.toFixed(1)}`
        : `${minContrast.toFixed(2)}–${maxContrast.toFixed(2)}:1`;
      contrast = minContrast;

      const gradientCss = generatePreviewGradient(pixelAnalysisResult);
      if (gradientCss) {
        R.panelPreview.style.backgroundImage = gradientCss;
        R.panelPreview.style.backgroundColor = "";
        R.previewSummary.style.backgroundImage = gradientCss;
        R.previewSummary.style.backgroundColor = "";
      } else {
        R.panelPreview.style.backgroundImage = "";
        R.panelPreview.style.backgroundColor = effectiveBgHex;
        R.previewSummary.style.backgroundImage = "";
        R.previewSummary.style.backgroundColor = effectiveBgHex;
      }

      // Label the ratio display
      R.contrastRatioDisplay.textContent = contrastDisplay + " ";
const typeSpan = document.createElement("span");
      typeSpan.className = "sg-ratio-type-label";
      typeSpan.textContent = `(${pixelAnalysisResult.type})`;
      R.contrastRatioDisplay.appendChild(typeSpan);
    } else {
      contrast = isAPCA ? getAPCAContrast(effectiveFg, effectiveBg) : getContrast(effectiveFg, effectiveBg);
      minContrast = maxContrast = contrast;
      isRange = false;
      contrastDisplay = isAPCA ? `Lc ${contrast.toFixed(1)}` : `${contrast.toFixed(2)}:1`;
      R.contrastRatioDisplay.textContent = contrastDisplay;
      R.panelPreview.style.backgroundImage = "";
      R.panelPreview.style.backgroundColor = effectiveBgHex;
      R.previewSummary.style.backgroundImage = "";
      R.previewSummary.style.backgroundColor = effectiveBgHex;
    }

    // Pill pass threshold
    let pillPassThreshold = ps.tweakTargetContrast;
    if (isAPCA) {
      const sizeInPx = parseFloat(currentFontSize);
      const weightNum = parseInt(currentFontWeight, 10);
      const sortedSizes = Object.keys(apcaThresholds).map(Number).sort((a,b)=>a-b);
      let wk = apcaWeightKeys[0];
      for (const k of apcaWeightKeys) { if (k<=weightNum) wk=k; else break; }
      let bucket = sortedSizes[0];
      for (const s of sortedSizes) { if (sizeInPx>=s) bucket=s; else break; }
      pillPassThreshold = (apcaThresholds[bucket]&&apcaThresholds[bucket][wk]) || 100;
    }

    updateMiniRatioPill(R.miniRatioPill, minContrast, maxContrast, isRange, pillPassThreshold, isAPCA);

    let calculatedRatioColor;

    // ── APCA branch ───────────────────────────────────────
    if (isAPCA) {
      R.wcagDetailsGrid.style.display = "none";
      R.apcaDetailsPanel.style.display = "block";

      const lcNow = Math.abs(contrast);
      const sizeInPx = parseFloat(currentFontSize);
      const weightNum = parseInt(currentFontWeight, 10);
      const sortedSizes = Object.keys(apcaThresholds).map(Number).sort((a,b)=>a-b);

      function nearestWeightKey(w) {
        let best=apcaWeightKeys[0];
        for (const k of apcaWeightKeys) { if(k<=w) best=k; else break; }
        return best;
      }
      function minLcFor(sizePx, weightKey) {
        // Find the two size rows that bracket sizePx
        let lowerSize = sortedSizes[0], upperSize = sortedSizes[sortedSizes.length - 1];
        for (let i = 0; i < sortedSizes.length; i++) {
          if (sortedSizes[i] <= sizePx) lowerSize = sortedSizes[i];
          if (sortedSizes[i] >= sizePx && (upperSize === sortedSizes[sortedSizes.length-1] || sortedSizes[i] < upperSize)) {
            upperSize = sortedSizes[i];
          }
        }
        // Find the upper size correctly
        upperSize = sortedSizes[sortedSizes.length - 1];
        for (const s of sortedSizes) { if (s >= sizePx) { upperSize = s; break; } }

        const lowerRow = apcaThresholds[lowerSize];
        const upperRow = apcaThresholds[upperSize];

        // Find the two weight columns that bracket weightKey
        const allWeights = apcaWeightKeys;
        let lowerW = allWeights[0], upperW = allWeights[allWeights.length - 1];
        for (const w of allWeights) { if (w <= weightKey) lowerW = w; }
        for (const w of allWeights) { if (w >= weightKey) { upperW = w; break; } }

        // Helper: interpolate along the weight axis for a given size row,
        // skipping missing entries by finding the nearest valid ones
        function interpWeight(row, wLo, wHi, wTarget) {
          if (!row) return null;
          // Walk outward to find valid weight entries if exact ones are missing
          let lo = wLo, hi = wHi;
          while (lo >= allWeights[0] && row[lo] == null) lo -= 100;
          while (hi <= allWeights[allWeights.length-1] && row[hi] == null) hi += 100;
          const vLo = row[lo], vHi = row[hi];
          if (vLo == null && vHi == null) return null;
          if (vLo == null) return vHi;
          if (vHi == null) return vLo;
          if (lo === hi) return vLo;
          // Linear interpolation along weight axis
          const t = (wTarget - lo) / (hi - lo);
          return vLo + t * (vHi - vLo);
        }

        const lcAtLowerSize = interpWeight(lowerRow, lowerW, upperW, weightKey);
        const lcAtUpperSize = interpWeight(upperRow, lowerW, upperW, weightKey);

        if (lcAtLowerSize == null && lcAtUpperSize == null) return null;
        if (lcAtLowerSize == null) return lcAtUpperSize;
        if (lcAtUpperSize == null) return lcAtLowerSize;
        if (lowerSize === upperSize) return lcAtLowerSize;

        // Linear interpolation along the size axis
        const t = (sizePx - lowerSize) / (upperSize - lowerSize);
        return lcAtLowerSize + t * (lcAtUpperSize - lcAtLowerSize);
      }

      const lookupWeight = nearestWeightKey(weightNum);
      const tableThreshold = minLcFor(sizeInPx, lookupWeight) ?? 100;
      const minLcRequired = tableThreshold;

      let neededSizeText, neededWeightText;

      if (lcNow >= minLcRequired) {
        neededSizeText = "✓ passes";
      } else {
        // Walk from the smallest table size upward in 0.5px steps,
        // using interpolation to find the smallest size where lcNow
        // meets the interpolated threshold at the detected weight.
        const minTableSize = sortedSizes[0];
        const maxTableSize = sortedSizes[sortedSizes.length - 1];
        let neededSize = null;
        for (let sz = minTableSize; sz <= maxTableSize; sz += 0.5) {
          const threshold = minLcFor(sz, lookupWeight);
          if (threshold != null && lcNow >= threshold) {
            neededSize = sz;
            break;
          }
        }
        // Round up to nearest 0.5 and display cleanly
        const neededSizeLabel = neededSize != null
          ? `≥ ${neededSize % 1 === 0 ? neededSize : neededSize.toFixed(1)}px`
          : "N/A";
        neededSizeText = neededSizeLabel;
      }

      if (lcNow >= minLcRequired) {
        neededWeightText = "✓ passes";
      } else {
        // Walk standard weight increments (100-unit steps) using interpolated
        // size thresholds so the result is consistent with the size interpolation.
        let lightestPassingWeight = null;
        for (const wk of apcaWeightKeys) {
          const threshold = minLcFor(sizeInPx, wk);
          if (threshold != null && lcNow >= threshold) {
            lightestPassingWeight = wk;
            break;
          }
        }
        neededWeightText = lightestPassingWeight != null
          ? `≥ ${lightestPassingWeight}`
          : "N/A";
      }

      R.apcaFontSize.textContent    = currentFontSize;
      R.apcaFontWeight.textContent  = currentFontWeight;
      R.apcaNeededSize.textContent  = neededSizeText;
      R.apcaNeededWeight.textContent= neededWeightText;

      function setNeededState(el, text) {
        el.classList.remove("apca-state-pass","apca-state-suggest","apca-state-na");
        if (text==="✓ passes") el.classList.add("apca-state-pass");
        else if (text==="N/A") el.classList.add("apca-state-na");
        else el.classList.add("apca-state-suggest");
      }
      setNeededState(R.apcaNeededSize, neededSizeText);
      setNeededState(R.apcaNeededWeight, neededWeightText);

      const apcaPass = lcNow >= minLcRequired;
      let meetsAdvisoryLc = false;
      let advisoryForRec = elementTypeAdvisory["body"];

      if (apcaPass) {
        // Element passes the APCA table — show ✓ in Recommendation column.
        // But if it doesn't meet the advisory Lc level, show a best-practice
        // suggestion in the Proposed column instead of a plain ✓.
        const etSelect = document.getElementById(`${side}-element-type-select`);
        const currentTypeForRec = etSelect ? etSelect.value : "body";
        advisoryForRec = elementTypeAdvisory[currentTypeForRec];
        meetsAdvisoryLc = lcNow >= advisoryForRec.lc;

        // Recommendation column always shows ✓ when table passes
        [R.apcaRecSize, R.apcaRecWeight].forEach(el => {
          el.classList.remove("apca-state-na","apca-rec-active");
          el.classList.add("apca-state-pass");
          el.textContent = "✓";
        });

        if (meetsAdvisoryLc) {
          // Fully passes both table and advisory — plain ✓ in Proposed too
          [R.apcaNeededSize, R.apcaNeededWeight].forEach(el => {
            el.classList.remove("apca-state-suggest","apca-state-na");
            el.classList.add("apca-state-pass");
            el.textContent = "✓";
          });
        } else {
          // Passes table but not advisory — use fontMatrixG to find the
          // minimum recommended size/weight for this Lc value, same as
          // apcacontrast.com does.
          const minRecSize = minSizeForLc(lcNow, lookupWeight);
          const szLabel = minRecSize != null
            ? (minRecSize % 1 === 0
                ? `↑ ${minRecSize}px`
                : `↑ ${minRecSize.toFixed(1)}px`)
            : "✓";

          // Find lightest weight where minSizeForLc(lcNow, wk) <= detected size
          let minRecWeight = null;
          for (const wk of fontMatrixWeightKeys) {
            const minSize = minSizeForLc(lcNow, wk);
            if (minSize != null && minSize <= sizeInPx) {
              minRecWeight = wk;
              break;
            }
          }
          const wkLabel = minRecWeight != null ? `↑ ${minRecWeight}` : "✓";

          R.apcaNeededSize.classList.remove("apca-state-pass","apca-state-na");
          R.apcaNeededSize.classList.add("apca-state-suggest");
          R.apcaNeededSize.textContent = szLabel;
          R.apcaNeededSize.title = `Minimum recommended size for Lc ${lcNow.toFixed(1)} at weight ${lookupWeight}`;

          R.apcaNeededWeight.classList.remove("apca-state-pass","apca-state-na");
          R.apcaNeededWeight.classList.add("apca-state-suggest");
          R.apcaNeededWeight.textContent = wkLabel;
          R.apcaNeededWeight.title = `Minimum recommended weight for Lc ${lcNow.toFixed(1)} at ${sizeInPx}px`;
        }
      } else {
        let bestRec = null, bestScore = Infinity;
        const minTableSize = sortedSizes[0];
        const maxTableSize = sortedSizes[sortedSizes.length - 1];
        for (let sz = minTableSize; sz <= maxTableSize; sz += 0.5) {
          if (sz < sizeInPx) continue;
          for (const wk of apcaWeightKeys) {
            if (wk < weightNum) continue;
            const threshold = minLcFor(sz, wk);
            if (threshold == null || lcNow < threshold) continue;
            const sd = (sz - sizeInPx) / sizeInPx;
            const wd = (wk - weightNum) / Math.max(weightNum, 100);
            const score = Math.sqrt(sd * sd + wd * wd);
            if (score < bestScore) { bestScore = score; bestRec = { sz, wk }; }
          }
        }
        if (bestRec) {
          [R.apcaRecSize,R.apcaRecWeight].forEach(el=>{
            el.classList.remove("apca-state-pass","apca-state-na");
            el.classList.add("apca-rec-active");
          });
          const szLabel = bestRec.sz % 1 === 0
            ? `${bestRec.sz}px`
            : `${bestRec.sz.toFixed(1)}px`;
          R.apcaRecSize.textContent = szLabel;
          R.apcaRecWeight.textContent = `${bestRec.wk}`;
        } else {
          [R.apcaRecSize,R.apcaRecWeight].forEach(el=>{
            el.classList.remove("apca-state-pass","apca-rec-active");
            el.classList.add("apca-state-na");
          });
          R.apcaRecSize.textContent = "N/A";
          R.apcaRecWeight.textContent = "N/A";
        }
      }

      R.apcaStatus.textContent = apcaPass?"PASS":"FAIL";
      R.apcaStatus.classList.remove("apca-pass","apca-fail");
      R.apcaStatus.classList.add(apcaPass?"apca-pass":"apca-fail");
      calculatedRatioColor = apcaPass ? "#047e58" : "#dc2626";

// ── Advisory note ─────────────────────────────────────
      const etSelectAdvisory = document.getElementById(`${side}-element-type-select`);
      const currentType = etSelectAdvisory ? etSelectAdvisory.value : "body";
      const advisory = elementTypeAdvisory[currentType];
      let advisoryEl = document.getElementById(`${side}-apca-advisory`);
      if (!advisoryEl) {
        advisoryEl = document.createElement("div");
        advisoryEl.id = `${side}-apca-advisory`;
        advisoryEl.className = "sg-apca-advisory";
        const tableEl = document.getElementById(`${side}-apca-table`);
        if (tableEl && tableEl.parentNode) tableEl.parentNode.appendChild(advisoryEl);
      }
      const meetsAdvisory = lcNow >= advisory.lc;
      advisoryEl.className = `sg-apca-advisory ${meetsAdvisory ? "sg-apca-advisory--pass" : "sg-apca-advisory--fail"}`;

      advisoryEl.innerHTML = `
        <div class="sg-advisory-status">
          ${meetsAdvisory ? '✓' : '⚠️'} ${meetsAdvisory ? 'Meets' : 'Below'} advisory for ${advisory.label}: Lc ${advisory.lc}+
        </div>
        <div class="sg-advisory-note">
          ${advisory.note} (Current: Lc ${lcNow.toFixed(1)})
        </div>
        <div class="sg-advisory-definition">
          <strong class="sg-definition-label">What is ${advisory.label}?</strong>
          ${advisory.definition}
        </div>
      `;
      // ── Color row ────────────────────────────────────────
      const colorDetectedEl = document.getElementById(`${side}-apca-color-detected`);
      const colorNeededEl   = document.getElementById(`${side}-apca-color-needed`);
      const colorRecEl      = document.getElementById(`${side}-apca-color-rec`);

      // Helper: build a clickable hex pill that copies on click
      function makeHexPill(hex, bgForSwatch) {
        const pill = document.createElement("span");
        pill.className = "sg-hex-pill";
        pill.title = `Click to apply ${hex}`;

        const swatch = document.createElement("span");
        swatch.className = "sg-pill-swatch";
        swatch.style.backgroundColor = bgForSwatch || hex;

        const label = document.createElement("span");
        label.textContent = hex.substring(0, 7).toUpperCase();

        pill.appendChild(swatch);
        pill.appendChild(label);

        pill.addEventListener("click", () => {
          // Apply to FG (the color row is always about the foreground color)
          sharedFgHex = hex;
          renderAll();
          // Brief flash to confirm
          pill.style.background = "#D1FAE5";
          setTimeout(() => { pill.style.background = ""; }, 600);
        });
        return pill;
      }

      // Detected cell — current FG hex as a plain pill (no click action needed, just visual)
      colorDetectedEl.textContent = "";
      const detectedPill = document.createElement("span");
      detectedPill.className = "sg-hex-pill";
      detectedPill.style.cursor = "default";
      const detectedSwatch = document.createElement("span");
      detectedSwatch.className = "sg-pill-swatch";
      detectedSwatch.style.backgroundColor = fgHex;
      const detectedLabel = document.createElement("span");
      detectedLabel.textContent = fgHex.substring(0, 7).toUpperCase();
      detectedPill.appendChild(detectedSwatch);
      detectedPill.appendChild(detectedLabel);
      colorDetectedEl.appendChild(detectedPill);

      if (apcaPass) {
        if (meetsAdvisoryLc) {
          // Fully passes table and advisory — plain ✓ on both
          colorNeededEl.textContent = "✓";
          colorNeededEl.className = "apca-td apca-state-pass";
          colorRecEl.textContent = "✓";
          colorRecEl.className = "apca-td apca-rec sg-rec-cell apca-state-pass";
        } else {
          // Passes table but not advisory — suggest a color that hits advisory Lc
          colorNeededEl.textContent = "";
          colorNeededEl.className = "apca-td apca-state-suggest";
          const advisoryColorHex = adjustLuminanceAPCA(fgRgba, bgRgba, advisoryForRec.lc, true);
          colorNeededEl.appendChild(makeHexPill(advisoryColorHex, advisoryColorHex));
          colorNeededEl.title = `Passes APCA table, but ${advisoryForRec.label} advisory recommends Lc ${advisoryForRec.lc}+`;
          colorRecEl.textContent = "✓";
          colorRecEl.className = "apca-td apca-rec sg-rec-cell apca-state-pass";
        }
      } else {
        const neededColorHex = adjustLuminanceAPCA(fgRgba, bgRgba, tableThreshold, true);
        colorNeededEl.textContent = "";
        colorNeededEl.className = "apca-td";
        colorNeededEl.appendChild(makeHexPill(neededColorHex, neededColorHex));

        // Rec: find the combination of size+weight+color that changes things least.
        // We already know bestRec from above (size/weight recommendation).
        // For the color rec, find the minimum Lc required at bestRec's size+weight,
        // then nudge the FG just enough to hit that threshold.
        // If bestRec found a passing size+weight combo, the needed color at THAT
        // threshold will be closer to the original than the flat Lc-75 target.
        let recColorHex = neededColorHex; // fallback to the Lc-75 adjusted color

        // Re-derive bestRec here so we can use it for the color rec
        let bestRecForColor = null;
        let bestScoreForColor = Infinity;
        const minTableSize = sortedSizes[0];
        const maxTableSize = sortedSizes[sortedSizes.length - 1];
        for (let sz = minTableSize; sz <= maxTableSize; sz += 0.5) {
          if (sz < sizeInPx) continue;
          for (const wk of apcaWeightKeys) {
            if (wk < weightNum) continue;
            const threshold = minLcFor(sz, wk);
            if (threshold == null || lcNow < threshold) continue;
            const sd = (sz - sizeInPx) / sizeInPx;
            const wd = (wk - weightNum) / Math.max(weightNum, 100);
            const score = Math.sqrt(sd * sd + wd * wd);
            if (score < bestScoreForColor) {
              bestScoreForColor = score;
              bestRecForColor = { sizePx: sz, wk };
            }
          }
        }

        if (bestRecForColor) {
          // What Lc does the table require at the recommended size+weight?
          let recBucket = sortedSizes[0];
          for (const s of sortedSizes) { if (bestRecForColor.sizePx >= s) recBucket = s; else break; }
          const recThreshold = (apcaThresholds[recBucket] && apcaThresholds[recBucket][bestRecForColor.wk]) || 75;
          const recTarget = Math.max(recThreshold, lcNow); // only nudge as far as needed
          recColorHex = adjustLuminanceAPCA(fgRgba, bgRgba, recTarget, true);
        }

        colorRecEl.textContent = "";
        colorRecEl.className = "apca-td apca-rec sg-rec-cell";
        colorRecEl.appendChild(makeHexPill(recColorHex, recColorHex));
      }

      // APCA suggestions
      const apcaSuggestionTarget = tableThreshold;
      if (contrast < apcaSuggestionTarget) {
        R.fgSuggestionBox.style.display = "flex";
        R.bgSuggestionBox.style.display = "flex";
        R.fgSuggestionLabel.textContent = `Lc ${tableThreshold}`;
        R.bgSuggestionLabel.textContent = `Lc ${tableThreshold}`;

        const fgSugHex = adjustLuminanceAPCA(fgRgba, bgRgba, apcaSuggestionTarget, true);
        const sugFgRgba = hexToRgba(fgSugHex);
        const vFgBg = blendRgb(bgRgba, baseWhite);
        const vFgFg = blendRgb(sugFgRgba, vFgBg);
        const newFgContrast = getAPCAContrast(vFgFg, vFgBg);

        if (newFgContrast >= apcaSuggestionTarget) {
          R.fgSuggestionSwatch.style.backgroundColor = fgSugHex;
          R.fgSuggestionSwatch.textContent = "";
          R.fgSuggestionBox.style.cursor = "pointer";
          R.fgSuggestionBox.dataset.hex = fgSugHex;
          R.fgSuggestionBox.title = `Apply ${fgSugHex}`;
        } else {
          R.fgSuggestionSwatch.style.backgroundColor = "#FFFFFF";
          setSwatchXIcon(R.fgSuggestionSwatch);
          R.fgSuggestionBox.style.cursor = "not-allowed";
          R.fgSuggestionBox.dataset.hex = "";
          R.fgSuggestionBox.title = "Cannot find a passing color";
        }

        const bgSugHex = adjustLuminanceAPCA(bgRgba, fgRgba, apcaSuggestionTarget, false);
        const sugBgRgba = hexToRgba(bgSugHex);
        const vBgSolidBg = blendRgb(sugBgRgba, baseWhite);
        const vBgSolidFg = blendRgb(fgRgba, vBgSolidBg);
        const newBgContrast = getAPCAContrast(vBgSolidFg, vBgSolidBg);

        if (newBgContrast >= apcaSuggestionTarget) {
          R.bgSuggestionSwatch.style.backgroundColor = bgSugHex;
          R.bgSuggestionSwatch.textContent = "";
          R.bgSuggestionBox.style.cursor = "pointer";
          R.bgSuggestionBox.dataset.hex = bgSugHex;
          R.bgSuggestionBox.title = `Apply ${bgSugHex}`;
        } else {
          R.bgSuggestionSwatch.style.backgroundColor = "#FFFFFF";
          setSwatchXIcon(R.bgSuggestionSwatch);
          R.bgSuggestionBox.style.cursor = "not-allowed";
          R.bgSuggestionBox.dataset.hex = "";
          R.bgSuggestionBox.title = "Cannot find a passing color";
        }
      } else {
        R.fgSuggestionBox.style.display = "none";
        R.bgSuggestionBox.style.display = "none";
      }

    // ── WCAG branch ───────────────────────────────────────
    } else {
      R.wcagDetailsGrid.style.display = "grid";
      R.apcaDetailsPanel.style.display = "none";

      const results = {
        "aa-normal":  contrast >= 4.5,
        "aa-large":   contrast >= 3,
        "aa-graphics":contrast >= 3,
        "aaa-normal": contrast >= 7,
        "aaa-large":  contrast >= 4.5,
      };
      for (const key in results) {
        const el = document.getElementById(`${side}-status-${key}`);
        if (el) { el.textContent = results[key]?"Pass":"Fail"; el.className = results[key]?"pass":"fail"; }
      }

      const passNormal = contrast >= 4.5;
      const passLarge  = contrast >= 3.0;
      R.previewStatusNormal.textContent = passNormal
        ? `Regular Text (${currentFontSize}, ${currentFontWeight}): Pass`
        : `Regular Text (${currentFontSize}, ${currentFontWeight}): Fail`;
      R.previewStatusNormal.className = `sg-preview-badge ${passNormal ? "sg-preview-badge--pass" : "sg-preview-badge--fail"}`;

      R.previewStatusLarge.textContent = passLarge
        ? `Large Text (${currentFontSize}, ${currentFontWeight}): Pass`
        : `Large Text (${currentFontSize}, ${currentFontWeight}): Fail`;
      R.previewStatusLarge.className = `sg-preview-badge ${passLarge ? "sg-preview-badge--pass" : "sg-preview-badge--fail"}`;
      if (contrast < ps.tweakTargetContrast) {
        R.fgSuggestionBox.style.display = "flex";
        R.bgSuggestionBox.style.display = "flex";
        R.fgSuggestionLabel.textContent = `${ps.tweakTargetContrast}:1`;
        R.bgSuggestionLabel.textContent = `${ps.tweakTargetContrast}:1`;

        const fgSugHex = adjustLuminance(fgHex, ps.tweakTargetContrast, bgHex, true);
        const sugFgRgb = hexToRgba(fgSugHex);
        const tSolidFg = blendRgb(sugFgRgb, effectiveBg);
        const newFgContrast = getContrast(tSolidFg, effectiveBg);

        if (newFgContrast >= ps.tweakTargetContrast) {
          R.fgSuggestionSwatch.style.backgroundColor = fgSugHex;
          R.fgSuggestionSwatch.textContent = "";
          R.fgSuggestionBox.style.cursor = "pointer";
          R.fgSuggestionBox.dataset.hex = fgSugHex;
          R.fgSuggestionBox.title = `Apply ${fgSugHex}`;
        } else {
          R.fgSuggestionSwatch.style.backgroundColor = "#FFFFFF";
          setSwatchXIcon(R.fgSuggestionSwatch);
          R.fgSuggestionBox.style.cursor = "not-allowed";
          R.fgSuggestionBox.dataset.hex = "";
          R.fgSuggestionBox.title = "Cannot find a passing color";
        }

        const bgSugHex = adjustLuminance(bgHex, ps.tweakTargetContrast, fgHex, false);
        const sugBgRgb = hexToRgba(bgSugHex);
        const tSolidBg = blendRgb(sugBgRgb, baseWhite);
        const tSolidFgOverNewBg = blendRgb(fgRgba, tSolidBg);
        const newBgContrast = getContrast(tSolidFgOverNewBg, tSolidBg);

        if (newBgContrast >= ps.tweakTargetContrast) {
          R.bgSuggestionSwatch.style.backgroundColor = bgSugHex;
          R.bgSuggestionSwatch.textContent = "";
          R.bgSuggestionBox.style.cursor = "pointer";
          R.bgSuggestionBox.dataset.hex = bgSugHex;
          R.bgSuggestionBox.title = `Apply ${bgSugHex}`;
        } else {
          R.bgSuggestionSwatch.style.backgroundColor = "#FFFFFF";
          setSwatchXIcon(R.bgSuggestionSwatch);
          R.bgSuggestionBox.style.cursor = "not-allowed";
          R.bgSuggestionBox.dataset.hex = "";
          R.bgSuggestionBox.title = "Cannot find a passing color";
        }
      } else {
        R.fgSuggestionBox.style.display = "none";
        R.bgSuggestionBox.style.display = "none";
      }

      calculatedRatioColor = contrast < ps.tweakTargetContrast ? "#dc2626" : "#047e58";
    }

    R.contrastRatioDisplay.style.color = calculatedRatioColor;

    // Preview highlight
    R.previewLineNormal.classList.remove("spyglass-preview-highlight");
    R.previewLineLarge.classList.remove("spyglass-preview-highlight");
    if (ps.hasSelectedElement) {
      if (ps.detectedTextCategory === "large") R.previewLineLarge.classList.add("spyglass-preview-highlight");
      else R.previewLineNormal.classList.add("spyglass-preview-highlight");
    }
  }

  // ─── RENDER BOTH PANELS ───────────────────────────────────
  function renderAll() {
    const mode = getAlgoMode();
    if (mode === "wcag" || mode === "unified") renderPanel("wcag");
    if (mode === "apca" || mode === "unified") renderPanel("apca");
  }

// ============================================================
// END OF CHUNK 2 — continue immediately with chunk 3
// ============================================================

// ============================================================
// SPYGLASS CONTRAST CHECKER — chunk 3 of 3
// Paste this immediately after chunk 2.
// ============================================================

  // ─── TWEAK CONTROLS ───────────────────────────────────────
  const minusIcon = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZ2h0PSIxMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48bGluZSB4MT0iNSIgeTE9IjEyIiB4Mj0iMTkiIHkyPSIxMiI+PC9saW5lPjwvc3ZnPg==`;
  const plusIcon  = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZ2h0PSIxMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48bGluZSB4MT0iMTIiIHkxPSI1IiB4Mj0iMTIiIHkyPSIxOSI+PC9saW5lPjxsaW5lIHgxPSI1IiB5MT0iMTIiIHgyPSIxOSIgeTI9IjEyIj48L2xpbmU+PC9zdmc+`;

  function createTweakControls(side, isFg) {
    const containerId = `${side}-${isFg ? "fg" : "bg"}-tweak-controls`;
    const tweakContainer = document.getElementById(containerId);
    if (!tweakContainer) return;
    while (tweakContainer.firstChild) tweakContainer.removeChild(tweakContainer.firstChild);
    tweakContainer.className = "sg-tweak-controls";

    ["r","g","b"].forEach(channel => {
      const group = document.createElement("div");
      group.className = "sg-tweak-control-group";

      const minusBtn = document.createElement("button");
      minusBtn.className = "tweak-btn";
      minusBtn.style.backgroundImage = `url('${minusIcon}')`;
      minusBtn.setAttribute("aria-label", `Decrease ${channel.toUpperCase()}`);
      minusBtn.onclick = () => smartTweakColor(side, isFg, channel, -5);

      const label = document.createElement("span");
      label.textContent = channel.toUpperCase();
      label.className = `sg-tweak-channel-label sg-tweak-channel-label--${channel}`;

      const plusBtn = document.createElement("button");
      plusBtn.className = "tweak-btn";
      plusBtn.style.backgroundImage = `url('${plusIcon}')`;
      plusBtn.setAttribute("aria-label", `Increase ${channel.toUpperCase()}`);
      plusBtn.onclick = () => smartTweakColor(side, isFg, channel, 5);

      group.appendChild(minusBtn);
      group.appendChild(label);
      group.appendChild(plusBtn);
      tweakContainer.appendChild(group);
    });
  }

  function smartTweakColor(side, isFg, channel, amount) {
    const isAPCA = side === "apca";
    const ps = panelState[side];
    const currentHex = isFg ? sharedFgHex : sharedBgHex;
    const otherHex   = isFg ? sharedBgHex : sharedFgHex;

    let tweakedRgb = hexToRgba(currentHex);
    if (!tweakedRgb) return;
    tweakedRgb[channel] = Math.max(0, Math.min(255, tweakedRgb[channel] + amount));

    let alphaHex = Math.round(tweakedRgb.a*255).toString(16).padStart(2,"0").toUpperCase();
    const tweakedHex = rgbToHex(tweakedRgb.r, tweakedRgb.g, tweakedRgb.b) + (alphaHex!=="FF" ? alphaHex : "");
    const otherRgba = hexToRgba(otherHex);
    const baseWhite = {r:255,g:255,b:255,a:1};

    let solidBg, solidFg;
    if (isFg) {
      solidBg = blendRgb(otherRgba, baseWhite);
      solidFg = blendRgb(tweakedRgb, solidBg);
    } else {
      solidBg = blendRgb(tweakedRgb, baseWhite);
      solidFg = blendRgb(hexToRgba(otherHex), solidBg);
    }

    const currentContrast = isAPCA ? getAPCAContrast(solidFg, solidBg) : getContrast(solidFg, solidBg);
    let finalHex;
    if (isAPCA) {
      finalHex = currentContrast >= 75
        ? tweakedHex
        : adjustLuminanceAPCA(tweakedRgb, otherRgba, 75, isFg);
    } else {
      finalHex = currentContrast >= ps.tweakTargetContrast
        ? tweakedHex
        : adjustLuminance(tweakedHex, ps.tweakTargetContrast, otherHex, isFg);
    }

    if (isFg) sharedFgHex = finalHex; else sharedBgHex = finalHex;
    renderAll();
  }

  // ─── COPY TO CLIPBOARD ────────────────────────────────────
  function copyToClipboard(inputEl, buttonEl) {
    inputEl.select();
    document.execCommand("copy");
    const copiedSpan = document.createElement("span");
    copiedSpan.textContent = "Copied!";
    copiedSpan.style.cssText = "position:absolute;right:2rem;top:50%;transform:translateY(-50%);background:white;padding:0.1rem 0.4rem;border-radius:0.25rem;color:#047e58;font-weight:600;font-size:0.8rem;white-space:nowrap;pointer-events:none;";
    buttonEl.parentElement.appendChild(copiedSpan);
    setTimeout(() => copiedSpan.remove(), 1500);
  }

  // ─── ELEMENT PICKER ───────────────────────────────────────
  function handleHoverPickerMouseMove(e) {
    const target = e.target;
    if (target === lastHoveredElement || container.contains(target)) return;
    if (lastHoveredElement) lastHoveredElement.classList.remove("element-picker-hover-outline");
    if (target && target.classList) { target.classList.add("element-picker-hover-outline"); lastHoveredElement = target; }
  }

  function handleRestingPickerMouseMove(e) {
    container.style.visibility = "hidden";
    if (hoverOverrideStyle) hoverOverrideStyle.disabled = true;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (hoverOverrideStyle) hoverOverrideStyle.disabled = false;
    container.style.visibility = "visible";
    if (target === lastHoveredElement || container.contains(target)) return;
    if (lastHoveredElement) lastHoveredElement.classList.remove("element-picker-hover-outline");
    if (target && target.classList) { target.classList.add("element-picker-hover-outline"); lastHoveredElement = target; }
  }

  async function handleElementPickerClick(e) {
    let target;
    if (isCheckingHoverState) {
      target = e.target;
    } else {
      container.style.visibility = "hidden";
      if (hoverOverrideStyle) hoverOverrideStyle.disabled = true;
      target = document.elementFromPoint(e.clientX, e.clientY);
      if (hoverOverrideStyle) hoverOverrideStyle.disabled = false;
      container.style.visibility = "visible";
    }
    if (container.contains(target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!target) return;

    const computedStyle = window.getComputedStyle(target);
    const fgColor = computedStyle.color;
    const fontSize = parseFloat(computedStyle.fontSize);
    const fontWeight = computedStyle.fontWeight;
    const isBold = fontWeight==="bold" || parseInt(fontWeight)>=700;
    const isLarge = fontSize>=24 || (fontSize>=18.5 && isBold);

    // Update both panels' per-panel state
    ["wcag","apca"].forEach(side => {
      panelState[side].detectedTextCategory = isLarge ? "large" : "normal";
      panelState[side].tweakTargetContrast  = isLarge ? 3.0 : 4.5;
      panelState[side].hasSelectedElement   = true;
    });

    // Use the new flattened logic to detect the "apparent" background color
    const elementBgColor = getFlattenedBackgroundColor(target);
    sharedFgHex = rgbaStringToHex(fgColor);
    sharedBgHex = rgbaStringToHex(elementBgColor);
    currentElement = target;

    // Auto-detect element type and update the APCA advisory dropdown
    const detectedType = autoDetectElementType(fontSize, parseInt(fontWeight, 10));
    const etSelect = document.getElementById("apca-element-type-select");
    if (etSelect) {
      etSelect.value = detectedType;
      etSelect.style.borderColor = "#3B82F6";
      etSelect.style.color = "#1D4ED8";
      etSelect.title = "Auto-detected — click to override";
    }

    // Run pixel analysis if enabled on the side that triggered the pick
    if (isPixelAnalysisEnabled && pixelAnalyzer) {      
      await performPixelAnalysis(target);
    }

    stopAllPickers();
  }

  function startElementPicking(side, isOverlayMode) {
    if (isElementPicking) { stopAllPickers(); return; }

    activePicker = side;

    if (!isCheckingHoverState && !isOverlayMode) {
      hoverOverrideStyle = document.createElement("style");
      hoverOverrideStyle.id = "spyglass-hover-override";
      hoverOverrideStyle.innerText = `* { pointer-events: none !important; }`;
      document.head.appendChild(hoverOverrideStyle);
    }

    isElementPicking = true;

    // Update button labels on both sides
    ["wcag","apca"].forEach(s => {
      const btn = document.getElementById(`${s}-activate-element-picker-btn`);
      if (btn) btn.textContent = "Cancel";
    });

    const statusEl = document.getElementById(`${side}-picker-status`);
    if (statusEl) {
      statusEl.textContent = isOverlayMode
        ? "Click text on image/gradient... (Esc to cancel)"
        : "Hover and click an element... (Esc to cancel)";
      statusEl.style.visibility = "visible";
    }

    document.body.classList.add("element-picking-cursor");
    const moveHandler = isCheckingHoverState ? handleHoverPickerMouseMove : handleRestingPickerMouseMove;
    document.addEventListener("mousemove", moveHandler);
    document.addEventListener("click", handleElementPickerClick, true);
    document.addEventListener("keydown", handleEscapeKey);
  }

  function stopAllPickers() {
    document.removeEventListener("keydown", handleEscapeKey);
    if (isElementPicking) {
      isElementPicking = false;
      ["wcag","apca"].forEach(s => {
        const btn = document.getElementById(`${s}-activate-element-picker-btn`);
        if (btn) btn.textContent = "Element Picker";
        const status = document.getElementById(`${s}-picker-status`);
        if (status) status.style.visibility = "hidden";
      });
      if (lastHoveredElement) lastHoveredElement.classList.remove("element-picker-hover-outline");
      document.body.classList.remove("element-picking-cursor");
      document.removeEventListener("mousemove", handleHoverPickerMouseMove);
      document.removeEventListener("mousemove", handleRestingPickerMouseMove);
      document.removeEventListener("click", handleElementPickerClick, true);
      if (hoverOverrideStyle) { hoverOverrideStyle.remove(); hoverOverrideStyle = null; }
    }
    renderAll();
  }

  function handleEscapeKey(e) {
    if (e.key === "Escape") stopAllPickers();
  }

  // ─── PIXEL ANALYSIS ───────────────────────────────────────
  async function performPixelAnalysis(element) {
    if (!pixelAnalyzer || !isPixelAnalysisEnabled) return;
    try {
      pixelAnalysisResult = await pixelAnalyzer.analyzeContrastRange(element);
      if (pixelAnalysisResult?.type === "cors-blocked") {
        pixelAnalysisResult = null;
        ["wcag","apca"].forEach(s => {
          const status = document.getElementById(`${s}-picker-status`);
          if (status) { status.textContent = "⚠️ Image blocked by CORS — pixel analysis unavailable."; status.style.visibility = "visible"; }
        });
      } else {
        renderAll();
      }
    } catch (err) {
      console.error("Pixel analysis failed:", err);
      pixelAnalysisResult = null;
      renderAll();
    }
  }

  // ─── PER-SIDE EVENT WIRING ────────────────────────────────
  // Wire up all interactive elements for a given panel side.
  function wireSide(side) {
    const R = getRefs(side);
    const ps = panelState[side];

    // Color text inputs — update shared state and re-render both panels
    R.fgColorInput.addEventListener("input", () => {
      sharedFgHex = R.fgColorInput.value.trim().toUpperCase();
      renderAll();
    });
    R.bgColorInput.addEventListener("input", () => {
      sharedBgHex = R.bgColorInput.value.trim().toUpperCase();
      renderAll();
    });

    // Color swatches (EyeDropper API)
    R.fgSwatch.addEventListener("click", async (e) => {
      if (window.EyeDropper) {
        e.preventDefault();
        const hex = await pickColorNative();
        if (hex) { sharedFgHex = hex; renderAll(); }
      }
    });
    R.fgSwatch.addEventListener("input", () => {
      sharedFgHex = R.fgSwatch.value.toUpperCase();
      renderAll();
    });

    R.bgSwatch.addEventListener("click", async (e) => {
      if (window.EyeDropper) {
        e.preventDefault();
        const hex = await pickColorNative();
        if (hex) { sharedBgHex = hex; renderAll(); }
      }
    });
    R.bgSwatch.addEventListener("input", () => {
      sharedBgHex = R.bgSwatch.value.toUpperCase();
      renderAll();
    });

    // Swap
    R.swapBtn.addEventListener("click", () => {
      [sharedFgHex, sharedBgHex] = [sharedBgHex, sharedFgHex];
      renderAll();
    });

    // Copy buttons
    R.fgColorInput.parentElement.querySelector(`#${side}-copy-fg`)
      ?.addEventListener("click", () => copyToClipboard(R.fgColorInput, R.fgColorInput.parentElement.querySelector(`#${side}-copy-fg`)));
    document.getElementById(`${side}-copy-fg`)
      ?.addEventListener("click", () => copyToClipboard(R.fgColorInput, document.getElementById(`${side}-copy-fg`)));
    document.getElementById(`${side}-copy-bg`)
      ?.addEventListener("click", () => copyToClipboard(R.bgColorInput, document.getElementById(`${side}-copy-bg`)));

    // Suggestion swatches
    R.fgSuggestionBox.addEventListener("click", () => {
      const hex = R.fgSuggestionBox.dataset.hex;
      if (hex) { sharedFgHex = hex; renderAll(); }
    });
    R.bgSuggestionBox.addEventListener("click", () => {
      const hex = R.bgSuggestionBox.dataset.hex;
      if (hex) { sharedBgHex = hex; renderAll(); }
    });

    // Tweak target toggle
    R.tweakTargetBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      ps.tweakTargetContrast = ps.tweakTargetContrast === 4.5 ? 3 : 4.5;
      renderAll();
    });

    // Pixel analysis toggle
    R.pixelAnalysisBtn.addEventListener("click", async (e) => {
      e.preventDefault(); e.stopPropagation();
      isPixelAnalysisEnabled = !isPixelAnalysisEnabled;
      if (isPixelAnalysisEnabled) {
        if (!pixelAnalyzer) pixelAnalyzer = new ImageBackgroundAnalyzer();
        R.pixelAnalysisBtn.textContent = "Pixel: ON";
        R.pixelAnalysisBtn.style.backgroundColor = "#10B981";
        R.pixelAnalysisBtn.style.borderColor = "#047e58";
        if (currentElement) await performPixelAnalysis(currentElement);
      } else {
        R.pixelAnalysisBtn.textContent = "Pixel: OFF";
        R.pixelAnalysisBtn.style.backgroundColor = "#3B82F6";
        R.pixelAnalysisBtn.style.borderColor = "#2563EB";
        pixelAnalysisResult = null;
        renderAll();
      }
    });

    // Element picker button
    R.elementPickerBtn.addEventListener("click", () => startElementPicking(side, false));

    // Overlay picker button
    R.overlayPickerBtn.addEventListener("click", () => {
      if (!pixelAnalyzer) pixelAnalyzer = new ImageBackgroundAnalyzer();
      isPixelAnalysisEnabled = true;
      R.pixelAnalysisBtn.textContent = "Pixel: ON";
      R.pixelAnalysisBtn.style.backgroundColor = "#10B981";
      R.pixelAnalysisBtn.style.borderColor = "#047e58";
      startElementPicking(side, true);
    });

    // Mode toggle (resting / hover)
    R.modeToggleBtn.addEventListener("click", () => {
      isCheckingHoverState = !isCheckingHoverState;
      R.modeToggleBtn.textContent = isCheckingHoverState ? "Hover" : "Resting";
      const isWcag = side === "wcag";
      R.modeToggleBtn.style.backgroundColor = isCheckingHoverState
        ? "#EA580C"
        : (isWcag ? "#166534" : "#4C1D95");
    });

    // Element type advisory dropdown (APCA only)
    if (side === "apca") {
      document.getElementById("apca-element-type-select")
        ?.addEventListener("change", (e) => {
          // Clear auto-detect styling when user manually changes it
          e.target.style.borderColor = "";
          e.target.style.color = "";
          e.target.title = "Element type — affects advisory note only";
          renderAll();
        });
    }

    // Tabs
    document.getElementById(`${side}-tab-btn-preview`)
      ?.addEventListener("click", () => switchTab(side, "preview"));
    document.getElementById(`${side}-tab-btn-details`)
      ?.addEventListener("click", () => switchTab(side, "details"));

    // Tweak controls
    createTweakControls(side, true);   // fg
    createTweakControls(side, false);  // bg
  }

  // ─── ALGORITHM RADIO LISTENERS ────────────────────────────
  ["algo-wcag","algo-apca","algo-unified"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
      applyAlgoMode();
      renderAll();
    });
  });

  // ─── CLOSE BUTTON ─────────────────────────────────────────
  document.getElementById("close-checker-btn")?.addEventListener("click", () => {
    stopAllPickers();
    if (pixelAnalyzer) pixelAnalyzer.cleanup();
    container.remove();
  });
  // ─── DRAG HANDLE ──────────────────────────────────────────
  const dragHandle = document.getElementById("drag-handle");
  let isDragging = false, dragOffsetX, dragOffsetY;
  dragHandle.addEventListener("mousedown", (e) => {
    isDragging = true;
    dragOffsetX = e.clientX - container.offsetLeft;
    dragOffsetY = e.clientY - container.offsetTop;
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    if (e.buttons !== 1) { isDragging = false; return; }
    container.style.left = `${e.clientX - dragOffsetX}px`;
    container.style.top  = `${e.clientY - dragOffsetY}px`;
  });
  document.addEventListener("mouseup", () => {
    isDragging = false;
    document.body.style.userSelect = "";
  });

 // ─── FINAL WIRING & INITIALIZATION ───────────────────────

  // 1. Wire the internal panel logic (buttons inside the WCAG/APCA columns)
  wireSide("wcag");
  wireSide("apca");

  // 2. Wire Global UI Buttons (Save & CSV in the top handle)
  document.getElementById("save-analysis-btn")?.addEventListener("click", saveAnalysis);

  document.getElementById("download-csv-btn")?.addEventListener("click", () => {
    chrome.storage.local.get({ spyglass_history: [] }, (data) => {
      const history = data.spyglass_history;
      if (history.length === 0) {
        alert("History is empty. Save some results first!");
        return;
      }

      const headers = [
        "Timestamp", "URL", "Page", "FG", "BG", "WCAG Ratio", "APCA Lc", 
        "Detected Combo", "Size Mod", "Weight Mod", "Color Mod", "Balanced Combo"
      ];
      const rows = history.map(s => [
        s.timestamp, s.url, s.pageTitle, s.colors.foreground, s.colors.background,
        s.results.wcag, s.results.apcaLc,
        s.results.detected?.combo || "N/A",
        s.results.recommendations.sizeMod, s.results.recommendations.weightMod,
        s.results.recommendations.colorMod, s.results.recommendations.balanced
      ]);

      const csvContent = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "spyglass_report.csv";
      link.click();
      URL.revokeObjectURL(url);
    });
  });

  // 3. Set the initial state and perform first render
  applyAlgoMode(); 
  renderAll();

  // 4. Auto-open the picker (only once!)
  setTimeout(() => startElementPicking("wcag", false), 100);

})(); // Final closure of the IIFE
