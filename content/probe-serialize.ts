// 探针序列化工具(主世界):安全地把 props / 状态转成有界 JSON 字符串。
// 构建时随 framework-probe.ts 打包为单个 IIFE 经典脚本。

const MAX_STR = 200;

export function trunc(s: unknown, n: number = MAX_STR * 2): string {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

/* ---- 各类型各自的渲染规则,替代一长串 if-else ---- */

type Stringifier = (value: unknown, depth: number) => string;

function renderScalar(value: unknown): string | null {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return JSON.stringify(value.length > MAX_STR ? value.slice(0, MAX_STR) + '…' : value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function') return '[fn ' + ((value as { name?: string }).name || 'anonymous').slice(0, 40) + ']';
  if (value instanceof Error) return `[${value.name}] ${String(value.message).slice(0, MAX_STR)}`;
  if (typeof value !== 'object') return String(value);
  return null;
}

/** 数组:只展开前 20 项 */
function renderArray(value: unknown[], depth: number, stringify: Stringifier): string {
  const items = value.slice(0, 20).map((v) => stringify(v, depth + 1));
  return '[' + items.join(',') + (value.length > 20 ? `,…共${value.length}项` : '') + ']';
}

/** Map / Set:用迭代器取前 10 项,不整表展开(大容器不拷贝) */
function renderMapSet(value: Map<unknown, unknown> | Set<unknown>, depth: number, stringify: Stringifier): string {
  const items: string[] = [];
  for (const v of value) {
    if (items.length >= 10) break;
    items.push(stringify(v, depth + 1));
  }
  return `${value.constructor.name}(${value.size}){${items.join(',')}}`;
}

function renderObject(value: Record<string, unknown>, depth: number, stringify: Stringifier): string {
  if (depth >= 3) return '[…]';
  const keys = Object.keys(value).slice(0, 24);
  const body = keys.map((k) => `${k}: ${stringify(value[k], depth + 1)}`).join(', ');
  return '{' + body + (Object.keys(value).length > 24 ? ',…' : '') + '}';
}

export function safeStringify(value: unknown, depth = 0): string {
  try {
    const scalar = renderScalar(value);
    if (scalar !== null) return scalar;
    if (Array.isArray(value)) return renderArray(value, depth, safeStringify);
    if (value instanceof Map || value instanceof Set) return renderMapSet(value, depth, safeStringify);
    return renderObject(value as Record<string, unknown>, depth, safeStringify);
  } catch {
    return '[序列化失败]';
  }
}

/** 最小化组件实例形状(避开框架内部类型) */
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
  parent?: Vue3InstanceLike | null;
}

/** 把一个 props 对象收成有界 JSON(Vue3 props / React memoizedProps 共用) */
export function serializePropsObject(props: Record<string, unknown> | null | undefined, maxKeys = 20): string | null {
  if (!props) return null;
  try {
    const keys = Object.keys(props);
    if (!keys.length) return null;
    const out: Record<string, string> = {};
    for (const k of keys.slice(0, maxKeys)) out[k] = safeStringify(props[k]);
    return trunc(JSON.stringify(out), 1500);
  } catch {
    return null;
  }
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
  return serializePropsObject((inst as unknown as { props?: Record<string, unknown> }).props);
}

export type { Vue2Instance, Vue3Instance };
