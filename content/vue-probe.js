// Vue 探针(主世界,manifest "world": "MAIN"):
//  - el.__vueParentComponent → 组件链(名称 + 当时的 props 快照)
//  - appContext → 定位 Pinia(带 _s Map 的 provide),订阅 $subscribe / $onAction
//  - 每次探针对比 store 快照,返回发生变化的 store
// 兼容:Vue3 dev/Vite 下组件链与 props 最完整;生产构建可能拿不到 __vueParentComponent,
// 自动降级(选择器/输入值/Pinia 变化仍可用)。协议见 recorder.js;序列化在 probe-serialize.js。

(() => {
  if (window.__bugrecVueProbe) return;
  window.__bugrecVueProbe = true;

  const { trunc, safeStringify, serializeProps } = __bugrecSer;
  const MAX_STATE = 4096;
  const pinias = new Set(); // 已订阅的 pinia 实例
  const lastSnap = new WeakMap(); // pinia -> Map(storeId -> state json)

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

  function findPinia(inst) {
    try {
      const provides =
        (inst.appContext && (inst.appContext.provides || (inst.appContext._context && inst.appContext._context.provides))) || {};
      for (const k of Reflect.ownKeys(provides)) {
        const v = provides[k];
        if (v && v._s instanceof Map) return v;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function dispatchPinia(detail) {
    try {
      document.dispatchEvent(new CustomEvent('bugrec:pinia', { detail }));
    } catch {
      /* ignore */
    }
  }

  function subscribePinia(pinia) {
    pinias.add(pinia);
    for (const [id, store] of pinia._s) {
      try {
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
            dispatchPinia({ storeId: String(id), changeType: mutation.type, keys: keys.slice(0, 12) });
          },
          { detached: true }
        );
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

  function snapMap(pinia) {
    let m = lastSnap.get(pinia);
    if (!m) {
      m = new Map();
      lastSnap.set(pinia, m);
    }
    return m;
  }

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
        info.error = String((err && err.message) || err);
      }
      document.dispatchEvent(new CustomEvent('bugrec:vue-info', { detail: info }));
    },
    false
  );
})();
