// Vue 探针(主世界,manifest "world": "MAIN"):
//  - el.__vueParentComponent → 组件链(名称 + 当时的 props 快照)
//  - appContext → 定位 Pinia(带 _s Map 的 provide),订阅 $subscribe / $onAction
//  - 每次探针对比 store 快照,返回发生变化的 store
// 兼容:Vue3 dev/Vite 下组件链与 props 最完整;生产构建可能拿不到 __vueParentComponent,
// 自动降级(选择器/输入值/Pinia 变化仍可用)。协议见 recorder.ts;序列化在 probe-serialize.ts。
// 构建时打包为单个 IIFE 经典脚本。

import { trunc, safeStringify, serializeProps } from './probe-serialize';
import type { PiniaChange, VueInfo } from '../shared/types';

interface PiniaLike {
  _s: Map<string, PiniaStore>;
}
interface PiniaStore {
  $state: unknown;
  $subscribe(cb: (mutation: PiniaMutation) => void, opts?: { detached?: boolean }): () => void;
  $onAction?(cb: (ctx: { name: string; args: unknown[] }) => void, detached?: boolean): () => void;
}
interface PiniaMutation {
  type: string;
  events?: { key?: string } | { key?: string }[] | null;
}

function install(): void {
  if ((window as unknown as Record<string, unknown>).__bugrecVueProbe) return;
  (window as unknown as Record<string, unknown>).__bugrecVueProbe = true;

  const MAX_STATE = 4096;
  const pinias = new Set<PiniaLike>(); // 已订阅的 pinia 实例
  const lastSnap = new WeakMap<PiniaLike, Map<string, string>>(); // pinia -> (storeId -> state json)

  /* ---- Vue 组件实例(避不开内部字段,做最小形状断言) ---- */
  interface Inst {
    __vue2?: { $options: { name?: string; _componentTag?: string }; $props: unknown };
    type?: { __name?: string; name?: string; __file?: string };
    parent?: Inst | null;
    appContext?: { provides?: Record<PropertyKey, unknown>; _context?: { provides?: Record<PropertyKey, unknown> } };
  }

  function findInstance(el: Element): Inst | null {
    let cur: Element | null = el;
    while (cur) {
      const holder = cur as Element & { __vueParentComponent?: Inst; __vue__?: { $options: { name?: string } } };
      if (holder.__vueParentComponent) return holder.__vueParentComponent; // Vue 3
      if (holder.__vue__) return { __vue2: holder.__vue__ as Inst['__vue2'] }; // Vue 2(有限支持)
      cur = cur.parentElement;
    }
    return null;
  }

  function componentName(inst: Inst | null): string | null {
    if (!inst) return null;
    if (inst.__vue2) {
      const opts = inst.__vue2.$options || {};
      return opts.name || opts._componentTag || null;
    }
    const t = inst.type || {};
    return t.__name || t.name || (t.__file ? t.__file.split('/').pop()!.replace(/\.\w+$/, '') : null);
  }

  function componentChain(inst: Inst | null, max = 4): string[] {
    const names: string[] = [];
    let cur = inst;
    while (cur && names.length < max) {
      const n = componentName(cur);
      if (n) names.push(n);
      cur = cur.parent ?? null;
    }
    return names;
  }

  function findPinia(inst: Inst): PiniaLike | null {
    try {
      const provides =
        inst.appContext && (inst.appContext.provides || (inst.appContext._context && inst.appContext._context.provides)) || {};
      for (const k of Reflect.ownKeys(provides)) {
        const v = provides[k];
        if (v && (v as PiniaLike)._s instanceof Map) return v as PiniaLike;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function dispatchPinia(detail: Record<string, unknown>): void {
    try {
      document.dispatchEvent(new CustomEvent('bugrec:pinia', { detail }));
    } catch {
      /* ignore */
    }
  }

  function subscribePinia(pinia: PiniaLike): void {
    pinias.add(pinia);
    for (const [id, store] of pinia._s) {
      try {
        // 状态变更流(含直接赋值 / $patch / action 内部变更)
        store.$subscribe(
          (mutation) => {
            const keys: string[] =
              mutation.events == null
                ? []
                : Array.isArray(mutation.events)
                  ? mutation.events.map((ev) => ev && ev.key).filter((k): k is string => !!k)
                  : mutation.events.key
                    ? [mutation.events.key]
                    : [];
            dispatchPinia({ storeId: String(id), changeType: mutation.type, keys: keys.slice(0, 12) });
          },
          { detached: true }
        );
        // action 调用流
        if (typeof store.$onAction === 'function') {
          store.$onAction(({ name, args }) => {
            dispatchPinia({ storeId: String(id), action: String(name), args: trunc(safeStringify(args), 300) });
          }, true);
        }
      } catch {
        /* 单个 store 订阅失败不影响整体 */
      }
    }
  }

  function snapMap(pinia: PiniaLike): Map<string, string> {
    let m = lastSnap.get(pinia);
    if (!m) {
      m = new Map();
      lastSnap.set(pinia, m);
    }
    return m;
  }

  function snapshotChangedStores(): PiniaChange[] {
    const out: PiniaChange[] = [];
    for (const pinia of pinias) {
      const snaps = snapMap(pinia);
      for (const [id, store] of pinia._s) {
        let json: string;
        try {
          json = JSON.stringify(store.$state);
        } catch {
          continue;
        }
        if (json == null) continue;
        const cut = json.length > MAX_STATE ? json.slice(0, MAX_STATE) + '…(截断)' : json;
        const prev = snaps.get(String(id));
        if (prev !== cut) {
          out.push({ storeId: String(id), state: cut, firstSeen: !snaps.has(String(id)) });
          snaps.set(String(id), cut);
        }
      }
    }
    return out;
  }

  document.addEventListener(
    'bugrec:probe',
    (e) => {
      // Firefox 下隔离世界 CustomEvent.detail 对页面不可读（Xray 不透明对象，
      // 读属性抛 "Permission denied to access property"）——防御性读取，失败
      // 时回退 window 通道（与 __bugrecVueProbe 标记同款跨 realm 通路）。
      let id: string | undefined;
      try {
        id = (e as CustomEvent<{ id?: string }>).detail?.id;
      } catch {
        id = undefined;
      }
      if (!id) {
        try {
          id = (window as unknown as { __bugrecProbeId?: string }).__bugrecProbeId;
        } catch {
          id = undefined;
        }
      }
      // 扁平结构:{ component, chain, props, piniaChanges, error }
      const info: VueInfo = { component: null, chain: [], props: null, piniaChanges: [] };
      try {
        const el = id ? document.querySelector(`[data-bugrec-eid="${CSS.escape(id)}"]`) : null;
        const inst = el ? findInstance(el) : null;
        if (inst) {
          info.component = componentName(inst);
          info.chain = componentChain(inst);
          info.props = serializeProps(inst as never);
          const pinia = inst.__vue2 ? null : findPinia(inst);
          if (pinia && !pinias.has(pinia)) subscribePinia(pinia);
        }
        info.piniaChanges = snapshotChangedStores();
      } catch (err) {
        info.error = String((err as { message?: string } | null)?.message ?? err);
      }
      document.dispatchEvent(new CustomEvent('bugrec:vue-info', { detail: info }));
    },
    false
  );
}

install();
