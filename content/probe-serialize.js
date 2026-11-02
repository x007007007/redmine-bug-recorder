// Vue 探针的序列化工具(主世界):安全地把 props / 状态转成有界 JSON 字符串。

var __bugrecSer = (() => {
  const MAX_STR = 200;

  function trunc(s, n = MAX_STR * 2) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function safeStringify(value, depth = 0) {
    try {
      if (value === undefined) return 'undefined';
      if (value === null) return 'null';
      const t = typeof value;
      if (t === 'string') return JSON.stringify(value.length > MAX_STR ? value.slice(0, MAX_STR) + '…' : value);
      if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
      if (t === 'function') return '[fn ' + (value.name || 'anonymous').slice(0, 40) + ']';
      if (t === 'symbol') return value.toString();
      if (value instanceof Error) return `[${value.name}] ${String(value.message).slice(0, MAX_STR)}`;
      if (t !== 'object') return String(value);
      if (depth >= 3) return '[…]';
      if (Array.isArray(value)) {
        const arr = value.slice(0, 20).map((v) => safeStringify(v, depth + 1));
        return '[' + arr.join(',') + (value.length > 20 ? `,…共${value.length}项` : '') + ']';
      }
      if (value instanceof Map || value instanceof Set) {
        const items = [...value].slice(0, 10).map((v) => safeStringify(v, depth + 1));
        return `${value.constructor.name}(${value.size}){${items.join(',')}}`;
      }
      const keys = Object.keys(value).slice(0, 24);
      const body = keys.map((k) => `${k}: ${safeStringify(value[k], depth + 1)}`).join(', ');
      return '{' + body + (Object.keys(value).length > 24 ? ',…' : '') + '}';
    } catch {
      return '[序列化失败]';
    }
  }

  function serializeProps(inst) {
    if (!inst || inst.__vue2) {
      if (inst && inst.__vue2) {
        try {
          return trunc(safeStringify(inst.__vue2.$props));
        } catch {
          return null;
        }
      }
      return null;
    }
    try {
      const props = inst.props || {};
      const keys = Object.keys(props);
      if (!keys.length) return null;
      const out = {};
      for (const k of keys.slice(0, 20)) out[k] = safeStringify(props[k]);
      return trunc(JSON.stringify(out), 1500);
    } catch {
      return null;
    }
  }

  return { trunc, safeStringify, serializeProps };
})();
