(function () {
  const DATA_CODEWORDS = [0, 19, 34, 55, 80, 108];
  const ECC_CODEWORDS = [0, 7, 10, 15, 20, 26];
  const ALIGNMENT = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30]
  };

  const exp = new Array(512);
  const log = new Array(256);
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255];

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return exp[log[a] + log[b]];
  }

  function generator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i += 1) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j += 1) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], exp[i]);
      }
      poly = next;
    }
    return poly;
  }

  function reedSolomon(data, degree) {
    const gen = generator(degree);
    const result = new Array(degree).fill(0);
    data.forEach(byte => {
      const factor = byte ^ result.shift();
      result.push(0);
      for (let i = 0; i < degree; i += 1) {
        result[i] ^= gfMul(gen[i + 1], factor);
      }
    });
    return result;
  }

  class BitBuffer {
    constructor() {
      this.bits = [];
    }

    append(value, length) {
      for (let i = length - 1; i >= 0; i -= 1) {
        this.bits.push((value >>> i) & 1);
      }
    }

    toCodewords(count) {
      while (this.bits.length < count * 8 && this.bits.length % 8 !== 0) this.bits.push(0);
      const words = [];
      for (let i = 0; i < this.bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.bits[i + j] || 0);
        words.push(byte);
      }
      while (words.length < count) words.push(words.length % 2 === 0 ? 0xec : 0x11);
      return words.slice(0, count);
    }
  }

  function chooseVersion(bytes) {
    for (let version = 1; version <= 5; version += 1) {
      if (bytes.length <= DATA_CODEWORDS[version] - 2) return version;
    }
    throw new Error("Ссылка слишком длинная для встроенного QR-кода.");
  }

  function drawFinder(modules, reserved, left, top) {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const xx = left + x;
        const yy = top + y;
        if (yy < 0 || yy >= modules.length || xx < 0 || xx >= modules.length) continue;
        const dark = x >= 0 && x <= 6 && y >= 0 && y <= 6
          && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        modules[yy][xx] = dark;
        reserved[yy][xx] = true;
      }
    }
  }

  function drawAlignment(modules, reserved, cx, cy) {
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        const xx = cx + x;
        const yy = cy + y;
        const dark = Math.max(Math.abs(x), Math.abs(y)) !== 1;
        modules[yy][xx] = dark;
        reserved[yy][xx] = true;
      }
    }
  }

  function formatBits(mask) {
    const data = (1 << 3) | mask;
    let bits = data << 10;
    for (let i = 14; i >= 10; i -= 1) {
      if (((bits >>> i) & 1) !== 0) bits ^= 0x537 << (i - 10);
    }
    return ((data << 10) | bits) ^ 0x5412;
  }

  function setFormat(modules, reserved, mask) {
    const size = modules.length;
    const bits = formatBits(mask);
    const set = (x, y, bit) => {
      modules[y][x] = ((bits >>> bit) & 1) !== 0;
      reserved[y][x] = true;
    };

    for (let i = 0; i <= 5; i += 1) set(8, i, i);
    set(8, 7, 6);
    set(8, 8, 7);
    set(7, 8, 8);
    for (let i = 9; i < 15; i += 1) set(14 - i, 8, i);
    for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, i);
    for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, i);
    modules[size - 8][8] = true;
    reserved[size - 8][8] = true;
  }

  function makeMatrix(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const version = chooseVersion(bytes);
    const size = 17 + version * 4;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

    drawFinder(modules, reserved, 0, 0);
    drawFinder(modules, reserved, size - 7, 0);
    drawFinder(modules, reserved, 0, size - 7);

    for (let i = 8; i < size - 8; i += 1) {
      const dark = i % 2 === 0;
      modules[6][i] = dark;
      modules[i][6] = dark;
      reserved[6][i] = true;
      reserved[i][6] = true;
    }

    ALIGNMENT[version].forEach(y => {
      ALIGNMENT[version].forEach(x => {
        const overlapsFinder = (x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6);
        if (!overlapsFinder) drawAlignment(modules, reserved, x, y);
      });
    });

    setFormat(modules, reserved, 0);

    const buffer = new BitBuffer();
    buffer.append(0b0100, 4);
    buffer.append(bytes.length, 8);
    bytes.forEach(byte => buffer.append(byte, 8));
    const capacityBits = DATA_CODEWORDS[version] * 8;
    buffer.append(0, Math.min(4, capacityBits - buffer.bits.length));
    const data = buffer.toCodewords(DATA_CODEWORDS[version]);
    const codewords = data.concat(reedSolomon(data, ECC_CODEWORDS[version]));
    const dataBits = codewords.flatMap(byte => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));

    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right -= 1;
      for (let vertical = 0; vertical < size; vertical += 1) {
        const y = upward ? size - 1 - vertical : vertical;
        for (let dx = 0; dx < 2; dx += 1) {
          const xx = right - dx;
          if (reserved[y][xx]) continue;
          const bit = dataBits[bitIndex] || 0;
          modules[y][xx] = Boolean(bit) !== ((xx + y) % 2 === 0);
          bitIndex += 1;
        }
      }
      upward = !upward;
    }

    return modules;
  }

  function createSvg(text, options = {}) {
    const matrix = makeMatrix(text);
    const margin = options.margin ?? 2;
    const foreground = options.foreground || "#000";
    const background = options.background || "#fff";
    const size = matrix.length + margin * 2;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("role", "img");

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", size);
    bg.setAttribute("height", size);
    bg.setAttribute("fill", background);
    svg.appendChild(bg);

    let path = "";
    matrix.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) path += `M${x + margin},${y + margin}h1v1h-1z`;
      });
    });

    const modules = document.createElementNS("http://www.w3.org/2000/svg", "path");
    modules.setAttribute("d", path);
    modules.setAttribute("fill", foreground);
    svg.appendChild(modules);
    return svg;
  }

  window.QrLite = { createSvg };
})();
