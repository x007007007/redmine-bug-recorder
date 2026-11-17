// 框架探针(主世界,manifest "world": "MAIN"):识别点击元素所属的组件信息。
//  - Vue 3 dev:el.__vueParentComponent → 组件链(名称 + 当时的 props 快照)
//  - Vue 3 生产构建:__vueParentComponent 被编译掉,降级到 __vue_app__ 取根组件,
//    并从 appContext.provides 定位 Pinia(带 _s Map),订阅 $subscribe / $onAction
//  - Vue 2:el.__vue__(生产构建同样存在)
//  - React 17+/16:el 上的 __reactFiber$* / __reactInternalInstance$ 沿 return 链取组件名,
//    props 优先取 __reactProps$*(与 fiber.memoizedProps 同源)
// 每次探针对比 store 快照,返回发生变化的 store。协议见 recorder.ts;序列化在 probe-serialize.ts。
// 构建时打包为单个 IIFE 经典脚本。

import { enqueue, publishVue } from './bridge';
import { trunc, safeStringify, serializeProps, serializePropsObject } from './probe-serialize';
import type { FrameInfo, PiniaChange } from '../shared/types';

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

/* ---- Vue 组件实例(避不开内部字段,做最小形状断言) ---- */
interface Inst {
  __vue2?: { $options: { name?: string; _componentTag?: string }; $props: unknown };
  type?: { __name?: string; name?: string; __file?: string };
  parent?: Inst | null;
  appContext?: { provides?: Record<PropertyKey, unknown>; _context?: { provides?: Record<PropertyKey, unknown> } };
}

/* ---- React fiber(内部字段,最小形状) ---- */
interface FiberNode {
  type?: { displayName?: string; name?: string } | string | null;
  return?: FiberNode | null;
  memoizedProps?: unknown;
}

function install(): void {
  if ((window as unknown as Record<string, unknown>).__bugrecVueProbe) return;
  (window as unknown as Record<string, unknown>).__bugrecVueProbe = true;

  const MAX_STATE = 4096;
  const pinias = new Set<PiniaLike>(); // 已订阅的 pinia 实例
  const lastSnap = new WeakMap<PiniaLike, Map<string, string>>(); // pinia -> (storeId -> state json)

  /* ================= Vue ================= */

  function findInstance(el: Element): Inst | null {
    let cur: Element | null = el;
    while (cur) {
      const holder = cur as Element & { __vueParentComponent?: Inst; __vue__?: { $options: { name?: string } } };
      if (holder.__vueParentComponent) return holder.__vueParentComponent; // Vue 3 dev
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

  function findPiniaInProvides(provides: Record<PropertyKey, unknown> | undefined | null): PiniaLike | null {
    if (!provides) return null;
    try {
      for (const k of Reflect.ownKeys(provides)) {
        const v = provides[k];
        if (v && (v as PiniaLike)._s instanceof Map) return v as PiniaLike;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function findPinia(inst: Inst): PiniaLike | null {
    const ctx = inst.appContext;
    return findPiniaInProvides(ctx?.provides || ctx?._context?.provides);
  }

  /**
   * Vue 3 生产构建降级:__vueParentComponent 不存在,沿祖先找挂载容器上的 __vue_app__,
   * 至少拿到根组件名;Pinia 经 app._context.provides 定位(app.use(pinia) 会 provide 进去)。
   */
  interface VueAppLike {
    _component?: { __name?: string; name?: string };
    _context?: { provides?: Record<PropertyKey, unknown> };
  }

  function findVueApp(el: Element): { app: VueAppLike; container: Element } | null {
    let cur: Element | null = el;
    while (cur) {
      const app = (cur as Element & { __vue_app__?: VueAppLike }).__vue_app__;
      if (app) return { app, container: cur };
      cur = cur.parentElement;
    }
    return null;
  }

  /* ================= React ================= */

  const REACT_FIBER_KEY = /^__react(?:Fiber|InternalInstance)\$/;
  const REACT_PROPS_KEY = /^__reactProps\$/;

  function internalKeyOf(el: Element, pattern: RegExp): string | null {
    try {
      for (const k of Object.keys(el)) {
        if (pattern.test(k)) return k;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function findFiber(el: Element): FiberNode | null {
    const key = internalKeyOf(el, REACT_FIBER_KEY);
    if (!key) return null;
    try {
      return (el as unknown as Record<string, FiberNode | undefined>)[key] ?? null;
    } catch {
      return null;
    }
  }

  function fiberComponentName(fiber: FiberNode | null): string | null {
    const type = fiber?.type;
    if (!type || typeof type === 'string') return null; // 宿主元素(div 等)没有组件名
    return type.displayName || type.name || null;
  }

  function fiberChain(fiber: FiberNode | null, max = 4): string[] {
    const names: string[] = [];
    let cur = fiber;
    while (cur && names.length < max) {
      const n = fiberComponentName(cur);
      if (n && !names.includes(n)) names.push(n);
      cur = cur.return ?? null;
    }
    return names;
  }

  function reactPropsOf(el: Element, fiber: FiberNode | null): Record<string, unknown> | null {
    const key = internalKeyOf(el, REACT_PROPS_KEY);
    if (key) {
      try {
        const props = (el as unknown as Record<string, Record<string, unknown> | undefined>)[key];
        if (props && typeof props === 'object') return props;
      } catch {
        /* ignore */
      }
    }
    return fiber && typeof fiber.memoizedProps === 'object' && fiber.memoizedProps !== null
      ? (fiber.memoizedProps as Record<string, unknown>)
      : null;
  }

  /* ================= Pinia 流 ================= */

  function dispatchPinia(detail: Record<string, unknown>): void {
    try {
      enqueue({ channel: 'pinia', event: detail });
    } catch {
      /* ignore */
    }
  }

  function mutationKeys(mutation: PiniaMutation): string[] {
    const events = mutation.events;
    if (events == null) return [];
    const list = Array.isArray(events) ? events : [events];
    return list
      .map((ev) => ev && ev.key)
      .filter((k): k is string => !!k)
      .slice(0, 12);
  }

  function subscribePinia(pinia: PiniaLike): void {
    pinias.add(pinia);
    for (const [id, store] of pinia._s) {
      try {
        // 状态变更流(含直接赋值 / $patch / action 内部变更)
        store.$subscribe((mutation) => {
          dispatchPinia({ storeId: String(id), changeType: mutation.type, keys: mutationKeys(mutation) });
        }, { detached: true });
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

  /* ================= 探测主入口 ================= */

  function probeVue(el: Element): FrameInfo | null {
    const inst = findInstance(el);
    if (!inst) return null;
    const info: FrameInfo = { framework: 'vue', component: componentName(inst), chain: componentChain(inst), props: serializeProps(inst), piniaChanges: [] };
    const pinia = inst.__vue2 ? null : findPinia(inst);
    if (pinia && !pinias.has(pinia)) subscribePinia(pinia);
    return info;
  }

  function probeReact(el: Element): FrameInfo | null {
    const fiber = findFiber(el);
    if (!fiber) return null;
    const names = fiberChain(fiber);
    const props = reactPropsOf(el, fiber);
    return { framework: 'react', component: names[0] ?? null, chain: names, props: serializePropsObject(props), piniaChanges: [] };
  }

  /** 生产构建 Vue:只到根组件,组件链/props 不可得,至少报应用名并接上 Pinia 流 */
  function probeVueAppRoot(el: Element): FrameInfo | null {
    const hit = findVueApp(el);
    if (!hit) return null;
    const rootName = hit.app._component?.__name || hit.app._component?.name || null;
    const pinia = findPiniaInProvides(hit.app._context?.provides);
    if (pinia && !pinias.has(pinia)) subscribePinia(pinia);
    return {
      framework: 'vue',
      component: rootName,
      chain: rootName ? [rootName] : [],
      props: null,
      piniaChanges: [],
      error: rootName ? undefined : 'prod-build: root component unnamed',
    };
  }

  document.addEventListener(
    'bugrec:probe',
    () => {
      // Firefox 下隔离世界 CustomEvent.detail 对页面不可读（Xray 不透明对象）——
      // 元素 id 写在 DOM 属性上,recorder 侧探针前会清掉旧标记,这里读到的一定是本次目标。
      const marked = document.querySelectorAll('[data-bugrec-eid]');
      const el = marked.length ? marked[marked.length - 1]! : null;
      const info: FrameInfo = { framework: null, component: null, chain: [], props: null, piniaChanges: [] };
      try {
        if (el) {
          const found = probeVue(el) ?? probeReact(el) ?? probeVueAppRoot(el);
          if (found) {
            info.framework = found.framework;
            info.component = found.component;
            info.chain = found.chain;
            info.props = found.props;
          }
          // 卸掉旧标记,保持 DOM 干净,下次探针仍取"最后一个"
          for (const node of marked) node.removeAttribute('data-bugrec-eid');
        }
        info.piniaChanges = snapshotChangedStores();
      } catch (err) {
        info.error = String((err as { message?: string } | null)?.message ?? err);
      }
      publishVue(info);
      document.dispatchEvent(new Event('bugrec:vue-info'));
    },
    false
  );
}

install();
