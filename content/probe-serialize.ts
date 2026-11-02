// Vue 探针的序列化工具(主世界):安全地把 props / 状态转成有界 JSON 字符串。
// 构建时随 vue-probe.ts 打包为单个 IIFE 经典脚本。

const MAX_STR = 200;

export function trunc(s: unknown, n: number = MAX_STR * 2): string {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

export function safeStringify(value: unknown, depth = 0): string {
  try {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value.length > MAX_STR ? value.slice(0, MAX_STR) + '…' : value);
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (typeof value === 'function') return '[fn ' + ((value as { name?: string }).name || 'anonymous').slice(0, 40) + ']';
    if (typeof value === 'symbol') return String(value);
    if (value instanceof Error) return `[${value.name}] ${String(value.message).slice(0, MAX_STR)}`;
    if (typeof value !== 'object') return String(value);
    if (depth >= 3) return '[…]';
    if (Array.isArray(value)) {
      const arr = value.slice(0, 20).map((v) => safeStringify(v, depth + 1));
      return '[' + arr.join(',') + (value.length > 20 ? `,…共${value.length}项` : '') + ']';
    }
    if (value instanceof Map || value instanceof Set) {
      const items = [...(value as Map<unknown, unknown>)].slice(0, 10).map((v) => safeStringify(v, depth + 1));
      return `${value.constructor.name}(${(value as Map<unknown, unknown>).size}){${items.join(',')}}`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).slice(0, 24);
    const body = keys.map((k) => `${k}: ${safeStringify(obj[k], depth + 1)}`).join(', ');
    return '{' + body + (Object.keys(obj).length > 24 ? ',…' : '') + '}';
  } catch {
    return '[序列化失败]';
  }
}

/** 最小化组件实例形状(避开 Vue 内部类型) */
interface Vue2Instance {
  $options: { name?: string; _componentTag?: string };
  $props: unknown;
}
interface Vue3Instance {
  type: { __name?: string; name?: string; __file?: string };
  parent?: Vue3InstanceLike;
  appContext?: { provides?: Record<PropertyKey, unknown>; _context?: { provides?: Record<PropertyKey, unknown> } };
}
interface Vue3InstanceLike {
  __vue2?: Vue2Instance;
  type?: { __name?: string; name?: string; __file?: string };
  parent?: Vue3InstanceLike;
}

export function serializeProps(inst: Vue3InstanceLike | null): string | null {
  if (!inst) return null;
  if (inst.__vue2) {
    try {
      return trunc(safeStringify(inst.__vue2.$props));
    } catch {
      return null;
    }
  }
  const vue3 = inst as unknown as { props?: Record<string, unknown> };
  try {
    const props = vue3.props || {};
    const keys = Object.keys(props);
    if (!keys.length) return null;
    const out: Record<string, string> = {};
    for (const k of keys.slice(0, 20)) out[k] = safeStringify(props[k]);
    return trunc(JSON.stringify(out), 1500);
  } catch {
    return null;
  }
}

export type { Vue2Instance, Vue3Instance };
