// A compiler for the subset of C++ that NRL OpModes are written in (HexaNRL / Arduino style).
// It turns the imported .cpp/.h files into one JavaScript module that runs against the emulated
// robot runtime in nrl.js. Supported: constexpr/const/global variables, functions, lambdas, classes
// and structs (fields, methods, constructors, inheritance, static members), enums and enum classes,
// namespaces, if/else, for/while/do, range-for, switch, casts, integer division, brace initialisers,
// designated initialisers, #include between imported files, #define constants and REGISTER_OPMODE.
// Not supported (reported as compile errors): templates you define yourself, operator overloading,
// function overloading, goto, and function-like macros other than REGISTER_OPMODE.

export class CompileError extends Error {
  constructor(msg, tok) { super(msg); this.file = tok?.file; this.line = tok?.line; }
}

// ---------------------------------------------------------------- types the compiler recognises
const PRIM_INT = new Set(['int', 'long', 'short', 'char', 'unsigned', 'signed', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'size_t', 'byte', 'word', 'boolean_t']);
const PRIM_FLOAT = new Set(['float', 'double']);
const PRIM_OTHER = new Set(['bool', 'boolean', 'void', 'auto', 'String', 'string']);
const QUALIFIERS = new Set(['const', 'constexpr', 'static', 'inline', 'volatile', 'extern', 'mutable', 'virtual', 'explicit', 'friend', 'register', 'thread_local', 'consteval', 'constinit', 'typename', 'struct', 'class_', 'enum_']);
// framework classes (constructed with `new`, provided by the runtime)
export const RUNTIME_CLASSES = ['HexaServo', 'HexaDCMotor', 'TankDrive', 'DriveActions', 'DriveTuning', 'HexaIMU', 'HexaPower', 'HexaLED', 'HexaOLED', 'Gamepad',
  'HexaServoConfig', 'HexaDCMotorConfig', 'HexaIMUConfig', 'HexaPowerConfig', 'HexaOLEDConfig', 'HexaIMUData', 'HexaPowerData', 'NRLOpMode', 'NRLTelemetry', 'Action', 'Adafruit_NeoPixel', 'TwoWire'];
// type names that are only ever used as types (never constructed by the student's code)
const OPAQUE_TYPES = new Set(['ActionPtr', 'function', 'vector', 'shared_ptr', 'unique_ptr', 'array', 'initializer_list', 'OpModeType', 'hexa_accel_range_t', 'hexa_gyro_range_t', 'portMUX_TYPE', 'TickType_t', 'esp_reset_reason_t']);
const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'new', 'delete', 'this', 'true', 'false', 'nullptr', 'NULL', 'sizeof', 'class', 'struct', 'enum', 'namespace', 'using', 'typedef', 'template', 'public', 'private', 'protected', 'operator', 'goto', 'try', 'catch', 'throw', 'static_cast', 'const_cast', 'reinterpret_cast', 'dynamic_cast']);
const JS_RESERVED = new Set(['var', 'let', 'function', 'arguments', 'eval', 'await', 'yield', 'in', 'of', 'instanceof', 'typeof', 'with', 'export', 'import', 'super', 'undefined', 'NaN', 'Infinity', 'Object', 'Array', 'Math', 'Number', 'JSON', 'window', 'document', 'globalThis', 'Function', 'Symbol', 'Promise', 'Map', 'Set', 'Date', 'Error', 'console', 'self', 'top', 'parent', 'frames', 'location', 'fetch', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'constructor', 'prototype', '__proto__', 'interface', 'package', 'implements', 'yield', 'debugger', 'finally', 'void', 'ownerDocument', 'defaultView', 'contentWindow', 'contentDocument', 'getRootNode', 'ownerElement', 'opener', 'frameElement', 'importScripts', 'postMessage', 'cookie', 'call', 'apply', 'bind']);
const DOM_NAMES = new Set(['parentNode', 'parentElement', 'childNodes', 'children', 'firstChild', 'lastChild', 'nextSibling', 'previousSibling', 'firstElementChild', 'lastElementChild',
  'documentElement', 'body', 'head', 'insertAdjacentHTML', 'insertAdjacentElement', 'insertAdjacentText', 'innerHTML', 'outerHTML', 'srcdoc', 'setAttribute', 'setAttributeNS', 'appendChild', 'insertBefore',
  'replaceChild', 'replaceWith', 'prepend', 'querySelector', 'querySelectorAll', 'getElementById', 'getElementsByTagName', 'createElement', 'createElementNS', 'write', 'writeln', 'execCommand',
  'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'getOwnPropertyNames', 'getOwnPropertySymbols', 'getPrototypeOf', 'setPrototypeOf', 'defineProperty', 'defineProperties',
  'caller', 'callee', 'domElement', 'renderer', 'sim', 'rt', 'scene', 'world', 'getContext', 'Reflect', 'Proxy', 'WebAssembly', 'importScripts', 'Worker', 'open', 'origin']);
const safeName = (n) => (JS_RESERVED.has(n) || DOM_NAMES.has(n) || /^__/.test(n) ? `$${n}` : n);

// ---------------------------------------------------------------- tokenizer
const PUNCT = ['<<=', '>>=', '...', '->*', '::', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '{', '}', '(', ')', '[', ']', ';', ',', '.', '?', ':', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '=', '<', '>', '#'];

function tokenize(src, file) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  let lineStart = true;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; lineStart = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; line++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2; continue;
    }
    // preprocessor directive: the whole (continued) line is one token
    if (c === '#' && lineStart) {
      let j = i + 1, text = '';
      const startLine = line;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\' && src[j + 1] === '\n') { j += 2; line++; text += ' '; continue; }
        if (src[j] === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; break; }
        if (src[j] === '/' && src[j + 1] === '*') { j += 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) { if (src[j] === '\n') line++; j++; } j += 2; continue; }
        text += src[j]; j++;
      }
      toks.push({ t: 'pp', v: text.trim(), file, line: startLine });
      i = j; continue;
    }
    lineStart = false;
    // identifiers
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      // string literal prefixes: u8"..", L"..", R"(..)"
      if (src[j] === '"' && /^(u8|u|U|L)$/.test(word)) { i = j; continue; }
      if (word === 'R' && src[j] === '"') {
        const m = /^"([^(]*)\(/.exec(src.slice(j));
        if (m) {
          const end = src.indexOf(`)${m[1]}"`, j + m[0].length);
          const body = src.slice(j + m[0].length, end);
          toks.push({ t: 'str', v: JSON.stringify(body), file, line });
          line += (body.match(/\n/g) || []).length;
          i = end + m[1].length + 2; continue;
        }
      }
      toks.push({ t: 'id', v: word, file, line });
      i = j; continue;
    }
    // numbers
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
      const m = /^(0[xX][0-9a-fA-F']+|0[bB][01']+|(?:[0-9][0-9']*\.?[0-9']*|\.[0-9][0-9']*)(?:[eE][+-]?[0-9]+)?)([uUlLfF]*)/.exec(src.slice(i));
      let raw = m[1].replace(/'/g, '');
      const suf = m[2].toLowerCase();
      const isFloat = !/^0[xXbB]/.test(raw) && (/[.eE]/.test(raw) || suf.includes('f'));
      if (/^0[0-7]+$/.test(raw)) raw = String(parseInt(raw, 8));    // C octal literal
      if (/^\./.test(raw)) raw = '0' + raw;
      if (/\.$/.test(raw)) raw += '0';
      toks.push({ t: 'num', v: raw, float: isFloat, file, line });
      i += m[0].length; continue;
    }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') { s += src[j] + src[j + 1]; j += 2; continue; }
        if (src[j] === '\n') throw new CompileError('Unterminated string', { file, line });
        s += src[j]; j++;
      }
      toks.push({ t: 'str', v: '"' + s + '"', file, line });
      i = j + 1; continue;
    }
    if (c === "'") {
      let j = i + 1, s = '';
      while (j < n && src[j] !== "'") { if (src[j] === '\\') { s += src[j] + src[j + 1]; j += 2; continue; } s += src[j]; j++; }
      let code;
      try { code = JSON.parse('"' + s.replace(/"/g, '\\"') + '"').charCodeAt(0); } catch { code = s.charCodeAt(0); }
      toks.push({ t: 'num', v: String(code || 0), float: false, char: true, file, line });
      i = j + 1; continue;
    }
    const p = PUNCT.find((x) => src.startsWith(x, i));
    if (!p) throw new CompileError(`Unexpected character '${c}'`, { file, line });
    toks.push({ t: 'p', v: p, file, line });
    i += p.length;
  }
  return toks;
}

// ---------------------------------------------------------------- preprocessor
// Resolves #include between the imported files (#pragma once semantics), object-like #defines,
// and simple #if/#ifdef/#ifndef/#else/#endif blocks. Framework headers (NRL.h, Arduino.h, ...) are
// provided by the runtime, so including them is a no-op.
// headers whose contents the runtime provides (nrl.js), for __has_include
const PROVIDED_HEADERS = new Set(['nrl.h', 'arduino.h', 'wire.h', 'vl53l1x.h', 'adafruit_neopixel.h', 'math.h', 'cmath', 'stdint.h', 'cstdint', 'string.h', 'memory', 'functional', 'vector', 'algorithm']);
function preprocess(files, entry, defines) {
  const out = [];
  const included = new Set();
  const byName = new Map();
  for (const f of files) byName.set(baseName(f.name).toLowerCase(), f);
  const macros = new Map(Object.entries(defines).map(([k, v]) => [k, v === null ? [] : tokenize(String(v), '<define>')]));
  const fnMacros = new Map();
  const warnings = [];

  const evalCond = (expr, tok) => {
    // #if: defined(X), __has_include(<h>), numbers, macro names, ! && || == != < > comparisons.
    // __has_include is true for the imported files and the headers the runtime provides.
    let s = expr.replace(/__has_include\s*\(\s*[<"]([^>"]+)[>"]\s*\)/g, (_, h) => (byName.has(baseName(h).toLowerCase()) || PROVIDED_HEADERS.has(baseName(h).toLowerCase()) ? ' 1 ' : ' 0 '));
    s = s.replace(/defined\s*\(\s*__has_include\s*\)|defined\s+__has_include\b/g, ' 1 ');
    s = s.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (_, a, b) => (macros.has(a || b) ? ' 1 ' : ' 0 '));
    s = s.replace(/\b[A-Za-z_]\w*\b/g, (w) => {
      const m = macros.get(w);
      if (!m) return ' 0 ';
      const v = m.map((t) => t.v).join(' ');
      return /^[\d\s+\-*/()<>=!&|.xXa-fA-F]*$/.test(v) && v.trim() ? ` (${v}) ` : ' 1 ';
    });
    s = s.replace(/(\d+)[uUlL]+/g, '$1');
    if (!/^[\d\s+\-*/()<>=!&|%.xXa-fA-F]*$/.test(s)) { warnings.push({ msg: `Could not evaluate #if ${expr}; treating it as false`, file: tok.file, line: tok.line }); return false; }
    try { return !!Function(`return (${s});`)(); } catch { return false; }
  };

  const run = (file) => {
    const key = baseName(file.name).toLowerCase();
    if (included.has(key)) return;
    included.add(key);
    const toks = tokenize(file.text, file.name);
    const stack = [];   // { active, taken }
    const active = () => stack.every((s) => s.active);
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (out.length > 200000) throw new CompileError('Preprocessed program is too large; simplify macros and includes', tk);
      if (tk.t === 'pp') {
        const m = /^(\w+)\s*(.*)$/.exec(tk.v) || ['', '', ''];
        const d = m[1], rest = m[2].trim();
        if (d === 'if' || d === 'ifdef' || d === 'ifndef') {
          let c = false;
          if (active()) c = d === 'ifdef' ? macros.has(rest.split(/\s/)[0]) : d === 'ifndef' ? !macros.has(rest.split(/\s/)[0]) : evalCond(rest, tk);
          stack.push({ active: c, taken: c, parentActive: active() });
          continue;
        }
        if (d === 'elif') { const s = stack[stack.length - 1]; if (!s) throw new CompileError('#elif without #if', tk); const c = !s.taken && evalCond(rest, tk); s.active = c; s.taken = s.taken || c; continue; }
        if (d === 'else') { const s = stack[stack.length - 1]; if (!s) throw new CompileError('#else without #if', tk); s.active = !s.taken; s.taken = true; continue; }
        if (d === 'endif') { if (!stack.pop()) throw new CompileError('#endif without #if', tk); continue; }
        if (!active()) continue;
        if (d === 'include') {
          const im = /^["<]([^">]+)[">]/.exec(rest);
          if (!im) continue;
          const f = byName.get(baseName(im[1]).toLowerCase());
          if (f) run(f);
          continue;
        }
        if (d === 'define') {
          const dm = /^(\w+)(\([^)]*\))?\s*(.*)$/.exec(rest);
          if (!dm) continue;
          if (dm[2]) { fnMacros.set(dm[1], { params: dm[2].slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean), body: dm[3], tok: tk }); continue; }
          macros.set(dm[1], dm[3] ? tokenize(dm[3], tk.file).map((t) => ({ ...t, line: tk.line })) : []);
          continue;
        }
        if (d === 'undef') { macros.delete(rest.split(/\s/)[0]); continue; }
        if (d === 'error' && active()) throw new CompileError(`#error ${rest}`, tk);
        continue;   // #pragma, #warning, #line ...
      }
      if (!active()) continue;
      if (tk.t === 'id' && macros.has(tk.v)) {
        for (const r of expandMacro(macros, tk.v, new Set())) out.push({ ...r, file: tk.file, line: tk.line });
        continue;
      }
      if (tk.t === 'id' && fnMacros.has(tk.v) && toks[i + 1]?.v === '(') {
        // user function-like macro: substitute the arguments token-wise
        const fm = fnMacros.get(tk.v);
        let depth = 0, j = i + 1;
        const args = [[]];
        for (; j < toks.length; j++) {
          const t = toks[j];
          if (t.v === '(' && t.t === 'p') { depth++; if (depth === 1) continue; }
          if (t.v === ')' && t.t === 'p') { depth--; if (depth === 0) break; }
          if (t.v === ',' && t.t === 'p' && depth === 1) { args.push([]); continue; }
          args[args.length - 1].push(t);
        }
        const body = tokenize(fm.body, tk.file);
        for (const b of body) {
          const k = fm.params.indexOf(b.v);
          if (b.t === 'id' && k >= 0) for (const a of args[k] || []) out.push({ ...a, line: tk.line });
          else out.push({ ...b, file: tk.file, line: tk.line });
        }
        i = j;
        continue;
      }
      out.push(tk);
    }
    if (stack.length) throw new CompileError('Missing #endif', toks[toks.length - 1]);
  };
  run(entry);
  return { toks: out, warnings };
}
function expandMacro(macros, name, seen, budget = { left: 100000 }) {
  if (seen.size > 128) throw new CompileError('Macro nesting is too deep', {});
  if (seen.has(name)) return [];
  seen.add(name);
  const res = [];
  for (const t of macros.get(name)) {
    if (--budget.left < 0) throw new CompileError('Macro expansion is too large', t);
    if (t.t === 'id' && macros.has(t.v) && !seen.has(t.v)) res.push(...expandMacro(macros, t.v, new Set(seen), budget));
    else res.push(t);
  }
  return res;
}
const baseName = (p) => p.replace(/\\/g, '/').split('/').pop();

// ---------------------------------------------------------------- parser / code generator
class Scope {
  constructor(parent, kind) { this.parent = parent; this.kind = kind; this.vars = new Map(); }
  lookup(n) { for (let s = this; s; s = s.parent) if (s.vars.has(n)) return s.vars.get(n); return null; }
}

class Compiler {
  constructor(toks, runtimeNames) {
    this.reads = 0; this.deadline = Date.now() + 2000;
    this.toks = toks; this.i = 0;
    this.runtime = runtimeNames;     // Map name -> { type }
    this.types = new Map();          // user type name -> { kind: 'class'|'enum'|'alias', ... }
    this.classStack = [];
    this.out = [];                   // [{ code, tok }]
    this.globals = new Map();        // name -> { type }
    this.registry = [];
    this.statics = [];               // hoisted function-static locals
    this.warnings = [];
    this.uid = 0;
    this.nsStack = [];
    for (const c of RUNTIME_CLASSES) this.types.set(c, { kind: 'runtime' });
  }
  // ---- token helpers
  peek(k = 0) {
    if (++this.reads % 1024 === 0 && (this.reads > 5000000 || Date.now() > this.deadline)) throw new CompileError('Program is too complex to compile; simplify the source', this.toks[this.i] || {});
    return this.toks[this.i + k] || { t: 'eof', v: '<end of file>', file: this.toks[this.toks.length - 1]?.file, line: this.toks[this.toks.length - 1]?.line };
  }
  next() {
    const t = this.peek();
    if (t.t === 'eof') throw new CompileError('Unexpected end of file; check missing semicolons or closing brackets', t);
    this.i++;
    return t;
  }
  is(v, k = 0) { const t = this.peek(k); return (t.t === 'p' || t.t === 'id') && t.v === v; }
  accept(v) { if (this.is(v)) { return this.next(); } return null; }
  expect(v, what) {
    if (this.is(v)) return this.next();
    const t = this.peek();
    throw new CompileError(`Expected '${v}'${what ? ` ${what}` : ''} but found '${t.v}'`, t);
  }
  ident() {
    const t = this.peek();
    if (t.t !== 'id') throw new CompileError(`Expected a name but found '${t.v}'`, t);
    return this.next().v;
  }
  err(msg, t = this.peek()) { return new CompileError(msg, t); }
  emit(code, tok) { this.out.push({ code, tok }); }

  // ---- type recognition
  isTypeName(name) {
    return PRIM_INT.has(name) || PRIM_FLOAT.has(name) || PRIM_OTHER.has(name) || this.types.has(name) || OPAQUE_TYPES.has(name) || name === 'std';
  }
  // does a declaration start at token offset k? (qualifiers, then a type, then a name)
  looksLikeDecl(k = 0) {
    let t = this.peek(k), hadQual = false;
    while (t.t === 'id' && (QUALIFIERS.has(t.v) || t.v === 'struct' || t.v === 'class' || t.v === 'enum' || t.v === 'typename')) { t = this.peek(++k); hadQual = true; }
    if (t.t !== 'id' || KEYWORDS.has(t.v)) return false;
    const known = this.isTypeName(t.v);
    const end = this.skipType(k);
    if (end === null) return false;
    const n = this.peek(end);
    if (n.t !== 'id' || KEYWORDS.has(n.v)) return false;
    if (known || hadQual) return true;
    // an unknown type name: only `Foo bar` (never `a * b`, which is an expression)
    return end === k + 1;
  }
  // skip a type starting at offset k, return offset after it (or null)
  skipType(k) {
    let t = this.peek(k);
    while (t.t === 'id' && (QUALIFIERS.has(t.v) || t.v === 'struct' || t.v === 'class' || t.v === 'enum' || t.v === 'typename')) t = this.peek(++k);
    if (t.t !== 'id') return null;
    // multi-word primitives: unsigned long long int
    if (PRIM_INT.has(t.v)) {
      while (this.peek(k).t === 'id' && (PRIM_INT.has(this.peek(k).v) || this.peek(k).v === 'const')) k++;
    } else {
      k++;
      for (;;) {
        if (this.peek(k).v === '<') { k = this.skipAngles(k); if (k === null) return null; }
        if (this.peek(k).v === '::' && this.peek(k + 1).t === 'id') { k += 2; continue; }
        break;
      }
    }
    while (this.peek(k).v === 'const' || this.peek(k).v === '*' || this.peek(k).v === '&' || this.peek(k).v === '&&' || this.peek(k).v === 'volatile') k++;
    return k;
  }
  skipAngles(k) {
    let depth = 0;
    for (; ; k++) {
      const t = this.peek(k);
      if (t.t === 'eof' || t.v === ';' || t.v === '{') return null;
      if (t.v === '<') depth++;
      else if (t.v === '>') { depth--; if (depth === 0) return k + 1; }
      else if (t.v === '>>') { depth -= 2; if (depth <= 0) return k + 1; }
    }
  }
  // parse a type at the cursor; returns a type descriptor
  parseType() {
    const quals = new Set();
    while (this.peek().t === 'id' && (QUALIFIERS.has(this.peek().v) || ['struct', 'class', 'enum', 'typename'].includes(this.peek().v))) quals.add(this.next().v);
    const t = this.peek();
    let name;
    if (PRIM_INT.has(t.v)) {
      const words = [];
      while (this.peek().t === 'id' && (PRIM_INT.has(this.peek().v) || PRIM_FLOAT.has(this.peek().v) || this.peek().v === 'const')) { const w = this.next().v; if (w !== 'const') words.push(w); else quals.add('const'); }
      name = words.includes('double') ? 'double' : 'int';
      if (words.length === 1 && words[0] === 'char') name = 'char';
    } else {
      name = this.ident();
      const parts = [name];
      let args = null;
      for (;;) {
        if (this.is('<')) {
          const k = this.skipAngles(0);
          if (k === null) throw this.err('Unbalanced < > in a type');
          args = this.toks.slice(this.i + 1, this.i + k - 1).map((x) => x.v).join(' ');
          this.i += k;
        }
        if (this.is('::') && this.peek(1).t === 'id') { this.next(); parts.push(this.next().v); continue; }
        break;
      }
      name = parts.join('::');
      if (args) name += `<${args}>`;
    }
    let ptr = false, ref = false;
    for (;;) {
      if (this.accept('const')) { quals.add('const'); continue; }
      if (this.accept('volatile')) continue;
      if (this.accept('*')) { ptr = true; continue; }
      if (this.accept('&') || this.accept('&&')) { ref = true; continue; }
      break;
    }
    const base = name.replace(/<.*$/, '').split('::').pop();
    let kind = typeKind(name, ptr);
    const ti = this.types.get(base);
    if (!ptr && ti && ti.kind === 'enum') kind = 'int';
    if (!ptr && ti && ti.kind === 'alias' && ti.of) kind = ti.of.kind;
    return { name, quals, ptr, ref, kind };
  }

  // ================================================================ top level
  compile() {
    this.globalScope = this.globalScope || new Scope(null, 'global');
    while (this.peek().t !== 'eof') this.topLevel(this.globalScope);
    return this;
  }
  // compile one token run; scoped = a .cpp file's own code, whose top-level names stay private to it
  // (like a C++ translation unit: two OpModes may each define moveServo or CLIMB_POWER)
  run(toks, scoped) {
    this.toks = toks; this.i = 0;
    if (!scoped) { this.compile(); return; }
    const globals = new Map(this.globals), types = new Map(this.types);
    this.emit('{', toks[0]);
    this.compile();
    this.emit('}', toks[toks.length - 1]);
    this.globals = globals; this.types = types;
  }
  topLevel(scope, inClass = null) {
    const t = this.peek();
    if (t.t === 'pp') { this.next(); return; }
    if (this.accept(';')) return;
    if (t.v === 'using') { this.parseUsing(scope); return; }
    if (t.v === 'typedef') { this.parseTypedef(scope); return; }
    if (t.v === 'template') throw this.err('Templates are not supported by the simulator');
    if (t.v === 'namespace') { this.parseNamespace(scope); return; }
    if (t.v === 'extern' && this.peek(1).t === 'str') { this.next(); this.next(); if (this.accept('{')) { while (!this.is('}')) this.topLevel(scope); this.expect('}'); } else this.topLevel(scope); return; }
    if (t.v === 'REGISTER_OPMODE' || t.v === 'REGISTER_OPMODE_EX' || t.v === 'REGISTER_OPMODE_EX_AT') { this.parseRegister(); return; }
    if (t.v === 'static_assert') { this.skipBalancedStatement(); return; }
    // class / struct / enum definitions (possibly followed by a variable)
    let k = 0;
    while (['static', 'inline', 'const', 'constexpr', 'typedef'].includes(this.peek(k).v)) k++;
    const kw = this.peek(k).v;
    if ((kw === 'class' || kw === 'struct') && this.peek(k + 1).t === 'id' && ['{', ':', ';', 'final'].includes(this.peek(k + 2).v)) {
      this.i += k;
      this.parseClass(scope);
      return;
    }
    if (kw === 'enum') { this.i += k; this.parseEnum(scope); return; }
    // out-of-class method definition: Type Class::method(...) { }
    this.parseDeclOrFunction(scope, { global: true });
  }
  skipBalancedStatement() { let d = 0; while (this.peek().t !== 'eof') { const t = this.next(); if (t.v === '(' || t.v === '{') d++; if (t.v === ')' || t.v === '}') d--; if (t.v === ';' && d === 0) return; } }
  parseUsing(scope) {
    this.next();
    if (this.accept('namespace')) { while (!this.is(';')) this.next(); this.expect(';'); return; }
    const name = this.ident();
    if (this.accept('=')) {
      const ty = this.parseType();
      this.types.set(name, { kind: 'alias', of: ty });
      this.expect(';');
      return;
    }
    while (this.accept('::')) this.ident();
    this.expect(';');
  }
  parseTypedef() {
    this.next();
    if (this.is('struct') || this.is('enum')) {
      // typedef struct { ... } Name;  /  typedef enum { ... } Name;
      const kw = this.next().v;
      let tag = this.peek().t === 'id' && !this.is('{') ? this.next().v : null;
      if (kw === 'enum') { this.i--; if (tag) this.i--; this.parseEnum(this.globalScope, true); return; }
      this.i--; if (tag) this.i--;
      this.parseClass(this.globalScope, true);
      return;
    }
    const ty = this.parseType();
    const name = this.ident();
    if (this.is('(')) { this.skipBalancedStatement(); this.types.set(name, { kind: 'alias', of: { name: 'function', kind: 'fn' } }); return; }
    this.types.set(name, { kind: 'alias', of: ty });
    this.expect(';');
  }
  parseNamespace(scope) {
    const tok = this.next();
    const name = this.peek().t === 'id' ? this.ident() : null;
    this.expect('{');
    if (!name) { while (!this.is('}')) this.topLevel(scope); this.expect('}'); return; }
    // namespace -> an object; members are declared as globals with a prefix and mirrored on the object
    this.emit(`const ${safeName(name)} = Object.create(null);`, tok);
    this.declareGlobal(name, { name, kind: 'ns' }, tok);
    this.nsStack.push(name);
    const startOut = this.out.length;
    const before = new Set(this.globals.keys());
    while (!this.is('}')) this.topLevel(scope);
    this.expect('}');
    this.nsStack.pop();
    for (const k of this.globals.keys()) if (!before.has(k)) this.emit(`${safeName(name)}.${safeName(k)} = ${safeName(k)};`, tok);
    // functions referenced as Name::fn are rewritten to Name.fn by the expression compiler
    void startOut;
  }
  parseRegister() {
    const tok = this.next();
    this.expect('(');
    const cls = this.ident();
    this.expect(',');
    const nameTok = this.next();
    if (nameTok.t !== 'str') throw this.err('REGISTER_OPMODE needs a display name in quotes', nameTok);
    this.expect(',');
    let type = this.ident();
    while (this.accept('::')) type = this.ident();
    let order = 1000;
    if (this.accept(',')) order = Number(this.next().v);
    this.expect(')');
    this.accept(';');
    if (!this.types.has(cls)) throw this.err(`REGISTER_OPMODE: no class named ${cls}`, tok);
    this.registry.push({ cls, name: JSON.parse(nameTok.v), type, order });
    this.emit(`__register(${JSON.stringify(JSON.parse(nameTok.v))}, ${JSON.stringify(type)}, () => new ${safeName(cls)}());`, tok);
  }
  declareGlobal(name, type, tok) {
    if (this.globals.has(name) && !this.globals.get(name).proto) this.warnings.push({ msg: `${name} is declared twice`, file: tok.file, line: tok.line });
    this.globals.set(name, type);
  }

  // ---------------------------------------------------------------- enums
  parseEnum(scope, typedefd = false) {
    const tok = this.next();   // enum
    const isClass = !!(this.accept('class') || this.accept('struct'));
    let name = this.peek().t === 'id' ? this.ident() : null;
    if (this.accept(':')) this.parseType();
    if (this.accept(';')) { if (name) this.types.set(name, { kind: 'enum' }); return; }
    this.expect('{');
    const vals = [];
    let cur = -1, curExpr = null;
    while (!this.is('}')) {
      const n = this.ident();
      if (this.accept('=')) { const e = this.expr(scope, 1); curExpr = e.code; cur = 0; }
      else cur++;
      vals.push([n, curExpr === null ? String(cur) : cur === 0 ? `(${curExpr})` : `(${curExpr}) + ${cur}`]);
      if (!this.accept(',')) break;
    }
    this.expect('}');
    if (typedefd && this.peek().t === 'id') name = this.ident();
    const cls = this.classStack[this.classStack.length - 1];
    const objName = name || `__enum${++this.uid}`;
    this.types.set(objName, { kind: 'enum', values: vals.map((v) => v[0]), isClass, cls: cls?.name });
    // values: for a plain enum they are also visible unqualified (globally, or inside the class)
    const lines = [];
    if (!isClass) {
      for (const [n, v] of vals) {
        const gname = cls ? `${cls.name}__${n}` : n;
        lines.push(`const ${safeName(gname)} = ${v};`);
        if (cls) cls.enumVals.set(n, gname); else this.declareGlobal(n, { name: 'int', kind: 'int' }, tok);
      }
      lines.push(`const ${safeName(cls ? `${cls.name}__${objName}` : objName)} = Object.freeze({ ${vals.map(([n]) => `${n}: ${safeName(cls ? `${cls.name}__${n}` : n)}`).join(', ')} });`);
    } else {
      let prev = null;
      const parts = vals.map(([n, v]) => `${n}: ${v.replace(/^\((.*)\)( \+ \d+)?$/, (m) => m)}`);
      void prev;
      lines.push(`const ${safeName(cls ? `${cls.name}__${objName}` : objName)} = Object.freeze({ ${parts.join(', ')} });`);
    }
    if (cls) { cls.enums.set(objName, `${cls.name}__${objName}`); cls.pre.push(...lines); }
    else { for (const l of lines) this.emit(l, tok); this.declareGlobal(objName, { name: objName, kind: 'enumobj' }, tok); }
    // enum E { } var;
    if (this.peek().t === 'id') { const v = this.ident(); if (cls) cls.fields.push({ name: v, type: { name: 'int', kind: 'int' }, init: '0' }); else { this.emit(`let ${safeName(v)} = 0;`, tok); this.declareGlobal(v, { name: 'int', kind: 'int' }, tok); } }
    this.expect(';');
  }

  // ---------------------------------------------------------------- classes
  parseClass(scope, typedefd = false) {
    const kwTok = this.next();
    const isStruct = kwTok.v === 'struct';
    let name = this.peek().t === 'id' ? this.ident() : `__anon${++this.uid}`;
    this.accept('final');
    if (this.accept(';')) { this.types.set(name, { kind: 'class', fwd: true }); return; }
    let base = null;
    if (this.accept(':')) {
      do { this.accept('public'); this.accept('private'); this.accept('protected'); this.accept('virtual'); const b = this.parseType(); if (!base) base = b.name.replace(/<.*$/, ''); } while (this.accept(','));
    }
    const info = { name, base, fields: [], methods: [], statics: [], ctor: null, enumVals: new Map(), enums: new Map(), pre: [], memberNames: new Set(), staticNames: new Set(), isStruct, nested: [] };
    this.types.set(name, { kind: 'class', info });
    // collect member names first so methods can reference members declared later
    this.prescanMembers(info);
    this.classStack.push(info);
    this.expect('{');
    while (!this.is('}')) this.parseMember(info, scope);
    this.expect('}');
    this.classStack.pop();
    if (typedefd && this.peek().t === 'id') { const alias = this.ident(); this.types.set(alias, { kind: 'class', info }); name = alias; info.alias = alias; }
    this.emitClass(info, kwTok);
    // struct S { } s1, s2;
    while (this.peek().t === 'id') {
      const v = this.ident();
      this.emit(`let ${safeName(v)} = new ${safeName(info.name)}();`, kwTok);
      this.declareGlobal(v, { name: info.name, kind: 'obj' }, kwTok);
      if (!this.accept(',')) break;
    }
    this.expect(';', 'after the class definition');
  }
  prescanMembers(info) {
    // note every member name (and the class's enums) before compiling method bodies,
    // so a method can use a member or enum value declared further down the class
    let braces = 0, parens = 0, stmtStart = this.i + 1;
    for (let j = this.i; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.v === '(' || t.v === '[') { parens++; continue; }
      if (t.v === ')' || t.v === ']') { parens--; continue; }
      if (t.v === '{') {
        // enum [class] Name { A, B = 2, C }
        if (braces === 1 && parens === 0) {
          const head = this.toks.slice(stmtStart, j).map((x) => x.v);
          const ei = head.indexOf('enum');
          if (ei >= 0) {
            const isClass = head[ei + 1] === 'class' || head[ei + 1] === 'struct';
            const nm = head[isClass ? ei + 2 : ei + 1];
            const ename = nm && /^[A-Za-z_]/.test(nm) && nm !== ':' ? nm : null;
            if (ename) { this.types.set(ename, { kind: 'enum', cls: info.name, isClass }); info.enums.set(ename, `${info.name}__${ename}`); }
            if (!isClass) {
              let d = 0;
              for (let q = j + 1; q < this.toks.length; q++) {
                const u = this.toks[q];
                if (u.v === '{' || u.v === '(') d++;
                else if (u.v === ')') d--;
                else if (u.v === '}') { if (d === 0) break; d--; }
                else if (d === 0 && u.t === 'id' && (this.toks[q - 1].v === '{' || this.toks[q - 1].v === ',')) info.enumVals.set(u.v, `${info.name}__${u.v}`);
              }
            }
          }
        }
        braces++;
        continue;
      }
      if (t.v === '}') { braces--; if (braces === 0) break; if (braces === 1) stmtStart = j + 1; continue; }
      if (braces === 1 && parens === 0 && (t.v === ';' || (t.v === ':' && ['public', 'private', 'protected'].includes(this.toks[j - 1]?.v)))) { stmtStart = j + 1; continue; }
      if (braces !== 1 || parens !== 0 || t.t !== 'id' || KEYWORDS.has(t.v) || QUALIFIERS.has(t.v)) continue;
      const n = this.toks[j + 1], prev = this.toks[j - 1];
      if (!n || !['(', '=', ';', '{', '[', ','].includes(n.v)) continue;
      if (t.v === info.name || prev?.v === '~' || prev?.v === 'operator') continue;
      if (prev && ['.', '->', '::', '=', 'enum', 'class', 'struct', 'return', 'case', '<'].includes(prev.v)) continue;
      // inside an enum body (handled above) values are preceded by { or , at brace depth 2, so never here
      info.memberNames.add(t.v);
      if (this.toks.slice(stmtStart, j).some((x) => x.v === 'static')) info.staticNames.add(t.v);
    }
  }
  parseMember(info, scope) {
    const t = this.peek();
    if (t.t === 'pp') { this.next(); return; }
    if (this.accept(';')) return;
    if ((t.v === 'public' || t.v === 'private' || t.v === 'protected') && this.is(':', 1)) { this.next(); this.next(); return; }
    if (t.v === 'using') { this.parseUsing(scope); return; }
    if (t.v === 'typedef') { this.parseTypedef(scope); return; }
    if (t.v === 'friend') { this.skipBalancedStatement(); return; }
    if (t.v === 'template') throw this.err('Templates are not supported by the simulator');
    if (t.v === 'static_assert') { this.skipBalancedStatement(); return; }
    let k = 0;
    while (['static', 'inline', 'const', 'constexpr'].includes(this.peek(k).v)) k++;
    if (this.peek(k).v === 'enum') { this.i += k; this.parseEnum(scope); return; }
    if ((this.peek(k).v === 'class' || this.peek(k).v === 'struct') && this.peek(k + 1).t === 'id' && ['{', ':'].includes(this.peek(k + 2).v)) {
      // nested class: compile it as a top-level class with a prefixed name
      this.i += k;
      const save = this.classStack.pop();
      this.parseClass(scope);
      this.classStack.push(save);
      return;
    }
    // destructor
    if (this.is('~') || (this.is('virtual') && this.is('~', 1))) { this.accept('virtual'); this.next(); this.ident(); this.expect('('); this.expect(')'); this.accept('override'); this.accept('noexcept'); if (this.accept('=')) { this.next(); this.expect(';'); return; } if (this.is('{')) this.skipBlock(); else this.expect(';'); return; }
    // constructor:  Name(params) : init(list) { body }
    let kc = 0;
    while (['explicit', 'inline', 'constexpr'].includes(this.peek(kc).v)) kc++;
    if (this.peek(kc).v === info.name && this.is('(', kc + 1)) {
      this.i += kc + 1;
      const tok = this.peek();
      const fscope = new Scope(scope, 'fn');
      const params = this.parseParams(fscope);
      const inits = [];
      this.accept('noexcept');
      if (this.accept(':')) {
        do {
          const nm = this.ident();
          const open = this.next();
          if (open.v !== '(' && open.v !== '{') throw this.err('Expected ( or { in the member initialiser list', open);
          const close = open.v === '(' ? ')' : '}';
          const args = [];
          while (!this.is(close)) { args.push(this.expr(fscope, 1, info)); if (!this.accept(',')) break; }
          this.expect(close);
          inits.push({ nm, args, tok: open });
        } while (this.accept(','));
      }
      if (this.accept('=')) { this.next(); this.expect(';'); return; }   // = default / = delete
      let body = '';
      if (this.is('{')) body = this.block(fscope, info, { fn: true });
      else this.expect(';');
      if (!info.ctor) info.ctor = { params, inits, body, tok };
      else this.warnings.push({ msg: `${info.name} has more than one constructor; only the first is used`, file: tok.file, line: tok.line });
      return;
    }
    if (this.is('operator') || (this.peek(k).t === 'id' && this.toks.slice(this.i, this.i + 8).some((x) => x.v === 'operator'))) throw this.err('Operator overloading is not supported by the simulator');
    this.parseDeclOrFunction(scope, { cls: info });
  }
  emitClass(info, tok) {
    const N = safeName(info.name);
    for (const l of info.pre) this.emit(l, tok);
    const baseJs = info.base ? (this.types.has(info.base) ? safeName(info.base) : null) : null;
    if (info.base && !baseJs) this.warnings.push({ msg: `Unknown base class ${info.base} (ignored)`, file: tok.file, line: tok.line });
    const lines = [];
    lines.push(`class ${N}${baseJs ? ` extends ${baseJs}` : ''} {`);
    lines.push(`  constructor(...__a) {`);
    if (baseJs) lines.push(`    super(...(${N}.__baseArgs ? ${N}.__baseArgs(__a) : []));`);
    for (const f of info.fields) if (!f.static) lines.push(`    this.${f.name} = ${f.init};`);
    if (info.ctor) lines.push(`    this.__ctor(...__a);`);
    else lines.push(`    if (__a.length === 1 && __a[0] && __a[0].__agg) __aggregate(this, __a[0], ${JSON.stringify(info.fields.filter((f) => !f.static).map((f) => f.name))});`);
    lines.push(`  }`);
    if (info.ctor) {
      const c = info.ctor;
      lines.push(`  __ctor(${c.params.map((p) => p.js).join(', ')}) {`);
      for (const ini of c.inits) {
        if (ini.nm === info.base) continue;
        const f = info.fields.find((x) => x.name === ini.nm);
        const val = ini.args.length === 1 ? ini.args[0].code : f && f.type.kind === 'obj' ? `new ${safeName(f.type.name)}(${ini.args.map((a) => a.code).join(', ')})` : ini.args.map((a) => a.code).join(', ') || '0';
        lines.push(`    this.${ini.nm} = ${f && f.type.kind === 'int' && ini.args[0]?.type === 'float' ? `__int(${val})` : val};`);
      }
      lines.push(`    ${c.params.filter((p) => p.intConv).map((p) => `${p.name} = __int(${p.name});`).join(' ')}`);
      lines.push(c.body.replace(/^\{|\}$/g, ''));
      lines.push(`  }`);
      const baseInit = c.inits.find((x) => x.nm === info.base);
      if (baseInit) this.emit(`/* base args */`, tok);
    }
    for (const m of info.methods) lines.push(`  ${m.static ? 'static ' : ''}${safeName(m.name)}(${m.params.map((p) => p.js).join(', ')}) ${m.body}`);
    lines.push(`}`);
    this.emit(lines.join('\n'), tok);
    for (const f of info.fields) if (f.static) this.emit(`${N}.${f.name} = ${f.init};`, f.tok || tok);
    for (const [e, g] of info.enums) this.emit(`${N}.${safeName(e)} = ${safeName(g)};`, tok);
    for (const [v, g] of info.enumVals) this.emit(`${N}.${v} = ${safeName(g)};`, tok);
    if (info.ctor) {
      const baseInit = info.ctor.inits.find((x) => x.nm === info.base);
      if (baseInit) {
        // base-class constructor arguments may only use the constructor's parameters
        this.emit(`${N}.__baseArgs = (__a) => { const [${info.ctor.params.map((p) => p.name).join(', ')}] = __a; return [${baseInit.args.map((a) => a.code).join(', ')}]; };`, tok);
      }
    }
    this.declareGlobal(info.name, { name: info.name, kind: 'class' }, tok);
  }
  skipBlock() { let d = 0; do { const t = this.next(); if (t.v === '{') d++; if (t.v === '}') d--; if (t.t === 'eof') throw this.err('Unbalanced braces'); } while (d > 0); }

  // ---------------------------------------------------------------- declarations / functions
  // global: global declaration; cls: class member; otherwise a local statement
  parseDeclOrFunction(scope, { global = false, cls = null, local = false, ctxCls = null } = {}) {
    const startTok = this.peek();
    let ecls = cls || ctxCls;
    const isStatic = this.toks.slice(this.i, this.i + 4).some((x) => x.v === 'static') && this.peek().v !== 'return';
    const isConst = this.toks.slice(this.i, this.i + 4).some((x) => x.v === 'const' || x.v === 'constexpr');
    const ty = this.parseType();
    // ---- name, maybe Class::method
    const nameTok = this.peek();
    if (nameTok.t !== 'id') throw this.err(`Expected a name after the type ${ty.name}, found '${nameTok.v}'`);
    let name = this.ident();
    let ownerCls = null;
    while (this.is('::')) {
      this.next();
      const n2 = this.peek().v === '~' ? (this.next(), '~' + this.ident()) : this.ident();
      const ti = this.types.get(name);
      if (ti && ti.kind === 'class') { ownerCls = ti.info; ecls = ownerCls; }
      name = n2;
    }
    if (name === 'operator') throw this.err('Operator overloading is not supported by the simulator');
    // ---- function definition / prototype
    if (this.is('(') && (global || cls || ownerCls) && this.parenIsParamList()) {
      const fscope = new Scope(scope, 'fn');
      const owner = cls || ownerCls;
      const params = this.parseParams(fscope);
      while (this.peek().t === 'id' && ['const', 'override', 'final', 'noexcept', 'volatile'].includes(this.peek().v)) this.next();
      if (this.accept('->')) this.parseType();
      if (this.accept('=')) { this.next(); this.expect(';'); return; }  // = 0 / = default / = delete
      if (this.accept(';')) {   // prototype
        if (!owner && !this.globals.has(name)) this.globals.set(name, { name: ty.name, kind: ty.kind, fn: true, ret: ty.kind, proto: true });
        return;
      }
      if (!owner) {
        if (this.globals.has(name) && !this.globals.get(name).proto && this.globals.get(name).fn) throw this.err(`Function ${name} is defined twice (overloading is not supported by the simulator)`, nameTok);
        this.globals.set(name, { name: ty.name, kind: ty.kind, fn: true, ret: ty.kind });
      }
      const body = this.block(fscope, owner, { fn: true, ret: ty, params });
      const conv = params.filter((p) => p.intConv).map((p) => `${p.name} = __int(${p.name}); `).join('');
      // every call counts against the same per-tick budget as loop iterations, so runaway recursion stops too
      const fullBody = body.replace(/^\{/, `{ __guard(); ${conv}`);
      if (cls) {
        if (cls.methods.some((m) => m.name === name)) throw this.err(`Method ${name} is defined twice (overloading is not supported by the simulator)`, nameTok);
        cls.methods.push({ name, params, body: fullBody, static: isStatic, ret: ty });
      } else if (ownerCls) {
        this.emit(`${safeName(ownerCls.name)}.${isStatic || ownerCls.staticNames.has(name) ? '' : 'prototype.'}${safeName(name)} = function (${params.map((p) => p.js).join(', ')}) ${fullBody};`, nameTok);
      } else {
        this.emit(`function ${safeName(name)}(${params.map((p) => p.js).join(', ')}) ${fullBody}`, nameTok);
      }
      return;
    }
    // ---- variables (possibly several: int a = 1, b = 2;)
    const decls = [];
    for (;;) {
      let dims = [];
      while (this.accept('[')) { dims.push(this.is(']') ? null : this.expr(scope, 1, ecls).code); this.expect(']'); }
      const vty = { ...ty, dims };
      let init = null;
      if (this.accept('=')) {
        if (this.is('{')) init = this.braceInit(scope, ecls, vty);
        else { const e = this.expr(scope, 2, ecls); init = this.convert(e, vty); }
      } else if (this.is('{')) {
        init = this.braceInit(scope, ecls, vty, true);
      } else if (this.is('(')) {
        // constructor-call syntax: TankDrive drive(leftMotor, rightMotor);
        this.next();
        const args = [];
        while (!this.is(')')) { args.push(this.expr(scope, 2, ecls).code); if (!this.accept(',')) break; }
        this.expect(')');
        init = vty.kind === 'obj' && !vty.ptr ? `new ${this.ctorName(vty.name)}(${args.join(', ')})` : args.length === 1 ? (vty.kind === 'int' ? `__int(${args[0]})` : args[0]) : this.defaultValue(vty);
      } else init = this.defaultValue(vty);
      decls.push({ name, init, type: vty, tok: nameTok });
      if (!this.accept(',')) break;
      // later declarators: maybe *name / &name
      while (this.accept('*') || this.accept('&')) { /* pointer */ }
      name = this.ident();
    }
    this.expect(';', `after the declaration of ${decls[decls.length - 1].name}`);
    for (const d of decls) {
      const tdesc = { name: d.type.name, kind: d.type.dims.length ? 'arr' : d.type.kind, elem: d.type.kind };
      if (cls) {
        cls.fields.push({ name: d.name, type: d.type, init: d.init, static: isStatic, tok: d.tok });
        continue;
      }
      if (global) {
        const nsPrefix = '';
        this.emit(`${isConst ? 'const' : 'let'} ${nsPrefix}${safeName(d.name)} = ${d.init};`, d.tok);
        this.declareGlobal(d.name, tdesc, d.tok);
        continue;
      }
      if (isStatic && local) {
        // function-static local: hoisted so it keeps its value between calls
        const g = `__static${++this.uid}_${d.name}`;
        this.statics.push({ code: `let ${g} = ${d.init};`, tok: d.tok });
        scope.vars.set(d.name, { ...tdesc, alias: g });
        continue;
      }
      scope.vars.set(d.name, tdesc);
      this.stmtOut.push(`${isConst ? 'const' : 'let'} ${safeName(d.name)} = ${d.init};`);
    }
    void startTok;
  }
  ctorName(n) {
    const base = n.replace(/<.*$/, '').replace(/^std::/, '');
    if (base === 'vector' || base === 'array') return '__Vec';
    const name = base.split('::').pop();
    // only the program's own classes and the robot runtime's classes can be constructed. Anything else would reach a
    // browser constructor (Image, WebSocket, Worker…) and through it the page, which robot code must never touch.
    let ti = this.types.get(name);
    for (let i = 0; ti && ti.kind === 'alias' && i < 8; i++) ti = this.types.get(String(ti.of?.name || '').replace(/<.*$/, '').split('::').pop());
    const runtimeObj = /^[A-Z]/.test(name) && this.runtime.names.get(name)?.type === 'obj';
    if (!(ti && (ti.kind === 'class' || ti.kind === 'runtime')) && !runtimeObj) throw this.err(`Unknown class ${name}. Declare it in your code, or use a class from the robot library.`);
    return safeName(name);
  }
  parenIsParamList() {
    // after a name: ( ) or ( Type name ... ) or ( void ) -> parameter list; ( expr ) -> constructor call
    const a = this.peek(1);
    if (a.v === ')') {
      // `Foo bar();` is a function prototype in C++, but `Foo bar() {` is a definition. Either way: params.
      return true;
    }
    if (a.v === 'void' && this.peek(2).v === ')') return true;
    const save = this.i;
    this.i++;
    const ok = this.looksLikeDecl(0) || (this.peek().t === 'id' && (this.isTypeName(this.peek().v) || ['const', 'unsigned', 'signed', 'struct'].includes(this.peek().v)) && this.peek(1).v !== '(' && this.peek(1).v !== '.' && this.peek(1).v !== '::' && this.peek(1).v !== ')' && this.peek(1).v !== ',');
    this.i = save;
    return ok;
  }
  parseParams(fscope) {
    this.expect('(');
    const params = [];
    if (this.is('void') && this.is(')', 1)) this.next();
    while (!this.is(')')) {
      if (this.accept('...')) throw this.err('Variadic functions are not supported by the simulator');
      const ty = this.parseType();
      let name = this.peek().t === 'id' ? this.ident() : `__p${params.length}`;
      while (this.accept('[')) { while (!this.is(']')) this.next(); this.expect(']'); }
      let def = null;
      if (this.accept('=')) def = this.convert(this.expr(fscope, 2), ty);
      fscope.vars.set(name, { name: ty.name, kind: ty.kind });
      params.push({ name: safeName(name), js: def !== null ? `${safeName(name)} = ${def}` : safeName(name), type: ty, intConv: ty.kind === 'int' && !ty.ref && !ty.ptr });
      if (!this.accept(',')) break;
    }
    this.expect(')');
    return params;
  }
  defaultValue(ty) {
    if (ty.dims && ty.dims.length) {
      const inner = { ...ty, dims: ty.dims.slice(1) };
      const d0 = ty.dims[0] ?? 0;
      return `Array.from({ length: __len(${d0}) }, () => ${this.defaultValue(inner)})`;
    }
    if (ty.ptr) return 'null';
    if (ty.kind === 'int' || ty.kind === 'float') return '0';
    if (ty.kind === 'bool') return 'false';
    if (ty.kind === 'str') return '""';
    if (ty.kind === 'obj') {
      const n = ty.name.replace(/<.*$/, '');
      if (/(^|::)(vector|array)$/.test(n)) return 'new __Vec()';
      if (/(^|::)(function|ActionPtr|shared_ptr|unique_ptr)$/.test(n) || n === 'ActionPtr') return 'null';
      const ti = this.types.get(n.split('::').pop());
      if (ti && ti.kind === 'enum') return '0';
      if (ti && ti.kind === 'alias') return this.defaultValue(ti.of);
      if (ti) return `new ${safeName(n.split('::').pop())}()`;
      // a framework / library class declared without arguments (e.g. `VL53L1X tof;`): default-construct it
      const base = n.split('::').pop();
      if (/^[A-Z]/.test(base) && this.runtime.names.get(base)?.type === 'obj') return `new ${safeName(base)}()`;
      return 'null';
    }
    return 'null';
  }
  convert(e, ty) {
    if (ty.kind === 'int' && !ty.ptr && (e.type === 'float' || e.type === 'unknown')) return `__int(${e.code})`;
    if (ty.kind === 'bool' && e.type !== 'bool') return `!!(${e.code})`;
    return e.code;
  }
  // { ... } initialiser for a declared variable of type ty
  braceInit(scope, cls, ty, direct = false) {
    const tok = this.peek();
    const inner = this.braceList(scope, cls);
    if (ty.dims && ty.dims.length) return ty.dims[0] ? `__pad(${inner.array}, __len(${ty.dims[0]}))` : inner.array;
    if (ty.kind === 'int' || ty.kind === 'float' || ty.kind === 'bool') return inner.items.length ? this.convert(inner.items[0], ty) : '0';
    const n = ty.name.replace(/<.*$/, '');
    if (/(^|::)(vector|array|initializer_list)$/.test(n)) return inner.array;
    if (n === 'ActionPtr' || /function$/.test(n)) return inner.items.length ? inner.items[0].code : 'null';
    const cname = safeName(n.split('::').pop());
    const ti = this.types.get(n.split('::').pop());
    if (!ti) { this.warnings.push({ msg: `Unknown type ${ty.name}`, file: tok.file, line: tok.line }); return inner.array; }
    if (ti.kind === 'alias') return this.braceInitFromList(inner, ti.of);
    // a class with a constructor: the braces are its arguments; a plain struct: aggregate initialisation
    if (ti.kind === 'class' && ti.info && !ti.info.ctor) return `new ${cname}(${inner.designated ? `{ __agg: true, named: ${inner.object} }` : `{ __agg: true, list: ${inner.array} }`})`;
    void direct;
    return `new ${cname}(${inner.items.map((x) => x.code).join(', ')})`;
  }
  braceInitFromList(inner, ty) {
    if (ty.kind === 'obj') return `new ${safeName(ty.name.split('::').pop())}(${inner.items.map((x) => x.code).join(', ')})`;
    return inner.items.length ? inner.items[0].code : '0';
  }
  // parse { a, b, .x = c } -> { items, array, object, designated }
  braceList(scope, cls) {
    this.expect('{');
    const items = [], named = [];
    while (!this.is('}')) {
      if (this.is('.') && this.peek(1).t === 'id' && this.is('=', 2)) {
        this.next(); const n = this.ident(); this.next();
        const v = this.is('{') ? this.braceExpr(scope, cls) : this.expr(scope, 2, cls);
        named.push([n, v.code]);
      } else items.push(this.is('{') ? this.braceExpr(scope, cls) : this.expr(scope, 2, cls));
      if (!this.accept(',')) break;
    }
    this.expect('}');
    return {
      items, designated: named.length > 0,
      array: `[${items.map((x) => x.code).join(', ')}]`,
      object: `{ ${named.map(([n, v]) => `${n}: ${v}`).join(', ')} }`,
    };
  }
  // a brace list used as a value (function argument, return, nested init)
  braceExpr(scope, cls) {
    const b = this.braceList(scope, cls);
    if (b.designated) return { code: `{ __agg: true, named: ${b.object} }`, type: 'obj' };
    return { code: `__list(${b.array})`, type: 'list' };
  }

  // ================================================================ statements
  block(parentScope, cls, ctx = {}) {
    const scope = new Scope(parentScope, ctx.fn ? 'fn' : 'block');
    if (ctx.params) for (const p of ctx.params) scope.vars.set(p.name, { name: p.type.name, kind: p.type.kind });
    const saveOut = this.stmtOut, saveFn = this.fnCtx;
    if (ctx.fn) this.fnCtx = ctx;
    this.stmtOut = [];
    this.expect('{');
    while (!this.is('}')) {
      if (this.peek().t === 'eof') throw this.err('Missing } at the end of a block');
      this.statement(scope, cls);
    }
    this.expect('}');
    const body = `{\n${this.stmtOut.map((s) => '  ' + s.replace(/\n/g, '\n  ')).join('\n')}\n}`;
    this.stmtOut = saveOut; this.fnCtx = saveFn;
    return body;
  }
  stmt(code) { this.stmtOut.push(code); }
  // statement as a standalone string (for if/for bodies without braces)
  subStatement(scope, cls) {
    if (this.is('{')) return this.block(scope, cls);
    const save = this.stmtOut;
    this.stmtOut = [];
    const inner = new Scope(scope, 'block');
    this.statement(inner, cls);
    const code = `{ ${this.stmtOut.join(' ')} }`;
    this.stmtOut = save;
    return code;
  }
  statement(scope, cls) {
    const t = this.peek();
    const L = `/*@${this.lineId(t)}*/`;
    if (t.t === 'pp') { this.next(); return; }
    if (this.accept(';')) return;
    if (this.is('{')) { this.stmt(this.block(scope, cls)); return; }
    switch (t.v) {
      case 'if': {
        this.next();
        this.accept('constexpr');
        this.expect('(');
        const c = this.condition(scope, cls);
        this.expect(')');
        const a = this.subStatement(scope, cls);
        let code = `${L}if (${c}) ${a}`;
        if (this.accept('else')) code += ` else ${this.subStatement(scope, cls)}`;
        this.stmt(code);
        return;
      }
      case 'while': {
        this.next(); this.expect('(');
        const c = this.condition(scope, cls);
        this.expect(')');
        const b = this.subStatement(scope, cls);
        this.stmt(`${L}while (${c}) { __guard(); ${b.slice(1)}`);
        return;
      }
      case 'do': {
        this.next();
        const b = this.subStatement(scope, cls);
        this.expect('while'); this.expect('(');
        const c = this.condition(scope, cls);
        this.expect(')'); this.expect(';');
        this.stmt(`${L}do { __guard(); ${b.slice(1)} while (${c});`);
        return;
      }
      case 'for': {
        this.next(); this.expect('(');
        const fscope = new Scope(scope, 'block');
        // range-for: for (auto& x : list)
        const save = this.i;
        if (this.looksLikeDecl(0)) {
          const ty = this.parseType();
          const nm = this.peek().t === 'id' ? this.ident() : null;
          if (nm && this.accept(':')) {
            const list = this.expr(fscope, 1, cls);
            this.expect(')');
            fscope.vars.set(nm, { name: ty.name, kind: ty.kind });
            const b = this.subStatement(fscope, cls);
            this.stmt(`${L}for (let ${safeName(nm)} of ${list.code}) { __guard(); ${b.slice(1)}`);
            return;
          }
          this.i = save;
        }
        let init = '';
        if (!this.is(';')) {
          if (this.looksLikeDecl(0)) {
            const saveOut = this.stmtOut; this.stmtOut = [];
            this.parseDeclOrFunction(fscope, { local: true, ctxCls: cls });
            init = this.stmtOut.join(' ').replace(/;\s*$/, '');
            this.stmtOut = saveOut;
          } else { init = this.exprList(fscope, cls); this.expect(';'); }
        } else this.expect(';');
        const c = this.is(';') ? '' : this.condition(fscope, cls);
        this.expect(';');
        const step = this.is(')') ? '' : this.exprList(fscope, cls);
        this.expect(')');
        const b = this.subStatement(fscope, cls);
        this.stmt(`${L}for (${init}; ${c}; ${step}) { __guard(); ${b.slice(1)}`);
        return;
      }
      case 'switch': {
        this.next(); this.expect('(');
        const c = this.expr(scope, 1, cls).code;
        this.expect(')');
        this.expect('{');
        const sscope = new Scope(scope, 'block');
        const save = this.stmtOut; this.stmtOut = [];
        while (!this.is('}')) {
          if (this.accept('case')) {
            const v = this.expr(sscope, 3, cls, { noColon: true }).code;
            this.expect(':');
            this.stmt(`case ${v}:`);
            continue;
          }
          if (this.is('default') && this.is(':', 1)) { this.next(); this.next(); this.stmt('default:'); continue; }
          this.statement(sscope, cls);
        }
        this.expect('}');
        const body = this.stmtOut.join('\n');
        this.stmtOut = save;
        this.stmt(`${L}switch (${c}) {\n${body}\n}`);
        return;
      }
      case 'break': this.next(); this.expect(';'); this.stmt('break;'); return;
      case 'continue': this.next(); this.expect(';'); this.stmt('continue;'); return;
      case 'return': {
        this.next();
        if (this.accept(';')) { this.stmt(`${L}return;`); return; }
        const e = this.is('{') ? this.braceExpr(scope, cls) : this.expr(scope, 1, cls);
        this.expect(';', 'after return');
        const rt = this.fnCtx?.ret;
        this.stmt(`${L}return ${rt ? this.convert(e, rt) : e.code};`);
        return;
      }
      case 'goto': throw this.err('goto is not supported by the simulator');
      case 'try': throw this.err('Exceptions (try/catch) are not used on the robot and are not supported');
      case 'delete': { this.next(); if (this.accept('[')) this.expect(']'); this.expr(scope, 1, cls); this.expect(';'); return; }
      case 'using': this.parseUsing(scope); return;
      case 'typedef': this.parseTypedef(scope); return;
      case 'case': case 'default': throw this.err(`'${t.v}' outside a switch`);
    }
    if (t.v === 'enum') { throw this.err('Declare enums outside functions'); }
    if ((t.v === 'struct' || t.v === 'class') && this.peek(1).t === 'id' && this.is('{', 2)) throw this.err('Declare classes and structs outside functions');
    if (this.looksLikeDecl(0)) {
      this.stmtOut.push(L.trim());
      this.parseDeclOrFunction(scope, { local: true, ctxCls: cls });
      // parseDeclOrFunction pushes to stmtOut; the member context for initialisers needs the class
      return;
    }
    const e = this.exprList(scope, cls);
    this.expect(';', 'at the end of the statement');
    this.stmt(`${L}${e};`);
  }
  lineId(t) { this.lineMap = this.lineMap || []; this.lineMap.push({ file: t.file, line: t.line }); return this.lineMap.length - 1; }
  condition(scope, cls) {
    // if (int x = f()) is rare; plain expression conditions
    if (this.looksLikeDecl(0)) throw this.err('Declarations inside conditions are not supported; declare the variable on the line before');
    return this.exprList(scope, cls);
  }
  exprList(scope, cls) {
    const parts = [this.expr(scope, 1, cls).code];
    while (this.accept(',')) parts.push(this.expr(scope, 1, cls).code);
    return parts.join(', ');
  }

  // ================================================================ expressions (Pratt parser)
  // prec: 1 = comma excluded (assignment allowed), 2 = assignment-expression, 3 = conditional (for case labels)
  expr(scope, minPrec = 1, cls = this.classStack[this.classStack.length - 1], opts = {}) {
    this.curCls = cls;
    return this.assign(scope, cls, opts);
  }
  assign(scope, cls, opts) {
    const lhs = this.ternary(scope, cls, opts);
    const t = this.peek();
    if (t.t === 'p' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.v)) {
      this.next();
      const rhs = this.is('{') ? this.braceExpr(scope, cls) : this.assign(scope, cls, opts);
      if (lhs.type === 'int' && t.v === '/=') return { code: `${lhs.code} = __idiv(${lhs.code}, ${rhs.code})`, type: 'int' };
      if (lhs.type === 'int' && t.v === '=' ) return { code: `${lhs.code} = ${rhs.type === 'float' || rhs.type === 'unknown' ? `__int(${rhs.code})` : rhs.code}`, type: 'int' };
      if (lhs.type === 'int' && (t.v === '*=' || t.v === '+=' || t.v === '-=') && rhs.type === 'float') return { code: `${lhs.code} = __int(${lhs.code} ${t.v[0]} (${rhs.code}))`, type: 'int' };
      if (lhs.type === 'bool' && t.v === '=') return { code: `${lhs.code} = !!(${rhs.code})`, type: 'bool' };
      if (lhs.objInit && t.v === '=' && rhs.type === 'list') return { code: `${lhs.code} = ${rhs.code}`, type: lhs.type };
      return { code: `${lhs.code} ${t.v} ${rhs.code}`, type: lhs.type };
    }
    return lhs;
  }
  ternary(scope, cls, opts) {
    const c = this.binary(scope, cls, 0, opts);
    if (!this.is('?')) return c;
    this.next();
    const a = this.assign(scope, cls, {});
    this.expect(':', 'in the ?: expression');
    const b = this.assign(scope, cls, opts);
    return { code: `(${c.code} ? ${a.code} : ${b.code})`, type: a.type === b.type ? a.type : (a.type === 'float' || b.type === 'float') ? 'float' : a.type };
  }
  binary(scope, cls, minLevel, opts) {
    const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
    const level = (op) => LEVELS.findIndex((l) => l.includes(op));
    let lhs = this.unary(scope, cls);
    for (;;) {
      const t = this.peek();
      if (t.t !== 'p') break;
      const lv = level(t.v);
      if (lv < 0 || lv < minLevel) break;
      this.next();
      const rhs = this.binary(scope, cls, lv + 1, opts);
      const num = (x) => x === 'int' || x === 'float' || x === 'bool';
      let type;
      if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(t.v)) type = 'bool';
      else if (lhs.type === 'float' || rhs.type === 'float') type = 'float';
      else if (lhs.type === 'str' || rhs.type === 'str') type = 'str';
      else if (num(lhs.type) && num(rhs.type)) type = 'int';
      else type = 'unknown';
      let code;
      if (t.v === '/' && type === 'int') code = `__idiv(${lhs.code}, ${rhs.code})`;
      else if (t.v === '%' && type === 'int') code = `(${lhs.code} % ${rhs.code})`;
      else if (t.v === '==' ) code = `(${lhs.code} === ${rhs.code})`;
      else if (t.v === '!=') code = `(${lhs.code} !== ${rhs.code})`;
      else code = `(${lhs.code} ${t.v} ${rhs.code})`;
      // comparing a C string to a string literal compares pointers in C++; in practice students mean equality
      lhs = { code, type };
    }
    return lhs;
  }
  unary(scope, cls) {
    const t = this.peek();
    if (t.t === 'p') {
      if (t.v === '!' ) { this.next(); const e = this.unary(scope, cls); return { code: `!${e.code}`, type: 'bool' }; }
      if (t.v === '-' || t.v === '+' || t.v === '~') { this.next(); const e = this.unary(scope, cls); return { code: `${t.v}${e.code}`, type: e.type === 'bool' ? 'int' : e.type }; }
      if (t.v === '++' || t.v === '--') { this.next(); const e = this.unary(scope, cls); return { code: `${t.v}${e.code}`, type: e.type }; }
      if (t.v === '*' || t.v === '&') { this.next(); return this.unary(scope, cls); }   // pointers: objects are references in JS
      // C-style cast: (int)x, (float)(a / b), (uint8_t)v
      if (t.v === '(' && this.isCastAhead()) {
        this.next();
        const ty = this.parseType();
        this.expect(')');
        const e = this.unary(scope, cls);
        return this.castTo(ty, e);
      }
    }
    if (t.v === 'sizeof') throw this.err('sizeof is not supported by the simulator');
    if (t.v === 'new') {
      this.next();
      const ty = this.parseType();
      const args = [];
      if (this.accept('(')) { while (!this.is(')')) { args.push(this.expr(scope, 2, cls).code); if (!this.accept(',')) break; } this.expect(')'); }
      else if (this.is('{')) { const b = this.braceList(scope, cls); args.push(...b.items.map((x) => x.code)); }
      if (this.accept('[')) throw this.err('new[] arrays are not supported; use a fixed-size array');
      return { code: `new ${this.ctorName(ty.name)}(${args.join(', ')})`, type: 'obj', cls: ty.name };
    }
    return this.postfix(scope, cls);
  }
  isCastAhead() {
    // ( type ) followed by something that can start an operand
    const k = this.skipType(1);
    if (k === null || this.peek(k).v !== ')') return false;
    const name = this.peek(1).v === 'const' ? this.peek(2).v : this.peek(1).v;
    if (!(PRIM_INT.has(name) || PRIM_FLOAT.has(name) || name === 'bool' || (this.types.has(name) && this.types.get(name).kind !== 'runtime'))) return false;
    const n = this.peek(k + 1);
    return n.t === 'id' || n.t === 'num' || n.t === 'str' || ['(', '-', '+', '!', '~', '*', '&'].includes(n.v);
  }
  castTo(ty, e) {
    if (ty.ptr) return e;
    if (ty.kind === 'int') return { code: ty.name === 'char' || /uint8|int8/.test(ty.name) ? `__u8(${e.code})` : `__int(${e.code})`, type: 'int' };
    if (ty.kind === 'float') return { code: `(+${e.code})`, type: 'float' };
    if (ty.kind === 'bool') return { code: `!!(${e.code})`, type: 'bool' };
    return e;
  }
  postfix(scope, cls) {
    let e = this.primary(scope, cls);
    for (;;) {
      const t = this.peek();
      if (t.v === '.' || t.v === '->') {
        this.next();
        const m = this.peek().v === '~' ? (this.next(), '~' + this.ident()) : this.ident();
        e = { code: `${e.code}.${safeName(m)}`, type: this.memberType(e, m), obj: e, member: m };
        continue;
      }
      if (t.v === '::') {
        this.next();
        const m = this.ident();
        e = { code: `${e.code}.${safeName(m)}`, type: this.memberType(e, m) };
        continue;
      }
      if (t.v === '(') {
        this.next();
        const args = [];
        while (!this.is(')')) {
          args.push(this.is('{') ? this.braceExpr(scope, cls) : this.expr(scope, 2, cls));
          if (!this.accept(',')) break;
        }
        this.expect(')', 'to close the call');
        e = this.call(e, args, t);
        continue;
      }
      if (t.v === '[') {
        this.next();
        const idx = this.expr(scope, 1, cls);
        this.expect(']');
        // indices must be numbers at run time: a string key (e.g. ["constructor"]) could reach JavaScript internals
        e = { code: `${e.code}[__ix(${idx.code})]`, type: e.elem || 'unknown' };
        continue;
      }
      if (t.v === '++' || t.v === '--') { this.next(); e = { code: `${e.code}${t.v}`, type: e.type }; continue; }
      if (t.v === '{' && e.isType) {
        // Type{ ... } temporary
        const b = this.braceList(scope, cls);
        const n = e.typeName;
        const ti = this.types.get(n);
        if (ti && ti.kind === 'class' && ti.info && !ti.info.ctor) e = { code: `new ${safeName(n)}(${b.designated ? `{ __agg: true, named: ${b.object} }` : `{ __agg: true, list: ${b.array} }`})`, type: 'obj', cls: n };
        else if (PRIM_INT.has(n) || PRIM_FLOAT.has(n)) e = { code: b.items.length ? b.items[0].code : '0', type: PRIM_INT.has(n) ? 'int' : 'float' };
        else e = { code: `new ${safeName(n)}(${b.designated ? b.object : b.items.map((x) => x.code).join(', ')})`, type: 'obj', cls: n };
        continue;
      }
      break;
    }
    return e;
  }
  call(fn, args, tok) {
    const a = args.map((x) => x.code);
    // functional cast: int(x), float(x)
    if (fn.isType) {
      const n = fn.typeName;
      if (PRIM_INT.has(n)) return { code: `__int(${a[0] ?? 0})`, type: 'int' };
      if (PRIM_FLOAT.has(n)) return { code: `(+${a[0] ?? 0})`, type: 'float' };
      if (n === 'bool') return { code: `!!(${a[0]})`, type: 'bool' };
      if (n === 'String' || n === 'string') return { code: `__String(${a.join(', ')})`, type: 'str' };
      return { code: `new ${safeName(n)}(${a.join(', ')})`, type: 'obj', cls: n };
    }
    if (fn.template === 'make_shared' || fn.template === 'make_unique') return { code: `new ${safeName(fn.targ)}(${a.join(', ')})`, type: 'obj', cls: fn.targ };
    if (fn.template === 'static_cast' || fn.template === 'reinterpret_cast' || fn.template === 'const_cast' || fn.template === 'dynamic_cast') return this.castTo(fn.tty, args[0]);
    if (fn.template === 'min' || fn.template === 'max') return { code: `${fn.code}(${a.join(', ')})`, type: 'float' };
    const ret = fn.ret || (fn.member ? this.methodRet(fn.member) : 'unknown');
    return { code: `${fn.code}(${a.join(', ')})`, type: ret };
  }
  methodRet(m) {
    if (/^(get(Position|Heading|DistanceInches|BatteryVoltage|MainCurrent|MotorCurrent|ServoCurrent|Accel[XYZ]|Gyro[XYZ]|Temp|Scale|MinAngle|MaxAngle)|leftX|leftY|rightX|rightY|get|rawTiltX|rawTiltY|readChannelVoltage)$/.test(m)) return 'float';
    if (/^(getSpeed|size|length|readRaw)$/.test(m)) return 'int';
    if (/^(is[A-Z]\w*|pressed|justPressed|justReleased|begin|read|run|empty)$/.test(m)) return 'bool';
    return 'unknown';
  }
  memberType(obj, m) {
    if (obj.isEnumObj) return 'int';
    const clsName = obj.cls || (obj.typeName ? obj.typeName : null);
    if (clsName) {
      const ti = this.types.get(String(clsName).replace(/<.*$/, '').split('::').pop());
      if (ti && ti.info) {
        const f = ti.info.fields.find((x) => x.name === m);
        if (f) return f.type.kind === 'obj' ? 'obj' : f.type.kind;
        const me = ti.info.methods.find((x) => x.name === m);
        if (me) return 'fn';
      }
    }
    if (/^(driveSpeed|turnSpeed|turnMinSpeed|driveMinSpeed)$/.test(m)) return 'int';
    if (/^(msPerInch|turnSlowdownDeg|turnToleranceDeg|distFuseImuWeight|distTimeoutScale|driveSlowdownIn|accel[XYZ]|gyro[XYZ]|tempC|batteryV|mainA|motorA|servoA)$/.test(m)) return 'float';
    return 'unknown';
  }
  primary(scope, cls) {
    const t = this.next();
    if (t.t === 'num') return { code: t.v, type: t.float ? 'float' : 'int' };
    if (t.t === 'str') {
      let code = t.v;
      while (this.peek().t === 'str') code += ' + ' + this.next().v;   // "a" "b" concatenation
      return { code, type: 'str' };
    }
    if (t.v === '(') {
      const e = this.assignOrComma(scope, cls);
      this.expect(')', 'to close the parenthesis');
      return { code: `(${e.code})`, type: e.type };
    }
    if (t.v === '[') return this.lambda(scope, cls, t);
    if (t.v === '{') { this.i--; return this.braceExpr(scope, cls); }
    if (t.v === '::') return this.primary(scope, cls);
    if (t.t !== 'id') throw new CompileError(`Unexpected '${t.v}' in an expression`, t);
    switch (t.v) {
      case 'true': case 'false': return { code: t.v, type: 'bool' };
      case 'nullptr': case 'NULL': return { code: 'null', type: 'ptr' };
      case 'this': return { code: 'this', type: 'obj', cls: cls?.name };
      case 'static_cast': case 'reinterpret_cast': case 'const_cast': case 'dynamic_cast': {
        this.expect('<'); const ty = this.parseType(); this.expect('>');
        return { code: '', template: 'static_cast', tty: ty };
      }
    }
    // std:: things
    if (t.v === 'std' && this.is('::')) {
      this.next();
      const m = this.ident();
      if ((m === 'make_shared' || m === 'make_unique') && this.is('<')) { this.next(); const ty = this.parseType(); this.expect('>'); return { code: '', template: m, targ: ty.name.split('::').pop() }; }
      if ((m === 'min' || m === 'max') && this.is('<')) { this.next(); this.parseType(); this.expect('>'); return { code: `std.${safeName(m)}`, template: m }; }
      if (m === 'function' || m === 'vector' || m === 'shared_ptr' || m === 'array') { this.i -= 3; const ty = this.parseType(); return { code: safeName(ty.name), isType: true, typeName: ty.name.replace(/<.*$/, '').split('::').pop() }; }
      return { code: `std.${safeName(m)}`, type: 'unknown', ret: /^(abs|fabs|min|max|clamp|sqrt|pow|round|floor|ceil|sin|cos|tan|atan2|hypot|fmod)$/.test(m) ? 'float' : 'unknown' };
    }
    const name = t.v;
    // a type used as a value: functional cast int(x), Type{...}, Type(...), Enum::Value
    if (this.isTypeName(name) && !scope.lookup(name) && !this.memberOf(cls, name)) {
      if (this.is('::')) {
        this.next();
        const m = this.ident();
        const ti = this.types.get(name);
        if (ti && ti.kind === 'enum') {
          if (ti.values && !ti.values.includes(m)) throw this.err(`${name} has no value named ${m}`);
          return { code: `${safeName(ti.cls ? `${ti.cls}__${name}` : name)}.${safeName(m)}`, type: 'int' };
        }
        if (ti && ti.kind === 'class') {
          const owner = ti.info;
          if (owner && owner.enumVals.has(m)) return { code: safeName(owner.enumVals.get(m)), type: 'int' };
          if (owner && owner.enums.has(m)) return { code: safeName(owner.enums.get(m)), isEnumObj: true, type: 'obj' };
          return { code: `${safeName(name)}.${safeName(m)}`, type: 'unknown' };
        }
        return { code: `${safeName(name)}.${safeName(m)}`, type: 'unknown' };
      }
      if (this.is('(') || this.is('{')) return { code: safeName(name), isType: true, typeName: name };
      if (this.is('<')) { const save = this.i - 1; this.i = save; const ty = this.parseType(); return { code: safeName(ty.name), isType: true, typeName: ty.name.replace(/<.*$/, '') }; }
    }
    return this.resolveName(name, scope, cls, t);
  }
  assignOrComma(scope, cls) {
    let e = this.assign(scope, cls, {});
    while (this.is(',')) { this.next(); const r = this.assign(scope, cls, {}); e = { code: `${e.code}, ${r.code}`, type: r.type }; }
    return e;
  }
  memberOf(cls, name) {
    for (let c = cls; c; c = c.base ? this.types.get(c.base)?.info : null) {
      if (c.memberNames.has(name) || c.fields.some((f) => f.name === name) || c.methods.some((m) => m.name === name)) return c;
    }
    return null;
  }
  resolveName(name, scope, cls, tok) {
    const local = scope.lookup(name);
    if (local) {
      if (local.alias) return { code: local.alias, type: local.kind };
      return { code: safeName(name), type: local.kind === 'arr' ? 'arr' : local.kind, elem: local.elem, cls: local.name };
    }
    if (cls) {
      if (cls.enumVals.has(name)) return { code: safeName(cls.enumVals.get(name)), type: 'int' };
      if (cls.enums.has(name)) return { code: safeName(cls.enums.get(name)), type: 'obj', isEnumObj: true };
      const owner = this.memberOf(cls, name);
      if (owner) {
        const f = owner.fields.find((x) => x.name === name);
        const isStatic = owner.staticNames.has(name) || (f && f.static);
        const type = f ? (f.type.dims?.length ? 'arr' : f.type.kind) : 'unknown';
        return { code: isStatic ? `${safeName(owner.name)}.${safeName(name)}` : `this.${safeName(name)}`, type, elem: f?.type.kind, cls: f?.type.name, member: name, ret: owner.methods.find((m) => m.name === name)?.ret?.kind };
      }
      // members inherited from the runtime base class (NRLOpMode: telemetry, runAction, ...)
      if (cls.base && this.runtime.baseMembers?.[cls.base]?.includes(name)) return { code: `this.${name}`, type: 'unknown', member: name };
    }
    // enum values declared inside other classes are not visible here; globals next
    const g = this.globals.get(name);
    if (g) return { code: safeName(name), type: g.kind === 'arr' ? 'arr' : g.fn ? 'fn' : g.kind, ret: g.fn ? g.ret : undefined, elem: g.elem, cls: g.name };
    if (this.runtime.names.has(name)) {
      const r = this.runtime.names.get(name);
      return { code: safeName(name), type: r.type || 'unknown', ret: r.ret, cls: r.cls };
    }
    // a type used later as a value (e.g. a class declared below) - leave it, JS will resolve it
    if (this.types.has(name)) return { code: safeName(name), type: 'unknown' };
    this.unknown = this.unknown || [];
    this.unknown.push({ name, file: tok.file, line: tok.line });
    return { code: safeName(name), type: 'unknown' };
  }
  lambda(scope, cls, tok) {
    // capture list: [this], [&], [=], [a, &b], [this, s]
    while (!this.is(']')) this.next();
    this.expect(']');
    const lscope = new Scope(scope, 'fn');
    let params = [];
    if (this.is('(')) params = this.parseParams(lscope);
    while (this.peek().t === 'id' && ['mutable', 'constexpr', 'noexcept'].includes(this.peek().v)) this.next();
    let ret = null;
    if (this.accept('->')) ret = this.parseType();
    const body = this.block(lscope, cls, { fn: true, params, ret });
    void tok;
    return { code: `((${params.map((p) => p.js).join(', ')}) => ${body})`, type: 'fn', ret: ret?.kind };
  }

  // ================================================================ output
  result() {
    if (this.unknown && this.unknown.length) {
      const u = this.unknown[0];
      const err = new CompileError(`Unknown name '${u.name}'. Is it declared in a file you have not imported?`, u);
      err.all = this.unknown;
      throw err;
    }
    const lines = [];
    for (const s of this.statics) lines.push(s.code);
    for (const o of this.out) lines.push(o.code);
    return { js: lines.join('\n'), registry: this.registry, warnings: this.warnings, lineMap: this.lineMap || [], globals: [...this.globals.keys()] };
  }
}

function typeKind(name, ptr) {
  const n = name.replace(/<.*$/, '').split('::').pop();
  if (ptr && (n === 'char')) return 'str';
  if (PRIM_INT.has(n) || n === 'char') return 'int';
  if (PRIM_FLOAT.has(n)) return 'float';
  if (n === 'bool' || n === 'boolean') return 'bool';
  if (n === 'String' || n === 'string') return 'str';
  if (n === 'void') return 'void';
  if (n === 'auto') return 'unknown';
  return 'obj';
}

// ---------------------------------------------------------------- public API
// files: [{ name, text }]. Every .cpp/.ino file is a translation unit; headers are pulled in by #include.
// Returns { js, registry, warnings, lineMap } or throws CompileError.
export function compileFiles(files, runtime) {
  if (!Array.isArray(files) || files.length > 64 || files.some((f) => typeof f.name !== 'string' || typeof f.text !== 'string') || files.reduce((n, f) => n + f.text.length, 0) > 1000000) throw new CompileError('Import at most 64 source files and 1 MB of code', {});
  const units = files.filter((f) => /\.(cpp|cc|cxx|ino)$/i.test(f.name));
  const roots = units.length ? units : files;
  // one program: headers included by several units are compiled once (#pragma once / guards) and shared;
  // each .cpp file's own declarations live in their own block scope
  const seen = new Set();
  const warnings = [];
  const c = new Compiler([], runtime);
  for (const f of roots) {
    const key = baseName(f.name).toLowerCase();
    const { toks, warnings: w } = preprocess(files.filter((x) => !seen.has(baseName(x.name).toLowerCase()) || x === f), f, runtime.defines);
    warnings.push(...w);
    seen.add(key);
    for (const t of toks) seen.add(baseName(t.file).toLowerCase());
    const shared = toks.filter((t) => baseName(t.file).toLowerCase() !== key), own = toks.filter((t) => baseName(t.file).toLowerCase() === key);
    if (shared.length) c.run(shared, false);
    if (own.length) c.run(own, roots.length > 1);
  }
  const res = c.result();
  res.warnings.unshift(...warnings);
  return res;
}
