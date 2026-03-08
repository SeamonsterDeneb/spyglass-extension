import { APCAcontrast, sRGBtoY } from 'apca-w3';
(function () {
  // Prevent multiple runs
  if (document.getElementById("contrast-checker-container")) return;

  // --- IMAGE BACKGROUND ANALYZER CLASS ---
  // Analyzes contrast of text over images and gradients
  class ImageBackgroundAnalyzer {
    constructor() {
      this.canvas = null;
      this.ctx = null;
      this.isAnalyzing = false;
    }

    // Initialize canvas for image analysis
    initCanvas() {
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
      document.body.appendChild(this.canvas);
      this.canvas.style.position = "absolute";
      this.canvas.style.left = "-9999px";
      this.canvas.style.top = "-9999px";
      this.canvas.style.pointerEvents = "none";
    }

    // Main analysis function - determines type and routes to appropriate analyzer
    async analyzeContrastRange(element) {
      const backgroundInfo = this.findBackgroundElement(element);

      if (!backgroundInfo.element) {
        return null;
      }

      // Always use composite path — it's the only one that samples
      // actual pixels across the full text region via the canvas grid.
      // The old gradient/image-only paths are kept for reference but
      // no longer used as primary routes.
      return await this.analyzeCompositeContrast(element, backgroundInfo);
    }

    // Find ALL elements with backgrounds between the text and the page root
    findBackgroundElement(element) {
      let el = element;
      let depth = 0;
      const maxDepth = 10;
      const layers = []; // collect all background layers, nearest-to-text first

      while (el && depth < maxDepth) {
        const style = window.getComputedStyle(el);
        const bgImage = style.backgroundImage;
        const bgColor = style.backgroundColor;

        const hasGradient =
          bgImage && bgImage !== "none" && bgImage.includes("gradient");
        const hasImage =
          bgImage && bgImage !== "none" && bgImage.includes("url(");
        const hasColor =
          bgColor &&
          bgColor !== "rgba(0, 0, 0, 0)" &&
          bgColor !== "transparent";

        if (hasGradient || hasImage || hasColor) {
          layers.push({
            element: el,
            backgroundImage: bgImage || "none",
            backgroundColor: bgColor || "transparent",
            hasGradient,
            hasImage,
            hasColor,
            depth,
          });
        }

        if (el.tagName === "BODY" || el.tagName === "HTML") break;
        el = el.parentElement;
        depth++;
      }

      // For backward compat, also expose a top-level summary
      if (layers.length === 0) return { element: null, layers: [] };

      // The "primary" element for sizing purposes is the deepest one with an image,
      // or failing that the deepest one with a gradient, or just the first layer.
      const primaryLayer =
        layers.find((l) => l.hasImage) ||
        layers.find((l) => l.hasGradient) ||
        layers[0];

      return {
        element: primaryLayer.element,
        backgroundImage: primaryLayer.backgroundImage,
        hasGradient: layers.some((l) => l.hasGradient),
        hasImage: layers.some((l) => l.hasImage),
        layers, // NEW: full ordered list, nearest-to-text first
      };
    }

    // Analyze contrast of text over a gradient
    async analyzeGradientContrast(textElement, backgroundInfo) {
      const textColor = window.getComputedStyle(textElement).color;
      const textRgb = this.parseColor(textColor);

      const gradientColors = this.parseGradientColors(
        backgroundInfo.backgroundImage,
      );

      if (gradientColors.length === 0) {
        return null;
      }

      const contrasts = gradientColors.map((bgColor) => {
        return this.calculateContrast(textRgb, bgColor);
      });

      const result = {
        type: "gradient",
        minContrast: Math.min(...contrasts),
        maxContrast: Math.max(...contrasts),
        avgContrast: contrasts.reduce((a, b) => a + b, 0) / contrasts.length,
        colors: gradientColors,
        textColor: textRgb,
      };

      return result;
    }

    // Composite all background layers and sample contrast against the result
    async analyzeCompositeContrast(textElement, backgroundInfo) {
      if (!this.canvas) this.initCanvas();

      const textColor = window.getComputedStyle(textElement).color;
      const textRgb = this.parseColor(textColor);

      // Use image layer for sizing if available, otherwise fall back to
      // the largest/outermost layer we found
      const imageLayer = backgroundInfo.layers.find((l) => l.hasImage);
      const sizingLayer = imageLayer || backgroundInfo.layers[0];
      const bgRect = sizingLayer.element.getBoundingClientRect();
      const textRect = textElement.getBoundingClientRect();

      this.canvas.width = bgRect.width;
      this.canvas.height = bgRect.height;

      // --- 1. Fill with the deepest solid background color ---
      // Walk layers from farthest to nearest; find the deepest solid color
      const reversedLayers = [...backgroundInfo.layers].reverse();
      let baseBgColor = "rgb(255, 255, 255)"; // fallback white
      for (const layer of reversedLayers) {
        if (layer.hasColor) {
          baseBgColor = layer.backgroundColor;
          break;
        }
      }
      this.ctx.fillStyle = baseBgColor;
      this.ctx.fillRect(0, 0, bgRect.width, bgRect.height);

      // --- 2. Draw background image(s), farthest layer first ---
      for (const layer of reversedLayers) {
        if (!layer.hasImage) continue;

        const imageUrl = this.extractImageUrl(layer.backgroundImage);
        if (!imageUrl) continue;

        const img = await this.loadImage(imageUrl);
        if (!img) continue;

        const layerRect = layer.element.getBoundingClientRect();

        // Translate canvas coords: if this layer's element isn't the same
        // as bgRect's element, offset accordingly
        const offsetX = layerRect.left - bgRect.left;
        const offsetY = layerRect.top - bgRect.top;

        const imgAspect = img.width / img.height;
        const layerAspect = layerRect.width / layerRect.height;

        let drawWidth, drawHeight, drawX, drawY;
        if (imgAspect > layerAspect) {
          drawHeight = layerRect.height;
          drawWidth = drawHeight * imgAspect;
          drawX = offsetX + (layerRect.width - drawWidth) / 2;
          drawY = offsetY;
        } else {
          drawWidth = layerRect.width;
          drawHeight = drawWidth / imgAspect;
          drawX = offsetX;
          drawY = offsetY + (layerRect.height - drawHeight) / 2;
        }

        this.ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      }

      // --- 3. Paint gradient overlays on top, farthest to nearest ---
      for (const layer of reversedLayers) {
        if (!layer.hasGradient) continue;

        const gradientColors = this.parseGradientColors(layer.backgroundImage);
        if (gradientColors.length < 2) continue;

        const layerRect = layer.element.getBoundingClientRect();
        const offsetX = layerRect.left - bgRect.left;
        const offsetY = layerRect.top - bgRect.top;
        const w = layerRect.width;
        const h = layerRect.height;

        const isRadial = layer.backgroundImage
          .toLowerCase()
          .includes("radial-gradient");
        this.ctx.globalAlpha = this.extractGradientOpacity(
          layer.backgroundImage,
        );

        if (isRadial) {
          const grad = this.resolveRadialGradient(
            layer.backgroundImage,
            gradientColors,
            offsetX,
            offsetY,
            w,
            h,
          );
          if (grad) {
            this.ctx.fillStyle = grad;
            this.ctx.fillRect(offsetX, offsetY, w, h);
          }
        } else {
          const { x0, y0, x1, y1 } = this.resolveGradientPoints(
            layer.backgroundImage,
            offsetX,
            offsetY,
            w,
            h,
          );
          const grad = this.ctx.createLinearGradient(x0, y0, x1, y1);
          const stepSize = 1 / (gradientColors.length - 1);
          gradientColors.forEach((c, i) => {
            const alpha = c.a !== undefined ? c.a : 1;
            grad.addColorStop(
              i * stepSize,
              `rgba(${c.r},${c.g},${c.b},${alpha})`,
            );
          });
          this.ctx.fillStyle = grad;
          this.ctx.fillRect(offsetX, offsetY, w, h);
        }

        this.ctx.globalAlpha = 1.0;
      }

      // --- 4. Sample the composited pixels under the text ---
      const relativeX = textRect.left - bgRect.left;
      const relativeY = textRect.top - bgRect.top;
      const sampleX = Math.max(0, relativeX);
      const sampleY = Math.max(0, relativeY);
      const sampleWidth = Math.min(textRect.width, bgRect.width - sampleX);
      const sampleHeight = Math.min(textRect.height, bgRect.height - sampleY);

      if (sampleWidth <= 0 || sampleHeight <= 0) return null;

      let imageData;
      try {
        imageData = this.ctx.getImageData(
          sampleX,
          sampleY,
          sampleWidth,
          sampleHeight,
        );
      } catch (e) {
        console.error("❌ getImageData failed (CORS?) on composite canvas:", e);
        return { type: "cors-blocked" };
      }

      const pixels = imageData.data;
      const samples = [];

      // Use a uniform grid rather than a flat stride — this ensures we always
      // sample across the full width and height of the text region, which is
      // critical for gradients where contrast varies continuously L→R or T→B.
      const COLS = Math.max(10, Math.min(50, Math.floor(sampleWidth)));
      const ROWS = Math.max(5, Math.min(20, Math.floor(sampleHeight)));

      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const px = Math.floor((col / (COLS - 1)) * (sampleWidth - 1));
          const py = Math.floor((row / (ROWS - 1)) * (sampleHeight - 1));
          const idx = (py * Math.floor(sampleWidth) + px) * 4;
          if (pixels[idx + 3] > 128) {
            samples.push({
              r: pixels[idx],
              g: pixels[idx + 1],
              b: pixels[idx + 2],
            });
          }
        }
      }

      if (samples.length === 0) return null;

      const contrasts = samples.map((bg) =>
        this.calculateContrast(textRgb, bg),
      );

      return {
        type: "image",
        minContrast: Math.min(...contrasts),
        maxContrast: Math.max(...contrasts),
        avgContrast: contrasts.reduce((a, b) => a + b, 0) / contrasts.length,
        sampledPixels: samples,
        textColor: textRgb,
      };
    }
    resolveRadialGradient(gradientCss, gradientColors, offsetX, offsetY, w, h) {
      let cx = offsetX + w / 2;
      let cy = offsetY + h / 2;
      let r1 = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2); // farthest-corner default

      // Parse "at <position>"
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

      // Parse size keyword
      const sizeMatch = gradientCss.match(
        /radial-gradient\s*\(\s*(ellipse|circle)?\s*(closest-side|closest-corner|farthest-side|farthest-corner)?/i,
      );
      if (sizeMatch && sizeMatch[2]) {
        const keyword = sizeMatch[2].toLowerCase();
        const dx = cx - offsetX;
        const dy = cy - offsetY;
        const dxFar = w - (cx - offsetX);
        const dyFar = h - (cy - offsetY);
        if (keyword === "closest-side") {
          r1 = Math.min(dx, dy, dxFar, dyFar);
        } else if (keyword === "closest-corner") {
          r1 = Math.sqrt(Math.min(dx, dxFar) ** 2 + Math.min(dy, dyFar) ** 2);
        } else if (keyword === "farthest-side") {
          r1 = Math.max(dx, dy, dxFar, dyFar);
        } else {
          r1 = Math.sqrt(Math.max(dx, dxFar) ** 2 + Math.max(dy, dyFar) ** 2);
        }
      }

      r1 = Math.max(1, r1 || Math.sqrt((w / 2) ** 2 + (h / 2) ** 2));

      try {
        const grad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, r1);
        const stepSize = 1 / (gradientColors.length - 1);
        gradientColors.forEach((c, i) => {
          const alpha = c.a !== undefined ? c.a : 1;
          grad.addColorStop(
            i * stepSize,
            `rgba(${c.r},${c.g},${c.b},${alpha})`,
          );
        });
        return grad;
      } catch (e) {
        console.warn("⚠️ Could not create radial gradient:", e);
        return null;
      }
    }
    // Extract opacity from gradient CSS (rgba alpha or explicit opacity)
    // Returns a 0–1 value to use as globalAlpha when painting the gradient layer
    extractGradientOpacity(gradientCss) {
      // Only treat as a layer-level opacity if ALL stops share the same alpha.
      // If stops have different alphas, return 1.0 — the per-stop alpha is
      // handled by the canvas gradient stops themselves.
      const alphas = [];
      const rgbaRegex =
        /rgba\s*\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/g;
      let match;
      while ((match = rgbaRegex.exec(gradientCss)) !== null) {
        alphas.push(parseFloat(match[1]));
      }
      if (alphas.length === 0) return 1.0;
      const allSame = alphas.every((a) => Math.abs(a - alphas[0]) < 0.01);
      return allSame ? alphas[0] : 1.0;
    }

    // Parse the gradient direction from CSS and return canvas start/end points
    resolveGradientPoints(gradientCss, offsetX, offsetY, w, h) {
      // Default: left to right
      let x0 = offsetX,
        y0 = offsetY + h / 2;
      let x1 = offsetX + w,
        y1 = offsetY + h / 2;

      // Match "to <side/corner>" syntax: e.g. "to bottom", "to top right"
      const toMatch = gradientCss.match(
        /linear-gradient\s*\(\s*to\s+([\w\s]+?)\s*,/i,
      );
      if (toMatch) {
        const dir = toMatch[1].trim().toLowerCase();
        const toTop = dir.includes("top");
        const toBottom = dir.includes("bottom");
        const toLeft = dir.includes("left");
        const toRight = dir.includes("right");

        x0 = offsetX + (toRight ? 0 : toLeft ? w : w / 2);
        y0 = offsetY + (toBottom ? 0 : toTop ? h : h / 2);
        x1 = offsetX + (toRight ? w : toLeft ? 0 : w / 2);
        y1 = offsetY + (toBottom ? h : toTop ? 0 : h / 2);
        return { x0, y0, x1, y1 };
      }

      // Match angle syntax: e.g. "135deg", "0.5turn", "1.2rad"
      const angleMatch = gradientCss.match(
        /linear-gradient\s*\(\s*([\d.]+)(deg|turn|rad)\s*,/i,
      );
      if (angleMatch) {
        let deg = parseFloat(angleMatch[1]);
        const unit = angleMatch[2].toLowerCase();
        if (unit === "turn") deg = deg * 360;
        if (unit === "rad") deg = deg * (180 / Math.PI);

        // CSS gradient angles: 0deg = to top, clockwise.
        // Convert to a unit vector for the gradient direction.
        const rad = (deg - 90) * (Math.PI / 180);
        // The gradient line runs through the center; length chosen so it
        // reaches the corners (standard CSS gradient-line length formula).
        const lineLength =
          Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
        const cx = offsetX + w / 2;
        const cy = offsetY + h / 2;
        x0 = cx - (Math.cos(rad) * lineLength) / 2;
        y0 = cy - (Math.sin(rad) * lineLength) / 2;
        x1 = cx + (Math.cos(rad) * lineLength) / 2;
        y1 = cy + (Math.sin(rad) * lineLength) / 2;
        return { x0, y0, x1, y1 };
      }

      // No direction found — fall back to left→right
      return { x0, y0, x1, y1 };
    }

    // Parse colors from gradient CSS
    parseGradientColors(gradientCss) {
      const colors = [];

      // Strip url(...) so image filenames don't confuse the color regex
      const cssNoUrls = gradientCss.replace(/url\([^)]*\)/gi, "");

      const rgbRegex =
        /rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/g;
      let match;
      while ((match = rgbRegex.exec(cssNoUrls)) !== null) {
        colors.push({
          r: Math.round(parseFloat(match[1])),
          g: Math.round(parseFloat(match[2])),
          b: Math.round(parseFloat(match[3])),
          a: match[4] !== undefined ? parseFloat(match[4]) : 1,
        });
      }

      const hexRegex = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
      while ((match = hexRegex.exec(cssNoUrls)) !== null) {
        const hex = match[1];
        if (hex.length === 3) {
          colors.push({
            r: parseInt(hex[0] + hex[0], 16),
            g: parseInt(hex[1] + hex[1], 16),
            b: parseInt(hex[2] + hex[2], 16),
          });
        } else {
          colors.push({
            r: parseInt(hex.substr(0, 2), 16),
            g: parseInt(hex.substr(2, 2), 16),
            b: parseInt(hex.substr(4, 2), 16),
          });
        }
      }

      return colors;
    }

    // Analyze contrast of text over an image
    async analyzeImageContrast(textElement, backgroundInfo) {
      if (!this.canvas) this.initCanvas();

      const textColor = window.getComputedStyle(textElement).color;
      const textRgb = this.parseColor(textColor);

      const imageUrl = this.extractImageUrl(backgroundInfo.backgroundImage);

      if (!imageUrl) {
        return null;
      }

      const img = await this.loadImage(imageUrl);
      if (!img) {
        return null;
      }

      const textRect = textElement.getBoundingClientRect();
      const bgRect = backgroundInfo.element.getBoundingClientRect();

      const relativeX = textRect.left - bgRect.left;
      const relativeY = textRect.top - bgRect.top;

      const samples = this.sampleImagePixels(
        img,
        bgRect,
        textRect,
        relativeX,
        relativeY,
        backgroundInfo.element,
      );

      if (samples.length === 0) {
        return null;
      }

      const contrasts = samples.map((bgColor) => {
        return this.calculateContrast(textRgb, bgColor);
      });

      const result = {
        type: "image",
        minContrast: Math.min(...contrasts),
        maxContrast: Math.max(...contrasts),
        avgContrast: contrasts.reduce((a, b) => a + b, 0) / contrasts.length,
        sampledPixels: samples, // full array of {r,g,b} objects, not just a count
        textColor: textRgb,
      };

      return result;
    }

    // Extract image URL from background-image CSS
    extractImageUrl(backgroundImageCss) {
      const urlMatch = backgroundImageCss.match(/url\(['"]?([^'"()]+)['"]?\)/);
      if (urlMatch) {
        let url = urlMatch[1];

        if (url.startsWith("/")) {
          url = window.location.origin + url;
        } else if (!url.startsWith("http")) {
          const base = window.location.href.substring(
            0,
            window.location.href.lastIndexOf("/") + 1,
          );
          url = base + url;
        }

        return url;
      }

      return null;
    }

    // Load an image and return a promise
    loadImage(url) {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";

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

    // Sample pixels from the image in the region where text sits
    sampleImagePixels(
      img,
      bgRect,
      textRect,
      relativeX,
      relativeY,
      backgroundElement,
    ) {
      this.canvas.width = bgRect.width;
      this.canvas.height = bgRect.height;

      const bgStyle = window.getComputedStyle(backgroundElement);
      const bgSize = bgStyle.backgroundSize;
      const bgPosition = bgStyle.backgroundPosition;

      const imgAspect = img.width / img.height;
      const bgAspect = bgRect.width / bgRect.height;

      let drawWidth, drawHeight, drawX, drawY;

      if (imgAspect > bgAspect) {
        drawHeight = bgRect.height;
        drawWidth = drawHeight * imgAspect;
        drawX = (bgRect.width - drawWidth) / 2;
        drawY = 0;
      } else {
        drawWidth = bgRect.width;
        drawHeight = drawWidth / imgAspect;
        drawX = 0;
        drawY = (bgRect.height - drawHeight) / 2;
      }

      this.ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      const sampleX = Math.max(0, relativeX);
      const sampleY = Math.max(0, relativeY);
      const sampleWidth = Math.min(textRect.width, bgRect.width - sampleX);
      const sampleHeight = Math.min(textRect.height, bgRect.height - sampleY);

      if (sampleWidth <= 0 || sampleHeight <= 0) {
        return [];
      }

      let imageData;
      try {
        imageData = this.ctx.getImageData(
          sampleX,
          sampleY,
          sampleWidth,
          sampleHeight,
        );
      } catch (e) {
        console.error(
          "❌ getImageData failed (likely CORS taint) — pixel analysis unavailable for this image:",
          e,
        );
        return [];
      }

      const pixels = imageData.data;

      const samples = [];
      const step =
        4 * Math.max(1, Math.floor((sampleWidth * sampleHeight) / 100));

      for (let i = 0; i < pixels.length; i += step) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];

        if (a > 0) {
          // Check for any opacity, not just > 128
          samples.push({ r, g, b, a: a / 255 }); // Store alpha as 0-1
        }
      }

      return samples;
    }

    // Parse any color format to RGBA
    parseColor(colorString) {
      if (!colorString || colorString === "transparent") {
        return { r: 0, g: 0, b: 0, a: 0 };
      }

      // Handle rgba and rgb
      const rgbaMatch = colorString.match(
        /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:,\s*([\d.]+))?\s*\)/,
      );
      if (rgbaMatch) {
        const parsedColor = {
          r: parseInt(rgbaMatch[1]),
          g: parseInt(rgbaMatch[2]),
          b: parseInt(rgbaMatch[3]),
          a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
        };
        return parsedColor;
      }

      // Handle hex
      if (colorString.startsWith("#")) {
        const hex = colorString.substring(1);
        let r, g, b, a;
        if (hex.length === 3) {
          r = parseInt(hex[0] + hex[0], 16);
          g = parseInt(hex[1] + hex[1], 16);
          b = parseInt(hex[2] + hex[2], 16);
          a = 1; // Default to opaque for 3-digit hex
        } else if (hex.length === 6) {
          r = parseInt(hex.substr(0, 2), 16);
          g = parseInt(hex.substr(2, 2), 16);
          b = parseInt(hex.substr(4, 2), 16);
          a = 1; // Default to opaque for 6-digit hex
        } else if (hex.length === 8) {
          // Added support for 8-digit hex with alpha
          r = parseInt(hex.substr(0, 2), 16);
          g = parseInt(hex.substr(2, 2), 16);
          b = parseInt(hex.substr(4, 2), 16);
          a = parseInt(hex.substr(6, 2), 16) / 255; // Convert hex alpha to float 0-1
        } else {
          return null; // Invalid hex
        }
        const parsedColor = { r, g, b, a }; // Use 'a' directly
        return parsedColor;
      }

      // Handle named colors
      // A more robust solution would involve a comprehensive mapping of named colors to RGB
      // For simplicity, we'll try to let the browser compute it.
      const tempDiv = document.createElement("div");
      tempDiv.style.color = colorString;
      document.body.appendChild(tempDiv);
      const computedColor = window.getComputedStyle(tempDiv).color;
      document.body.removeChild(tempDiv);

      const computedRgbaMatch = computedColor.match(
        /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:,\s*([\\d.]+))?\s*\)/,
      );
      if (computedRgbaMatch) {
        const parsedColor = {
          r: parseInt(computedRgbaMatch[1]),
          g: parseInt(computedRgbaMatch[2]),
          b: parseInt(computedRgbaMatch[3]),
          a: computedRgbaMatch[4] ? parseFloat(computedRgbaMatch[4]) : 1,
        };
        return parsedColor;
      }

      return null; // Could not parse color
    }

    // Calculate relative luminance
    getLuminance(r, g, b) {
      const [rs, gs, bs] = [r, g, b].map((c) => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    // Calculate contrast ratio between two RGB colors
    calculateContrast(rgb1, rgb2) {
      const lum1 = this.getLuminance(rgb1.r, rgb1.g, rgb1.b);
      const lum2 = this.getLuminance(rgb2.r, rgb2.g, rgb2.b);
      const lighter = Math.max(lum1, lum2);
      const darker = Math.min(lum1, lum2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    // Blend two RGBA colors
    blendColors(bottomColor, topColor) {
      // Ensure colors have alpha, default to 1 if missing
      const bR = bottomColor.r;
      const bG = bottomColor.g;
      const bB = bottomColor.b;
      const bA = bottomColor.a === undefined ? 1 : bottomColor.a;

      const tR = topColor.r;
      const tG = topColor.g;
      const tB = topColor.b;
      const tA = topColor.a === undefined ? 1 : topColor.a;

      if (tA === 0) return { r: bR, g: bG, b: bB, a: bA };
      if (bA === 0) return { r: tR, g: tG, b: tB, a: tA };

      const outA = tA + bA * (1 - tA);
      if (outA === 0) return { r: 0, g: 0, b: 0, a: 0 };

      const outR = (tR * tA + bR * bA * (1 - tA)) / outA;
      const outG = (tG * tA + bG * bA * (1 - tA)) / outA;
      const outB = (tB * tA + bB * bA * (1 - tA)) / outA;

      return {
        r: Math.round(outR),
        g: Math.round(outG),
        b: Math.round(outB),
        a: outA,
      };
    }

    // Clean up resources
    cleanup() {
      if (this.canvas && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
      this.canvas = null;
      this.ctx = null;
    }
  }

  // --- CONSTANTS & STATE ---
  const version = "1.5";

  let isElementPicking = false;
  let isPickingForeground = true;
  let lastHoveredElement = null;
  let tweakTargetContrast = 4.5;
  let hoverOverrideStyle = null;
  let isCheckingHoverState = false;
  let detectedTextCategory = "normal";
  let hasSelectedElement = false;
  let pixelAnalyzer = null;
  let currentElement = null;
  let pixelAnalysisResult = null;

  // --- INJECT HTML ---
  const checkerHTML = `
            <div id="drag-handle" style="cursor: move; padding: 0.5rem 1rem; background-color: #F3F4F6; border-bottom: 1px solid #E5E7EB; border-top-left-radius: 0.5rem; border-top-right-radius: 0.5rem; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="font-weight: 700; font-size: 1.125rem; color: #1F2937;"><img src="SPYGLASS_ICON_URL_PLACEHOLDER" alt="Spyglass Icon" style="height: 1.2em; vertical-align: middle; margin-right: 0.5em;"> Spyglass Contrast Checker (v${version})</h3>
                <button id="close-checker-btn" aria-label="Close" style="font-size: 1.25rem; font-weight: 700; color: #6B7280; line-height: 1; padding: 0.25rem; border-radius: 0.25rem;">X</button>
            </div>
            <div id="checker-body" style="padding: 1rem; overflow-y: auto; flex-grow: 1;">
                <div id="color-inputs-wrapper" style="display: flex; align-items: flex-end; gap: 0.5rem; margin-bottom: 1rem;">
                    <!-- FG Section -->
                    <div id="fg-container" style="flex-grow: 1;">
                        <label for="fg-color" style="display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem;">Foreground</label>
                        <div style="display: flex; align-items: flex-end; gap: 0.5rem;">
                            <div style="position: relative; width: 1rem; height: 2rem; flex-shrink: 0;">
                                <div id="fg-swatch-btn" style="width: 100%; height: 100%; border: 1px solid #D1D5DB; border-radius: 0.375rem; background-color: #000000;"></div>
                                <input type="color" id="fg-swatch" value="#000000" title="Pick color" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; padding: 0; border: none;">
                            </div>
                            <div style="position: relative; flex-grow: 1; display: flex; align-items: flex-end; gap: 0.5rem;">
                                <div id="fg-input-wrapper" style="flex-grow: 1; position: relative;">
                                    <input type="text" id="fg-color" value="#000000" style="width: 100%; height: 2rem; padding: 0.25rem 2.25rem 0.25rem 0.5rem; border: 1px solid #D1D5DB; border-radius: 0.375rem; font-size: 0.875rem;">
                                    <button id="copy-fg" title="Copy hex code" style="position: absolute; right: 0; top: 0; bottom: 0; width: 2.25rem; background: transparent; border: none; cursor: pointer; color: #6B7280; display: flex; align-items: center; justify-content: center;">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                    </button>
                                </div>
                                <div id="fg-suggestion" style="display: none; cursor: pointer; align-items: center; gap: 0.125rem; flex-shrink: 0; flex-direction: column;">
                                    <div id="fg-suggestion-swatch" style="width: 18px; height: 18px; border-radius: 0.375rem; border: 1px solid #D1D5DB; background-color: white;"></div>
                                    <span id="fg-suggestion-label" style="font-weight: 500; color: #4B5563; font-size: 0.75rem; line-height: 1;">4.5:1</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <!-- Swap Section -->
                    <div style="flex-shrink: 0; padding-bottom: 0.25rem;">
                         <button id="swap-colors-btn" title="Swap colors" style="background: none; border: none; padding: 0; cursor: pointer;">
                             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(90deg);"><path d="M17 3v18M7 21V3M4 7l3-3 3 3M20 17l-3 3-3-3"/></svg>
                         </button>
                    </div>
                    <!-- BG Section -->
                    <div id="bg-container" style="flex-grow: 1;">
                        <label for="bg-color" style="display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem;">Background</label>
                        <div style="display: flex; align-items: flex-end; gap: 0.5rem;">
                            <div style="position: relative; width: 1rem; height: 2rem; flex-shrink: 0;">
                                <div id="bg-swatch-btn" style="width: 100%; height: 100%; border: 1px solid #D1D5DB; border-radius: 0.375rem; background-color: #ffffff;"></div>
                                <input type="color" id="bg-swatch" value="#ffffff" title="Pick color" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; padding: 0; border: none;">
                            </div>
                            <div style="position: relative; flex-grow: 1; display: flex; align-items: flex-end; gap: 0.5rem;">
                                <div id="bg-input-wrapper" style="position: relative; flex-grow: 1;">
                                    <input type="text" id="bg-color" value="#FFFFFF" style="width: 100%; height: 2rem; padding: 0.25rem 2.25rem 0.25rem 0.5rem; border: 1px solid #D1D5DB; border-radius: 0.375rem; font-size: 0.875rem;">
                                    <button id="copy-bg" title="Copy hex code" style="position: absolute; right: 0; top: 0; bottom: 0; width: 2.25rem; background: transparent; border: none; cursor: pointer; color: #6B7280; display: flex; align-items: center; justify-content: center;">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                    </button>
                                </div>
                                 <div id="bg-suggestion" style="display: none; cursor: pointer; align-items: center; gap: 0.125rem; flex-shrink: 0; flex-direction: column;">
                                    <div id="bg-suggestion-swatch" style="width: 18px; height: 18px; border-radius: 0.375rem; border: 1px solid #D1D5DB; background-color: white;"></div>
                                    <span id="bg-suggestion-label" style="font-weight: 500; color: #4B5563; font-size: 0.75rem; line-height: 1;">4.5:1</span>
                                 </div>
                            </div>
                        </div>
                    </div>
                </div>

                <details id="tweak-details" style="margin-bottom: 1rem;"><summary style="font-weight: 600; font-size: 1rem; color: #374151; cursor: pointer; padding: 0.5rem; background: #F9FAFB; border-radius: 0.375rem; display: flex; justify-content: space-between; align-items: center;"><span>🎨 Tweak Panel</span></summary>
                  <div id="tweak-panel" style="background-color: #F9FAFB; padding: 0.75rem; border-radius: 0.5rem; margin-bottom: 1rem;">
                      <div id="tweak-panel-header" style="cursor: default; font-weight: 600; font-size: 1rem; overflow: hidden; line-height: 1.6; padding-bottom: 0.5rem; border-bottom: 1px solid #E5E7EB;">
                          <button id="tweak-target-btn" title="Toggle target contrast for tweaks" style="float: right; background-color: #E5E7EB; color: #374151; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.5rem; border-radius: 0.375rem; border: 1px solid #D1D5DB; cursor: pointer; margin-left: 0.5rem;">
                              Target: 4.5:1
                          </button>
                          <button id="pixel-analysis-btn" title="Enable pixel-level contrast analysis" style="float: right; background-color: #3B82F6; color: #ffffff; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.5rem; border-radius: 0.375rem; border: 1px solid #2563EB; cursor: pointer;">
                              Pixel Analysis: OFF
                          </button>
                          <span>Tweak Colors</span>
                      </div>
                      <div style="display: flex; flex-direction: column; gap: 0.5rem; padding-top: 0.75rem;">
                          <div style="display: grid; grid-template-columns: 5rem 1fr; align-items: center; gap: 0.5rem;">
                              <div style="font-weight: 500;">Foreground</div>
                              <div id="fg-tweak-controls"></div>
                          </div>
                          <div style="display: grid; grid-template-columns: 5rem 1fr; align-items: center; gap: 0.5rem;">
                              <div style="font-weight: 500;">Background</div>
                              <div id="bg-tweak-controls"></div>
                          </div>
                      </div>
                  </div>
                </details>

                <details id="preview-details" style="margin-bottom: 1rem;">
                <summary id="preview-summary" style="font-weight: 600; font-size: 1.1rem; padding: 0.6rem 1rem; border-radius: 0.5rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s;">
                  <span id="mini-preview-text" style="font-weight: bold; font-size: 1.1rem; padding: 0.1rem 0.5rem; border-radius: 0.3rem;">Preview and Contrast</span>
                  <span id="mini-ratio-pill" style="margin-left: auto; background-color: #F3F4F6; padding: 0.2rem 0.7rem; border-radius: 9999px; font-weight: 700; font-size: 0.875rem; border: 2px solid #D1D5DB; line-height: 1.4; text-align: center; white-space: nowrap; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; min-width: 4.5rem;">21.00:1</span>
                </summary>

                  <div id="preview-contrast-tabs" style="margin-bottom: 1rem;">
                    <div role="tablist" aria-label="Contrast Results" style="display: flex; gap: 0.25rem; padding-left: 0.5rem; margin-bottom: -1px; position: relative; z-index: 10; justify-content: space-between; align-items: flex-end;">
                        <div style="display: flex; gap: 0.25rem;">
                          <button id="tab-btn-preview" role="tab" aria-selected="true" aria-controls="tab-panel-preview" class="spyglass-tab spyglass-tab-active">Preview</button>
                          <button id="tab-btn-details" role="tab" aria-selected="false" aria-controls="tab-panel-details" class="spyglass-tab spyglass-tab-inactive">
                            <span id="contrast-ratio-display" style="font-size: 1.5em; font-weight: 900; display: block; line-height: 1.1;">21.00:1</span>
                            <span style="display: block; font-size: 0.8rem; line-height: 1.2;">Contrast Details</span>
                          </button>
                        </div>
                        <div class="spyglass-algo-wrapper">
                            <span class="spyglass-algo-label">Algorithm</span>
                            <label class="spyglass-algo-option">
                                <input type="radio" name="contrast-algorithm" id="algo-wcag" value="wcag" checked> WCAG
                            </label>
                            <label class="spyglass-algo-option">
                                <input type="radio" name="contrast-algorithm" id="algo-apca" value="apca"> APCA
                            </label>
                        </div>
                          </div>
                      <div id="tab-content-area" style="border: 1px solid #D1D5DB; border-radius: 0.5rem; border-top-left-radius: 0; background-color: #FFFFFF; height: 13.5rem; overflow-y: auto; position: relative;">

                          <!-- Preview Pane (Visible by default) -->
                          <div id="tab-panel-preview" role="tabpanel" aria-labelledby="tab-btn-preview" style="display: block; width: 100%; min-height: 100%; padding: 1rem; box-sizing: border-box; border-radius: 0.375rem;">
                              <h4 style="font-weight: 700; font-size: 1.125rem; margin: 0 0 0.5rem 0;">Preview Text</h4>
                              <p id="preview-line-normal" style="font-size: 1rem; margin: 0 0 0.5rem 0; padding: 0.25rem;">The quick brown fox jumps over the lazy dog. <span id="preview-status-normal"></span></p>
                              <p id="preview-line-large" style="font-size: 19px; font-weight: 700; margin: 0; padding: 0.25rem;">The quick brown fox jumps over the lazy dog. <span id="preview-status-large"></span></p>
                          </div>

                          <!-- Details Pane (Hidden by default) -->
                          <div id="tab-panel-details" role="tabpanel" aria-labelledby="tab-btn-details" style="display: none; width: 100%; min-height: 100%; padding: 1rem; box-sizing: border-box;">
                              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; height: 100%; align-content: start;">
                                  <!-- AA Column -->
                                  <div>
                                      <div style="font-weight: 700; color: #374151; border-bottom: 1px solid #E5E7EB; margin-bottom: 0.5rem; padding-bottom: 0.25rem;">AA</div>
                                      <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem; font-size: 0.9rem; align-items: baseline;"><span>Normal (4.5:1):</span> <span id="status-aa-normal" style="font-weight: 700;">Pass</span></div>
                                      <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem; font-size: 0.9rem; align-items: baseline;"><span>Large (3:1):</span> <span id="status-aa-large" style="font-weight: 700;">Pass</span></div>
                                      <div style="margin-bottom: 0.5rem; font-size: 0.75rem; color: #6B7280; line-height: 1.2; font-style: italic;">(24px+ or 19px+ bold)</div>
                                      <div style="display: flex; justify-content: space-between; font-size: 0.9rem; align-items: baseline;"><span>Graphics (3:1):</span> <span id="status-aa-graphics" style="font-weight: 700;">Pass</span></div>
                                  </div>
                                  <!-- AAA Column -->
                                  <div>
                                      <div style="font-weight: 700; color: #374151; border-bottom: 1px solid #E5E7EB; margin-bottom: 0.5rem; padding-bottom: 0.25rem;">AAA</div>
                                      <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem; font-size: 0.9rem; align-items: baseline;"><span>Normal (7:1):</span> <span id="status-aaa-normal" style="font-weight: 700;">Pass</span></div>
                                      <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem; font-size: 0.9rem; align-items: baseline;"><span>Large (4.5:1):</span> <span id="status-aaa-large" style="font-weight: 700;">Pass</span></div>
                                      <div style="margin-bottom: 0.5rem; font-size: 0.75rem; color: #6B7280; line-height: 1.2; font-style: italic;">(24px+ or 19px+ bold)</div>
                                  </div>
                              </div>
                          </div>

                      </div>
                  </div>
                </details>

                <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
                    <a id="activate-serial-picker-btn" href="https://chromewebstore.google.com/category/extensions" target="_blank" title="Select foreground and background pixels one by one" style="flex-grow: 1; flex-basis: 0; background-color: #1E40AF; color: white; font-weight: 700; padding: 0.5rem; border-radius: 0.5rem; text-decoration: none; text-align: center; cursor: pointer; transition: background-color 0.2s; line-height: 1.4; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                        Serial Picker<span style="font-size: 0.7rem; display: block;">(coming soon)</span>
                    </a>
                    <div style="display: flex; flex-direction: column; flex-grow: 1; flex-basis: 0; gap: 0.5rem;">
                         <div style="display: flex; gap: 0.5rem; align-items: stretch;">
                            <button id="activate-element-picker-btn" title="Select an element to get its text and background color" style="flex: 1 1 0%; min-width: 0; background-color: #14873D; color: white; font-weight: 700; padding: 0.5rem; border-radius: 0.5rem; border: none; cursor: pointer; transition: background-color 0.2s; line-height: 1.4; min-height: 4rem; display: flex; align-items: center; justify-content: center; text-align: center;">
                                Element Picker
                            </button>
                            <button id="element-picker-mode-toggle" title="Toggle between checking resting and hover styles" style="width: 5rem; background-color: #166534; color: white; font-weight: 700; padding: 0.5rem; border-radius: 0.5rem; border: none; cursor: pointer; transition: background-color 0.2s; font-size: 0.875rem;">
                                Resting
                            </button>
                        </div>
                         <button id="activate-overlay-picker-btn" title="Select text on an image/gradient to find the contrast range" style="flex: 1 1 0%; min-width: 0; background-color: #5B21B6; color: white; font-weight: 700; padding: 0.5rem; border-radius: 0.5rem; text-decoration: none; text-align: center; cursor: pointer; transition: background-color 0.2s; line-height: 1.4; display: flex; flex-direction: column; align-items: center; justify-content: center; border: none;">
                             Overlay Picker<span style="font-size: 0.7rem; display: block;">(pixel analysis)</span>
                         </button>
                    </div>
                </div>

                <div id="picker-status" style="text-align: center; font-size: 0.875rem; color: #1D4ED8; font-weight: 600; min-height: 3rem; display: flex; align-items: center; justify-content: center; visibility: hidden; margin-bottom: 0.5rem;">
                    <!-- Status text will be inserted here -->
                </div>
                <p style="text-align: center; font-size: 0.75rem; color: #6B7280; padding: 0.5rem 0 0.25rem 0; border-top: 1px solid #6B7280; margin-top: 0.25rem;">
                    Spyglass is created and maintained by <a href="https://seamonsterstudios.com" target="_blank" rel="noopener" style="color: #6B7280; font-size: 0.75rem; text-decoration: underline !important;">SeaMonster Studios</a>
                </p>

            </div>
            <div id="scroll-controls" style="display: none; position: absolute; bottom: 1rem; right: 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
                <button id="scroll-up-btn" title="Scroll to top" style="background-color: rgba(209, 213, 219, 0.7); border: 1px solid #9CA3AF; border-radius: 9999px; width: 2.5rem; height: 2.5rem; display: flex; align-items: center; justify-content: center; cursor: pointer;"></button>
                <button id="scroll-down-btn" title="Scroll to bottom" style="background-color: rgba(209, 213, 219, 0.7); border: 1px solid #9CA3AF; border-radius: 9999px; width: 2.5rem; height: 2.5rem; display: flex; align-items: center; justify-content: center; cursor: pointer;"></button>
            </div>
        `;

  const styleSheet = document.createElement("style");
  const styles = [
    '#contrast-checker-container { box-sizing: border-box; text-align: left; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #374151; line-height: 1.5; }',
    "#contrast-checker-container * { box-sizing: border-box; font-family: inherit; line-height: inherit; color: inherit; }",
    "#contrast-checker-container h3, #contrast-checker-container h4, #contrast-checker-container label, #contrast-checker-container span, #contrast-checker-container div, #contrast-checker-container p { margin: 0; padding: 0; background: none; border: none; }",
    "#contrast-checker-container a { text-decoration: none !important; color: inherit; }",
    "#contrast-checker-container button { font-size: 1rem; background-color: transparent; background-image: none; border: none; padding: 0; margin: 0; cursor: pointer; text-transform: none; }",
    "#contrast-checker-container input { font-size: 1rem; margin: 0; padding: 0; line-height: normal; }",
    "#contrast-checker-container details { display: block; margin: 0.75rem 0; }",
    "#contrast-checker-container summary { list-style: none; outline: none; user-select: none; cursor: pointer; display: flex; align-items: center; }",
    "#contrast-checker-container summary::before { content: '\\25BA'; display: inline-block; margin-right: 0.5rem; transition: transform 0.2s ease-in-out; color: var(--spyglass-summary-arrow-color, #374151); }",
    "#contrast-checker-container details[open] summary::before { transform: rotate(90deg); }",
    "#contrast-checker-container summary { border: 1px solid #D1D5DB; border-radius: 0.375rem; }",
    "#contrast-checker-container details[open] summary { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }",
    "#contrast-checker-container summary::-webkit-details-marker { display: none; }",
    "#contrast-checker-container button:hover { opacity: 0.9; }",
    "#contrast-checker-loupe-swatch { position: fixed; width: 30px; height: 30px; border: 2px solid #fff; box-shadow: 0 0 5px rgba(0,0,0,0.5); display: none; pointer-events: none; z-index: 2147483647; }",
    "#contrast-checker-container .tweak-btn { background-color: #E5E7EB; border: 1px solid #D1D5DB; border-radius: 9999px; width: 1.5rem; height: 1.5rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; background-repeat: no-repeat; background-position: center; background-size: 12px 12px; padding: 0 !important; }",
    "#contrast-checker-container .tweak-btn:hover { background-color: #D1D5DB; }",
    "#contrast-checker-container #tweak-target-btn { float: right; background-color: #E5E7EB; color: #374151; font-size: 0.75rem !important; font-weight: 600; padding: 0.25rem 0.5rem !important; border-radius: 0.375rem; border: 1px solid #D1D5DB; cursor: pointer; margin-left: 0.5rem; }",
    "#contrast-checker-container #tweak-target-btn:hover { background-color: #D1D5DB; }",
    "body.element-picking-cursor, body.element-picking-cursor * { cursor: pointer !important; }",
    "#contrast-checker-container #fg-suggestion:hover, #contrast-checker-container #bg-suggestion:hover { opacity: 0.8; }",
    "#contrast-checker-container #swap-colors-btn svg { stroke: #6B7280 !important; }",
    "#contrast-checker-container #swap-colors-btn:hover svg { stroke: #1F2937 !important; }",
    "#contrast-checker-container #scroll-controls button { background-repeat: no-repeat; background-position: center; background-size: 20px 20px; }",
    "#contrast-checker-container #scroll-controls button:hover { background-color: rgba(156, 163, 175, 0.7) !important; }",
    "#contrast-checker-container .pass { color: #059669 !important; }",
    "#contrast-checker-container .fail { color: #dc2626 !important; }",
    "#contrast-checker-container .picking-active { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.7); transition: box-shadow 0.2s ease-in-out; border-radius: 0.5rem; }",
    ".element-picker-hover-outline { outline: 2px solid #3472D8 !important; box-shadow: 0 0 10px rgba(52, 114, 216, 0.7) !important; outline-offset: 2px; }",
    "#contrast-checker-container #activate-serial-picker-btn { color: #ffffff !important; text-decoration: none !important; }",
    "#contrast-checker-container #activate-overlay-picker-btn { color: #ffffff !important; text-decoration: none !important; }",
    "#contrast-checker-container #activate-element-picker-btn { color: #ffffff !important; }",
    "#contrast-checker-container #element-picker-mode-toggle { color: #ffffff !important; }",
    "#contrast-checker-container #close-checker-btn { color: #6B7280 !important; }",
    "#contrast-checker-container #close-checker-btn:hover { background-color: #E5E7EB !important; color: #1F2937 !important; }",
    "#contrast-checker-container #activate-serial-picker-btn:hover { background-color: #6B7280 !important; }",
    "#contrast-checker-container #activate-overlay-picker-btn:hover { background-color: #6B7280 !important; }",
    "#contrast-checker-container .spyglass-tab { padding: 0.75rem 1.5rem !important; border-radius: 0.5rem 0.5rem 0 0; font-size: 1rem; }",
    "#contrast-checker-container .spyglass-tab-active { background-color: #FFFFFF !important; border: 1px solid #D1D5DB !important; border-bottom: 1px solid #FFFFFF !important; color: #1F2937 !important; font-weight: 700 !important; cursor: default !important; }",
    "#contrast-checker-container .spyglass-tab-inactive { background-color: #F3F4F6 !important; border: 1px solid #E5E7EB !important; border-bottom: 1px solid #D1D5DB !important; color: #6B7280 !important; font-weight: 500 !important; cursor: pointer !important; }",
    "#contrast-checker-container .spyglass-tab-inactive:hover { background-color: #E5E7EB !important; color: #374151 !important; }",
    "#contrast-checker-container #contrast-ratio-display { font-size: 1.5em; font-weight: 900; }",
    ".spyglass-preview-highlight { outline: 2px dashed #2563EB !important; outline-offset: 2px !important; box-shadow: 0 0 0 4px #ffffff !important; border-radius: 4px; transition: all 0.2s ease; }",
    '#contrast-checker-container .spyglass-algo-wrapper { display: flex; flex-direction: column; align-items: flex-start; padding: 0 0.5rem 0.25rem; }',
    '#contrast-checker-container .spyglass-algo-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6B7280; margin-bottom: 0.2rem; }',
    '#contrast-checker-container .spyglass-algo-option { display: flex; align-items: center; gap: 0.3rem; cursor: pointer; font-size: 0.8rem; color: #374151; line-height: 1.6; }',
    '#contrast-checker-container .spyglass-algo-option input { width: auto; height: auto; cursor: pointer; }',
    '#contrast-checker-container .spyglass-algo-option input[type="radio"] { appearance: auto; -webkit-appearance: radio; width: auto; height: auto; cursor: pointer; }'
  ].join(" ");
  styleSheet.innerText = styles;
  document.head.appendChild(styleSheet);

  const container = document.createElement("div");
  container.id = "contrast-checker-container";
  container.style.cssText =
    "width: 26rem; background-color: white; border-radius: 0.5rem; border: 1px solid #E5E7EB; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); position:fixed; top:20px; left:20px; z-index: 2147483647; display: flex; flex-direction: column; max-height: calc(100vh - 40px);";
  const finalCheckerHTML = checkerHTML.replace(
    "SPYGLASS_ICON_URL_PLACEHOLDER",
    chrome.runtime.getURL("icon-128.png"),
  );
  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(finalCheckerHTML, "text/html");
  while (parsedDoc.body.firstChild) {
    container.appendChild(parsedDoc.body.firstChild);
  }
  document.body.appendChild(container);

  // --- DOM ELEMENT REFERENCES ---
  const fgColorInput = document.getElementById("fg-color");
  const bgColorInput = document.getElementById("bg-color");
  const fgSwatch = document.getElementById("fg-swatch");
  const bgSwatch = document.getElementById("bg-swatch");
  const fgSwatchBtn = document.getElementById("fg-swatch-btn");
  const bgSwatchBtn = document.getElementById("bg-swatch-btn");
  const elementPickerBtn = document.getElementById(
    "activate-element-picker-btn",
  );
  const overlayPickerBtn = document.getElementById(
    "activate-overlay-picker-btn",
  );
  const modeToggleBtn = document.getElementById("element-picker-mode-toggle");
  const pickerStatus = document.getElementById("picker-status");
  const closeBtn = document.getElementById("close-checker-btn");
  const copyFgBtn = document.getElementById("copy-fg");
  const copyBgBtn = document.getElementById("copy-bg");
  const fgContainer = document.getElementById("fg-container");
  const bgContainer = document.getElementById("bg-container");
  const fgSuggestionBox = document.getElementById("fg-suggestion");
  const bgSuggestionBox = document.getElementById("bg-suggestion");
  const fgSuggestionSwatch = document.getElementById("fg-suggestion-swatch");
  const bgSuggestionSwatch = document.getElementById("bg-suggestion-swatch");
  const fgSuggestionLabel = document.getElementById("fg-suggestion-label");
  const bgSuggestionLabel = document.getElementById("bg-suggestion-label");
  const swapBtn = document.getElementById("swap-colors-btn");
  const checkerBody = document.getElementById("checker-body");
  const scrollControls = document.getElementById("scroll-controls");
  const scrollUpBtn = document.getElementById("scroll-up-btn");
  const scrollDownBtn = document.getElementById("scroll-down-btn");
  const tweakTargetBtn = document.getElementById("tweak-target-btn");
  const contrastRatioDisplay = document.getElementById(
    "contrast-ratio-display",
  );
  const previewSummary = document.getElementById("preview-summary");
  const miniPreviewText = document.getElementById("mini-preview-text");
  const miniRatioPill = document.getElementById("mini-ratio-pill");

  // Tab References
  const tabPreviewBtn = document.getElementById("tab-btn-preview");
  const tabDetailsBtn = document.getElementById("tab-btn-details");
  const panelPreview = document.getElementById("tab-panel-preview");
  const panelDetails = document.getElementById("tab-panel-details");

  const previewArea = document.getElementById("tab-panel-preview");
  const tweakPanel = document.getElementById("tweak-panel");
  const algoApca = document.getElementById("algo-apca");


  let resizeObserver;

  // --- HELPER & LOGIC FUNCTIONS ---

  function hexToRgba(hex) {
    if (!hex) return null;
    let result;
    if (hex.length === 9) {
      result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
        hex,
      );
      return result
        ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16),
            a: parseInt(result[4], 16) / 255,
          }
        : null;
    } else {
      hex = hex.replace(
        /^#?([a-f\d])([a-f\d])([a-f\d])$/i,
        (m, r, g, b) => r + r + g + g + b + b,
      );

      // Fallback if they manually typed an 8-character hex without the #
      if (hex.length === 8 && !hex.startsWith("#")) {
        result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
          hex,
        );
        return result
          ? {
              r: parseInt(result[1], 16),
              g: parseInt(result[2], 16),
              b: parseInt(result[3], 16),
              a: parseInt(result[4], 16) / 255,
            }
          : null;
      }

      result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16),
            a: 1,
          }
        : null;
    }
  }

  function rgbaStringToHex(rgba) {
    const parts = rgba
      .substring(rgba.indexOf("(") + 1, rgba.lastIndexOf(")"))
      .split(/,\s*/);
    if (parts.length < 3) return "#000000";
    const r = parseInt(parts[0]),
      g = parseInt(parts[1]),
      b = parseInt(parts[2]);
    let a = 1;
    if (parts.length === 4) a = parseFloat(parts[3]);

    let alphaHex = Math.round(a * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
    if (alphaHex === "FF")
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}${alphaHex}`;
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()
    );
  }

  // Blends topRgba over bottomRgba (True Alpha Compositing)
  function blendRgb(topRgba, bottomRgba) {
    const tA = topRgba.a !== undefined ? topRgba.a : 1;
    const bA = bottomRgba.a !== undefined ? bottomRgba.a : 1;

    // If top layer is fully opaque, we just see the top layer
    if (tA === 1) return { r: topRgba.r, g: topRgba.g, b: topRgba.b, a: 1 };
    // If top layer is fully transparent, we just see the bottom layer
    if (tA === 0)
      return { r: bottomRgba.r, g: bottomRgba.g, b: bottomRgba.b, a: bA };

    // Standard Porter-Duff source-over alpha compositing
    const outA = tA + bA * (1 - tA);
    if (outA === 0) return { r: 0, g: 0, b: 0, a: 0 };

    return {
      r: Math.round((topRgba.r * tA + bottomRgba.r * bA * (1 - tA)) / outA),
      g: Math.round((topRgba.g * tA + bottomRgba.g * bA * (1 - tA)) / outA),
      b: Math.round((topRgba.b * tA + bottomRgba.b * bA * (1 - tA)) / outA),
      a: outA,
    };
  }

  function getLuminance(r, g, b) {
    const a = [r, g, b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }

  function getContrast(rgb1, rgb2) {
    const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
    const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
  }

  function getAPCAContrast(fg, bg) {
    const fgY = sRGBtoY([fg.r, fg.g, fg.b]);
    const bgY = sRGBtoY([bg.r, bg.g, bg.b]);
    return Math.abs(APCAcontrast(fgY, bgY));
  }

  function getActiveContrast(fg, bg) {
    return algoApca.checked ? getAPCAContrast(fg, bg) : getContrast(fg, bg);
  }
  
  function getElementBackgroundColor(element) {
    let el = element;
    while (el) {
      const style = window.getComputedStyle(el);
      const bgColor = style.backgroundColor;

      if (
        bgColor &&
        bgColor !== "rgba(0, 0, 0, 0)" &&
        bgColor !== "transparent"
      ) {
        return bgColor;
      }

      const beforeStyle = window.getComputedStyle(el, "::before");
      const beforeBg = beforeStyle.backgroundColor;
      if (
        beforeBg &&
        beforeBg !== "rgba(0, 0, 0, 0)" &&
        beforeBg !== "transparent"
      ) {
        return beforeBg;
      }

      const afterStyle = window.getComputedStyle(el, "::after");
      const afterBg = afterStyle.backgroundColor;
      if (
        afterBg &&
        afterBg !== "rgba(0, 0, 0, 0)" &&
        afterBg !== "transparent"
      ) {
        return afterBg;
      }

      if (el.tagName === "BODY" || el.tagName === "HTML") {
        return "rgba(255, 255, 255, 1)";
      }
      el = el.parentElement;
    }
    return "rgba(255, 255, 255, 1)";
  }

  // --- GRADIENT BUILDER ---
  function generatePreviewGradient(pixelResult) {
    let colors = [];
    if (
      pixelResult.type === "image" &&
      Array.isArray(pixelResult.sampledPixels) &&
      pixelResult.sampledPixels.length > 0
    ) {
      colors = pixelResult.sampledPixels;
    } else if (
      pixelResult.type === "gradient" &&
      Array.isArray(pixelResult.colors) &&
      pixelResult.colors.length > 0
    ) {
      colors = pixelResult.colors;
    }
    if (colors.length === 0) return null;

    const withLum = colors.map((c) => ({
      c,
      lum: getLuminance(c.r, c.g, c.b),
    }));
    withLum.sort((a, b) => a.lum - b.lum);

    const darkestOverall = withLum[0].c;
    const lightestOverall = withLum[withLum.length - 1].c;

    const buckets = { r: [], g: [], b: [] };
    colors.forEach((c) => {
      const max = Math.max(c.r, c.g, c.b);
      if (max === 0) return;
      if (c.r === max) buckets.r.push(c);
      else if (c.g === max) buckets.g.push(c);
      else buckets.b.push(c);
    });

    function channelExtremes(bucket) {
      if (bucket.length === 0)
        return { light: lightestOverall, dark: darkestOverall };
      const sorted = bucket
        .slice()
        .sort(
          (a, b) => getLuminance(a.r, a.g, a.b) - getLuminance(b.r, b.g, b.b),
        );
      return { light: sorted[sorted.length - 1], dark: sorted[0] };
    }

    const red = channelExtremes(buckets.r);
    const green = channelExtremes(buckets.g);
    const blue = channelExtremes(buckets.b);

    const stops = [
      darkestOverall,
      lightestOverall,
      red.light,
      red.dark,
      green.light,
      green.dark,
      blue.light,
      blue.dark,
      darkestOverall,
    ].map((c) => rgbToHex(c.r, c.g, c.b));

    const pct = stops
      .map((hex, i) => `${hex} ${Math.round((i / (stops.length - 1)) * 100)}%`)
      .join(", ");
    return `linear-gradient(to right, ${pct})`;
  }

  function updateScrollButtonsVisibility() {
    if (checkerBody.scrollHeight > checkerBody.clientHeight) {
      scrollControls.style.display = "flex";
    } else {
      scrollControls.style.display = "none";
    }
  }

function updateMiniRatioPill(minContrast, maxContrast, isRange, tweakTarget, usingAPCA) {
    const pillLabel = (val) =>
      usingAPCA ? `Lc ${val.toFixed(1)}` : `${val.toFixed(2)}:1`;
    const passColor = "#059669";
    const failColor = "#dc2626";
    const pillColor = minContrast >= tweakTarget ? passColor : failColor;

    miniRatioPill.style.color = pillColor;
    miniRatioPill.style.borderColor = pillColor;
    miniRatioPill.style.backgroundColor = "#F3F4F6";

    if (isRange) {
      miniRatioPill.textContent = "";
      const spanMin = document.createElement("span");
      spanMin.style.cssText =
        "display:block; line-height:1.3; font-size:0.8rem;";
      spanMin.textContent = pillLabel(minContrast);
      const spanMax = document.createElement("span");
      spanMax.style.cssText = `display:block; line-height:1.3; font-size:0.8rem; border-top:1px solid ${pillColor}; margin-top:1px; padding-top:1px;`;
      spanMax.textContent = pillLabel(maxContrast);
      miniRatioPill.appendChild(spanMin);
      miniRatioPill.appendChild(spanMax);
    } else {
      miniRatioPill.textContent = pillLabel(minContrast);
    }
  }

  function updateUI() {
    const fgHexWithAlpha = fgColorInput.value.trim().toUpperCase();
    const bgHexWithAlpha = bgColorInput.value.trim().toUpperCase();
    const fgRgba = hexToRgba(fgHexWithAlpha);
    const bgRgba = hexToRgba(bgHexWithAlpha);

    let currentFontSize = "unknown";
    let currentFontWeight = "unknown";

    if (currentElement) {
      const computedStyle = window.getComputedStyle(currentElement);
      currentFontSize = computedStyle.fontSize;
      currentFontWeight = computedStyle.fontWeight;
    }
    const usingAPCA = algoApca.checked;
    const contrastLabel = (val) =>
      usingAPCA ? `Lc ${val.toFixed(1)}` : `${val.toFixed(2)}:1`;
    tweakTargetBtn.textContent = `${tweakTargetContrast}:1`;
    tweakPanel.style.display = "block";

    if (!fgRgba || !bgRgba) return;

    // Remove alpha channel when assigning to standard HTML color inputs (they only support 6-char hex)
    fgSwatch.value =
      fgHexWithAlpha.length > 7
        ? fgHexWithAlpha.substring(0, 7)
        : fgHexWithAlpha;
    bgSwatch.value =
      bgHexWithAlpha.length > 7
        ? bgHexWithAlpha.substring(0, 7)
        : bgHexWithAlpha;

    // Update our visual swatch overlays to show the true color with alpha
    fgSwatchBtn.style.backgroundColor = fgHexWithAlpha;
    bgSwatchBtn.style.backgroundColor = bgHexWithAlpha;

    // True compositing: Everything eventually sits on a white browser window
    const baseWhite = { r: 255, g: 255, b: 255, a: 1 };

    // Calculate effective screen colors
    const effectiveBg = blendRgb(bgRgba, baseWhite);
    const effectiveFg = blendRgb(fgRgba, effectiveBg);

    const blendedFgHex = rgbToHex(effectiveFg.r, effectiveFg.g, effectiveFg.b);
    const effectiveBgHex = rgbToHex(
      effectiveBg.r,
      effectiveBg.g,
      effectiveBg.b,
    );

    previewArea.style.color = blendedFgHex;
    miniPreviewText.style.color = blendedFgHex;
    previewSummary.style.setProperty(
      "--spyglass-summary-arrow-color",
      blendedFgHex,
    );

    let contrast, minContrast, maxContrast, isRange, contrastDisplay;

    if (pixelAnalysisResult) {
      minContrast = pixelAnalysisResult.minContrast;
      maxContrast = pixelAnalysisResult.maxContrast;
      isRange = true;
      contrastDisplay = usingAPCA
        ? `Lc ${minContrast.toFixed(1)}–${maxContrast.toFixed(1)}`
        : `${minContrast.toFixed(2)}–${maxContrast.toFixed(2)}:1`;

      const typeLabel =
        pixelAnalysisResult.type === "gradient" ? "gradient" : "image";
      contrastRatioDisplay.textContent = contrastDisplay + " ";
      const typeLabelSpan = document.createElement("span");
      typeLabelSpan.style.cssText = "font-size:0.6em; color:#6B7280;";
      typeLabelSpan.textContent = `(${typeLabel})`;
      contrastRatioDisplay.appendChild(typeLabelSpan);

      contrast = minContrast;

      const gradientCss = generatePreviewGradient(pixelAnalysisResult);
      if (gradientCss) {
        previewArea.style.backgroundImage = gradientCss;
        previewArea.style.backgroundColor = "";
        previewSummary.style.backgroundImage = gradientCss;
        previewSummary.style.backgroundColor = "";
      } else {
        previewArea.style.backgroundImage = "";
        previewArea.style.backgroundColor = effectiveBgHex;
        previewSummary.style.backgroundImage = "";
        previewSummary.style.backgroundColor = effectiveBgHex;
      }

      miniRatioPill.style.backgroundColor = "#F3F4F6";
    } else {
      contrast = getActiveContrast(effectiveFg, effectiveBg);
      minContrast = contrast;
      maxContrast = contrast;
      isRange = false;
      contrastDisplay = contrastLabel(contrast);
      contrastRatioDisplay.textContent = contrastDisplay;

      previewArea.style.backgroundImage = "";
      previewArea.style.backgroundColor = effectiveBgHex;
      previewSummary.style.backgroundImage = "";
      previewSummary.style.backgroundColor = effectiveBgHex;
    }

    const ratioColor = contrast < tweakTargetContrast ? "#dc2626" : "#059669";
    contrastRatioDisplay.style.color = ratioColor;

    updateMiniRatioPill(minContrast, maxContrast, isRange, tweakTargetContrast, usingAPCA);


    const results = {
      "aa-normal": contrast >= 4.5,
      "aa-large": contrast >= 3,
      "aa-graphics": contrast >= 3,
      "aaa-normal": contrast >= 7,
      "aaa-large": contrast >= 4.5,
    };

    for (const key in results) {
      const el = document.getElementById(`status-${key}`);
      el.textContent = results[key] ? "Pass" : "Fail";
      el.className = results[key] ? "pass" : "fail";
    }

    const passNormal = contrast >= 4.5;
    const passLarge = contrast >= 3.0;

    const badgeStyle =
      "padding: 0.1rem 0.4rem; border-radius: 0.25rem; font-size: 0.75em; font-weight: bold; margin-left: 0.5rem; vertical-align: middle; display: inline-block;";
    const passStyle = "background-color: #065f46; color: white;";
    const failStyle = "background-color: #b91c1c; color: white;";

    const statusNormal = document.getElementById("preview-status-normal");
    statusNormal.textContent = passNormal
      ? detectedTextCategory === "normal"
        ? `Regular Text (${currentFontSize}, ${currentFontWeight} weight): Pass`
        : "Regular Text: Pass"
      : detectedTextCategory === "normal"
        ? `Regular Text (${currentFontSize}, ${currentFontWeight} weight): Fail`
        : "Regular Text: Fail";
    statusNormal.style.cssText =
      badgeStyle + (passNormal ? passStyle : failStyle);

    const statusLarge = document.getElementById("preview-status-large");
    statusLarge.textContent = passLarge
      ? detectedTextCategory === "large"
        ? `Large Text (${currentFontSize}, ${currentFontWeight} weight): Pass`
        : "Large Text: Pass"
      : detectedTextCategory === "large"
        ? `Large Text (${currentFontSize}, ${currentFontWeight} weight): Fail`
        : "Large Text: Fail";
    statusLarge.style.cssText =
      badgeStyle + (passLarge ? passStyle : failStyle);

    function setSwatchXIcon(swatchEl) {
      swatchEl.textContent = "";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "#dc2626");
      svg.setAttribute("stroke-width", "3");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      const line1 = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line1.setAttribute("x1", "18");
      line1.setAttribute("y1", "6");
      line1.setAttribute("x2", "6");
      line1.setAttribute("y2", "18");
      const line2 = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line2.setAttribute("x1", "6");
      line2.setAttribute("y1", "6");
      line2.setAttribute("x2", "18");
      line2.setAttribute("y2", "18");
      svg.appendChild(line1);
      svg.appendChild(line2);
      swatchEl.appendChild(svg);
    }

    if (contrast < tweakTargetContrast) {
      fgSuggestionBox.style.display = "flex";
      bgSuggestionBox.style.display = "flex";

      fgSuggestionLabel.textContent = `${tweakTargetContrast}:1`;
      bgSuggestionLabel.textContent = `${tweakTargetContrast}:1`;

      const fgSuggestionHex = adjustLuminance(
        fgHexWithAlpha,
        tweakTargetContrast,
        bgHexWithAlpha,
        true, // we are tweaking foreground
      );

      const suggestedFgRgb = hexToRgba(fgSuggestionHex);
      const testSolidFg = blendRgb(suggestedFgRgb, effectiveBg);
      const newFgContrast = getContrast(testSolidFg, effectiveBg);

      fgSuggestionBox.querySelector("span").style.display = "block";
      if (newFgContrast >= tweakTargetContrast) {
        fgSuggestionSwatch.style.backgroundColor = fgSuggestionHex;
        fgSuggestionSwatch.textContent = "";
        fgSuggestionBox.style.cursor = "pointer";
        fgSuggestionBox.dataset.hex = fgSuggestionHex;
        fgSuggestionBox.title = `Apply ${fgSuggestionHex}`;
      } else {
        fgSuggestionBox.querySelector("span").style.display = "none";
        fgSuggestionSwatch.style.backgroundColor = "#FFFFFF";
        setSwatchXIcon(fgSuggestionSwatch);
        fgSuggestionBox.style.cursor = "not-allowed";
        fgSuggestionBox.dataset.hex = "";
        fgSuggestionBox.title = "Cannot find a passing color";
      }

      const bgSuggestionHex = adjustLuminance(
        bgHexWithAlpha,
        tweakTargetContrast,
        fgHexWithAlpha,
        false, // we are tweaking background
      );

      const suggestedBgRgb = hexToRgba(bgSuggestionHex);
      const testSolidBg = blendRgb(suggestedBgRgb, baseWhite);
      const testSolidFgOverNewBg = blendRgb(fgRgba, testSolidBg);
      const newBgContrast = getContrast(testSolidFgOverNewBg, testSolidBg);

      bgSuggestionBox.querySelector("span").style.display = "block";
      if (newBgContrast >= tweakTargetContrast) {
        bgSuggestionSwatch.style.backgroundColor = bgSuggestionHex;
        bgSuggestionSwatch.textContent = "";
        bgSuggestionBox.style.cursor = "pointer";
        bgSuggestionBox.dataset.hex = bgSuggestionHex;
        bgSuggestionBox.title = `Apply ${bgSuggestionHex}`;
      } else {
        bgSuggestionBox.querySelector("span").style.display = "none";
        bgSuggestionSwatch.style.backgroundColor = "#FFFFFF";
        setSwatchXIcon(bgSuggestionSwatch);
        bgSuggestionBox.style.cursor = "not-allowed";
        bgSuggestionBox.dataset.hex = "";
        bgSuggestionBox.title = "Cannot find a passing color";
      }
    } else {
      fgSuggestionBox.style.display = "none";
      bgSuggestionBox.style.display = "none";
    }

    setTimeout(updateScrollButtonsVisibility, 50);

    document
      .getElementById("preview-line-normal")
      .classList.remove("spyglass-preview-highlight");
    document
      .getElementById("preview-line-large")
      .classList.remove("spyglass-preview-highlight");

    if (hasSelectedElement) {
      if (detectedTextCategory === "large") {
        document
          .getElementById("preview-line-large")
          .classList.add("spyglass-preview-highlight");
      } else {
        document
          .getElementById("preview-line-normal")
          .classList.add("spyglass-preview-highlight");
      }
    }
  }

  function switchTab(tab) {
    if (tab === "preview") {
      panelPreview.style.display = "block";
      panelDetails.style.display = "none";
      tabPreviewBtn.classList.remove("spyglass-tab-inactive");
      tabPreviewBtn.classList.add("spyglass-tab-active");
      tabPreviewBtn.setAttribute("aria-selected", "true");
      tabDetailsBtn.classList.remove("spyglass-tab-active");
      tabDetailsBtn.classList.add("spyglass-tab-inactive");
      tabDetailsBtn.setAttribute("aria-selected", "false");
      panelPreview.removeAttribute("hidden");
      panelDetails.setAttribute("hidden", "");
    } else {
      panelPreview.style.display = "none";
      panelDetails.style.display = "block";
      tabDetailsBtn.classList.remove("spyglass-tab-inactive");
      tabDetailsBtn.classList.add("spyglass-tab-active");
      tabDetailsBtn.setAttribute("aria-selected", "true");
      tabPreviewBtn.classList.remove("spyglass-tab-active");
      tabPreviewBtn.classList.add("spyglass-tab-inactive");
      tabPreviewBtn.setAttribute("aria-selected", "false");
      panelDetails.removeAttribute("hidden");
      panelPreview.setAttribute("hidden", "");
    }
    updateUI();
  }

  // --- PICKER EVENT HANDLERS ---
  function handleHoverPickerMouseMove(e) {
    const target = e.target;
    if (target === lastHoveredElement || container.contains(target)) return;
    if (lastHoveredElement)
      lastHoveredElement.classList.remove("element-picker-hover-outline");
    if (target && target.classList) {
      target.classList.add("element-picker-hover-outline");
      lastHoveredElement = target;
    }
  }

  function handleRestingPickerMouseMove(e) {
    container.style.visibility = "hidden";
    if (hoverOverrideStyle) hoverOverrideStyle.disabled = true;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (hoverOverrideStyle) hoverOverrideStyle.disabled = false;
    container.style.visibility = "visible";

    if (target === lastHoveredElement || container.contains(target)) return;
    if (lastHoveredElement)
      lastHoveredElement.classList.remove("element-picker-hover-outline");
    if (target && target.classList) {
      target.classList.add("element-picker-hover-outline");
      lastHoveredElement = target;
    }
  }

  async function handleElementPickerMouseClick(e) {
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

    const isBold = fontWeight === "bold" || parseInt(fontWeight) >= 700;
    if (fontSize >= 24 || (fontSize >= 18.5 && isBold)) {
      detectedTextCategory = "large";
      tweakTargetContrast = 3.0; // Set default for large text
    } else {
      detectedTextCategory = "normal";
      tweakTargetContrast = 4.5; // Set default for normal text
    }

    const elementBgColor = getElementBackgroundColor(target);

    fgColorInput.value = rgbaStringToHex(fgColor);
    bgColorInput.value = rgbaStringToHex(elementBgColor);

    currentElement = target;

    if (isPixelAnalysisEnabled && pixelAnalyzer) {
      await performPixelAnalysis(target);
    }

    hasSelectedElement = true;
    stopAllPickers();
  }

  function startElementPicking(isOverlayMode = false) {
    if (isElementPicking) {
      stopAllPickers();
      return;
    }

    if (!isCheckingHoverState && !isOverlayMode) {
      hoverOverrideStyle = document.createElement("style");
      hoverOverrideStyle.id = "spyglass-hover-override";
      hoverOverrideStyle.innerText = `* { pointer-events: none !important; }`;
      document.head.appendChild(hoverOverrideStyle);
    }

    isElementPicking = true;
    elementPickerBtn.textContent = "Cancel";

    if (isOverlayMode && isPixelAnalysisEnabled) {
      pickerStatus.textContent =
        "Click text on image/gradient to analyze contrast range... (or press Esc to cancel)";
    } else {
      pickerStatus.textContent =
        "Hover and click an element... (or press Esc to cancel)";
    }
    pickerStatus.style.visibility = "visible";
    document.body.classList.add("element-picking-cursor");

    const moveHandler = !isCheckingHoverState
      ? handleRestingPickerMouseMove
      : handleHoverPickerMouseMove;
    document.addEventListener("mousemove", moveHandler);
    document.addEventListener("click", handleElementPickerMouseClick, true);
    document.addEventListener("keydown", handleEscapeKey);
  }

  function stopAllPickers(skipUpdate) {
    document.removeEventListener("keydown", handleEscapeKey);

    if (isElementPicking) {
      isElementPicking = false;
      elementPickerBtn.textContent = "Element Picker";
      if (lastHoveredElement)
        lastHoveredElement.classList.remove("element-picker-hover-outline");

      document.body.classList.remove("element-picking-cursor");
      document.removeEventListener("mousemove", handleHoverPickerMouseMove);
      document.removeEventListener("mousemove", handleRestingPickerMouseMove);
      document.removeEventListener(
        "click",
        handleElementPickerMouseClick,
        true,
      );

      if (hoverOverrideStyle) {
        hoverOverrideStyle.remove();
        hoverOverrideStyle = null;
      }
    }

    elementPickerBtn.disabled = false;
    modeToggleBtn.disabled = false;
    pickerStatus.style.visibility = "hidden";
    isPickingForeground = true;
    fgContainer.classList.remove("picking-active");
    bgContainer.classList.remove("picking-active");
    if (skipUpdate !== true) {
      updateUI();
    }
  }

  function handleEscapeKey(e) {
    if (e.key === "Escape") {
      stopAllPickers();
    }
  }

  function copyToClipboard(element, button) {
    element.select();
    document.execCommand("copy");

    const copiedSpan = document.createElement("span");
    copiedSpan.textContent = "Copied!";
    copiedSpan.style.cssText =
      "position: absolute; right: 2.25rem; top: 50%; transform: translateY(-50%); background-color: white; padding: 0.1rem 0.4rem; border-radius: 0.25rem; color: #059669; font-weight: 600; font-size: 0.875rem; white-space: nowrap; pointer-events: none;";

    button.parentElement.appendChild(copiedSpan);
    setTimeout(() => copiedSpan.remove(), 1500);
  }

  // --- LOCAL EVENT LISTENERS ---
  fgColorInput.addEventListener("input", () => {
    updateUI();
  });
  bgColorInput.addEventListener("input", () => {
    updateUI();
  });

  // Placeholder click listeners for future custom color picker
  fgSwatch.addEventListener("click", () => {
    console.log("Open custom foreground color picker here");
  });
  bgSwatch.addEventListener("click", () => {
    console.log("Open custom background color picker here");
  });

  elementPickerBtn.addEventListener("click", () => startElementPicking(false));

  overlayPickerBtn.addEventListener("click", async () => {
    const originalBg = overlayPickerBtn.style.backgroundColor;
    const savedChildren = Array.from(overlayPickerBtn.childNodes).map((n) =>
      n.cloneNode(true),
    );
    overlayPickerBtn.style.backgroundColor = "#7C3AED";
    overlayPickerBtn.textContent = "Click an element...";

    if (!pixelAnalyzer) {
      pixelAnalyzer = new ImageBackgroundAnalyzer();
    }

    isPixelAnalysisEnabled = true;
    pixelAnalysisBtn.textContent = "Pixel Analysis: ON";
    pixelAnalysisBtn.style.backgroundColor = "#10B981";
    pixelAnalysisBtn.style.borderColor = "#059669";

    startElementPicking(true);

    setTimeout(() => {
      overlayPickerBtn.style.backgroundColor = originalBg || "#5B21B6";
      overlayPickerBtn.textContent = "";
      savedChildren.forEach((n) => overlayPickerBtn.appendChild(n));
    }, 1000);
  });

  modeToggleBtn.addEventListener("click", () => {
    isCheckingHoverState = !isCheckingHoverState;
    modeToggleBtn.textContent = isCheckingHoverState ? "Hover" : "Resting";
    modeToggleBtn.style.backgroundColor = isCheckingHoverState
      ? "#EA580C"
      : "#166534";
  });

  closeBtn.addEventListener("click", () => {
    stopAllPickers();
    if (pixelAnalyzer) pixelAnalyzer.cleanup();
    container.remove();
  });

  copyFgBtn.addEventListener("click", () =>
    copyToClipboard(fgColorInput, copyFgBtn),
  );
  copyBgBtn.addEventListener("click", () =>
    copyToClipboard(bgColorInput, copyBgBtn),
  );

  swapBtn.addEventListener("click", () => {
    const temp = fgColorInput.value;
    fgColorInput.value = bgColorInput.value;
    bgColorInput.value = temp;
    updateUI();
  });

  fgSuggestionBox.addEventListener("click", () => {
    const hex = fgSuggestionBox.dataset.hex;
    if (hex) {
      fgColorInput.value = hex;
      updateUI();
    }
  });

  bgSuggestionBox.addEventListener("click", () => {
    const hex = bgSuggestionBox.dataset.hex;
    if (hex) {
      bgColorInput.value = hex;
      updateUI();
    }
  });

  algoApca.addEventListener("change", () => updateUI());
  document.getElementById("algo-wcag").addEventListener("change", () => updateUI());

  tweakTargetBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    tweakTargetContrast = tweakTargetContrast === 4.5 ? 3 : 4.5;
    updateUI();
  });

  // Pixel Analysis toggle button
  const pixelAnalysisBtn = document.getElementById("pixel-analysis-btn");
  let isPixelAnalysisEnabled = false;

  pixelAnalysisBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    isPixelAnalysisEnabled = !isPixelAnalysisEnabled;

    if (isPixelAnalysisEnabled) {
      if (!pixelAnalyzer) {
        pixelAnalyzer = new ImageBackgroundAnalyzer();
      }
      pixelAnalysisBtn.textContent = "Pixel Analysis: ON";
      pixelAnalysisBtn.style.backgroundColor = "#10B981";
      pixelAnalysisBtn.style.borderColor = "#059669";

      if (currentElement) {
        await performPixelAnalysis(currentElement);
      }
    } else {
      pixelAnalysisBtn.textContent = "Pixel Analysis: OFF";
      pixelAnalysisBtn.style.backgroundColor = "#3B82F6";
      pixelAnalysisBtn.style.borderColor = "#2563EB";
      pixelAnalysisResult = null;
      updateUI();
    }
  });

  // Function to perform pixel analysis
  async function performPixelAnalysis(element) {
    if (!pixelAnalyzer || !isPixelAnalysisEnabled) return;

    try {
      pixelAnalysisResult = await pixelAnalyzer.analyzeContrastRange(element);
      if (pixelAnalysisResult?.type === "cors-blocked") {
        pixelAnalysisResult = null;
        pickerStatus.textContent =
          "⚠️ Image blocked by CORS — pixel analysis unavailable for this element.";
        pickerStatus.style.visibility = "visible";
      } else {
        updateUI();
      }
    } catch (error) {
      console.error("❌ Pixel analysis failed:", error);
      pixelAnalysisResult = null;
      updateUI();
    }
  }

  scrollUpBtn.addEventListener("click", () => (checkerBody.scrollTop = 0));
  scrollDownBtn.addEventListener(
    "click",
    () => (checkerBody.scrollTop = checkerBody.scrollHeight),
  );

  tabPreviewBtn.addEventListener("click", () => switchTab("preview"));
  tabDetailsBtn.addEventListener("click", () => switchTab("details"));

  const dragHandle = document.getElementById("drag-handle");
  let isDragging = false,
    offsetX,
    offsetY;
  dragHandle.addEventListener("mousedown", (e) => {
    isDragging = true;
    offsetX = e.clientX - container.offsetLeft;
    offsetY = e.clientY - container.offsetTop;
    document.body.style.userSelect = "none";
  });
  document.addEventListener("mousemove", (e) => {
    if (isDragging) {
      if (e.buttons !== 1) {
        isDragging = false;
        return;
      }
      container.style.left = `${e.clientX - offsetX}px`;
      container.style.top = `${e.clientY - offsetY}px`;
    }
  });
  document.addEventListener("mouseup", () => {
    isDragging = false;
    document.body.style.userSelect = "";
  });

  function createTweakControls(tweakContainer, colorInput) {
    while (tweakContainer.firstChild)
      tweakContainer.removeChild(tweakContainer.firstChild);
    tweakContainer.style.display = "flex";
    tweakContainer.style.justifyContent = "space-around";
    tweakContainer.style.alignItems = "center";

    const minusIcon = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZHRoPSIxMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48bGluZSB4MT0iNSIgeTE9IjEyIiB4Mj0iMTkiIHkyPSIxMiI+PC9saW5lPjwvc3ZnPg==`;
    const plusIcon = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZHRoPSIxMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzNzQxNTEiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48bGluZSB4MT0iMTIiIHkxPSI1IiB4Mj0iMTIiIHkyPSIxOSI+PC9saW5lPjxsaW5lIHgxPSI1IiB5MT0iMTIiIHgyPSIxOSIgeTI9IjEyIj48L2xpbmU+PC9zdmc+`;

    ["r", "g", "b"].forEach((channel) => {
      const group = document.createElement("div");
      group.style.display = "flex";
      group.style.alignItems = "center";
      group.style.gap = "0.25rem";

      const minusBtn = document.createElement("button");
      minusBtn.className = "tweak-btn";
      minusBtn.style.backgroundImage = `url('${minusIcon}')`;
      minusBtn.setAttribute("aria-label", `Decrease ${channel.toUpperCase()}`);
      minusBtn.onclick = () => smartTweakColor(colorInput, channel, -5);

      const label = document.createElement("span");
      label.textContent = channel.toUpperCase();
      label.style.fontWeight = "700";
      label.style.width = "1rem";
      label.style.textAlign = "center";
      if (channel === "r") label.style.color = "#dc2626";
      if (channel === "g") label.style.color = "#16a34a";
      if (channel === "b") label.style.color = "#2563eb";

      const plusBtn = document.createElement("button");
      plusBtn.className = "tweak-btn";
      plusBtn.style.backgroundImage = `url('${plusIcon}')`;
      plusBtn.setAttribute("aria-label", `Increase ${channel.toUpperCase()}`);
      plusBtn.onclick = () => smartTweakColor(colorInput, channel, 5);

      group.appendChild(minusBtn);
      group.appendChild(label);
      group.appendChild(plusBtn);
      tweakContainer.appendChild(group);
    });
  }

  function smartTweakColor(colorInput, channel, amount) {
    const isFg = colorInput === fgColorInput;
    const otherColorInput = isFg ? bgColorInput : fgColorInput;

    let tweakedRgb = hexToRgba(colorInput.value);
    if (!tweakedRgb) return;

    tweakedRgb[channel] = Math.max(
      0,
      Math.min(255, tweakedRgb[channel] + amount),
    );

    // Rebuild hex, carrying over alpha if it was present
    let alphaHex = Math.round(tweakedRgb.a * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
    const tweakedHex =
      rgbToHex(tweakedRgb.r, tweakedRgb.g, tweakedRgb.b) +
      (alphaHex !== "FF" ? alphaHex : "");
    const otherHex = otherColorInput.value;

    const baseWhite = { r: 255, g: 255, b: 255, a: 1 };
    const otherRgba = hexToRgba(otherHex);
    let solidBg, solidFg;

    // Determine the real, on-screen contrast of this tweak
    if (isFg) {
      solidBg = blendRgb(otherRgba, baseWhite);
      solidFg = blendRgb(tweakedRgb, solidBg);
    } else {
      solidBg = blendRgb(tweakedRgb, baseWhite);
      solidFg = blendRgb(otherRgba, solidBg);
    }

    const currentContrast = getContrast(solidFg, solidBg);
    const finalHex =
      currentContrast >= tweakTargetContrast
        ? tweakedHex
        : adjustLuminance(tweakedHex, tweakTargetContrast, otherHex, isFg);

    colorInput.value = finalHex;
    updateUI();
  }

  function adjustLuminance(
    hexWithAlpha,
    targetContrast,
    otherHexWithAlpha,
    isAdjustingForeground,
  ) {
    const colorRgba = hexToRgba(hexWithAlpha);
    const otherRgba = hexToRgba(otherHexWithAlpha);
    if (!colorRgba || !otherRgba) return "#FF0000";

    const baseWhite = { r: 255, g: 255, b: 255, a: 1 };
    let startRgb = {
      r: colorRgba.r,
      g: colorRgba.g,
      b: colorRgba.b,
      a: colorRgba.a,
    };

    // Helper to see what contrast a specific color mix creates in the real world
    function checkContrast(mixRgb) {
      if (isAdjustingForeground) {
        const solidBg = blendRgb(otherRgba, baseWhite);
        const solidFg = blendRgb(mixRgb, solidBg);
        return getContrast(solidFg, solidBg);
      } else {
        const solidBg = blendRgb(mixRgb, baseWhite);
        const solidFg = blendRgb(otherRgba, solidBg);
        return getContrast(solidFg, solidBg);
      }
    }

    if (checkContrast(startRgb) >= targetContrast) {
      // Suggest the fully solid version of the color
      return rgbToHex(startRgb.r, startRgb.g, startRgb.b);
    }

    // See if pushing toward white or black creates better contrast
    const lumWhite = checkContrast({ r: 255, g: 255, b: 255, a: startRgb.a });
    const lumBlack = checkContrast({ r: 0, g: 0, b: 0, a: startRgb.a });

    let firstTryMixer =
      lumWhite > lumBlack
        ? { r: 255, g: 255, b: 255, a: 1 }
        : { r: 0, g: 0, b: 0, a: 1 };
    let secondTryMixer =
      lumWhite > lumBlack
        ? { r: 0, g: 0, b: 0, a: 1 }
        : { r: 255, g: 255, b: 255, a: 1 };

    function findMix(mixer) {
      for (let i = 0; i <= 100; i++) {
        const mixPercent = i / 100.0;
        let newRgb = {
          r: Math.round(startRgb.r * (1 - mixPercent) + mixer.r * mixPercent),
          g: Math.round(startRgb.g * (1 - mixPercent) + mixer.g * mixPercent),
          b: Math.round(startRgb.b * (1 - mixPercent) + mixer.b * mixPercent),
          a: startRgb.a,
        };
        if (checkContrast(newRgb) >= targetContrast) {
          return rgbToHex(newRgb.r, newRgb.g, newRgb.b);
        }
      }
      return null;
    }

    let result = findMix(firstTryMixer);
    if (result) return result;
    result = findMix(secondTryMixer);
    if (result) return result;

    return rgbToHex(startRgb.r, startRgb.g, startRgb.b);
  }

  // --- INITIAL RUN ---
  const upArrowIcon = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZHRoPSIyMCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMxRjI5MzciIHN0cm9rZS13aWR0aD0iMi41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMiAxOVY1TTUgMTJsNy03IDcgNyIvPjwvc3ZnPg==`;
  const downArrowIcon = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZHRoPSIyMCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMxRjI5MzciIHN0cm9rZS13aWR0aD0iMi41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMiA1djE0TTE5IDEybC03IDctNy03Ii8+PC9zdmc+`;
  scrollUpBtn.style.backgroundImage = `url('${upArrowIcon}')`;
  scrollDownBtn.style.backgroundImage = `url('${downArrowIcon}')`;

  createTweakControls(
    document.getElementById("fg-tweak-controls"),
    fgColorInput,
  );
  createTweakControls(
    document.getElementById("bg-tweak-controls"),
    bgColorInput,
  );
  updateUI();
  resizeObserver = new ResizeObserver(updateScrollButtonsVisibility);
  resizeObserver.observe(checkerBody);

  setTimeout(() => startElementPicking(false), 100);
})();
