// Vue 探针(主世界运行,manifest 指定 "world": "MAIN"):
//  - 通过 el.__vueParentComponent 拿组件实例链(名称 + 当时的 props 快照)
//  - 通过 appContext 定位 Pinia 实例,遍历 _s 对所有 store:
//      $subscribe 记录状态变更流(哪个 store / 哪些 key)
//      $onAction  记录调用了哪个 action
//  - 每次探针时对比各 store $state 快照,返回"发生变化的 store"列表
// 与隔离世界(recorder.js)的协议:
//   收到 bugrec:probe(detail:{id}) → 读取 [data-bugrec-eid=id] 元素 → 计算 → 派发 bugrec:vue-info
//   任何时刻 Pinia 变更 → 派发 bugrec:pinia(detail)
// 兼容性:Vue3 dev/Vite 下组件链与 props 最完整;生产构建可能拿不到 __vueParentComponent,
// 自动降级为普通步骤(选择器/输入值/Pinia 变化仍可用,pinia._s 在生产构建同样存在)。
(() => {
  if (window.__bugrecVueProbe) return;
  window.__bugrecVueProbe = true;

  const MAX_STR = 200;
  const MAX_STATE = 4096;
  const pinias = new Set(); // 已订阅的 pinia 实例
  const lastSnap = new WeakMap(); // pinia -> Map(storeId -> state json)

  /* ---------- 序列化工具 ---------- */

  function safeStringify(value, depth = 0) {
    try {
      if (value === undefined) return 'undefined';
      if (value === null) return 'null';
      const t = typeof value;
      if (t === 'string') return JSON.stringify(value.length > MAX_STR ? value.slice(0, MAX_STR) + '…' : value);
      if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
      if (t === 'function') return '[fn ' + ((value.name || 'anonymous').slice(0, 40)) + ']';
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
      const body = keys
        .map((k) => `${k}: ${safeStringify(value[k], depth + 1)}`)
        .join(', ');
      return '{' + body + (Object.keys(value).length > 24 ? ',…' : '') + '}';
    } catch (e) {
      return '[序列化失败]';
    }
  }

  function trunc(s, n = MAX_STR * 2) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /* ---------- Vue 组件实例链 ---------- */

  function findInstance(el) {
    let cur = el;
    while (cur) {
      if (cur.__vueParentComponent) return cur.__vueParentComponent; // Vue 3
      if (cur.__vue__) return { __vue2: cur.__vue__ }; // Vue 2(有限支持)
      cur = cur.parentElement;
    }
    return null;
  }

  function componentName(inst) {
    if (!inst) return null;
    if (inst.__vue2) {
      const opts = inst.__vue2.$options || {};
      return opts.name || opts._componentTag || null;
    }
    const t = inst.type || {};
    return t.__name || t.name || (t.__file ? t.__file.split('/').pop().replace(/\.\w+$/, '') : null);
  }

  function componentChain(inst, max = 4) {
    const names = [];
    let cur = inst;
    while (cur && names.length < max) {
      const n = componentName(cur);
      if (n) names.push(n);
      cur = cur.parent;
    }
    return names;
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

  /* ---------- Pinia 定位与订阅 ---------- */

  function findPinia(inst) {
    try {
      const provides = (inst.appContext && (inst.appContext.provides || (inst.appContext._context && inst.appContext._context.provides))) || {};
      for (const k of Reflect.ownKeys(provides)) {
        const v = provides[k];
        if (v && v._s instanceof Map) return v;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function snapMap(pinia) {
    let m = lastSnap.get(pinia);
    if (!m) {
      m = new Map();
      lastSnap.set(pinia, m);
    }
    return m;
  }

  function subscribePinia(pinia) {
    pinias.add(pinia);
    for (const [id, store] of pinia._s) {
      try {
        // 状态变更流(含直接赋值 / $patch)
        store.$subscribe(
          (mutation) => {
            const keys =
              mutation.events == null
                ? []
                : Array.isArray(mutation.events)
                  ? mutation.events.map((ev) => ev && ev.key).filter(Boolean)
                  : mutation.events.key
                    ? [mutation.events.key]
                    : [];
            dispatchPinia({
              storeId: String(id),
              changeType: mutation.type, // direct | patch ... action 的变更也会在这里出现
              keys: keys.slice(0, 12),
            });
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

  function dispatchPinia(detail) {
    try {
      document.dispatchEvent(new CustomEvent('bugrec:pinia', { detail }));
    } catch {
      /* ignore */
    }
  }

  /* ---------- 状态快照(与上次对比,返回变化的 store) ---------- */

  function snapshotChangedStores() {
    const out = [];
    for (const pinia of pinias) {
      const snaps = snapMap(pinia);
      for (const [id, store] of pinia._s) {
        let json;
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

  /* ---------- 探针协议 ---------- */

  document.addEventListener(
    'bugrec:probe',
    (e) => {
      const id = e.detail && e.detail.id;
      // 扁平结构:{ component, chain, props, piniaChanges, error }
      const info = { component: null, chain: [], props: null, piniaChanges: [] };
      try {
        const el = id ? document.querySelector(`[data-bugrec-eid="${CSS.escape(id)}"]`) : null;
        const inst = el ? findInstance(el) : null;
        if (inst) {
          info.component = componentName(inst);
          info.chain = componentChain(inst);
          info.props = serializeProps(inst);
          const pinia = inst.__vue2 ? null : findPinia(inst);
          if (pinia && !pinias.has(pinia)) subscribePinia(pinia);
        }
        info.piniaChanges = snapshotChangedStores();
      } catch (err) {
        info.error = String(err && err.message || err);
      }
      document.dispatchEvent(new CustomEvent('bugrec:vue-info', { detail: info }));
    },
    false
  );
})();
